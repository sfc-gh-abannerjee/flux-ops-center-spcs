# Flux Operations Center - Documentation

**Utility Grid Operations Platform**

---

## Documentation

| Document | Description |
|----------|-------------|
| **[LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md)** | **START HERE** - Local dev setup, PAT auth, troubleshooting |
| **[DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md)** | **Load AMI data** - S3 stage access, bulk loading |
| **[API_REFERENCE.md](./API_REFERENCE.md)** | REST API overview (62 endpoints across 13 categories) |
| [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) | Cascade failure analysis tools, API, ML model |
| [POSTGRES_SYNC_GUIDE.md](./POSTGRES_SYNC_GUIDE.md) | Postgres sync procedures for dynamic data |
| [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) | Snowflake→Postgres sync architecture |
| [VEGETATION_RISK_ARCHITECTURE.md](./VEGETATION_RISK_ARCHITECTURE.md) | Vegetation risk analysis |
| [DATA_LAYER_MAPPING.md](./DATA_LAYER_MAPPING.md) | Data layer and source mapping |
| [DEPLOYMENT_PARITY_ANALYSIS.md](./DEPLOYMENT_PARITY_ANALYSIS.md) | Deployment method comparison |

---

## Quick Links

| Task | Document |
|------|----------|
| Set up local dev | [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) |
| Load AMI data | [DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md) |
| Configure Postgres sync | [POSTGRES_SYNC_GUIDE.md](./POSTGRES_SYNC_GUIDE.md) |
| Fix topology not loading | [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) |
| Use cascade analysis | [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) |

---

## Key Snowflake Objects

| Object | Type | Purpose |
|--------|------|---------|
| `<database>.APPLICATIONS` | Schema | Main app tables, sync procedures |
| `<database>.CASCADE_ANALYSIS` | Schema | Cascade analysis tables |
| `<database>.ML_DEMO` | Schema | ML models, grid topology |
| `SYNC_TOPOLOGY_TO_POSTGRES()` | Procedure | Sync topology to Postgres |

---

## File Structure

```
flux_ops_center_spcs/
├── README.md                    # Project overview
├── SECURITY.md                  # Security model, RBAC, credentials
├── backend/
│   ├── server_fastapi.py        # FastAPI server
│   ├── gnn_training/            # GPU-based GNN training (SPCS)
│   ├── ml/                      # ML model deployment
│   └── scripts/                 # Utility scripts
├── src/                         # React frontend (TypeScript)
│   ├── App.tsx                  # Main application
│   ├── ChatDrawer.tsx           # Cortex Agent chat
│   └── components/              # UI components
├── scripts/sql/                 # SQL deployment scripts
│   └── 00_standalone_quickstart.sql  # Complete standalone setup
└── docs/                        # Documentation
    ├── INDEX.md                 # This file
    ├── LOCAL_DEVELOPMENT_GUIDE.md
    ├── DATA_LOADING_GUIDE.md
    ├── CASCADE_ANALYSIS.md
    ├── POSTGRES_SYNC_GUIDE.md
    ├── POSTGRES_SYNC_RELIABILITY.md
    ├── DATA_LAYER_MAPPING.md
    ├── DEPLOYMENT_PARITY_ANALYSIS.md
    └── VEGETATION_RISK_ARCHITECTURE.md
```
