from fastapi import FastAPI, Query, Request, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response, ORJSONResponse
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from functools import lru_cache
from dataclasses import dataclass, field
from collections import deque
from enum import Enum
import asyncpg
import asyncio
import snowflake.connector
import httpx
import os
import toml
import io
import time
import uuid
import logging
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
from scipy.interpolate import Rbf

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('flux_ops_api')

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))


class Settings(BaseSettings):
    snowflake_host: Optional[str] = None
    snowflake_account: Optional[str] = None
    snowflake_database: str = "SI_DEMOS"
    snowflake_schema: str = "APPLICATIONS"
    snowflake_warehouse: str = "SI_DEMO_WH"
    snowflake_connection_name: str = "cpe_demo_CLI"
    
    vite_postgres_host: Optional[str] = None
    vite_postgres_port: int = 5432
    vite_postgres_database: str = "postgres"
    vite_postgres_user: Optional[str] = None
    vite_postgres_password: Optional[str] = None
    
    snowflake_pool_size: int = 4
    snowflake_query_timeout: int = 60
    
    cache_ttl_metro: int = 300
    cache_ttl_feeders: int = 300
    cache_ttl_service_areas: int = 120
    cache_ttl_weather: int = 60
    cache_ttl_kpis: int = 30
    
    circuit_breaker_threshold: int = 5
    circuit_breaker_recovery: int = 30
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )


settings = Settings()


postgres_pool: Optional[asyncpg.Pool] = None
snowflake_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="snowflake")


@dataclass
class CacheEntry:
    data: Any
    timestamp: float
    ttl: int = 300
    
    def is_valid(self) -> bool:
        return (time.time() - self.timestamp) < self.ttl


class ResponseCache:
    def __init__(self):
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._cache.get(key)
            if entry and entry.is_valid():
                return entry.data
            elif entry:
                del self._cache[key]
            return None
    
    async def set(self, key: str, data: Any, ttl: int = 300):
        async with self._lock:
            self._cache[key] = CacheEntry(data=data, timestamp=time.time(), ttl=ttl)
    
    async def invalidate(self, key: str):
        async with self._lock:
            self._cache.pop(key, None)
    
    async def clear(self):
        async with self._lock:
            self._cache.clear()


response_cache = ResponseCache()


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, recovery_timeout: int = 30):
        self._failure_count = 0
        self._failure_threshold = failure_threshold
        self._recovery_timeout = recovery_timeout
        self._last_failure_time: Optional[float] = None
        self._state = "closed"
        self._lock = asyncio.Lock()
    
    async def is_open(self) -> bool:
        async with self._lock:
            if self._state == "open":
                if self._last_failure_time and (time.time() - self._last_failure_time) > self._recovery_timeout:
                    self._state = "half-open"
                    return False
                return True
            return False
    
    async def record_success(self):
        async with self._lock:
            self._failure_count = 0
            self._state = "closed"
    
    async def record_failure(self):
        async with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.time()
            if self._failure_count >= self._failure_threshold:
                self._state = "open"
                logger.warning(f"Circuit breaker opened after {self._failure_count} failures")
    
    @property
    def state(self) -> str:
        return self._state


class RequestMetrics:
    def __init__(self, max_history: int = 1000):
        self._requests: deque = deque(maxlen=max_history)
        self._lock = asyncio.Lock()
    
    async def record(self, endpoint: str, duration_ms: float, status: int, cache_hit: bool = False):
        async with self._lock:
            self._requests.append({
                "endpoint": endpoint,
                "duration_ms": duration_ms,
                "status": status,
                "cache_hit": cache_hit,
                "timestamp": time.time()
            })
    
    async def get_stats(self, minutes: int = 5) -> Dict[str, Any]:
        async with self._lock:
            cutoff = time.time() - (minutes * 60)
            recent = [r for r in self._requests if r["timestamp"] > cutoff]
            
            if not recent:
                return {"total_requests": 0, "avg_duration_ms": 0, "cache_hit_rate": 0}
            
            total = len(recent)
            avg_duration = sum(r["duration_ms"] for r in recent) / total
            cache_hits = sum(1 for r in recent if r["cache_hit"])
            errors = sum(1 for r in recent if r["status"] >= 400)
            
            by_endpoint = {}
            for r in recent:
                ep = r["endpoint"]
                if ep not in by_endpoint:
                    by_endpoint[ep] = {"count": 0, "total_ms": 0, "errors": 0}
                by_endpoint[ep]["count"] += 1
                by_endpoint[ep]["total_ms"] += r["duration_ms"]
                if r["status"] >= 400:
                    by_endpoint[ep]["errors"] += 1
            
            for ep in by_endpoint:
                by_endpoint[ep]["avg_ms"] = by_endpoint[ep]["total_ms"] / by_endpoint[ep]["count"]
            
            return {
                "total_requests": total,
                "avg_duration_ms": round(avg_duration, 2),
                "cache_hit_rate": round(cache_hits / total * 100, 1) if total > 0 else 0,
                "error_rate": round(errors / total * 100, 1) if total > 0 else 0,
                "by_endpoint": by_endpoint
            }


snowflake_circuit_breaker = CircuitBreaker(
    failure_threshold=settings.circuit_breaker_threshold,
    recovery_timeout=settings.circuit_breaker_recovery
)
request_metrics = RequestMetrics()

SNOWFLAKE_QUERY_TIMEOUT = settings.snowflake_query_timeout
CACHE_TTL_METRO = settings.cache_ttl_metro
CACHE_TTL_FEEDERS = settings.cache_ttl_feeders
CACHE_TTL_SERVICE_AREAS = settings.cache_ttl_service_areas
CACHE_TTL_WEATHER = settings.cache_ttl_weather
CACHE_TTL_KPIS = settings.cache_ttl_kpis

SNOWFLAKE_POOL_SIZE = settings.snowflake_pool_size


class HealthStatus(str, Enum):
    OK = "ok"
    DEGRADED = "degraded"
    ERROR = "error"


class DependencyStatus(BaseModel):
    status: str
    pool_size: Optional[int] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: HealthStatus
    timestamp: float
    request_id: Optional[str] = None
    dependencies: Optional[Dict[str, DependencyStatus]] = None


class MetricsResponse(BaseModel):
    total_requests: int
    avg_duration_ms: float
    cache_hit_rate: float
    error_rate: float
    by_endpoint: Dict[str, Any]
    circuit_breaker_state: str
    cache_keys: int


class KPIResponse(BaseModel):
    TOTAL_CUSTOMERS: Optional[int] = None
    ACTIVE_OUTAGES: Optional[int] = None
    TOTAL_LOAD_MW: Optional[float] = None
    CREWS_ACTIVE: Optional[int] = None
    AVG_RESTORATION_MINUTES: Optional[float] = None


class SnowflakeConnectionPool:
    def __init__(self, pool_size: int = SNOWFLAKE_POOL_SIZE):
        self._pool_size = pool_size
        self._connections: List[Any] = []
        self._lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(pool_size)
        self._initialized = False
    
    def _create_connection(self):
        token = get_login_token()
        if token and settings.snowflake_host:
            return snowflake.connector.connect(
                host=settings.snowflake_host,
                account=settings.snowflake_account,
                token=token,
                authenticator='oauth',
                database=settings.snowflake_database,
                schema=settings.snowflake_schema,
                warehouse=settings.snowflake_warehouse
            )
        else:
            return snowflake.connector.connect(
                connection_name=settings.snowflake_connection_name
            )
    
    async def get_connection(self):
        await self._semaphore.acquire()
        async with self._lock:
            if self._connections:
                conn = self._connections.pop()
                try:
                    conn.cursor().execute("SELECT 1")
                    return conn
                except:
                    pass
        return self._create_connection()
    
    async def release_connection(self, conn):
        async with self._lock:
            if len(self._connections) < self._pool_size:
                self._connections.append(conn)
            else:
                try:
                    conn.close()
                except:
                    pass
        self._semaphore.release()
    
    async def close_all(self):
        async with self._lock:
            for conn in self._connections:
                try:
                    conn.close()
                except:
                    pass
            self._connections.clear()


snowflake_pool: Optional[SnowflakeConnectionPool] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global postgres_pool, snowflake_pool
    
    snowflake_pool = SnowflakeConnectionPool(pool_size=SNOWFLAKE_POOL_SIZE)
    logger.info(f"Snowflake connection pool initialized (size: {SNOWFLAKE_POOL_SIZE})")
    
    try:
        if settings.vite_postgres_host:
            logger.info(f"Connecting to Postgres: {settings.vite_postgres_host}...")
            postgres_pool = await asyncpg.create_pool(
                host=settings.vite_postgres_host,
                port=settings.vite_postgres_port,
                database=settings.vite_postgres_database,
                user=settings.vite_postgres_user,
                password=settings.vite_postgres_password,
                ssl='require',
                min_size=1,
                max_size=20
            )
            logger.info(f"Postgres async pool initialized: {settings.vite_postgres_host}")
        else:
            logger.info("Postgres host not configured - Snowflake-only mode")
    except Exception as e:
        logger.warning(f"Postgres pool failed: {e}")
        logger.info("   Falling back to Snowflake-only mode")
    
    asyncio.create_task(warm_cache_background())
    
    yield
    
    if postgres_pool:
        await postgres_pool.close()
    if snowflake_pool:
        await snowflake_pool.close_all()


