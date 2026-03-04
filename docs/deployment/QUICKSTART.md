# Quick Start Guide

Get Flux Operations Center running on Snowflake SPCS.

---

## Choose Your Path

| Path | Best For |
|------|----------|
| **[Standalone](#standalone-deployment)** | Quick demos, trying it out |
| **[Integrated Platform](#integrated-deployment)** | Full Flux ecosystem |

**Not sure?** Start with Standalone — you can migrate later.

---

## Prerequisites

Before starting, ensure you have:

- [ ] Snowflake account with `ACCOUNTADMIN` role
- [ ] [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation) installed
- [ ] [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [ ] Git installed
- [ ] Python 3.9+ with pip (for PostGIS data loading)

### Configure Snowflake CLI

```bash
# Add a connection (interactive)
snow connection add

# Test it
snow connection test -c my_connection
```

---

## Standalone Deployment

Self-contained deployment with sample data. No other repos required.

### Step 1: Clone and Setup Database

```bash
git clone https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs.git
cd flux-ops-center-spcs

# Create database, schemas, and sample data
snow sql -c my_connection -f scripts/sql/00_standalone_quickstart.sql
```

**Created:**
- `FLUX_DB` database with schemas (PRODUCTION, APPLICATIONS, ML_DEMO, CASCADE_ANALYSIS, RAW)
- Sample data: 25 substations, 200 transformers, 50 circuits, 500 meters

### Step 2: Deploy the Application

```bash
./scripts/quickstart.sh
```

The interactive script will:
1. Validate Docker and credentials
2. Pull pre-built image from GHCR (or build locally)
3. Push to Snowflake image registry
4. Create compute pool
5. Deploy SPCS service
6. Set up Snowflake Postgres (optional but recommended)
7. Load PostGIS geospatial data
8. Set up Grid Intelligence Agent with Cortex AI

### Step 3: Load Map Data

**Required for map visualization** (if not done by quickstart):

```bash
python backend/scripts/load_postgis_data.py --service your_pg_service
```

This loads ~390MB of spatial data from [GitHub Releases](https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs/releases) and creates derived PostGIS views:

| View | Purpose | Row Count |
|------|---------|-----------|
| `buildings_spatial` | Building footprints with centroid coordinates | ~150,000 |
| `grid_assets` | Asset locations for risk analysis | ~66,000 |
| `power_lines_spatial` | Full-detail power line geometries | ~13,100 |
| `power_lines_lod_overview` | Simplified power lines for zoom < 12 | ~12,200 |
| `power_lines_lod_mid` | Moderate detail for zoom 12-14 | ~13,100 |
| `vegetation_risk_computed` | Pre-computed vegetation risk with spatial joins | ~49,000 |
| `circuit_service_areas` | Circuit boundary polygons | ~50 |
| `circuit_status_realtime` | Real-time circuit health metrics | ~50 |

> **LOD (Level of Detail)**: The power lines layer uses zoom-based simplification. At low zoom levels, `ST_Simplify` reduces vertex count for faster rendering. Without these LOD views, the power lines endpoint returns 500 errors at default zoom.

### Step 4: Access Your App

```bash
# Get the service URL
snow sql -c my_connection -q "SHOW ENDPOINTS IN SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER_SERVICE"
```

Open the `ingress_url` in your browser.

### Step 5: Enable Map Layers

The map starts with only **buildings** visible. To see other layers:

1. Click the **Layers** panel (top-right of map)
2. Toggle **Power Lines** — fetched on-demand via PostGIS with LOD-based simplification
3. Toggle **Vegetation Risk** — shows risk scores near power lines

These layers are lazy-loaded (fetched only when toggled on) to keep initial page load fast.

---

## Integrated Deployment

Full Flux Utility Platform with shared data across applications.

### Step 1: Deploy Core Platform First

```bash
# Clone flux-utility-solutions
git clone https://github.com/sfc-gh-abannerjee/flux-utility-solutions.git
cd flux-utility-solutions

# Deploy (interactive)
./cli/quickstart.sh --database FLUX_DB --connection my_connection
```

### Step 2: Deploy Flux Ops Center

```bash
cd ../flux-ops-center-spcs

# Uses existing FLUX_DB from step 1
./scripts/quickstart.sh
```

### Step 3: Load Map Data

```bash
python backend/scripts/load_postgis_data.py --service your_pg_service
```

### Step 4: (Optional) Deploy Data Generator

```bash
git clone https://github.com/sfc-gh-abannerjee/flux-data-forge.git
cd flux-data-forge
./quickstart.sh
```

---

## Using Pre-Built Docker Images

Skip building entirely by using images from GitHub Container Registry.

```bash
# Pull (auto-selects your architecture)
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# For SPCS: explicitly pull amd64
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

See [Docker Images Guide](../DOCKER_IMAGES.md) for full instructions.

---

## Grid Intelligence Agent

The Grid Intelligence Agent provides natural language access to technical documentation and compliance regulations. It is set up automatically by Step 12 of `quickstart.sh`.

### What Gets Created

1. **Source Data** — Sample technical manuals (23 chunks) and NERC/regulatory compliance docs (8 documents) loaded from `data/cortex_search_data/`
2. **Cortex Search Services** — Two search services that index the source data for RAG retrieval
3. **Cortex Agent** — `SNOWFLAKE_INTELLIGENCE.AGENTS.GRID_INTELLIGENCE_AGENT` using Claude Sonnet for orchestration

### Manual Setup (if quickstart was skipped)

```bash
# 1. Load sample data
snow sql -c my_connection -f data/cortex_search_data/technical_manuals_sample.sql \
    -D "database=FLUX_DB"
snow sql -c my_connection -f data/cortex_search_data/compliance_docs.sql \
    -D "database=FLUX_DB"

# 2. Create search services (requires ACCOUNTADMIN)
snow sql -c my_connection -f scripts/sql/07_create_cortex_search.sql \
    -D "database=FLUX_DB" -D "warehouse=FLUX_WH"

# 3. Create agent
snow sql -c my_connection -f scripts/sql/08_create_cortex_agent.sql \
    -D "database=FLUX_DB" -D "warehouse=FLUX_WH"
```

### Verify the Agent

```sql
-- Check agent exists
SHOW AGENTS IN SCHEMA SNOWFLAKE_INTELLIGENCE.AGENTS;

-- Check search services
SHOW CORTEX SEARCH SERVICES IN DATABASE FLUX_DB;
```

---

## What's Next?

| Task | Guide |
|------|-------|
| Load cascade analysis data | [CASCADE_ANALYSIS.md](../CASCADE_ANALYSIS.md) |
| Understand the API | [API_REFERENCE.md](../API_REFERENCE.md) |
| Local development | [LOCAL_DEVELOPMENT_GUIDE.md](../LOCAL_DEVELOPMENT_GUIDE.md) |
| Other deployment methods | [Deployment Options](./) |

---

## Troubleshooting

### Service won't start

```sql
-- Check status
SELECT SYSTEM$GET_SERVICE_STATUS('FLUX_OPS_CENTER_SERVICE');

-- View logs
CALL SYSTEM$GET_SERVICE_LOGS('FLUX_OPS_CENTER_SERVICE', '0', 'flux-ops-center', 100);
```

### Map shows no data

PostGIS data not loaded. Run:
```bash
python backend/scripts/load_postgis_data.py --service your_pg_service
```

### Power lines not visible

1. Check the **Layers** panel — power lines are OFF by default (toggle them on)
2. If toggled on but still blank, verify LOD views exist in Postgres:
   ```sql
   -- Connect to Postgres and check
   SELECT COUNT(*) FROM power_lines_lod_overview;  -- Should be ~12,000+
   SELECT COUNT(*) FROM power_lines_lod_mid;        -- Should be ~13,000+
   ```
3. If LOD views are missing, re-run the data loader:
   ```bash
   python backend/scripts/load_postgis_data.py --service your_pg_service
   ```

### Map tiles not loading (blank background)

External Access Integrations missing. The SPCS service needs network egress to CARTO CDN:

```sql
-- Check if EAIs exist
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'FLUX_%';
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'GOOGLE_%';

-- If missing, run the EAI setup:
snow sql -c my_connection -f scripts/sql/05b_map_external_access.sql \
    -D "database=FLUX_DB" -D "schema=APPLICATIONS"

-- Then update the service:
ALTER SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER_SERVICE
    SET EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI);
```

### Cortex Search fails with internal error (370001)

Use `ACCOUNTADMIN` role. SYSADMIN produces internal errors on some accounts:
```sql
USE ROLE ACCOUNTADMIN;
-- Then re-run 07_create_cortex_search.sql
```

### Agent creation fails

The agent uses `CREATE AGENT ... FROM SPECIFICATION $$ yaml $$` syntax. Common errors:
- `"unexpected 'AGENT'"` — Use `CREATE AGENT`, not `CREATE CORTEX AGENT`
- `"invalid property 'MODELS'"` — Use `FROM SPECIFICATION` with YAML, not property syntax

### "Image not found" error

Image not pushed to Snowflake registry. Check:
```sql
SHOW IMAGES IN IMAGE REPOSITORY FLUX_OPS_CENTER_IMAGES;
```

### Docker build fails on Apple Silicon

Use pre-built images instead:
```bash
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

---

## See Also

- [Docker Images](../DOCKER_IMAGES.md) - Multi-arch images, SPCS deployment
- [CLI Scripts Deployment](./CLI_SCRIPTS.md) - Step-by-step SQL scripts
- [Terraform Deployment](./TERRAFORM.md) - Infrastructure as Code
- [Main README](../../README.md) - Project overview
