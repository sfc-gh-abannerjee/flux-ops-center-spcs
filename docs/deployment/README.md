# Deployment Options

Choose the deployment method that matches your workflow.

| Method | Best For | Time | Guide |
|--------|----------|------|-------|
| **[Quick Start](./QUICKSTART.md)** | Demos, POCs, first-time users | ~15 min | Interactive script |
| **[CLI Scripts](./CLI_SCRIPTS.md)** | Learning, auditing, step-by-step | ~20 min | Snow CLI + SQL |
| **[Terraform](./TERRAFORM.md)** | Enterprise, multi-environment | ~25 min | Infrastructure as Code |
| **[Notebooks](./NOTEBOOKS.md)** | Workshops, data science teams | ~20 min | Snowsight UI |
| **[Git Integration](./GIT_INTEGRATION.md)** | GitOps, CI/CD pipelines | ~20 min | Version-controlled |

---

## Common Prerequisites

All methods require:

- Snowflake account with ACCOUNTADMIN role
- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation) configured
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or use [pre-built images](../DOCKER_IMAGES.md))

---

## Decision Guide

```
Start here
    │
    ▼
┌─────────────────────────────────┐
│ First time using Flux Ops Center?│
└─────────────────┬───────────────┘
                  │
         Yes ◄────┴────► No
          │               │
          ▼               ▼
    ┌─────────┐    ┌─────────────────┐
    │Quick    │    │ Using Terraform │
    │Start    │    │ in production?  │
    └─────────┘    └────────┬────────┘
                            │
                   Yes ◄────┴────► No
                    │               │
                    ▼               ▼
              ┌──────────┐   ┌─────────────────┐
              │Terraform │   │ Need CI/CD?     │
              └──────────┘   └────────┬────────┘
                                      │
                             Yes ◄────┴────► No
                              │               │
                              ▼               ▼
                        ┌─────────────┐ ┌───────────┐
                        │Git          │ │CLI Scripts│
                        │Integration  │ │           │
                        └─────────────┘ └───────────┘
```

---

## Using Pre-Built Docker Images

All deployment methods support using pre-built images from GitHub Container Registry.

```bash
# Pull (auto-selects your architecture)
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# For SPCS deployment (requires amd64)
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

See [Docker Images Guide](../DOCKER_IMAGES.md) for:
- Multi-architecture support (amd64/arm64)
- Tagging and pushing to Snowflake
- Running locally on Apple Silicon
- Environment variables reference

---

## Post-Deployment Steps

After any deployment method:

### 1. Load PostGIS Data (Required for Maps)

```bash
python backend/scripts/load_postgis_data.py --service your_pg_service
```

### 2. (Optional) Enable Cascade Analysis

```bash
python backend/scripts/compute_graph_centrality.py
python backend/scripts/cascade_simulator.py --scenarios 100
```

### 3. (Optional) Set Up Grid Intelligence Agent

```bash
snow sql -f scripts/sql/07_create_cortex_search.sql -D "database=FLUX_DB" -D "warehouse=FLUX_WH"
snow sql -f scripts/sql/08_create_cortex_agent.sql -D "database=FLUX_DB" -D "warehouse=FLUX_WH"
```

---

## Troubleshooting

See individual deployment guides for method-specific troubleshooting.

**Common issues:**

| Issue | Solution |
|-------|----------|
| Map shows no data | Load PostGIS data |
| Service won't start | Check `SYSTEM$GET_SERVICE_LOGS` |
| Image not found | Push image to Snowflake registry |
| Permission denied | Use ACCOUNTADMIN role |

---

## See Also

- [Docker Images](../DOCKER_IMAGES.md) - Container images
- [Local Development](../LOCAL_DEVELOPMENT_GUIDE.md) - Development setup
- [Main README](../../README.md) - Project overview