async def warm_cache_background():
    """Background task to pre-warm cache on startup for faster first request."""
    await asyncio.sleep(2)
    logger.info("Starting background cache warming...")
    
    try:
        def _fetch_metro():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT SUBSTATION_ID, SUBSTATION_NAME, LATITUDE, LONGITUDE,
                       CAPACITY_MVA, AVG_LOAD_PCT, ACTIVE_OUTAGES,
                       TRANSFORMER_COUNT, TOTAL_CAPACITY_KVA
                FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_METRO
            """)
            results = []
            for row in cursor.fetchall():
                results.append({
                    'SUBSTATION_ID': row[0], 'SUBSTATION_NAME': row[1],
                    'LATITUDE': float(row[2]) if row[2] else None,
                    'LONGITUDE': float(row[3]) if row[3] else None,
                    'CAPACITY_MVA': float(row[4]) if row[4] else None,
                    'AVG_LOAD_PCT': float(row[5]) if row[5] else None,
                    'ACTIVE_OUTAGES': int(row[6]) if row[6] else 0,
                    'TRANSFORMER_COUNT': int(row[7]) if row[7] else 0,
                    'TOTAL_CAPACITY_KVA': float(row[8]) if row[8] else None
                })
            cursor.close()
            conn.close()
            return results
        
        metro = await run_snowflake_query(_fetch_metro)
        await response_cache.set("metro_topology", metro, ttl=CACHE_TTL_METRO)
        logger.info(f"Cache warmed: {len(metro)} metro substations")
        
        def _fetch_kpis():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
            row = cursor.fetchone()
            kpis = {}
            if row:
                columns = [desc[0] for desc in cursor.description]
                for i, col in enumerate(columns):
                    val = row[i]
                    if val is not None:
                        if isinstance(val, (int, float)):
                            kpis[col] = val
                        else:
                            try:
                                kpis[col] = float(val)
                            except (ValueError, TypeError):
                                kpis[col] = str(val)
            cursor.close()
            conn.close()
            return kpis
        
        kpis = await run_snowflake_query(_fetch_kpis)
        await response_cache.set("kpis", kpis, ttl=CACHE_TTL_KPIS)
        logger.info("Cache warmed: KPIs")
        
        logger.info("Background cache warming complete (metro + KPIs)")
    except Exception as e:
        logger.warning(f"Background cache warming failed: {e}")


TAGS_METADATA = [
    {"name": "Health & Metrics", "description": "System health, performance metrics, and cache management"},
    {"name": "Initial Load", "description": "Batch endpoint for optimized initial data loading"},
    {"name": "Topology", "description": "Grid topology data - substations, feeders, and connections"},
    {"name": "Assets", "description": "Grid asset information - transformers, poles, meters"},
    {"name": "Operations", "description": "Operational data - KPIs, service areas, weather"},
    {"name": "Outages & Work Orders", "description": "Active outages and work order management"},
    {"name": "Cortex Agent", "description": "AI-powered conversational interface for grid operations"},
]

app = FastAPI(
    title="Flux Operations Center API",
    description="FastAPI backend for Grid Operations grid operations monitoring. "
                "Optimized for sub-second ERM queries with Postgres caching and parallel Snowflake queries.",
    version="2.0.0",
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
    openapi_tags=TAGS_METADATA
)


@app.middleware("http")
async def request_tracking_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    start_time = time.time()
    
    request.state.request_id = request_id
    request.state.start_time = start_time
    
    path = request.url.path
    if "/stream" in path or path.endswith("/stream"):
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
    
    response = await call_next(request)
    
    duration_ms = (time.time() - start_time) * 1000
    cache_hit = getattr(request.state, 'cache_hit', False)
    
    await request_metrics.record(
        endpoint=request.url.path,
        duration_ms=duration_ms,
        status=response.status_code,
        cache_hit=cache_hit
    )
    
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time-Ms"] = str(round(duration_ms, 2))
    
    if duration_ms > 1000:
        logger.warning(f"Slow request: {request.method} {request.url.path} took {duration_ms:.0f}ms")
    
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom GZip middleware that excludes SSE streaming endpoints
class SelectiveGZipMiddleware(GZipMiddleware):
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            # Skip GZip for streaming endpoints
            if "/stream" in path or path.endswith("/stream"):
                await self.app(scope, receive, send)
                return
        await super().__call__(scope, receive, send)

app.add_middleware(SelectiveGZipMiddleware, minimum_size=1000)


class ErrorResponse(BaseModel):
    detail: str
    request_id: Optional[str] = None
    timestamp: float


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, 'request_id', None)
    logger.error(f"Unhandled exception [{request_id}]: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "request_id": request_id,
            "timestamp": time.time()
        }
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, 'request_id', None)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "request_id": request_id,
            "timestamp": time.time()
        }
    )


def get_login_token() -> Optional[str]:
    try:
        with open('/snowflake/session/token', 'r') as f:
            return f.read()
    except FileNotFoundError:
        return None


def get_snowflake_connection():
    token = get_login_token()
    if token and settings.snowflake_host:
        return snowflake.connector.connect(
            host=settings.snowflake_host,
            account=settings.snowflake_account,
            token=token,
            authenticator='oauth',
            database=settings.snowflake_database,
            schema=settings.snowflake_schema,
            warehouse=settings.snowflake_warehouse
        )
    else:
        return snowflake.connector.connect(
            connection_name=settings.snowflake_connection_name
        )


@asynccontextmanager
async def snowflake_connection():
    conn = None
    try:
        if snowflake_pool:
            conn = await snowflake_pool.get_connection()
        else:
            conn = get_snowflake_connection()
        yield conn
    finally:
        if conn:
            if snowflake_pool:
                await snowflake_pool.release_connection(conn)
            else:
                conn.close()


async def run_snowflake_query(query_func, *args, timeout: int = SNOWFLAKE_QUERY_TIMEOUT, **kwargs):
    if await snowflake_circuit_breaker.is_open():
        logger.error("Circuit breaker is open - rejecting Snowflake query")
        raise HTTPException(status_code=503, detail="Snowflake service temporarily unavailable")
    
    loop = asyncio.get_event_loop()
    try:
        future = loop.run_in_executor(snowflake_executor, lambda: query_func(*args, **kwargs))
        result = await asyncio.wait_for(future, timeout=timeout)
        await snowflake_circuit_breaker.record_success()
        return result
    except asyncio.TimeoutError:
        await snowflake_circuit_breaker.record_failure()
        logger.error(f"Snowflake query timed out after {timeout}s")
        raise HTTPException(status_code=504, detail=f"Query timed out after {timeout} seconds")
    except Exception as e:
        await snowflake_circuit_breaker.record_failure()
        logger.error(f"Snowflake query failed: {e}")
        raise


@app.get("/health", response_model=HealthResponse, tags=["Health & Metrics"])
async def health(request: Request, detailed: bool = Query(False, description="Include detailed status of dependencies")):
    request_id = getattr(request.state, 'request_id', None)
    result = HealthResponse(
        status=HealthStatus.OK,
        timestamp=time.time(),
        request_id=request_id
    )
    
    if not detailed:
        return result
    
    dependencies = {}
    
    if postgres_pool:
        try:
            async with postgres_pool.acquire(timeout=5) as conn:
                await conn.fetchval("SELECT 1")
            dependencies["postgres"] = DependencyStatus(status="ok", pool_size=postgres_pool.get_size())
        except Exception as e:
            dependencies["postgres"] = DependencyStatus(status="error", error=str(e))
    else:
        dependencies["postgres"] = DependencyStatus(status="not_configured")
    
    try:
        def _check_snowflake():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            conn.close()
            return True
        
        await run_snowflake_query(_check_snowflake, timeout=10)
        dependencies["snowflake"] = DependencyStatus(status="ok")
    except Exception as e:
        dependencies["snowflake"] = DependencyStatus(status="error", error=str(e))
    
    result.dependencies = dependencies
    
    has_errors = any(dep.status == "error" for dep in dependencies.values())
    if has_errors:
        result.status = HealthStatus.DEGRADED
    
    return result


@app.get("/api/metrics", response_model=MetricsResponse, tags=["Health & Metrics"])
async def get_metrics(minutes: int = Query(5, ge=1, le=60)):
    stats = await request_metrics.get_stats(minutes=minutes)
    return MetricsResponse(
        total_requests=stats.get("total_requests", 0),
        avg_duration_ms=stats.get("avg_duration_ms", 0),
        cache_hit_rate=stats.get("cache_hit_rate", 0),
        error_rate=stats.get("error_rate", 0),
        by_endpoint=stats.get("by_endpoint", {}),
        circuit_breaker_state=snowflake_circuit_breaker.state,
        cache_keys=len(response_cache._cache)
    )


@app.delete("/api/cache", tags=["Health & Metrics"])
async def clear_cache():
    await response_cache.clear()
    return {"status": "ok", "message": "Cache cleared"}


class InitialLoadResponse(BaseModel):
    metro: List[Dict[str, Any]]
    feeders: List[Dict[str, Any]]
    service_areas: List[Dict[str, Any]]
    kpis: Dict[str, Any]
    timing: Dict[str, float]
    cache_hits: Dict[str, bool]


@app.get("/api/initial-load", response_model=InitialLoadResponse, tags=["Initial Load"])
async def get_initial_load(request: Request, bypass_cache: bool = Query(False)):
    """
    Batch endpoint for initial application load.
    Fetches metro, feeders, service_areas, and KPIs in parallel.
    Reduces initial load time from 3+ minutes to <10 seconds.
    """
    start_time = time.time()
    timing = {}
    cache_hits = {"metro": False, "feeders": False, "service_areas": False, "kpis": False}
    
    async def fetch_metro():
        t0 = time.time()
        cache_key = "metro_topology"
        if not bypass_cache:
            cached = await response_cache.get(cache_key)
            if cached:
                cache_hits["metro"] = True
                timing["metro"] = time.time() - t0
                return cached
        
        def _fetch():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    SUBSTATION_ID, SUBSTATION_NAME, LATITUDE, LONGITUDE,
                    CAPACITY_MVA, AVG_LOAD_PCT, ACTIVE_OUTAGES,
                    TRANSFORMER_COUNT, TOTAL_CAPACITY_KVA
                FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_METRO
            """)
            results = []
            for row in cursor.fetchall():
                results.append({
                    'SUBSTATION_ID': row[0],
                    'SUBSTATION_NAME': row[1],
                    'LATITUDE': float(row[2]) if row[2] else None,
                    'LONGITUDE': float(row[3]) if row[3] else None,
                    'CAPACITY_MVA': float(row[4]) if row[4] else None,
                    'AVG_LOAD_PCT': float(row[5]) if row[5] else None,
                    'ACTIVE_OUTAGES': int(row[6]) if row[6] else 0,
                    'TRANSFORMER_COUNT': int(row[7]) if row[7] else 0,
                    'TOTAL_CAPACITY_KVA': float(row[8]) if row[8] else None
                })
            cursor.close()
            conn.close()
            return results
        
        results = await run_snowflake_query(_fetch)
        await response_cache.set(cache_key, results, ttl=CACHE_TTL_METRO)
        timing["metro"] = time.time() - t0
        return results
    
    async def fetch_feeders():
        t0 = time.time()
        cache_key = "feeder_topology"
        if not bypass_cache:
            cached = await response_cache.get(cache_key)
            if cached:
                cache_hits["feeders"] = True
                timing["feeders"] = time.time() - t0
                return cached
        
        def _fetch():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    SUBSTATION_ID, TRANSFORMER_ID, CONNECTION_TYPE,
                    FROM_LATITUDE, FROM_LONGITUDE, TO_LATITUDE, TO_LONGITUDE,
                    LOAD_UTILIZATION_PCT, CIRCUIT_ID, RATED_KVA,
                    DISTANCE_KM, VOLTAGE_LEVEL
                FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_FEEDERS
            """)
            results = []
            for row in cursor.fetchall():
                results.append({
                    'SUBSTATION_ID': row[0],
                    'TRANSFORMER_ID': row[1],
                    'CONNECTION_TYPE': row[2],
                    'FROM_LATITUDE': float(row[3]) if row[3] else None,
                    'FROM_LONGITUDE': float(row[4]) if row[4] else None,
                    'TO_LATITUDE': float(row[5]) if row[5] else None,
                    'TO_LONGITUDE': float(row[6]) if row[6] else None,
                    'LOAD_UTILIZATION_PCT': float(row[7]) if row[7] else None,
                    'CIRCUIT_ID': row[8],
                    'RATED_KVA': float(row[9]) if row[9] else None,
                    'DISTANCE_KM': float(row[10]) if row[10] else None,
                    'VOLTAGE_LEVEL': row[11]
                })
            cursor.close()
            conn.close()
            return results
        
        results = await run_snowflake_query(_fetch, timeout=120)
        await response_cache.set(cache_key, results, ttl=CACHE_TTL_FEEDERS)
        timing["feeders"] = time.time() - t0
        return results
    
    async def fetch_service_areas():
        t0 = time.time()
        cache_key = "service_areas"
        if not bypass_cache:
            cached = await response_cache.get(cache_key)
            if cached:
                cache_hits["service_areas"] = True
                timing["service_areas"] = time.time() - t0
                return cached
        
        if postgres_pool:
            try:
                async with postgres_pool.acquire() as conn:
                    rows = await conn.fetch("""
                        SELECT 
                            circuit_id, substation_id, substation_name,
                            centroid_lat, centroid_lon,
                            avg_load_percent, avg_health_score, last_updated
                        FROM circuit_status_realtime
                    """)
                    results = [{
                        'CIRCUIT_ID': row['circuit_id'],
                        'SUBSTATION_ID': row['substation_id'],
                        'SUBSTATION_NAME': row['substation_name'],
                        'CENTROID_LAT': float(row['centroid_lat']) if row['centroid_lat'] else None,
                        'CENTROID_LON': float(row['centroid_lon']) if row['centroid_lon'] else None,
                        'AVG_LOAD_PERCENT': float(row['avg_load_percent']) if row['avg_load_percent'] else None,
                        'AVG_HEALTH_SCORE': float(row['avg_health_score']) if row['avg_health_score'] else None
                    } for row in rows]
                    await response_cache.set(cache_key, results, ttl=CACHE_TTL_SERVICE_AREAS)
                    timing["service_areas"] = time.time() - t0
                    return results
            except Exception:
                pass
        
        def _fetch():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT CIRCUIT_ID, SUBSTATION_ID, SUBSTATION_NAME,
                       CENTROID_LAT, CENTROID_LON, AVG_LOAD_PERCENT, AVG_HEALTH_SCORE
                FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_SERVICE_AREAS_MV
            """)
            results = []
            for row in cursor.fetchall():
                results.append({
                    'CIRCUIT_ID': row[0],
                    'SUBSTATION_ID': row[1],
                    'SUBSTATION_NAME': row[2],
                    'CENTROID_LAT': float(row[3]) if row[3] else None,
                    'CENTROID_LON': float(row[4]) if row[4] else None,
                    'AVG_LOAD_PERCENT': float(row[5]) if row[5] else None,
                    'AVG_HEALTH_SCORE': float(row[6]) if row[6] else None
                })
            cursor.close()
            conn.close()
            return results
        
        results = await run_snowflake_query(_fetch)
        await response_cache.set(cache_key, results, ttl=CACHE_TTL_SERVICE_AREAS)
        timing["service_areas"] = time.time() - t0
        return results
    
    async def fetch_kpis():
        t0 = time.time()
        cache_key = "kpis"
        if not bypass_cache:
            cached = await response_cache.get(cache_key)
            if cached:
                cache_hits["kpis"] = True
                timing["kpis"] = time.time() - t0
                return cached
        
        def _fetch():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
            row = cursor.fetchone()
            kpis = {}
            if row:
                columns = [desc[0] for desc in cursor.description]
                for i, col in enumerate(columns):
                    val = row[i]
                    if val is not None:
                        if isinstance(val, (int, float)):
                            kpis[col] = val
                        else:
                            try:
                                kpis[col] = float(val)
                            except (ValueError, TypeError):
                                kpis[col] = str(val)
            cursor.close()
            conn.close()
            return kpis
        
        results = await run_snowflake_query(_fetch)
        await response_cache.set(cache_key, results, ttl=CACHE_TTL_KPIS)
        timing["kpis"] = time.time() - t0
        return results
    
    try:
        metro, feeders, service_areas, kpis = await asyncio.gather(
            fetch_metro(),
            fetch_feeders(),
            fetch_service_areas(),
            fetch_kpis()
        )
        
        total_time = time.time() - start_time
        timing["total"] = total_time
        
        logger.info(f"Initial load complete: {len(metro)} substations, {len(feeders)} feeders, "
                   f"{len(service_areas)} service areas in {total_time:.2f}s "
                   f"(cache hits: {sum(cache_hits.values())}/4)")
        
        return InitialLoadResponse(
            metro=metro,
            feeders=feeders,
            service_areas=service_areas,
            kpis=kpis,
            timing=timing,
            cache_hits=cache_hits
        )
    except Exception as e:
        logger.error(f"Initial load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/assets", tags=["Assets"])
