# Flux Operations Center - Documentation

**Utility Grid Operations Platform**

---

## Documentation

| Document | Description |
|----------|-------------|
| **[LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md)** | **START HERE** - Local dev setup, PAT auth, troubleshooting |
| **[DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md)** | **Load AMI data** - S3 stage access, bulk loading |
| [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) | Cascade failure analysis tools, API, ML model |
| [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) | Snowflake→Postgres sync architecture |
| [VEGETATION_RISK_ARCHITECTURE.md](./VEGETATION_RISK_ARCHITECTURE.md) | Vegetation risk analysis |

---

## Quick Links

| Task | Document |
|------|----------|
| Set up local dev | [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) |
| Load AMI data | [DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md) |
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
├── backend/
│   ├── server_fastapi.py        # FastAPI server
│   └── scripts/                 # ML scripts
├── src/                         # React frontend
├── scripts/
│   └── seed_data/               # Data loading scripts
├── docs/                        # Documentation
│   ├── INDEX.md                 # This file
│   ├── LOCAL_DEVELOPMENT_GUIDE.md
│   ├── DATA_LOADING_GUIDE.md
│   ├── CASCADE_ANALYSIS.md
│   ├── POSTGRES_SYNC_RELIABILITY.md
│   └── VEGETATION_RISK_ARCHITECTURE.md
└── archive/                     # Historical docs
```
