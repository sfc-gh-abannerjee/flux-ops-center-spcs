# Flux Operations Center - Git Integration Deployment

This directory contains SQL scripts for deploying Flux Operations Center using Snowflake's native Git integration.

## Overview

Snowflake Git integration allows you to:
- Execute SQL files directly from a GitHub repository
- Deploy infrastructure without downloading files locally
- Integrate with CI/CD pipelines via GitHub Actions
- Maintain version-controlled deployments

## Quick Start

### 1. One-Time Setup

```sql
-- Run in Snowflake Worksheets with ACCOUNTADMIN role
!source setup_git_integration.sql
```

### 2. Deploy Infrastructure

```sql
-- Run the deployment script
!source deploy_from_git.sql
```

### 3. Push Docker Image

```bash
# Get the registry URL from SHOW IMAGE REPOSITORIES
docker login <org>-<account>.registry.snowflakecomputing.com

# Build and push
docker build -t flux_ops_center:latest -f Dockerfile.spcs .
docker push <repository_url>/flux_ops_center:latest
```

### 4. Create Service

Uncomment and run the CREATE SERVICE statement in `deploy_from_git.sql`.

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

## Related Documentation

- [Snowflake Git Integration](https://docs.snowflake.com/en/developer-guide/git/git-overview)
- [Flux Utility Platform](https://github.com/sfc-gh-abannerjee/flux-utility-solutions)
- [Flux Data Forge](https://github.com/sfc-gh-abannerjee/flux-data-forge)