async def get_assets(
    circuits: Optional[str] = Query(None, description="Comma-separated CIRCUIT_IDs"),
    asset_ids: Optional[str] = Query(None, description="Comma-separated ASSET_IDs"),
    limit: Optional[int] = Query(None, description="Max assets to return")
):
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                where_clauses = []
                params = []
                param_idx = 1
                
                if circuits:
                    circuit_list = [c.strip() for c in circuits.split(',')]
                    where_clauses.append(f"circuit_id = ANY(${param_idx})")
                    params.append(circuit_list)
                    param_idx += 1
                if asset_ids:
                    asset_list = [a.strip() for a in asset_ids.split(',')]
                    where_clauses.append(f"asset_id = ANY(${param_idx})")
                    params.append(asset_list)
                
                where_clause = f"WHERE {' OR '.join(where_clauses)}" if where_clauses else ""
                limit_clause = f"LIMIT {limit}" if limit else ""
                
                query = f"""
                    SELECT 
                        asset_id, asset_name, asset_type,
                        latitude, longitude,
                        load_percent, health_score,
                        status, voltage, circuit_id
                    FROM grid_assets_cache
                    {where_clause}
                    ORDER BY asset_type, asset_id
                    {limit_clause}
                """
                
                rows = await conn.fetch(query, *params)
                
                if not rows and (circuits or asset_ids):
                    return await get_assets_from_snowflake(circuits, asset_ids, limit)
                
                assets = []
                for row in rows:
                    assets.append({
                        'ASSET_ID': row['asset_id'],
                        'ASSET_NAME': row['asset_name'],
                        'ASSET_TYPE': row['asset_type'],
                        'LATITUDE': float(row['latitude']) if row['latitude'] else None,
                        'LONGITUDE': float(row['longitude']) if row['longitude'] else None,
                        'LOAD_PERCENT': float(row['load_percent']) if row['load_percent'] is not None else None,
                        'HEALTH_SCORE': float(row['health_score']) if row['health_score'] is not None else None,
                        'STATUS': row['status'],
                        'VOLTAGE': row['voltage'],
                        'CIRCUIT_ID': row['circuit_id'],
                        'COMMISSIONED_DATE': None,
                        'USAGE_KWH': None,
                        'POLE_HEIGHT_FT': None,
                        'CAPACITY_MVA': None,
                        'CUSTOMER_SEGMENT': None
                    })
                
                print(f"Postgres: {len(assets)} assets")
                return assets
                
        except Exception as e:
            print(f"Postgres failed, falling back to Snowflake: {e}")
    
    return await get_assets_from_snowflake(circuits, asset_ids, limit)


