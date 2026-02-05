# Sync Procedures - Status

## Status: COMPLETE ✅

### Static Data Loading - COMPLETE ✅

All static spatial data is loaded via bulk CSV exports using `load_postgis_data.py`:
- Building footprints, water bodies, power lines, vegetation risk
- Substations, transformers, customers, meters
- Grid assets cache, topology connections cache

**No Snowflake→Postgres sync needed for static layers.**

### Dynamic Data Sync - COMPLETE ✅

The following procedures were created in `scripts/sql/06_postgres_sync.sql`:

| Procedure | Postgres Table | Snowflake Source | Purpose |
|-----------|----------------|------------------|---------|
| `SYNC_OUTAGES_TO_POSTGRES()` | outage_restoration_tracker | OUTAGE_RESTORATION_TRACKER | Active outage tracking |
| `SYNC_WORK_ORDERS_TO_POSTGRES()` | work_orders | WORK_ORDERS | Work order management |
| `SYNC_CIRCUIT_STATUS_TO_POSTGRES()` | circuit_status_realtime | CIRCUIT_METADATA + derived | Real-time circuit status |
| `SYNC_ALL_DYNAMIC_TO_POSTGRES()` | All above | All above | Master sync procedure |
| `SETUP_DYNAMIC_POSTGRES_TABLES()` | All above | N/A | Create tables (run once) |

### Key Fixes Applied

1. **Correct secret access method** - Uses `_snowflake.get_username_password()` for PASSWORD type secrets
2. **Proper table names** - Static data uses original table names from production
3. **Snow CLI syntax** - Uses `<% variable %>` syntax compatible with `snow sql -D`
4. **Focused scope** - Only syncs truly dynamic data, not static reference layers

### Usage

```bash
# Deploy sync procedures
snow sql -f scripts/sql/06_postgres_sync.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -D "postgres_host=<instance>.postgres.snowflake.app" \
    -D "postgres_secret=FLUX_DB.APPLICATIONS.POSTGRES_CREDENTIALS" \
    -D "postgres_integration=FLUX_POSTGRES_INTEGRATION" \
    -c your_connection
```

```sql
-- Create dynamic tables in Postgres (run once)
CALL POSTGRES_SYNC.SETUP_DYNAMIC_POSTGRES_TABLES();

-- Manual sync of all dynamic data
CALL POSTGRES_SYNC.SYNC_ALL_DYNAMIC_TO_POSTGRES();

-- Enable scheduled sync (every 5 minutes)
ALTER TASK POSTGRES_SYNC.TASK_DYNAMIC_POSTGRES_SYNC RESUME;

-- Monitor sync status
SELECT * FROM POSTGRES_SYNC.V_SYNC_STATUS;
SELECT * FROM POSTGRES_SYNC.V_SYNC_SUMMARY;
```

### Data Strategy Summary

| Data Type | Loading Method | Frequency | Tables |
|-----------|---------------|-----------|--------|
| **Static** | `load_postgis_data.py` from GitHub Releases | Once (or on major updates) | buildings, water, power_lines, vegetation, substations, transformers, etc. |
| **Dynamic** | Snowflake stored procedures | Every 5 minutes | outages, work_orders, circuit_status |
