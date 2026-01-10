# Flux Operations Center
## Grid Operations Grid Operations Platform

**Competitive Response to Palantir Grid 360**

---

## Quick Links

| Document | Purpose |
|----------|---------|
| **[CENTERPOINT_ARCHITECTURE.md](./CENTERPOINT_ARCHITECTURE.md)** | **PRIMARY** - Full architecture, deployment guides, use case mapping |
| [LOCAL_DEV_SETUP.md](./LOCAL_DEV_SETUP.md) | PAT setup for local development |

---

## Live Demo

**Endpoint:** https://bqbm57vg-sfsehol-si-ae-enablement-retail-hmjrfl.snowflakecomputing.app  
**Status:** RUNNING (MIN_INSTANCES=1, always-on)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLUX OPS CENTER - 4-LAYER ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 1: TRANSACTIONAL       Snowflake Postgres (PostgreSQL 17.7)         │
│           <20ms queries       • ERM outage app    • Grid asset cache       │
│                               • PostGIS geospatial                          │
│                                                                             │
│  LAYER 2: STREAMING           Demo: Synthetic generator                     │
│           <1 min latency      PoC: Confluent Cloud                         │
│                               Prod: CNP Kafka → OpenFlow SPCS              │
│                                                                             │
│  LAYER 3: ANALYTICS           Snowflake Core (7.1B AMI rows)               │
│           <5s queries         • Dynamic Tables   • Cortex AI Agent         │
│                               • ML models        • Semantic views           │
│                                                                             │
│  LAYER 4: APPLICATION         SPCS (React + DeckGL + Flask)                │
│           ~3s load            • 66K feeder visualization                   │
│                               • Real-time KPI dashboard                     │
│                               • Grid Intelligence AI Chat                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
- **React 18** + TypeScript + Vite
- **DeckGL 8.9** - Multi-layer visualization (66K feeders)
- **MapLibre GL** - CartoDB Dark Matter basemap
- **Material-UI 5** - Flux brand theme (cyan + amber)

### Backend
- **Flask** REST API (FastAPI migration recommended)
- **Gunicorn** - 4 workers, 120s timeout
- **Dual-backend**: Postgres (<20ms) + Snowflake (<5s)

### Data
- **Snowflake Postgres**: 12 tables, 1.1GB (real-time ops)
- **Snowflake Warehouse**: 7.1B AMI rows (analytics)
- **Dynamic Tables**: 1-minute TARGET_LAG

### Deployment
- **SPCS**: FLUX_INTERACTIVE_POOL
- **Config**: MIN_INSTANCES=1, MAX_INSTANCES=5
- **External Access**: FLUX_CARTO_INTEGRATION, FLUX_POSTGRES_INTEGRATION

---

## Quick Start

### View Service Status
```bash
snow sql -q "CALL SYSTEM\$GET_SERVICE_STATUS('SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER')" -c cpe_demo_CLI
```

### Get Endpoint
```bash
snow sql -q "SHOW ENDPOINTS IN SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER" -c cpe_demo_CLI
```

### Local Development
```bash
# Backend
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI python3 backend/server.py

# Frontend (separate terminal)
npm run dev
```

---

## Deploy New Version

```bash
# 1. Build
docker build --platform linux/amd64 \
  -t sfsehol-si-ae-enablement-retail-hmjrfl.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center_repo/flux_ops_center:latest \
  -f Dockerfile.spcs .

# 2. Push
snow spcs image-registry login --connection cpe_demo_CLI
docker push sfsehol-si-ae-enablement-retail-hmjrfl.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center_repo/flux_ops_center:latest

# 3. Recreate
snow sql -q "DROP SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER" -c cpe_demo_CLI
snow sql -q "CREATE SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER \
  IN COMPUTE POOL FLUX_INTERACTIVE_POOL \
  FROM SPECIFICATION \$\$$(cat service_spec_prod.yaml)\$\$ \
  EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, FLUX_POSTGRES_INTEGRATION)" \
  -c cpe_demo_CLI

# 4. Configure
snow sql -q "ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER SET MIN_INSTANCES = 1" -c cpe_demo_CLI
```

---

## Connection Info

| Resource | Value |
|----------|-------|
| Snowflake Account | GZB42423 (SFSEHOL-SI_AE_ENABLEMENT_RETAIL_HMJRFL) |
| Connection | cpe_demo_CLI |
| Database | SI_DEMOS |
| Warehouse | SI_DEMO_WH |
| Region | AWS_US_WEST_2 |

---

## File Structure

```
flux_ops_center_spcs/
├── CENTERPOINT_ARCHITECTURE.md  # PRIMARY architecture doc
├── LOCAL_DEV_SETUP.md           # Dev environment setup
├── README.md                    # This file
├── src/                         # React frontend
├── backend/                     # Flask API
├── Dockerfile.spcs              # Container build
├── service_spec_prod.yaml       # SPCS specification
└── archive/                     # Superseded docs (reference only)
    ├── ARCHITECTURE.md
    ├── PROJECT_STATUS.md
    └── FLUX_ARCHITECTURE_Jan8.md
```

---

## Daniel Sumners Use Cases → Snowflake Solutions

| Use Case | Solution | Status |
|----------|----------|--------|
| AMI Data Management | Dynamic Tables + OpenFlow | ✅ 7.1B rows |
| ERM Outage App | Snowflake Postgres (<20ms) | ✅ Operational |
| Digital Twin | DeckGL + PostGIS | ✅ 66K feeders |
| Customer 360 | Cortex AI Embeddings | 🔄 Planned |
| Conversational AI | Cortex Agent | ✅ Deployed |
| Project Elevate | Cortex Search (PDFs) | 🔄 Planned |
| Geospatial | PostGIS extension | ✅ Available |
| SAP Integration | OpenFlow CDC | 🔄 Phase 2 |

---

## Anti-Palantir Positioning

> **"Snowflake is the analytics brain. Kafka is the nervous system. They work together."**

| Palantir Grid 360 | Snowflake Platform |
|-------------------|-------------------|
| Proprietary Ontology | Standard SQL + Semantic Views |
| Custom custom-built apps | Streamlit + SPCS (standard Python) |
| Black-box AI models | Cortex AI (transparent, owned by CNP) |
| Heavy lock-in | Open formats (Iceberg, Postgres) |

---

**Last Updated:** January 10, 2026  
**Author:** Abhinav Bannerjee (Senior SE - Enterprise Acquisition)
