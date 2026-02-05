# Flux Ops Center - SQL Deployment Scripts

Deploy Flux Operations Center SPCS service using Snow CLI with variable templating.

## Prerequisites

**IMPORTANT**: Flux Ops Center requires database objects from **flux-utility-solutions**.

Before deploying Ops Center, you must first deploy:

```bash
# Clone and deploy flux-utility-solutions
git clone https://github.com/sfc-gh-abannerjee/flux-utility-solutions.git
cd flux-utility-solutions

# Deploy database and core infrastructure
snow sql -f scripts/01_database_infrastructure.sql \
    -D "database=FLUX_DB" -D "admin_role=ACCOUNTADMIN" -D "user_role=PUBLIC"

# Deploy Ops Center dependencies (views, ML tables, cascade tables)
snow sql -f scripts/30_ops_center_dependencies.sql \
    -D "database=FLUX_DB" -D "warehouse=FLUX_WH" \
    -D "admin_role=ACCOUNTADMIN" -D "user_role=PUBLIC"
```

This creates all required schemas and objects:
- `PRODUCTION`: Core tables (substations, transformers, meters, circuits)
- `APPLICATIONS`: Ops Center views (topology, KPIs, service areas)
- `ML_DEMO`: Grid graph and transformer prediction tables
- `CASCADE_ANALYSIS`: GNN cascade analysis tables

## Script Order

Run these scripts in order after deploying flux-utility-solutions:

| Script | Purpose | Prerequisites |
|--------|---------|---------------|
| `01_image_repository.sql` | Create image repository for Docker | flux-utility-solutions deployed |
| `02_compute_pool.sql` | Create SPCS compute pool | Script 01 |
| `03_create_service.sql` | Deploy the SPCS service | Scripts 01-02 + Docker image pushed |
| `04_validation.sql` | Validate deployment | All scripts |
| `05_postgres_setup.sql` | Setup Snowflake Postgres (dual-backend) | ACCOUNTADMIN role |

## Snowflake Postgres (Dual-Backend Architecture)

Flux Ops Center uses a **dual-backend architecture**:
- **Snowflake**: Analytics, ML, large-scale data processing
- **Snowflake Postgres**: Real-time operational queries, PostGIS geospatial

### Postgres Setup (Required for full functionality)

```bash
# Deploy Postgres with Snow CLI
snow sql -c $CONN -f scripts/sql/05_postgres_setup.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -D "postgres_instance=FLUX_OPS_POSTGRES" \
    -D "postgres_compute=HIGHMEM_XL" \
    -D "postgres_storage_gb=100" \
    -D "postgres_version=17"
```

**IMPORTANT**: Save the credentials displayed after `CREATE POSTGRES INSTANCE`! They cannot be retrieved later.

### Postgres Compute Families

| Family | Cores | Memory | Use Case |
|--------|-------|--------|----------|
| `HIGHMEM_XL` | 4 | 32GB | **Recommended** - PostGIS/geospatial |
| `HIGHMEM_L` | 2 | 16GB | Medium geospatial workloads |
| `STANDARD_M` | 1 | 4GB | Minimum general purpose |
| `STANDARD_L` | 2 | 8GB | Light operational queries |

## Quick Start

### Option 1: Local/Demo Environment

```bash
# Set connection
export CONN="your_connection_name"

# 1. Create image repository
snow sql -c $CONN -f scripts/sql/01_image_repository.sql \
    -D "database=FLUX_DB" \
    -D "schema=PUBLIC" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES"

# 2. Push Docker image (see instructions below)

# 3. Create compute pool
snow sql -c $CONN -f scripts/sql/02_compute_pool.sql \
    -D "database=FLUX_DB" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "instance_family=CPU_X64_S" \
    -D "min_nodes=1" \
    -D "max_nodes=2"

# 4. Deploy service
snow sql -c $CONN -f scripts/sql/03_create_service.sql \
    -D "database=FLUX_DB" \
    -D "schema=PUBLIC" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "image_tag=latest" \
    -D "warehouse=FLUX_WH"

# 5. Validate
snow sql -c $CONN -f scripts/sql/04_validation.sql \
    -D "database=FLUX_DB" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES"
```

