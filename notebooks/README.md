# Flux Ops Center - Notebooks

Snowflake Notebooks for deployment, data sync, and ML workflows.

## Deployment Path

This directory provides the **Notebooks deployment path** - one of five ways to deploy Flux Ops Center, matching the pattern in [flux-utility-solutions](https://github.com/sfc-gh-abannerjee/flux-utility-solutions).

## Available Notebooks

### Setup / Deployment

| Notebook | Description |
|----------|-------------|
| `setup/01_deploy_spcs_infrastructure.ipynb` | Deploy SPCS infrastructure (image repo, compute pool, service) |

### Data Operations

| Notebook | Description |
|----------|-------------|
| `postgres_sync_manual.ipynb` | Manual Snowflake → Postgres sync for PostGIS spatial data |

### ML Workflows (in `backend/ml/`)

| Notebook | Description |
|----------|-------------|
| `transformer_failure_prediction.ipynb` | Train XGBoost model for transformer risk prediction |
| `deploy_spcs_inference.ipynb` | Deploy ML model to SPCS inference service |

## Usage

### Import to Snowsight

1. Open Snowsight → Projects → Notebooks
2. Click "+" → "Import from File"
3. Select the `.ipynb` file
4. Choose database/schema/warehouse
5. **Edit the configuration cell** at the top to match your environment

### Run from Snowsight

1. After import, run cells individually or use "Run All"
2. Configuration variables are set in the first code cell
3. Modify values before running to customize deployment

## Variable Syntax

Notebooks use **Python variables** for configuration:

```python
# Configuration - edit these values
DATABASE = "FLUX_DB"
WAREHOUSE = "FLUX_WH"
SERVICE_NAME = "FLUX_OPS_CENTER_SERVICE"
```

**This is different from:**
- Snow CLI Jinja2 (`<% variable %>`) used in `scripts/sql/`
- Session variables (`$variable`) used in SQL-only notebooks
- Terraform variables (`var.database`)

## Prerequisites

Before running deployment notebooks:

1. **flux-utility-solutions deployed** - Creates database, schemas, and tables
2. **Docker image pushed** - For SPCS service deployment
3. **Appropriate role** - ACCOUNTADMIN or equivalent for infrastructure creation

## Notebook Descriptions

### setup/01_deploy_spcs_infrastructure.ipynb

Deploys the complete SPCS infrastructure:

- **Phase 1**: Verify prerequisites (schemas from flux-utility-solutions)
- **Phase 2**: Create image repository
- **Phase 3**: Create compute pool
- **Phase 4**: Set up Snowflake Postgres (optional)
- **Phase 5**: Create SPCS service with Postgres configuration
- **Phase 6**: Verify deployment and get endpoint URL

**Next Steps After Deployment:**
1. Load PostGIS spatial data: `python backend/scripts/load_postgis_data.py`
2. Populate cascade analysis tables (optional)

### postgres_sync_manual.ipynb

Manual data synchronization from Snowflake to Postgres:

- Syncs 8 spatial layers (meters, substations, transformers, etc.)
- Uses TRUNCATE + INSERT pattern for idempotent syncs
- Includes verification queries

**When to Use:**
- Initial data load after Postgres instance creation
- Manual refresh of PostGIS cache
- Debugging sync issues

## See Also

- [Scripts](../scripts/sql/README.md) - Snow CLI deployment with Jinja2 templating
- [CLI Quick Start](../scripts/quickstart.sh) - Automated deployment script
- [Terraform](../terraform/README.md) - Infrastructure as Code
- [Git Deploy](../git_deploy/README.md) - GitOps deployment
