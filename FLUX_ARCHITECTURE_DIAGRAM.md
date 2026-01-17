# Flux Operations Center - Architecture Diagram

**Version:** 2.2  
**Date:** January 12, 2026  
**Status:** Production (SPCS RUNNING)

> **⚠️ NOTE:** The authoritative architecture documentation is now consolidated in `/Users/abannerjee/Documents/cpe_poc/PROJECT_STATUS.md` under the section "🗺️ Flux Operations Center - Comprehensive Architecture". This file is retained for diagram reference but may contain outdated details.

---

## Dual-Backend Architecture Overview

The Flux Operations Center uses a **dual-backend architecture** where the Flask API intelligently routes requests to either Snowflake Postgres (for real-time <20ms queries) or Snowflake Core (for analytics <5s queries), with automatic fallback.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           FLUX OPERATIONS CENTER - DUAL BACKEND ARCHITECTURE                     │
│                              (Grid Operations Grid Operations Platform)                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              SPCS APPLICATION LAYER                                        │  │
│   │                              ══════════════════════                                        │  │
│   │                                                                                            │  │
│   │   ┌────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │                    FLUX_OPS_CENTER SERVICE (SPCS Container)                        │  │  │
│   │   │                    Compute Pool: FLUX_INTERACTIVE_POOL                              │  │  │
│   │   │                    MIN_INSTANCES=1, MAX_INSTANCES=5                                  │  │  │
│   │   │                                                                                      │  │  │
│   │   │    ┌─────────────────────────┐         ┌─────────────────────────────────────────┐  │  │  │
│   │   │    │    NGINX (:8080)        │         │         FLASK BACKEND                   │  │  │  │
│   │   │    │    ─────────────        │         │         (Gunicorn :3001, 4 workers)     │  │  │  │
│   │   │    │                         │         │         ─────────────────────────       │  │  │  │
│   │   │    │    React 18 + Vite      │  /api/* │                                         │  │  │  │
│   │   │    │    DeckGL 8.9           │ ──────▶ │    ┌─────────────────────────────────┐  │  │  │  │
│   │   │    │    MapLibre GL          │         │    │      DUAL-BACKEND ROUTER        │  │  │  │  │
│   │   │    │    Material-UI 5        │         │    │                                 │  │  │  │  │
│   │   │    │                         │         │    │  postgres_pool ─┐               │  │  │  │  │
│   │   │    │    66K Feeder Lines     │         │    │  (SimpleConnectionPool)         │  │  │  │  │
│   │   │    │    242 Substations      │         │    │  minconn=1, maxconn=20          │  │  │  │  │
│   │   │    │    Real-time KPIs       │         │    │               │                 │  │  │  │  │
│   │   │    │                         │         │    │               ▼                 │  │  │  │  │
│   │   │    │                         │         │    │  ┌─────────────────────────┐    │  │  │  │  │
│   │   │    │                         │         │    │  │ TRY POSTGRES FIRST     │    │  │  │  │  │
│   │   │    │                         │         │    │  │ (<20ms target)         │    │  │  │  │  │
│   │   │    │                         │         │    │  └───────────┬─────────────┘    │  │  │  │  │
│   │   │    │                         │         │    │              │                  │  │  │  │  │
│   │   │    │                         │         │    │         SUCCESS?               │  │  │  │  │
│   │   │    │                         │         │    │        /        \              │  │  │  │  │
│   │   │    │                         │         │    │      YES         NO            │  │  │  │  │
│   │   │    │                         │         │    │       │           │            │  │  │  │  │
│   │   │    │                         │         │    │       ▼           ▼            │  │  │  │  │
│   │   │    │                         │         │    │   [RETURN]   [SNOWFLAKE        │  │  │  │  │
│   │   │    │                         │         │    │              FALLBACK]         │  │  │  │  │
│   │   │    │                         │         │    │              (<5s target)      │  │  │  │  │
│   │   │    │                         │         │    └─────────────────────────────┘    │  │  │  │
│   │   │    └─────────────────────────┘         └─────────────────────────────────────────┘  │  │  │
│   │   │                                                                                      │  │  │
│   │   └──────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                                            │  │
│   └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                    │                                              │
│                           ┌────────────────────────┴────────────────────────┐                    │
│                           │                                                 │                    │
│                           ▼                                                 ▼                    │
│   ┌────────────────────────────────────────┐    ┌────────────────────────────────────────────┐  │
│   │      SNOWFLAKE POSTGRES                │    │           SNOWFLAKE CORE                   │  │
│   │      (Real-Time Backend)               │    │           (Analytics Backend)              │  │
│   │      ════════════════════              │    │           ════════════════════             │  │
│   │                                        │    │                                            │  │
│   │   Instance: FLUX_OPERATIONS_POSTGRES   │    │   Database: SI_DEMOS                       │  │
│   │   PostgreSQL 17.7 | HIGHMEM_XL         │    │   Warehouse: SI_DEMO_WH (XL)               │  │
│   │   Latency: <20ms                       │    │   Latency: <5s                             │  │
│   │                                        │    │                                            │  │
│   │   ┌──────────────────────────────────┐ │    │   ┌──────────────────────────────────────┐ │  │
│   │   │ OPERATIONAL CACHE TABLES         │ │    │   │ ANALYTICAL TABLES                    │ │  │
│   │   │                                  │ │    │   │                                      │ │  │
│   │   │ • grid_assets_cache (302 MB)     │ │    │   │ • AMI_INTERVAL_READINGS (7.1B rows)  │ │  │
│   │   │ • topology_connections (768 MB)  │ │    │   │ • TRANSFORMER_HOURLY_LOAD (209M)     │ │  │
│   │   │ • substations (242 records)      │ │    │   │ • OUTAGE_EVENTS (38K rows)           │ │  │
│   │   │ • circuit_status_realtime        │ │    │   │ • CUSTOMERS_MASTER_DATA (597K)       │ │  │
│   │   │ • ami_realtime (hot 15-min)      │ │    │   │ • HOUSTON_WEATHER_HOURLY (4.4K)      │ │  │
│   │   │                                  │ │    │   │ • WEATHER_EVENTS (31 rows)           │ │  │
│   │   │ Extensions:                      │ │    │   │                                      │ │  │
│   │   │ • PostGIS (geospatial)           │ │    │   │ Dynamic Tables (1-min refresh):      │ │  │
│   │   │ • pg_lake (Iceberg sync)         │ │    │   │ • AMI_MONTHLY_USAGE                  │ │  │
│   │   └──────────────────────────────────┘ │    │   │ • AMI_DEDUPLICATED                   │ │  │
│   │                                        │    │   │ • AMI_ENRICHED                       │ │  │
│   │   API Endpoints (Postgres-first):      │    │   └──────────────────────────────────────┘ │  │
│   │   • /api/postgres/substations/status   │    │                                            │  │
│   │   • /api/topology/feeders              │    │   ┌──────────────────────────────────────┐ │  │
│   │   • /api/substations                   │    │   │ CORTEX AI SERVICES                   │ │  │
│   │   • /api/assets                        │    │   │                                      │ │  │
│   │   • /api/circuits/metadata             │    │   │ • Cortex Agent (Grid Intelligence)   │ │  │
│   │   • /api/outages/active                │    │   │   - Semantic Model (NL→SQL)          │ │  │
│   │   • /api/work-orders/active            │    │   │   - Tool calling (search, analyst)   │ │  │
│   │   │                                    │    │   │   - SSE streaming responses          │ │  │
│   │   API Endpoints (Snowflake):           │    │   │                                      │ │  │
│   │   • /api/kpis (aggregations)           │    │   │ • Cortex Search Service              │ │  │
│   │   • /api/weather (historical)          │    │   │   - CUSTOMER_SEARCH_SERVICE          │ │  │
│   │   • /api/agent/stream (Cortex AI)      │    │   │   - 597K customers indexed           │ │  │
│   │                                        │    │   │   - snowflake-arctic-embed-l-v2.0    │ │  │
│   └────────────────────────────────────────┘    │   └──────────────────────────────────────┘ │  │
│                                                 │                                            │  │
│                                                 └────────────────────────────────────────────┘  │
│                                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              STREAMING / INGESTION LAYER                                   │  │
│   │                              ═══════════════════════════                                   │  │
│   │                                                                                            │  │
│   │    ┌────────────────────┐    ┌────────────────────┐    ┌────────────────────────────────┐ │  │
│   │    │   DEMO MODE        │    │   PoC MODE         │    │   PRODUCTION MODE              │ │  │
│   │    │   (Current)        │    │   (Confluent)      │    │   (CNP Infrastructure)         │ │  │
│   │    │                    │    │                    │    │                                │ │  │
│   │    │   Synthetic Gen    │    │   Datagen          │    │   2.7M AMI Meters              │ │  │
│   │    │   (Streamlit/CLI)  │    │   Connector        │    │   (Itron/L+G Head-End)         │ │  │
│   │    │        │           │    │        │           │    │        │                       │ │  │
│   │    │        ▼           │    │        ▼           │    │        ▼                       │ │  │
│   │    │   Snowpipe         │    │   Confluent        │    │   CNP Kafka Cluster            │ │  │
│   │    │   Streaming SDK    │    │   Kafka            │    │        │                       │ │  │
│   │    │        │           │    │        │           │    │        ▼                       │ │  │
│   │    │        │           │    │        ▼           │    │   OpenFlow SPCS                │ │  │
│   │    │        │           │    │   Snowflake        │    │   (NiFi Visual Canvas)         │ │  │
│   │    │        │           │    │   Kafka Connector  │    │                                │ │  │
│   │    └────────┼───────────┘    └────────┼───────────┘    └────────────────┼───────────────┘ │  │
│   │             │                         │                                 │                 │  │
│   │             └─────────────────────────┴─────────────────────────────────┘                 │  │
│   │                                       │                                                   │  │
│   │                                       ▼                                                   │  │
│   │                    ┌──────────────────────────────────────────────┐                       │  │
│   │                    │       DYNAMIC TABLES PIPELINE                │                       │  │
│   │                    │       TARGET_LAG = '1 minute'                │                       │  │
│   │                    │                                              │                       │  │
│   │                    │   ┌──────────┐   ┌──────────┐   ┌──────────┐│                       │  │
│   │                    │   │  BRONZE  │   │  SILVER  │   │   GOLD   ││                       │  │
│   │                    │   │  (Raw)   │──▶│  (Dedup) │──▶│ (Enrich) ││                       │  │
│   │                    │   └──────────┘   └──────────┘   └──────────┘│                       │  │
│   │                    │                                              │                       │  │
│   │                    │   Dedup: QUALIFY ROW_NUMBER() OVER (...) = 1 │                       │  │
│   │                    │   Enrich: JOIN weather, ERCOT pricing        │                       │  │
│   │                    └──────────────────────────────────────────────┘                       │  │
│   │                                                                                            │  │
│   └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

EXTERNAL ACCESS INTEGRATIONS:
• FLUX_CARTO_INTEGRATION - CartoDB Dark Matter basemap tiles
• FLUX_POSTGRES_INTEGRATION - Snowflake Postgres connectivity

ENDPOINT: https://bqbm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app
```

---

## Mermaid Diagram - Dual Backend Architecture

```mermaid
flowchart TB
    subgraph CLIENT["Browser Client"]
        UI["React Frontend<br/>DeckGL + MapLibre<br/>Material-UI"]
    end

    subgraph SPCS["SPCS Container (FLUX_OPS_CENTER)"]
        NGINX["nginx :8080<br/>Static Assets"]
        subgraph FLASK["Flask Backend (Gunicorn :3001)"]
            ROUTER["Dual-Backend Router"]
            PG_POOL["postgres_pool<br/>(SimpleConnectionPool)<br/>minconn=1, maxconn=20"]
            SF_CONN["get_snowflake_connection()<br/>(OAuth in SPCS, PAT local)"]
        end
    end

    subgraph POSTGRES["Snowflake Postgres (<20ms)"]
        PG_INST["FLUX_OPERATIONS_POSTGRES<br/>PostgreSQL 17.7"]
        subgraph PG_TABLES["Operational Cache"]
            GAC["grid_assets_cache<br/>302 MB"]
            TC["topology_connections<br/>768 MB"]
            SUBS["substations<br/>242 records"]
            CSR["circuit_status_realtime"]
            AMI_RT["ami_realtime<br/>(hot 15-min)"]
        end
        POSTGIS["PostGIS Extension"]
    end

    subgraph SNOWFLAKE["Snowflake Core (<5s)"]
        WH["SI_DEMO_WH (XL)"]
        subgraph SF_TABLES["SI_DEMOS.PRODUCTION"]
            AMI["AMI_INTERVAL_READINGS<br/>7.1B rows"]
            TRANS["TRANSFORMER_HOURLY_LOAD<br/>209M rows"]
            OUT["OUTAGE_EVENTS<br/>38K rows"]
            CUST["CUSTOMERS_MASTER_DATA<br/>597K rows"]
        end
        subgraph DT["Dynamic Tables (1-min)"]
            AMI_M["AMI_MONTHLY_USAGE"]
            AMI_D["AMI_DEDUPLICATED"]
            AMI_E["AMI_ENRICHED"]
        end
        subgraph CORTEX["Cortex AI"]
            AGENT["Cortex Agent<br/>Grid Intelligence"]
            SEARCH["Cortex Search<br/>Customer 360"]
        end
    end

    UI -->|"HTTP/SSE"| NGINX
    NGINX -->|"/api/*"| ROUTER
    
    ROUTER -->|"1. Try Postgres First"| PG_POOL
    PG_POOL -->|"<20ms"| PG_INST
    PG_INST --> PG_TABLES
    PG_INST --> POSTGIS
    
    ROUTER -->|"2. Fallback or Analytics"| SF_CONN
    SF_CONN -->|"<5s"| WH
    WH --> SF_TABLES
    WH --> DT
    WH --> CORTEX

    classDef postgres fill:#4ade80,stroke:#166534,color:#000
    classDef snowflake fill:#60a5fa,stroke:#1d4ed8,color:#000
    classDef app fill:#c084fc,stroke:#7c3aed,color:#000
    classDef client fill:#fbbf24,stroke:#b45309,color:#000

    class PG_INST,GAC,TC,SUBS,CSR,AMI_RT,POSTGIS postgres
    class WH,AMI,TRANS,OUT,CUST,AMI_M,AMI_D,AMI_E,AGENT,SEARCH snowflake
    class NGINX,ROUTER,PG_POOL,SF_CONN app
    class UI client
```

---

## API Routing Logic

```mermaid
flowchart LR
    subgraph REQUEST["Incoming Request"]
        REQ["HTTP Request"]
    end

    subgraph ROUTING["Flask Router Decision"]
        CHECK{"postgres_pool<br/>available?"}
        TRY_PG["Execute on Postgres"]
        SUCCESS{"Query<br/>succeeded?"}
        FALLBACK["Fallback to Snowflake"]
        DIRECT_SF["Direct Snowflake Query"]
    end

    subgraph RESPONSE["Response"]
        RES_PG["Return Postgres Result<br/>⚡ <20ms"]
        RES_SF["Return Snowflake Result<br/>❄️ <5s"]
    end

    REQ --> CHECK
    CHECK -->|"Yes"| TRY_PG
    CHECK -->|"No"| DIRECT_SF
    TRY_PG --> SUCCESS
    SUCCESS -->|"Yes"| RES_PG
    SUCCESS -->|"No (error/empty)"| FALLBACK
    FALLBACK --> RES_SF
    DIRECT_SF --> RES_SF
```

---

## API Endpoint Backend Mapping

| Endpoint | Primary Backend | Fallback | Latency Target | Data |
|----------|----------------|----------|----------------|------|
| `/api/postgres/substations/status` | Postgres | Snowflake | <20ms | 242 substations |
| `/api/topology/feeders` | Postgres | Snowflake | <20ms | 66K feeders (2.8MB) |
| `/api/substations` | Postgres | Snowflake | <10ms | 242 records |
| `/api/assets` | Postgres | Snowflake | <50ms | 502K assets cached |
| `/api/circuits/metadata` | Postgres | Snowflake | <20ms | Circuit status |
| `/api/outages/active` | Postgres | Snowflake | <20ms | Active outages |
| `/api/work-orders/active` | Postgres | Snowflake | <20ms | Work orders |
| `/api/kpis` | Snowflake | - | <5s | Aggregated KPIs |
| `/api/weather` | Snowflake | - | <5s | Weather analytics |
| `/api/agent/stream` | Snowflake (Cortex) | - | Streaming | AI responses |

---

## Data Flow Diagram

```mermaid
flowchart LR
    subgraph SOURCES["Data Sources"]
        AMI_M["2.7M AMI Meters<br/>(15-min intervals)"]
        WX["Weather Data<br/>(Hourly)"]
        ERCOT["ERCOT Pricing<br/>(5-min)"]
        GIS["GIS/Asset Data<br/>(Batch)"]
    end

    subgraph INGEST["Ingestion"]
        KAFKA["Kafka / OpenFlow"]
        SPIPE["Snowpipe Streaming"]
        BATCH["Batch Load"]
    end

    subgraph PROCESS["Processing (Snowflake)"]
        DT["Dynamic Tables<br/>(1-min TARGET_LAG)"]
        PROD["PRODUCTION Tables<br/>(7.1B+ rows)"]
    end

    subgraph CACHE["Operational Cache (Postgres)"]
        PG_CACHE["Postgres Tables<br/>(~1GB total)"]
    end

    subgraph SERVE["Serving Layer"]
        FLASK["Flask API"]
    end

    subgraph APP["Application"]
        FLUX["Flux Ops Center"]
    end

    AMI_M --> KAFKA --> SPIPE --> DT
    WX --> BATCH --> PROD
    ERCOT --> BATCH --> PROD
    GIS --> BATCH --> PROD
    
    DT --> PROD
    PROD -->|"Periodic Sync"| PG_CACHE
    
    PG_CACHE -->|"<20ms"| FLASK
    PROD -->|"<5s"| FLASK
    FLASK --> FLUX
```

---

## Sequence Diagram - Dual Backend Request Flow

```mermaid
sequenceDiagram
    participant User
    participant React
    participant Flask
    participant PG as Snowflake Postgres
    participant SF as Snowflake Core
    participant Cortex as Cortex Agent

    Note over React,Flask: Real-time operational query (Postgres-first)
    User->>React: View Dashboard
    React->>Flask: GET /api/postgres/substations/status
    Flask->>PG: SELECT FROM circuit_status_realtime
    PG-->>Flask: 242 substations (18ms) ⚡
    Flask-->>React: JSON response
    
    Note over React,Flask: Large dataset query (Postgres-first)
    React->>Flask: GET /api/topology/feeders
    Flask->>PG: SELECT FROM topology_connections
    PG-->>Flask: 66K feeders (15ms) ⚡
    Flask-->>React: JSON response (2.8MB gzipped)

    Note over React,Flask: Postgres fails - Snowflake fallback
    React->>Flask: GET /api/assets?circuits=FEEDER-1
    Flask->>PG: SELECT FROM grid_assets_cache
    PG--xFlask: Connection timeout ❌
    Flask->>SF: SELECT FROM SI_DEMOS.PRODUCTION.*
    SF-->>Flask: Assets (3.2s) ❄️
    Flask-->>React: JSON response
    
    Note over React,Flask: AI query (Snowflake only)
    User->>React: "Show overloaded transformers"
    React->>Flask: POST /api/agent/stream (SSE)
    Flask->>Cortex: Stream request
    Cortex->>SF: Query AMI data
    SF-->>Cortex: Results
    Cortex-->>Flask: SSE events (thinking, text, tool_calls)
    Flask-->>React: Stream response
    React-->>User: Display AI answer
```

---

## Deployment Architecture

```mermaid
flowchart TB
    subgraph SNOW["Snowflake Account (GZB42423)"]
        subgraph COMPUTE["Compute Resources"]
            POOL["FLUX_INTERACTIVE_POOL"]
            SVC["FLUX_OPS_CENTER<br/>MIN=1, MAX=5"]
            WH_XL["SI_DEMO_WH (XL)"]
            WH_XS["SI_AMI_PIPELINE_WH (XS)"]
        end
        
        subgraph POSTGRES_SVC["Snowflake Postgres"]
            PG["FLUX_OPERATIONS_POSTGRES<br/>PostgreSQL 17.7<br/>HIGHMEM_XL"]
        end
        
        subgraph DATABASE["SI_DEMOS Database"]
            PROD_SCH["PRODUCTION<br/>(97 tables, 7B+ rows)"]
            APP_SCH["APPLICATIONS<br/>(Views, Cortex objects)"]
            FLUX_SCH["FLUX_OPS_CENTER<br/>(Pipeline tables)"]
        end
        
        subgraph EAI["External Access Integrations"]
            CARTO["FLUX_CARTO_INTEGRATION<br/>(Map tiles)"]
            PG_INT["FLUX_POSTGRES_INTEGRATION<br/>(Postgres connectivity)"]
        end
    end
    
    SVC --> POOL
    SVC --> WH_XL
    SVC --> PG
    SVC --> CARTO
    SVC --> PG_INT
    FLUX_SCH --> PROD_SCH
```

---

## Performance Summary

| Component | Target | Actual | Status |
|-----------|--------|--------|--------|
| **Postgres Queries** | <20ms | ~15ms | ✅ |
| **Snowflake Analytics** | <5s | ~3s | ✅ |
| **Dashboard Load** | <3s | ~3s | ✅ |
| **Cortex Agent** | Streaming | Streaming | ✅ |
| **Feeder Render** | <100ms | ~80ms | ✅ |
| **Cold Start** | N/A | 0s (MIN=1) | ✅ |

---

## Key Design Decisions

1. **Postgres-First Strategy**: All operational queries try Postgres first for <20ms latency
2. **Automatic Fallback**: If Postgres fails or returns empty, seamlessly fall back to Snowflake
3. **Connection Pooling**: `SimpleConnectionPool(minconn=1, maxconn=20)` prevents connection exhaustion
4. **Always-On**: `MIN_INSTANCES=1` eliminates cold starts for consistent UX
5. **Cortex AI Integration**: SSE streaming for real-time AI responses without timeout issues
6. **Dual Data Strategy**: 
   - Hot data in Postgres (~1GB) for real-time ops
   - Cold/historical data in Snowflake (7.1B rows) for analytics

---

**Live Endpoint:** https://f6bm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app

---

## Document Superseded

> This document is superseded by PROJECT_STATUS.md "🗺️ Flux Operations Center - Comprehensive Architecture" section which contains validated, up-to-date information as of January 12, 2026.
