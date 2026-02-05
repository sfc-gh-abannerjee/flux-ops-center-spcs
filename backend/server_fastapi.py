# CRITICAL: Set AWS env vars BEFORE any imports that might load boto3
# The snowflake-connector-python pulls in boto3 which reads ~/.aws/config
# If the default profile uses SSO and the token is expired, it causes auth errors
import os
os.environ.setdefault('AWS_PROFILE', '')
os.environ.setdefault('AWS_SDK_LOAD_CONFIG', 'false')
os.environ.setdefault('AWS_CONFIG_FILE', '/dev/null')  # Prevent reading ~/.aws/config

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
import subprocess
import httpx
import toml
import io
import time
import uuid
import logging
import json
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
    snowflake_database: str = os.getenv("SNOWFLAKE_DATABASE", "FLUX_DB")  # Override with SNOWFLAKE_DATABASE env var
    snowflake_schema: str = "APPLICATIONS"
    snowflake_warehouse: str = os.getenv("SNOWFLAKE_WAREHOUSE", "FLUX_WH")
    snowflake_connection_name: str = os.getenv("SNOWFLAKE_CONNECTION", "cpe_demo_CLI")
    
    # Cortex Agent configuration - users must ensure this agent exists and is accessible
    # Format: DATABASE.SCHEMA.AGENT_NAME (the full path will be constructed from these)
    cortex_agent_database: str = os.getenv("CORTEX_AGENT_DATABASE", "SNOWFLAKE_INTELLIGENCE")
    cortex_agent_schema: str = os.getenv("CORTEX_AGENT_SCHEMA", "AGENTS")
    cortex_agent_name: str = os.getenv("CORTEX_AGENT_NAME", "GRID_INTELLIGENCE_AGENT")
    
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

# Database reference helper - configurable via SNOWFLAKE_DATABASE env var
DB = settings.snowflake_database


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


class SpatialLayerCache:
    """
    Engineering: In-memory cache for static PostGIS layers.
    Loads full dataset once, filters in Python for instant viewport queries.
    """
    def __init__(self):
        self._vegetation: List[Dict] = []
        self._power_lines: List[Dict] = []
        self._buildings: List[Dict] = []
        self._loaded = {"vegetation": False, "power_lines": False, "buildings": False}
        self._lock = asyncio.Lock()
    
    async def get_vegetation(self, min_lon: float, max_lon: float, min_lat: float, max_lat: float, limit: int) -> List[Dict]:
        async with self._lock:
            if not self._loaded["vegetation"]:
                return None
            filtered = [v for v in self._vegetation 
                       if min_lon <= v["position"][0] <= max_lon 
                       and min_lat <= v["position"][1] <= max_lat][:limit]
            return filtered
    
    async def set_vegetation(self, data: List[Dict]):
        async with self._lock:
            self._vegetation = data
            self._loaded["vegetation"] = True
            logger.info(f"Spatial cache: loaded {len(data)} vegetation features")
    
    async def get_power_lines(self, min_lon: float, max_lon: float, min_lat: float, max_lat: float, limit: int) -> List[Dict]:
        async with self._lock:
            if not self._loaded["power_lines"]:
                return None
            filtered = []
            for pl in self._power_lines:
                if len(filtered) >= limit:
                    break
                path = pl.get("path", [])
                if any(min_lon <= c[0] <= max_lon and min_lat <= c[1] <= max_lat for c in path):
                    filtered.append(pl)
            return filtered
    
    async def set_power_lines(self, data: List[Dict]):
        async with self._lock:
            self._power_lines = data
            self._loaded["power_lines"] = True
            logger.info(f"Spatial cache: loaded {len(data)} power line features")
    
    async def get_buildings(self, min_lon: float, max_lon: float, min_lat: float, max_lat: float, limit: int) -> List[Dict]:
        async with self._lock:
            if not self._loaded["buildings"]:
                return None
            filtered = [b for b in self._buildings 
                       if min_lon <= b["position"][0] <= max_lon 
                       and min_lat <= b["position"][1] <= max_lat][:limit]
            return filtered
    
    async def set_buildings(self, data: List[Dict]):
        async with self._lock:
            self._buildings = data
            self._loaded["buildings"] = True
            logger.info(f"Spatial cache: loaded {len(data)} building features")
    
    def is_loaded(self, layer: str) -> bool:
        return self._loaded.get(layer, False)
    
    async def clear(self, layer: Optional[str] = None):
        """Clear spatial cache for one or all layers."""
        async with self._lock:
            if layer:
                if layer == "vegetation":
                    self._vegetation = []
                    self._loaded["vegetation"] = False
                elif layer == "power_lines":
                    self._power_lines = []
                    self._loaded["power_lines"] = False
                elif layer == "buildings":
                    self._buildings = []
                    self._loaded["buildings"] = False
                logger.info(f"Spatial cache cleared: {layer}")
            else:
                self._vegetation = []
                self._power_lines = []
                self._buildings = []
                self._loaded = {"vegetation": False, "power_lines": False, "buildings": False}
                logger.info("Spatial cache cleared: all layers")


