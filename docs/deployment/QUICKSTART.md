# Quick Start Guide

Get Flux Operations Center running in 15 minutes.

---

## Choose Your Path

| Path | Time | Best For |
|------|------|----------|
| **[Standalone](#standalone-deployment)** | ~15 min | Quick demos, trying it out |
| **[Integrated Platform](#integrated-deployment)** | ~30 min | Full Flux ecosystem |

**Not sure?** Start with Standalone—you can migrate later.

---

## Prerequisites

Before starting, ensure you have:

- [ ] Snowflake account with `ACCOUNTADMIN` role
- [ ] [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation) installed
- [ ] [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [ ] Git installed

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
1. ✓ Validate Docker and credentials
2. ✓ Pull pre-built image from GHCR (or build locally)
3. ✓ Push to Snowflake image registry
4. ✓ Create compute pool
5. ✓ Deploy SPCS service
6. ✓ Set up Snowflake Postgres (optional but recommended)

### Step 3: Load Map Data

**Required for map visualization:**

```bash
python backend/scripts/load_postgis_data.py --service your_pg_service
```

This loads ~390MB of spatial data (building footprints, power lines, etc.) from GitHub Releases and automatically creates derived views:
- `buildings_spatial` - Building footprints with centroid coordinates
- `grid_assets` - Asset locations for risk analysis
- `vegetation_risk_computed` - Pre-computed vegetation risk with spatial joins

### Step 4: Access Your App

```bash
# Get the service URL
snow sql -c my_connection -q "SHOW ENDPOINTS IN SERVICE FLUX_DB.PUBLIC.FLUX_OPS_CENTER_SERVICE"
```

Open the `ingress_url` in your browser.

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

## What's Next?

| Task | Guide |
|------|-------|
| Load cascade analysis data | [CASCADE_ANALYSIS.md](../CASCADE_ANALYSIS.md) |
| Set up Grid Intelligence Agent | [Main README - Agent Setup](../../README.md#grid-intelligence-agent-setup-requirements) |
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

### Map tiles not loading (blank background)

External Access Integrations missing. The SPCS service needs network egress to CARTO CDN:

```sql
-- Check if EAIs exist
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'FLUX_%';
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'GOOGLE_%';

-- If missing, run the EAI setup (included in 00_standalone_quickstart.sql)
-- Or run separately:
snow sql -c my_connection -f scripts/sql/05b_map_external_access.sql \
    -D "database=FLUX_DB" -D "schema=APPLICATIONS"

-- Then update the service to use them:
ALTER SERVICE FLUX_DB.PUBLIC.FLUX_OPS_CENTER_SERVICE
    SET EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI);
```

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
