# SQL Deployment Scripts

Deploy Flux Operations Center using Snow CLI with Jinja2-templated SQL.

**[Full Documentation →](../docs/deployment/CLI_SCRIPTS.md)**

---

## Quick Start

```bash
export CONN="your_connection"

# 1. Create image repository
snow sql -c $CONN -f scripts/sql/01_image_repository.sql \
    -D "database=FLUX_DB" -D "schema=PUBLIC" -D "image_repo=FLUX_OPS_CENTER_IMAGES"

# 2. Push Docker image (see Docker guide)

# 3. Create compute pool
snow sql -c $CONN -f scripts/sql/02_compute_pool.sql \
    -D "database=FLUX_DB" -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "instance_family=CPU_X64_S" -D "min_nodes=1" -D "max_nodes=2"

# 4. Deploy service
snow sql -c $CONN -f scripts/sql/03_create_service.sql \
    -D "database=FLUX_DB" -D "schema=PUBLIC" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "image_tag=latest" -D "warehouse=FLUX_WH"

# 5. Validate
snow sql -c $CONN -f scripts/sql/04_validation.sql \
    -D "database=FLUX_DB" -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" -D "image_repo=FLUX_OPS_CENTER_IMAGES"
```

---

## Script Order

| # | Script | Purpose |
|---|--------|---------|
| 0 | `00_standalone_quickstart.sql` | Create database + sample data |
| 1 | `01_image_repository.sql` | Create image repository |
| 2 | `02_compute_pool.sql` | Create compute pool |
| 3 | `03_create_service.sql` | Deploy SPCS service |
| 4 | `04_validation.sql` | Validate deployment |
| 5 | `05_postgres_setup.sql` | Set up Postgres |
| 5a | `05a_external_access.sql` | External access integration |
| 6 | `06_postgres_sync.sql` | Sync procedures |
| 7 | `07_create_cortex_search.sql` | Cortex Search services |
| 8 | `08_create_cortex_agent.sql` | Grid Intelligence Agent |
| 9 | `09_extend_cascade_hierarchy.sql` | Extend topology to poles + meters |

---

## Using Pre-Built Docker Images

Skip building - use images from GitHub Container Registry:

```bash
# Pull (use --platform linux/amd64 on Apple Silicon for SPCS)
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# Tag and push to Snowflake
docker tag ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main \
    <registry_url>/flux-ops-center:latest
docker push <registry_url>/flux-ops-center:latest
```

**[Full Docker Guide →](../docs/DOCKER_IMAGES.md)**

---

## See Also

- [Full CLI Scripts Guide](../docs/deployment/CLI_SCRIPTS.md)
- [Docker Images](../docs/DOCKER_IMAGES.md)
- [All Deployment Options](../docs/deployment/)
