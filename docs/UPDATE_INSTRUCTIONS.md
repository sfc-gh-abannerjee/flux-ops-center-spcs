# Flux Ops Center - Update Instructions

This document provides instructions for users who deployed Flux Ops Center before commit `88ddabe` (February 6, 2026) and need to apply DDL fixes.

## Summary of Fixes

1. **DDL Schema Updates** - Added missing columns that the backend queries expect
2. **External Access Integrations** - Added EAIs for CARTO map tiles and Google Fonts

---

## DDL Fixes (ALTER TABLE Statements)

If you deployed using the previous DDL and are seeing query errors, run these ALTER TABLE statements:

### 1. NODE_CENTRALITY_FEATURES_V2 - Add CASCADE_RISK_SCORE_NORMALIZED

```sql
ALTER TABLE FLUX_DB.ANALYTICS.NODE_CENTRALITY_FEATURES_V2 
ADD COLUMN CASCADE_RISK_SCORE_NORMALIZED FLOAT;
```

### 2. GNN_PREDICTIONS - Add GNN_CASCADE_RISK

```sql
ALTER TABLE FLUX_DB.ANALYTICS.GNN_PREDICTIONS 
ADD COLUMN GNN_CASCADE_RISK FLOAT;
```

---

## Verification

After running the ALTER statements, verify the columns exist:

```sql
-- Check NODE_CENTRALITY_FEATURES_V2
DESCRIBE TABLE FLUX_DB.ANALYTICS.NODE_CENTRALITY_FEATURES_V2;

-- Check GNN_PREDICTIONS  
DESCRIBE TABLE FLUX_DB.ANALYTICS.GNN_PREDICTIONS;
```

---

## Map Tiles Fix (External Access Integrations)

If map tiles are not loading (blank background), you need to create External Access Integrations that allow the SPCS service to reach CARTO's CDN.

### Option A: Run the EAI Setup Script

```bash
snow sql -c your_connection -f scripts/sql/05b_map_external_access.sql \
    -D "database=FLUX_DB" \
    -D "schema=APPLICATIONS"
```

Then update your service to use the integrations:

```sql
ALTER SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER
    SET EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI);
```

### Option B: Manual SQL

```sql
USE ROLE ACCOUNTADMIN;
USE DATABASE FLUX_DB;
USE SCHEMA APPLICATIONS;

-- Create network rule for CARTO tiles
CREATE OR REPLACE NETWORK RULE FLUX_CARTO_NETWORK_RULE
    TYPE = HOST_PORT
    VALUE_LIST = (
        'basemaps.cartocdn.com:443',
        'tiles.basemaps.cartocdn.com:443',
        'tiles-a.basemaps.cartocdn.com:443',
        'tiles-b.basemaps.cartocdn.com:443',
        'tiles-c.basemaps.cartocdn.com:443',
        'tiles-d.basemaps.cartocdn.com:443',
        'a.basemaps.cartocdn.com:443',
        'b.basemaps.cartocdn.com:443',
        'c.basemaps.cartocdn.com:443',
        'd.basemaps.cartocdn.com:443',
        'unpkg.com:443'
    )
    MODE = EGRESS;

-- Create network rule for Google Fonts
CREATE OR REPLACE NETWORK RULE FLUX_GOOGLE_FONTS_NETWORK_RULE
    TYPE = HOST_PORT
    VALUE_LIST = ('fonts.googleapis.com:443', 'fonts.gstatic.com:443')
    MODE = EGRESS;

-- Create integrations
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION FLUX_CARTO_INTEGRATION
    ALLOWED_NETWORK_RULES = (FLUX_CARTO_NETWORK_RULE)
    ENABLED = TRUE;

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION GOOGLE_FONTS_EAI
    ALLOWED_NETWORK_RULES = (FLUX_GOOGLE_FONTS_NETWORK_RULE)
    ENABLED = TRUE;

-- Update service
ALTER SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER
    SET EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI);
```

---

## Questions?

Contact the CPE team if you encounter issues after applying these fixes.
