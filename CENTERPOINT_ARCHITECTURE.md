# Grid Operations Grid Operations Platform
## Comprehensive Architecture & Deployment Guide

**Version:** 1.1  
**Date:** January 12, 2026  
**Author:** Abhinav Bannerjee (Senior Solution Engineer - Enterprise Acquisition, Snowflake)  
**Status:** Production-Ready Architecture Specification

> **⚠️ NOTE:** The authoritative architecture documentation is now consolidated in `/Users/abannerjee/Documents/cpe_poc/PROJECT_STATUS.md` under the section "🗺️ Flux Operations Center - Comprehensive Architecture". This file contains detailed deployment guides and strategic context but the main architecture section should be referenced from PROJECT_STATUS.md.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Use Case Mapping](#2-use-case-mapping)
3. [Architecture Overview](#3-architecture-overview)
4. [Demo Architecture (No Kafka)](#4-demo-architecture-no-kafka)
5. [PoC Architecture (With Confluent Cloud)](#5-poc-architecture-with-confluent-cloud)
6. [Production Architecture (CNP Systems)](#6-production-architecture-cnp-systems)
7. [Component Deep Dives](#7-component-deep-dives)
8. [Deployment Guides](#8-deployment-guides)
9. [Performance Targets](#9-performance-targets)
10. [Anti-#Strategy](#10-anti-fde-strategy)

---

## 1. Executive Summary

### Purpose
This document provides end-to-end architecture guidance for the Flux Operations Center, Snowflake's competitive response to Palantir Grid 360 for Grid Operations (CNP).

### Core Thesis
Snowflake provides a unified platform where CNP's existing teams can build and own superior applications faster than Palantir professional services teams, using standard SQL and Python.

### Key Differentiators
| Capability | Palantir Grid 360 | Snowflake Platform |
|------------|-------------------|-------------------|
| Data Model | Proprietary Ontology | Standard SQL + Semantic Views |
| App Framework | Custom (custom-built) | Streamlit + SPCS (standard Python) |
| Geospatial | Custom #work | PostGIS (industry standard) |
| Real-Time | Foundry pipelines | OpenFlow + Kafka Connector |
| AI/ML | Black-box models | Cortex AI (transparent, owned by CNP) |
| Lock-in | Heavy | Minimal (open formats: Iceberg, Postgres) |

---

## 2. Use Case Mapping

### Daniel Sumners' Stated Requirements (from Strategy Doc)

| # | Use Case | CNP Requirement | Snowflake Solution | Demo Phase | PoC Phase | Production |
|---|----------|-----------------|-------------------|------------|-----------|------------|
| 1 | **AMI Data Management** | 100B records/year, sub-minute streaming | Dynamic Tables + OpenFlow Kafka | Synthetic generator | Confluent Cloud | CNP Kafka |
| 2 | **ERM (Estimated Restoration Modeling)** | Sub-second response times (currently Redis) | Snowflake Postgres (<20ms) | Postgres cache | Postgres cache | Postgres cache |
| 3 | **Digital Twin** | "Google Maps" view of grid | DeckGL + MapLibre + PostGIS | SPCS app | SPCS app | SPCS app |
| 4 | **Customer 360** | Identity resolution in deregulated market | Cortex AI Vector Embeddings | Demo data | CNP sample data | Production data |
| 5 | **Conversational AI** | Natural language data marketplace | Cortex Agent + Analyst | Semantic model | Expanded model | Full model |
| 6 | **Project Elevate** | 1-2% O&M reduction | Cortex Search on technical manuals | 100 PDFs | 1000 PDFs | Full corpus |
| 7 | **Geospatial Analysis** | Complex intersects (ESRI shop) | PostGIS + Snowflake Geospatial | Demo polygons | Real GIS data | Production GIS |
| 8 | **SAP Integration** | S/4HANA migration | OpenFlow Oracle/SAP CDC | Not in demo | Future | Phase 2 |

---

## 3. Architecture Overview

### Three-Layer Value Proposition

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          CENTERPOINT UNIFIED DATA PLATFORM                              │
│                              (Anti-Palantir Architecture)                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 1: TRANSACTIONAL (Snowflake Postgres)                                     │   │
│  │                                                                                 │   │
│  │  Purpose: Sub-20ms operational queries for real-time apps                       │   │
│  │                                                                                 │   │
│  │  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐               │   │
│  │  │  ERM Outage App │   │  Grid Asset     │   │  PostGIS        │               │   │
│  │  │  (replaces      │   │  Cache          │   │  Geospatial     │               │   │
│  │  │   Redis)        │   │  (242 subs)     │   │  Queries        │               │   │
│  │  └─────────────────┘   └─────────────────┘   └─────────────────┘               │   │
│  │                                                                                 │   │
│  │  Key Tech: PostgreSQL 17.7, pg_lake (Iceberg sync), PostGIS extension          │   │
│  │  Latency Target: <20ms                                                          │   │
│  └───────────────────────────────────────────────────────────────────┬─────────────┘   │
│                                                                      │                 │
│                                              pg_lake (no ETL required)│                 │
│                                              Iceberg format sync      │                 │
│                                                                      ▼                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 2: STREAMING (Kafka → Snowflake)                                          │   │
│  │                                                                                 │   │
│  │  Demo:        Synthetic Generator → Direct Snowflake Write                      │   │
│  │  PoC:         Confluent Cloud → Snowflake Kafka Connector                       │   │
│  │  Production:  CNP Kafka → OpenFlow SPCS (zero-ops, visual canvas)               │   │
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
│  │  Deployment: MIN_INSTANCES=1, MAX_INSTANCES=5, FLUX_INTERACTIVE_POOL            │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Demo Architecture (No Kafka)

### Overview
For demonstrations without utility Kafka infrastructure, we use a synthetic data generator that writes directly to Snowflake and Postgres.

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
│   │ Snowpipe (AUTO_INGEST)   │ FLUX_OPS_CENTER      │   │ ami_realtime table     │     │
│   │        │             │   │ .AMI_RAW_STREAM      │   │ (hot 15-min window)    │     │
│   │        ▼             │   │        │             │   │        │               │     │
│   │ ~1 min latency       │   │        ▼             │   │        ▼               │     │
│   │                      │   │ Dynamic Table        │   │ <100ms write latency   │     │
│   │                      │   │ (1-min TARGET_LAG)   │   │                        │     │
│   └──────────┬───────────┘   └──────────┬───────────┘   └────────────┬───────────┘     │
│              │                          │                            │                  │
│              └──────────────┬───────────┘                            │                  │
│                             ▼                                        │                  │
│   ┌─────────────────────────────────────────────┐                    │                  │
│   │     SNOWFLAKE (Analytics Layer)             │                    │                  │
│   │                                             │                    │                  │
│   │  SI_DEMOS.PRODUCTION.AMI_INTERVAL_READINGS  │                    │                  │
│   │  (7.1B rows - historical)                   │                    │                  │
│   │                                             │                    │                  │
│   │  SI_DEMOS.FLUX_OPS_CENTER schema:           │                    │                  │
│   │  - AMI_RAW_STREAM (streaming landing)       │                    │                  │
│   │  - AMI_DEDUPLICATED (15K rows)              │                    │                  │
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

CURRENT STATE (January 10, 2026):
✅ SPCS Service: FLUX_OPS_CENTER (RUNNING, MIN_INSTANCES=1)
✅ Postgres: FLUX_OPERATIONS_POSTGRES (PostgreSQL 17.7, READY)
✅ AMI Historical: 7,105,569,024 rows
✅ Pipeline Tables: AMI_DEDUPLICATED (15K), AMI_ENRICHED (15K)
⚠️ Streaming: AMI_RAW_STREAM (0 rows - generator not connected)
```

### Demo Deployment Steps

1. **Start SPCS Service** (already running)
   ```sql
   ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER 
   SET MIN_INSTANCES = 1, MAX_INSTANCES = 5;
   ```

2. **Activate Synthetic Generator**
   ```bash
   # Option A: Streamlit UI
   cd /Users/abannerjee/Documents/cpe_poc/ami_generator
   uv run streamlit run app.py
   
   # Option B: CLI streaming mode
   uv run python ami_streaming_generator.py --meters 10000 --interval 15
   ```

3. **Access Dashboard**
   - URL: `https://bqbm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app`
   - OAuth authentication required

---

## 5. PoC Architecture (With Confluent Cloud)

### Overview
For the PoC phase, if you can provision a Confluent Cloud cluster, this architecture demonstrates production-like streaming without requiring CNP infrastructure access.

### Prerequisites
- Confluent Cloud account with Basic/Standard cluster
- Snowflake Kafka Connector configured
- Network connectivity (PrivateLink preferred)

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              PoC ARCHITECTURE (Confluent Cloud)                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    CONFLUENT CLOUD (Your Account)                               │   │
│   │                                                                                 │   │
│   │   ┌─────────────────────┐         ┌─────────────────────┐                      │   │
│   │   │  Datagen Source     │         │  Kafka Topics       │                      │   │
│   │   │  Connector          │────────▶│                     │                      │   │
│   │   │  (generates AMI-    │         │  - ami_readings     │                      │   │
│   │   │   like events)      │         │  - grid_events      │                      │   │
│   │   └─────────────────────┘         │  - outage_alerts    │                      │   │
│   │                                   └──────────┬──────────┘                      │   │
│   │                                              │                                  │   │
│   │   ┌─────────────────────────────────────────┼─────────────────────────────────┐│   │
│   │   │              SCHEMA REGISTRY            │                                 ││   │
│   │   │              (Avro/JSON Schema)         │                                 ││   │
│   │   └─────────────────────────────────────────┼─────────────────────────────────┘│   │
│   │                                              │                                  │   │
│   └──────────────────────────────────────────────┼──────────────────────────────────┘   │
│                                                  │                                       │
│                                                  │ Snowflake Kafka Connector            │
│                                                  │ (Fully Managed on Confluent Cloud)   │
│                                                  │                                       │
│                                                  │ Configuration:                        │
│                                                  │   tasks.max: 4                        │
│                                                  │   buffer.count.records: 10000         │
│                                                  │   buffer.flush.time: 60               │
│                                                  │                                       │
│                                                  ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    SNOWFLAKE LANDING                                             │   │
│   │                                                                                  │   │
│   │   Auto-created by Kafka Connector:                                               │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │  SI_DEMOS.KAFKA_LANDING.AMI_READINGS                                    │   │   │
│   │   │  - RECORD_CONTENT (VARIANT) - raw Kafka message                         │   │   │
│   │   │  - RECORD_METADATA (VARIANT) - topic, partition, offset, timestamp      │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────┘   │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────┬────────────────────────────────────┘   │
│                                                 │                                        │
│                                                 ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    DYNAMIC TABLES PIPELINE                                       │   │
│   │                                                                                  │   │
│   │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐               │   │
│   │   │ AMI_PARSED      │   │ AMI_DEDUPLICATED│   │ AMI_ENRICHED    │               │   │
│   │   │ (Bronze)        │──▶│ (Silver)        │──▶│ (Gold)          │               │   │
│   │   │ TARGET_LAG: 1m  │   │ TARGET_LAG: 1m  │   │ TARGET_LAG: 1m  │               │   │
│   │   └─────────────────┘   └─────────────────┘   └─────────────────┘               │   │
│   │                                                                                  │   │
│   │   Best Practices (from Snowflake docs):                                          │   │
│   │   - Keep changes <5% of total dataset between refreshes                          │   │
│   │   - Consider micro-partitions modified, not just row count                       │   │
│   │   - Break large CTEs into separate Dynamic Tables                                │   │
│   │   - Use QUALIFY ROW_NUMBER() = 1 for deduplication                               │   │
│   │   - Enable automatic clustering on join/group keys                               │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

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
     "snowflake.url.name": "sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.com",
     "snowflake.user.name": "KAFKA_CONNECTOR_USER",
     "snowflake.private.key": "<base64_private_key>",
     "snowflake.database.name": "SI_DEMOS",
     "snowflake.schema.name": "KAFKA_LANDING",
     "tasks.max": "4",
     "buffer.count.records": "10000",
     "buffer.flush.time": "60"
   }
   ```

5. **Create Dynamic Tables Pipeline**
   ```sql
   -- Bronze: Parse raw Kafka messages
   CREATE OR REPLACE DYNAMIC TABLE SI_DEMOS.FLUX_OPS_CENTER.AMI_KAFKA_PARSED
     TARGET_LAG = '1 minute'
     WAREHOUSE = SI_DEMO_WH
   AS
   SELECT 
     RECORD_CONTENT:meter_id::STRING AS meter_id,
     TRY_TO_TIMESTAMP_NTZ(RECORD_CONTENT:reading_time::STRING) AS reading_time,
     RECORD_CONTENT:kwh::FLOAT AS kwh,
     RECORD_CONTENT:voltage::FLOAT AS voltage,
     RECORD_METADATA:CreateTime::TIMESTAMP_NTZ AS kafka_timestamp,
     RECORD_METADATA:offset::NUMBER AS kafka_offset
   FROM SI_DEMOS.KAFKA_LANDING.AMI_READINGS;
   
   -- Silver: Deduplicate
   CREATE OR REPLACE DYNAMIC TABLE SI_DEMOS.FLUX_OPS_CENTER.AMI_KAFKA_DEDUPLICATED
     TARGET_LAG = '1 minute'
     WAREHOUSE = SI_DEMO_WH
   AS
   SELECT *
   FROM SI_DEMOS.FLUX_OPS_CENTER.AMI_KAFKA_PARSED
   QUALIFY ROW_NUMBER() OVER (PARTITION BY meter_id, reading_time ORDER BY kafka_offset DESC) = 1;
   ```

---

## 6. Production Architecture (CNP Systems)

### Overview
For production deployment with utility actual infrastructure, OpenFlow SPCS is recommended for zero-ops data integration.

### Why OpenFlow SPCS over Standalone Kafka Connector

| Factor | Standalone Connector | OpenFlow SPCS |
|--------|---------------------|---------------|
| Infrastructure | Runs in Kafka cluster | Fully managed SPCS |
| Ops Burden | Low (config file) | **Zero** |
| Visual Design | None | NiFi canvas |
| Schema Evolution | Manual | **Automatic** |
| Multi-Source | Kafka only | **20+ sources** |
| Scale to Zero | N/A | **Automatic** (600s idle) |
| CNP Self-Sufficiency | Low | **High** |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     PRODUCTION ARCHITECTURE (utility Systems)                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    CENTERPOINT EXISTING INFRASTRUCTURE                          │   │
│   │                                                                                 │   │
│   │   ┌──────────────┐      ┌──────────────┐      ┌──────────────────────────┐     │   │
│   │   │  2.7M AMI    │ RF   │  Itron/L+G   │ Kafka│  utility Kafka       │     │   │
│   │   │  Meters      │─────▶│  Head-End    │─────▶│  Cluster (Existing)      │     │   │
│   │   │              │ Mesh │  System      │ <1s  │  - ami_readings topic    │     │   │
│   │   └──────────────┘      └──────────────┘      │  - grid_events topic     │     │   │
│   │                                               │  - outage_alerts topic   │     │   │
│   │                                               └────────────┬─────────────┘     │   │
│   │                                                            │                    │   │
│   └────────────────────────────────────────────────────────────┼────────────────────┘   │
│                                                                │                         │
│   ┌────────────────────────────────────────────────────────────┼────────────────────┐   │
│   │                    OPENFLOW SPCS (Zero-Ops)                │                    │   │
│   │                                                            ▼                    │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────┐  │   │
│   │   │                    VISUAL NIFI CANVAS                                    │  │   │
│   │   │                    (Snowsight UI)                                        │  │   │
│   │   │                                                                          │  │   │
│   │   │   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐            │  │   │
│   │   │   │ ConsumeKafka│─────▶│ Transform   │─────▶│ PutSnowpipe │            │  │   │
│   │   │   │ Processor   │      │ JSON        │      │ Streaming   │            │  │   │
│   │   │   │ (2-4 tasks) │      │ Processor   │      │ (2-4 tasks) │            │  │   │
│   │   │   └─────────────┘      └─────────────┘      └─────────────┘            │  │   │
│   │   │                                                                          │  │   │
│   │   │   Runtime Sizing (from Snowflake OpenFlow docs):                         │  │   │
│   │   │   ┌─────────────────────────────────────────────────────────────────┐   │  │   │
│   │   │   │  Small (1 vCPU, 2GB):  Up to 10 MB/s  ← CNP steady-state       │   │  │   │
│   │   │   │  Medium (4 vCPU, 10GB): Up to 40 MB/s  ← Storm events          │   │  │   │
│   │   │   │  Large (8 vCPU, 20GB):  Exceeding 40 MB/s                       │   │  │   │
│   │   │   └─────────────────────────────────────────────────────────────────┘   │  │   │
│   │   │                                                                          │  │   │
│   │   │   CNP Volume Estimate:                                                   │  │   │
│   │   │   - 2.7M meters × 1 reading/15 min = 180K readings/min = 3,000/sec      │  │   │
│   │   │   - Assuming 1KB/reading (JSON): ~3 MB/s sustained                       │  │   │
│   │   │   - Storm spike (10x): ~30 MB/s → Medium runtime                         │  │   │
│   │   │                                                                          │  │   │
│   │   └─────────────────────────────────────────────────────────────────────────┘  │   │
│   │                                                                                 │   │
│   │   Features:                                                                     │   │
│   │   - Auto-scaling (HPA based on CPU)                                             │   │
│   │   - Scale-to-zero after 600s idle                                               │   │
│   │   - Native Snowflake security (RBAC, EAIs)                                      │   │
│   │   - Visual pipeline editing without code                                        │   │
│   │   - Future: Add Oracle CDC, SAP feeds, SFTP without new infrastructure          │   │
│   │                                                                                 │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    SNOWFLAKE UNIFIED ANALYTICS                                   │   │
│   │                                                                                  │   │
│   │   [Same as Demo architecture - Dynamic Tables, Cortex AI, SPCS App]              │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    SNOWFLAKE POSTGRES (Operational Layer)                        │   │
│   │                                                                                  │   │
│   │   [Same as Demo - ERM app, Grid cache, PostGIS]                                  │   │
│   │                                                                                  │   │
│   │   Future (pg_lake at Summit GA):                                                 │   │
│   │   - Two-way Iceberg sync with Snowflake analytics                                │   │
│   │   - No ETL pipelines required                                                    │   │
│   │   - Single source of truth                                                       │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### OpenFlow SPCS Setup Steps

1. **Create OpenFlow Deployment**
   ```sql
   -- Create OpenFlow deployment (one per account)
   CREATE OPENFLOW DEPLOYMENT FLUX_OPENFLOW_DEPLOYMENT
     TYPE = SNOWFLAKE;
   ```

2. **Create Kafka Connector Runtime**
   ```sql
   -- Via Snowsight UI: Data Integration → Openflow → Create Runtime
   -- Or via SQL:
   CREATE OPENFLOW RUNTIME FLUX_KAFKA_RUNTIME
     IN DEPLOYMENT FLUX_OPENFLOW_DEPLOYMENT
     SIZE = 'SMALL'
     AUTO_SUSPEND_SECS = 600;  -- Scale to zero after 10 minutes
   ```

3. **Configure Kafka Connector**
   ```
   In Snowsight NiFi Canvas:
   1. Add ConsumeKafka processor
   2. Configure bootstrap servers (CNP Kafka brokers)
   3. Set topic pattern: ami_readings.*
   4. Add PutSnowpipeStreaming processor
   5. Configure target table: SI_DEMOS.FLUX_OPS_CENTER.AMI_RAW_STREAM
   6. Start flow
   ```

---

## 7. Component Deep Dives

### 7.1 Snowflake Postgres (FLUX_OPERATIONS_POSTGRES)

**Current State:**
- Instance: PostgreSQL 17.7
- Compute: HIGHMEM_XL
- Status: READY
- Host: `<your_postgres_host>`

**Tables:**
| Table | Size | Purpose |
|-------|------|---------|
| grid_assets_cache | 302 MB | 242 substations for dashboard |
| topology_connections_cache | 768 MB | Feeder connectivity |
| substations | - | Substation metadata |
| circuit_status_realtime | - | Real-time circuit status |

**Roadmap (from BUILD '25 docs):**
| Feature | Timeline | Impact |
|---------|----------|--------|
| Data Movement PuPr | BUILD London (Feb 2026) | Manual pg_lake sync |
| Data Movement GA | Summit (Jun 2026) | Automated two-way sync |
| Federated Queries | Post-GA | Query Snowflake + Postgres together |
| PostGIS Extension | Now | Geospatial queries |

**Key pg_lake Capabilities:**
- Create/modify Iceberg tables from PostgreSQL
- Full transactional guarantees
- Query same data from Snowflake analytics layer
- No ETL pipelines required

### 7.2 Dynamic Tables Pipeline

**Best Practices (from Snowflake docs):**
1. Keep changes <5% of total dataset between refreshes
2. Consider micro-partitions modified, not just row count
3. Minimize grouping operations (joins, GROUP BY, PARTITION BY)
4. Break large CTEs into separate Dynamic Tables
5. Use `QUALIFY ROW_NUMBER() OVER (...) = 1` for deduplication
6. Enable automatic clustering on join/group keys

**Current Pipeline:**
```sql
-- Bronze Layer
CREATE OR REPLACE DYNAMIC TABLE SI_DEMOS.FLUX_OPS_CENTER.AMI_RAW_STREAM
  TARGET_LAG = '1 minute'
  WAREHOUSE = SI_DEMO_WH
AS
SELECT * FROM [source];

-- Silver Layer (Deduplication)
CREATE OR REPLACE DYNAMIC TABLE SI_DEMOS.FLUX_OPS_CENTER.AMI_DEDUPLICATED
  TARGET_LAG = '1 minute'
  WAREHOUSE = SI_DEMO_WH
AS
SELECT *
FROM SI_DEMOS.FLUX_OPS_CENTER.AMI_RAW_STREAM
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY meter_id, reading_time 
  ORDER BY ingestion_time DESC
) = 1;

-- Gold Layer (Enriched)
CREATE OR REPLACE DYNAMIC TABLE SI_DEMOS.FLUX_OPS_CENTER.AMI_ENRICHED
  TARGET_LAG = '1 minute'
  WAREHOUSE = SI_DEMO_WH
AS
SELECT 
  d.*,
  w.temperature,
  w.humidity,
  e.lmp_price
FROM SI_DEMOS.FLUX_OPS_CENTER.AMI_DEDUPLICATED d
LEFT JOIN SI_DEMOS.PRODUCTION.WEATHER w 
  ON d.reading_time::DATE = w.weather_date
LEFT JOIN SI_DEMOS.PRODUCTION.ERCOT_PRICING e
  ON d.reading_time = e.price_timestamp;
```

### 7.3 SPCS Service (FLUX_OPS_CENTER)

**Current Configuration:**
```yaml
spec:
  containers:
  - name: frontend
    image: /si_demos/applications/flux_ops_center_repo/flux_ops_center:latest
    env:
      SNOWFLAKE_WAREHOUSE: SI_DEMO_WH
      VITE_POSTGRES_HOST: mthi2s7canh3xpfhyzdhuuj7pu...
      VITE_POSTGRES_PORT: "5432"
      VITE_POSTGRES_DATABASE: postgres
      VITE_POSTGRES_USER: application
  endpoints:
  - name: ui
    port: 8080
    public: true
```

**Key Settings:**
- MIN_INSTANCES: 1 (always-on, no cold starts)
- MAX_INSTANCES: 5 (auto-scaling)
- Compute Pool: FLUX_INTERACTIVE_POOL
- External Access: FLUX_CARTO_INTEGRATION, FLUX_POSTGRES_INTEGRATION

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
snow sql -q "CALL SYSTEM\$GET_SERVICE_STATUS('SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER')" -c cpe_demo_CLI

# 2. Get endpoint URL
snow sql -q "SHOW ENDPOINTS IN SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER" -c cpe_demo_CLI

# 3. Access dashboard
# URL: https://bqbm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app
```

### 8.2 Deploy New Version

```bash
# 1. Build Docker image
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
docker build --platform linux/amd64 \
  -t sfsehol-si-ae-enablement-retail-hmjrfl.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center_repo/flux_ops_center:latest \
  -f Dockerfile.spcs .

# 2. Login to registry
snow spcs image-registry login --connection cpe_demo_CLI

# 3. Push image
docker push sfsehol-si-ae-enablement-retail-hmjrfl.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center_repo/flux_ops_center:latest

# 4. Drop and recreate service
snow sql -q "DROP SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER" -c cpe_demo_CLI

snow sql -q "CREATE SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER \
  IN COMPUTE POOL FLUX_INTERACTIVE_POOL \
  FROM SPECIFICATION \$\$$(cat service_spec_prod.yaml)\$\$ \
  EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, FLUX_POSTGRES_INTEGRATION)" \
  -c cpe_demo_CLI

# 5. Set MIN_INSTANCES
snow sql -q "ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER SET MIN_INSTANCES = 1" -c cpe_demo_CLI
```

### 8.3 Postgres Connection

```bash
# Direct psql connection
export PGHOST=<your_postgres_host>
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER=application

psql -c "SELECT COUNT(*) FROM grid_assets_cache;"
```

---

## 9. Performance Targets

| Metric | Target | Current | Grid 360 Baseline |
|--------|--------|---------|-------------------|
| **Streaming Latency** (Kafka → Snowflake) | <1 min | N/A (not active) | 5-10 min |
| **Dynamic Table Refresh** | 1 min | 1 min | N/A |
| **Postgres Query** | <20ms | <20ms | N/A |
| **Snowflake Analytics** | <5s | <5s | N/A |
| **Dashboard Initial Load** | <3s | ~3s | N/A |
| **End-to-End** (event → dashboard) | <2 min | N/A | 5-10 min |

**Cost Estimates:**
| Configuration | Monthly Cost |
|---------------|--------------|
| Demo (current) | ~$730 (SI_DEMO_WH XL) + ~$50 (Postgres) |
| PoC (Confluent) | Add ~$100-200 (Confluent Basic) |
| Production (OpenFlow) | Add ~$400-1,100 (OpenFlow runtime) |

---

## 10. Anti-#Strategy

### The Core Message to Daniel

> "We're not asking you to rip out Kafka. Kafka is great at sub-second message delivery.
>
> What Kafka CAN'T do is join your AMI data with weather, ERCOT pricing, transformer metadata, and vegetation risk across 7 billion rows in 2 seconds. Kafka can't answer 'Which transformers are overloaded when LMP exceeds $100?' in natural language.
>
> **Snowflake is the analytics brain. Kafka is the nervous system. They work together.**
>
> Your team uses standard PostgreSQL and SQL - no Palantir Ontology to learn. Your team uses a visual canvas for data integration - no professional services teams required. Your team owns the entire stack."

### Key Talking Points

1. **"Postgres is your real-time brain, Snowflake is your analytics brain"**
   - Postgres: <20ms for operational queries (ERM, dashboard)
   - Snowflake: Sub-second over 7.1B rows for analytics

2. **"pg_lake eliminates the ETL tax"**
   - Two-way Iceberg sync means no duplicate data management
   - At GA (Summit '26): Automated sync, one source of truth

3. **"Your team knows Postgres - no #required"**
   - Standard PostGIS for geospatial (ESRI-compatible)
   - Standard SQL for queries
   - Cortex Analyst for natural language (no AI expertise needed)

4. **"One platform, one bill, one security model"**
   - Apply Snowflake committed spend to Postgres
   - Unified governance across transactional and analytics

---

## Appendix A: Connection Information

| Resource | Value |
|----------|-------|
| Snowflake Account | GZB42423 (SFSEHOL-SI_AE_ENABLEMENT_RETAIL_HMJRFL) |
| Connection Name | cpe_demo_CLI |
| Database | SI_DEMOS |
| Schemas | PRODUCTION, APPLICATIONS, FLUX_OPS_CENTER |
| Warehouse | SI_DEMO_WH |
| Region | AWS_US_WEST_2 |
| SPCS Endpoint | https://f6bm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app |
| Postgres Host | <your_postgres_host> |

## Appendix B: Document Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | January 10, 2026 | Abhinav Bannerjee | Initial consolidated document |

---

**This document supersedes:**
- FLUX_ARCHITECTURE_Jan8.md
- PROJECT_STATUS.md
- ARCHITECTURE.md

All future updates should be made to this document.
