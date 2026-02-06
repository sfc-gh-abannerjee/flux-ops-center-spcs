# Notebooks Deployment

Deploy Flux Operations Center using Snowflake Notebooks in Snowsight.

**Best for:** Workshops, data science teams, interactive learning.

---

## Available Notebooks

### Setup & Deployment

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
| `transformer_failure_prediction.ipynb` | Train XGBoost transformer risk model |
| `deploy_spcs_inference.ipynb` | Deploy ML model to SPCS |

---

## Quick Start

### 1. Import Notebook to Snowsight

1. Open **Snowsight** → **Projects** → **Notebooks**
2. Click **+** → **Import from File**
3. Select the `.ipynb` file
4. Choose database, schema, and warehouse
5. Click **Create**

### 2. Configure Variables

Edit the first code cell with your values:

```python
# Configuration - edit these values
DATABASE = "FLUX_DB"
WAREHOUSE = "FLUX_WH"
SERVICE_NAME = "FLUX_OPS_CENTER_SERVICE"
COMPUTE_POOL = "FLUX_OPS_CENTER_POOL"
IMAGE_REPO = "FLUX_OPS_CENTER_IMAGES"
```

### 3. Run the Notebook

Click **Run All** or execute cells individually.

---

## Deployment Notebook Details

### `01_deploy_spcs_infrastructure.ipynb`

Complete SPCS deployment in 6 phases:

| Phase | What It Does |
|-------|--------------|
| 1 | Verify prerequisites (schemas from flux-utility-solutions) |
| 2 | Create image repository |
| 3 | Create compute pool |
| 4 | Set up Snowflake Postgres (optional) |
| 5 | Create SPCS service |
| 6 | Verify deployment, get endpoint URL |

**Prerequisites:**
- flux-utility-solutions deployed (creates FLUX_DB)
- Docker image pushed to Snowflake registry

**After running:**
1. Load PostGIS data: `python backend/scripts/load_postgis_data.py`
   - This also creates required derived views (buildings_spatial, grid_assets, vegetation_risk_computed)
2. (Optional) Run cascade analysis scripts

---

## Using Pre-Built Docker Images

The deployment notebook includes a cell to pull and push pre-built images:

```python
# In notebook cell
import subprocess

# Pull pre-built image (run locally, not in Snowsight)
subprocess.run([
    "docker", "pull", "--platform", "linux/amd64",
    "ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main"
])
```

Or use the [Docker Images Guide](../DOCKER_IMAGES.md) to push images manually before running the notebook.

---

## Variable Syntax Comparison

Different deployment methods use different variable syntax:

| Method | Syntax | Example |
|--------|--------|---------|
| **Notebooks** | Python variables | `DATABASE = "FLUX_DB"` |
| **Snow CLI** | Jinja2 templates | `-D "database=FLUX_DB"` |
| **Terraform** | HCL variables | `var.database` |
| **SQL** | Session variables | `$database` |

---

## Data Sync Notebook

### `postgres_sync_manual.ipynb`

Manually sync data from Snowflake to Postgres for PostGIS:

**When to use:**
- Initial data load after Postgres creation
- Manual refresh of PostGIS cache
- Debugging sync issues

**Syncs these layers:**
- Meters, substations, transformers
- Circuits, power lines
- Topology connections
- Building footprints, vegetation risk

---

## Troubleshooting

### "Object does not exist"

Run flux-utility-solutions first to create the database and schemas.

### "Permission denied"

Ensure you're using ACCOUNTADMIN role or equivalent.

### Notebook won't run

- Check warehouse is not suspended
- Verify all variables are set correctly
- Check for syntax errors in configuration cell

### Service not starting after notebook

Check service logs:
```sql
CALL SYSTEM$GET_SERVICE_LOGS('FLUX_OPS_CENTER_SERVICE', '0', 'flux-ops-center', 100);
```

---

## See Also

- [Quick Start](./QUICKSTART.md) - Automated CLI deployment
- [Docker Images](../DOCKER_IMAGES.md) - Pre-built images
- [CLI Scripts](./CLI_SCRIPTS.md) - SQL script deployment
- [Local Development](../LOCAL_DEVELOPMENT_GUIDE.md) - Development setup
