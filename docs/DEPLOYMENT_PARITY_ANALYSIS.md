# Deployment Parity Analysis

**Last Updated**: February 2026

This document identifies gaps and inconsistencies across deployment methods to ensure all paths result in the same working application.

---

## Summary of Issues Found

| Issue | Severity | Status | Fix Required |
|-------|----------|--------|--------------|
| PostGIS data not in deployment flow | **CRITICAL** | FIXED | Add to README and quickstart |
| Two conflicting .env templates | Medium | FIXED | Consolidate to .env.example |
| Service spec container name mismatch | Medium | FIXED | Standardize to flux-ops-center |
| SQL template syntax inconsistency | Low | Documented | Use `<% %>` for Snow CLI |
| Terraform schema differs from quickstart | Low | Documented | Different use case |
| Sync procedures target wrong tables | **CRITICAL** | Documented | Static data strategy |

---

## Critical Gap 1: PostGIS Data Loading

### Problem
The 10 PostGIS spatial layers (390MB compressed) are required for the map visualization but were not included in any deployment path:
- `README.md` doesn't mention PostGIS data
- `quickstart.sh` doesn't include data loading steps
- `00_standalone_quickstart.sql` creates empty spatial tables

### Solution
1. Added PostGIS data section to README.md
2. Updated quickstart.sh to prompt for PostGIS setup
3. Created comprehensive data loading script at `backend/scripts/load_postgis_data.py`
4. Data distributed via GitHub Releases (not Snowflake stage, since new users won't have access)

### Required Data Files (from GitHub Releases)
| File | Table | Rows | Size |
|------|-------|------|------|
| building_footprints.csv.gz | building_footprints | 2,670,707 | 310MB |
| grid_assets_cache.csv.gz | grid_assets_cache | 726,263 | 55MB |
| customers_spatial.csv.gz | customers_spatial | 100,000 | 6MB |
| osm_water.csv.gz | osm_water | 12,758 | 6MB |
| topology_connections_cache.csv.gz | topology_connections_cache | 153,592 | 5MB |
| meter_locations_enhanced.csv.gz | meter_locations_enhanced | 100,000 | 5MB |
| vegetation_risk.csv.gz | vegetation_risk | 49,265 | 4MB |
| transformers.csv.gz | transformers | 91,554 | 3MB |
| grid_power_lines.csv.gz | grid_power_lines | 13,104 | 800KB |
| substations.csv.gz | substations | 275 | 12KB |

---

## Critical Gap 2: Static vs Dynamic Data Strategy

### Problem
The `06_postgres_sync.sql` stored procedures are designed for **dynamic** sync from Snowflake to Postgres, but:
1. They target table names that don't exist in production (`meters_spatial`, `substations_spatial`)
2. Production Postgres has cleaned/adjusted polygon geometries that Snowflake doesn't have
3. Snowflake only has point data for most layers

### Solution: Two-Tier Data Strategy

**Static Layers (Bulk Load from GitHub Releases)**
- Building footprints, water bodies, power lines, vegetation risk
- These have complex polygon geometries created in PostGIS
- Load once using `load_postgis_data.py`

**Dynamic Layers (Snowflake Sync)**
- Outage tracker, work orders, real-time circuit status
- Sync procedures available in `scripts/sql/06_postgres_sync.sql`
- See `docs/POSTGRES_SYNC_GUIDE.md` for setup instructions

---

## Gap 3: Environment File Confusion

### Problem
Two template files existed with different content:
- `.env.template` - Minimal, focused on Vite/frontend variables
- `.env.example` - More comprehensive, includes SPCS deployment variables

### Solution
Consolidated to single `.env.example` with all required variables:
- Snowflake database/warehouse/connection
- Postgres connection (host, port, user, password)
- SPCS deployment variables
- AWS config to prevent boto3 SSO errors

---

## Gap 4: Service Spec Inconsistencies

### Problem
Three service spec files with different configurations:

| File | Container Name | CPU | Memory | Endpoints |
|------|----------------|-----|--------|-----------|
| service.yaml | frontend | 2-4 | 2-4Gi | ui:8080 |
| service_spec_prod.yaml | flux-ops-center | 0.5-6 | 0.5-28Gi | ui:8080 |
| quickstart.sh (generated) | flux-ops-center | 2-4 | 4-8Gi | app:8080, api:8000 |

### Solution
1. Standardized container name to `flux-ops-center`
2. Updated service.yaml to match production patterns
3. Documented that service_spec_prod.yaml is for HA deployments

---

## Gap 5: SQL Template Syntax

### Problem
Inconsistent Jinja2 syntax across SQL scripts:
- `05_postgres_setup.sql` uses `<% variable %>` (Snow CLI syntax)
- `06_postgres_sync.sql` uses `{{ variable }}` (standard Jinja2)

### Impact
Scripts using `{{ }}` won't work with `snow sql -D` command without modification.

### Recommendation
Use `<% %>` syntax for all scripts intended for Snow CLI execution.
Document that `{{ }}` scripts require manual variable substitution.

---

## Gap 6: Terraform vs Quickstart Schema Differences

### Problem
Terraform creates different table schemas than standalone quickstart:
- Terraform: `SUBSTATIONS` with columns `NAME`, `VOLTAGE_KV`, `STATUS`
- Quickstart: `SUBSTATIONS` with columns `SUBSTATION_NAME`, `CAPACITY_MVA`, `OPERATIONAL_STATUS`

### Resolution
This is intentional - Terraform is designed for:
- Minimal infrastructure setup
- Demonstration/POC deployments
- Tables are populated by user's own data

Standalone quickstart is designed for:
- Production-like schema
- Pre-populated sample data
- Full feature demonstration

---

## Deployment Method Comparison Matrix

| Feature | Standalone | Integrated | Terraform | Git Deploy |
|---------|------------|------------|-----------|------------|
| Creates Database | Yes | No (uses flux-utility-solutions) | Yes | No |
| Creates Warehouse | Yes | No | Optional | No |
| Sample Data | Yes | Yes (from platform) | No | No |
| PostGIS Data | Manual | Manual | Manual | Manual |
| Postgres Instance | Yes | Yes | Partial | No |
| SPCS Service | Yes | Yes | Partial | Yes |
| Time to Deploy | 15 min | 30-45 min | 30 min | 20 min |

---

## Recommended Deployment Checklist

### For New Users (Quick Demo)
1. Run `00_standalone_quickstart.sql`
2. Run `quickstart.sh` to deploy SPCS
3. Set up Postgres instance (prompted in quickstart)
4. **NEW**: Load PostGIS data from GitHub Releases
5. Access application

### For Production (Full Platform)
1. Deploy flux-utility-solutions first
2. Run `quickstart.sh` for Flux Ops Center
3. Set up Postgres instance with `05_postgres_setup.sql`
4. **NEW**: Load PostGIS data from GitHub Releases
5. Configure dynamic sync for real-time data
6. Access application

---

## Files Modified to Address Gaps

1. `README.md` - Added PostGIS data section
2. `scripts/quickstart.sh` - Added PostGIS prompt
3. `.env.example` - Consolidated environment template
4. `service.yaml` - Standardized container name
5. `docs/DEPLOYMENT_PARITY_ANALYSIS.md` - This document