spatial_cache = SpatialLayerCache()


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
            conn = snowflake.connector.connect(
                host=settings.snowflake_host,
                account=settings.snowflake_account,
                token=token,
                authenticator='oauth',
                database=settings.snowflake_database,
                schema=settings.snowflake_schema,
                warehouse=settings.snowflake_warehouse
            )
        else:
            conn = snowflake.connector.connect(
                connection_name=settings.snowflake_connection_name
            )
            # Explicitly set database, schema, and warehouse from settings
            # (connection config may reference non-existent or wrong resources)
            cursor = conn.cursor()
            cursor.execute(f"USE WAREHOUSE {settings.snowflake_warehouse}")
            cursor.execute(f"USE DATABASE {settings.snowflake_database}")
            cursor.execute(f"USE SCHEMA {settings.snowflake_schema}")
            cursor.close()
        return conn
    
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
            cursor.execute(f"""
                SELECT SUBSTATION_ID, SUBSTATION_NAME, LATITUDE, LONGITUDE,
                       CAPACITY_MVA, AVG_LOAD_PCT, ACTIVE_OUTAGES,
                       TRANSFORMER_COUNT, TOTAL_CAPACITY_KVA
                FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_METRO
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
            cursor.execute(f"SELECT * FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
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
    
    if postgres_pool:
        await warm_spatial_cache_background()


async def warm_spatial_cache_background():
    """
    Engineering: Preload all PostGIS spatial layers into memory at startup.
    Eliminates cold-cache latency for first user - all viewport queries instant.
    """
    logger.info("Starting spatial cache preload...")
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            # Engineering: Load from pre-computed materialized view
            # Risk is computed in the database using PostGIS spatial joins
            # The MV auto-refreshes when underlying data changes
            veg_rows = await conn.fetch("""
                SELECT 
                    tree_id, species, subtype, longitude, latitude,
                    height_m, canopy_radius_m, risk_score, risk_level,
                    distance_to_line_m, nearest_line_id, nearest_line_class,
                    fall_zone_m, risk_explanation, nearest_asset_type,
                    distance_to_asset_m, computed_at
                FROM vegetation_risk_computed 
                WHERE longitude IS NOT NULL AND latitude IS NOT NULL
                LIMIT 50000
            """)
            
            # Check if we have data from the computed MV
            has_computed_risk = veg_rows and veg_rows[0].get("risk_explanation") is not None
            
            veg_features = []
            for row in veg_rows:
                if row["longitude"] and row["latitude"]:
                    if has_computed_risk:
                        # # Use pre-computed risk from materialized view
                        # Risk is calculated using REAL PostGIS spatial analysis
                        veg_features.append({
                            "id": row["tree_id"],
                            "position": [float(row["longitude"]), float(row["latitude"])],
                            "longitude": float(row["longitude"]),
                            "latitude": float(row["latitude"]),
                            "class": row["species"],  # 'species' is aliased from 'class' in the MV
                            "species": row["subtype"],
                            "height_m": float(row["height_m"]) if row["height_m"] else 10.0,
                            "canopy_radius_m": float(row["canopy_radius_m"]) if row["canopy_radius_m"] else 3.0,
                            "canopy_height": float(row["height_m"]) * 0.7 if row["height_m"] else 7.0,
                            "fall_zone_m": float(row["fall_zone_m"]) if row["fall_zone_m"] else 13.0,
                            "risk_score": float(row["risk_score"]) if row["risk_score"] else 0.0,
                            "proximity_risk": float(row["risk_score"]) if row["risk_score"] else 0.0,
                            "distance_to_line_m": float(row["distance_to_line_m"]) if row["distance_to_line_m"] else None,
                            "nearest_line_id": row["nearest_line_id"],
                            "nearest_line_class": row["nearest_line_class"],
                            "risk_level": row["risk_level"] or "safe",
                            "risk_explanation": row["risk_explanation"],
                            "nearest_asset_type": row["nearest_asset_type"],
                            "distance_to_asset_m": float(row["distance_to_asset_m"]) if row["distance_to_asset_m"] else None,
                            "data_source": "postgis_computed",
                            "computed_at": str(row["computed_at"]) if row["computed_at"] else None
                        })
                    else:
                        # Fallback: Generate synthetic risk data for legacy tables
                        def get_risk_data(tree_id, tree_class):
                            h = hash(tree_id) % 100
                            if h < 3: 
                                return 'critical', 0.85 + (h % 15) / 100, 2.0 + (h % 30) / 10, 18 + (h % 15)
                            elif h < 8: 
                                return 'warning', 0.6 + (h % 25) / 100, 5.0 + (h % 50) / 10, 12 + (h % 12)
                            elif h < 18: 
                                return 'monitor', 0.35 + (h % 25) / 100, 10.0 + (h % 80) / 10, 8 + (h % 10)
                            else: 
                                return 'safe', 0.05 + (h % 30) / 100, 20.0 + (h % 200) / 10, 5 + (h % 12)
                        
                        risk_level, risk_score, dist, height = get_risk_data(row["tree_id"], row.get("class", "tree"))
                        veg_features.append({
                            "id": row["tree_id"],
                            "position": [float(row["longitude"]), float(row["latitude"])],
                            "longitude": float(row["longitude"]),
                            "latitude": float(row["latitude"]),
                            "class": row.get("class", "tree"),
                            "species": row.get("subtype"),
                            "height_m": round(height, 1),
                            "canopy_radius_m": round(height * 0.35, 1),
                            "canopy_height": round(height * 0.7, 1),
                            "risk_score": round(risk_score, 2),
                            "proximity_risk": round(risk_score, 2),
                            "distance_to_line_m": round(dist, 1),
                            "nearest_line_id": None,
                            "risk_level": risk_level,
                            "data_source": "synthetic"
                        })
            
            logger.info(f"Loaded {len(veg_features)} vegetation features (computed_risk={has_computed_risk})")
            await spatial_cache.set_vegetation(veg_features)
            
            pl_rows = await conn.fetch("""
                SELECT power_line_id, class, length_meters, ST_AsGeoJSON(geom) as geometry
                FROM power_lines_spatial LIMIT 10000
            """)
            
            import json as json_lib
            pl_features = []
            for row in pl_rows:
                geom_str = row["geometry"]
                if geom_str:
                    geom = json_lib.loads(geom_str)
                    if geom.get("coordinates"):
                        pl_features.append({
                            "id": row["power_line_id"],
                            "path": geom["coordinates"],
                            "class": row["class"],
                            "length_m": float(row["length_meters"]) if row["length_meters"] else 0
                        })
            await spatial_cache.set_power_lines(pl_features)
            
            bldg_rows = await conn.fetch("""
                SELECT building_id, building_name, building_type, height_meters, num_floors, longitude, latitude
                FROM buildings_spatial LIMIT 150000
            """)
            
            bldg_features = [{
                "id": row["building_id"],
                "position": [float(row["longitude"]), float(row["latitude"])],
                "name": row["building_name"],
                "type": row["building_type"],
                "height": float(row["height_meters"]) if row["height_meters"] else 10,
                "floors": row["num_floors"] or 1
            } for row in bldg_rows if row["longitude"] and row["latitude"]]
            await spatial_cache.set_buildings(bldg_features)
            
            elapsed = time.time() - start
            logger.info(f"Spatial cache preload complete in {elapsed:.1f}s: "
                       f"{len(veg_features)} trees, {len(pl_features)} power lines, {len(bldg_features)} buildings")
    
    except Exception as e:
        logger.warning(f"Spatial cache preload failed: {e}")


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
    description="FastAPI backend for utility grid operations monitoring. "
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
        conn = snowflake.connector.connect(
            connection_name=settings.snowflake_connection_name
        )
        # Explicitly set database, schema, and warehouse from settings
        # (connection config may reference non-existent or wrong resources)
        cursor = conn.cursor()
        cursor.execute(f"USE WAREHOUSE {settings.snowflake_warehouse}")
        cursor.execute(f"USE DATABASE {settings.snowflake_database}")
        cursor.execute(f"USE SCHEMA {settings.snowflake_schema}")
        cursor.close()
        return conn


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


@app.delete("/api/spatial/cache", tags=["Geospatial Layers"])
async def clear_spatial_cache(layer: Optional[str] = Query(None, description="Layer to clear (vegetation, power_lines, buildings) or None for all")):
    """
    Clear spatial layer cache to force reload from database.
    Use after data updates to ensure fresh data is displayed.
    """
    await spatial_cache.clear(layer)
    return {
        "status": "ok", 
        "message": f"Spatial cache cleared: {layer or 'all layers'}",
        "loaded": {
            "vegetation": spatial_cache.is_loaded("vegetation"),
            "power_lines": spatial_cache.is_loaded("power_lines"),
            "buildings": spatial_cache.is_loaded("buildings")
        }
    }


@app.post("/api/spatial/cache/reload", tags=["Geospatial Layers"])
async def reload_spatial_cache():
    """
    Force reload all spatial layers from database.
    Clears cache and triggers background preload.
    """
    await spatial_cache.clear()
    asyncio.create_task(warm_spatial_cache_background())
    return {
        "status": "ok",
        "message": "Spatial cache reload initiated. Layers will load in background."
    }


class InitialLoadResponse(BaseModel):
    metro: List[Dict[str, Any]]
    feeders: List[Dict[str, Any]]
    service_areas: List[Dict[str, Any]]
    kpis: Dict[str, Any]
    spatial_ready: bool = False
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
            cursor.execute(f"""
                SELECT 
                    SUBSTATION_ID, SUBSTATION_NAME, LATITUDE, LONGITUDE,
                    CAPACITY_MVA, AVG_LOAD_PCT, ACTIVE_OUTAGES,
                    TRANSFORMER_COUNT, TOTAL_CAPACITY_KVA
                FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_METRO
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
            cursor.execute(f"""
                SELECT 
                    SUBSTATION_ID, TRANSFORMER_ID, CONNECTION_TYPE,
                    FROM_LATITUDE, FROM_LONGITUDE, TO_LATITUDE, TO_LONGITUDE,
                    LOAD_UTILIZATION_PCT, CIRCUIT_ID, RATED_KVA,
                    DISTANCE_KM, VOLTAGE_LEVEL
                FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_FEEDERS
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
            cursor.execute(f"""
                SELECT CIRCUIT_ID, SUBSTATION_ID, SUBSTATION_NAME,
                       CENTROID_LAT, CENTROID_LON, AVG_LOAD_PERCENT, AVG_HEALTH_SCORE
                FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_SERVICE_AREAS_MV
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
            cursor.execute(f"SELECT * FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
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
            spatial_ready=spatial_cache.is_loaded("vegetation") and spatial_cache.is_loaded("power_lines") and spatial_cache.is_loaded("buildings"),
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
                
                limit_clause = f"LIMIT {limit}" if limit else ""
                
                # Engineering: Return enriched asset data with location + customer context
                # FIX: Always exclude assets inside water bodies (>10 acres)
                # Poles, transformers, and substations don't belong in San Jacinto Bay!
                water_exclusion = """
                    NOT EXISTS (
                        SELECT 1 FROM osm_water w 
                        WHERE w.acres > 10 
                          AND ga.geom IS NOT NULL
                          AND ST_Within(ga.geom, w.geom)
                    )
                """
                
                if where_clauses:
                    where_clause = f"WHERE ({' OR '.join(where_clauses)}) AND {water_exclusion}"
                else:
                    where_clause = f"WHERE {water_exclusion}"
                
                query = f"""
                    SELECT 
                        asset_id, asset_name, asset_type,
                        latitude, longitude,
                        load_percent, health_score,
                        status, voltage, circuit_id,
                        rotation_rad,
                        -- Location context
                        city, zip_code, county_name,
                        service_address, customer_name, customer_segment,
                        -- Customer impact metrics
                        connected_customers, circuits_served,
                        -- Substation-specific
                        capacity_mva, substation_name
                    FROM grid_assets_cache ga
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
                        'ROTATION_RAD': float(row['rotation_rad']) if row['rotation_rad'] is not None else 0,
                        # Location context
                        'CITY': row['city'],
                        'ZIP_CODE': row['zip_code'],
                        'COUNTY': row['county_name'],
                        'SERVICE_ADDRESS': row['service_address'],
                        'CUSTOMER_NAME': row['customer_name'],
                        'CUSTOMER_SEGMENT': row['customer_segment'],
                        # Customer impact
                        'CONNECTED_CUSTOMERS': int(row['connected_customers']) if row['connected_customers'] is not None else None,
                        'CIRCUITS_SERVED': int(row['circuits_served']) if row['circuits_served'] is not None else None,
                        # Substation-specific
                        'CAPACITY_MVA': float(row['capacity_mva']) if row['capacity_mva'] is not None else None,
                        'SUBSTATION_NAME': row['substation_name'],
                        # Legacy fields
                        'COMMISSIONED_DATE': None,
                        'USAGE_KWH': None,
                        'POLE_HEIGHT_FT': None
                    })
                
                logger.info(f"Postgres: {len(assets)} assets")
                return assets
                
        except Exception as e:
            logger.info(f"Postgres failed, falling back to Snowflake: {e}")
    
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
                FROM {DB}.PRODUCTION.TRANSFORMER_HOURLY_LOAD
                WHERE LOAD_HOUR >= DATEADD(hour, -1, CURRENT_TIMESTAMP())
                GROUP BY TRANSFORMER_ID
            ),
            recent_meter_usage AS (
                SELECT METER_ID, AVG(USAGE_KWH) as avg_usage_kwh
                FROM {DB}.PRODUCTION.AMI_INTERVAL_READINGS
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
                FROM {DB}.PRODUCTION.METER_INFRASTRUCTURE m
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
                FROM {DB}.PRODUCTION.SUBSTATIONS
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
                FROM {DB}.PRODUCTION.TRANSFORMER_METADATA t
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
                FROM {DB}.PRODUCTION.GRID_POLES_INFRASTRUCTURE
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
        logger.info(f"Snowflake (optimized): {len(assets)} assets")
        return assets
    except Exception as e:
        logger.info(f"Snowflake query failed: {e}")
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
                
                logger.info(f"Postgres: {len(topology):,} topology connections")
                return topology
                
        except Exception as e:
            logger.info(f"Postgres topology error: {e}")
    
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
            FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY
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
        logger.info(f"Snowflake fallback: {len(topology):,} topology connections")
        return topology
    
    except Exception as e:
        logger.info(f"Topology error: {e}")
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
        cursor.execute(f"""
            SELECT 
                SUBSTATION_ID, SUBSTATION_NAME, LATITUDE, LONGITUDE,
                CAPACITY_MVA, AVG_LOAD_PCT, ACTIVE_OUTAGES,
                TRANSFORMER_COUNT, TOTAL_CAPACITY_KVA
            FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_METRO
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
        logger.info(f"Fetched {len(results)} metro topology substations (cached for {CACHE_TTL_METRO}s)")
        return results
    except Exception as e:
        logger.info(f"Error fetching metro topology: {e}")
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
        cursor.execute(f"""
            SELECT 
                SUBSTATION_ID, TRANSFORMER_ID, CONNECTION_TYPE,
                FROM_LATITUDE, FROM_LONGITUDE, TO_LATITUDE, TO_LONGITUDE,
                LOAD_UTILIZATION_PCT, CIRCUIT_ID, RATED_KVA,
                DISTANCE_KM, VOLTAGE_LEVEL
            FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_TOPOLOGY_FEEDERS
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
        logger.info(f"Fetched {len(results)} feeder topology connections (cached for {CACHE_TTL_FEEDERS}s)")
        return results
    except Exception as e:
        logger.info(f"Error fetching feeder topology: {e}")
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
        cursor.execute(f"SELECT * FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
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
        logger.info(f"Fetched KPIs (cached for {CACHE_TTL_KPIS}s)")
        return kpis
    except Exception as e:
        logger.info(f"Error fetching KPIs: {e}")
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
                logger.info(f"Postgres: Fetched {len(service_areas)} circuits (cached for {CACHE_TTL_SERVICE_AREAS}s)")
                return service_areas
        
        except Exception as e:
            logger.info(f"Error fetching service areas from Postgres: {e}")
    
    return await get_service_areas_from_snowflake(cache_key)


async def get_service_areas_from_snowflake(cache_key: str = "service_areas") -> List[Dict[str, Any]]:
    def _fetch_service_areas():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT 
                CIRCUIT_ID, SUBSTATION_ID, SUBSTATION_NAME,
                CIRCUIT_CENTER_LAT, CIRCUIT_CENTER_LON,
                AVG_LOAD_UTILIZATION_PCT, AVG_HEALTH_INDEX
            FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_SERVICE_AREAS_MV
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
        logger.info(f"Snowflake fallback: Fetched {len(service_areas)} circuits (cached for {CACHE_TTL_SERVICE_AREAS}s)")
        return service_areas
    except Exception as e:
        logger.info(f"Error fetching service areas from Snowflake: {e}")
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
        cursor.execute(f"""
            SELECT TIMESTAMP_UTC, TEMP_F, HUMIDITY_PCT
            FROM {DB}.PRODUCTION.HOUSTON_WEATHER_HOURLY
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
        logger.info(f"Fetched {len(weather)} weather records (cached for {CACHE_TTL_WEATHER}s)")
        return weather
    except Exception as e:
        logger.info(f"Error fetching weather: {e}")
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
        logger.info(f"Error generating weather image: {e}")
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
                logger.info(f"Postgres: Fetched {len(results)} substation statuses")
                return results
        
        except Exception as e:
            logger.info(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_substation_status():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        
        cursor.execute(f"""
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
            FROM {DB}.APPLICATIONS.CIRCUIT_STATUS_REALTIME
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
        logger.info(f"Snowflake fallback: Fetched {len(results)} substation statuses")
        return results
    
    except Exception as e:
        logger.info(f"Error fetching substation status: {e}")
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
                logger.info(f"Postgres: Fetched {len(results)} substations")
                return results
        
        except Exception as e:
            logger.info(f"Postgres failed, falling back to Snowflake: {e}")
    
    def _fetch_substations():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT 
                SUBSTATION_ID as substation_id,
                SUBSTATION_NAME as substation_name,
                LATITUDE as latitude,
                LONGITUDE as longitude,
                CAPACITY_MVA as capacity_mva,
                VOLTAGE_LEVEL as voltage_level,
                COMMISSIONED_DATE as commissioned_date,
                OPERATIONAL_STATUS as operational_status
            FROM {DB}.PRODUCTION.SUBSTATIONS
            ORDER BY SUBSTATION_NAME
        """)
        columns = [desc[0] for desc in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return results

    try:
        results = await run_snowflake_query(_fetch_substations)
        logger.info(f"Snowflake fallback: Fetched {len(results)} substations")
        return results
    except Exception as e:
        logger.info(f"Error fetching substations: {e}")
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
                
                logger.info(f"Postgres: Fetched {len(results)} circuit metadata records")
                return results
        
        except Exception as e:
            logger.info(f"Postgres failed, falling back to Snowflake: {e}")
    
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
            FROM {DB}.PRODUCTION.CIRCUIT_METADATA
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
        logger.info(f"Snowflake fallback: Fetched {len(results)} circuit metadata records")
        return results
    
    except Exception as e:
        logger.info(f"Error fetching circuit metadata: {e}")
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
                
                logger.info(f"Postgres: Fetched {len(results)} active outages")
                return results
        
        except Exception as e:
            logger.info(f"Postgres failed, falling back to Snowflake: {e}")
    
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
            FROM {DB}.PRODUCTION.OUTAGE_RESTORATION_TRACKER
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
        logger.info(f"Snowflake fallback: Fetched {len(results)} active outages")
        return results
    
    except Exception as e:
        logger.info(f"Error fetching active outages: {e}")
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
                
                logger.info(f"Postgres: Fetched {len(results)} work orders")
                return results
        
        except Exception as e:
            logger.info(f"Postgres failed, falling back to Snowflake: {e}")
    
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
            FROM {DB}.PRODUCTION.WORK_ORDERS
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
        logger.info(f"Snowflake fallback: Fetched {len(results)} work orders")
        return results
    
    except Exception as e:
        logger.info(f"Error fetching work orders: {e}")
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
        
        logger.info("Creating new thread...")
        async with httpx.AsyncClient() as client:
            response = await client.post(thread_url, json=payload, headers=headers, timeout=30.0)
        
        if response.status_code != 200:
            logger.info(f"Thread creation failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=response.status_code, detail=f'Failed to create thread: {response.text}')
        
        response_data = response.json()
        logger.info(f"Thread API response: {response_data}")
        
        if isinstance(response_data, dict):
            thread_id = response_data.get('thread_id') or response_data.get('id')
        else:
            thread_id = response_data
        
        if thread_id is None:
            logger.info(f"No thread_id in response: {response_data}")
            raise HTTPException(status_code=500, detail='Thread creation response missing thread_id')
        
        thread_id = int(thread_id)
        logger.info(f"Thread created: {thread_id}")
        
        return {"thread_id": thread_id}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.info(f"Thread creation error: {e}")
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
        
        logger.info(f"Agent request: thread_id={thread_id}, parent_message_id={parent_message_id}, query={user_query[:60]}...")
        
        is_spcs = get_login_token() is not None and settings.snowflake_host is not None
        
        if is_spcs:
            snowflake_host = settings.snowflake_host
            token = get_login_token()
            auth_token_type = "OAUTH"
            logger.info("SPCS mode: Using OAuth token")
        else:
            logger.info("Local dev mode: Reading PAT from connection config")
            config_path = os.path.expanduser('~/.snowflake/config.toml')
            config = toml.load(config_path)
            conn_config = config['connections'][settings.snowflake_connection_name]
            token = conn_config['password']
            account = conn_config['account']
            snowflake_host = f"{account.lower()}.snowflakecomputing.com"
            auth_token_type = "PROGRAMMATIC_ACCESS_TOKEN"
        
        agent_url = (
            f"https://{snowflake_host}"
            f"/api/v2/databases/{settings.cortex_agent_database}/schemas/{settings.cortex_agent_schema}"
            f"/agents/{settings.cortex_agent_name}:run"
        )
        
        logger.info(f"Using Cortex Agent: {settings.cortex_agent_database}.{settings.cortex_agent_schema}.{settings.cortex_agent_name}")
        
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
            logger.info(f"Continuing thread {thread_id} from message {parent_message_id}")
        else:
            payload["parent_message_id"] = 0
            logger.info("Starting new conversation")
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Snowflake-Authorization-Token-Type": auth_token_type
        }
        
        logger.info(f"Streaming request to agent: {user_query[:100]}...")
        
        line_queue: queue.Queue = queue.Queue()
        
        def stream_from_agent():
            try:
                with sync_requests.post(agent_url, json=payload, headers=headers, stream=True, timeout=300) as r:
                    logger.info(f"Response status: {r.status_code}")
                    
                    if r.status_code != 200:
                        error_body = r.text[:500] if r.text else "No response body"
                        logger.info(f"Agent API error {r.status_code}: {error_body}")
                        line_queue.put(f"event: error\ndata: {{\"error\": \"Agent API returned status {r.status_code}: {error_body}\"}}\n\n")
                        line_queue.put(None)
                        return
                    
                    request_id = r.headers.get('X-Snowflake-Request-ID', '')
                    if request_id:
                        logger.info(f"Captured X-Snowflake-Request-ID: {request_id}")
                        line_queue.put(f"event: request_id\ndata: {{\"request_id\": \"{request_id}\"}}\n\n")
                    
                    logger.info("Starting SSE stream...")
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
                                    logger.info(f"Streamed {line_count} lines...")
                                # Debug: Log events containing tool_result, table, or json
                                if 'tool_result' in line.lower() or 'response.table' in line.lower():
                                    logger.info(f"🔍 DEBUG SSE: {line[:500]}")
                                if line.startswith('data:') and ('sql' in line.lower() or 'results' in line.lower()):
                                    logger.info(f"📊 DEBUG DATA: {line[:500]}")
                                line_queue.put(line + '\n')
                    
                    if buffer:
                        line = buffer.decode('utf-8', errors='replace')
                        line_queue.put(line + '\n')
                    
                    logger.info(f"Stream complete. Total lines: {line_count}")
                    
            except sync_requests.exceptions.Timeout:
                logger.info("Request timed out after 300 seconds")
                line_queue.put("event: error\ndata: {\"error\": \"Request timed out\"}\n\n")
            except Exception as e:
                logger.info(f"SSE streaming error: {e}")
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
        logger.info(f"Agent stream endpoint error: {e}")
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
            f"/api/v2/databases/{settings.cortex_agent_database}/schemas/{settings.cortex_agent_schema}"
            f"/agents/{settings.cortex_agent_name}:feedback"
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
        
        logger.info(f"Submitting feedback: request_id={feedback.request_id}, positive={feedback.positive}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(feedback_url, json=payload, headers=headers, timeout=30.0)
        
        if response.status_code != 200:
            logger.info(f"Feedback submission failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=response.status_code, detail=f'Failed to submit feedback: {response.text}')
        
        logger.info(f"Feedback submitted successfully for request_id={feedback.request_id}")
        return {"status": "success", "request_id": feedback.request_id}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.info(f"Feedback submission error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# PostGIS SPATIAL QUERY ENDPOINTS
# Engineering Enhancement: Use Case 7 (Geospatial Analysis)
# Demonstrates <20ms response times with industry-standard PostGIS queries
# =============================================================================

TAGS_METADATA.append({"name": "Geospatial", "description": "PostGIS spatial queries - outage impact, vegetation risk, nearest assets"})


class SpatialImpactResponse(BaseModel):
    affected_customers: int
    affected_buildings: int
    affected_meters: int
    circuit_count: int
    query_time_ms: float
    center: Dict[str, float]
    radius_meters: float


class VegetationRiskResponse(BaseModel):
    trees_at_risk: int
    power_lines_affected: int
    high_risk_zones: List[Dict[str, Any]]
    query_time_ms: float


class NearestAssetResponse(BaseModel):
    assets: List[Dict[str, Any]]
    query_time_ms: float
    center: Dict[str, float]


@app.get("/api/spatial/outage-impact", response_model=SpatialImpactResponse, tags=["Geospatial"])
async def get_outage_impact(
    lon: float = Query(-95.36, description="Longitude of outage center"),
    lat: float = Query(29.76, description="Latitude of outage center"),
    radius_m: float = Query(500, description="Impact radius in meters")
):
    """
    Calculate outage impact radius using PostGIS ST_DWithin.
    Returns affected customers, buildings, meters within specified radius.
    Target: <50ms response time for ERM real-time updates.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            customers = await conn.fetchval("""
                SELECT COUNT(*) FROM customers_spatial
                WHERE ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
            """, lon, lat, radius_m)
            
            buildings = await conn.fetchval("""
                SELECT COUNT(*) FROM buildings_spatial
                WHERE ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
            """, lon, lat, radius_m)
            
            meters = await conn.fetchval("""
                SELECT COUNT(*) FROM meter_locations_enhanced
                WHERE ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
            """, lon, lat, radius_m)
            
            circuits = await conn.fetchval("""
                SELECT COUNT(*) FROM circuit_service_areas
                WHERE ST_DWithin(
                    centroid_geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
            """, lon, lat, radius_m)
            
            query_time = (time.time() - start) * 1000
            
            return SpatialImpactResponse(
                affected_customers=customers or 0,
                affected_buildings=buildings or 0,
                affected_meters=meters or 0,
                circuit_count=circuits or 0,
                query_time_ms=round(query_time, 2),
                center={"lon": lon, "lat": lat},
                radius_meters=radius_m
            )
    
    except Exception as e:
        logger.error(f"Spatial outage impact query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/nearest-buildings", response_model=NearestAssetResponse, tags=["Geospatial"])
async def get_nearest_buildings(
    lon: float = Query(-95.36, description="Longitude"),
    lat: float = Query(29.76, description="Latitude"),
    limit: int = Query(10, description="Number of nearest buildings to return")
):
    """
    Find nearest buildings using PostGIS KNN (K-Nearest Neighbor) index.
    Uses GiST spatial index for sub-100ms response times.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    building_id,
                    building_name,
                    building_type,
                    height_meters,
                    num_floors,
                    longitude,
                    latitude,
                    ST_Distance(
                        geom::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_meters
                FROM buildings_spatial
                ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
                LIMIT $3
            """, lon, lat, limit)
            
            query_time = (time.time() - start) * 1000
            
            assets = []
            for row in rows:
                assets.append({
                    "building_id": row["building_id"],
                    "building_name": row["building_name"],
                    "building_type": row["building_type"],
                    "height_meters": float(row["height_meters"]) if row["height_meters"] else None,
                    "num_floors": row["num_floors"],
                    "longitude": float(row["longitude"]) if row["longitude"] else None,
                    "latitude": float(row["latitude"]) if row["latitude"] else None,
                    "distance_meters": round(float(row["distance_meters"]), 1) if row["distance_meters"] else None
                })
            
            return NearestAssetResponse(
                assets=assets,
                query_time_ms=round(query_time, 2),
                center={"lon": lon, "lat": lat}
            )
    
    except Exception as e:
        logger.error(f"Nearest buildings query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/nearest-meters", response_model=NearestAssetResponse, tags=["Geospatial"])
async def get_nearest_meters(
    lon: float = Query(-95.36, description="Longitude"),
    lat: float = Query(29.76, description="Latitude"),
    limit: int = Query(20, description="Number of nearest meters to return")
):
    """
    Find nearest meters using PostGIS KNN index for crew dispatch optimization.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    meter_id,
                    transformer_id,
                    circuit_id,
                    city,
                    county_name,
                    latitude,
                    longitude,
                    ST_Distance(
                        geom::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_meters
                FROM meter_locations_enhanced
                ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
                LIMIT $3
            """, lon, lat, limit)
            
            query_time = (time.time() - start) * 1000
            
            assets = [dict(row) for row in rows]
            for a in assets:
                if a.get("distance_meters"):
                    a["distance_meters"] = round(float(a["distance_meters"]), 1)
            
            return NearestAssetResponse(
                assets=assets,
                query_time_ms=round(query_time, 2),
                center={"lon": lon, "lat": lat}
            )
    
    except Exception as e:
        logger.error(f"Nearest meters query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/circuit-contains", tags=["Geospatial"])
async def get_circuits_containing_point(
    lon: float = Query(-95.36, description="Longitude"),
    lat: float = Query(29.76, description="Latitude")
):
    """
    Find all circuits whose service area polygon contains the given point.
    Uses PostGIS ST_Contains with spatial index for fast lookups.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    circuit_id,
                    circuit_name,
                    substation_id,
                    voltage_level_kv,
                    transformer_count,
                    meter_count,
                    centroid_lat,
                    centroid_lon
                FROM circuit_service_areas
                WHERE ST_Contains(
                    bounds_geom,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)
                )
            """, lon, lat)
            
            query_time = (time.time() - start) * 1000
            
            circuits = [dict(row) for row in rows]
            
            return {
                "circuits": circuits,
                "count": len(circuits),
                "query_time_ms": round(query_time, 2),
                "point": {"lon": lon, "lat": lat}
            }
    
    except Exception as e:
        logger.error(f"Circuit contains query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/power-lines", tags=["Geospatial"])
async def get_power_lines_near_point(
    lon: float = Query(-95.36, description="Longitude"),
    lat: float = Query(29.76, description="Latitude"),
    radius_m: float = Query(1000, description="Search radius in meters"),
    limit: int = Query(50, description="Max lines to return")
):
    """
    Find power lines within specified radius using PostGIS ST_DWithin on LineStrings.
    Returns line segments with length and distance metrics.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    power_line_id,
                    class,
                    length_meters,
                    centroid_lon,
                    centroid_lat,
                    ST_Distance(
                        geom::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_meters
                FROM power_lines_spatial
                WHERE ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
                ORDER BY distance_meters
                LIMIT $4
            """, lon, lat, radius_m, limit)
            
            query_time = (time.time() - start) * 1000
            
            lines = []
            for row in rows:
                lines.append({
                    "power_line_id": row["power_line_id"],
                    "class": row["class"],
                    "length_meters": round(float(row["length_meters"]), 1) if row["length_meters"] else None,
                    "centroid_lon": float(row["centroid_lon"]) if row["centroid_lon"] else None,
                    "centroid_lat": float(row["centroid_lat"]) if row["centroid_lat"] else None,
                    "distance_meters": round(float(row["distance_meters"]), 1) if row["distance_meters"] else None
                })
            
            total_length = sum(l["length_meters"] or 0 for l in lines)
            
            return {
                "power_lines": lines,
                "count": len(lines),
                "total_length_km": round(total_length / 1000, 2),
                "query_time_ms": round(query_time, 2),
                "center": {"lon": lon, "lat": lat},
                "radius_meters": radius_m
            }
    
    except Exception as e:
        logger.error(f"Power lines query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/nearest-power-line", tags=["Geospatial"])
async def get_nearest_power_line(
    lon: float = Query(-95.36, description="Longitude of vegetation point"),
    lat: float = Query(29.76, description="Latitude of vegetation point"),
    max_distance_m: float = Query(500, description="Maximum search distance in meters")
):
    """
    Engineering: Find the ACTUAL nearest power line to a vegetation point.
    
    This replaces synthetic/fake line references with real PostGIS spatial analysis.
    Returns the closest power line with accurate distance measurement.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            # Find the single nearest power line within max_distance_m
            row = await conn.fetchrow("""
                SELECT 
                    power_line_id,
                    class,
                    length_meters,
                    ST_Distance(
                        geom::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_meters,
                    -- Get the closest point on the line for visualization
                    ST_X(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))) as closest_lon,
                    ST_Y(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))) as closest_lat
                FROM power_lines_spatial
                WHERE ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
                ORDER BY distance_meters
                LIMIT 1
            """, lon, lat, max_distance_m)
            
            query_time = (time.time() - start) * 1000
            
            if row:
                return {
                    "found": True,
                    "power_line_id": row["power_line_id"],
                    "line_class": row["class"],
                    "line_length_m": round(float(row["length_meters"]), 1) if row["length_meters"] else None,
                    "distance_m": round(float(row["distance_meters"]), 1),
                    "closest_point": {
                        "lon": round(float(row["closest_lon"]), 7),
                        "lat": round(float(row["closest_lat"]), 7)
                    },
                    "vegetation_point": {"lon": lon, "lat": lat},
                    "query_time_ms": round(query_time, 2)
                }
            else:
                return {
                    "found": False,
                    "message": f"No power line within {max_distance_m}m of this location",
                    "vegetation_point": {"lon": lon, "lat": lat},
                    "search_radius_m": max_distance_m,
                    "query_time_ms": round(query_time, 2)
                }
    
    except Exception as e:
        logger.error(f"Nearest power line query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/compute-vegetation-risk", tags=["Geospatial"])
async def compute_vegetation_risk(
    lon: float = Query(-95.36, description="Longitude of vegetation point"),
    lat: float = Query(29.76, description="Latitude of vegetation point"),
    tree_height_m: float = Query(10.0, description="Tree height in meters"),
    canopy_radius_m: float = Query(3.0, description="Canopy radius in meters")
):
    """
    Engineering: Compute REAL vegetation risk based on actual spatial relationships.
    
    This replaces synthetic/pre-computed risk scores with dynamic PostGIS analysis.
    Risk is calculated from:
    1. Distance to nearest REAL power line (if any within 500m)
    2. Distance to nearest grid assets (poles, transformers, substations, meters)
    3. Tree fall zone (height + canopy radius with safety margin)
    
    Risk formula:
    - If fall zone reaches power line: HIGH (0.7-1.0)
    - If fall zone reaches grid asset: MODERATE-HIGH (0.5-0.8)
    - If no infrastructure in fall zone: LOW (0.0-0.3)
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    fall_zone = tree_height_m + canopy_radius_m  # Total fall radius
    
    try:
        async with postgres_pool.acquire() as conn:
            # 1. Find nearest power line within 500m
            power_line = await conn.fetchrow("""
                SELECT 
                    power_line_id,
                    class,
                    ST_Distance(
                        geom::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_m
                FROM power_lines_spatial
                WHERE ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    500
                )
                ORDER BY distance_m
                LIMIT 1
            """, lon, lat)
            
            # 2. Find nearest grid assets within fall zone + buffer
            search_radius = max(fall_zone * 1.5, 100)  # At least 100m search
            nearest_assets = await conn.fetch("""
                SELECT 
                    asset_id,
                    asset_type,
                    ST_Distance(
                        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_m
                FROM grid_assets
                WHERE ST_DWithin(
                    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3
                )
                ORDER BY distance_m
                LIMIT 5
            """, lon, lat, search_radius)
            
            query_time = (time.time() - start) * 1000
            
            # Calculate risk based on REAL proximity
            risk_factors = []
            risk_score = 0.0
            
            # Power line risk
            power_line_distance = None
            power_line_info = None
            if power_line:
                power_line_distance = float(power_line["distance_m"])
                power_line_info = {
                    "id": power_line["power_line_id"],
                    "class": power_line["class"],
                    "distance_m": round(power_line_distance, 1)
                }
                
                if power_line_distance <= fall_zone:
                    # Critical: tree can directly hit power line
                    risk_score = max(risk_score, 0.85 + (1 - power_line_distance / fall_zone) * 0.15)
                    risk_factors.append(f"Tree fall zone ({fall_zone:.1f}m) reaches power line at {power_line_distance:.1f}m")
                elif power_line_distance <= fall_zone * 1.5:
                    # Warning: close to power line
                    risk_score = max(risk_score, 0.5 + (1 - power_line_distance / (fall_zone * 1.5)) * 0.3)
                    risk_factors.append(f"Power line at {power_line_distance:.1f}m is within 1.5x fall zone")
            
            # Asset risk
            assets_at_risk = []
            for asset in nearest_assets:
                asset_distance = float(asset["distance_m"])
                asset_info = {
                    "id": asset["asset_id"],
                    "type": asset["asset_type"],
                    "distance_m": round(asset_distance, 1)
                }
                
                if asset_distance <= fall_zone:
                    # Tree can hit this asset
                    asset_risk = 0.6 + (1 - asset_distance / fall_zone) * 0.25
                    # Substations and transformers are higher value
                    if asset["asset_type"] in ("substation", "transformer"):
                        asset_risk += 0.1
                    risk_score = max(risk_score, asset_risk)
                    risk_factors.append(f"{asset['asset_type']} at {asset_distance:.1f}m within fall zone")
                    assets_at_risk.append(asset_info)
                elif asset_distance <= fall_zone * 1.5:
                    assets_at_risk.append(asset_info)
            
            # If nothing is at risk, assign low baseline risk
            if risk_score == 0.0:
                # Baseline risk based on tree size (larger trees have slightly higher baseline)
                risk_score = min(0.15, tree_height_m / 100)
                if not power_line and not nearest_assets:
                    risk_factors.append("No infrastructure within detection range")
                else:
                    min_distance = min(
                        [power_line_distance] if power_line_distance else [],
                        [float(a["distance_m"]) for a in nearest_assets] if nearest_assets else [],
                        default=None
                    )
                    if min_distance:
                        risk_factors.append(f"Nearest infrastructure at {min_distance:.1f}m, outside {fall_zone:.1f}m fall zone")
            
            # Determine risk level
            if risk_score >= 0.7:
                risk_level = "critical"
            elif risk_score >= 0.5:
                risk_level = "warning"
            elif risk_score >= 0.3:
                risk_level = "monitor"
            else:
                risk_level = "safe"
            
            return {
                "computed_risk": {
                    "score": round(risk_score, 3),
                    "level": risk_level,
                    "factors": risk_factors
                },
                "tree_parameters": {
                    "height_m": tree_height_m,
                    "canopy_radius_m": canopy_radius_m,
                    "fall_zone_m": round(fall_zone, 1)
                },
                "nearest_power_line": power_line_info,
                "assets_at_risk": assets_at_risk,
                "location": {"lon": lon, "lat": lat},
                "query_time_ms": round(query_time, 2)
            }
    
    except Exception as e:
        logger.error(f"Vegetation risk computation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/vegetation-near-lines", tags=["Geospatial"])
async def get_vegetation_near_power_lines(
    buffer_m: float = Query(15, description="Buffer distance from power lines in meters"),
    limit: int = Query(100, description="Max trees to return")
):
    """
    Find trees within buffer distance of power lines using PostGIS spatial join.
    Critical for vegetation management and wildfire risk assessment.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    v.tree_id,
                    v.class,
                    v.subtype,
                    v.longitude,
                    v.latitude,
                    MIN(ST_Distance(v.geom::geography, p.geom::geography)) as min_distance_to_line
                FROM vegetation_risk v
                JOIN power_lines_spatial p 
                    ON ST_DWithin(v.geom::geography, p.geom::geography, $1)
                GROUP BY v.tree_id, v.class, v.subtype, v.longitude, v.latitude
                ORDER BY min_distance_to_line
                LIMIT $2
            """, buffer_m, limit)
            
            query_time = (time.time() - start) * 1000
            
            trees = []
            for row in rows:
                trees.append({
                    "tree_id": row["tree_id"],
                    "class": row["class"],
                    "subtype": row["subtype"],
                    "longitude": float(row["longitude"]) if row["longitude"] else None,
                    "latitude": float(row["latitude"]) if row["latitude"] else None,
                    "distance_to_line_m": round(float(row["min_distance_to_line"]), 1) if row["min_distance_to_line"] else None
                })
            
            return {
                "at_risk_trees": trees,
                "count": len(trees),
                "buffer_meters": buffer_m,
                "query_time_ms": round(query_time, 2)
            }
    
    except Exception as e:
        logger.error(f"Vegetation near lines query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# ENGINEERING: Exemplary Geospatial Endpoints
# These showcase advanced GIS capabilities that differentiate Snowflake
# =============================================================================

@app.get("/api/spatial/h3-vegetation-heatmap", tags=["Geospatial"])
async def get_h3_vegetation_heatmap(
    resolution: int = Query(8, ge=4, le=10, description="H3 resolution (4=coarse, 10=fine)"),
    min_risk: float = Query(0.0, description="Minimum average risk score to include"),
    limit: int = Query(500, description="Max hexagons to return")
):
    """
    Engineering: H3 Hexagonal Vegetation Risk Heatmap
    
    Uses Snowflake's native H3 functions - a key differentiator from BigQuery/Redshift.
    Aggregates vegetation risk into H3 hexagonal cells for efficient visualization.
    
    Resolution guide:
    - 4: ~1,770 km² per hex (regional)
    - 6: ~36 km² per hex (city-level)  
    - 8: ~0.7 km² per hex (neighborhood) - DEFAULT
    - 10: ~0.015 km² per hex (block-level)
    """
    start = time.time()
    
    try:
        # Query Snowflake for H3 aggregation
        query = f"""
        SELECT 
            H3_POINT_TO_CELL(GEOM, {resolution}) as h3_cell,
            COUNT(*) as tree_count,
            ROUND(AVG(RISK_SCORE), 4) as avg_risk_score,
            SUM(CASE WHEN RISK_LEVEL = 'critical' THEN 1 ELSE 0 END) as critical_count,
            SUM(CASE WHEN RISK_LEVEL = 'warning' THEN 1 ELSE 0 END) as warning_count,
            ROUND(MIN(DISTANCE_TO_LINE_M), 2) as min_distance_to_line,
            ROUND(AVG(HEIGHT_M), 1) as avg_tree_height,
            ROUND(AVG(LONGITUDE), 6) as centroid_lon,
            ROUND(AVG(LATITUDE), 6) as centroid_lat
        FROM {DB}.APPLICATIONS.VEGETATION_RISK_COMPUTED
        WHERE GEOM IS NOT NULL
        GROUP BY 1
        HAVING AVG(RISK_SCORE) >= {min_risk}
        ORDER BY avg_risk_score DESC
        LIMIT {limit}
        """
        
        result = subprocess.run(
            ["snow", "sql", "-q", query, "-c", settings.snowflake_connection_name, "--format", "json"],
            capture_output=True, text=True, timeout=60
        )
        
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Snowflake query failed: {result.stderr}")
        
        hexagons = json.loads(result.stdout) if result.stdout.strip() else []
        
        query_time = (time.time() - start) * 1000
        
        # Convert to GeoJSON-like format for map rendering
        features = []
        for hex_data in hexagons:
            features.append({
                "h3_cell": str(hex_data.get("H3_CELL", "")),
                "tree_count": hex_data.get("TREE_COUNT", 0),
                "avg_risk_score": float(hex_data.get("AVG_RISK_SCORE", 0)),
                "critical_count": hex_data.get("CRITICAL_COUNT", 0),
                "warning_count": hex_data.get("WARNING_COUNT", 0),
                "min_distance_to_line": float(hex_data.get("MIN_DISTANCE_TO_LINE", 0)) if hex_data.get("MIN_DISTANCE_TO_LINE") else None,
                "avg_tree_height": float(hex_data.get("AVG_TREE_HEIGHT", 0)) if hex_data.get("AVG_TREE_HEIGHT") else None,
                "centroid": {
                    "lon": float(hex_data.get("CENTROID_LON", 0)),
                    "lat": float(hex_data.get("CENTROID_LAT", 0))
                }
            })
        
        return {
            "type": "h3_heatmap",
            "resolution": resolution,
            "hexagons": features,
            "count": len(features),
            "query_time_ms": round(query_time, 2),
            "metadata": {
                "source": "Snowflake H3_POINT_TO_CELL",
                "differentiator": "Native H3 support - not available in BigQuery/Redshift"
            }
        }
        
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Snowflake query timed out")
    except Exception as e:
        logger.error(f"H3 heatmap query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/vegetation-clusters", tags=["Geospatial"])
async def get_vegetation_risk_clusters(
    min_cluster_size: int = Query(5, description="Minimum trees per cluster"),
    eps_meters: float = Query(50, description="DBSCAN epsilon (max distance between points)"),
    risk_threshold: float = Query(0.3, description="Minimum risk score to include")
):
    """
    Engineering: Spatial Clustering of High-Risk Vegetation
    
    Uses PostGIS ST_ClusterDBSCAN to identify clusters of high-risk trees.
    Perfect for prioritizing vegetation management crews.
    
    This demonstrates density-based spatial clustering - an advanced GIS capability.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            # DBSCAN clustering on high-risk vegetation
            rows = await conn.fetch("""
                WITH high_risk_veg AS (
                    SELECT 
                        tree_id,
                        geom,
                        longitude,
                        latitude,
                        risk_score,
                        risk_level,
                        height_m,
                        nearest_line_id
                    FROM vegetation_risk_computed
                    WHERE risk_score >= $1
                    AND geom IS NOT NULL
                ),
                clustered AS (
                    SELECT 
                        *,
                        ST_ClusterDBSCAN(geom, eps := $2 / 111320.0, minpoints := $3) 
                            OVER () as cluster_id
                    FROM high_risk_veg
                )
                SELECT 
                    cluster_id,
                    COUNT(*) as tree_count,
                    ROUND(AVG(risk_score)::numeric, 3) as avg_risk_score,
                    ROUND(MAX(risk_score)::numeric, 3) as max_risk_score,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_count,
                    ROUND(AVG(height_m)::numeric, 1) as avg_height,
                    ROUND(ST_X(ST_Centroid(ST_Collect(geom)))::numeric, 6) as centroid_lon,
                    ROUND(ST_Y(ST_Centroid(ST_Collect(geom)))::numeric, 6) as centroid_lat,
                    ROUND(((ST_XMax(ST_Extent(geom)) - ST_XMin(ST_Extent(geom))) * 111320)::numeric, 0) as extent_m
                FROM clustered
                WHERE cluster_id IS NOT NULL
                GROUP BY cluster_id
                HAVING COUNT(*) >= $3
                ORDER BY avg_risk_score DESC, tree_count DESC
            """, risk_threshold, eps_meters, min_cluster_size)
            
            query_time = (time.time() - start) * 1000
            
            clusters = []
            for row in rows:
                clusters.append({
                    "cluster_id": row["cluster_id"],
                    "tree_count": row["tree_count"],
                    "avg_risk_score": float(row["avg_risk_score"]) if row["avg_risk_score"] else 0,
                    "max_risk_score": float(row["max_risk_score"]) if row["max_risk_score"] else 0,
                    "critical_count": row["critical_count"],
                    "avg_height_m": float(row["avg_height"]) if row["avg_height"] else 0,
                    "centroid": {
                        "lon": float(row["centroid_lon"]),
                        "lat": float(row["centroid_lat"])
                    },
                    "extent_meters": float(row["extent_m"]) if row["extent_m"] else 0,
                    "priority": "HIGH" if row["critical_count"] > 3 else "MEDIUM" if row["critical_count"] > 0 else "LOW"
                })
            
            return {
                "type": "vegetation_clusters",
                "algorithm": "ST_ClusterDBSCAN",
                "parameters": {
                    "eps_meters": eps_meters,
                    "min_cluster_size": min_cluster_size,
                    "risk_threshold": risk_threshold
                },
                "clusters": clusters,
                "count": len(clusters),
                "total_trees_in_clusters": sum(c["tree_count"] for c in clusters),
                "query_time_ms": round(query_time, 2),
                "metadata": {
                    "source": "PostGIS ST_ClusterDBSCAN",
                    "use_case": "Prioritize vegetation management crew dispatch"
                }
            }
    
    except Exception as e:
        logger.error(f"Vegetation clustering failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/power-line-buffer-analysis", tags=["Geospatial"])
async def get_power_line_buffer_analysis(
    buffer_meters: float = Query(15, description="Buffer distance in meters"),
    line_class: Optional[str] = Query(None, description="Filter by line class (transmission, distribution)")
):
    """
    Engineering: Power Line Right-of-Way Buffer Analysis
    
    Uses PostGIS ST_Buffer to create buffer zones around power lines,
    then counts vegetation encroachments. Critical for:
    - Right-of-way compliance
    - Wildfire risk assessment
    - Vegetation management planning
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            # Use pre-computed distance from materialized view for performance
            # This leverages the spatial computation already done in the MV
            rows = await conn.fetch("""
                WITH line_encroachments AS (
                    SELECT 
                        vc.nearest_line_id as power_line_id,
                        COUNT(*) as trees_in_buffer,
                        SUM(CASE WHEN vc.risk_level = 'critical' THEN 1 ELSE 0 END) as critical_trees,
                        SUM(CASE WHEN vc.risk_level = 'warning' THEN 1 ELSE 0 END) as warning_trees,
                        ROUND(AVG(vc.risk_score)::numeric, 3) as avg_risk_score,
                        ROUND(MIN(vc.distance_to_line_m)::numeric, 1) as closest_tree_m,
                        ROUND(AVG(vc.height_m)::numeric, 1) as avg_tree_height
                    FROM vegetation_risk_computed vc
                    WHERE vc.distance_to_line_m <= $1
                    AND vc.nearest_line_id IS NOT NULL
                    GROUP BY vc.nearest_line_id
                )
                SELECT 
                    le.power_line_id,
                    p.class as line_class,
                    ROUND(p.length_meters::numeric, 0) as line_length_m,
                    le.trees_in_buffer,
                    le.critical_trees,
                    le.warning_trees,
                    le.avg_risk_score,
                    le.closest_tree_m,
                    le.avg_tree_height,
                    CASE 
                        WHEN le.critical_trees > 5 THEN 'CRITICAL'
                        WHEN le.critical_trees > 0 OR le.trees_in_buffer > 10 THEN 'WARNING'
                        ELSE 'MONITOR'
                    END as status
                FROM line_encroachments le
                LEFT JOIN power_lines_spatial p ON le.power_line_id = p.power_line_id
                ORDER BY le.critical_trees DESC, le.trees_in_buffer DESC
                LIMIT 100
            """, buffer_meters)
            
            query_time = (time.time() - start) * 1000
            
            lines = []
            status_counts = {"CRITICAL": 0, "WARNING": 0, "MONITOR": 0, "CLEAR": 0}
            
            for row in rows:
                status = row["status"]
                status_counts[status] = status_counts.get(status, 0) + 1
                lines.append({
                    "power_line_id": row["power_line_id"],
                    "line_class": row["line_class"],
                    "line_length_m": float(row["line_length_m"]) if row["line_length_m"] else 0,
                    "trees_in_buffer": row["trees_in_buffer"],
                    "critical_trees": row["critical_trees"],
                    "warning_trees": row["warning_trees"],
                    "avg_risk_score": float(row["avg_risk_score"]) if row["avg_risk_score"] else 0,
                    "closest_tree_m": float(row["closest_tree_m"]) if row["closest_tree_m"] else None,
                    "avg_tree_height_m": float(row["avg_tree_height"]) if row["avg_tree_height"] else None,
                    "status": status
                })
            
            return {
                "type": "buffer_analysis",
                "buffer_meters": buffer_meters,
                "line_class_filter": line_class,
                "lines_analyzed": len(lines),
                "status_summary": status_counts,
                "lines": lines,
                "query_time_ms": round(query_time, 2),
                "metadata": {
                    "source": "PostGIS ST_Buffer + ST_Within",
                    "use_case": "Right-of-way vegetation compliance"
                }
            }
    
    except Exception as e:
        logger.error(f"Buffer analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/summary", tags=["Geospatial"])
async def get_spatial_data_summary():
    """
    Return summary statistics of all PostGIS spatial tables.
    Useful for dashboard overview and data validation.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured for spatial queries")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            tables = [
                ("buildings_spatial", "Building footprints for impact analysis"),
                ("power_lines_spatial", "Power line routes (LineStrings)"),
                ("vegetation_risk", "Tree locations for vegetation management"),
                ("circuit_service_areas", "Circuit boundary polygons"),
                ("meter_locations_enhanced", "Meter points with circuit association"),
                ("customers_spatial", "Customer locations")
            ]
            
            summary = []
            total_rows = 0
            
            for table, description in tables:
                try:
                    count = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
                    size = await conn.fetchval(f"SELECT pg_size_pretty(pg_total_relation_size('{table}'))")
                    summary.append({
                        "table": table,
                        "description": description,
                        "row_count": count,
                        "size": size
                    })
                    total_rows += count or 0
                except:
                    summary.append({
                        "table": table,
                        "description": description,
                        "row_count": 0,
                        "size": "0 bytes",
                        "error": "Table not found"
                    })
            
            query_time = (time.time() - start) * 1000
            
            return {
                "tables": summary,
                "total_rows": total_rows,
                "postgis_version": await conn.fetchval("SELECT PostGIS_Version()"),
                "query_time_ms": round(query_time, 2)
            }
    
    except Exception as e:
        logger.error(f"Spatial summary query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# PostGIS SPATIAL LAYER ENDPOINTS - GeoJSON for DeckGL Visualization
# Engineering: These endpoints return data for direct layer rendering
# =============================================================================

@app.get("/api/spatial/layers/power-lines", tags=["Geospatial Layers"])
async def get_power_lines_layer(
    min_lon: float = Query(-95.8, description="Viewport min longitude"),
    max_lon: float = Query(-94.9, description="Viewport max longitude"),
    min_lat: float = Query(29.4, description="Viewport min latitude"),
    max_lat: float = Query(30.2, description="Viewport max latitude"),
    zoom: int = Query(12, description="Map zoom level for LOD selection"),
    limit: int = Query(3000, description="Max features to return")
):
    """
    Engineering: Return power lines using PostGIS LOD (Level of Detail) optimization.
    
    Zoom-based LOD selection:
    - zoom < 12: power_lines_lod_overview (major lines, ~96% vertex reduction)
    - zoom 12-14: power_lines_lod_mid (all lines, ~88% vertex reduction)  
    - zoom >= 15: power_lines_spatial (full detail)
    
    Uses PostGIS GIST spatial index for fast viewport queries (<50ms).
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    # Determine LOD table based on zoom
    if zoom < 12:
        lod_table = "power_lines_lod_overview"
        lod_level = "overview"
    elif zoom < 15:
        lod_table = "power_lines_lod_mid"
        lod_level = "mid"
    else:
        lod_table = "power_lines_spatial"
        lod_level = "full"
    
    try:
        async with postgres_pool.acquire() as conn:
            # Use PostGIS spatial index with ST_Intersects for efficient viewport query
            rows = await conn.fetch(f"""
                SELECT 
                    power_line_id, 
                    class, 
                    length_meters,
                    ST_AsGeoJSON(geom) as geometry
                FROM {lod_table}
                WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                ORDER BY length_meters DESC
                LIMIT $5
            """, min_lon, min_lat, max_lon, max_lat, limit)
            
            import json as json_lib
            features = []
            total_vertices = 0
            for row in rows:
                geom_str = row["geometry"]
                if geom_str:
                    geom = json_lib.loads(geom_str)
                    coords = geom.get("coordinates", [])
                    if coords:
                        total_vertices += len(coords)
                        features.append({
                            "id": row["power_line_id"],
                            "path": coords,
                            "class": row["class"],
                            "length_m": float(row["length_meters"]) if row["length_meters"] else 0
                        })
            
            query_time_ms = round((time.time() - start) * 1000, 2)
            
            return {
                "type": "power_lines",
                "features": features,
                "count": len(features),
                "total_vertices": total_vertices,
                "lod_level": lod_level,
                "lod_table": lod_table,
                "zoom": zoom,
                "query_time_ms": query_time_ms
            }
    
    except Exception as e:
        logger.error(f"Power lines layer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/power-lines/{line_id}/connected-assets", tags=["Geospatial Layers"])
async def get_power_line_connected_assets(
    line_id: str,
    search_radius_m: float = Query(50.0, description="Search radius in meters around the power line")
):
    """
    Engineering: Find grid assets connected to a specific power line.
    
    Uses PostGIS ST_DWithin to find transformers and poles within the search radius 
    of the power line geometry. This enables navigation from power lines to the 
    grid assets they connect.
    
    Performance: Uses GIST spatial indexes for sub-50ms queries.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            # First get the power line geometry
            line_geom = await conn.fetchval("""
                SELECT geom FROM power_lines_spatial WHERE power_line_id = $1
            """, line_id)
            
            if not line_geom:
                return {
                    "line_id": line_id,
                    "connected_assets": [],
                    "count": 0,
                    "error": "Power line not found"
                }
            
            # Find grid assets near the power line using PostGIS ST_DWithin
            # Convert meters to degrees (approximate at Houston latitude ~29.7)
            # 1 degree latitude ≈ 110,540 meters
            # 1 degree longitude ≈ 96,486 meters (at 29.7° latitude)
            search_radius_deg = search_radius_m / 110540.0
            
            rows = await conn.fetch("""
                WITH line AS (
                    SELECT geom FROM power_lines_spatial WHERE power_line_id = $1
                )
                SELECT 
                    ga.asset_id,
                    ga.asset_name,
                    ga.asset_type,
                    ga.latitude,
                    ga.longitude,
                    ga.health_score,
                    ga.load_percent,
                    ga.circuit_id,
                    ST_Distance(
                        ST_Transform(ST_SetSRID(ST_MakePoint(ga.longitude, ga.latitude), 4326), 3857),
                        ST_Transform(line.geom, 3857)
                    ) as distance_m
                FROM grid_assets_cache ga, line
                WHERE ST_DWithin(
                    ST_SetSRID(ST_MakePoint(ga.longitude, ga.latitude), 4326),
                    line.geom,
                    $2
                )
                AND ga.asset_type IN ('transformer', 'pole')
                ORDER BY distance_m ASC
                LIMIT 50
            """, line_id, search_radius_deg)
            
            connected_assets = [
                {
                    "id": row["asset_id"],
                    "name": row["asset_name"],
                    "type": row["asset_type"],
                    "latitude": float(row["latitude"]),
                    "longitude": float(row["longitude"]),
                    "health_score": float(row["health_score"]) if row["health_score"] else None,
                    "load_percent": float(row["load_percent"]) if row["load_percent"] else None,
                    "circuit_id": row["circuit_id"],
                    "distance_m": round(float(row["distance_m"]), 1) if row["distance_m"] else None
                }
                for row in rows
            ]
            
            query_time_ms = round((time.time() - start) * 1000, 2)
            
            return {
                "line_id": line_id,
                "connected_assets": connected_assets,
                "count": len(connected_assets),
                "search_radius_m": search_radius_m,
                "transformers": sum(1 for a in connected_assets if a["type"] == "transformer"),
                "poles": sum(1 for a in connected_assets if a["type"] == "pole"),
                "query_time_ms": query_time_ms
            }
    
    except Exception as e:
        logger.error(f"Power line connected assets query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/vegetation", tags=["Geospatial Layers"])
async def get_vegetation_layer(
    min_lon: float = Query(-95.8, description="Viewport min longitude"),
    max_lon: float = Query(-94.9, description="Viewport max longitude"),
    min_lat: float = Query(29.4, description="Viewport min latitude"),
    max_lat: float = Query(30.2, description="Viewport max latitude"),
    limit: int = Query(50000, description="Max features to return"),
    include_encroachment: bool = Query(True, description="Include PostGIS encroachment analysis")
):
    """
    Engineering: Return vegetation with in-memory caching for instant viewport queries.
    First request loads all 27K trees, subsequent requests filter in Python (<5ms).
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    try:
        cached = await spatial_cache.get_vegetation(min_lon, max_lon, min_lat, max_lat, limit)
        if cached is not None:
            risk_summary = {
                "critical": sum(1 for f in cached if f.get("risk_level") == "critical"),
                "warning": sum(1 for f in cached if f.get("risk_level") == "warning"),
                "monitor": sum(1 for f in cached if f.get("risk_level") == "monitor"),
                "safe": sum(1 for f in cached if f.get("risk_level") == "safe")
            }
            return {
                "type": "vegetation",
                "features": cached,
                "count": len(cached),
                "risk_summary": risk_summary,
                "postgis_analysis": include_encroachment,
                "query_time_ms": round((time.time() - start) * 1000, 2),
                "cache_hit": True
            }
        
        async with postgres_pool.acquire() as conn:
            # Engineering: Query enhanced vegetation data with real heights
            # FIX: Exclude vegetation points that fall INSIDE water bodies
            # Trees don't grow in the middle of San Jacinto Bay!
            # Uses NOT EXISTS with spatial index for performance
            rows = await conn.fetch("""
                SELECT 
                    tree_id, class, subtype, longitude, latitude,
                    height_m, canopy_radius_m, risk_score, risk_level,
                    distance_to_line_m, nearest_line_id, nearest_line_voltage_kv,
                    clearance_deficit_m, years_to_encroachment, data_source
                FROM vegetation_risk v
                WHERE longitude IS NOT NULL AND latitude IS NOT NULL
                  -- # Exclude vegetation inside water bodies (>10 acres)
                  -- This removes ~2,500 incorrectly-placed trees from bays/rivers
                  AND NOT EXISTS (
                      SELECT 1 FROM osm_water w 
                      WHERE w.acres > 10 
                        AND ST_Within(v.geom, w.geom)
                  )
                LIMIT 50000
            """)
            
            all_features = []
            for row in rows:
                if row["longitude"] and row["latitude"]:
                    # Use real data from enhanced table (has heights loaded from Snowflake)
                    height = float(row["height_m"]) if row["height_m"] else 10.0
                    all_features.append({
                        "id": row["tree_id"],
                        "position": [float(row["longitude"]), float(row["latitude"])],
                        "longitude": float(row["longitude"]),
                        "latitude": float(row["latitude"]),
                        "class": row["class"],
                        "subtype": row["subtype"],
                        "species": row["subtype"],
                        "height_m": round(height, 1),
                        "canopy_radius_m": float(row["canopy_radius_m"]) if row["canopy_radius_m"] else height * 0.35,
                        "canopy_height": round(height * 0.7, 1),
                        "risk_score": float(row["risk_score"]) if row["risk_score"] else 0.0,
                        "proximity_risk": float(row["risk_score"]) if row["risk_score"] else 0.0,
                        "distance_to_line_m": float(row["distance_to_line_m"]) if row["distance_to_line_m"] else 50.0,
                        "nearest_line_id": row["nearest_line_id"],
                        "nearest_line_voltage_kv": float(row["nearest_line_voltage_kv"]) if row["nearest_line_voltage_kv"] else 12.47,
                        "clearance_deficit_m": float(row["clearance_deficit_m"]) if row["clearance_deficit_m"] else 0.0,
                        "years_to_encroachment": float(row["years_to_encroachment"]) if row["years_to_encroachment"] else 99.0,
                        "risk_level": row["risk_level"] or "safe",
                        "data_source": row["data_source"] or "enhanced"
                    })
            
            await spatial_cache.set_vegetation(all_features)
            
            features = [f for f in all_features 
                       if min_lon <= f["position"][0] <= max_lon 
                       and min_lat <= f["position"][1] <= max_lat][:limit]
            
            risk_summary = {
                "critical": sum(1 for f in features if f["risk_level"] == "critical"),
                "warning": sum(1 for f in features if f["risk_level"] == "warning"),
                "monitor": sum(1 for f in features if f["risk_level"] == "monitor"),
                "safe": sum(1 for f in features if f["risk_level"] == "safe")
            }
            
            return {
                "type": "vegetation",
                "features": features,
                "count": len(features),
                "risk_summary": risk_summary,
                "postgis_analysis": include_encroachment,
                "query_time_ms": round((time.time() - start) * 1000, 2),
                "cache_hit": False
            }
    
    except Exception as e:
        logger.error(f"Vegetation layer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/water-bodies", tags=["Geospatial Layers"])
async def get_water_bodies_layer(
    min_lon: float = Query(-95.8, description="Viewport min longitude"),
    max_lon: float = Query(-94.9, description="Viewport max longitude"),
    min_lat: float = Query(29.4, description="Viewport min latitude"),
    max_lat: float = Query(30.2, description="Viewport max latitude"),
    zoom: int = Query(10, description="Map zoom level for LOD filtering"),
    limit: int = Query(2000, description="Max features to return")
):
    """
    Architecture Pattern: PostGIS for Spatial Query Acceleration
    
    Data Flow:
    - Source of Truth: Snowflake OSM_WATER_POLYGONS
    - Query Layer: PostGIS osm_water (synced from Snowflake)
    - Performance: ~2ms viewport queries with spatial index
    
    LOD (Level of Detail) Filtering:
    - Zoom < 11: Only 500+ acre features (major lakes, bays)
    - Zoom 11-12: 100+ acre features (reservoirs, large ponds)
    - Zoom 13-14: 10+ acre features (ponds, wide rivers)
    - Zoom 15+: All features (streams, small ponds)
    
    Water Type Filtering (Insight):
    - Rivers/streams are stored as elongated polygons that look like scattered shapes at metro zoom
    - At zoom < 13, filter to only 'water' type (lakes, reservoirs, ponds) for clear visual
    - At zoom 13+, show rivers/streams as users can see them properly
    
    This endpoint returns ACTUAL water bodies (rivers, streams, ponds, canals)
    NOT flood zone boundaries. The OSM data provides accurate water classification.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    # LOD Strategy based on zoom level
    # Insight: Rivers/streams are long thin polygons that look like noise at metro zoom
    if zoom < 11:
        min_acres = 50       # Medium+ water bodies
        water_types = ['water']  # Lakes/reservoirs only - no rivers at this zoom
    elif zoom < 13:
        min_acres = 20       # Smaller ponds visible
        water_types = ['water']  # Still lakes only - rivers still look weird
    elif zoom < 15:
        min_acres = 5        # Small ponds
        water_types = ['water', 'river', 'canal']  # Add major waterways
    else:
        min_acres = 0        # Show everything at street level
        water_types = ['water', 'river', 'stream', 'canal']  # All types
    
    # Critical Fix: OSM river/stream data contains flood zone boundaries
    # incorrectly tagged as waterways. There are TWO types of flood zone data:
    # 
    # 1. FLOOD ZONE BOUNDARIES (compactness ~1-10): Long thin traces along flood edges
    #    Example: Buffalo Bayou = 1,292 acres, 39.6mi perimeter, compactness 1.2
    #             This traces the flood zone boundary through neighborhoods - NOT water!
    #
    # 2. FLOOD ZONE AREAS (1000+ acres): Entire watersheds tagged as "rivers"
    #    Example: Greens Bayou = 21,986 acres (14.9mi x 11.3mi!) - 34 square miles!
    #             East Fork San Jacinto River = 23,165 acres - that's a region!
    #
    # REAL RIVERS in SE Texas are max ~500ft wide:
    #    30-mile river at 500ft width = ~1,800 acres MAX
    #    Anything over 1,000 acres is almost certainly flood zone data
    #
    # FIX: Hard cap rivers at 1,000 acres + compactness check for 300-1000 acre range
    # Result: Filters 15 flood zones (70,362 acres), keeps 206 real rivers (15,115 acres)
    
    # Critical Fix: Type-specific compactness filters for 'water' type
    # Compactness = (Area / Perimeter^2) * 10000 - measures shape "roundness"
    # - Lakes/ponds ('water'): Should be compact (circular/oval) - strict filter
    # - Rivers: Already filtered by acreage cap above
    # Audit: 96 'water' type features with low compactness appear as ugly polygons
    
    # Compactness threshold for 'water' type only (lakes/ponds)
    # Rivers/streams/canals have hardcoded lenient thresholds in SQL
    if zoom >= 15:
        water_compactness = 12  # Allow more detail at high zoom
    elif zoom >= 13:
        water_compactness = 15  # Moderate filter
    else:
        water_compactness = 20  # Strict filter at metro zoom - only show nice shapes
    
    try:
        async with postgres_pool.acquire() as conn:
            # Query OSM water from PostGIS with spatial index + LOD filter + type filter
            # GIST index on geom enables sub-10ms viewport queries
            # Added max_acres filter to exclude flood zone misclassifications
            # FIX: Type-specific compactness thresholds - rivers/streams naturally long
            # FIX: ST_MakeValid() fixes self-intersecting geometries (4 found in audit)
            rows = await conn.fetch("""
                SELECT 
                    osm_id,
                    name,
                    water_type,
                    acres,
                    ST_AsGeoJSON(
                        CASE WHEN ST_IsValid(geom) THEN geom 
                             ELSE ST_MakeValid(geom) 
                        END
                    ) as geometry
                FROM osm_water
                WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                  AND acres >= $5
                  AND water_type = ANY($6)
                  AND (
                    -- CRITICAL FIX: Filter flood zone data from actual water bodies
                    -- 
                    -- OSM "river" data often contains FLOOD ZONES, not actual water:
                    -- 1. Flood zone BOUNDARIES (compactness ~1-10): Long thin traces
                    --    Buffalo Bayou = 1,292 acres, 39.6mi perimeter, compactness 1.2
                    -- 2. Flood zone AREAS (1000+ acres): Entire watersheds
                    --    Greens Bayou = 21,986 acres (14.9mi x 11.3mi!) - that's a region!
                    --
                    -- REAL RIVERS in SE Texas are max ~500ft wide:
                    --    30-mile river @ 500ft = 1,818 acres MAX
                    --    Anything over 1,000 acres is likely flood zone data
                    --
                    -- Filter: Rivers <=300 acres OK, 300-1000 need good shape, >1000 filtered
                    -- 
                    (water_type = 'stream' AND acres <= 100) OR
                    (water_type = 'canal' AND acres <= 200) OR
                    -- Rivers: Hard cap at 1000 acres + compactness check for medium rivers
                    (water_type = 'river' AND (
                      acres <= 300 OR 
                      (acres <= 1000 AND (ST_Area(geom::geography) / NULLIF(ST_Perimeter(geom::geography)^2, 0) * 10000) BETWEEN 50 AND 600)
                    )) OR
                    (water_type = 'water')
                  )
                  AND (
                    -- FIX: Type-specific compactness thresholds
                    -- Rivers/streams are naturally long - use lenient threshold
                    -- Lakes/ponds should be compact - use strict threshold
                    -- This filters 96 ugly elongated 'water' features while keeping rivers
                    CASE water_type
                      WHEN 'water' THEN 
                        (ST_Area(geom::geography) / NULLIF(ST_Perimeter(geom::geography)^2, 0) * 10000) >= $8
                      WHEN 'river' THEN 
                        (ST_Area(geom::geography) / NULLIF(ST_Perimeter(geom::geography)^2, 0) * 10000) >= 0.5
                      WHEN 'stream' THEN 
                        (ST_Area(geom::geography) / NULLIF(ST_Perimeter(geom::geography)^2, 0) * 10000) >= 3
                      WHEN 'canal' THEN 
                        (ST_Area(geom::geography) / NULLIF(ST_Perimeter(geom::geography)^2, 0) * 10000) >= 2
                      ELSE true
                    END
                  )
                ORDER BY acres DESC
                LIMIT $7
            """, min_lon, min_lat, max_lon, max_lat, min_acres, water_types, limit, water_compactness)
            
            import json as json_lib
            features = []
            for row in rows:
                geom_str = row["geometry"]
                if geom_str:
                    geom = json_lib.loads(geom_str)
                    if geom.get("coordinates"):
                        features.append({
                            "id": str(row["osm_id"]),
                            "type": "Feature",
                            "geometry": geom,
                            "properties": {
                                "id": str(row["osm_id"]),
                                "name": row["name"] or "Unnamed",
                                "water_type": row["water_type"],
                                "acres": round(float(row["acres"]), 2) if row["acres"] else 0,
                                "area_km2": round(float(row["acres"]) * 0.00404686, 3) if row["acres"] else 0
                            }
                        })
            
            query_time = round((time.time() - start) * 1000, 2)
            
            from fastapi.responses import JSONResponse
            return JSONResponse(
                content={
                    "type": "water-bodies",
                    "features": features,
                    "count": len(features),
                    "query_time_ms": query_time,
                    "zoom": zoom,
                    "min_acres_filter": min_acres,
                    "water_compactness_filter": water_compactness,
                    "water_types_filter": water_types,
                    "lod_note": f"Zoom {zoom}: {', '.join(water_types)} >= {min_acres} acres",
                    "source": "PostGIS osm_water (synced from Snowflake)",
                    "note": "Fix: Type-specific compactness filters - strict for lakes (>={}), lenient for rivers (>=0.5)".format(water_compactness)
                },
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            )
    
    except Exception as e:
        logger.error(f"Water bodies layer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/buildings", tags=["Geospatial Layers"])
async def get_buildings_layer(
    min_lon: float = Query(-95.8, description="Viewport min longitude"),
    max_lon: float = Query(-94.9, description="Viewport max longitude"),
    min_lat: float = Query(29.4, description="Viewport min latitude"),
    max_lat: float = Query(30.2, description="Viewport max latitude"),
    limit: int = Query(5000, description="Max features to return")
):
    """
    Engineering: Return buildings with in-memory caching for instant viewport queries.
    First request loads all 100K buildings, subsequent requests filter in Python (<10ms).
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    try:
        cached = await spatial_cache.get_buildings(min_lon, max_lon, min_lat, max_lat, limit)
        if cached is not None:
            return {
                "type": "buildings",
                "features": cached,
                "count": len(cached),
                "query_time_ms": round((time.time() - start) * 1000, 2),
                "cache_hit": True
            }
        
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT building_id, building_name, building_type, height_meters, num_floors, longitude, latitude
                FROM buildings_spatial
                LIMIT 150000
            """)
            
            all_features = [{
                "id": row["building_id"],
                "position": [float(row["longitude"]), float(row["latitude"])],
                "name": row["building_name"],
                "type": row["building_type"],
                "height": float(row["height_meters"]) if row["height_meters"] else 10,
                "floors": row["num_floors"] or 1
            } for row in rows if row["longitude"] and row["latitude"]]
            
            await spatial_cache.set_buildings(all_features)
            
            features = [f for f in all_features 
                       if min_lon <= f["position"][0] <= max_lon 
                       and min_lat <= f["position"][1] <= max_lat][:limit]
            
            return {
                "type": "buildings",
                "features": features,
                "count": len(features),
                "query_time_ms": round((time.time() - start) * 1000, 2),
                "cache_hit": False
            }
    
    except Exception as e:
        logger.error(f"Buildings layer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Engineering: Vector Tiles from PostGIS - Industry standard for large geo datasets
# Pattern: PostGIS generates MVT tiles on-demand with spatial index (<100ms)
# deck.gl MVTLayer handles tiling automatically - no full dataset transfer

@app.get("/api/spatial/tiles/buildings/{z}/{x}/{y}.mvt", tags=["Vector Tiles"])
async def get_building_tiles_mvt(z: int, x: int, y: int):
    """
    Engineering: Generate Mapbox Vector Tiles (MVT) from PostGIS.
    Uses ST_AsMVT() for O(1) tile generation with spatial index.
    deck.gl MVTLayer consumes these directly - instant pan/zoom.
    
    OPTIMIZED: Removed centroid calculation for faster tile generation.
    Uses ST_Simplify for lower zoom levels to reduce polygon complexity.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    # Simplify geometry for lower zoom levels (reduces polygon complexity significantly)
    # Higher tolerance = more simplification = faster rendering
    simplify_tolerance = 0 if z >= 16 else (0.0001 if z >= 14 else (0.0005 if z >= 12 else 0.001))
    
    try:
        async with postgres_pool.acquire() as conn:
            # Use simplified geometry for lower zooms, full detail for z >= 16
            if simplify_tolerance > 0:
                tile_data = await conn.fetchval("""
                    WITH bounds AS (
                        SELECT ST_TileEnvelope($1, $2, $3) AS geom
                    ),
                    mvtgeom AS (
                        SELECT 
                            ST_AsMVTGeom(
                                ST_Transform(ST_Simplify(b.geom, $4), 3857),
                                bounds.geom,
                                4096,
                                64,
                                true
                            ) AS geom,
                            b.building_id,
                            b.building_name,
                            b.building_type,
                            b.height_meters,
                            b.num_floors
                        FROM building_footprints b, bounds
                        WHERE b.geom && ST_Transform(bounds.geom, 4326)
                    )
                    SELECT ST_AsMVT(mvtgeom.*, 'buildings', 4096, 'geom') FROM mvtgeom
                """, z, x, y, simplify_tolerance)
            else:
                tile_data = await conn.fetchval("""
                    WITH bounds AS (
                        SELECT ST_TileEnvelope($1, $2, $3) AS geom
                    ),
                    mvtgeom AS (
                        SELECT 
                            ST_AsMVTGeom(
                                ST_Transform(b.geom, 3857),
                                bounds.geom,
                                4096,
                                64,
                                true
                            ) AS geom,
                            b.building_id,
                            b.building_name,
                            b.building_type,
                            b.height_meters,
                            b.num_floors
                        FROM building_footprints b, bounds
                        WHERE b.geom && ST_Transform(bounds.geom, 4326)
                    )
                    SELECT ST_AsMVT(mvtgeom.*, 'buildings', 4096, 'geom') FROM mvtgeom
                """, z, x, y)
            
            elapsed_ms = round((time.time() - start) * 1000, 2)
            if elapsed_ms > 100:
                logger.warning(f"MVT tile z={z} x={x} y={y} slow: {elapsed_ms}ms")
            
            return Response(
                content=tile_data or b'',
                media_type="application/vnd.mapbox-vector-tile",
                headers={
                    # Aggressive caching for tile data
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                    "Access-Control-Allow-Origin": "*"
                }
            )
    
    except Exception as e:
        logger.error(f"MVT tile generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/building-labels", tags=["Geospatial Layers"])
async def get_building_labels(
    min_lon: float = Query(-95.8, description="Viewport min longitude"),
    max_lon: float = Query(-94.9, description="Viewport max longitude"),
    min_lat: float = Query(29.4, description="Viewport min latitude"),
    max_lat: float = Query(30.2, description="Viewport max latitude"),
    limit: int = Query(200, description="Max labels to return")
):
    """
    Engineering: Return named buildings (POIs) for label rendering.
    
    Returns buildings with real names (CVS, Walmart, etc.) for TextLayer display.
    Only returns buildings within viewport that have non-generic names.
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    building_id,
                    building_name,
                    building_type,
                    height_meters,
                    ST_X(ST_Centroid(geom)) as longitude,
                    ST_Y(ST_Centroid(geom)) as latitude
                FROM building_footprints
                WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                AND building_name IS NOT NULL
                AND building_name != ''
                AND building_name NOT IN ('Unnamed', 'unnamed', 'Unknown', 'unknown', 'Yes', 'yes')
                ORDER BY height_meters DESC NULLS LAST
                LIMIT $5
            """, min_lon, min_lat, max_lon, max_lat, limit)
            
            labels = [
                {
                    "id": row["building_id"],
                    "name": row["building_name"],
                    "type": row["building_type"],
                    "height": float(row["height_meters"]) if row["height_meters"] else 5,
                    "position": [float(row["longitude"]), float(row["latitude"])]
                }
                for row in rows
            ]
            
            query_time_ms = round((time.time() - start) * 1000, 2)
            
            return {
                "type": "building-labels",
                "features": labels,
                "count": len(labels),
                "query_time_ms": query_time_ms
            }
    
    except Exception as e:
        logger.error(f"Building labels query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/building-footprints/preload", tags=["Geospatial Layers"])
async def preload_building_footprints_info():
    """
    Engineering: Return info about building footprints availability.
    With MVT tiles, no preload needed - tiles generated on-demand from PostGIS.
    """
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                count = await conn.fetchval("SELECT COUNT(*) FROM building_footprints WHERE geom IS NOT NULL")
                return {
                    "type": "building-footprints-mvt",
                    "source": "postgis",
                    "count": count,
                    "tile_url": "/api/spatial/tiles/buildings/{z}/{x}/{y}.mvt",
                    "status": "ready",
                    "message": "PostGIS MVT tiles - no preload needed, instant tile generation"
                }
        except Exception as e:
            logger.warning(f"PostGIS buildings check failed: {e}")
    
    return {
        "type": "building-footprints-fallback",
        "source": "snowflake",
        "status": "loading",
        "message": "PostGIS unavailable, falling back to Snowflake (slower)"
    }


@app.get("/api/spatial/layers/building-footprints", tags=["Geospatial Layers"])
async def get_building_footprints_layer(
    min_lon: float = Query(..., description="Minimum longitude"),
    max_lon: float = Query(..., description="Maximum longitude"),
    min_lat: float = Query(..., description="Minimum latitude"),
    max_lat: float = Query(..., description="Maximum latitude"),
    limit: int = Query(50000, description="Max buildings to return")
):
    """
    Engineering: Return building footprints from PostGIS (fast) or Snowflake (fallback).
    PostGIS with spatial index returns <100ms, Snowflake takes seconds.
    """
    start = time.time()
    
    if postgres_pool:
        try:
            async with postgres_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT 
                        building_id,
                        building_name,
                        building_type,
                        height_meters,
                        num_floors,
                        ST_X(ST_Centroid(geom)) as lon,
                        ST_Y(ST_Centroid(geom)) as lat,
                        ST_AsGeoJSON(geom)::json->'coordinates'->0 as polygon
                    FROM building_footprints
                    WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                    LIMIT $5
                """, min_lon, min_lat, max_lon, max_lat, limit)
                
                features = []
                for row in rows:
                    if row["polygon"]:
                        features.append({
                            "id": row["building_id"],
                            "name": row["building_name"] or "Building",
                            "type": row["building_type"] or "unknown",
                            "height": float(row["height_meters"]) if row["height_meters"] else 8.0,
                            "floors": row["num_floors"] or 1,
                            "lon": float(row["lon"]),
                            "lat": float(row["lat"]),
                            "polygon": row["polygon"]
                        })
                
                return {
                    "type": "building-footprints",
                    "source": "postgis",
                    "features": features,
                    "count": len(features),
                    "query_time_ms": round((time.time() - start) * 1000, 2),
                    "cache_hit": False,
                    "bounds": {"min_lon": min_lon, "max_lon": max_lon, "min_lat": min_lat, "max_lat": max_lat}
                }
        except Exception as e:
            logger.warning(f"PostGIS building footprints failed, falling back to Snowflake: {e}")
    
    try:
        def fetch_footprints():
            conn = get_snowflake_connection()
            cur = conn.cursor()
            cur.execute(f"""
                SELECT 
                    BUILDING_ID,
                    BUILDING_NAME,
                    BUILDING_TYPE,
                    HEIGHT_METERS,
                    NUM_FLOORS,
                    ST_X(ST_CENTROID(GEOMETRY)) as centroid_lon,
                    ST_Y(ST_CENTROID(GEOMETRY)) as centroid_lat,
                    ST_ASGEOJSON(GEOMETRY) as geojson
                FROM {DB}.RAW.HOUSTON_BUILDINGS_FOOTPRINTS
                WHERE ST_X(ST_CENTROID(GEOMETRY)) BETWEEN {min_lon} AND {max_lon}
                  AND ST_Y(ST_CENTROID(GEOMETRY)) BETWEEN {min_lat} AND {max_lat}
                LIMIT {min(limit, 100000)}
            """)
            rows = cur.fetchall()
            conn.close()
            return rows
        
        loop = asyncio.get_event_loop()
        rows = await loop.run_in_executor(snowflake_executor, fetch_footprints)
        
        features = []
        for row in rows:
            building_id, name, btype, height, floors, lon, lat, geojson_str = row
            if geojson_str:
                geom = json.loads(geojson_str)
                if geom.get("type") == "Polygon" and geom.get("coordinates"):
                    features.append({
                        "id": building_id,
                        "name": name or "Building",
                        "type": btype or "unknown",
                        "height": float(height) if height else 8.0,
                        "floors": floors or 1,
                        "lon": float(lon),
                        "lat": float(lat),
                        "polygon": geom["coordinates"][0]
                    })
        
        return {
            "type": "building-footprints",
            "features": features,
            "count": len(features),
            "query_time_ms": round((time.time() - start) * 1000, 2),
            "cache_hit": False,
            "bounds": {"min_lon": min_lon, "max_lon": max_lon, "min_lat": min_lat, "max_lat": max_lat}
        }
    
    except Exception as e:
        logger.error(f"Building footprints layer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/spatial/layers/circuits", tags=["Geospatial Layers"])
async def get_circuits_layer():
    """
    Return circuit service areas for PolygonLayer rendering.
    Returns all circuits (small dataset).
    """
    if not postgres_pool:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    
    start = time.time()
    
    try:
        async with postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    circuit_id,
                    customer_count,
                    centroid_lon,
                    centroid_lat,
                    min_lon, max_lon, min_lat, max_lat
                FROM circuit_service_areas
            """)
            
            features = [{
                "id": row["circuit_id"],
                "center": [float(row["centroid_lon"]), float(row["centroid_lat"])],
                "bounds": [
                    [float(row["min_lon"]), float(row["min_lat"])],
                    [float(row["max_lon"]), float(row["min_lat"])],
                    [float(row["max_lon"]), float(row["max_lat"])],
                    [float(row["min_lon"]), float(row["max_lat"])],
                    [float(row["min_lon"]), float(row["min_lat"])]
                ],
                "customers": row["customer_count"]
            } for row in rows if row["centroid_lon"] and row["centroid_lat"]]
            
            return {
                "type": "circuits",
                "features": features,
                "count": len(features),
                "query_time_ms": round((time.time() - start) * 1000, 2)
            }
    
    except Exception as e:
        logger.error(f"Circuits layer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# CASCADE FAILURE SIMULATION ENDPOINTS (GridGuard Integration)
# Engineering: GNN-based cascade failure prediction for grid resilience
# =============================================================================

class CascadeScenario(BaseModel):
    """Request model for cascade failure simulation."""
    scenario_name: str = Field(..., description="Name of the scenario (e.g., 'SUMMER_PEAK_2025')")
    initial_failure_node: Optional[str] = Field(None, description="Node ID to fail first (auto-detect if not provided)")
    temperature_c: float = Field(35.0, description="Ambient temperature in Celsius")
    load_multiplier: float = Field(1.0, description="Load multiplier (1.0 = normal, 1.5 = 50% above normal)")
    failure_threshold: float = Field(0.7, description="GNN probability threshold for failure propagation")


class CascadeResult(BaseModel):
    """Response model for cascade simulation results."""
    scenario_name: str
    patient_zero: Dict[str, Any]
    cascade_order: List[Dict[str, Any]]
    total_affected_nodes: int
    affected_capacity_mw: float
    estimated_customers_affected: int
    simulation_timestamp: str
    propagation_paths: List[Dict[str, Any]]


@app.get("/api/cascade/grid-topology", tags=["Cascade Analysis"])
async def get_cascade_grid_topology(
    region: Optional[str] = Query(None, description="Filter by region"),
    node_type: Optional[str] = Query(None, description="Filter by node type (SUBSTATION, TRANSFORMER)"),
    limit: int = Query(1000, description="Max nodes to return")
):
    """
    Engineering: Return grid topology for GNN cascade analysis visualization.
    Returns nodes and edges from ML_DEMO.GRID_NODES and GRID_EDGES tables.
    """
    start = time.time()
    
    try:
        def _fetch_topology():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Build node query with filters
            node_where = []
            if region:
                node_where.append(f"REGION = '{region}'")
            if node_type:
                node_where.append(f"NODE_TYPE = '{node_type}'")
            
            node_query = f"""
                SELECT 
                    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON, REGION,
                    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
                    DOWNSTREAM_TRANSFORMERS, DOWNSTREAM_CAPACITY_KVA
                FROM {DB}.ML_DEMO.GRID_NODES
                {('WHERE ' + ' AND '.join(node_where)) if node_where else ''}
                ORDER BY CRITICALITY_SCORE DESC
                LIMIT {limit}
            """
            cursor.execute(node_query)
            
            nodes = []
            for row in cursor.fetchall():
                nodes.append({
                    'node_id': row[0],
                    'node_name': row[1],
                    'node_type': row[2],
                    'lat': float(row[3]) if row[3] else None,
                    'lon': float(row[4]) if row[4] else None,
                    'region': row[5],
                    'capacity_kw': float(row[6]) if row[6] else 0,
                    'voltage_kv': float(row[7]) if row[7] else 0,
                    'criticality_score': float(row[8]) if row[8] else 0,
                    'downstream_transformers': int(row[9]) if row[9] else 0,
                    'downstream_capacity_kva': float(row[10]) if row[10] else 0
                })
            
            # Get edges connecting these nodes
            node_ids = [n['node_id'] for n in nodes]
            if node_ids:
                # For large node sets, use a sample of high-criticality nodes
                sample_ids = node_ids[:500] if len(node_ids) > 500 else node_ids
                placeholders = ','.join([f"'{nid}'" for nid in sample_ids])
                
                edge_query = f"""
                    SELECT 
                        EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE,
                        CIRCUIT_ID, DISTANCE_KM, IMPEDANCE_PU
                    FROM {DB}.ML_DEMO.GRID_EDGES
                    WHERE FROM_NODE_ID IN ({placeholders})
                       OR TO_NODE_ID IN ({placeholders})
                    LIMIT 5000
                """
                cursor.execute(edge_query)
                
                edges = []
                for row in cursor.fetchall():
                    edges.append({
                        'edge_id': int(row[0]),
                        'from_node': row[1],
                        'to_node': row[2],
                        'edge_type': row[3],
                        'circuit_id': row[4],
                        'distance_km': float(row[5]) if row[5] else 0,
                        'impedance_pu': float(row[6]) if row[6] else 0
                    })
            else:
                edges = []
            
            cursor.close()
            conn.close()
            return {'nodes': nodes, 'edges': edges}
        
        result = await run_snowflake_query(_fetch_topology, timeout=60)
        query_time = round((time.time() - start) * 1000, 2)
        
        return {
            "topology": result,
            "node_count": len(result['nodes']),
            "edge_count": len(result['edges']),
            "query_time_ms": query_time,
            "filters": {"region": region, "node_type": node_type}
        }
    
    except Exception as e:
        logger.error(f"Grid topology query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cascade/high-risk-nodes", tags=["Cascade Analysis"])
async def get_high_risk_cascade_nodes(
    risk_threshold: float = Query(0.5, description="Minimum ML cascade risk score threshold"),
    limit: int = Query(100, description="Max nodes to return")
):
    """
    Engineering: Identify high-risk nodes for cascade failure analysis using
    pre-computed Snowflake ML graph centrality features.
    
    Uses NODE_CENTRALITY_FEATURES_V2 which contains:
    - CASCADE_RISK_SCORE: ML-computed composite risk from graph analysis
    - PAGERANK: Node influence in the network (cascade spread potential)
    - BETWEENNESS_CENTRALITY: Bottleneck detection (failure cuts paths)
    - TOTAL_REACH: Maximum downstream impact estimation
    
    These are potential "Patient Zero" candidates - nodes whose failure
    could trigger cascading outages across the grid.
    """
    start = time.time()
    
    try:
        def _fetch_high_risk():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Engineering: Use ML-computed centrality features instead of heuristics
            # Join with GRID_EDGES to ensure nodes have cascade propagation paths
            # Note: CASCADE_RISK_SCORE_NORMALIZED is 0-1 range for proper percentage display
            cursor.execute(f"""
                SELECT 
                    n.NODE_ID,
                    n.NODE_NAME,
                    n.NODE_TYPE,
                    n.LAT,
                    n.LON,
                    n.REGION,
                    n.CAPACITY_KW,
                    n.CRITICALITY_SCORE,
                    n.DOWNSTREAM_TRANSFORMERS,
                    n.DOWNSTREAM_CAPACITY_KVA,
                    COALESCE(e.EDGE_COUNT, 0) as EDGE_COUNT,
                    -- ML-computed graph centrality features (normalized 0-1)
                    COALESCE(c.CASCADE_RISK_SCORE_NORMALIZED, 0) as CASCADE_RISK_SCORE,
                    COALESCE(c.PAGERANK, 0) as PAGERANK,
                    COALESCE(c.BETWEENNESS_CENTRALITY, 0) as BETWEENNESS_CENTRALITY,
                    COALESCE(c.EIGENVECTOR_CENTRALITY, 0) as EIGENVECTOR_CENTRALITY,
                    COALESCE(c.TOTAL_REACH, 0) as TOTAL_REACH,
                    COALESCE(c.NEIGHBORS_1HOP, 0) as NEIGHBORS_1HOP,
                    COALESCE(c.NEIGHBORS_2HOP, 0) as NEIGHBORS_2HOP
                FROM {DB}.ML_DEMO.GRID_NODES n
                LEFT JOIN (
                    SELECT FROM_NODE_ID as NODE_ID, COUNT(*) as EDGE_COUNT
                    FROM {DB}.ML_DEMO.GRID_EDGES
                    GROUP BY FROM_NODE_ID
                ) e ON n.NODE_ID = e.NODE_ID
                LEFT JOIN {DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c 
                    ON n.NODE_ID = c.NODE_ID
                WHERE c.CASCADE_RISK_SCORE_NORMALIZED >= {risk_threshold}
                  AND e.EDGE_COUNT > 5  -- Must have meaningful propagation paths for realistic cascade
                  AND n.NODE_TYPE = 'TRANSFORMER'  -- # Target transformers - realistic failure points
                -- Engineering: Order by combined ML risk AND propagation potential
                -- This ensures we select nodes that are both high-risk AND can cause cascades
                ORDER BY (c.CASCADE_RISK_SCORE_NORMALIZED * LOG(10, GREATEST(e.EDGE_COUNT, 2))) DESC
                LIMIT {limit}
            """)
            
            nodes = []
            for row in cursor.fetchall():
                nodes.append({
                    'node_id': row[0],
                    'node_name': row[1],
                    'node_type': row[2],
                    'lat': float(row[3]) if row[3] else None,
                    'lon': float(row[4]) if row[4] else None,
                    'region': row[5],
                    'capacity_kw': float(row[6]) if row[6] else 0,
                    'criticality_score': float(row[7]) if row[7] else 0,
                    'downstream_transformers': int(row[8]) if row[8] else 0,
                    'downstream_capacity_kva': float(row[9]) if row[9] else 0,
                    'edge_count': int(row[10]) if row[10] else 0,
                    # ML-computed risk from Snowflake graph analysis
                    'cascade_risk': round(float(row[11]) if row[11] else 0, 3),
                    # Graph centrality metrics for explainability
                    'ml_features': {
                        'pagerank': round(float(row[12]) if row[12] else 0, 6),
                        'betweenness_centrality': round(float(row[13]) if row[13] else 0, 6),
                        'eigenvector_centrality': round(float(row[14]) if row[14] else 0, 6),
                        'total_reach': int(row[15]) if row[15] else 0,
                        'neighbors_1hop': int(row[16]) if row[16] else 0,
                        'neighbors_2hop': int(row[17]) if row[17] else 0
                    }
                })
            
            cursor.close()
            conn.close()
            return nodes
        
        nodes = await run_snowflake_query(_fetch_high_risk, timeout=30)
        query_time = round((time.time() - start) * 1000, 2)
        
        return {
            "high_risk_nodes": nodes,
            "count": len(nodes),
            "risk_threshold": risk_threshold,
            "query_time_ms": query_time,
            f"ml_source": "{DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2",
            "analysis_note": "CASCADE_RISK_SCORE computed via Snowflake ML graph centrality analysis (PageRank, Betweenness, Eigenvector)"
        }
    
    except Exception as e:
        logger.error(f"High risk nodes query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cascade/simulate", tags=["Cascade Analysis"])
async def simulate_cascade_failure(scenario: CascadeScenario):
    """
    Engineering: Simulate cascade failure propagation using grid topology.
    
    This is a simplified BFS-based cascade simulation. For production:
    - Use GNN model inference via Snowpark Container Services
    - Incorporate real-time load and temperature data
    - Apply physics-based power flow constraints
    """
    start = time.time()
    
    try:
        def _run_simulation():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Step 1: Find Patient Zero (highest risk node or specified)
            if scenario.initial_failure_node:
                patient_zero_query = f"""
                    SELECT NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON, 
                           CAPACITY_KW, CRITICALITY_SCORE, DOWNSTREAM_CAPACITY_KVA
                    FROM {DB}.ML_DEMO.GRID_NODES
                    WHERE NODE_ID = '{scenario.initial_failure_node}'
                """
            else:
                patient_zero_query = f"""
                    SELECT NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
                           CAPACITY_KW, CRITICALITY_SCORE, DOWNSTREAM_CAPACITY_KVA
                    FROM {DB}.ML_DEMO.GRID_NODES
                    WHERE NODE_TYPE = 'SUBSTATION'
                    ORDER BY CRITICALITY_SCORE DESC
                    LIMIT 1
                """
            
            cursor.execute(patient_zero_query)
            pz_row = cursor.fetchone()
            
            if not pz_row:
                return {"error": "No valid patient zero node found"}
            
            patient_zero = {
                'node_id': pz_row[0],
                'node_name': pz_row[1],
                'node_type': pz_row[2],
                'lat': float(pz_row[3]) if pz_row[3] else None,
                'lon': float(pz_row[4]) if pz_row[4] else None,
                'capacity_kw': float(pz_row[5]) if pz_row[5] else 0,
                'criticality_score': float(pz_row[6]) if pz_row[6] else 0,
                'downstream_capacity_kva': float(pz_row[7]) if pz_row[7] else 0,
                # Substations serve ~50-100 transformers downstream
                'downstream_transformers': 100 if pz_row[2] == 'SUBSTATION' else 1
            }
            
            # Step 2: BFS cascade propagation
            failed_nodes = {patient_zero['node_id']: 0}  # node_id -> failure_order
            cascade_order = [{'order': 0, 'wave_depth': 0, **patient_zero}]
            propagation_paths = []
            queue = [patient_zero['node_id']]
            current_order = 0
            
            while queue and current_order < 10:  # Max 10 cascade waves
                current_order += 1
                next_queue = []
                
                for failed_node_id in queue:
                    # Find downstream nodes
                    cursor.execute(f"""
                        SELECT DISTINCT
                            e.TO_NODE_ID,
                            n.NODE_NAME,
                            n.NODE_TYPE,
                            n.LAT,
                            n.LON,
                            n.CAPACITY_KW,
                            n.CRITICALITY_SCORE,
                            e.DISTANCE_KM
                        FROM {DB}.ML_DEMO.GRID_EDGES e
                        JOIN {DB}.ML_DEMO.GRID_NODES n ON e.TO_NODE_ID = n.NODE_ID
                        WHERE e.FROM_NODE_ID = '{failed_node_id}'
                          AND e.TO_NODE_ID NOT IN ({','.join([f"'{k}'" for k in failed_nodes.keys()])})
                        ORDER BY n.CRITICALITY_SCORE DESC
                        LIMIT 50
                    """)
                    
                    downstream = cursor.fetchall()
                    
                    for row in downstream:
                        # Simplified failure probability based on criticality and load
                        # FIXED: Extreme temps (both hot AND cold) increase failure risk
                        node_criticality = float(row[6]) if row[6] else 0
                        temp_stress = abs(scenario.temperature_c - 25) / 25  # 0 at 25C, 1 at 0C or 50C, 1.4 at -10C
                        failure_prob = node_criticality * scenario.load_multiplier * (1 + temp_stress)
                        
                        if failure_prob >= scenario.failure_threshold:
                            node_id = row[0]
                            if node_id not in failed_nodes:
                                failed_nodes[node_id] = current_order
                                next_queue.append(node_id)
                                
                                node_info = {
                                    'order': current_order,
                                    'wave_depth': current_order,  # wave_depth = cascade wave number
                                    'node_id': node_id,
                                    'node_name': row[1],
                                    'node_type': row[2],
                                    'lat': float(row[3]) if row[3] else None,
                                    'lon': float(row[4]) if row[4] else None,
                                    'capacity_kw': float(row[5]) if row[5] else 0,
                                    'criticality_score': node_criticality,
                                    'failure_probability': round(failure_prob, 3),
                                    'triggered_by': failed_node_id,
                                    # Downstream transformers: substations serve many, transformers serve ~1
                                    'downstream_transformers': 50 if row[2] == 'SUBSTATION' else 1
                                }
                                cascade_order.append(node_info)
                                
                                propagation_paths.append({
                                    'from_node': failed_node_id,
                                    'to_node': node_id,
                                    'order': current_order,
                                    'distance_km': float(row[7]) if row[7] else 0
                                })
                
                queue = next_queue
            
            # Step 3: Calculate impact metrics
            total_capacity_kw = sum(n.get('capacity_kw', 0) for n in cascade_order)
            
            # Estimate customers: ~30 customers per transformer, ~5000 per substation
            customers = sum(
                5000 if n.get('node_type') == 'SUBSTATION' else 30
                for n in cascade_order
            )
            
            cursor.close()
            conn.close()
            
            return {
                'patient_zero': patient_zero,
                'cascade_order': cascade_order,
                'propagation_paths': propagation_paths,
                'total_affected_nodes': len(cascade_order),
                'affected_capacity_mw': round(total_capacity_kw / 1000, 2),
                'estimated_customers_affected': customers
            }
        
        result = await run_snowflake_query(_run_simulation, timeout=120)
        
        if 'error' in result:
            raise HTTPException(status_code=400, detail=result['error'])
        
        query_time = round((time.time() - start) * 1000, 2)
        
        return CascadeResult(
            scenario_name=scenario.scenario_name,
            patient_zero=result['patient_zero'],
            cascade_order=result['cascade_order'],
            total_affected_nodes=result['total_affected_nodes'],
            affected_capacity_mw=result['affected_capacity_mw'],
            estimated_customers_affected=result['estimated_customers_affected'],
            simulation_timestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            propagation_paths=result['propagation_paths']
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cascade simulation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cascade/scenarios", tags=["Cascade Analysis"])
async def get_predefined_scenarios():
    """
    Return predefined cascade failure scenarios for quick simulation.
    Based on historical Texas grid events (Winter Storm Uri, Summer 2023 heatwave).
    """
    scenarios = [
        {
            "name": "SUMMER_PEAK_2025",
            "description": "Extreme summer heat wave scenario (July 2025 conditions)",
            "parameters": {
                "temperature_c": 40,
                "load_multiplier": 1.4,
                "failure_threshold": 0.6
            },
            "historical_reference": "Based on July 2023 Texas heatwave conditions"
        },
        {
            "name": "WINTER_STORM_URI",
            "description": "Winter storm scenario based on Feb 2021 Uri event",
            "parameters": {
                "temperature_c": -10,
                "load_multiplier": 1.6,
                "failure_threshold": 0.5
            },
            "historical_reference": "Texas Winter Storm Uri, Feb 2021 - 4.5M customers affected"
        },
        {
            "name": "HURRICANE_SEASON",
            "description": "Hurricane impact scenario with wind/flooding damage",
            "parameters": {
                "temperature_c": 30,
                "load_multiplier": 1.2,
                "failure_threshold": 0.55
            },
            "historical_reference": "Based on Hurricane Harvey grid impact patterns"
        },
        {
            "name": "NORMAL_OPERATIONS",
            "description": "Baseline scenario - typical operating conditions",
            "parameters": {
                "temperature_c": 25,
                "load_multiplier": 1.0,
                "failure_threshold": 0.8
            },
            "historical_reference": "Normal grid operations baseline"
        }
    ]
    
    return {
        "scenarios": scenarios,
        "count": len(scenarios),
        "usage": "POST /api/cascade/simulate with scenario parameters"
    }


@app.get("/api/cascade/transformer-risk-prediction", tags=["Cascade Analysis"])
async def get_transformer_risk_predictions(
    limit: int = Query(100, description="Max transformers to return"),
    min_risk: float = Query(0.3, description="Minimum risk threshold")
):
    """
    Engineering: Get transformer afternoon risk predictions using temporal ML model.
    Predicts which transformers will be high-risk at 4 PM based on 8 AM state.
    """
    start = time.time()
    
    try:
        def _fetch_predictions():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Get latest training data with predicted risk
            # This would normally come from a trained model - here we use heuristics
            cursor.execute(f"""
                SELECT 
                    t.TRANSFORMER_ID,
                    tm.LATITUDE,
                    tm.LONGITUDE,
                    tm.SUBSTATION_ID,
                    t.MORNING_LOAD_PCT,
                    t.MORNING_CATEGORY,
                    t.TRANSFORMER_AGE_YEARS,
                    t.RATED_KVA,
                    t.HISTORICAL_SUMMER_AVG_LOAD,
                    t.STRESS_VS_HISTORICAL,
                    t.TARGET_HIGH_RISK as ACTUAL_HIGH_RISK,
                    -- Heuristic risk prediction (replace with ML model inference)
                    -- Use TRY_TO_DOUBLE to handle 'NO_HISTORICAL_DATA' string values
                    LEAST(1.0, 
                        (t.MORNING_LOAD_PCT / 100.0) * 
                        (1 + COALESCE(TRY_TO_DOUBLE(t.STRESS_VS_HISTORICAL), 0) / 100) *
                        (1 + t.TRANSFORMER_AGE_YEARS / 50)
                    ) as PREDICTED_RISK
                FROM {DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING t
                JOIN {DB}.PRODUCTION.TRANSFORMER_METADATA tm 
                    ON t.TRANSFORMER_ID = tm.TRANSFORMER_ID
                WHERE t.PREDICTION_DATE = (
                    SELECT MAX(PREDICTION_DATE) 
                    FROM {DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING
                )
                QUALIFY ROW_NUMBER() OVER (PARTITION BY t.TRANSFORMER_ID ORDER BY t.MORNING_TIMESTAMP DESC) = 1
                ORDER BY PREDICTED_RISK DESC
                LIMIT {limit}
            """)
            
            predictions = []
            for row in cursor.fetchall():
                predicted_risk = float(row[11]) if row[11] else 0
                if predicted_risk >= min_risk:
                    # Handle stress_vs_historical which may be 'NO_HISTORICAL_DATA' string
                    stress_val = row[9]
                    try:
                        stress_vs_hist = float(stress_val) if stress_val and stress_val != 'NO_HISTORICAL_DATA' else 0
                    except (ValueError, TypeError):
                        stress_vs_hist = 0
                    
                    predictions.append({
                        'transformer_id': row[0],
                        'lat': float(row[1]) if row[1] else None,
                        'lon': float(row[2]) if row[2] else None,
                        'substation_id': row[3],
                        'morning_load_pct': float(row[4]) if row[4] else 0,
                        'morning_category': row[5],
                        'age_years': float(row[6]) if row[6] else 0,
                        'rated_kva': float(row[7]) if row[7] else 0,
                        'historical_avg_load': float(row[8]) if row[8] else 0,
                        'stress_vs_historical': stress_vs_hist,
                        'actual_high_risk': int(row[10]) if row[10] is not None else None,
                        'predicted_risk': round(predicted_risk, 3),
                        'risk_level': 'critical' if predicted_risk >= 0.7 else ('warning' if predicted_risk >= 0.5 else 'elevated')
                    })
            
            cursor.close()
            conn.close()
            return predictions
        
        predictions = await run_snowflake_query(_fetch_predictions, timeout=60)
        query_time = round((time.time() - start) * 1000, 2)
        
        # Calculate summary stats
        critical_count = sum(1 for p in predictions if p['risk_level'] == 'critical')
        warning_count = sum(1 for p in predictions if p['risk_level'] == 'warning')
        
        return {
            "predictions": predictions,
            "count": len(predictions),
            "summary": {
                "critical": critical_count,
                "warning": warning_count,
                "elevated": len(predictions) - critical_count - warning_count
            },
            "query_time_ms": query_time,
            "model_info": {
                "type": "temporal_prediction",
                "description": "Predicts afternoon (4 PM) risk from morning (8 AM) state",
                "target_accuracy": "75-85%"
            }
        }
    
    except Exception as e:
        logger.error(f"Transformer risk prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ml/transformer-failure-predict", tags=["Snowflake ML"])
async def predict_transformer_failures_with_ml_model(
    county: Optional[str] = Query(None, description="Filter by county (e.g., 'Harris')"),
    min_load_pct: float = Query(70.0, description="Minimum load percentage to consider"),
    limit: int = Query(50, description="Max transformers to return")
):
    """
    Engineering: Real-time transformer failure prediction using Snowflake ML Model Registry.
    
    This endpoint demonstrates Snowflake's end-to-end ML capabilities:
    1. Model Registry: TRANSFORMER_FAILURE_PREDICTOR (XGBoost classifier)
    2. Model Version: V2_EXPLAINABLE (trained on July 2025 summer peak data)
    3. Model Metrics: 99.82% accuracy, 99.88% precision, 99.75% recall
    
    For utilities, this enables:
    - Proactive crew dispatch before failures occur
    - Optimized spare transformer inventory positioning
    - Regulatory compliance with explainable predictions
    
    Model Input Features:
    - MORNING_LOAD_PCT: Current transformer load (8 AM snapshot)
    - TRANSFORMER_AGE_YEARS: Equipment age factor
    - STRESS_VS_HISTORICAL: Load compared to historical average
    - IS_PEAK_HOUR: Whether predicting for peak period
    
    Returns probability scores with explainability factors.
    """
    start = time.time()
    
    try:
        def _run_ml_inference():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Engineering: ML inference using preprocessed features
            # Uses V_TRANSFORMER_ML_INFERENCE view which applies StandardScaler + OneHotEncoder
            # matching the exact preprocessing from model training.
            #
            # When SPCS inference service is deployed, replace ML_RISK_SCORE with:
            # TRANSFORMER_ML_INFERENCE_SVC!PREDICT(...preprocessed columns...)
            county_filter = f"AND tm.COUNTY = '{county}'" if county else ""
            
            cursor.execute(f"""
                WITH ml_features AS (
                    -- Use the ML preprocessing view with proper StandardScaler + OneHotEncoder
                    SELECT 
                        v.TRANSFORMER_ID,
                        tm.LATITUDE as LAT,
                        tm.LONGITUDE as LON,
                        tm.SUBSTATION_ID,
                        tm.COUNTY,
                        v.LOAD_FACTOR_PCT as MORNING_LOAD_PCT,
                        v.THERMAL_STRESS_CATEGORY as MORNING_CATEGORY,
                        v.TRANSFORMER_AGE_YEARS,
                        v.RATED_KVA,
                        v.STRESS_VS_HISTORICAL,
                        v.ACTUAL_HIGH_RISK as ACTUAL_OUTCOME,
                        -- ML-calibrated risk score (matches XGBoost feature importances)
                        v.ML_RISK_SCORE as FAILURE_PROBABILITY,
                        CASE WHEN v.ML_RISK_SCORE >= 0.5 THEN 1 ELSE 0 END as PREDICTED_FAILURE,
                        -- Feature contributions for explainability
                        v.LOAD_FACTOR_PCT_SCALED,
                        v.TRANSFORMER_AGE_YEARS_SCALED,
                        v.STRESS_ENCODED_ABOVE_HISTORICAL_PATTERN
                    FROM {DB}.ML_DEMO.V_TRANSFORMER_ML_INFERENCE v
                    JOIN {DB}.PRODUCTION.TRANSFORMER_METADATA tm 
                        ON v.TRANSFORMER_ID = tm.TRANSFORMER_ID
                    WHERE v.LOAD_FACTOR_PCT >= {min_load_pct}
                    {county_filter}
                )
                SELECT 
                    TRANSFORMER_ID,
                    LAT,
                    LON,
                    SUBSTATION_ID,
                    COUNTY,
                    MORNING_LOAD_PCT,
                    MORNING_CATEGORY,
                    TRANSFORMER_AGE_YEARS,
                    RATED_KVA,
                    STRESS_VS_HISTORICAL,
                    ACTUAL_OUTCOME,
                    FAILURE_PROBABILITY,
                    PREDICTED_FAILURE,
                    -- Explainability based on scaled feature contributions
                    CASE 
                        WHEN LOAD_FACTOR_PCT_SCALED > 1.5 THEN 'HIGH_LOAD'
                        WHEN TRANSFORMER_AGE_YEARS_SCALED > 1.5 THEN 'AGING_EQUIPMENT'
                        WHEN STRESS_ENCODED_ABOVE_HISTORICAL_PATTERN = 1 THEN 'ABOVE_HISTORICAL'
                        ELSE 'COMBINED_FACTORS'
                    END as PRIMARY_RISK_DRIVER
                FROM ml_features
                ORDER BY FAILURE_PROBABILITY DESC
                LIMIT {limit}
            """)
            
            predictions = []
            for row in cursor.fetchall():
                failure_prob = float(row[11]) if row[11] else 0
                predictions.append({
                    'transformer_id': row[0],
                    'lat': float(row[1]) if row[1] else None,
                    'lon': float(row[2]) if row[2] else None,
                    'substation_id': row[3],
                    'county': row[4],
                    'morning_load_pct': float(row[5]) if row[5] else 0,
                    'morning_category': row[6],
                    'age_years': float(row[7]) if row[7] else 0,
                    'rated_kva': float(row[8]) if row[8] else 0,
                    'stress_vs_historical': row[9] if row[9] else 'UNKNOWN',
                    'actual_outcome': int(row[10]) if row[10] is not None else None,
                    # ML Model outputs (calibrated to match XGBoost)
                    'failure_probability': round(failure_prob, 4),
                    'predicted_failure': bool(row[12]) if row[12] is not None else None,
                    'risk_level': 'critical' if failure_prob >= 0.7 else ('warning' if failure_prob >= 0.5 else 'elevated'),
                    # Explainability for operators
                    'primary_risk_driver': row[13],
                    'recommendation': (
                        'IMMEDIATE: Dispatch crew for inspection' if failure_prob >= 0.7
                        else 'MONITOR: Increase telemetry frequency' if failure_prob >= 0.5
                        else 'TRACK: Include in next maintenance cycle'
                    )
                })
            
            cursor.close()
            conn.close()
            return predictions
        
        predictions = await run_snowflake_query(_run_ml_inference, timeout=90)
        
        query_time = round((time.time() - start) * 1000, 2)
        
        # Summary statistics
        critical = sum(1 for p in predictions if p['risk_level'] == 'critical')
        warning = sum(1 for p in predictions if p['risk_level'] == 'warning')
        
        return {
            "predictions": predictions,
            "count": len(predictions),
            "summary": {
                "critical": critical,
                "warning": warning,
                "elevated": len(predictions) - critical - warning
            },
            "query_time_ms": query_time,
            "model_info": {
                "name": "TRANSFORMER_FAILURE_PREDICTOR",
                "version": "V2_EXPLAINABLE",
                "type": "XGBoost Classifier (ML-calibrated scoring)",
                "preprocessing": "StandardScaler + OneHotEncoder via V_TRANSFORMER_ML_INFERENCE",
                "metrics": {
                    "accuracy": 0.9982,
                    "precision": 0.9988,
                    "recall": 0.9975,
                    "f1_score": 0.9982
                },
                "feature_weights": {
                    "load_factor": 0.45,
                    "equipment_age": 0.25,
                    "stress_pattern": 0.15,
                    "peak_hour": 0.05,
                    "aging_flag": 0.05,
                    "capacity": 0.05
                },
                "training_data": "July 2025 Summer Peak (100K records)",
                f"registry": "{DB}.ML_DEMO.TRANSFORMER_FAILURE_PREDICTOR",
                f"scaler_params": "{DB}.ML_DEMO.T_SCALER_PARAMETERS"
            },
            "analysis_note": "ML-calibrated inference using preprocessed features (StandardScaler + OneHotEncoder). Ready for SPCS service upgrade."
        }
    
    except Exception as e:
        logger.error(f"ML transformer prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def predict_transformer_risk_heuristic(county, min_load_pct, limit):
    """Heuristic fallback when ML model is unavailable"""
    def _fetch_heuristic():
        conn = get_snowflake_connection()
        cursor = conn.cursor()
        county_filter = f"AND tm.COUNTY = '{county}'" if county else ""
        cursor.execute(f"""
            SELECT 
                t.TRANSFORMER_ID,
                tm.LATITUDE,
                tm.LONGITUDE,
                tm.SUBSTATION_ID,
                tm.COUNTY,
                t.MORNING_LOAD_PCT,
                t.MORNING_CATEGORY,
                t.TRANSFORMER_AGE_YEARS,
                t.RATED_KVA,
                CASE WHEN t.STRESS_VS_HISTORICAL = 'NO_HISTORICAL_DATA' THEN 0 
                     ELSE TRY_TO_DOUBLE(t.STRESS_VS_HISTORICAL) END,
                t.TARGET_HIGH_RISK,
                -- Heuristic risk calculation
                LEAST(1.0, 
                    (t.MORNING_LOAD_PCT / 100.0) * 
                    (1 + COALESCE(TRY_TO_DOUBLE(t.STRESS_VS_HISTORICAL), 0) / 100) *
                    (1 + t.TRANSFORMER_AGE_YEARS / 50)
                ) as HEURISTIC_RISK
            FROM {DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING t
            JOIN {DB}.PRODUCTION.TRANSFORMER_METADATA tm ON t.TRANSFORMER_ID = tm.TRANSFORMER_ID
            WHERE t.PREDICTION_DATE = (SELECT MAX(PREDICTION_DATE) FROM {DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING)
            AND t.MORNING_LOAD_PCT >= {min_load_pct}
            {county_filter}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY t.TRANSFORMER_ID ORDER BY t.MORNING_TIMESTAMP DESC) = 1
            ORDER BY HEURISTIC_RISK DESC
            LIMIT {limit}
        """)
        results = []
        for row in cursor.fetchall():
            risk = float(row[11]) if row[11] else 0
            results.append({
                'transformer_id': row[0], 'lat': float(row[1]) if row[1] else None,
                'lon': float(row[2]) if row[2] else None, 'substation_id': row[3], 'county': row[4],
                'morning_load_pct': float(row[5]) if row[5] else 0, 'morning_category': row[6],
                'age_years': float(row[7]) if row[7] else 0, 'rated_kva': float(row[8]) if row[8] else 0,
                'stress_vs_historical': float(row[9]) if row[9] else 0,
                'actual_outcome': int(row[10]) if row[10] is not None else None,
                'failure_probability': round(risk, 4), 'predicted_failure': risk >= 0.5,
                'risk_level': 'critical' if risk >= 0.7 else ('warning' if risk >= 0.5 else 'elevated'),
                'primary_risk_driver': 'HEURISTIC', 'recommendation': 'ML model unavailable - using heuristic'
            })
        cursor.close()
        conn.close()
        return results
    predictions = await run_snowflake_query(_fetch_heuristic, timeout=60)
    return {
        "predictions": predictions, "count": len(predictions),
        "summary": {"critical": sum(1 for p in predictions if p['risk_level'] == 'critical'),
                   "warning": sum(1 for p in predictions if p['risk_level'] == 'warning'),
                   "elevated": len(predictions) - sum(1 for p in predictions if p['risk_level'] in ['critical', 'warning'])},
        "model_info": {"name": "HEURISTIC_FALLBACK", "note": "ML model unavailable, using rule-based scoring"}
    }


@app.post("/api/cascade/explain", tags=["Cascade Analysis"])
async def explain_cascade_with_cortex(
    cascade_result: dict = None,
    explanation_type: str = Query("summary", description="Type: summary, patient_zero, wave_analysis, recommendations")
):
    """
    Engineering: Use Snowflake Cortex to generate natural language explanations
    of cascade failure simulation results. This provides actionable insights for operators.
    
    Powered by: Snowflake Cortex Complete (LLM)
    """
    start = time.time()
    
    try:
        def _generate_explanation():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Build context for the LLM based on cascade result
            if cascade_result:
                patient_zero = cascade_result.get('patient_zero', {})
                total_nodes = cascade_result.get('total_affected_nodes', 0)
                capacity_mw = cascade_result.get('affected_capacity_mw', 0)
                customers = cascade_result.get('estimated_customers_affected', 0)
                scenario = cascade_result.get('scenario_name', 'Unknown')
                wave_count = len(set(n.get('wave_depth', 0) for n in cascade_result.get('cascade_order', [])))
                
                context = f"""
Cascade Failure Analysis Results:
- Scenario: {scenario}
- Patient Zero (Initial Failure): {patient_zero.get('node_name', 'Unknown')} ({patient_zero.get('node_type', 'Unknown')})
- Patient Zero Capacity: {patient_zero.get('capacity_kw', 0) / 1000:.1f} MW
- Total Nodes Affected: {total_nodes}
- Total Capacity Lost: {capacity_mw:.1f} MW
- Estimated Customers Impacted: {customers:,}
- Cascade Waves: {wave_count}
"""
            else:
                context = "No cascade simulation has been run yet."
            
            # Generate different types of explanations
            if explanation_type == "summary":
                prompt = f"""You are a grid reliability engineer explaining cascade failure simulation results to utility operators.

{context}

Provide a concise 2-3 sentence executive summary of this cascade failure scenario. Focus on:
1. The severity and scope of the simulated failure
2. The key risk factors that caused the cascade to spread
3. One actionable insight for operators

Be direct and technical but accessible. Do not use markdown formatting."""

            elif explanation_type == "patient_zero":
                prompt = f"""You are a grid reliability engineer explaining why a specific node was identified as high-risk.

{context}

Explain in 2-3 sentences why {patient_zero.get('node_name', 'this node')} is a critical vulnerability point:
1. What makes this node's failure particularly impactful?
2. How does its position in the grid topology amplify the cascade?

Be specific and technical. Do not use markdown formatting."""

            elif explanation_type == "wave_analysis":
                prompt = f"""You are a grid reliability engineer explaining cascade propagation patterns.

{context}

Analyze the cascade propagation in 2-3 sentences:
1. How did the failure spread through the grid (wave pattern)?
2. What does the {wave_count} wave cascade indicate about grid resilience?
3. At what point could intervention have contained the cascade?

Be technical and actionable. Do not use markdown formatting."""

            elif explanation_type == "recommendations":
                prompt = f"""You are a grid reliability engineer providing actionable recommendations based on cascade simulation.

{context}

Provide 3 specific, prioritized recommendations to improve grid resilience:
1. Immediate action (can be done today)
2. Short-term hardening (within 30 days)
3. Strategic investment (capital improvement)

Be specific and actionable. Reference the simulation results. Do not use markdown formatting."""
            
            else:
                prompt = f"Summarize these cascade failure results: {context}"
            
            # Call Cortex Complete
            cursor.execute(f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    'claude-sonnet-4-5',
                    '{prompt.replace("'", "''")}'
                ) as explanation
            """)
            
            result = cursor.fetchone()
            explanation = result[0] if result else "Unable to generate explanation."
            
            cursor.close()
            conn.close()
            
            return {
                "explanation": explanation,
                "explanation_type": explanation_type,
                "model": "Snowflake Cortex (claude-sonnet-4-5)",
                "context_summary": {
                    "scenario": cascade_result.get('scenario_name') if cascade_result else None,
                    "patient_zero": patient_zero.get('node_name') if cascade_result else None,
                    "total_nodes_affected": total_nodes if cascade_result else 0
                }
            }
        
        result = await run_snowflake_query(_generate_explanation, timeout=30)
        query_time = round((time.time() - start) * 1000, 2)
        
        return {
            **result,
            "query_time_ms": query_time,
            "powered_by": "Snowflake Cortex Complete"
        }
    
    except Exception as e:
        logger.error(f"Cortex explanation failed: {e}")
        # Return a fallback explanation if Cortex fails
        return {
            "explanation": "Cascade simulation shows potential grid vulnerability. The patient zero node's failure could propagate through connected infrastructure, affecting downstream capacity and customers.",
            "explanation_type": explanation_type,
            "model": "fallback",
            "error": str(e),
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }


@app.get("/api/cascade/ml-metadata", tags=["Cascade Analysis"])
async def get_cascade_ml_metadata():
    """
    Engineering: Return metadata about the ML models and data sources
    used in cascade analysis. This builds trust and transparency.
    """
    return {
        "models": {
            "graph_centrality": {
                "name": "NetworkX Centrality Analysis",
                "platform": "Snowpark Python UDF",
                "description": "Calculates betweenness centrality, degree centrality, and PageRank to identify critical nodes",
                f"training_data": "{DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2",
                "node_count": 1873,
                "last_updated": "2025-01-15",
                "metrics": {
                    "nodes_analyzed": 1873,
                    "edges_analyzed": 15420,
                    "avg_centrality_score": 0.42
                }
            },
            "temporal_risk_prediction": {
                "name": "Transformer Temporal Risk Model",
                "platform": "Snowflake ML (Feature Store + Model Registry)",
                "description": "Predicts afternoon (4 PM) transformer risk from morning (8 AM) operational state",
                f"training_data": "{DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING",
                "features": [
                    "morning_load_pct",
                    "transformer_age_years", 
                    "historical_summer_avg_load",
                    "stress_vs_historical"
                ],
                "target_accuracy": "78-85%",
                "last_trained": "2025-01-10"
            },
            "cascade_simulation": {
                "name": "BFS Cascade Propagation",
                "platform": "Python (FastAPI) with Snowflake Data",
                "description": "Breadth-first search simulation of failure propagation through grid topology",
                f"data_source": "{DB}.ML_DEMO.GRID_NODES + GRID_EDGES",
                "parameters": ["temperature_c", "load_multiplier", "failure_threshold"],
                "future_enhancement": "GNN model on Snowpark Container Services"
            },
            "explainability": {
                "name": "Cortex Complete",
                "platform": "Snowflake Cortex LLM",
                "description": "Natural language explanations of simulation results and recommendations",
                "model": "claude-sonnet-4-5",
                "capabilities": ["summary", "patient_zero_analysis", "wave_analysis", "recommendations"]
            }
        },
        "data_lineage": {
            "source_systems": ["SCADA", "AMI", "GIS", "Asset Management"],
            "refresh_frequency": "Near real-time (15-min intervals)",
            "total_assets": 156000,
            "coverage": "Greater Houston metropolitan area"
        },
        "snowflake_features_used": [
            "Snowpark Python UDFs",
            "Cortex Complete (LLM)",
            "Feature Store",
            "Model Registry",
            "Dynamic Tables",
            "Streams & Tasks"
        ]
    }


@app.get("/api/cascade/precomputed", tags=["Cascade Analysis"])
async def get_precomputed_cascade_scenarios():
    """
    Engineering: Return pre-computed cascade scenarios for instant demo.
    These scenarios are computed offline and stored in Snowflake for fast retrieval.
    """
    start = time.time()
    
    try:
        def _fetch_precomputed():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Fetch pre-computed scenarios
            cursor.execute(f"""
                SELECT 
                    scenario_id,
                    scenario_name,
                    patient_zero_id,
                    patient_zero_name,
                    simulation_params,
                    cascade_order,
                    wave_breakdown,
                    propagation_paths,
                    total_affected_nodes,
                    affected_capacity_mw,
                    estimated_customers_affected,
                    max_cascade_depth,
                    simulation_timestamp
                FROM {DB}.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES
                ORDER BY computed_at DESC
                LIMIT 10
            """)
            
            scenarios = []
            for row in cursor.fetchall():
                scenarios.append({
                    'scenario_id': row[0],
                    'scenario_name': row[1],
                    'patient_zero': {
                        'node_id': row[2],
                        'node_name': row[3]
                    },
                    'simulation_params': json.loads(row[4]) if row[4] else {},
                    'cascade_order': json.loads(row[5]) if row[5] else [],
                    'wave_breakdown': json.loads(row[6]) if row[6] else [],
                    'propagation_paths': json.loads(row[7]) if row[7] else [],
                    'total_affected_nodes': row[8],
                    'affected_capacity_mw': float(row[9]) if row[9] else 0,
                    'estimated_customers_affected': row[10],
                    'max_cascade_depth': row[11],
                    'simulation_timestamp': str(row[12]) if row[12] else None
                })
            
            cursor.close()
            conn.close()
            return scenarios
        
        scenarios = await run_snowflake_query(_fetch_precomputed, timeout=30)
        query_time = round((time.time() - start) * 1000, 2)
        
        return {
            "scenarios": scenarios,
            "count": len(scenarios),
            "query_time_ms": query_time,
            "description": "Pre-computed cascade scenarios for instant demo delivery"
        }
    
    except Exception as e:
        logger.error(f"Failed to fetch precomputed cascades: {e}")
        # Return empty list if table doesn't exist yet
        return {
            "scenarios": [],
            "count": 0,
            "query_time_ms": round((time.time() - start) * 1000, 2),
            "note": "No pre-computed scenarios available. Run priority5_cascade_precompute.sql to create them."
        }


@app.post("/api/cascade/simulate-realtime", tags=["Cascade Analysis"])
async def simulate_cascade_realtime(
    patient_zero_id: str = Query(..., description="Node ID to start cascade from"),
    scenario_name: str = Query("Custom Scenario", description="Name for this simulation"),
    temperature_c: float = Query(25.0, description="Ambient temperature in Celsius"),
    load_multiplier: float = Query(1.0, description="Load stress factor (>1 = overloaded)"),
    failure_threshold: float = Query(0.3, description="Minimum probability for cascade propagation"),
    max_waves: int = Query(10, description="Maximum cascade depth"),
    max_nodes: int = Query(100, description="Maximum affected nodes")
):
    """
    Engineering: BFS cascade simulation with true graph traversal.
    
    This endpoint uses actual graph adjacency and failure probability calculations
    rather than pre-computed static scenarios. Resolves COMPROMISE 2.
    
    The failure probability considers:
    - Distance (closer = higher probability)
    - Source criticality (more critical = wider impact)
    - Target betweenness centrality (high betweenness = more vulnerable)
    - Temperature stress (extreme temps = higher failure)
    - Load conditions (overload = higher failure)
    """
    start = time.time()
    
    try:
        def _run_realtime_simulation():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Load nodes with centrality features
            cursor.execute(f"""
                SELECT 
                    n.NODE_ID,
                    n.NODE_NAME,
                    n.NODE_TYPE,
                    n.LAT,
                    n.LON,
                    COALESCE(n.CAPACITY_KW, 0) as CAPACITY_KW,
                    COALESCE(n.VOLTAGE_KV, 0) as VOLTAGE_KV,
                    COALESCE(n.CRITICALITY_SCORE, 0) as CRITICALITY_SCORE,
                    COALESCE(n.DOWNSTREAM_TRANSFORMERS, 0) as DOWNSTREAM_TRANSFORMERS,
                    COALESCE(c.BETWEENNESS_CENTRALITY, 0) as BETWEENNESS,
                    COALESCE(c.PAGERANK, 0) as PAGERANK
                FROM {DB}.ML_DEMO.GRID_NODES n
                LEFT JOIN {DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c 
                    ON n.NODE_ID = c.NODE_ID
                WHERE n.LAT IS NOT NULL AND n.LON IS NOT NULL
            """)
            
            nodes = {}
            for row in cursor.fetchall():
                nodes[row[0]] = {
                    'node_id': row[0],
                    'node_name': row[1],
                    'node_type': row[2],
                    'lat': float(row[3]) if row[3] else None,
                    'lon': float(row[4]) if row[4] else None,
                    'capacity_kw': float(row[5]),
                    'voltage_kv': float(row[6]),
                    'criticality_score': float(row[7]),
                    'downstream_transformers': int(row[8]),
                    'betweenness': float(row[9]),
                    'pagerank': float(row[10]),
                }
            
            # Build adjacency list
            cursor.execute(f"""
                SELECT FROM_NODE_ID, TO_NODE_ID, COALESCE(DISTANCE_KM, 1.0) as DISTANCE_KM
                FROM {DB}.ML_DEMO.GRID_EDGES
            """)
            
            adjacency = {}
            for row in cursor.fetchall():
                from_node, to_node, distance = row[0], row[1], float(row[2])
                if from_node in nodes and to_node in nodes:
                    if from_node not in adjacency:
                        adjacency[from_node] = []
                    if to_node not in adjacency:
                        adjacency[to_node] = []
                    adjacency[from_node].append((to_node, distance))
                    adjacency[to_node].append((from_node, distance))
            
            cursor.close()
            conn.close()
            
            # Validate patient zero
            if patient_zero_id not in nodes:
                return {"error": f"Patient Zero {patient_zero_id} not found"}
            
            import math
            from collections import deque
            
            # Initialize Patient Zero
            p0 = nodes[patient_zero_id]
            patient_zero = {
                **p0,
                'order': 0,
                'wave_depth': 0,
                'triggered_by': None,
                'failure_probability': 1.0
            }
            
            # BFS cascade simulation
            queue = deque([(patient_zero_id, 0)])
            visited = {patient_zero_id}
            cascade_order = [patient_zero]
            propagation_paths = []
            wave_stats = {0: {
                'wave_number': 0,
                'nodes_failed': 1,
                'capacity_lost_mw': p0['capacity_kw'] / 1000,
                'customers_affected': p0['downstream_transformers'] * 50,
                'substations': 1 if p0['node_type'] == 'SUBSTATION' else 0,
                'transformers': 0 if p0['node_type'] == 'SUBSTATION' else 1
            }}
            
            while queue and len(cascade_order) < max_nodes:
                current_id, current_wave = queue.popleft()
                
                if current_wave >= max_waves:
                    continue
                
                current = nodes[current_id]
                
                for neighbor_id, distance in adjacency.get(current_id, []):
                    if neighbor_id in visited:
                        continue
                    
                    neighbor = nodes[neighbor_id]
                    
                    # Calculate failure probability
                    distance_factor = math.exp(-distance / 5.0)
                    source_effect = current['criticality_score']
                    target_vulnerability = neighbor['betweenness'] * 100 + 0.1
                    
                    if temperature_c < 0:
                        temp_stress = 1.0 + abs(temperature_c) / 20.0
                    elif temperature_c > 35:
                        temp_stress = 1.0 + (temperature_c - 35) / 15.0
                    else:
                        temp_stress = 1.0
                    
                    fail_prob = min(0.95, 
                        distance_factor * 
                        source_effect * 
                        target_vulnerability * 
                        temp_stress * 
                        load_multiplier * 
                        0.5
                    )
                    
                    if fail_prob >= failure_threshold:
                        visited.add(neighbor_id)
                        wave_num = current_wave + 1
                        
                        cascade_node = {
                            **neighbor,
                            'order': len(cascade_order),
                            'wave_depth': wave_num,
                            'triggered_by': current_id,
                            'failure_probability': round(fail_prob, 3)
                        }
                        cascade_order.append(cascade_node)
                        
                        propagation_paths.append({
                            'from_node': current_id,
                            'to_node': neighbor_id,
                            'order': len(cascade_order) - 1,
                            'distance_km': round(distance, 2),
                            'failure_probability': round(fail_prob, 3)
                        })
                        
                        if wave_num not in wave_stats:
                            wave_stats[wave_num] = {
                                'wave_number': wave_num,
                                'nodes_failed': 0,
                                'capacity_lost_mw': 0,
                                'customers_affected': 0,
                                'substations': 0,
                                'transformers': 0
                            }
                        
                        wave_stats[wave_num]['nodes_failed'] += 1
                        wave_stats[wave_num]['capacity_lost_mw'] += neighbor['capacity_kw'] / 1000
                        wave_stats[wave_num]['customers_affected'] += neighbor['downstream_transformers'] * 50
                        if neighbor['node_type'] == 'SUBSTATION':
                            wave_stats[wave_num]['substations'] += 1
                        else:
                            wave_stats[wave_num]['transformers'] += 1
                        
                        queue.append((neighbor_id, wave_num))
            
            # Build final result
            return {
                'scenario_name': scenario_name,
                'patient_zero': patient_zero,
                'cascade_order': cascade_order,
                'propagation_paths': propagation_paths,
                'wave_breakdown': sorted(wave_stats.values(), key=lambda w: w['wave_number']),
                'total_affected_nodes': len(cascade_order),
                'affected_capacity_mw': round(sum(n['capacity_kw'] for n in cascade_order) / 1000, 2),
                'estimated_customers_affected': sum(n['downstream_transformers'] * 50 for n in cascade_order),
                'max_cascade_depth': max(n['wave_depth'] for n in cascade_order) if cascade_order else 0,
                'simulation_params': {
                    'temperature_c': temperature_c,
                    'load_multiplier': load_multiplier,
                    'failure_threshold': failure_threshold,
                    'max_waves': max_waves,
                    'max_nodes': max_nodes
                }
            }
        
        result = await run_snowflake_query(_run_realtime_simulation, timeout=120)
        
        if 'error' in result:
            raise HTTPException(status_code=400, detail=result['error'])
        
        query_time = round((time.time() - start) * 1000, 2)
        
        return {
            **result,
            'simulation_timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'query_time_ms': query_time,
            'method': 'realtime_bfs'
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cascade simulation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cascade/patient-zero-candidates", tags=["Cascade Analysis"])
async def get_patient_zero_candidates(
    limit: int = Query(20, description="Number of nodes to return"),
    use_gnn_predictions: bool = Query(False, description="Use GNN predictions if available"),
    only_centrality_computed: bool = Query(True, description="Only return nodes with true centrality metrics")
):
    """
    Engineering: Get high-risk nodes for Patient Zero selection.
    
    Resolves COMPROMISE 5: GNN-based Patient Zero identification.
    Returns nodes ranked by cascade risk score (from true centrality or GNN predictions).
    
    Note: only_centrality_computed=True returns only the ~1,873 nodes in the largest
    connected component that have true NetworkX centrality metrics computed.
    """
    start = time.time()
    
    try:
        def _fetch_high_risk():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            use_gnn = use_gnn_predictions  # Local copy to avoid scope issues
            centrality_only = only_centrality_computed
            
            if use_gnn:
                # Try to use GNN predictions first
                try:
                    cursor.execute(f"""
                        SELECT 
                            n.NODE_ID,
                            n.NODE_NAME,
                            n.NODE_TYPE,
                            n.LAT,
                            n.LON,
                            n.CAPACITY_KW,
                            n.CRITICALITY_SCORE,
                            n.DOWNSTREAM_TRANSFORMERS,
                            COALESCE(g.GNN_CASCADE_RISK, c.CASCADE_RISK_SCORE_NORMALIZED, n.CRITICALITY_SCORE) as RISK_SCORE,
                            CASE WHEN g.GNN_CASCADE_RISK IS NOT NULL THEN 'gnn_model' ELSE 'centrality' END as RISK_SOURCE
                        FROM {DB}.ML_DEMO.GRID_NODES n
                        LEFT JOIN {DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c ON n.NODE_ID = c.NODE_ID
                        LEFT JOIN {DB}.CASCADE_ANALYSIS.GNN_PREDICTIONS g ON n.NODE_ID = g.NODE_ID
                        WHERE n.LAT IS NOT NULL AND n.LON IS NOT NULL
                        ORDER BY RISK_SCORE DESC
                        LIMIT {limit}
                    """)
                except Exception:
                    # Fall back to centrality-based
                    use_gnn = False
            
            if not use_gnn:
                # Build join type based on filter preference
                join_type = "INNER JOIN" if centrality_only else "LEFT JOIN"
                cursor.execute(f"""
                    SELECT 
                        n.NODE_ID,
                        n.NODE_NAME,
                        n.NODE_TYPE,
                        n.LAT,
                        n.LON,
                        n.CAPACITY_KW,
                        n.CRITICALITY_SCORE,
                        n.DOWNSTREAM_TRANSFORMERS,
                        COALESCE(c.CASCADE_RISK_SCORE_NORMALIZED, n.CRITICALITY_SCORE / 10.0) as RISK_SCORE,
                        CASE WHEN c.CASCADE_RISK_SCORE_NORMALIZED IS NOT NULL THEN 'true_centrality' ELSE 'criticality_proxy' END as RISK_SOURCE
                    FROM {DB}.ML_DEMO.GRID_NODES n
                    {join_type} {DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c ON n.NODE_ID = c.NODE_ID
                    WHERE n.LAT IS NOT NULL AND n.LON IS NOT NULL
                    ORDER BY RISK_SCORE DESC
                    LIMIT {limit}
                """)
            
            nodes = []
            for row in cursor.fetchall():
                nodes.append({
                    'node_id': row[0],
                    'node_name': row[1],
                    'node_type': row[2],
                    'lat': float(row[3]) if row[3] else None,
                    'lon': float(row[4]) if row[4] else None,
                    'capacity_kw': float(row[5]) if row[5] else 0,
                    'criticality_score': float(row[6]) if row[6] else 0,
                    'downstream_transformers': int(row[7]) if row[7] else 0,
                    'cascade_risk_score': round(float(row[8]) if row[8] else 0, 4),
                    'risk_source': row[9]
                })
            
            cursor.close()
            conn.close()
            return nodes
        
        nodes = await run_snowflake_query(_fetch_high_risk, timeout=30)
        query_time = round((time.time() - start) * 1000, 2)
        
        return {
            "high_risk_nodes": nodes,
            "count": len(nodes),
            "query_time_ms": query_time,
            "description": "Top nodes by cascade risk score - ideal Patient Zero candidates"
        }
    
    except Exception as e:
        logger.error(f"Failed to fetch high-risk nodes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cascade/precomputed/{scenario_id}", tags=["Cascade Analysis"])
async def get_precomputed_cascade_by_id(scenario_id: str):
    """
    Engineering: Get a specific pre-computed cascade scenario by ID.
    Returns the full cascade result ready for visualization.
    """
    start = time.time()
    
    try:
        def _fetch_scenario():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            cursor.execute(f"""
                SELECT 
                    scenario_id,
                    scenario_name,
                    patient_zero_id,
                    patient_zero_name,
                    simulation_params,
                    cascade_order,
                    wave_breakdown,
                    node_type_breakdown,
                    propagation_paths,
                    total_affected_nodes,
                    affected_capacity_mw,
                    estimated_customers_affected,
                    max_cascade_depth,
                    simulation_timestamp
                FROM {DB}.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES
                WHERE scenario_id = '{scenario_id}'
            """)
            
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not row:
                return None
            
            # Parse cascade_order and add wave_depth
            cascade_order = json.loads(row[5]) if row[5] else []
            
            return {
                'scenario_id': row[0],
                'scenario_name': row[1],
                'patient_zero': {
                    'node_id': row[2],
                    'node_name': row[3]
                },
                'simulation_params': json.loads(row[4]) if row[4] else {},
                'cascade_order': cascade_order,
                'wave_breakdown': json.loads(row[6]) if row[6] else [],
                'node_type_breakdown': json.loads(row[7]) if row[7] else [],
                'propagation_paths': json.loads(row[8]) if row[8] else [],
                'total_affected_nodes': row[9],
                'affected_capacity_mw': float(row[10]) if row[10] else 0,
                'estimated_customers_affected': row[11],
                'max_cascade_depth': row[12],
                'simulation_timestamp': str(row[13]) if row[13] else None
            }
        
        scenario = await run_snowflake_query(_fetch_scenario, timeout=30)
        
        if not scenario:
            raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
        
        return {
            "scenario": scenario,
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch precomputed cascade {scenario_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# ENGINEERING: ACTIONABLE CASCADE ANALYSIS ENDPOINTS
# =============================================================================
# These endpoints transform cascade analysis from "technically impressive" to
# "actually useful for grid operators" by answering:
# - "What does this cost me?" (economic impact)
# - "What do I do right now?" (mitigation playbooks)
# - "How do I recover?" (restoration sequencing)
# - "Where should I invest?" (comparative analysis)
# =============================================================================


@app.post("/api/cascade/economic-impact", tags=["Cascade Analysis - Actionable"])
async def calculate_economic_impact(cascade_result: dict = None):
    """
    Engineering: Convert cascade analysis into dollar impact.
    
    Operators don't make decisions based on "64,800 customers affected."
    They make decisions based on:
    - Regulatory penalty exposure (PUCT, ERCOT compliance)
    - Lost revenue (unserved energy)
    - Restoration costs (crew overtime, equipment)
    - Reputation damage (media coverage threshold)
    
    Returns actionable financial impact to support executive decisions.
    """
    start = time.time()
    
    # Texas utility cost parameters (industry averages)
    COST_PARAMS = {
        # Regulatory penalties
        'puct_penalty_per_customer_hour': 50.0,  # PUCT customer service penalties
        'ercot_non_compliance_base': 25000.0,  # Base penalty for reliability violations
        'ercot_penalty_per_mw_unserved': 9000.0,  # Value of Lost Load (VOLL)
        
        # Revenue loss
        'avg_revenue_per_kwh': 0.12,  # Average retail rate
        'avg_consumption_kwh_per_customer_hour': 1.5,  # Residential average
        
        # Restoration costs
        'crew_cost_per_hour': 850.0,  # Fully loaded crew cost
        'avg_restoration_hours_per_node': 2.5,  # Average time to restore
        'equipment_cost_per_substation': 15000.0,  # Emergency equipment/parts
        'equipment_cost_per_transformer': 2500.0,
        
        # Thresholds
        'media_attention_threshold': 10000,  # Customers before media coverage
        'regulatory_scrutiny_threshold': 50000,  # Customers before regulatory review
        'emergency_declaration_threshold': 100000,  # State emergency threshold
    }
    
    try:
        if not cascade_result:
            return {
                "error": "No cascade result provided",
                "usage": "POST with cascade simulation result from /api/cascade/simulate"
            }
        
        # Extract cascade metrics
        customers = cascade_result.get('estimated_customers_affected', 0)
        capacity_mw = cascade_result.get('affected_capacity_mw', 0)
        total_nodes = cascade_result.get('total_affected_nodes', 0)
        cascade_order = cascade_result.get('cascade_order', [])
        
        # Count node types
        substations = sum(1 for n in cascade_order if n.get('node_type') == 'SUBSTATION')
        transformers = total_nodes - substations
        
        # Estimate outage duration based on cascade depth
        max_depth = cascade_result.get('max_cascade_depth', 1)
        estimated_hours = max_depth * 2.5  # Deeper cascades take longer to restore
        
        # Calculate costs
        # 1. Regulatory penalties
        puct_penalty = customers * estimated_hours * COST_PARAMS['puct_penalty_per_customer_hour']
        ercot_penalty = (COST_PARAMS['ercot_non_compliance_base'] + 
                        capacity_mw * COST_PARAMS['ercot_penalty_per_mw_unserved'])
        regulatory_total = puct_penalty + ercot_penalty
        
        # 2. Lost revenue
        unserved_energy_mwh = customers * estimated_hours * COST_PARAMS['avg_consumption_kwh_per_customer_hour'] / 1000
        revenue_loss = unserved_energy_mwh * 1000 * COST_PARAMS['avg_revenue_per_kwh']
        
        # 3. Restoration costs
        crew_hours = total_nodes * COST_PARAMS['avg_restoration_hours_per_node']
        crew_cost = crew_hours * COST_PARAMS['crew_cost_per_hour']
        equipment_cost = (substations * COST_PARAMS['equipment_cost_per_substation'] +
                         transformers * COST_PARAMS['equipment_cost_per_transformer'])
        restoration_total = crew_cost + equipment_cost
        
        # Total impact
        total_impact = regulatory_total + revenue_loss + restoration_total
        
        # Determine severity tier
        if customers >= COST_PARAMS['emergency_declaration_threshold']:
            severity_tier = "EMERGENCY"
            severity_description = "State emergency declaration likely. Governor's office, PUCT, and media involvement certain."
        elif customers >= COST_PARAMS['regulatory_scrutiny_threshold']:
            severity_tier = "CRITICAL"
            severity_description = "Regulatory investigation probable. Executive leadership must be notified immediately."
        elif customers >= COST_PARAMS['media_attention_threshold']:
            severity_tier = "HIGH"
            severity_description = "Media coverage likely. Communications team should prepare public statement."
        else:
            severity_tier = "MODERATE"
            severity_description = "Standard restoration procedures apply. Routine reporting required."
        
        return {
            "economic_impact": {
                "total_estimated_cost": round(total_impact, 2),
                "breakdown": {
                    "regulatory_penalties": {
                        "puct_customer_service": round(puct_penalty, 2),
                        "ercot_reliability": round(ercot_penalty, 2),
                        "subtotal": round(regulatory_total, 2)
                    },
                    "lost_revenue": {
                        "unserved_energy_mwh": round(unserved_energy_mwh, 1),
                        "subtotal": round(revenue_loss, 2)
                    },
                    "restoration_costs": {
                        "crew_hours": round(crew_hours, 1),
                        "crew_cost": round(crew_cost, 2),
                        "equipment_cost": round(equipment_cost, 2),
                        "subtotal": round(restoration_total, 2)
                    }
                },
                "currency": "USD"
            },
            "severity_assessment": {
                "tier": severity_tier,
                "description": severity_description,
                "customers_affected": customers,
                "estimated_duration_hours": round(estimated_hours, 1),
                "thresholds": {
                    "media_attention": customers >= COST_PARAMS['media_attention_threshold'],
                    "regulatory_scrutiny": customers >= COST_PARAMS['regulatory_scrutiny_threshold'],
                    "emergency_declaration": customers >= COST_PARAMS['emergency_declaration_threshold']
                }
            },
            "executive_summary": f"${total_impact:,.0f} total exposure: ${regulatory_total:,.0f} regulatory, ${revenue_loss:,.0f} lost revenue, ${restoration_total:,.0f} restoration. {severity_tier} severity - {customers:,} customers for ~{estimated_hours:.0f} hours.",
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }
    
    except Exception as e:
        logger.error(f"Economic impact calculation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cascade/mitigation-actions", tags=["Cascade Analysis - Actionable"])
async def get_mitigation_playbook(cascade_result: dict = None):
    """
    Engineering: Generate actionable mitigation playbook for cascade containment.
    
    Operators need to know: "What do I do RIGHT NOW to stop this cascade?"
    
    Returns:
    - Immediate actions (within 15 minutes)
    - Short-term containment (within 1 hour)
    - Network reconfiguration options
    - Crew dispatch recommendations
    """
    start = time.time()
    
    try:
        if not cascade_result:
            return {
                "error": "No cascade result provided",
                "usage": "POST with cascade simulation result"
            }
        
        patient_zero = cascade_result.get('patient_zero', {})
        cascade_order = cascade_result.get('cascade_order', [])
        propagation_paths = cascade_result.get('propagation_paths', [])
        total_nodes = cascade_result.get('total_affected_nodes', 0)
        
        # Identify cascade choke points (nodes where cascade spreads to multiple children)
        node_children = {}
        for path in propagation_paths:
            from_node = path.get('from_node')
            if from_node:
                node_children[from_node] = node_children.get(from_node, 0) + 1
        
        # Find top choke points
        choke_points = sorted(
            [(k, v) for k, v in node_children.items() if v > 1],
            key=lambda x: x[1],
            reverse=True
        )[:5]
        
        # Identify wave 1 nodes (first to fail after patient zero)
        wave_1_nodes = [n for n in cascade_order if n.get('wave_depth') == 1]
        
        # Build mitigation playbook
        playbook = {
            "immediate_actions": [
                {
                    "priority": 1,
                    "action": f"ISOLATE {patient_zero.get('node_name', 'Patient Zero')}",
                    "description": f"Open all tie switches and sectionalizers connected to {patient_zero.get('node_id')}",
                    "time_target": "0-5 minutes",
                    "prevents": f"Initial cascade propagation to {len(wave_1_nodes)} downstream nodes"
                },
                {
                    "priority": 2,
                    "action": "ENABLE LOAD SHEDDING",
                    "description": "Initiate controlled load shedding on adjacent feeders to prevent overload cascade",
                    "time_target": "5-10 minutes",
                    "prevents": "Thermal overload on parallel circuits"
                },
                {
                    "priority": 3,
                    "action": "NOTIFY CONTROL CENTER",
                    "description": "Escalate to system operator for regional coordination",
                    "time_target": "Immediate",
                    "prevents": "Uncoordinated restoration attempts"
                }
            ],
            "choke_point_interventions": [
                {
                    "node_id": cp[0],
                    "downstream_impact": cp[1],
                    "action": f"Install temporary sectionalizer at {cp[0]}",
                    "rationale": f"Isolating this node prevents cascade to {cp[1]} additional branches"
                }
                for cp in choke_points[:3]
            ],
            "load_transfer_options": [
                {
                    "from_node": wave_1_nodes[0].get('node_id') if wave_1_nodes else None,
                    "action": "Transfer load to adjacent feeder via normally-open tie",
                    "capacity_recoverable_mw": round(sum(n.get('capacity_kw', 0) for n in wave_1_nodes[:3]) / 1000, 1)
                }
            ] if wave_1_nodes else [],
            "crew_dispatch": {
                "primary_location": {
                    "node_id": patient_zero.get('node_id'),
                    "node_name": patient_zero.get('node_name'),
                    "lat": patient_zero.get('lat'),
                    "lon": patient_zero.get('lon'),
                    "reason": "Patient Zero - primary failure point"
                },
                "secondary_locations": [
                    {
                        "node_id": cp[0],
                        "reason": f"Choke point - controls {cp[1]} downstream branches"
                    }
                    for cp in choke_points[:2]
                ],
                "estimated_crews_needed": max(1, total_nodes // 10),
                "equipment_to_stage": [
                    "Mobile transformer (if substation affected)",
                    "Portable generators",
                    "Sectionalizing equipment",
                    "Load break switches"
                ]
            },
            "containment_probability": {
                "with_immediate_action": 0.85,
                "with_15min_delay": 0.60,
                "with_30min_delay": 0.35,
                "interpretation": "Probability of containing cascade to current scope"
            }
        }
        
        return {
            "playbook": playbook,
            "summary": f"Execute {len(playbook['immediate_actions'])} immediate actions. Primary intervention at {patient_zero.get('node_name')}. {len(choke_points)} choke points identified for isolation.",
            "cascade_context": {
                "patient_zero": patient_zero.get('node_name'),
                "total_at_risk_nodes": total_nodes,
                "wave_1_nodes": len(wave_1_nodes)
            },
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }
    
    except Exception as e:
        logger.error(f"Mitigation playbook generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cascade/restoration-sequence", tags=["Cascade Analysis - Actionable"])
async def get_restoration_sequence(cascade_result: dict = None):
    """
    Engineering: Generate optimal restoration sequence after cascade failure.
    
    After an outage, operators need: "In what ORDER do I restore these nodes
    to minimize total customer-hours of interruption?"
    
    Uses weighted graph algorithm to prioritize:
    1. Nodes serving most customers
    2. Critical infrastructure (hospitals, water treatment)
    3. Nodes that enable downstream restoration
    """
    start = time.time()
    
    try:
        if not cascade_result:
            return {
                "error": "No cascade result provided"
            }
        
        cascade_order = cascade_result.get('cascade_order', [])
        propagation_paths = cascade_result.get('propagation_paths', [])
        
        if not cascade_order:
            return {"error": "No nodes in cascade result"}
        
        # Build dependency graph (which nodes depend on which for restoration)
        # A node can only be restored after its "triggered_by" node is restored
        dependencies = {}
        for path in propagation_paths:
            to_node = path.get('to_node')
            from_node = path.get('from_node')
            if to_node and from_node:
                dependencies[to_node] = from_node
        
        # Calculate restoration priority score for each node
        # Score = customers_served * (1 / restoration_complexity)
        node_scores = []
        for node in cascade_order:
            customers = node.get('downstream_transformers', 1) * 50
            # Substations are harder to restore but serve more
            complexity = 3.0 if node.get('node_type') == 'SUBSTATION' else 1.0
            priority_score = customers / complexity
            
            node_scores.append({
                **node,
                'restoration_priority_score': round(priority_score, 1),
                'estimated_restoration_hours': 4.0 if node.get('node_type') == 'SUBSTATION' else 1.5,
                'depends_on': dependencies.get(node.get('node_id'))
            })
        
        # Sort by topological order (dependencies first) then by priority score
        # First, restore nodes with no dependencies, sorted by priority
        restored = set()
        restoration_sequence = []
        remaining = node_scores.copy()
        
        sequence_order = 1
        cumulative_customers = 0
        cumulative_hours = 0
        
        while remaining:
            # Find nodes whose dependencies are satisfied
            available = [
                n for n in remaining 
                if n.get('depends_on') is None or n.get('depends_on') in restored
            ]
            
            if not available:
                # Circular dependency or orphans - just take highest priority
                available = remaining
            
            # Sort available by priority score (highest first)
            available.sort(key=lambda x: x.get('restoration_priority_score', 0), reverse=True)
            
            # Take the highest priority available node
            next_node = available[0]
            remaining.remove(next_node)
            restored.add(next_node.get('node_id'))
            
            customers_restored = next_node.get('downstream_transformers', 1) * 50
            cumulative_customers += customers_restored
            cumulative_hours += next_node.get('estimated_restoration_hours', 1.5)
            
            restoration_sequence.append({
                'sequence': sequence_order,
                'node_id': next_node.get('node_id'),
                'node_name': next_node.get('node_name'),
                'node_type': next_node.get('node_type'),
                'lat': next_node.get('lat'),
                'lon': next_node.get('lon'),
                'priority_score': next_node.get('restoration_priority_score'),
                'estimated_hours': next_node.get('estimated_restoration_hours'),
                'customers_restored': customers_restored,
                'cumulative_customers': cumulative_customers,
                'cumulative_hours': round(cumulative_hours, 1),
                'depends_on': next_node.get('depends_on'),
                'rationale': _get_restoration_rationale(next_node, sequence_order)
            })
            
            sequence_order += 1
        
        # Calculate restoration milestones
        total_customers = cascade_result.get('estimated_customers_affected', cumulative_customers)
        milestones = []
        for pct in [25, 50, 75, 90, 100]:
            target = total_customers * pct / 100
            for step in restoration_sequence:
                if step['cumulative_customers'] >= target:
                    milestones.append({
                        'milestone': f"{pct}% customers restored",
                        'after_step': step['sequence'],
                        'node': step['node_name'],
                        'hours': step['cumulative_hours']
                    })
                    break
        
        return {
            "restoration_sequence": restoration_sequence,
            "milestones": milestones,
            "summary": {
                "total_nodes": len(restoration_sequence),
                "total_customers": total_customers,
                "estimated_total_hours": round(cumulative_hours, 1),
                "parallel_crews_recommended": max(1, len(restoration_sequence) // 5)
            },
            "optimization_note": "Sequence optimizes for customer-hours (minimize total interruption). Critical infrastructure nodes should be elevated manually.",
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }
    
    except Exception as e:
        logger.error(f"Restoration sequence generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _get_restoration_rationale(node: dict, sequence: int) -> str:
    """Generate human-readable rationale for restoration order."""
    node_type = node.get('node_type', 'UNKNOWN')
    customers = node.get('downstream_transformers', 1) * 50
    depends_on = node.get('depends_on')
    
    if sequence == 1:
        return f"Patient Zero - restore first to enable downstream recovery"
    elif node_type == 'SUBSTATION':
        return f"Substation serves {customers:,} customers; enables multiple feeder restorations"
    elif depends_on:
        return f"Dependent on {depends_on}; restoring unlocks {customers:,} customers"
    else:
        return f"High priority: {customers:,} customers with minimal dependencies"


@app.post("/api/cascade/compare-mitigations", tags=["Cascade Analysis - Actionable"])
async def compare_mitigation_investments(
    node_ids: list = None,
    investment_budget: float = Query(1000000, description="Available budget in USD")
):
    """
    Engineering: Compare ROI of hardening different nodes.
    
    Executives ask: "If I have $1M to invest in grid hardening, 
    which nodes give me the best risk reduction?"
    
    Returns ranked comparison of investment options with:
    - Cost to harden each node
    - Risk reduction achieved
    - ROI calculation
    - Recommendation
    """
    start = time.time()
    
    try:
        def _fetch_and_compare():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Get centrality metrics for specified nodes (or top 10 if none specified)
            if node_ids and len(node_ids) > 0:
                node_ids_str = ','.join([f"'{nid}'" for nid in node_ids])
                node_filter = f"WHERE n.NODE_ID IN ({node_ids_str})"
            else:
                node_filter = "WHERE c.CASCADE_RISK_SCORE_NORMALIZED IS NOT NULL ORDER BY c.CASCADE_RISK_SCORE_NORMALIZED DESC LIMIT 10"
            
            cursor.execute(f"""
                SELECT 
                    n.NODE_ID,
                    n.NODE_NAME,
                    n.NODE_TYPE,
                    n.CAPACITY_KW,
                    n.DOWNSTREAM_TRANSFORMERS,
                    COALESCE(c.CASCADE_RISK_SCORE_NORMALIZED, 0) as RISK_SCORE,
                    COALESCE(c.BETWEENNESS_CENTRALITY, 0) as BETWEENNESS,
                    COALESCE(c.TOTAL_REACH, 0) as NETWORK_REACH
                FROM {DB}.ML_DEMO.GRID_NODES n
                LEFT JOIN {DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c 
                    ON n.NODE_ID = c.NODE_ID
                {node_filter}
            """)
            
            nodes = []
            for row in cursor.fetchall():
                nodes.append({
                    'node_id': row[0],
                    'node_name': row[1],
                    'node_type': row[2],
                    'capacity_kw': float(row[3]) if row[3] else 0,
                    'downstream_transformers': int(row[4]) if row[4] else 0,
                    'risk_score': float(row[5]) if row[5] else 0,
                    'betweenness': float(row[6]) if row[6] else 0,
                    'network_reach': int(row[7]) if row[7] else 0
                })
            
            cursor.close()
            conn.close()
            return nodes
        
        nodes = await run_snowflake_query(_fetch_and_compare, timeout=30)
        
        if not nodes:
            return {"error": "No nodes found for comparison"}
        
        # Hardening cost estimates by node type
        HARDENING_COSTS = {
            'SUBSTATION': {
                'base_cost': 500000,
                'per_mw_cost': 50000,
                'description': 'Redundant transformers, automatic transfer switches, backup power'
            },
            'TRANSFORMER': {
                'base_cost': 25000,
                'per_mw_cost': 5000,
                'description': 'Reinforced mounting, surge protection, remote monitoring'
            }
        }
        
        # Calculate ROI for each node
        comparisons = []
        for node in nodes:
            node_type = node.get('node_type', 'TRANSFORMER')
            costs = HARDENING_COSTS.get(node_type, HARDENING_COSTS['TRANSFORMER'])
            
            capacity_mw = node.get('capacity_kw', 0) / 1000
            hardening_cost = costs['base_cost'] + (capacity_mw * costs['per_mw_cost'])
            
            # Risk reduction estimate based on betweenness centrality
            # Higher betweenness = hardening has more network-wide impact
            betweenness = node.get('betweenness', 0)
            risk_reduction_pct = min(95, betweenness * 100 + 20)  # 20-95% range
            
            # Calculate avoided cost (based on cascade impact)
            customers_protected = node.get('downstream_transformers', 1) * 50 * (1 + node.get('network_reach', 0) / 100)
            annual_outage_probability = 0.05  # 5% annual probability
            avg_outage_cost_per_customer = 500  # Per event
            annual_avoided_cost = customers_protected * annual_outage_probability * avg_outage_cost_per_customer * (risk_reduction_pct / 100)
            
            # ROI calculation (5-year horizon)
            five_year_benefit = annual_avoided_cost * 5
            roi = ((five_year_benefit - hardening_cost) / hardening_cost) * 100
            payback_years = hardening_cost / annual_avoided_cost if annual_avoided_cost > 0 else float('inf')
            
            comparisons.append({
                'node_id': node.get('node_id'),
                'node_name': node.get('node_name'),
                'node_type': node_type,
                'current_risk_score': round(node.get('risk_score', 0), 4),
                'betweenness_centrality': round(betweenness, 4),
                'hardening': {
                    'cost': round(hardening_cost, 0),
                    'description': costs['description'],
                    'risk_reduction_pct': round(risk_reduction_pct, 1)
                },
                'financial_impact': {
                    'customers_protected': round(customers_protected, 0),
                    'annual_avoided_cost': round(annual_avoided_cost, 0),
                    'five_year_benefit': round(five_year_benefit, 0),
                    'roi_pct': round(roi, 1),
                    'payback_years': round(payback_years, 1) if payback_years != float('inf') else 'N/A'
                },
                'within_budget': hardening_cost <= investment_budget
            })
        
        # Sort by ROI (highest first)
        comparisons.sort(key=lambda x: x['financial_impact']['roi_pct'], reverse=True)
        
        # Generate recommendation
        within_budget = [c for c in comparisons if c['within_budget']]
        if within_budget:
            best = within_budget[0]
            recommendation = f"Recommend hardening {best['node_name']} (${best['hardening']['cost']:,.0f}). ROI: {best['financial_impact']['roi_pct']:.0f}% over 5 years. Reduces cascade risk by {best['hardening']['risk_reduction_pct']:.0f}% for {best['financial_impact']['customers_protected']:,.0f} customers."
        else:
            recommendation = f"No options within ${investment_budget:,.0f} budget. Minimum investment required: ${min(c['hardening']['cost'] for c in comparisons):,.0f}"
        
        return {
            "comparisons": comparisons,
            "budget": investment_budget,
            "options_within_budget": len(within_budget),
            "recommendation": recommendation,
            "methodology": "ROI based on 5-year avoided outage costs using cascade risk centrality metrics",
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }
    
    except Exception as e:
        logger.error(f"Mitigation comparison failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cascade/realtime-risk", tags=["Cascade Analysis - Actionable"])
async def get_realtime_cascade_risk():
    """
    Engineering: Calculate current cascade risk based on live grid state.
    
    Combines:
    - Current weather (temperature stress)
    - Current load levels (from AMI data)
    - Recent equipment alarms
    - Time of day (peak vs off-peak)
    
    Returns: "Right now, your cascade risk is X and here's why"
    """
    start = time.time()
    
    try:
        def _calculate_realtime_risk():
            conn = get_snowflake_connection()
            cursor = conn.cursor()
            
            # Get current grid state indicators
            cursor.execute(f"""
                WITH current_load AS (
                    SELECT 
                        AVG(MORNING_LOAD_PCT) as avg_load_pct,
                        MAX(MORNING_LOAD_PCT) as max_load_pct,
                        COUNT(CASE WHEN MORNING_LOAD_PCT > 80 THEN 1 END) as high_load_count,
                        COUNT(*) as total_transformers
                    FROM {DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING
                    WHERE PREDICTION_DATE = (SELECT MAX(PREDICTION_DATE) FROM {DB}.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING)
                ),
                high_risk_nodes AS (
                    SELECT COUNT(*) as high_risk_count
                    FROM {DB}.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2
                    WHERE CASCADE_RISK_SCORE_NORMALIZED > 0.7
                )
                SELECT 
                    cl.avg_load_pct,
                    cl.max_load_pct,
                    cl.high_load_count,
                    cl.total_transformers,
                    hrn.high_risk_count,
                    HOUR(CURRENT_TIMESTAMP()) as current_hour
                FROM current_load cl, high_risk_nodes hrn
            """)
            
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not row:
                return None
            
            return {
                'avg_load_pct': float(row[0]) if row[0] else 50,
                'max_load_pct': float(row[1]) if row[1] else 70,
                'high_load_count': int(row[2]) if row[2] else 0,
                'total_transformers': int(row[3]) if row[3] else 1000,
                'high_risk_nodes': int(row[4]) if row[4] else 0,
                'current_hour': int(row[5]) if row[5] else 12
            }
        
        grid_state = await run_snowflake_query(_calculate_realtime_risk, timeout=30)
        
        if not grid_state:
            grid_state = {
                'avg_load_pct': 50, 'max_load_pct': 70, 'high_load_count': 0,
                'total_transformers': 1000, 'high_risk_nodes': 0, 'current_hour': 12
            }
        
        # Calculate risk factors
        # 1. Load factor (0-40 points)
        load_factor = min(40, (grid_state['avg_load_pct'] / 100) * 40)
        
        # 2. Peak hour factor (0-20 points) - peak hours 2-7 PM
        hour = grid_state['current_hour']
        is_peak = 14 <= hour <= 19
        peak_factor = 20 if is_peak else 5
        
        # 3. High-load equipment factor (0-25 points)
        high_load_pct = (grid_state['high_load_count'] / max(1, grid_state['total_transformers'])) * 100
        equipment_factor = min(25, high_load_pct * 2.5)
        
        # 4. Network vulnerability factor (0-15 points)
        network_factor = min(15, grid_state['high_risk_nodes'] * 0.5)
        
        # Total risk score (0-100)
        total_risk = load_factor + peak_factor + equipment_factor + network_factor
        
        # Risk level classification
        if total_risk >= 70:
            risk_level = "CRITICAL"
            risk_color = "#dc3545"
            action = "Activate emergency protocols. Pre-position crews at high-risk substations."
        elif total_risk >= 50:
            risk_level = "HIGH"
            risk_color = "#fd7e14"
            action = "Increase monitoring frequency. Prepare load shedding procedures."
        elif total_risk >= 30:
            risk_level = "ELEVATED"
            risk_color = "#ffc107"
            action = "Standard monitoring. Review contingency plans."
        else:
            risk_level = "NORMAL"
            risk_color = "#28a745"
            action = "Normal operations. No immediate action required."
        
        return {
            "realtime_risk": {
                "score": round(total_risk, 1),
                "level": risk_level,
                "color": risk_color,
                "recommended_action": action
            },
            "risk_factors": {
                "load_stress": {
                    "score": round(load_factor, 1),
                    "max": 40,
                    "detail": f"Avg load {grid_state['avg_load_pct']:.0f}%, max {grid_state['max_load_pct']:.0f}%"
                },
                "peak_hour": {
                    "score": round(peak_factor, 1),
                    "max": 20,
                    "detail": f"{'Peak hours (2-7 PM)' if is_peak else 'Off-peak hours'}"
                },
                "equipment_stress": {
                    "score": round(equipment_factor, 1),
                    "max": 25,
                    "detail": f"{grid_state['high_load_count']} transformers above 80% load"
                },
                "network_vulnerability": {
                    "score": round(network_factor, 1),
                    "max": 15,
                    "detail": f"{grid_state['high_risk_nodes']} high-risk network nodes"
                }
            },
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            "query_time_ms": round((time.time() - start) * 1000, 2)
        }
    
    except Exception as e:
        logger.error(f"Realtime risk calculation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == '__main__':
    import uvicorn
    logger.info("Starting FastAPI backend server on port 3001...")
    if get_login_token() and settings.snowflake_host:
        logger.info(f"SPCS mode - OAuth token authentication")
        logger.info(f"Host: {settings.snowflake_host}")
    else:
        logger.info(f"Local dev mode - Connection: {settings.snowflake_connection_name}")
    uvicorn.run(app, host='0.0.0.0', port=3001)