async def get_assets_from_snowflake(
    circuit_filter: Optional[str] = None,
    asset_ids_filter: Optional[str] = None,
    limit_param: Optional[int] = None
) -> List[Dict[str, Any]]:
    def _fetch_assets():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        circuit_where = ""
        asset_id_where = ""
        
        if circuit_filter:
            circuits = [f"'{c.strip()}'" for c in circuit_filter.split(',')]
            circuit_where = f"AND CIRCUIT_ID IN ({','.join(circuits)})"
        
        if asset_ids_filter:
            asset_ids = [f"'{a.strip()}'" for a in asset_ids_filter.split(',')]
            asset_id_where = f"AND ASSET_ID IN ({','.join(asset_ids)})"
        
        combined_where = ""
        if circuit_where and asset_id_where:
            circuit_list = ','.join([f"'{c.strip()}'" for c in circuit_filter.split(',')])
            asset_list = ','.join([f"'{a.strip()}'" for a in asset_ids_filter.split(',')])
            combined_where = f"AND (CIRCUIT_ID IN ({circuit_list}) OR ASSET_ID IN ({asset_list}))"
        elif circuit_where:
            combined_where = circuit_where
        elif asset_id_where:
            combined_where = asset_id_where
        
        limit_clause = f"LIMIT {limit_param}" if limit_param else ""
        
        query = f"""
            WITH latest_transformer_load AS (
                SELECT TRANSFORMER_ID, AVG(LOAD_FACTOR_PCT) as avg_load_percent
                FROM SI_DEMOS.PRODUCTION.TRANSFORMER_HOURLY_LOAD
                WHERE LOAD_HOUR >= DATEADD(hour, -1, CURRENT_TIMESTAMP())
                GROUP BY TRANSFORMER_ID
            ),
            recent_meter_usage AS (
                SELECT METER_ID, AVG(USAGE_KWH) as avg_usage_kwh
                FROM SI_DEMOS.PRODUCTION.AMI_INTERVAL_READINGS
                WHERE TIMESTAMP >= DATEADD(hour, -24, CURRENT_TIMESTAMP())
                GROUP BY METER_ID
            ),
            sampled_meters AS (
                SELECT 
                    m.METER_ID,
                    m.METER_LATITUDE,
                    m.METER_LONGITUDE,
                    m.CUSTOMER_SEGMENT_ID,
                    m.COMMISSIONED_DATE,
                    m.CIRCUIT_ID,
                    COALESCE(u.avg_usage_kwh, UNIFORM(5, 50, RANDOM())) as usage,
                    ROW_NUMBER() OVER (
                        PARTITION BY ROUND(m.METER_LATITUDE / 0.005), ROUND(m.METER_LONGITUDE / 0.005)
                        ORDER BY COALESCE(u.avg_usage_kwh, UNIFORM(5, 50, RANDOM())) DESC
                    ) as rn
                FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE m
                LEFT JOIN recent_meter_usage u ON m.METER_ID = u.METER_ID
                WHERE m.METER_LATITUDE IS NOT NULL AND m.METER_LONGITUDE IS NOT NULL
            )
            SELECT 
                ASSET_ID, ASSET_NAME, ASSET_TYPE, LATITUDE, LONGITUDE,
                HEALTH_SCORE, LOAD_PERCENT, USAGE_KWH, VOLTAGE, STATUS,
                COMMISSIONED_DATE, CAPACITY_OR_KVA, POLE_HEIGHT_FT,
                CUSTOMER_SEGMENT, CIRCUIT_ID
            FROM (
                SELECT 
                    SUBSTATION_ID as ASSET_ID, SUBSTATION_NAME as ASSET_NAME,
                    'substation' as ASSET_TYPE, LATITUDE, LONGITUDE,
                    NULL as HEALTH_SCORE, NULL as LOAD_PERCENT, NULL as USAGE_KWH,
                    VOLTAGE_LEVEL as VOLTAGE, OPERATIONAL_STATUS as STATUS,
                    COMMISSIONED_DATE, CAPACITY_MVA as CAPACITY_OR_KVA,
                    NULL as POLE_HEIGHT_FT, NULL as CUSTOMER_SEGMENT, NULL as CIRCUIT_ID
                FROM SI_DEMOS.PRODUCTION.SUBSTATIONS
                WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
                
                UNION ALL
                
                SELECT 
                    t.TRANSFORMER_ID as ASSET_ID, t.TRANSFORMER_ID as ASSET_NAME,
                    'transformer' as ASSET_TYPE, t.LATITUDE, t.LONGITUDE,
                    NULL as HEALTH_SCORE,
                    COALESCE(l.avg_load_percent, UNIFORM(60, 95, RANDOM())) as LOAD_PERCENT,
                    NULL as USAGE_KWH, '13.8kV' as VOLTAGE, 'Operational' as STATUS,
                    t.LAST_MAINTENANCE_DATE as COMMISSIONED_DATE,
                    t.RATED_KVA as CAPACITY_OR_KVA, NULL as POLE_HEIGHT_FT,
                    NULL as CUSTOMER_SEGMENT, t.CIRCUIT_ID
                FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t
                LEFT JOIN latest_transformer_load l ON t.TRANSFORMER_ID = l.TRANSFORMER_ID
                WHERE t.LATITUDE IS NOT NULL AND t.LONGITUDE IS NOT NULL
                    {combined_where}
                
                UNION ALL
                
                SELECT 
                    POLE_ID as ASSET_ID, POLE_ID as ASSET_NAME,
                    'pole' as ASSET_TYPE, LATITUDE, LONGITUDE,
                    HEALTH_SCORE, NULL as LOAD_PERCENT, NULL as USAGE_KWH,
                    CIRCUIT_ID as VOLTAGE, CONDITION_STATUS as STATUS,
                    LAST_INSPECTION_DATE as COMMISSIONED_DATE,
                    NULL as CAPACITY_OR_KVA, POLE_HEIGHT_FT,
                    NULL as CUSTOMER_SEGMENT, CIRCUIT_ID
                FROM SI_DEMOS.PRODUCTION.GRID_POLES_INFRASTRUCTURE
                WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
                    {combined_where}
                
                UNION ALL
                
                SELECT 
                    METER_ID as ASSET_ID, METER_ID as ASSET_NAME,
                    'meter' as ASSET_TYPE, METER_LATITUDE as LATITUDE,
                    METER_LONGITUDE as LONGITUDE, NULL as HEALTH_SCORE,
                    NULL as LOAD_PERCENT, usage as USAGE_KWH,
                    CIRCUIT_ID as VOLTAGE, 'Operational' as STATUS,
                    COMMISSIONED_DATE, NULL as CAPACITY_OR_KVA,
                    NULL as POLE_HEIGHT_FT,
                    CUSTOMER_SEGMENT_ID as CUSTOMER_SEGMENT, CIRCUIT_ID
                FROM sampled_meters
                WHERE rn <= 30
                    {combined_where}
            )
            {limit_clause}
        """
        
        cursor.execute(query)
        
        assets = []
        batch_size = 10000
        while True:
            rows = cursor.fetchmany(batch_size)
            if not rows:
                break
            for row in rows:
                assets.append({
                    'ASSET_ID': row[0],
                    'ASSET_NAME': row[1],
                    'ASSET_TYPE': row[2],
                    'LATITUDE': float(row[3]) if row[3] else None,
                    'LONGITUDE': float(row[4]) if row[4] else None,
                    'HEALTH_SCORE': float(row[5]) if row[5] is not None else None,
                    'LOAD_PERCENT': float(row[6]) if row[6] is not None else None,
                    'USAGE_KWH': float(row[7]) if row[7] is not None else None,
                    'VOLTAGE': row[8],
                    'STATUS': row[9],
                    'COMMISSIONED_DATE': str(row[10]) if row[10] else None,
                    'CAPACITY_MVA': float(row[11]) if row[11] is not None else None,
                    'POLE_HEIGHT_FT': float(row[12]) if row[12] is not None else None,
                    'CUSTOMER_SEGMENT': row[13],
                    'CIRCUIT_ID': row[14]
                })
        
        cursor.close()
        conn.close()
        
        return assets

    try:
        assets = await run_snowflake_query(_fetch_assets)
        print(f"Snowflake (optimized): {len(assets)} assets")
        return assets
    except Exception as e:
        print(f"Snowflake query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/topology", tags=["Topology"])
