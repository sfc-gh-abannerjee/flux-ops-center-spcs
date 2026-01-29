# Flux Operations Center - Documentation

**Utility Grid Operations Platform**

---

## Architecture

| Document | Description |
|----------|-------------|
| **[ARCHITECTURE_INTERNAL.md](../ARCHITECTURE_INTERNAL.md)** | **Full 4-layer architecture** - Internal version with resource IDs |
| **[ARCHITECTURE_PUBLIC.md](../ARCHITECTURE_PUBLIC.md)** | **Public-facing version** - De-identified, preview features marked |

---

## Documentation

| Document | Description |
|----------|-------------|
| **[LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md)** | **START HERE** - Local dev setup, PAT auth, troubleshooting |
| **[DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md)** | **Load AMI data (7.1B rows)** - S3 stage access, bulk loading |
| [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) | Cascade failure analysis tools, API, ML model |
| [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) | Snowflake→Postgres sync architecture |
| [VEGETATION_RISK_ARCHITECTURE.md](./VEGETATION_RISK_ARCHITECTURE.md) | Vegetation risk analysis |

---

## Quick Links

| Task | Document |
|------|----------|
| Set up local dev | [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) |
| Load AMI data (7.1B rows) | [DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md) |
| Fix topology not loading | [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) |
| Use cascade analysis | [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) |
| Deploy to SPCS | [../CENTERPOINT_ARCHITECTURE.md](../CENTERPOINT_ARCHITECTURE.md) |

---

## Key Snowflake Objects

| Object | Type | Purpose |
|--------|------|---------|
| `SI_DEMOS.APPLICATIONS` | Schema | Main app tables, sync procedures |
| `SI_DEMOS.CASCADE_ANALYSIS` | Schema | Cascade analysis tables |
| `SI_DEMOS.ML_DEMO` | Schema | ML models, grid topology |
| `SYNC_TOPOLOGY_TO_POSTGRES()` | Procedure | Sync topology to Postgres |
| `CASCADE_ANALYSIS_AGENT` | Agent | Cortex Agent for cascade queries |

---

## File Structure

```
flux_ops_center_spcs/
├── README.md                    # Project overview
├── CENTERPOINT_ARCHITECTURE.md  # Full architecture
├── backend/
│   ├── server_fastapi.py        # FastAPI server
│   └── ml/ML_DEMO_REFERENCE.md  # ML model reference
├── src/                         # React frontend
├── scripts/
│   └── seed_data/               # Data loading scripts
│       └── load_ami_from_s3.sql # Load 7.1B AMI rows
├── docs/                        # Documentation
│   ├── INDEX.md                 # This file
│   ├── LOCAL_DEVELOPMENT_GUIDE.md
│   ├── DATA_LOADING_GUIDE.md    # AMI data loading
│   ├── CASCADE_ANALYSIS.md
│   ├── POSTGRES_SYNC_RELIABILITY.md
│   └── VEGETATION_RISK_ARCHITECTURE.md
└── archive/                     # Historical docs
    ├── evaluations/             # Evaluation reports
    └── backend_docs/            # Old backend docs
```

---

*Last Updated: January 28, 2026*
