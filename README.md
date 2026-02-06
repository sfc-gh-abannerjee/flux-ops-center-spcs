# Flux Operations Center

[![Snowflake](https://img.shields.io/badge/Snowflake-29B5E8?logo=snowflake&logoColor=white)](https://www.snowflake.com)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue?logo=docker)](https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs/pkgs/container/flux-ops-center-spcs)

**Real-time utility grid visualization and GNN-based cascade failure prediction on Snowflake.**

<p align="center">
  <img width="49%" alt="Grid Map View" src="https://github.com/user-attachments/assets/0125a740-b678-4271-bbf2-aac7694b5b7e" />
  <img width="49%" alt="Cascade Analysis" src="https://github.com/user-attachments/assets/328941a4-c25b-4793-a583-5202ff7ca602" />
</p>

---

## Quick Start

```bash
git clone https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs.git
cd flux-ops-center-spcs
snow sql -c your_connection -f scripts/sql/00_standalone_quickstart.sql
./scripts/quickstart.sh
```

Then load map data:
```bash
python backend/scripts/load_postgis_data.py --service your_pg_service
```

**[Full Quick Start Guide →](docs/deployment/QUICKSTART.md)**

---

## Documentation

| Guide | Description |
|-------|-------------|
| **[Deployment Options](docs/deployment/)** | Choose your deployment method |
| **[Docker Images](docs/DOCKER_IMAGES.md)** | Pre-built images, multi-arch support |
| **[Local Development](docs/LOCAL_DEVELOPMENT_GUIDE.md)** | Development setup |
| **[API Reference](docs/API_REFERENCE.md)** | REST API documentation |
| **[Cascade Analysis](docs/CASCADE_ANALYSIS.md)** | GNN risk prediction |

---

## Deployment Options

| Method | Best For | Guide |
|--------|----------|-------|
| **Quick Start** | Demos, first-time users | [docs/deployment/QUICKSTART.md](docs/deployment/QUICKSTART.md) |
| **CLI Scripts** | Step-by-step control | [docs/deployment/CLI_SCRIPTS.md](docs/deployment/CLI_SCRIPTS.md) |
| **Terraform** | Enterprise IaC | [docs/deployment/TERRAFORM.md](docs/deployment/TERRAFORM.md) |
| **Notebooks** | Workshops, data science | [docs/deployment/NOTEBOOKS.md](docs/deployment/NOTEBOOKS.md) |
| **Git Integration** | CI/CD pipelines | [docs/deployment/GIT_INTEGRATION.md](docs/deployment/GIT_INTEGRATION.md) |

---

## Docker Images

Pre-built multi-architecture images available on GitHub Container Registry:

```bash
# Auto-selects your architecture (amd64 or arm64)
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# For Snowflake SPCS (requires amd64)
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

| Architecture | Use Case |
|--------------|----------|
| `linux/amd64` | Snowflake SPCS, Intel/AMD servers |
| `linux/arm64` | Apple Silicon (M1/M2/M3/M4), AWS Graviton |

**[Full Docker Guide →](docs/DOCKER_IMAGES.md)**

---

## Flux Utility Platform

Part of a suite of Snowflake solutions:

| Repository | Purpose |
|------------|---------|
| [**flux-utility-solutions**](https://github.com/sfc-gh-abannerjee/flux-utility-solutions) | Core platform, Cortex AI, semantic models |
| [flux-data-forge](https://github.com/sfc-gh-abannerjee/flux-data-forge) | Synthetic AMI data generation |
| **flux-ops-center** (this repo) | Grid visualization, cascade analysis |

**Standalone deployment** creates everything locally. **Integrated deployment** shares data across all apps.

---

## Features

### Interactive Map
- 66K+ grid assets with DeckGL
- Real-time status visualization
- Geospatial layers (vegetation risk, flood zones)

### Cascade Failure Analysis
- Simulate failures from any node
- GNN-based risk prediction
- Wave-by-wave propagation

### Grid Intelligence Agent
- Natural language queries via Cortex
- Context-aware responses
- Integrated with live data

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SPCS Service                         │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │   React     │    │   FastAPI    │    │  Nginx    │  │
│  │  Frontend   │◄──►│   Backend    │◄──►│  Proxy    │  │
│  └─────────────┘    └──────┬───────┘    └───────────┘  │
└────────────────────────────┼────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌───────────┐  ┌───────────┐
        │Snowflake │  │ Snowflake │  │  Cortex   │
        │ Tables   │  │ Postgres  │  │  Agent    │
        │          │  │ (PostGIS) │  │           │
        └──────────┘  └───────────┘  └───────────┘
```

---

## Prerequisites

- Snowflake account with ACCOUNTADMIN role
- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or use pre-built images)

---

## Project Structure

```
flux-ops-center-spcs/
├── docs/                    # Documentation
│   ├── deployment/          # Deployment guides
│   ├── DOCKER_IMAGES.md     # Container image guide
│   └── ...
├── scripts/
│   ├── sql/                 # SQL deployment scripts
│   └── quickstart.sh        # Interactive deployment
├── backend/                 # FastAPI server
├── src/                     # React frontend
├── terraform/               # IaC configuration
├── notebooks/               # Snowflake notebooks
└── git_deploy/              # GitOps deployment
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Apache 2.0 - see [LICENSE](LICENSE)