async def get_topology(
    circuits: Optional[str] = Query(None, description="Comma-separated circuit IDs"),
    limit: int = Query(200000, description="Max connections (Snowflake fallback)")
):
    if postgres_pool and circuits:
        try:
            async with postgres_pool.acquire() as conn:
                circuit_list = [c.strip() for c in circuits.split(',')]
                
                rows = await conn.fetch("""
                    SELECT 
                        from_asset_id, to_asset_id,
                        from_latitude, from_longitude,
                        to_latitude, to_longitude
                    FROM topology_connections_cache
                    WHERE from_circuit_id = ANY($1)
                       OR to_circuit_id = ANY($1)
                """, circuit_list)
                
                topology = []
                for row in rows:
                    topology.append({
                        'FROM_ASSET_ID': row['from_asset_id'],
                        'TO_ASSET_ID': row['to_asset_id'],
                        'FROM_LAT': float(row['from_latitude']) if row['from_latitude'] else None,
                        'FROM_LON': float(row['from_longitude']) if row['from_longitude'] else None,
                        'TO_LAT': float(row['to_latitude']) if row['to_latitude'] else None,
                        'TO_LON': float(row['to_longitude']) if row['to_longitude'] else None
                    })
                
                print(f"Postgres: {len(topology):,} topology connections")
                return topology
                
        except Exception as e:
            print(f"Postgres topology error: {e}")
    
    def _fetch_topology():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        cursor.execute(f"""
            SELECT 
                from_asset_id as FROM_ASSET_ID,
                to_asset_id as TO_ASSET_ID,
                from_latitude as FROM_LAT,
                from_longitude as FROM_LON,
                to_latitude as TO_LAT,
                to_longitude as TO_LON
            FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY
            WHERE from_latitude IS NOT NULL 
              AND to_latitude IS NOT NULL
            LIMIT {limit}
        """)
        
        topology = []
        for row in cursor.fetchall():
            if row[0] and row[1]:
                topology.append({
                    'FROM_ASSET_ID': row[0],
                    'TO_ASSET_ID': row[1],
                    'FROM_LAT': float(row[2]) if row[2] else None,
                    'FROM_LON': float(row[3]) if row[3] else None,
                    'TO_LAT': float(row[4]) if row[4] else None,
                    'TO_LON': float(row[5]) if row[5] else None
                })
        
        cursor.close()
        conn.close()
        return topology

    try:
        topology = await run_snowflake_query(_fetch_topology)
        print(f"Snowflake fallback: {len(topology):,} topology connections")
        return topology
    
    except Exception as e:
        print(f"Topology error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/topology/metro", tags=["Topology"])
async def get_metro_topology(request: Request, bypass_cache: bool = Query(False)):
    cache_key = "metro_topology"
    
    if not bypass_cache:
        cached = await response_cache.get(cache_key)
        if cached:
            request.state.cache_hit = True
            logger.info(f"Cache hit: {len(cached)} metro topology substations")
            return cached
    
    def _fetch_metro():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                SUBSTATION_ID, SUBSTATION_NAME, LATITUDE, LONGITUDE,
                CAPACITY_MVA, AVG_LOAD_PCT, ACTIVE_OUTAGES,
                TRANSFORMER_COUNT, TOTAL_CAPACITY_KVA
            FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_METRO
        """)
        results = []
        for row in cursor.fetchall():
            results.append({
                'SUBSTATION_ID': row[0],
                'SUBSTATION_NAME': row[1],
                'LATITUDE': float(row[2]) if row[2] else None,
                'LONGITUDE': float(row[3]) if row[3] else None,
                'CAPACITY_MVA': float(row[4]) if row[4] else None,
                'AVG_LOAD_PCT': float(row[5]) if row[5] else None,
                'ACTIVE_OUTAGES': int(row[6]) if row[6] else 0,
                'TRANSFORMER_COUNT': int(row[7]) if row[7] else 0,
                'TOTAL_CAPACITY_KVA': float(row[8]) if row[8] else None
            })
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_metro)
        await response_cache.set(cache_key, results, ttl=CACHE_TTL_METRO)
        print(f"Fetched {len(results)} metro topology substations (cached for {CACHE_TTL_METRO}s)")
        return results
    except Exception as e:
        print(f"Error fetching metro topology: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/topology/feeders", tags=["Topology"])
async def get_feeder_topology(request: Request, bypass_cache: bool = Query(False)):
    cache_key = "feeder_topology"
    
    if not bypass_cache:
        cached = await response_cache.get(cache_key)
        if cached:
            request.state.cache_hit = True
            logger.info(f"Cache hit: {len(cached)} feeder topology connections")
            return cached
    
    def _fetch_feeders():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                SUBSTATION_ID, TRANSFORMER_ID, CONNECTION_TYPE,
                FROM_LATITUDE, FROM_LONGITUDE, TO_LATITUDE, TO_LONGITUDE,
                LOAD_UTILIZATION_PCT, CIRCUIT_ID, RATED_KVA,
                DISTANCE_KM, VOLTAGE_LEVEL
            FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_FEEDERS
        """)
        results = []
        for row in cursor.fetchall():
            results.append({
                'SUBSTATION_ID': row[0],
                'TRANSFORMER_ID': row[1],
                'CONNECTION_TYPE': row[2],
                'FROM_LAT': float(row[3]) if row[3] else None,
                'FROM_LON': float(row[4]) if row[4] else None,
                'TO_LAT': float(row[5]) if row[5] else None,
                'TO_LON': float(row[6]) if row[6] else None,
                'LOAD_UTILIZATION_PCT': float(row[7]) if row[7] else None,
                'CIRCUIT_ID': row[8],
                'RATED_KVA': float(row[9]) if row[9] else None,
                'DISTANCE_KM': float(row[10]) if row[10] else None,
                'VOLTAGE_LEVEL': row[11]
            })
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_feeders, timeout=120)
        await response_cache.set(cache_key, results, ttl=CACHE_TTL_FEEDERS)
        print(f"Fetched {len(results)} feeder topology connections (cached for {CACHE_TTL_FEEDERS}s)")
        return results
    except Exception as e:
        print(f"Error fetching feeder topology: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/kpis", tags=["Operations"])
async def get_kpis(request: Request, bypass_cache: bool = Query(False)):
    cache_key = "kpis"
    
    if not bypass_cache:
        cached = await response_cache.get(cache_key)
        if cached:
            request.state.cache_hit = True
            logger.info("Cache hit: KPIs")
            return cached
    
    def _fetch_kpis():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
        row = cursor.fetchone()
        kpis = {}
        if row:
            kpis = {
                'TOTAL_CUSTOMERS': row[0],
                'ACTIVE_OUTAGES': row[1],
                'TOTAL_LOAD_MW': float(row[2]) if row[2] else 0,
                'CREWS_ACTIVE': row[3],
                'AVG_RESTORATION_MINUTES': float(row[4]) if row[4] else 0
            }
        cursor.close()
        conn.close()
        return kpis

    try:
        kpis = await run_snowflake_query(_fetch_kpis)
        await response_cache.set(cache_key, kpis, ttl=CACHE_TTL_KPIS)
        print(f"Fetched KPIs (cached for {CACHE_TTL_KPIS}s)")
        return kpis
    except Exception as e:
        print(f"Error fetching KPIs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/service-areas", tags=["Operations"])
