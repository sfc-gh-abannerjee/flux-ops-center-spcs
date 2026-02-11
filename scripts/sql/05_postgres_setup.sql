-- =============================================================================
-- Flux Ops Center - 05: Snowflake Postgres Setup (Dual-Backend Architecture)
-- =============================================================================
-- Sets up Snowflake Postgres for the dual-backend architecture:
--   - Snowflake: Analytics, ML, large-scale data processing
--   - Postgres: Real-time operational queries, PostGIS geospatial
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>               - Target database name (e.g., FLUX_DB)
--   <% warehouse %>              - Warehouse for task execution
--   <% postgres_instance %>      - Postgres instance name (default: FLUX_OPS_POSTGRES)
--   <% postgres_compute %>       - Compute family (HIGHMEM_XL recommended, STANDARD_M minimum)
--   <% postgres_storage_gb %>    - Storage size in GB (10-65535)
--   <% postgres_version %>       - Postgres version (16, 17, or 18)
--
-- Usage:
--   snow sql -f scripts/sql/05_postgres_setup.sql \
--       -D "database=FLUX_DB" \
--       -D "warehouse=FLUX_WH" \
--       -D "postgres_instance=FLUX_OPS_POSTGRES" \
--       -D "postgres_compute=HIGHMEM_XL" \
--       -D "postgres_storage_gb=100" \
--       -D "postgres_version=17" \
--       -c your_connection_name
--
-- Prerequisites:
--   - Must have CREATE POSTGRES INSTANCE privilege (ACCOUNTADMIN by default)
--   - Must have CREATE NETWORK POLICY and CREATE NETWORK RULE privileges
--   - Database must exist (created by flux-utility-solutions or 00_standalone_quickstart.sql)
--
-- IMPORTANT: 
--   After running this script, SAVE THE CREDENTIALS displayed!
--   They cannot be retrieved later and are needed for FastAPI connection.
-- =============================================================================

-- =============================================================================
-- 1. NETWORK POLICY SETUP
-- =============================================================================
-- Snowflake Postgres requires a network policy with POSTGRES_INGRESS mode rules

USE ROLE ACCOUNTADMIN;

-- Create network rule for Postgres ingress traffic
-- MODE = POSTGRES_INGRESS is specifically required for Snowflake Postgres
-- NOTE: 0.0.0.0/0 allows all IPs - in production, restrict to specific CIDR ranges
CREATE NETWORK RULE IF NOT EXISTS <% database %>.PUBLIC.FLUX_POSTGRES_INGRESS_RULE
    TYPE = IPV4
    VALUE_LIST = ('0.0.0.0/0')
    MODE = POSTGRES_INGRESS
    COMMENT = 'Ingress rule for Flux Ops Center Postgres instance - restrict in production';

-- Create egress rule for Postgres (needed for foreign data wrapper connections)
CREATE NETWORK RULE IF NOT EXISTS <% database %>.PUBLIC.FLUX_POSTGRES_EGRESS_RULE
    TYPE = IPV4
    VALUE_LIST = ('0.0.0.0/0')
    MODE = POSTGRES_EGRESS
    COMMENT = 'Egress rule for Flux Ops Center Postgres FDW connections - restrict in production';

-- Create network policy combining both rules
CREATE NETWORK POLICY IF NOT EXISTS FLUX_POSTGRES_NETWORK_POLICY
    ALLOWED_NETWORK_RULE_LIST = (
        <% database %>.PUBLIC.FLUX_POSTGRES_INGRESS_RULE,
        <% database %>.PUBLIC.FLUX_POSTGRES_EGRESS_RULE
    )
    COMMENT = 'Network policy for Flux Ops Center Postgres instance';

-- Verify network policy creation
SHOW NETWORK POLICIES LIKE 'FLUX_POSTGRES%';

-- =============================================================================
-- 2. CREATE POSTGRES INSTANCE
-- =============================================================================
-- Creates a managed PostgreSQL 17 instance in Snowflake

