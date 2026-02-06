# Notebooks Deployment

Deploy Flux Operations Center using Snowflake Notebooks.

**[Full Documentation →](../docs/deployment/NOTEBOOKS.md)**

---

## Quick Start

1. Open **Snowsight** → **Projects** → **Notebooks**
2. Click **+** → **Import from File**
3. Select `setup/01_deploy_spcs_infrastructure.ipynb`
4. Edit configuration variables in first cell
5. Click **Run All**

## Available Notebooks

### Deployment
| Notebook | Description |
|----------|-------------|
| `setup/01_deploy_spcs_infrastructure.ipynb` | Deploy complete SPCS infrastructure |

### Data Operations
| Notebook | Description |
|----------|-------------|
| `postgres_sync_manual.ipynb` | Manual Snowflake → Postgres sync |

### ML Workflows (in `backend/ml/`)
| Notebook | Description |
|----------|-------------|
| `transformer_failure_prediction.ipynb` | Train XGBoost model |
| `deploy_spcs_inference.ipynb` | Deploy ML to SPCS |

## After Deployment

1. **Load PostGIS data** - `python backend/scripts/load_postgis_data.py`
2. (Optional) Run cascade analysis scripts

## See Also

- [Full Notebooks Guide](../docs/deployment/NOTEBOOKS.md)
- [Docker Images](../docs/DOCKER_IMAGES.md)
- [All Deployment Options](../docs/deployment/)
