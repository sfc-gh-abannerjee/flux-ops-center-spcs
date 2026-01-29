# Flux Operations Center

**Grid Operations Grid Operations Platform** - Snowflake's competitive response to Palantir Grid 360

---

## Live Demo

**URL:** https://bqbm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app  
**Status:** RUNNING (MIN_INSTANCES=1, always-on)

---

## Documentation

| Document | Description |
|----------|-------------|
| **[docs/LOCAL_DEVELOPMENT_GUIDE.md](./docs/LOCAL_DEVELOPMENT_GUIDE.md)** | Complete local dev setup, authentication, troubleshooting |
| **[docs/DATA_LOADING_GUIDE.md](./docs/DATA_LOADING_GUIDE.md)** | Load AMI data (7.1B rows) from S3 |
| [docs/INDEX.md](./docs/INDEX.md) | Documentation index |
| [docs/POSTGRES_SYNC_RELIABILITY.md](./docs/POSTGRES_SYNC_RELIABILITY.md) | Snowflake→Postgres sync architecture |
| [docs/CASCADE_QUICK_REFERENCE.md](./docs/CASCADE_QUICK_REFERENCE.md) | Cascade analysis tools |
| [CENTERPOINT_ARCHITECTURE.md](./CENTERPOINT_ARCHITECTURE.md) | Full architecture & deployment guides |

---

## Quick Start (Local Development)

```bash
# Terminal 1 - Backend (FastAPI)
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 3001 --reload

# Terminal 2 - Frontend (Vite)
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3001 |
| Swagger Docs | http://localhost:3001/docs |

See [docs/LOCAL_DEVELOPMENT_GUIDE.md](./docs/LOCAL_DEVELOPMENT_GUIDE.md) for full setup instructions.

---

## Data Scale

| Dataset | Rows | Description |
|---------|------|-------------|
| **AMI_INTERVAL_READINGS** | 7.1B | 15-min interval readings, 597K meters, 4 months (Jul/Aug 2024, Jul/Aug 2025) |
| TRANSFORMER_HOURLY_LOAD | 415M | Hourly transformer load aggregations |
| THERMAL_STRESS | 212M | Transformer thermal stress events |
| CUSTOMERS | 686K | Customer master data |
| METERS | 597K | Meter infrastructure |
| SAP_WORK_ORDERS | 250K | Work order history |
| TRANSFORMERS | 92K | Transformer metadata with GIS |
| POLES | 62K | Pole infrastructure |
| FEEDERS | 66K | Distribution feeder topology |

**External Data (S3):** AMI data is exported to `s3://abannerjee-ami-demo/raw/ami/ami_interval_readings/` (78.7 GB, 385 parquet files). See [docs/DATA_LOADING_GUIDE.md](./docs/DATA_LOADING_GUIDE.md) for loading instructions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FLUX OPS CENTER - 4-LAYER ARCHITECTURE               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LAYER 1: TRANSACTIONAL       Snowflake Postgres (PostgreSQL 17)       │
│           <20ms queries       • PostGIS geospatial • Grid asset cache  │
│                                                                         │
│  LAYER 2: STREAMING           OpenFlow / Kafka Connector               │
│           <1 min latency      Demo: Synthetic generator                │
│                                                                         │
│  LAYER 3: ANALYTICS           Snowflake Core (7.1B AMI rows)           │
│           <5s queries         • Dynamic Tables • Cortex AI Agent       │
│                                                                         │
│  LAYER 4: APPLICATION         SPCS (React + DeckGL + FastAPI)          │
│           ~3s load            • 66K feeder visualization               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, DeckGL 8.9, MapLibre GL, Material-UI 5 |
| Backend | FastAPI, Gunicorn (4 workers) |
| Transactional DB | Snowflake Postgres (PostGIS) |
| Analytics DB | Snowflake Warehouse |
| Deployment | SPCS (FLUX_INTERACTIVE_POOL) |

---

## Connection Info

| Resource | Value |
|----------|-------|
| Snowflake Account | GZB42423 |
| Connection | `cpe_demo_CLI` |
| Database | SI_DEMOS |
| Warehouse | SI_DEMO_WH |

---

## Common Issues

| Issue | Fix |
|-------|-----|
| Port 3001 in use | `lsof -ti:3001 \| xargs kill -9` |
| boto3 SSO error | Already handled in server_fastapi.py |
| Topology 0 connections | `CALL SI_DEMOS.APPLICATIONS.SYNC_TOPOLOGY_TO_POSTGRES()` |
| Cortex Agent 401/403 | Verify `$SNOWFLAKE_PAT` is set |

See [docs/LOCAL_DEVELOPMENT_GUIDE.md](./docs/LOCAL_DEVELOPMENT_GUIDE.md) for detailed troubleshooting.

---

## File Structure

```
flux_ops_center_spcs/
├── README.md                    # This file
├── CENTERPOINT_ARCHITECTURE.md  # Full architecture doc
├── backend/
│   └── server_fastapi.py        # FastAPI server (port 3001)
├── src/                         # React frontend
├── scripts/
│   └── seed_data/               # Data loading scripts
│       └── load_ami_from_s3.sql # Load 7.1B AMI rows
├── docs/                        # Documentation
│   ├── INDEX.md                 # Doc index
│   ├── LOCAL_DEVELOPMENT_GUIDE.md
│   ├── DATA_LOADING_GUIDE.md    # AMI data loading
│   ├── POSTGRES_SYNC_RELIABILITY.md
│   └── CASCADE_QUICK_REFERENCE.md
├── Dockerfile.spcs              # SPCS container
└── archive/                     # Superseded docs
```

---

**Last Updated:** January 28, 2026  
**Author:** Abhinav Bannerjee (Senior SE - Enterprise Acquisition)
