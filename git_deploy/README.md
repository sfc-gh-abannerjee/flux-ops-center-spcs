# Git Integration Deployment

Deploy Flux Operations Center using Snowflake's native Git integration.

**[Full Documentation →](../docs/deployment/GIT_INTEGRATION.md)**

---

## Quick Start

### 1. One-Time Setup

```sql
-- Run in Snowflake Worksheets
!source git_deploy/setup_git_integration.sql
```

### 2. Deploy

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

### 3. Load PostGIS Data

```bash
python backend/scripts/load_postgis_data.py --service FLUX_OPS_POSTGRES
```

## Files

| File | Purpose |
|------|---------|
| `setup_git_integration.sql` | One-time Git integration setup |
| `deploy_from_git.sql` | Main deployment script |

## Prerequisites

- flux-utility-solutions deployed
- Docker image pushed to Snowflake registry
- Snowflake Postgres instance (for maps)

## See Also

- [Full Git Integration Guide](../docs/deployment/GIT_INTEGRATION.md)
- [Docker Images](../docs/DOCKER_IMAGES.md)
- [All Deployment Options](../docs/deployment/)
