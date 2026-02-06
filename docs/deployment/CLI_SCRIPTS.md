# CLI Scripts Deployment

Deploy Flux Operations Center using Snow CLI with Jinja2-templated SQL scripts.

**Best for:** Learning the deployment process, step-by-step control, auditing.

---

## Prerequisites

1. **Snowflake CLI** installed and configured
2. **Database exists** - Either:
   - Run `00_standalone_quickstart.sql` for standalone, OR
   - Deploy [flux-utility-solutions](https://github.com/sfc-gh-abannerjee/flux-utility-solutions) first
3. **Docker** for building/pushing images (or use [pre-built images](../DOCKER_IMAGES.md))

---

## Script Execution Order

| # | Script | Purpose |
|---|--------|---------|
| 0 | `00_standalone_quickstart.sql` | Create database + sample data (standalone only) |
| 1 | `01_image_repository.sql` | Create image repository |
| 2 | `02_compute_pool.sql` | Create SPCS compute pool |
| 3 | `03_create_service.sql` | Deploy the SPCS service |
| 4 | `04_validation.sql` | Validate deployment |
| 5 | `05_postgres_setup.sql` | Set up Snowflake Postgres |
| 5a | `05a_external_access.sql` | External access for Postgres |
| 6 | `06_postgres_sync.sql` | Dynamic data sync procedures |
| 7 | `07_create_cortex_search.sql` | Cortex Search services |
| 8 | `08_create_cortex_agent.sql` | Grid Intelligence Agent |

---

## Understanding Jinja2 Variables

Scripts use `<% variable %>` placeholders that Snow CLI replaces at runtime:

```sql
-- In script:
USE DATABASE <% database %>;
CREATE SCHEMA <% database %>.<% schema %>;

-- Run with:
snow sql -f script.sql -D "database=FLUX_DB" -D "schema=PUBLIC"

-- Executes as:
USE DATABASE FLUX_DB;
CREATE SCHEMA FLUX_DB.PUBLIC;
```

---

## Full Deployment Walkthrough

### Set Your Connection

```bash
export CONN="my_connection"
```

### Step 1: Create Image Repository

```bash
snow sql -c $CONN -f scripts/sql/01_image_repository.sql \
    -D "database=FLUX_DB" \
    -D "schema=PUBLIC" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES"
```

### Step 2: Push Docker Image

**Option A: Use Pre-Built Image (Recommended)**

```bash
# Pull from GHCR (use --platform linux/amd64 on Apple Silicon)
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# Get your Snowflake registry URL
snow sql -c $CONN -q "SHOW IMAGE REPOSITORIES LIKE 'FLUX_OPS_CENTER_IMAGES'"
# Copy the repository_url

# Login, tag, and push
docker login <org>-<account>.registry.snowflakecomputing.com
docker tag ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main \
    <repository_url>/flux-ops-center:latest
docker push <repository_url>/flux-ops-center:latest
```

**Option B: Build Locally**

```bash
npm ci && npm run build
docker build -t flux-ops-center:latest .
docker tag flux-ops-center:latest <repository_url>/flux-ops-center:latest
docker push <repository_url>/flux-ops-center:latest
```

### Step 3: Create Compute Pool

```bash
snow sql -c $CONN -f scripts/sql/02_compute_pool.sql \
    -D "database=FLUX_DB" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "instance_family=CPU_X64_S" \
    -D "min_nodes=1" \
    -D "max_nodes=2"
```

### Step 4: Set Up Snowflake Postgres

```bash
snow sql -c $CONN -f scripts/sql/05_postgres_setup.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -D "postgres_instance=FLUX_OPS_POSTGRES" \
    -D "postgres_compute=HIGHMEM_XL" \
    -D "postgres_storage_gb=100" \
    -D "postgres_version=17"
```

**⚠️ IMPORTANT:** Save the credentials displayed! They cannot be retrieved later.

Get the Postgres host:
```bash
snow sql -c $CONN -q "SHOW POSTGRES INSTANCES LIKE 'FLUX_OPS_POSTGRES'"
# Copy the 'host' value
```

### Step 5: Create External Access Integration

```bash
snow sql -c $CONN -f scripts/sql/05a_external_access.sql \
    -D "database=FLUX_DB" \
    -D "schema=APPLICATIONS" \
    -D "postgres_host=<host_from_step_4>" \
    -D "postgres_user=application" \
    -D "postgres_password=<password_from_step_4>" \
    -D "integration_name=FLUX_POSTGRES_INTEGRATION"
```

### Step 6: Deploy SPCS Service

```bash
snow sql -c $CONN -f scripts/sql/03_create_service.sql \
    -D "database=FLUX_DB" \
    -D "schema=PUBLIC" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "image_tag=latest" \
    -D "warehouse=FLUX_WH" \
    -D "postgres_host=<host_from_step_4>"
```

### Step 7: Load PostGIS Data

```bash
python backend/scripts/load_postgis_data.py --service flux_ops_postgres
```

### Step 8: Validate Deployment

```bash
snow sql -c $CONN -f scripts/sql/04_validation.sql \
    -D "database=FLUX_DB" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES"
```

### Step 9: Get Service URL

```bash
snow sql -c $CONN -q "SHOW ENDPOINTS IN SERVICE FLUX_DB.PUBLIC.FLUX_OPS_CENTER_SERVICE"
```

---

## Variable Reference

### SPCS Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `database` | Target database | `FLUX_DB` |
| `schema` | Schema for SPCS objects | `PUBLIC` |
| `warehouse` | Query warehouse | `FLUX_WH` |
| `image_repo` | Image repository name | `FLUX_OPS_CENTER_IMAGES` |
| `compute_pool` | Compute pool name | `FLUX_OPS_CENTER_POOL` |
| `service_name` | SPCS service name | `FLUX_OPS_CENTER_SERVICE` |
| `instance_family` | Compute instance type | `CPU_X64_S`, `CPU_X64_M` |
| `min_nodes` | Minimum compute nodes | `1` |
| `max_nodes` | Maximum compute nodes | `2` |
| `image_tag` | Docker image tag | `latest` |

### Postgres Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `postgres_instance` | Instance name | `FLUX_OPS_POSTGRES` |
| `postgres_compute` | Compute family | `HIGHMEM_XL` |
| `postgres_storage_gb` | Storage size | `100` |
| `postgres_version` | PostgreSQL version | `17` |
| `postgres_host` | Postgres host URL | `abc123.postgres.snowflake.app` |

### Postgres Compute Families

| Family | Cores | Memory | Use Case |
|--------|-------|--------|----------|
| `HIGHMEM_XL` | 4 | 32GB | **Recommended** for PostGIS |
| `HIGHMEM_L` | 2 | 16GB | Medium geospatial |
| `STANDARD_L` | 2 | 8GB | Light workloads |

---

## Optional: Set Up AI Features

### Cortex Search Services

```bash
snow sql -c $CONN -f scripts/sql/07_create_cortex_search.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH"
```

### Grid Intelligence Agent

```bash
snow sql -c $CONN -f scripts/sql/08_create_cortex_agent.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -D "agent_database=SNOWFLAKE_INTELLIGENCE" \
    -D "agent_schema=AGENTS" \
    -D "agent_name=GRID_INTELLIGENCE_AGENT"
```

---

## Troubleshooting

### "Database does not exist"

Run `00_standalone_quickstart.sql` first, or deploy flux-utility-solutions.

### "Object does not exist" in service logs

Ensure all prerequisite scripts ran successfully. Check:
```sql
SHOW SCHEMAS IN DATABASE FLUX_DB;
```

### Service not starting

```sql
SELECT SYSTEM$GET_SERVICE_STATUS('FLUX_OPS_CENTER_SERVICE');
CALL SYSTEM$GET_SERVICE_LOGS('FLUX_OPS_CENTER_SERVICE', '0', 'flux-ops-center', 100);
```

### Image not found

```sql
SHOW IMAGES IN IMAGE REPOSITORY FLUX_OPS_CENTER_IMAGES;
```

---

## See Also

- [Quick Start](./QUICKSTART.md) - Automated deployment
- [Docker Images](../DOCKER_IMAGES.md) - Pre-built images
- [Terraform](./TERRAFORM.md) - Infrastructure as Code
