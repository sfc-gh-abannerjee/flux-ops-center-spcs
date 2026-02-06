# Git Integration Deployment

Deploy Flux Operations Center using Snowflake's native Git integration.

**Best for:** GitOps workflows, CI/CD pipelines, version-controlled deployments.

---

## Overview

Snowflake Git integration allows you to:
- Execute SQL files directly from GitHub
- Deploy without downloading files locally
- Integrate with CI/CD via GitHub Actions
- Maintain version-controlled deployments

---

## Prerequisites

1. **flux-utility-solutions deployed** - Creates database and schemas
2. **Snowflake Postgres instance** - For map visualization
3. **Docker image pushed** - To Snowflake image repository

---

## Quick Start

### 1. One-Time Setup

```sql
-- Run in Snowflake Worksheets with ACCOUNTADMIN role
!source git_deploy/setup_git_integration.sql
```

This creates:
- Git repository integration
- API integration for GitHub access
- Secret for authentication

### 2. Set Up Snowflake Postgres

```sql
CREATE POSTGRES DATABASE FLUX_OPS_POSTGRES
    POSTGRES_ADMIN_PASSWORD = 'YourSecurePassword123!'
    AUTO_SUSPEND_MINS = 30
    COMPUTE_SIZE = 'HIGHMEM_XL'
    STORAGE_SIZE_GB = 100;

-- Get the host
SHOW POSTGRES INSTANCES LIKE 'FLUX_OPS_POSTGRES';
-- Save the 'host' value
```

### 3. Push Docker Image

**Option A: Use Pre-Built Image (Recommended)**

```bash
# Pull from GHCR
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# Login to Snowflake registry
docker login <org>-<account>.registry.snowflakecomputing.com

# Tag and push
docker tag ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main \
    <org>-<account>.registry.snowflakecomputing.com/flux_db/public/flux_ops_center_images/flux-ops-center:latest

docker push <org>-<account>.registry.snowflakecomputing.com/flux_db/public/flux_ops_center_images/flux-ops-center:latest
```

**Option B: Build Locally**

```bash
docker build -t flux-ops-center:latest .
docker push <registry_url>/flux-ops-center:latest
```

### 4. Deploy from Git

```bash
snow sql -f git_deploy/deploy_from_git.sql \
    -D "database=FLUX_DB" \
    -D "schema=PUBLIC" \
    -D "warehouse=FLUX_WH" \
    -D "git_repo=FLUX_OPS_CENTER_REPO" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "image_tag=latest" \
    -D "postgres_host=<your_postgres_host>" \
    -c your_connection
```

### 5. Load PostGIS Data

```bash
python backend/scripts/load_postgis_data.py --service FLUX_OPS_POSTGRES
```

This loads ~390MB of spatial data and automatically creates derived views:
- `buildings_spatial` - Building footprints with centroid coordinates
- `grid_assets` - Asset locations for risk analysis
- `vegetation_risk_computed` - Pre-computed vegetation risk with spatial joins

---

## Using Snowflake CLI

```bash
# Set up git repository
snow git setup FLUX_OPS_CENTER_REPO

# Fetch latest from GitHub
snow git fetch FLUX_OPS_CENTER_REPO

# List files
snow git list-files @FLUX_OPS_CENTER_REPO/branches/main/

# Execute deployment script
snow git execute "@FLUX_OPS_CENTER_REPO/branches/main/git_deploy/deploy_from_git.sql"
```

---

## GitHub Actions CI/CD

Add this workflow to your fork at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Snowflake

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: Snowflake-Labs/snowflake-cli-action@v1
        with:
          cli-version: latest

      - name: Fetch and Deploy
        run: |
          snow git fetch FLUX_OPS_CENTER_REPO
          snow git execute "@FLUX_OPS_CENTER_REPO/branches/main/git_deploy/deploy_from_git.sql"
        env:
          SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
          SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
          SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
```

**Required GitHub Secrets:**
- `SNOWFLAKE_ACCOUNT`
- `SNOWFLAKE_USER`
- `SNOWFLAKE_PASSWORD`

---

## Files in git_deploy/

| File | Purpose |
|------|---------|
| `setup_git_integration.sql` | One-time Git integration setup |
| `deploy_from_git.sql` | Main deployment script |
| `README.md` | Documentation (links here) |

---

## Deployment Checklist

- [ ] flux-utility-solutions deployed
- [ ] Git integration set up (`setup_git_integration.sql`)
- [ ] Snowflake Postgres instance created
- [ ] Docker image pushed to image repository
- [ ] `deploy_from_git.sql` executed with all variables
- [ ] PostGIS spatial data loaded
- [ ] Service endpoint accessible

---

## Troubleshooting

### "Repository not found"

```sql
-- Check if repo exists
SHOW GIT REPOSITORIES;

-- Re-run setup if needed
!source git_deploy/setup_git_integration.sql
```

### "Authentication failed"

Ensure the GitHub secret has correct permissions for the repository.

### Files not updating

```bash
# Force fetch latest
snow git fetch FLUX_OPS_CENTER_REPO --force
```

### Service not starting

```sql
SELECT SYSTEM$GET_SERVICE_STATUS('FLUX_OPS_CENTER_SERVICE');
CALL SYSTEM$GET_SERVICE_LOGS('FLUX_OPS_CENTER_SERVICE', '0', 'flux-ops-center', 100);
```

---

## See Also

- [Quick Start](./QUICKSTART.md) - Interactive deployment
- [Docker Images](../DOCKER_IMAGES.md) - Pre-built images
- [CLI Scripts](./CLI_SCRIPTS.md) - Manual SQL deployment
- [Snowflake Git Integration Docs](https://docs.snowflake.com/en/developer-guide/git/git-overview)