### Option 2: Production Environment

```bash
export CONN="prod_connection"
export DB="FLUX_PROD"

snow sql -c $CONN -f scripts/sql/01_image_repository.sql \
    -D "database=$DB" -D "schema=PUBLIC" -D "image_repo=FLUX_OPS_CENTER_IMAGES"

# ... (push Docker image)

snow sql -c $CONN -f scripts/sql/02_compute_pool.sql \
    -D "database=$DB" -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "instance_family=CPU_X64_S" -D "min_nodes=1" -D "max_nodes=3"

snow sql -c $CONN -f scripts/sql/03_create_service.sql \
    -D "database=$DB" -D "schema=PUBLIC" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "image_tag=latest" -D "warehouse=FLUX_PROD_WH"
```

## Push Docker Image

After creating the image repository (step 1), push the Docker image:

```bash
# 1. Get the repository URL from Snowflake
#    Run: SHOW IMAGE REPOSITORIES LIKE 'FLUX_OPS_CENTER_IMAGES';
#    Copy the repository_url column

# 2. Login to Snowflake registry
docker login <org>-<account>.registry.snowflakecomputing.com

# 3. Build the image (from flux_ops_center_spcs root)
docker build -t flux_ops_center:latest -f Dockerfile.spcs .

# 4. Tag with repository URL
docker tag flux_ops_center:latest <repository_url>/flux_ops_center:latest

# 5. Push to Snowflake
docker push <repository_url>/flux_ops_center:latest
```

## Variable Reference

### SPCS Variables

| Variable | Description | Example Values |
|----------|-------------|----------------|
| `database` | Target database (from flux-utility-solutions) | `FLUX_DB`, `FLUX_PROD` |
| `schema` | Schema for SPCS objects | `PUBLIC` |
| `warehouse` | Query warehouse | `FLUX_WH`, `FLUX_PROD_WH` |
| `image_repo` | Image repository name | `FLUX_OPS_CENTER_IMAGES` |
| `compute_pool` | Compute pool name | `FLUX_OPS_CENTER_POOL` |
| `service_name` | SPCS service name | `FLUX_OPS_CENTER_SERVICE` |
| `instance_family` | Compute instance type | `CPU_X64_S`, `CPU_X64_M` |
| `min_nodes` | Minimum compute nodes | `1` |
| `max_nodes` | Maximum compute nodes | `2`, `3` |
| `image_tag` | Docker image tag | `latest`, `v1.0.0` |

### Postgres Variables (05_postgres_setup.sql)

| Variable | Description | Example Values |
|----------|-------------|----------------|
| `postgres_instance` | Postgres instance name | `FLUX_OPS_POSTGRES` |
| `postgres_compute` | Compute family | `HIGHMEM_XL` (recommended) |
| `postgres_storage_gb` | Storage size (10-65535) | `100` |
| `postgres_version` | PostgreSQL version | `17` |

## Environment Configurations

See `config.yaml` for pre-configured environment settings (dev, staging, prod, local).

## Troubleshooting

### "Database does not exist"
Deploy flux-utility-solutions first to create the database and required objects.

### "Object does not exist" errors in service
Ensure `scripts/30_ops_center_dependencies.sql` from flux-utility-solutions was run.

### Service not starting
```sql
-- Check service status
SELECT SYSTEM$GET_SERVICE_STATUS('FLUX_OPS_CENTER_SERVICE');

-- View service logs
CALL SYSTEM$GET_SERVICE_LOGS('FLUX_OPS_CENTER_SERVICE', '0', 'flux-ops-center', 100);
```

### Image not found
Verify Docker image was pushed correctly:
```sql
-- List images in repository
SHOW IMAGES IN IMAGE REPOSITORY FLUX_OPS_CENTER_IMAGES;
```

## Related Documentation

- [Flux Utility Solutions](https://github.com/sfc-gh-abannerjee/flux-utility-solutions) - Core platform (deploy first)
- [Flux Data Forge](https://github.com/sfc-gh-abannerjee/flux-data-forge) - Synthetic data generation
- [SPCS Documentation](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview)
