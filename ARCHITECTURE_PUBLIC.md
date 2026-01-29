# Grid Operations Platform
## Comprehensive Architecture & Deployment Guide

**Version:** 1.2  
**Date:** January 2026  
**Status:** Architecture Specification

> **Note on Feature Availability:** This document references some Snowflake features that may be in Preview status. Check [Snowflake Preview Features](https://docs.snowflake.com/en/release-notes/preview-features) for current availability. Features marked with *(Preview)* are not yet Generally Available.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Use Case Mapping](#2-use-case-mapping)
3. [Architecture Overview](#3-architecture-overview)
4. [Demo Architecture (No Kafka)](#4-demo-architecture-no-kafka)
5. [PoC Architecture (With Confluent Cloud)](#5-poc-architecture-with-confluent-cloud)
6. [Production Architecture](#6-production-architecture)
7. [Component Deep Dives](#7-component-deep-dives)
8. [Deployment Guides](#8-deployment-guides)
9. [Performance Targets](#9-performance-targets)
10. [Strategic Value](#10-strategic-value)

---

## 1. Executive Summary

### Purpose
This document provides end-to-end architecture guidance for the Flux Operations Center, a unified grid operations platform.

### Core Thesis
Snowflake provides a unified platform where existing teams can build and own superior applications using standard SQL and Python.

### Key Capabilities
| Capability | Snowflake Platform |
|------------|-------------------|
| Data Model | Standard SQL + Semantic Views |
| App Framework | SPCS (React + FastAPI) |
| Geospatial | PostGIS (industry standard) |
| Real-Time | OpenFlow + Kafka Connector |
| AI/ML | Cortex AI (transparent, customer-owned) |
| Portability | Open formats (Iceberg, Postgres) |

---

## 2. Use Case Mapping

### Utility Requirements

| # | Use Case | Requirement | Snowflake Solution | Demo Phase | PoC Phase | Production |
|---|----------|-----------------|-------------------|------------|-----------|------------|
| 1 | **AMI Data Management** | 100B records/year, sub-minute streaming | Dynamic Tables + OpenFlow Kafka | Synthetic generator | Confluent Cloud | Production Kafka |
| 2 | **ERM (Estimated Restoration Modeling)** | Sub-second response times (currently Redis) | Snowflake Postgres (<20ms) | Postgres cache | Postgres cache | Postgres cache |
| 3 | **Digital Twin** | "Google Maps" view of grid | DeckGL + MapLibre + PostGIS | SPCS app | SPCS app | SPCS app |
| 4 | **Customer 360** | Identity resolution in deregulated market | Cortex AI Vector Embeddings | Demo data | Sample data | Production data |
| 5 | **Conversational AI** | Natural language data marketplace | Cortex Agent + Analyst | Semantic model | Expanded model | Full model |
| 6 | **O&M Optimization** | 1-2% O&M reduction | Cortex Search on technical manuals | 100 PDFs | 1000 PDFs | Full corpus |
| 7 | **Geospatial Analysis** | Complex intersects (ESRI shop) | PostGIS + Snowflake Geospatial | Demo polygons | Real GIS data | Production GIS |
| 8 | **SAP Integration** | S/4HANA migration | OpenFlow Oracle/SAP CDC | Not in demo | Future | Phase 2 |

---

## 3. Architecture Overview

### Four-Layer Value Proposition

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          UTILITY UNIFIED DATA PLATFORM                                   │
│                              (Unified Grid Operations)                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 1: TRANSACTIONAL (Snowflake Postgres - Preview)                            │   │
│  │                                                                                 │   │
│  │  Purpose: Sub-20ms operational queries for real-time apps                       │   │
│  │                                                                                 │   │
│  │  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐               │   │
│  │  │  ERM Outage App │   │  Grid Asset     │   │  PostGIS        │               │   │
│  │  │  (replaces      │   │  Cache          │   │  Geospatial     │               │   │
│  │  │   Redis)        │   │  (242 subs)     │   │  Queries        │               │   │
│  │  └─────────────────┘   └─────────────────┘   └─────────────────┘               │   │
│  │                                                                                 │   │
│  │  Key Tech: PostgreSQL 17.7 *(Preview)*, PostGIS extension                           │   │
│  │  Latency Target: <20ms                                                               │   │
│  └───────────────────────────────────────────────────────────────────┬─────────────┘   │
│                                                                      │                 │
│                                                                      ▼                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 2: STREAMING (Kafka → Snowflake)                                          │   │
│  │                                                                                 │   │
│  │  Demo:        Synthetic Generator → Direct Snowflake Write                      │   │
│  │  PoC:         Confluent Cloud → Snowflake Kafka Connector                       │   │
│  │  Production:  Production Kafka → OpenFlow *(Preview)* or Kafka Connector            │   │
│  │                                                                                 │   │
│  │  Latency Target: <1 minute end-to-end                                           │   │
│  └───────────────────────────────────────────────────────────────────┬─────────────┘   │
│                                                                      │                 │
│                                                                      ▼                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 3: ANALYTICS (Snowflake Core)                                             │   │
│  │                                                                                 │   │
│  │  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐               │   │
│  │  │ 7.1B AMI Rows   │   │ Dynamic Tables  │   │ Cortex AI       │               │   │
│  │  │ (Historical)    │   │ (1-min refresh) │   │ Agent + Analyst │               │   │
│  │  └─────────────────┘   └─────────────────┘   └─────────────────┘               │   │
│  │                                                                                 │   │
│  │  Key Tech: Columnar warehouse, Iceberg tables, ML models                        │   │
│  │  Query Target: Sub-5 seconds for complex analytics                              │   │
│  └───────────────────────────────────────────────────────────────────┬─────────────┘   │
│                                                                      │                 │
│                                                                      ▼                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 4: APPLICATION (SPCS)                                                     │   │
│  │                                                                                 │   │
│  │  Flux Operations Center (React + DeckGL + FastAPI)                              │   │
│  │  • 66K feeder lines visualization                                               │   │
│  │  • Real-time substation status                                                  │   │
│  │  • Grid Intelligence AI Chat                                                    │   │
│  │                                                                                 │   │
│  │  Deployment: MIN_INSTANCES=1, MAX_INSTANCES=5                                   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Demo Architecture (No Kafka)

### Overview
For demonstrations without production Kafka infrastructure, we use a synthetic data generator that writes directly to Snowflake and Postgres.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              DEMO ARCHITECTURE (Current State)                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    DATA GENERATION LAYER                                        │   │
│   │                                                                                 │   │
│   │   ┌─────────────────────┐                                                       │   │
│   │   │  FLUX Data Forge    │  Synthetic AMI Generator (Streamlit + CLI)            │   │
│   │   │  - 596,906 meters   │  - 15-minute interval readings                        │   │
│   │   │  - Realistic load   │  - Temperature correlation                            │   │
│   │   │    profiles         │  - ERCOT pricing alignment                            │   │
│   │   └──────────┬──────────┘                                                       │   │
│   │              │                                                                   │   │
│   └──────────────┼──────────────────────────────────────────────────────────────────┘   │
│                  │                                                                       │
│                  ├───────────────────────────┬───────────────────────┐                  │
│                  │                           │                       │                  │
│                  ▼                           ▼                       ▼                  │
│   ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────────────┐     │
│   │ PATH 1: BATCH        │   │ PATH 2: STREAMING    │   │ PATH 3: REAL-TIME      │     │
│   │ (Historical Backfill)│   │ (Near Real-Time)     │   │ (Operational Cache)    │     │
│   │                      │   │                      │   │                        │     │
│   │ S3 Bucket            │   │ Snowpipe Streaming   │   │ Snowflake Postgres     │     │
│   │ JSON/Parquet files   │   │ SDK (Python)         │   │ (Direct Write)         │     │
│   │        │             │   │        │             │   │        │               │     │
│   │        ▼             │   │        ▼             │   │        ▼               │     │
│   │ Snowpipe (AUTO_INGEST)   │ AMI_RAW_STREAM       │   │ ami_realtime table     │     │
│   │        │             │   │        │             │   │ (hot 15-min window)    │     │
│   │        ▼             │   │        ▼             │   │        │               │     │
│   │ ~1 min latency       │   │ Dynamic Table        │   │        ▼               │     │
│   │                      │   │ (1-min TARGET_LAG)   │   │ <100ms write latency   │     │
│   └──────────┬───────────┘   └──────────┬───────────┘   └────────────┬───────────┘     │
│              │                          │                            │                  │
│              └──────────────┬───────────┘                            │                  │
│                             ▼                                        │                  │
│   ┌─────────────────────────────────────────────┐                    │                  │
│   │     SNOWFLAKE (Analytics Layer)             │                    │                  │
│   │                                             │                    │                  │
│   │  <DATABASE>.<SCHEMA>.AMI_INTERVAL_READINGS  │                    │                  │
│   │  (7.1B rows - historical)                   │                    │                  │
│   │                                             │                    │                  │
│   │  Dynamic Tables Pipeline:                   │                    │                  │
│   │  - AMI_RAW_STREAM (streaming landing)       │                    │                  │
│   │  - AMI_DEDUPLICATED (deduped)               │                    │                  │
│   │  - AMI_ENRICHED (joined with weather)       │                    │                  │
│   └─────────────────────────┬───────────────────┘                    │                  │
│                             │                                        │                  │
│                             ▼                                        ▼                  │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                         FLUX OPS CENTER (SPCS)                                   │  │
│   │                                                                                  │  │
│   │   /api/snowflake/* (Historical Analytics)  │  /api/postgres/* (Real-time Ops)   │  │
│   │   - AMI time-series queries                │  - Substation status (<20ms)       │  │
│   │   - Outage trend analysis                  │  - Grid asset cache                │  │
│   │   - ML model inference                     │  - Topology connections            │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Demo Deployment Steps

1. **Start SPCS Service** (already running)
   ```sql
   ALTER SERVICE <DATABASE>.<SCHEMA>.<SERVICE_NAME> 
   SET MIN_INSTANCES = 1, MAX_INSTANCES = 5;
   ```

2. **Activate Synthetic Generator**
   ```bash
   # Option A: Streamlit UI
   cd <project_path>/ami_generator
   uv run streamlit run app.py
   
   # Option B: CLI streaming mode
   uv run python ami_streaming_generator.py --meters 10000 --interval 15
   ```

3. **Access Dashboard**
   - URL: `https://<service-endpoint>.snowflakecomputing.app`
   - OAuth authentication required

---

## 5. PoC Architecture (With Confluent Cloud)

### Overview
For the PoC phase, if you can provision a Confluent Cloud cluster, this architecture demonstrates production-like streaming without requiring production infrastructure access.

### Prerequisites
- Confluent Cloud account with Basic/Standard cluster
- Snowflake Kafka Connector configured
- Network connectivity (PrivateLink preferred)

### Confluent Cloud Setup Steps

1. **Create Kafka Cluster**
   ```
   Confluent Cloud Console → Create Cluster → Basic (for PoC)
   Region: AWS us-west-2 (same as Snowflake)
   ```

2. **Create Topics**
   ```
   Topics → Create:
   - ami_readings (partitions: 6, retention: 7 days)
   - grid_events (partitions: 3, retention: 7 days)
   ```

3. **Configure Datagen Connector (generates synthetic AMI data)**
   ```json
   {
     "connector.class": "DatagenSource",
     "kafka.topic": "ami_readings",
     "output.data.format": "JSON",
     "quickstart": "CUSTOM",
     "schema.string": "{\"type\":\"record\",\"name\":\"AMIReading\",\"fields\":[{\"name\":\"meter_id\",\"type\":\"string\"},{\"name\":\"reading_time\",\"type\":\"string\"},{\"name\":\"kwh\",\"type\":\"double\"},{\"name\":\"voltage\",\"type\":\"double\"}]}",
     "max.interval": "1000",
     "iterations": "10000000"
   }
   ```

4. **Configure Snowflake Sink Connector**
   ```json
   {
     "connector.class": "SnowflakeSink",
     "topics": "ami_readings",
     "input.data.format": "JSON",
     "snowflake.url.name": "<account>.snowflakecomputing.com",
     "snowflake.user.name": "<KAFKA_CONNECTOR_USER>",
     "snowflake.private.key": "<base64_private_key>",
     "snowflake.database.name": "<DATABASE>",
     "snowflake.schema.name": "<SCHEMA>",
     "tasks.max": "4",
     "buffer.count.records": "10000",
     "buffer.flush.time": "60"
   }
   ```

5. **Create Dynamic Tables Pipeline**
   ```sql
   -- Bronze: Parse raw Kafka messages
   CREATE OR REPLACE DYNAMIC TABLE <DATABASE>.<SCHEMA>.AMI_KAFKA_PARSED
     TARGET_LAG = '1 minute'
     WAREHOUSE = <WAREHOUSE>
   AS
   SELECT 
     RECORD_CONTENT:meter_id::STRING AS meter_id,
     TRY_TO_TIMESTAMP_NTZ(RECORD_CONTENT:reading_time::STRING) AS reading_time,
     RECORD_CONTENT:kwh::FLOAT AS kwh,
     RECORD_CONTENT:voltage::FLOAT AS voltage,
     RECORD_METADATA:CreateTime::TIMESTAMP_NTZ AS kafka_timestamp,
     RECORD_METADATA:offset::NUMBER AS kafka_offset
   FROM <DATABASE>.<SCHEMA>.AMI_READINGS;
   
   -- Silver: Deduplicate
   CREATE OR REPLACE DYNAMIC TABLE <DATABASE>.<SCHEMA>.AMI_KAFKA_DEDUPLICATED
     TARGET_LAG = '1 minute'
     WAREHOUSE = <WAREHOUSE>
   AS
   SELECT *
   FROM <DATABASE>.<SCHEMA>.AMI_KAFKA_PARSED
   QUALIFY ROW_NUMBER() OVER (PARTITION BY meter_id, reading_time ORDER BY kafka_offset DESC) = 1;
   ```

---

## 6. Production Architecture *(Preview Features)*

### Overview
For production deployment with actual utility infrastructure, OpenFlow is recommended for zero-ops data integration.

> **Note:** OpenFlow is currently in Public Preview (as of May 2025). Check [Snowflake Preview Features](https://docs.snowflake.com/en/release-notes/preview-features) for current status. The Snowflake Kafka Connector is GA and can be used as an alternative.

### Why OpenFlow over Standalone Kafka Connector

| Factor | Standalone Connector | OpenFlow *(Preview)* |
|--------|---------------------|---------------|
| Infrastructure | Runs in Kafka cluster | Fully managed SPCS |
| Ops Burden | Low (config file) | **Zero** |
| Visual Design | None | NiFi canvas |
| Schema Evolution | Manual | **Automatic** |
| Multi-Source | Kafka only | **20+ sources** |
| Scale to Zero | N/A | **Automatic** (600s idle) |
| Self-Sufficiency | Low | **High** |

### OpenFlow Setup Steps *(Preview)*

1. **Create OpenFlow Deployment**
   ```sql
   -- Create OpenFlow deployment (one per account)
   CREATE OPENFLOW DEPLOYMENT <DEPLOYMENT_NAME>
     TYPE = SNOWFLAKE;
   ```

2. **Create Kafka Connector Runtime**
   ```sql
   -- Via Snowsight UI: Data Integration → Openflow → Create Runtime
   -- Or via SQL:
   CREATE OPENFLOW RUNTIME <RUNTIME_NAME>
     IN DEPLOYMENT <DEPLOYMENT_NAME>
     SIZE = 'SMALL'
     AUTO_SUSPEND_SECS = 600;  -- Scale to zero after 10 minutes
   ```

3. **Configure Kafka Connector**
   ```
   In Snowsight NiFi Canvas:
   1. Add ConsumeKafka processor
   2. Configure bootstrap servers (Kafka brokers)
   3. Set topic pattern: ami_readings.*
   4. Add PutSnowpipeStreaming processor
   5. Configure target table: <DATABASE>.<SCHEMA>.AMI_RAW_STREAM
   6. Start flow
   ```

---

## 7. Component Deep Dives

### 7.1 Snowflake Postgres *(Preview)*

> **Note:** Snowflake Postgres is currently in Public Preview (as of Dec 2025). Check [Snowflake Preview Features](https://docs.snowflake.com/en/release-notes/preview-features) for current status.

**Configuration:**
- Instance: PostgreSQL 17.7
- Compute: HIGHMEM_XL
- Status: READY

**Tables:**
| Table | Size | Purpose |
|-------|------|---------|
| grid_assets_cache | 302 MB | Substations for dashboard |
| topology_connections_cache | 768 MB | Feeder connectivity |
| substations | - | Substation metadata |
| circuit_status_realtime | - | Real-time circuit status |

**PostGIS Extension:** Available now for geospatial queries.

### 7.2 Dynamic Tables Pipeline

**Best Practices (from Snowflake docs):**
1. Keep changes <5% of total dataset between refreshes
2. Consider micro-partitions modified, not just row count
3. Minimize grouping operations (joins, GROUP BY, PARTITION BY)
4. Break large CTEs into separate Dynamic Tables
5. Use `QUALIFY ROW_NUMBER() OVER (...) = 1` for deduplication
6. Enable automatic clustering on join/group keys

**Pipeline Pattern:**
```sql
-- Bronze Layer
CREATE OR REPLACE DYNAMIC TABLE <DATABASE>.<SCHEMA>.AMI_RAW_STREAM
  TARGET_LAG = '1 minute'
  WAREHOUSE = <WAREHOUSE>
AS
SELECT * FROM [source];

-- Silver Layer (Deduplication)
CREATE OR REPLACE DYNAMIC TABLE <DATABASE>.<SCHEMA>.AMI_DEDUPLICATED
  TARGET_LAG = '1 minute'
  WAREHOUSE = <WAREHOUSE>
AS
SELECT *
FROM <DATABASE>.<SCHEMA>.AMI_RAW_STREAM
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY meter_id, reading_time 
  ORDER BY ingestion_time DESC
) = 1;

-- Gold Layer (Enriched)
CREATE OR REPLACE DYNAMIC TABLE <DATABASE>.<SCHEMA>.AMI_ENRICHED
  TARGET_LAG = '1 minute'
  WAREHOUSE = <WAREHOUSE>
AS
SELECT 
  d.*,
  w.temperature,
  w.humidity,
  e.lmp_price
FROM <DATABASE>.<SCHEMA>.AMI_DEDUPLICATED d
LEFT JOIN <DATABASE>.<SCHEMA>.WEATHER w 
  ON d.reading_time::DATE = w.weather_date
LEFT JOIN <DATABASE>.<SCHEMA>.ERCOT_PRICING e
  ON d.reading_time = e.price_timestamp;
```

### 7.3 SPCS Service

**Configuration Pattern:**
```yaml
spec:
  containers:
  - name: frontend
    image: /<database>/<schema>/<repo>/<image>:latest
    env:
      SNOWFLAKE_WAREHOUSE: <WAREHOUSE>
      VITE_POSTGRES_HOST: <postgres_host>
      VITE_POSTGRES_PORT: "5432"
      VITE_POSTGRES_DATABASE: postgres
      VITE_POSTGRES_USER: <username>
  endpoints:
  - name: ui
    port: 8080
    public: true
```

**Key Settings:**
- MIN_INSTANCES: 1 (always-on, no cold starts)
- MAX_INSTANCES: 5 (auto-scaling)
- Compute Pool: Dedicated interactive pool
- External Access: Map tiles integration, Postgres integration

**SPCS Gotchas:**
1. **60-second ingress timeout** is hard-coded (use async patterns for long queries)
2. **MIN_INSTANCES via ALTER SERVICE**, not spec YAML
3. **Bundle external resources locally** (CSP blocks external CDNs)
4. **No SNOWFLAKE_HOST env var** - use OAuth token path

---

## 8. Deployment Guides

### 8.1 Quick Start (Demo)

```bash
# 1. Verify SPCS service is running
snow sql -q "CALL SYSTEM\$GET_SERVICE_STATUS('<DATABASE>.<SCHEMA>.<SERVICE>')" -c <connection>

# 2. Get endpoint URL
snow sql -q "SHOW ENDPOINTS IN SERVICE <DATABASE>.<SCHEMA>.<SERVICE>" -c <connection>

# 3. Access dashboard via the endpoint URL
```

### 8.2 Deploy New Version

```bash
# 1. Build Docker image
cd <project_path>
docker build --platform linux/amd64 \
  -t <account>.registry.snowflakecomputing.com/<database>/<schema>/<repo>/<image>:latest \
  -f Dockerfile.spcs .

# 2. Login to registry
snow spcs image-registry login --connection <connection>

# 3. Push image
docker push <account>.registry.snowflakecomputing.com/<database>/<schema>/<repo>/<image>:latest

# 4. Drop and recreate service
snow sql -q "DROP SERVICE <DATABASE>.<SCHEMA>.<SERVICE>" -c <connection>

snow sql -q "CREATE SERVICE <DATABASE>.<SCHEMA>.<SERVICE> \
  IN COMPUTE POOL <COMPUTE_POOL> \
  FROM SPECIFICATION \$\$$(cat service_spec_prod.yaml)\$\$ \
  EXTERNAL_ACCESS_INTEGRATIONS = (<INTEGRATIONS>)" \
  -c <connection>

# 5. Set MIN_INSTANCES
snow sql -q "ALTER SERVICE <DATABASE>.<SCHEMA>.<SERVICE> SET MIN_INSTANCES = 1" -c <connection>
```

### 8.3 Postgres Connection

```bash
# Direct psql connection
export PGHOST=<postgres_host>.snowflake.app
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER=<username>

psql -c "SELECT COUNT(*) FROM grid_assets_cache;"
```

---

## 9. Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| **Streaming Latency** (Kafka → Snowflake) | <1 min | N/A (not active) |
| **Dynamic Table Refresh** | 1 min | 1 min |
| **Postgres Query** | <20ms | <20ms |
| **Snowflake Analytics** | <5s | <5s |
| **Dashboard Initial Load** | <3s | ~3s |
| **End-to-End** (event → dashboard) | <2 min | N/A |

**Cost Estimates:**
| Configuration | Monthly Cost |
|---------------|--------------|
| Demo (current) | ~$730 (Warehouse XL) + ~$50 (Postgres) |
| PoC (Confluent) | Add ~$100-200 (Confluent Basic) |
| Production (OpenFlow) | Add ~$400-1,100 (OpenFlow runtime) |

---

## 10. Strategic Value

### The Core Message

> "We're not asking you to rip out Kafka. Kafka is great at sub-second message delivery.
>
> What Kafka CAN'T do is join your AMI data with weather, ERCOT pricing, transformer metadata, and vegetation risk across 7 billion rows in 2 seconds. Kafka can't answer 'Which transformers are overloaded when LMP exceeds $100?' in natural language.
>
> **Snowflake is the analytics brain. Kafka is the nervous system. They work together.**
>
> Your team uses standard PostgreSQL and SQL. Your team uses a visual canvas for data integration. Your team owns the entire stack."

### Key Talking Points

1. **"Postgres is your real-time brain, Snowflake is your analytics brain"**
   - Postgres: <20ms for operational queries (ERM, dashboard)
   - Snowflake: Sub-second over 7.1B rows for analytics

2. **"pg_lake eliminates the ETL tax"**
   - Two-way Iceberg sync means no duplicate data management
   - At GA (Summit '26): Automated sync, one source of truth

3. **"Your team knows Postgres"**
   - Standard PostGIS for geospatial (ESRI-compatible)
   - Standard SQL for queries
   - Cortex Analyst for natural language (no AI expertise needed)

4. **"One platform, one bill, one security model"**
   - Apply Snowflake committed spend to Postgres
   - Unified governance across transactional and analytics

---

## Appendix A: Connection Information Template

| Resource | Value |
|----------|-------|
| Snowflake Account | `<ACCOUNT_IDENTIFIER>` |
| Connection Name | `<CONNECTION_NAME>` |
| Database | `<DATABASE>` |
| Schemas | `<SCHEMA_LIST>` |
| Warehouse | `<WAREHOUSE>` |
| Region | `<REGION>` |
| SPCS Endpoint | `https://<endpoint>.snowflakecomputing.app` |
| Postgres Host | `<postgres_id>.<region>.aws.postgres.snowflake.app` |

---

*This is a de-identified public version. Replace `<PLACEHOLDER>` values with your actual resource identifiers.*