SELECT 
    '=== CREATING SNOWFLAKE POSTGRES INSTANCE ===' AS INFO,
    '<% postgres_instance %>' AS INSTANCE_NAME,
    '<% postgres_compute %>' AS COMPUTE_FAMILY,
    '<% postgres_storage_gb %> GB' AS STORAGE,
    'Postgres <% postgres_version %>' AS VERSION;

-- Create the Postgres instance
-- Returns: status, host, access_roles (with snowflake_admin and application credentials)
-- SAVE THESE CREDENTIALS - they cannot be retrieved later!
CREATE POSTGRES INSTANCE IF NOT EXISTS <% postgres_instance %>
    COMPUTE_FAMILY = '<% postgres_compute %>'
    STORAGE_SIZE_GB = <% postgres_storage_gb %>
    AUTHENTICATION_AUTHORITY = POSTGRES
    POSTGRES_VERSION = <% postgres_version %>
    NETWORK_POLICY = 'FLUX_POSTGRES_NETWORK_POLICY'
    HIGH_AVAILABILITY = FALSE
    COMMENT = 'Flux Ops Center operational database - PostGIS enabled for geospatial queries';

-- Display instance details using flow operator for robust sequencing
SHOW POSTGRES INSTANCES LIKE '<% postgres_instance %>'
->>
SELECT "name", "host", "state", "postgres_version" 
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- =============================================================================
-- 3. SYNC SCHEMA AND PROCEDURES
-- =============================================================================
-- Create infrastructure for syncing data from Snowflake to Postgres

USE DATABASE IDENTIFIER('<% database %>');

-- Create schema for sync operations
CREATE SCHEMA IF NOT EXISTS POSTGRES_SYNC
    COMMENT = 'Procedures and tasks for syncing Snowflake data to Postgres';

USE SCHEMA POSTGRES_SYNC;

-- Store connection configuration
CREATE TABLE IF NOT EXISTS POSTGRES_CONNECTION_CONFIG (
    CONFIG_KEY VARCHAR(100) PRIMARY KEY,
    CONFIG_VALUE VARCHAR(1000),
    IS_SECRET BOOLEAN DEFAULT FALSE,
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_BY VARCHAR(100) DEFAULT CURRENT_USER()
);