async def get_service_areas(request: Request, bypass_cache: bool = Query(False)):
    cache_key = "service_areas"
    
    if not bypass_cache:
        cached = await response_cache.get(cache_key)
        if cached:
            request.state.cache_hit = True
            logger.info(f"Cache hit: {len(cached)} service areas")
            return cached
    
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT 
                        circuit_id, substation_id, substation_name,
                        centroid_lat, centroid_lon,
                        avg_load_percent, avg_health_score, last_updated
                    FROM circuit_status_realtime
                    ORDER BY substation_id, circuit_id
                """)
                
                service_areas = []
                for row in rows:
                    service_areas.append({
                        'CIRCUIT_ID': row['circuit_id'],
                        'SUBSTATION_ID': row['substation_id'],
                        'SUBSTATION_NAME': row['substation_name'],
                        'CENTROID_LAT': float(row['centroid_lat']) if row['centroid_lat'] else None,
                        'CENTROID_LON': float(row['centroid_lon']) if row['centroid_lon'] else None,
                        'AVG_LOAD_PERCENT': float(row['avg_load_percent']) if row['avg_load_percent'] else None,
                        'AVG_HEALTH_SCORE': float(row['avg_health_score']) if row['avg_health_score'] else None
                    })
                
                await response_cache.set(cache_key, service_areas, ttl=CACHE_TTL_SERVICE_AREAS)
                print(f"Postgres: Fetched {len(service_areas)} circuits (cached for {CACHE_TTL_SERVICE_AREAS}s)")
                return service_areas
        
        except Exception as e:
            print(f"Error fetching service areas from Postgres: {e}")
    
    return await get_service_areas_from_snowflake(cache_key)


async def get_service_areas_from_snowflake(cache_key: str = "service_areas") -> List[Dict[str, Any]]:
    def _fetch_service_areas():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                CIRCUIT_ID, SUBSTATION_ID, SUBSTATION_NAME,
                CIRCUIT_CENTER_LAT, CIRCUIT_CENTER_LON,
                AVG_LOAD_UTILIZATION_PCT, AVG_HEALTH_INDEX
            FROM SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_SERVICE_AREAS_MV
        """)
        service_areas = []
        for row in cursor.fetchall():
            service_areas.append({
                'CIRCUIT_ID': row[0],
                'SUBSTATION_ID': row[1],
                'SUBSTATION_NAME': row[2],
                'CENTROID_LAT': float(row[3]) if row[3] else None,
                'CENTROID_LON': float(row[4]) if row[4] else None,
                'AVG_LOAD_PERCENT': float(row[5]) if row[5] else None,
                'AVG_HEALTH_SCORE': float(row[6]) if row[6] else None
            })
        cursor.close()
        conn.close()
        return service_areas

    try:
        service_areas = await run_snowflake_query(_fetch_service_areas)
        await response_cache.set(cache_key, service_areas, ttl=CACHE_TTL_SERVICE_AREAS)
        print(f"Snowflake fallback: Fetched {len(service_areas)} circuits (cached for {CACHE_TTL_SERVICE_AREAS}s)")
        return service_areas
    except Exception as e:
        print(f"Error fetching service areas from Snowflake: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/weather", tags=["Operations"])
