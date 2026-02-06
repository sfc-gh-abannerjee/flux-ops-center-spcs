# Documentation

Flux Operations Center - Utility Grid Operations Platform

---

## Getting Started

| Guide | Description |
|-------|-------------|
| **[Quick Start](./deployment/QUICKSTART.md)** | Deploy in 15 minutes |
| **[Docker Images](./DOCKER_IMAGES.md)** | Pre-built images, multi-arch |
| **[Deployment Options](./deployment/)** | All deployment methods |

---

## Deployment Guides

| Method | Best For | Guide |
|--------|----------|-------|
| Quick Start | Demos, first-time users | [deployment/QUICKSTART.md](./deployment/QUICKSTART.md) |
| CLI Scripts | Step-by-step control | [deployment/CLI_SCRIPTS.md](./deployment/CLI_SCRIPTS.md) |
| Terraform | Enterprise IaC | [deployment/TERRAFORM.md](./deployment/TERRAFORM.md) |
| Notebooks | Workshops | [deployment/NOTEBOOKS.md](./deployment/NOTEBOOKS.md) |
| Git Integration | CI/CD | [deployment/GIT_INTEGRATION.md](./deployment/GIT_INTEGRATION.md) |

---

## Development & Operations

| Document | Description |
|----------|-------------|
| **[LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md)** | Local dev setup, PAT auth |
| **[DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md)** | Load AMI data from S3 |
| **[API_REFERENCE.md](./API_REFERENCE.md)** | REST API (62 endpoints) |
| [POSTGRES_SYNC_GUIDE.md](./POSTGRES_SYNC_GUIDE.md) | Postgres sync procedures |
| [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) | Sync architecture |

---

## Features & Analysis

| Document | Description |
|----------|-------------|
| [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) | Cascade failure analysis, ML model |
| [VEGETATION_RISK_ARCHITECTURE.md](./VEGETATION_RISK_ARCHITECTURE.md) | Vegetation risk analysis |
| [DATA_LAYER_MAPPING.md](./DATA_LAYER_MAPPING.md) | Data layer mapping |

---

## Reference

| Document | Description |
|----------|-------------|
| [DEPLOYMENT_PARITY_ANALYSIS.md](./DEPLOYMENT_PARITY_ANALYSIS.md) | Deployment method comparison |
| [DOCKER_IMAGES.md](./DOCKER_IMAGES.md) | Container images guide |

---

## Quick Links

| Task | Document |
|------|----------|
| Deploy for the first time | [deployment/QUICKSTART.md](./deployment/QUICKSTART.md) |
| Pull Docker image | [DOCKER_IMAGES.md](./DOCKER_IMAGES.md) |
| Set up local dev | [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) |
| Load PostGIS data | [DATA_LOADING_GUIDE.md](./DATA_LOADING_GUIDE.md) |
| Use cascade analysis | [CASCADE_ANALYSIS.md](./CASCADE_ANALYSIS.md) |
| Fix topology issues | [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) |

---

## Key Snowflake Objects

| Object | Type | Purpose |
|--------|------|---------|
| `FLUX_DB.APPLICATIONS` | Schema | App tables, sync procedures |
| `FLUX_DB.CASCADE_ANALYSIS` | Schema | Cascade analysis tables |
| `FLUX_DB.ML_DEMO` | Schema | ML models, grid topology |
| `FLUX_DB.PRODUCTION` | Schema | Core data tables |
| `SYNC_TOPOLOGY_TO_POSTGRES()` | Procedure | Sync to Postgres |

---

## File Structure

```
flux_ops_center_spcs/
├── README.md                    # Project overview
├── docs/
│   ├── INDEX.md                 # This file
│   ├── DOCKER_IMAGES.md         # Container guide
│   ├── deployment/              # Deployment guides
│   │   ├── QUICKSTART.md
│   │   ├── CLI_SCRIPTS.md
│   │   ├── TERRAFORM.md
│   │   ├── NOTEBOOKS.md
│   │   └── GIT_INTEGRATION.md
│   ├── LOCAL_DEVELOPMENT_GUIDE.md
│   ├── API_REFERENCE.md
│   └── ...
├── backend/                     # FastAPI server
├── src/                         # React frontend
├── scripts/sql/                 # SQL scripts
├── terraform/                   # IaC
├── notebooks/                   # Snowflake notebooks
└── git_deploy/                  # GitOps
```
