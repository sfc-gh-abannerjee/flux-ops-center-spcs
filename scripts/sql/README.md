# SQL Deployment Scripts

Deploy Flux Operations Center using Snow CLI with Jinja2-templated SQL.

**[Full Documentation →](../docs/deployment/CLI_SCRIPTS.md)**

---

## Quick Start

```bash
export CONN="your_connection"

# 1. Create image repository
snow sql -c $CONN -f scripts/sql/01_image_repository.sql \
    -D "database=FLUX_DB" -D "schema=APPLICATIONS" -D "image_repo=FLUX_OPS_CENTER_IMAGES"

# 2. Push Docker image (see Docker guide)

# 3. Create compute pool
snow sql -c $CONN -f scripts/sql/02_compute_pool.sql \
    -D "database=FLUX_DB" -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "instance_family=CPU_X64_S" -D "min_nodes=1" -D "max_nodes=2"

# 4. Deploy service (replace <postgres_host> and <postgres_password> with your values)
snow sql -c $CONN -f scripts/sql/03_create_service.sql \
    -D "database=FLUX_DB" -D "schema=APPLICATIONS" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -D "image_tag=latest" -D "warehouse=FLUX_WH" \
    -D "postgres_host=<postgres_host>" \
    -D "postgres_password=<postgres_password>"

# 5. Validate
snow sql -c $CONN -f scripts/sql/04_validation.sql \
    -D "database=FLUX_DB" -D "service_name=FLUX_OPS_CENTER_SERVICE" \
    -D "compute_pool=FLUX_OPS_CENTER_POOL" -D "image_repo=FLUX_OPS_CENTER_IMAGES"
```

---

## Script Order

| # | Script | Role Required | Purpose |
|---|--------|---------------|---------|
| 0 | `00_standalone_quickstart.sql` | SYSADMIN | Create database + schemas + sample data |
| 1 | `01_image_repository.sql` | SYSADMIN | Create image repository for Docker images |
| 2 | `02_compute_pool.sql` | SYSADMIN | Create SPCS compute pool |
| 3 | `03_create_service.sql` | SYSADMIN | Deploy the SPCS service |
| 4 | `04_validation.sql` | SYSADMIN | Validate deployment health |
| 5 | `05_postgres_setup.sql` | **ACCOUNTADMIN** | Create Snowflake Postgres instance |
| 5a | `05a_external_access.sql` | **ACCOUNTADMIN** | Network rules + secrets for Postgres |
| 5b | `05b_map_external_access.sql` | **ACCOUNTADMIN** | EAIs for CARTO tiles + Google Fonts |
| 6 | `06_postgres_sync.sql` | SYSADMIN | Sync procedures (Snowflake → Postgres) |
| 7 | `07_create_cortex_search.sql` | **ACCOUNTADMIN** | Cortex Search services for RAG |
| 8 | `08_create_cortex_agent.sql` | **ACCOUNTADMIN** | Grid Intelligence Agent |
| 9 | `09_extend_cascade_hierarchy.sql` | SYSADMIN | Extend topology to poles + meters |
| 10 | `10_create_cascade_ml_data.sql` | SYSADMIN | Create ML tables + synthetic data for cascade analysis |
| 11 | `11_create_semantic_view.sql` | **ACCOUNTADMIN** | Semantic View for Cortex Analyst |

> **Note**: Scripts marked **ACCOUNTADMIN** will fail or produce internal errors if run with SYSADMIN. Each script sets its own role via `USE ROLE`.

---

## Jinja2 Template Variables

> **First time?** Run `quickstart.sh` instead — it prompts for every value
> interactively so you never need to think about `-D` flags.
> These individual scripts are for advanced users or CI/CD pipelines.

All scripts use `<% variable %>` syntax for Snow CLI's `-D` flag:

```bash
snow sql -c my_conn -f scripts/sql/03_create_service.sql \
    -D "database=FLUX_DB" \
    -D "schema=APPLICATIONS" \
    -D "service_name=FLUX_OPS_CENTER_SERVICE"
```

If you forget a `-D` flag, you'll see an error like:
```
001003 (42000): SQL compilation error:
syntax error line 1 at position 13 unexpected '<'.
```
This means an unresolved `<% variable %>` was sent to Snowflake. Add the missing
`-D` flag — check each script's header comment for required variables.

Common variables used across scripts:

| Variable | Default | Used In |
|----------|---------|---------|
| `database` | `FLUX_DB` | All scripts |
| `warehouse` | `FLUX_WH` | 03, 07, 08, 09, 10, 11 |
| `schema` | `APPLICATIONS` | 03, 05a, 05b |
| `compute_pool` | `FLUX_OPS_CENTER_POOL` | 02, 03 |
| `service_name` | `FLUX_OPS_CENTER_SERVICE` | 03, 04 |
| `user_role` | `PUBLIC` | 11 |

---

## Common Pitfalls

### Cortex Search fails with internal error (370001)
**Cause**: Running `07_create_cortex_search.sql` with SYSADMIN role.
**Fix**: The script now uses `ACCOUNTADMIN` automatically. If running manually, ensure you `USE ROLE ACCOUNTADMIN` first.

### Agent creation fails with "invalid property 'MODELS'"
**Cause**: Using the deprecated property-based agent syntax.
**Fix**: `08_create_cortex_agent.sql` uses the correct `FROM SPECIFICATION $$ yaml $$` syntax. Do not modify to use `MODELS = (...)` or `TOOLS = (...)`.

### "syntax error at position 25 unexpected 'AGENT'"
**Cause**: Using `CREATE CORTEX AGENT` instead of `CREATE AGENT`.
**Fix**: The correct DDL command is `CREATE AGENT` (no `CORTEX` prefix).

### Map tiles blank (no background)
**Cause**: Missing External Access Integrations for CARTO CDN and Google Fonts.
**Fix**: Run `05b_map_external_access.sql` and update the service's `EXTERNAL_ACCESS_INTEGRATIONS`.

### ON CONFLICT syntax error in sample data SQL
**Cause**: PostgreSQL syntax in Snowflake SQL files.
**Fix**: Pull latest — sample data files now use `TRUNCATE + INSERT` instead.

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
- [Cortex Search Data](../data/cortex_search_data/README.md)