async def get_weather(request: Request, bypass_cache: bool = Query(False)):
    cache_key = "weather"
    
    if not bypass_cache:
        cached = await response_cache.get(cache_key)
        if cached:
            request.state.cache_hit = True
            logger.info(f"Cache hit: {len(cached)} weather records")
            return cached
    
    def _fetch_weather():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT TIMESTAMP_UTC, TEMP_F, HUMIDITY_PCT
            FROM SI_DEMOS.PRODUCTION.HOUSTON_WEATHER_HOURLY
            ORDER BY TIMESTAMP_UTC ASC
        """)
        weather = []
        for row in cursor.fetchall():
            weather.append({
                'TIMESTAMP': str(row[0]),
                'TEMP_F': float(row[1]) if row[1] else None,
                'HUMIDITY_PCT': float(row[2]) if row[2] else None
            })
        cursor.close()
        conn.close()
        return weather

    try:
        weather = await run_snowflake_query(_fetch_weather)
        await response_cache.set(cache_key, weather, ttl=CACHE_TTL_WEATHER)
        print(f"Fetched {len(weather)} weather records (cached for {CACHE_TTL_WEATHER}s)")
        return weather
    except Exception as e:
        print(f"Error fetching weather: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/weather/image", tags=["Operations"])
async def get_weather_image(
    temp_f: float = Query(75, description="Temperature in Fahrenheit"),
    width: int = Query(800, description="Image width"),
    height: int = Query(800, description="Image height")
):
    try:
        def get_weather_color_rgb(temp):
            if temp < 60: return np.array([65, 182, 196])
            if temp < 70: return np.array([127, 205, 187])
            if temp < 75: return np.array([199, 233, 180])
            if temp < 80: return np.array([255, 255, 178])
            if temp < 85: return np.array([254, 217, 118])
            if temp < 90: return np.array([253, 165, 70])
            if temp < 95: return np.array([250, 100, 50])
            return np.array([220, 40, 40])
        
        np.random.seed(int(temp_f * 10) % 1000)
        num_centers = np.random.randint(8, 13)
        
        center_x = np.random.uniform(0.1, 0.9, num_centers)
        center_y = np.random.uniform(0.1, 0.9, num_centers)
        center_temps = temp_f + np.random.uniform(-8, 8, num_centers)
        
        x = np.linspace(0, 1, width)
        y = np.linspace(0, 1, height)
        X, Y = np.meshgrid(x, y)
        
        rbf = Rbf(center_x, center_y, center_temps, function='gaussian', smooth=0.3)
        temp_field = rbf(X, Y)
        
        img_array = np.zeros((height, width, 4), dtype=np.uint8)
        
        for i in range(height):
            for j in range(width):
                temp_at_pixel = temp_field[i, j]
                color = get_weather_color_rgb(temp_at_pixel)
                img_array[i, j, 0] = color[0]
                img_array[i, j, 1] = color[1]
                img_array[i, j, 2] = color[2]
                img_array[i, j, 3] = 180
        
        img = Image.fromarray(img_array, 'RGBA')
        
        buf = io.BytesIO()
        img.save(buf, format='PNG', optimize=True)
        buf.seek(0)
        
        return Response(content=buf.getvalue(), media_type="image/png")
    
    except Exception as e:
        print(f"Error generating weather image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/postgres/substations/status", tags=["Operations"])
async def get_postgres_substation_status():
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT 
                        substation_id,
                        substation_name,
                        COUNT(*) as circuit_count,
                        ROUND(AVG(avg_load_percent)::numeric, 2) as avg_load,
                        ROUND(AVG(avg_health_score)::numeric, 2) as avg_health,
                        ROUND(MAX(avg_load_percent)::numeric, 2) as worst_circuit_load,
                        ROUND(MIN(avg_health_score)::numeric, 2) as worst_circuit_health,
                        COUNT(*) FILTER (WHERE avg_load_percent > 85) as critical_circuits,
                        COUNT(*) FILTER (WHERE avg_load_percent > 70 AND avg_load_percent <= 85) as warning_circuits,
                        CASE 
                            WHEN MAX(avg_load_percent) > 85 OR MIN(avg_health_score) < 50 THEN 'critical'
                            WHEN MAX(avg_load_percent) > 70 OR MIN(avg_health_score) < 70 THEN 'warning'
                            ELSE 'good'
                        END as status,
                        MAX(last_updated) as last_updated
                    FROM circuit_status_realtime
                    GROUP BY substation_id, substation_name
                    ORDER BY worst_circuit_load DESC NULLS LAST
                """)
                
                results = [dict(row) for row in rows]
                print(f"Postgres: Fetched {len(results)} substation statuses")
                return results
        
        except Exception as e:
            print(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_substation_status():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                SUBSTATION_ID as substation_id,
                SUBSTATION_NAME as substation_name,
                COUNT(*) as circuit_count,
                ROUND(AVG(AVG_LOAD_PERCENT), 2) as avg_load,
                ROUND(AVG(AVG_HEALTH_SCORE), 2) as avg_health,
                ROUND(MAX(AVG_LOAD_PERCENT), 2) as worst_circuit_load,
                ROUND(MIN(AVG_HEALTH_SCORE), 2) as worst_circuit_health,
                COUNT(CASE WHEN AVG_LOAD_PERCENT > 85 THEN 1 END) as critical_circuits,
                COUNT(CASE WHEN AVG_LOAD_PERCENT > 70 AND AVG_LOAD_PERCENT <= 85 THEN 1 END) as warning_circuits,
                CASE 
                    WHEN MAX(AVG_LOAD_PERCENT) > 85 OR MIN(AVG_HEALTH_SCORE) < 50 THEN 'critical'
                    WHEN MAX(AVG_LOAD_PERCENT) > 70 OR MIN(AVG_HEALTH_SCORE) < 70 THEN 'warning'
                    ELSE 'good'
                END as status,
                MAX(LAST_UPDATED) as last_updated
            FROM SI_DEMOS.APPLICATIONS.CIRCUIT_STATUS_REALTIME
            GROUP BY SUBSTATION_ID, SUBSTATION_NAME
            ORDER BY worst_circuit_load DESC NULLS LAST
        """)
        
        columns = [desc[0] for desc in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_substation_status)
        print(f"Snowflake fallback: Fetched {len(results)} substation statuses")
        return results
    
    except Exception as e:
        print(f"Error fetching substation status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/substations", tags=["Topology"])
async def get_substations():
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT 
                        substation_id, substation_name,
                        latitude, longitude, capacity_mva,
                        voltage_level, commissioned_date, operational_status
                    FROM substations
                    ORDER BY substation_name
                """)
                
                results = [dict(row) for row in rows]
                print(f"Postgres: Fetched {len(results)} substations")
                return results
        
        except Exception as e:
            print(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_substations():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                SUBSTATION_ID as substation_id,
                SUBSTATION_NAME as substation_name,
                LATITUDE as latitude,
                LONGITUDE as longitude,
                CAPACITY_MVA as capacity_mva,
                VOLTAGE_LEVEL as voltage_level,
                COMMISSIONED_DATE as commissioned_date,
                OPERATIONAL_STATUS as operational_status
            FROM SI_DEMOS.PRODUCTION.SUBSTATIONS
            ORDER BY SUBSTATION_NAME
        """)
        columns = [desc[0] for desc in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_substations)
        print(f"Snowflake fallback: Fetched {len(results)} substations")
        return results
    except Exception as e:
        print(f"Error fetching substations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/circuits/metadata", tags=["Topology"])
async def get_circuit_metadata(
    substation_id: Optional[str] = Query(None),
    circuit_id: Optional[str] = Query(None)
):
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                where_clauses = []
                params = []
                idx = 1
                
                if substation_id:
                    where_clauses.append(f"substation_id = ${idx}")
                    params.append(substation_id)
                    idx += 1
                if circuit_id:
                    where_clauses.append(f"circuit_id = ${idx}")
                    params.append(circuit_id)
                
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
                
                query = f"""
                    SELECT 
                        circuit_id, circuit_name, substation_id,
                        voltage_level_kv, transformer_count, meter_count,
                        avg_latitude, avg_longitude,
                        min_lat, max_lat, min_lon, max_lon
                    FROM circuit_metadata
                    {where_sql}
                    ORDER BY circuit_id
                """
                
                rows = await conn.fetch(query, *params)
                results = [dict(row) for row in rows]
                
                print(f"Postgres: Fetched {len(results)} circuit metadata records")
                return results
        
        except Exception as e:
            print(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_circuit_metadata():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        where_clauses = []
        if substation_id:
            where_clauses.append(f"SUBSTATION_ID = '{substation_id}'")
        if circuit_id:
            where_clauses.append(f"CIRCUIT_ID = '{circuit_id}'")
        
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        
        query = f"""
            SELECT 
                CIRCUIT_ID as circuit_id,
                CIRCUIT_NAME as circuit_name,
                SUBSTATION_ID as substation_id,
                VOLTAGE_LEVEL_KV as voltage_level_kv,
                TRANSFORMER_COUNT as transformer_count,
                METER_COUNT as meter_count,
                AVG_LATITUDE as avg_latitude,
                AVG_LONGITUDE as avg_longitude,
                MIN_LAT as min_lat,
                MAX_LAT as max_lat,
                MIN_LON as min_lon,
                MAX_LON as max_lon
            FROM SI_DEMOS.PRODUCTION.CIRCUIT_METADATA
            {where_sql}
            ORDER BY CIRCUIT_ID
        """
        
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_circuit_metadata)
        print(f"Snowflake fallback: Fetched {len(results)} circuit metadata records")
        return results
    
    except Exception as e:
        print(f"Error fetching circuit metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/outages/active", tags=["Outages & Work Orders"])
async def get_active_outages(
    status: str = Query("IN_PROGRESS"),
    priority: Optional[str] = Query(None)
):
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                where_clauses = [f"restoration_status = $1"]
                params = [status]
                
                if priority:
                    if priority.upper() == 'HIGH':
                        where_clauses.append("severity_level > 500")
                    elif priority.upper() == 'MEDIUM':
                        where_clauses.append("severity_level BETWEEN 100 AND 500")
                    elif priority.upper() == 'LOW':
                        where_clauses.append("severity_level < 100")
                
                where_sql = f"WHERE {' AND '.join(where_clauses)}"
                
                query = f"""
                    SELECT 
                        outage_id, outage_start_timestamp, outage_cause,
                        severity_level, restoration_status, affected_customers_count,
                        outage_center_lat, outage_center_lon,
                        affected_poles, affected_transformers,
                        estimated_duration_hours, estimated_restoration_time,
                        assigned_crew_count, reportable_to_puc,
                        confidence_score, weather_impact_factor,
                        saidi_minutes_accumulated, customer_priority_score,
                        equipment_damage_severity, last_updated_timestamp
                    FROM outage_restoration_tracker
                    {where_sql}
                    ORDER BY severity_level DESC, outage_start_timestamp DESC
                """
                
                rows = await conn.fetch(query, *params)
                results = [dict(row) for row in rows]
                
                print(f"Postgres: Fetched {len(results)} active outages")
                return results
        
        except Exception as e:
            print(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_outages():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        where_clauses = [f"RESTORATION_STATUS = '{status}'"]
        
        if priority:
            if priority.upper() == 'HIGH':
                where_clauses.append("SEVERITY_LEVEL > 500")
            elif priority.upper() == 'MEDIUM':
                where_clauses.append("SEVERITY_LEVEL BETWEEN 100 AND 500")
            elif priority.upper() == 'LOW':
                where_clauses.append("SEVERITY_LEVEL < 100")
        
        where_sql = f"WHERE {' AND '.join(where_clauses)}"
        
        query = f"""
            SELECT 
                OUTAGE_ID as outage_id,
                OUTAGE_START_TIMESTAMP as outage_start_timestamp,
                OUTAGE_CAUSE as outage_cause,
                SEVERITY_LEVEL as severity_level,
                RESTORATION_STATUS as restoration_status,
                AFFECTED_CUSTOMERS_COUNT as affected_customers_count,
                OUTAGE_CENTER_LAT as outage_center_lat,
                OUTAGE_CENTER_LON as outage_center_lon,
                AFFECTED_POLES as affected_poles,
                AFFECTED_TRANSFORMERS as affected_transformers,
                ESTIMATED_DURATION_HOURS as estimated_duration_hours,
                ESTIMATED_RESTORATION_TIME as estimated_restoration_time,
                ASSIGNED_CREW_COUNT as assigned_crew_count,
                REPORTABLE_TO_PUC as reportable_to_puc,
                CONFIDENCE_SCORE as confidence_score,
                WEATHER_IMPACT_FACTOR as weather_impact_factor,
                SAIDI_MINUTES_ACCUMULATED as saidi_minutes_accumulated,
                CUSTOMER_PRIORITY_SCORE as customer_priority_score,
                EQUIPMENT_DAMAGE_SEVERITY as equipment_damage_severity,
                LAST_UPDATED_TIMESTAMP as last_updated_timestamp
            FROM SI_DEMOS.PRODUCTION.OUTAGE_RESTORATION_TRACKER
            {where_sql}
            ORDER BY SEVERITY_LEVEL DESC, OUTAGE_START_TIMESTAMP DESC
        """
        
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_outages)
        print(f"Snowflake fallback: Fetched {len(results)} active outages")
        return results
    
    except Exception as e:
        print(f"Error fetching active outages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/work-orders/active", tags=["Outages & Work Orders"])
async def get_active_work_orders(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    substation_id: Optional[str] = Query(None),
    crew: Optional[str] = Query(None),
    limit: int = Query(1000)
):
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                where_clauses = []
                params = []
                idx = 1
                
                if status:
                    where_clauses.append(f"status = ${idx}")
                    params.append(status)
                    idx += 1
                if priority:
                    where_clauses.append(f"priority = ${idx}")
                    params.append(priority)
                    idx += 1
                if substation_id:
                    where_clauses.append(f"substation_id = ${idx}")
                    params.append(substation_id)
                    idx += 1
                if crew:
                    where_clauses.append(f"assigned_crew = ${idx}")
                    params.append(crew)
                
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
                
                query = f"""
                    SELECT 
                        work_order_id, asset_id, asset_type,
                        substation_id, location_area, work_order_date,
                        work_type, priority, status,
                        cost_usd, labor_hours, assigned_crew
                    FROM work_orders
                    {where_sql}
                    ORDER BY 
                        CASE priority 
                            WHEN 'HIGH' THEN 1 
                            WHEN 'MEDIUM' THEN 2 
                            WHEN 'LOW' THEN 3 
                            ELSE 4 
                        END,
                        work_order_date DESC
                    LIMIT {limit}
                """
                
                rows = await conn.fetch(query, *params)
                results = [dict(row) for row in rows]
                
                print(f"Postgres: Fetched {len(results)} work orders")
                return results
        
        except Exception as e:
            print(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_work_orders():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        where_clauses = []
        if status:
            where_clauses.append(f"STATUS = '{status}'")
        if priority:
            where_clauses.append(f"PRIORITY = '{priority}'")
        if substation_id:
            where_clauses.append(f"SUBSTATION_ID = '{substation_id}'")
        if crew:
            where_clauses.append(f"ASSIGNED_CREW = '{crew}'")
        
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        
        query = f"""
            SELECT 
                WORK_ORDER_ID as work_order_id,
                ASSET_ID as asset_id,
                ASSET_TYPE as asset_type,
                SUBSTATION_ID as substation_id,
                LOCATION_AREA as location_area,
                WORK_ORDER_DATE as work_order_date,
                WORK_TYPE as work_type,
                PRIORITY as priority,
                STATUS as status,
                COST_USD as cost_usd,
                LABOR_HOURS as labor_hours,
                ASSIGNED_CREW as assigned_crew
            FROM SI_DEMOS.PRODUCTION.WORK_ORDERS
            {where_sql}
            ORDER BY 
                CASE PRIORITY 
                    WHEN 'HIGH' THEN 1 
                    WHEN 'MEDIUM' THEN 2 
                    WHEN 'LOW' THEN 3 
                    ELSE 4 
                END,
                WORK_ORDER_DATE DESC
            LIMIT {limit}
        """
        
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_work_orders)
        print(f"Snowflake fallback: Fetched {len(results)} work orders")
        return results
    
    except Exception as e:
        print(f"Error fetching work orders: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agent/threads/create", tags=["Cortex Agent"])
async def create_thread():
    try:
        is_spcs = get_login_token() is not None and settings.snowflake_host is not None
        
        if is_spcs:
            snowflake_host = settings.snowflake_host
            token = get_login_token()
            auth_token_type = "OAUTH"
        else:
            config_path = os.path.expanduser('~/.snowflake/config.toml')
            config = toml.load(config_path)
            conn_config = config['connections'][settings.snowflake_connection_name]
            token = conn_config['password']
            account = conn_config['account']
            snowflake_host = f"{account.lower()}.snowflakecomputing.com"
            auth_token_type = "PROGRAMMATIC_ACCESS_TOKEN"
        
        thread_url = f"https://{snowflake_host}/api/v2/cortex/threads"
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Snowflake-Authorization-Token-Type": auth_token_type
        }
        
        payload = {"origin_application": "flux_ops_center"}
        
        print("Creating new thread...")
        async with httpx.AsyncClient() as client:
            response = await client.post(thread_url, json=payload, headers=headers, timeout=30.0)
        
        if response.status_code != 200:
            print(f"Thread creation failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=response.status_code, detail=f'Failed to create thread: {response.text}')
        
        response_data = response.json()
        print(f"Thread API response: {response_data}")
        
        if isinstance(response_data, dict):
            thread_id = response_data.get('thread_id') or response_data.get('id')
        else:
            thread_id = response_data
        
        if thread_id is None:
            print(f"No thread_id in response: {response_data}")
            raise HTTPException(status_code=500, detail='Thread creation response missing thread_id')
        
        thread_id = int(thread_id)
        print(f"Thread created: {thread_id}")
        
        return {"thread_id": thread_id}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Thread creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agent/stream", tags=["Cortex Agent"])
async def agent_stream(request: Request):
    import requests as sync_requests
    import queue
    import threading
    
    try:
        data = await request.json()
        user_query = data.get('query', '')
        thread_id = data.get('thread_id')
        parent_message_id = data.get('parent_message_id', 0)
        
        if not user_query:
            raise HTTPException(status_code=400, detail='Missing query parameter')
        
        print(f"Agent request: thread_id={thread_id}, parent_message_id={parent_message_id}, query={user_query[:60]}...")
        
        is_spcs = get_login_token() is not None and settings.snowflake_host is not None
        
        if is_spcs:
            snowflake_host = settings.snowflake_host
            token = get_login_token()
            auth_token_type = "OAUTH"
            print("SPCS mode: Using OAuth token")
        else:
            print("Local dev mode: Reading PAT from connection config")
            config_path = os.path.expanduser('~/.snowflake/config.toml')
            config = toml.load(config_path)
            conn_config = config['connections'][settings.snowflake_connection_name]
            token = conn_config['password']
            account = conn_config['account']
            snowflake_host = f"{account.lower()}.snowflakecomputing.com"
            auth_token_type = "PROGRAMMATIC_ACCESS_TOKEN"
        
        agent_url = (
            f"https://{snowflake_host}"
            f"/api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS"
            f"/agents/CENTERPOINT_ENERGY_AGENT:run"
        )
        
        payload = {
            "messages": [{
                "role": "user",
                "content": [{"type": "text", "text": user_query}]
            }],
            "tool_choice": {"type": "auto"}
        }
        
        if thread_id is not None:
            payload["thread_id"] = thread_id
            payload["parent_message_id"] = parent_message_id
            print(f"Continuing thread {thread_id} from message {parent_message_id}")
        else:
            payload["parent_message_id"] = 0
            print("Starting new conversation")
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Snowflake-Authorization-Token-Type": auth_token_type
        }
        
        print(f"Streaming request to agent: {user_query[:100]}...")
        
        line_queue: queue.Queue = queue.Queue()
        
        def stream_from_agent():
            try:
                with sync_requests.post(agent_url, json=payload, headers=headers, stream=True, timeout=300) as r:
                    print(f"Response status: {r.status_code}")
                    
                    if r.status_code != 200:
                        error_body = r.text[:500] if r.text else "No response body"
                        print(f"Agent API error {r.status_code}: {error_body}")
                        line_queue.put(f"event: error\ndata: {{\"error\": \"Agent API returned status {r.status_code}: {error_body}\"}}\n\n")
                        line_queue.put(None)
                        return
                    
                    print("Starting SSE stream...")
                    line_count = 0
                    buffer = b''
                    
                    for chunk in r.iter_content(chunk_size=None, decode_unicode=False):
                        if chunk:
                            buffer += chunk
                            while b'\n' in buffer:
                                line_bytes, buffer = buffer.split(b'\n', 1)
                                line = line_bytes.decode('utf-8', errors='replace')
                                line_count += 1
                                if line_count % 50 == 0:
                                    print(f"Streamed {line_count} lines...")
                                # Debug: Log events containing tool_result, table, or json
                                if 'tool_result' in line.lower() or 'response.table' in line.lower():
                                    print(f"🔍 DEBUG SSE: {line[:500]}")
                                if line.startswith('data:') and ('sql' in line.lower() or 'results' in line.lower()):
                                    print(f"📊 DEBUG DATA: {line[:500]}")
                                line_queue.put(line + '\n')
                    
                    if buffer:
                        line = buffer.decode('utf-8', errors='replace')
                        line_queue.put(line + '\n')
                    
                    print(f"Stream complete. Total lines: {line_count}")
                    
            except sync_requests.exceptions.Timeout:
                print("Request timed out after 300 seconds")
                line_queue.put("event: error\ndata: {\"error\": \"Request timed out\"}\n\n")
            except Exception as e:
                print(f"SSE streaming error: {e}")
                line_queue.put(f"event: error\ndata: {{\"error\": \"{str(e)}\"}}\n\n")
            finally:
                line_queue.put(None)
        
        thread = threading.Thread(target=stream_from_agent, daemon=True)
        thread.start()
        
        async def generate():
            while True:
                try:
                    line = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: line_queue.get(timeout=1.0)
                    )
                    if line is None:
                        break
                    yield line
                except queue.Empty:
                    if not thread.is_alive():
                        break
                    continue
        
        return StreamingResponse(
            generate(),
            media_type='text/event-stream',
            headers={
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Accel-Buffering': 'no',
                'Connection': 'keep-alive',
                'Content-Encoding': 'identity',
                'X-Content-Type-Options': 'nosniff'
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Agent stream endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agent/threads/{thread_id}/history", tags=["Cortex Agent"])
async def get_thread_history(thread_id: int):
    return {
        'thread_id': thread_id,
        'messages': []
    }


class FeedbackRequest(BaseModel):
    request_id: str
    positive: bool
    feedback_message: Optional[str] = None
    thread_id: Optional[int] = None


@app.post("/api/agent/feedback", tags=["Cortex Agent"])
async def submit_feedback(feedback: FeedbackRequest):
    """
    Submit feedback (thumbs up/down) for a Cortex Agent response.
    
    Per Snowflake docs: POST /api/v2/databases/{db}/schemas/{schema}/agents/{name}:feedback
    """
    try:
        is_spcs = get_login_token() is not None and settings.snowflake_host is not None
        
        if is_spcs:
            snowflake_host = settings.snowflake_host
            token = get_login_token()
            auth_token_type = "OAUTH"
        else:
            config_path = os.path.expanduser('~/.snowflake/config.toml')
            config = toml.load(config_path)
            conn_config = config['connections'][settings.snowflake_connection_name]
            token = conn_config['password']
            account = conn_config['account']
            snowflake_host = f"{account.lower()}.snowflakecomputing.com"
            auth_token_type = "PROGRAMMATIC_ACCESS_TOKEN"
        
        feedback_url = (
            f"https://{snowflake_host}"
            f"/api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS"
            f"/agents/CENTERPOINT_ENERGY_AGENT:feedback"
        )
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Snowflake-Authorization-Token-Type": auth_token_type
        }
        
        payload = {
            "request_id": feedback.request_id,
            "positive": feedback.positive
        }
        
        if feedback.feedback_message:
            payload["feedback_message"] = feedback.feedback_message
        
        if feedback.thread_id is not None:
            payload["thread_id"] = feedback.thread_id
        
        print(f"Submitting feedback: request_id={feedback.request_id}, positive={feedback.positive}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(feedback_url, json=payload, headers=headers, timeout=30.0)
        
        if response.status_code != 200:
            print(f"Feedback submission failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=response.status_code, detail=f'Failed to submit feedback: {response.text}')
        
        print(f"Feedback submitted successfully for request_id={feedback.request_id}")
        return {"status": "success", "request_id": feedback.request_id}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Feedback submission error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == '__main__':
    import uvicorn
    print("Starting FastAPI backend server on port 3001...")
    if get_login_token() and settings.snowflake_host:
        print(f"SPCS mode - OAuth token authentication")
        print(f"Host: {settings.snowflake_host}")
    else:
        print(f"Local dev mode - Connection: {settings.snowflake_connection_name}")
    uvicorn.run(app, host='0.0.0.0', port=3001)
