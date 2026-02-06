# Flux Ops Center - Update Instructions

This document provides instructions for users who deployed Flux Ops Center before commit `88ddabe` (February 6, 2026) and need to apply DDL fixes.

## Summary of Fixes

1. **DDL Schema Updates** - Added missing columns that the backend queries expect
2. **CSP Fix** - Updated Content Security Policy to allow map tile loading from `*.basemaps.cartocdn.com`

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

## CSP Fix (If Map Tiles Not Loading)

If map tiles are not loading in your deployment, you have two options:

### Option A: Rebuild from Latest Repo
Pull the latest code from the repository and rebuild your Docker image. The CSP fix is included.

### Option B: Manual Fix
If you cannot rebuild, update the CSP in your nginx configuration to include:
```
*.basemaps.cartocdn.com
```

In the `img-src` and `connect-src` directives.

---

## Questions?

Contact the CPE team if you encounter issues after applying these fixes.
