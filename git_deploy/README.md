# Flux Operations Center - Git Integration Deployment

This directory contains SQL scripts for deploying Flux Operations Center using Snowflake's native Git integration.

## Overview

Snowflake Git integration allows you to:
- Execute SQL files directly from a GitHub repository
- Deploy infrastructure without downloading files locally
- Integrate with CI/CD pipelines via GitHub Actions
- Maintain version-controlled deployments

## Prerequisites

Before deploying via Git integration, you must have:

1. **flux-utility-solutions deployed** - Creates the database, schemas, and data objects
2. **Snowflake Postgres instance** - Required for map visualization (PostGIS spatial data)
3. **Docker image pushed** - Container image in Snowflake image repository

## Quick Start

### 1. One-Time Setup

```sql
-- Run in Snowflake Worksheets with ACCOUNTADMIN role
!source setup_git_integration.sql
```

### 2. Set Up Snowflake Postgres (Required for Maps)

```sql
-- Create Postgres instance
CREATE POSTGRES DATABASE FLUX_OPS_POSTGRES
    POSTGRES_ADMIN_PASSWORD = 'YourSecurePassword123!'
    AUTO_SUSPEND_MINS = 30
    COMPUTE_SIZE = 'HIGHMEM_XL'
    STORAGE_SIZE_GB = 100;

-- Get the host for later steps
SHOW POSTGRES INSTANCES LIKE 'FLUX_OPS_POSTGRES';
-- Copy the 'host' value (e.g., abc123.us-west-2.aws.postgres.snowflake.app)
```

### 3. Push Docker Image

**Option A: Use Pre-Built Image (Recommended)**

Skip the build step by pulling the pre-built image from GitHub Container Registry:

```bash
# Pull pre-built image from GHCR
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:latest

# Get your Snowflake registry URL
# Run: SHOW IMAGE REPOSITORIES IN SCHEMA FLUX_DB.PUBLIC;
docker login <org>-<account>.registry.snowflakecomputing.com

# Tag for your Snowflake repository
docker tag ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:latest \
    <org>-<account>.registry.snowflakecomputing.com/flux_db/public/flux_ops_center_images/flux_ops_center:latest

# Push to Snowflake
docker push <org>-<account>.registry.snowflakecomputing.com/flux_db/public/flux_ops_center_images/flux_ops_center:latest
```

**Option B: Build Locally**

```bash
# Get the registry URL from SHOW IMAGE REPOSITORIES
docker login <org>-<account>.registry.snowflakecomputing.com

# Build and push
docker build -t flux_ops_center:latest -f Dockerfile.spcs .
docker push <repository_url>/flux_ops_center:latest
```

### 4. Deploy Infrastructure

```bash
# Deploy with all required parameters including postgres_host
snow sql -f git_deploy/deploy_from_git.sql \
    -D "database=FLUX_DB" \
    -D "schema=PUBLIC" \
    -D "warehouse=FLUX_WH" \
    -D "git_repo=FLUX_OPS_CENTER_REPO" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "image_tag=latest" \
    -D "postgres_host=<host_from_step_2>" \
    -c your_connection_name
```

### 5. Load PostGIS Spatial Data (REQUIRED)

**Without this step, the map will not display any data.**

```bash
# Load all 10 spatial layers (~390MB) from GitHub Releases
python backend/scripts/load_postgis_data.py --service FLUX_OPS_POSTGRES

# Or specify custom credentials
python backend/scripts/load_postgis_data.py \
    --host <postgres_host> \
    --user application \
    --password <your_password>
```

See the [PostGIS data release](https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs/releases/tag/v1.0.0-data) for data details.

## Using Snowflake CLI

```bash
# Setup
snow git setup FLUX_OPS_CENTER_REPO

# Fetch latest
snow git fetch FLUX_OPS_CENTER_REPO

# List files
snow git list-files @FLUX_OPS_CENTER_REPO/branches/main/

# Execute deployment
snow git execute "@FLUX_OPS_CENTER_REPO/branches/main/git_deploy/deploy_from_git.sql"
```

## GitHub Actions Integration

Add this workflow to `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Snowflake
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: Snowflake-Labs/snowflake-cli-action@v1
        with:
          cli-version: latest
          
      - name: Fetch & Deploy
        run: |
          snow git fetch FLUX_OPS_CENTER_REPO
          snow git execute "@FLUX_OPS_CENTER_REPO/branches/main/git_deploy/deploy_from_git.sql"
        env:
          SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
          SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
          SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
```

## Files in This Directory

| File | Purpose |
|------|---------|
| `setup_git_integration.sql` | One-time setup of Git integration |
| `deploy_from_git.sql` | Execute deployment scripts from Git |
| `README.md` | This documentation |

## Deployment Checklist

- [ ] flux-utility-solutions deployed (database and schemas exist)
- [ ] Snowflake Postgres instance created
- [ ] Docker image built and pushed to image repository
- [ ] `deploy_from_git.sql` executed with all variables including `postgres_host`
- [ ] PostGIS spatial data loaded via `load_postgis_data.py`
- [ ] Service endpoint accessible and map displays correctly

## Related Documentation

- [Snowflake Git Integration](https://docs.snowflake.com/en/developer-guide/git/git-overview)
- [Flux Utility Platform](https://github.com/sfc-gh-abannerjee/flux-utility-solutions)
- [Flux Data Forge](https://github.com/sfc-gh-abannerjee/flux-data-forge)
- [PostGIS Data Setup](../data/postgis_exports/README.md)