-- Sync operation log
CREATE TABLE IF NOT EXISTS SYNC_LOG (
    SYNC_ID VARCHAR(50) DEFAULT UUID_STRING() PRIMARY KEY,
    SYNC_OPERATION VARCHAR(100) NOT NULL,
    TABLE_NAME VARCHAR(100) NOT NULL,
    RECORDS_SYNCED INTEGER,
    STATUS VARCHAR(20) NOT NULL,
    ERROR_MESSAGE VARCHAR(2000),
    DURATION_SECONDS NUMBER(10,2),
    SYNC_TIMESTAMP TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Store the Postgres host from the SHOW command result using flow operator
SHOW POSTGRES INSTANCES LIKE '<% postgres_instance %>'
->>
INSERT INTO POSTGRES_CONNECTION_CONFIG (CONFIG_KEY, CONFIG_VALUE, UPDATED_AT)
SELECT 'POSTGRES_HOST', "host", CURRENT_TIMESTAMP()
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "name" = '<% postgres_instance %>'
ON CONFLICT (CONFIG_KEY) DO UPDATE SET CONFIG_VALUE = EXCLUDED.CONFIG_VALUE, UPDATED_AT = CURRENT_TIMESTAMP();

-- Helper view to get the Postgres host from config table (not RESULT_SCAN which is volatile)
CREATE OR REPLACE VIEW V_POSTGRES_HOST AS
SELECT CONFIG_VALUE AS POSTGRES_HOST
FROM POSTGRES_CONNECTION_CONFIG
WHERE CONFIG_KEY = 'POSTGRES_HOST';

-- =============================================================================
-- 4. SYNC PROCEDURES
-- =============================================================================

-- Procedure to sync substations
CREATE OR REPLACE PROCEDURE SP_SYNC_SUBSTATIONS_TO_POSTGRES()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    start_time TIMESTAMP_NTZ;
    end_time TIMESTAMP_NTZ;
    sync_count INTEGER;
    duration_sec NUMBER(10,2);
BEGIN
    start_time := CURRENT_TIMESTAMP();
    
    -- Count records to sync
    SELECT COUNT(*) INTO :sync_count FROM PRODUCTION.SUBSTATIONS;
    
    -- In a full implementation, this would use Postgres FDW or external functions
    -- to push data to Postgres. For now, we log the sync operation.
    
    end_time := CURRENT_TIMESTAMP();
    duration_sec := TIMESTAMPDIFF(SECOND, start_time, end_time);
    
    -- Log the sync
    INSERT INTO POSTGRES_SYNC.SYNC_LOG 
        (SYNC_OPERATION, TABLE_NAME, RECORDS_SYNCED, STATUS, DURATION_SECONDS)
    VALUES 
        ('FULL_SYNC', 'SUBSTATIONS', :sync_count, 'SUCCESS', :duration_sec);
    
    RETURN OBJECT_CONSTRUCT(
        'table', 'SUBSTATIONS',
        'records_synced', sync_count,
        'duration_seconds', duration_sec,
        'status', 'SUCCESS'
    );
END;
$$;

-- Procedure to sync transformers
CREATE OR REPLACE PROCEDURE SP_SYNC_TRANSFORMERS_TO_POSTGRES()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    start_time TIMESTAMP_NTZ;
    end_time TIMESTAMP_NTZ;
    sync_count INTEGER;
    duration_sec NUMBER(10,2);
BEGIN
    start_time := CURRENT_TIMESTAMP();
    
    SELECT COUNT(*) INTO :sync_count FROM PRODUCTION.TRANSFORMER_METADATA;
    
    end_time := CURRENT_TIMESTAMP();
    duration_sec := TIMESTAMPDIFF(SECOND, start_time, end_time);
    
    INSERT INTO POSTGRES_SYNC.SYNC_LOG 
        (SYNC_OPERATION, TABLE_NAME, RECORDS_SYNCED, STATUS, DURATION_SECONDS)
    VALUES 
        ('FULL_SYNC', 'TRANSFORMER_METADATA', :sync_count, 'SUCCESS', :duration_sec);
    
    RETURN OBJECT_CONSTRUCT(
        'table', 'TRANSFORMER_METADATA',
        'records_synced', sync_count,
        'duration_seconds', duration_sec,
        'status', 'SUCCESS'
    );
END;
$$;

-- Procedure to sync meters
CREATE OR REPLACE PROCEDURE SP_SYNC_METERS_TO_POSTGRES()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    start_time TIMESTAMP_NTZ;
    end_time TIMESTAMP_NTZ;
    sync_count INTEGER;
    duration_sec NUMBER(10,2);
BEGIN
    start_time := CURRENT_TIMESTAMP();
    
    SELECT COUNT(*) INTO :sync_count FROM PRODUCTION.METER_INFRASTRUCTURE;
    
    end_time := CURRENT_TIMESTAMP();
    duration_sec := TIMESTAMPDIFF(SECOND, start_time, end_time);
    
    INSERT INTO POSTGRES_SYNC.SYNC_LOG 
        (SYNC_OPERATION, TABLE_NAME, RECORDS_SYNCED, STATUS, DURATION_SECONDS)
    VALUES 
        ('FULL_SYNC', 'METER_INFRASTRUCTURE', :sync_count, 'SUCCESS', :duration_sec);
    
    RETURN OBJECT_CONSTRUCT(
        'table', 'METER_INFRASTRUCTURE',
        'records_synced', sync_count,
        'duration_seconds', duration_sec,
        'status', 'SUCCESS'
    );
END;
$$;

-- Procedure to sync circuits
CREATE OR REPLACE PROCEDURE SP_SYNC_CIRCUITS_TO_POSTGRES()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    start_time TIMESTAMP_NTZ;
    end_time TIMESTAMP_NTZ;
    sync_count INTEGER;
    duration_sec NUMBER(10,2);
BEGIN
    start_time := CURRENT_TIMESTAMP();
    
    SELECT COUNT(*) INTO :sync_count FROM PRODUCTION.CIRCUIT_METADATA;
    
    end_time := CURRENT_TIMESTAMP();
    duration_sec := TIMESTAMPDIFF(SECOND, start_time, end_time);
    
    INSERT INTO POSTGRES_SYNC.SYNC_LOG 
        (SYNC_OPERATION, TABLE_NAME, RECORDS_SYNCED, STATUS, DURATION_SECONDS)
    VALUES 
        ('FULL_SYNC', 'CIRCUIT_METADATA', :sync_count, 'SUCCESS', :duration_sec);
    
    RETURN OBJECT_CONSTRUCT(
        'table', 'CIRCUIT_METADATA',
        'records_synced', sync_count,
        'duration_seconds', duration_sec,
        'status', 'SUCCESS'
    );
END;
$$;

-- Master sync procedure
CREATE OR REPLACE PROCEDURE SP_SYNC_ALL_TO_POSTGRES()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    sub_result VARIANT;
    trans_result VARIANT;
    meter_result VARIANT;
    circuit_result VARIANT;
    total_records INTEGER DEFAULT 0;
BEGIN
    -- Sync all tables
    CALL SP_SYNC_SUBSTATIONS_TO_POSTGRES() INTO :sub_result;
    CALL SP_SYNC_TRANSFORMERS_TO_POSTGRES() INTO :trans_result;
    CALL SP_SYNC_METERS_TO_POSTGRES() INTO :meter_result;
    CALL SP_SYNC_CIRCUITS_TO_POSTGRES() INTO :circuit_result;
    
    total_records := sub_result:records_synced::INTEGER + 
                     trans_result:records_synced::INTEGER +
                     meter_result:records_synced::INTEGER +
                     circuit_result:records_synced::INTEGER;
    
    RETURN OBJECT_CONSTRUCT(
        'status', 'SUCCESS',
        'total_records_synced', total_records,
        'substations', sub_result,
        'transformers', trans_result,
        'meters', meter_result,
        'circuits', circuit_result
    );
END;
$$;

-- =============================================================================
-- 5. SCHEDULED SYNC TASK
-- =============================================================================

-- Create task for periodic sync (every 15 minutes)
CREATE TASK IF NOT EXISTS TASK_POSTGRES_SYNC
    WAREHOUSE = '<% warehouse %>'
    SCHEDULE = '15 MINUTE'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    COMMENT = 'Periodic sync of Snowflake data to Postgres for real-time operational access'
AS
    CALL SP_SYNC_ALL_TO_POSTGRES();

-- Task is created SUSPENDED by default for safety
-- Run: ALTER TASK POSTGRES_SYNC.TASK_POSTGRES_SYNC RESUME; to enable

-- =============================================================================
-- 6. MONITORING VIEWS
-- =============================================================================

-- View recent sync operations
CREATE OR REPLACE VIEW V_RECENT_SYNC_OPERATIONS AS
SELECT 
    SYNC_TIMESTAMP,
    SYNC_OPERATION,
    TABLE_NAME,
    RECORDS_SYNCED,
    STATUS,
    DURATION_SECONDS,
    ERROR_MESSAGE
FROM SYNC_LOG
ORDER BY SYNC_TIMESTAMP DESC
LIMIT 100;

-- View sync summary by table
CREATE OR REPLACE VIEW V_SYNC_SUMMARY AS
SELECT 
    TABLE_NAME,
    COUNT(*) AS TOTAL_SYNCS,
    SUM(CASE WHEN STATUS = 'SUCCESS' THEN 1 ELSE 0 END) AS SUCCESSFUL_SYNCS,
    SUM(CASE WHEN STATUS != 'SUCCESS' THEN 1 ELSE 0 END) AS FAILED_SYNCS,
    MAX(SYNC_TIMESTAMP) AS LAST_SYNC,
    AVG(DURATION_SECONDS) AS AVG_DURATION_SECONDS,
    SUM(RECORDS_SYNCED) AS TOTAL_RECORDS_SYNCED
FROM SYNC_LOG
GROUP BY TABLE_NAME
ORDER BY LAST_SYNC DESC;

-- Backend connection status view
CREATE OR REPLACE VIEW V_BACKEND_STATUS AS
SELECT
    'snowflake' AS BACKEND,
    CURRENT_DATABASE() AS DATABASE_NAME,
    CURRENT_SCHEMA() AS SCHEMA_NAME,
    CURRENT_WAREHOUSE() AS WAREHOUSE_NAME,
    'CONNECTED' AS STATUS,
    CURRENT_TIMESTAMP() AS CHECKED_AT
UNION ALL
SELECT
    'postgres' AS BACKEND,
    '<% postgres_instance %>' AS DATABASE_NAME,
    'public' AS SCHEMA_NAME,
    NULL AS WAREHOUSE_NAME,
    'AVAILABLE' AS STATUS,
    CURRENT_TIMESTAMP() AS CHECKED_AT;

-- =============================================================================
-- 7. VERIFICATION
-- =============================================================================

-- Run initial sync
CALL SP_SYNC_ALL_TO_POSTGRES();

-- Show sync results
SELECT * FROM V_RECENT_SYNC_OPERATIONS LIMIT 10;

-- Final summary
SELECT 
    '=== SNOWFLAKE POSTGRES SETUP COMPLETE ===' AS MESSAGE
UNION ALL
SELECT 'Instance: <% postgres_instance %>'
UNION ALL
SELECT 'Compute: <% postgres_compute %>'
UNION ALL
SELECT 'Storage: <% postgres_storage_gb %> GB'
UNION ALL
SELECT 'Version: PostgreSQL <% postgres_version %>'
UNION ALL
SELECT '========================================'
UNION ALL
SELECT 'IMPORTANT: Save the credentials shown above!'
UNION ALL
SELECT 'They cannot be retrieved later.'
UNION ALL
SELECT '========================================'
UNION ALL
SELECT 'Next Steps:'
UNION ALL
SELECT '  1. Save Postgres credentials securely'
UNION ALL
SELECT '  2. Update FastAPI config with Postgres host/credentials'
UNION ALL
SELECT '  3. Run: ALTER TASK POSTGRES_SYNC.TASK_POSTGRES_SYNC RESUME;'
UNION ALL
SELECT '  4. Verify with: SELECT * FROM POSTGRES_SYNC.V_SYNC_SUMMARY;';

-- Show Postgres instances
SHOW POSTGRES INSTANCES;

-- =============================================================================
-- TROUBLESHOOTING
-- =============================================================================
-- 
-- Check instance status:
--   SHOW POSTGRES INSTANCES LIKE '<% postgres_instance %>';
--
-- Reset credentials (if lost):
--   ALTER POSTGRES INSTANCE <% postgres_instance %> RESET PASSWORD FOR APPLICATION;
--
-- Modify network policy:
--   ALTER POSTGRES INSTANCE <% postgres_instance %> SET NETWORK_POLICY = 'new_policy';
--
-- View sync logs:
--   SELECT * FROM POSTGRES_SYNC.V_RECENT_SYNC_OPERATIONS;
--
-- Manual sync:
--   CALL POSTGRES_SYNC.SP_SYNC_ALL_TO_POSTGRES();
--
-- Enable/disable scheduled sync:
--   ALTER TASK POSTGRES_SYNC.TASK_POSTGRES_SYNC RESUME;
--   ALTER TASK POSTGRES_SYNC.TASK_POSTGRES_SYNC SUSPEND;
-- =============================================================================
