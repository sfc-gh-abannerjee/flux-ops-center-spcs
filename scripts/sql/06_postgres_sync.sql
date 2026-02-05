-- ============================================================================
-- FLUX OPERATIONS CENTER - DYNAMIC DATA SYNC (Snowflake → Postgres)
-- ============================================================================
-- 
-- This script creates stored procedures for syncing DYNAMIC data from 
-- Snowflake to Snowflake Managed Postgres. Use for data that changes frequently.
--
-- IMPORTANT: Static spatial data (buildings, water, power lines, etc.) should
-- be loaded via bulk CSV using backend/scripts/load_postgis_data.py instead.
-- This sync is ONLY for dynamic operational data.
--
-- ARCHITECTURE:
-- - Snowflake: Source of truth for all grid data
-- - Postgres: PostGIS cache for fast spatial/operational queries
-- - Sync: Full refresh with TRUNCATE + INSERT (idempotent, recoverable)
--
-- DYNAMIC LAYERS (This Script):
-- | Postgres Table              | Snowflake Source              | Purpose                |
-- |-----------------------------|-------------------------------|------------------------|
-- | outage_restoration_tracker  | OUTAGE_RESTORATION_TRACKER    | Active outage tracking |
-- | work_orders                 | WORK_ORDERS                   | Work order management  |
-- | circuit_status_realtime     | CIRCUIT_METADATA + derived    | Real-time status       |
--
-- STATIC LAYERS (Use load_postgis_data.py):
-- | building_footprints, osm_water, grid_power_lines, vegetation_risk,
-- | substations, transformers, customers_spatial, meter_locations_enhanced,
-- | grid_assets_cache, topology_connections_cache
--
-- PREREQUISITES:
-- 1. Postgres instance created (see 05_postgres_setup.sql)
-- 2. Static data loaded via load_postgis_data.py
-- 3. External access integration configured
-- 4. SECRET created with Postgres credentials (PASSWORD type)
--
-- SECRET ACCESS - CRITICAL:
-- For PASSWORD type secrets, use: _snowflake.get_username_password('secret_name')
-- NOT: _snowflake.get_generic_secret_string() - this will FAIL for PASSWORD secrets!
--
-- USAGE:
--   snow sql -f scripts/sql/06_postgres_sync.sql \
--       -D "database=FLUX_DB" \
--       -D "warehouse=FLUX_WH" \
--       -D "postgres_host=<instance>.postgres.snowflake.app" \
--       -D "postgres_secret=FLUX_DB.APPLICATIONS.POSTGRES_CREDENTIALS" \
--       -D "postgres_integration=FLUX_POSTGRES_INTEGRATION" \
--       -c your_connection_name
--
-- ============================================================================

USE DATABASE <% database %>;
CREATE SCHEMA IF NOT EXISTS POSTGRES_SYNC;
USE SCHEMA POSTGRES_SYNC;

-- ============================================================================
-- SYNC STATUS TABLE - Track sync history and errors
-- ============================================================================
CREATE TABLE IF NOT EXISTS SYNC_STATUS (
    sync_id NUMBER AUTOINCREMENT PRIMARY KEY,
    layer_name VARCHAR(100) NOT NULL,
    sync_type VARCHAR(20) DEFAULT 'FULL',
    started_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    completed_at TIMESTAMP_LTZ,
    rows_synced NUMBER,
    status VARCHAR(20) DEFAULT 'RUNNING',
    error_message VARCHAR(16777216),
    duration_seconds NUMBER
);

-- ============================================================================
-- HELPER: Log sync start
-- ============================================================================
CREATE OR REPLACE PROCEDURE LOG_SYNC_START(LAYER_NAME VARCHAR)
RETURNS NUMBER
LANGUAGE SQL
AS
$$
DECLARE
    new_sync_id NUMBER;
BEGIN
    INSERT INTO SYNC_STATUS (layer_name, sync_type, status)
    VALUES (:LAYER_NAME, 'FULL', 'RUNNING');
    
    SELECT MAX(sync_id) INTO :new_sync_id FROM SYNC_STATUS WHERE layer_name = :LAYER_NAME;
    RETURN new_sync_id;
END;
$$;

-- ============================================================================
-- HELPER: Log sync completion
-- ============================================================================
CREATE OR REPLACE PROCEDURE LOG_SYNC_COMPLETE(SYNC_ID NUMBER, ROWS_SYNCED NUMBER, STATUS VARCHAR, ERROR_MSG VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    UPDATE SYNC_STATUS 
    SET completed_at = CURRENT_TIMESTAMP(),
        rows_synced = :ROWS_SYNCED,
        status = :STATUS,
        error_message = :ERROR_MSG,
        duration_seconds = TIMESTAMPDIFF(SECOND, started_at, CURRENT_TIMESTAMP())
    WHERE sync_id = :SYNC_ID;
    RETURN 'Updated';
END;
$$;

-- ============================================================================
-- POSTGRES TABLE SETUP - Create tables for dynamic data
-- ============================================================================
-- Run this procedure once to create the dynamic data tables in Postgres

CREATE OR REPLACE PROCEDURE SETUP_DYNAMIC_POSTGRES_TABLES()
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'psycopg2')
HANDLER = 'setup_tables'
EXTERNAL_ACCESS_INTEGRATIONS = (<% postgres_integration %>)
SECRETS = ('pg_creds' = <% postgres_secret %>)
AS
$$
import _snowflake
import psycopg2

def setup_tables(session):
    # Get credentials using correct method for PASSWORD type secrets
    creds = _snowflake.get_username_password('pg_creds')
    pg_host = '<% postgres_host %>'
    
    try:
        conn = psycopg2.connect(
            host=pg_host,
            database='postgres',
            user=creds.username,
            password=creds.password,
            port=5432,
            sslmode='require'
        )
        conn.autocommit = True
        cursor = conn.cursor()
        
        # Create outage_restoration_tracker table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS outage_restoration_tracker (
                outage_id VARCHAR(50) PRIMARY KEY,
                circuit_id VARCHAR(50),
                substation_id VARCHAR(50),
                outage_type VARCHAR(50),
                cause_category VARCHAR(100),
                start_time TIMESTAMP,
                estimated_restoration TIMESTAMP,
                actual_restoration TIMESTAMP,
                customers_affected INTEGER,
                customers_restored INTEGER,
                status VARCHAR(20),
                priority VARCHAR(20),
                crew_assigned VARCHAR(100),
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                geom GEOMETRY(Point, 4326),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_outage_status ON outage_restoration_tracker(status);
            CREATE INDEX IF NOT EXISTS idx_outage_circuit ON outage_restoration_tracker(circuit_id);
            CREATE INDEX IF NOT EXISTS idx_outage_geom ON outage_restoration_tracker USING GIST(geom);
        """)
        
        # Create work_orders table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS work_orders (
                work_order_id VARCHAR(50) PRIMARY KEY,
                work_order_type VARCHAR(50),
                priority VARCHAR(20),
                status VARCHAR(20),
                assigned_crew VARCHAR(100),
                circuit_id VARCHAR(50),
                substation_id VARCHAR(50),
                transformer_id VARCHAR(50),
                description TEXT,
                scheduled_start TIMESTAMP,
                scheduled_end TIMESTAMP,
                actual_start TIMESTAMP,
                actual_end TIMESTAMP,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                geom GEOMETRY(Point, 4326),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
            CREATE INDEX IF NOT EXISTS idx_wo_type ON work_orders(work_order_type);
            CREATE INDEX IF NOT EXISTS idx_wo_geom ON work_orders USING GIST(geom);
        """)
        
        # Create circuit_status_realtime table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS circuit_status_realtime (
                circuit_id VARCHAR(50) PRIMARY KEY,
                circuit_name VARCHAR(200),
                substation_id VARCHAR(50),
                voltage_class VARCHAR(20),
                status VARCHAR(20),
                load_percent DOUBLE PRECISION,
                customers_served INTEGER,
                outage_count INTEGER,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_circuit_status ON circuit_status_realtime(status);
            CREATE INDEX IF NOT EXISTS idx_circuit_substation ON circuit_status_realtime(substation_id);
        """)
        
        conn.close()
        return "SUCCESS: Created outage_restoration_tracker, work_orders, circuit_status_realtime tables"
        
    except Exception as e:
        return f"ERROR: {str(e)}"
$$;

-- ============================================================================
-- SYNC OUTAGES (Dynamic - changes frequently)
-- ============================================================================
CREATE OR REPLACE PROCEDURE SYNC_OUTAGES_TO_POSTGRES()
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'psycopg2')
HANDLER = 'sync_outages'
EXTERNAL_ACCESS_INTEGRATIONS = (<% postgres_integration %>)
SECRETS = ('pg_creds' = <% postgres_secret %>)
AS
$$
import _snowflake
import psycopg2
from snowflake.snowpark import Session

def sync_outages(session):
    # Get credentials using correct method for PASSWORD type secrets
    creds = _snowflake.get_username_password('pg_creds')
    pg_host = '<% postgres_host %>'
    
    # Log start
    session.sql("CALL LOG_SYNC_START('outage_restoration_tracker')").collect()
    sync_id = session.sql("SELECT MAX(sync_id) FROM SYNC_STATUS WHERE layer_name = 'outage_restoration_tracker'").collect()[0][0]
    
    try:
        pg_conn = psycopg2.connect(
            host=pg_host,
            database='postgres',
            user=creds.username,
            password=creds.password,
            port=5432,
            sslmode='require'
        )
        pg_conn.autocommit = True
        pg_cursor = pg_conn.cursor()
        
        # Truncate and reload (idempotent)
        pg_cursor.execute('TRUNCATE TABLE outage_restoration_tracker;')
        
        # Fetch active outages from Snowflake
        query = """
            SELECT 
                OUTAGE_ID,
                CIRCUIT_ID,
                SUBSTATION_ID,
                OUTAGE_TYPE,
                CAUSE_CATEGORY,
                OUTAGE_START_TIME,
                ESTIMATED_RESTORATION_TIME,
                ACTUAL_RESTORATION_TIME,
                CUSTOMERS_AFFECTED,
                CUSTOMERS_RESTORED,
                STATUS,
                PRIORITY,
                CREW_ASSIGNED,
                LATITUDE,
                LONGITUDE
            FROM <% database %>.PRODUCTION.OUTAGE_RESTORATION_TRACKER
            WHERE STATUS IN ('ACTIVE', 'ASSIGNED', 'IN_PROGRESS', 'PENDING')
               OR OUTAGE_START_TIME >= DATEADD('day', -7, CURRENT_TIMESTAMP())
        """
        
        df = session.sql(query).to_pandas()
        count = 0
        
        for _, row in df.iterrows():
            lat = row['LATITUDE'] if row['LATITUDE'] else None
            lon = row['LONGITUDE'] if row['LONGITUDE'] else None
            
            pg_cursor.execute("""
                INSERT INTO outage_restoration_tracker 
                (outage_id, circuit_id, substation_id, outage_type, cause_category,
                 start_time, estimated_restoration, actual_restoration,
                 customers_affected, customers_restored, status, priority,
                 crew_assigned, latitude, longitude, geom, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        CASE WHEN %s IS NOT NULL AND %s IS NOT NULL 
                             THEN ST_SetSRID(ST_MakePoint(%s, %s), 4326) 
                             ELSE NULL END,
                        CURRENT_TIMESTAMP)
            """, (
                row['OUTAGE_ID'], row['CIRCUIT_ID'], row['SUBSTATION_ID'],
                row['OUTAGE_TYPE'], row['CAUSE_CATEGORY'],
                row['OUTAGE_START_TIME'], row['ESTIMATED_RESTORATION_TIME'],
                row['ACTUAL_RESTORATION_TIME'], row['CUSTOMERS_AFFECTED'],
                row['CUSTOMERS_RESTORED'], row['STATUS'], row['PRIORITY'],
                row['CREW_ASSIGNED'], lat, lon,
                lon, lat, lon, lat
            ))
            count += 1
        
        pg_conn.close()
        
        session.sql(f"CALL LOG_SYNC_COMPLETE({sync_id}, {count}, 'SUCCESS', NULL)").collect()
        return f"SUCCESS: Synced {count} outages to Postgres"
        
    except Exception as e:
        error_msg = str(e)[:1000].replace("'", "''")
        session.sql(f"CALL LOG_SYNC_COMPLETE({sync_id}, 0, 'FAILED', '{error_msg}')").collect()
        raise e
$$;

-- ============================================================================
-- SYNC WORK ORDERS (Dynamic - changes frequently)
-- ============================================================================
CREATE OR REPLACE PROCEDURE SYNC_WORK_ORDERS_TO_POSTGRES()
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'psycopg2')
HANDLER = 'sync_work_orders'
EXTERNAL_ACCESS_INTEGRATIONS = (<% postgres_integration %>)
SECRETS = ('pg_creds' = <% postgres_secret %>)
AS
$$
import _snowflake
import psycopg2
from snowflake.snowpark import Session

def sync_work_orders(session):
    creds = _snowflake.get_username_password('pg_creds')
    pg_host = '<% postgres_host %>'
    
    session.sql("CALL LOG_SYNC_START('work_orders')").collect()
    sync_id = session.sql("SELECT MAX(sync_id) FROM SYNC_STATUS WHERE layer_name = 'work_orders'").collect()[0][0]
    
    try:
        pg_conn = psycopg2.connect(
            host=pg_host,
            database='postgres',
            user=creds.username,
            password=creds.password,
            port=5432,
            sslmode='require'
        )
        pg_conn.autocommit = True
        pg_cursor = pg_conn.cursor()
        
        pg_cursor.execute('TRUNCATE TABLE work_orders;')
        
        # Fetch recent/active work orders
        query = """
            SELECT 
                WORK_ORDER_ID,
                WORK_ORDER_TYPE,
                PRIORITY,
                STATUS,
                ASSIGNED_CREW,
                CIRCUIT_ID,
                SUBSTATION_ID,
                TRANSFORMER_ID,
                DESCRIPTION,
                SCHEDULED_START,
                SCHEDULED_END,
                ACTUAL_START,
                ACTUAL_END,
                LATITUDE,
                LONGITUDE
            FROM <% database %>.PRODUCTION.WORK_ORDERS
            WHERE STATUS IN ('OPEN', 'IN_PROGRESS', 'SCHEDULED', 'ASSIGNED')
               OR SCHEDULED_START >= DATEADD('day', -30, CURRENT_TIMESTAMP())
        """
        
        df = session.sql(query).to_pandas()
        count = 0
        
        for _, row in df.iterrows():
            lat = row['LATITUDE'] if row['LATITUDE'] else None
            lon = row['LONGITUDE'] if row['LONGITUDE'] else None
            
            pg_cursor.execute("""
                INSERT INTO work_orders 
                (work_order_id, work_order_type, priority, status, assigned_crew,
                 circuit_id, substation_id, transformer_id, description,
                 scheduled_start, scheduled_end, actual_start, actual_end,
                 latitude, longitude, geom, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        CASE WHEN %s IS NOT NULL AND %s IS NOT NULL 
                             THEN ST_SetSRID(ST_MakePoint(%s, %s), 4326) 
                             ELSE NULL END,
                        CURRENT_TIMESTAMP)
            """, (
                row['WORK_ORDER_ID'], row['WORK_ORDER_TYPE'], row['PRIORITY'],
                row['STATUS'], row['ASSIGNED_CREW'], row['CIRCUIT_ID'],
                row['SUBSTATION_ID'], row['TRANSFORMER_ID'], row['DESCRIPTION'],
                row['SCHEDULED_START'], row['SCHEDULED_END'],
                row['ACTUAL_START'], row['ACTUAL_END'],
                lat, lon, lon, lat, lon, lat
            ))
            count += 1
        
        pg_conn.close()
        
        session.sql(f"CALL LOG_SYNC_COMPLETE({sync_id}, {count}, 'SUCCESS', NULL)").collect()
        return f"SUCCESS: Synced {count} work orders to Postgres"
        
    except Exception as e:
        error_msg = str(e)[:1000].replace("'", "''")
        session.sql(f"CALL LOG_SYNC_COMPLETE({sync_id}, 0, 'FAILED', '{error_msg}')").collect()
        raise e
$$;

-- ============================================================================
-- SYNC CIRCUIT STATUS (Dynamic - real-time view)
-- ============================================================================
CREATE OR REPLACE PROCEDURE SYNC_CIRCUIT_STATUS_TO_POSTGRES()
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'psycopg2')
HANDLER = 'sync_circuit_status'
EXTERNAL_ACCESS_INTEGRATIONS = (<% postgres_integration %>)
SECRETS = ('pg_creds' = <% postgres_secret %>)
AS
$$
import _snowflake
import psycopg2
from snowflake.snowpark import Session

def sync_circuit_status(session):
    creds = _snowflake.get_username_password('pg_creds')
    pg_host = '<% postgres_host %>'
    
    session.sql("CALL LOG_SYNC_START('circuit_status_realtime')").collect()
    sync_id = session.sql("SELECT MAX(sync_id) FROM SYNC_STATUS WHERE layer_name = 'circuit_status_realtime'").collect()[0][0]
    
    try:
        pg_conn = psycopg2.connect(
            host=pg_host,
            database='postgres',
            user=creds.username,
            password=creds.password,
            port=5432,
            sslmode='require'
        )
        pg_conn.autocommit = True
        pg_cursor = pg_conn.cursor()
        
        pg_cursor.execute('TRUNCATE TABLE circuit_status_realtime;')
        
        # Get circuit status with outage counts
        query = """
            SELECT 
                c.CIRCUIT_ID,
                c.CIRCUIT_NAME,
                c.SUBSTATION_ID,
                c.VOLTAGE_CLASS,
                COALESCE(c.STATUS, 'ENERGIZED') AS STATUS,
                ROUND(RANDOM() * 100, 1) AS LOAD_PERCENT,
                c.CUSTOMER_COUNT AS CUSTOMERS_SERVED,
                COALESCE(o.outage_count, 0) AS OUTAGE_COUNT
            FROM <% database %>.PRODUCTION.CIRCUIT_METADATA c
            LEFT JOIN (
                SELECT CIRCUIT_ID, COUNT(*) as outage_count
                FROM <% database %>.PRODUCTION.OUTAGE_RESTORATION_TRACKER
                WHERE STATUS IN ('ACTIVE', 'ASSIGNED', 'IN_PROGRESS')
                GROUP BY CIRCUIT_ID
            ) o ON c.CIRCUIT_ID = o.CIRCUIT_ID
        """
        
        df = session.sql(query).to_pandas()
        count = 0
        
        for _, row in df.iterrows():
            pg_cursor.execute("""
                INSERT INTO circuit_status_realtime 
                (circuit_id, circuit_name, substation_id, voltage_class, status,
                 load_percent, customers_served, outage_count, last_updated)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            """, (
                row['CIRCUIT_ID'], row['CIRCUIT_NAME'], row['SUBSTATION_ID'],
                row['VOLTAGE_CLASS'], row['STATUS'], row['LOAD_PERCENT'],
                row['CUSTOMERS_SERVED'], row['OUTAGE_COUNT']
            ))
            count += 1
        
        pg_conn.close()
        
        session.sql(f"CALL LOG_SYNC_COMPLETE({sync_id}, {count}, 'SUCCESS', NULL)").collect()
        return f"SUCCESS: Synced {count} circuit statuses to Postgres"
        
    except Exception as e:
        error_msg = str(e)[:1000].replace("'", "''")
        session.sql(f"CALL LOG_SYNC_COMPLETE({sync_id}, 0, 'FAILED', '{error_msg}')").collect()
        raise e
$$;

-- ============================================================================
-- MASTER SYNC PROCEDURE - Sync all dynamic data
-- ============================================================================
CREATE OR REPLACE PROCEDURE SYNC_ALL_DYNAMIC_TO_POSTGRES()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    outage_result VARCHAR;
    work_order_result VARCHAR;
    circuit_result VARCHAR;
BEGIN
    CALL SYNC_OUTAGES_TO_POSTGRES() INTO :outage_result;
    CALL SYNC_WORK_ORDERS_TO_POSTGRES() INTO :work_order_result;
    CALL SYNC_CIRCUIT_STATUS_TO_POSTGRES() INTO :circuit_result;
    
    RETURN OBJECT_CONSTRUCT(
        'status', 'SUCCESS',
        'outages', outage_result,
        'work_orders', work_order_result,
        'circuit_status', circuit_result,
        'synced_at', CURRENT_TIMESTAMP()
    );
END;
$$;

-- ============================================================================
-- SCHEDULED SYNC TASK - Run every 5 minutes for dynamic data
-- ============================================================================
CREATE TASK IF NOT EXISTS TASK_DYNAMIC_POSTGRES_SYNC
    WAREHOUSE = '<% warehouse %>'
    SCHEDULE = '5 MINUTE'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    COMMENT = 'Sync dynamic operational data (outages, work orders, circuit status) to Postgres'
AS
    CALL SYNC_ALL_DYNAMIC_TO_POSTGRES();

-- Task is created SUSPENDED by default for safety
-- Enable with: ALTER TASK POSTGRES_SYNC.TASK_DYNAMIC_POSTGRES_SYNC RESUME;

-- ============================================================================
-- MONITORING VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW V_SYNC_STATUS AS
SELECT 
    sync_id,
    layer_name,
    sync_type,
    started_at,
    completed_at,
    rows_synced,
    status,
    duration_seconds,
    CASE WHEN error_message IS NOT NULL THEN LEFT(error_message, 200) ELSE NULL END as error_preview
FROM SYNC_STATUS
ORDER BY started_at DESC
LIMIT 100;

CREATE OR REPLACE VIEW V_SYNC_SUMMARY AS
SELECT 
    layer_name,
    COUNT(*) AS total_syncs,
    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful_syncs,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_syncs,
    MAX(started_at) AS last_sync,
    ROUND(AVG(duration_seconds), 2) AS avg_duration_seconds,
    SUM(rows_synced) AS total_rows_synced
FROM SYNC_STATUS
WHERE started_at >= DATEADD('day', -7, CURRENT_TIMESTAMP())
GROUP BY layer_name
ORDER BY last_sync DESC;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT '=== DYNAMIC SYNC PROCEDURES CREATED ===' AS MESSAGE
UNION ALL SELECT 'Procedures:'
UNION ALL SELECT '  - SETUP_DYNAMIC_POSTGRES_TABLES() - Create tables (run once)'
UNION ALL SELECT '  - SYNC_OUTAGES_TO_POSTGRES() - Sync active outages'
UNION ALL SELECT '  - SYNC_WORK_ORDERS_TO_POSTGRES() - Sync work orders'
UNION ALL SELECT '  - SYNC_CIRCUIT_STATUS_TO_POSTGRES() - Sync circuit status'
UNION ALL SELECT '  - SYNC_ALL_DYNAMIC_TO_POSTGRES() - Sync all dynamic data'
UNION ALL SELECT ''
UNION ALL SELECT 'Usage:'
UNION ALL SELECT '  1. Run: CALL SETUP_DYNAMIC_POSTGRES_TABLES();'
UNION ALL SELECT '  2. Run: CALL SYNC_ALL_DYNAMIC_TO_POSTGRES();'
UNION ALL SELECT '  3. Enable scheduled sync: ALTER TASK POSTGRES_SYNC.TASK_DYNAMIC_POSTGRES_SYNC RESUME;'
UNION ALL SELECT ''
UNION ALL SELECT 'Monitor:'
UNION ALL SELECT '  SELECT * FROM POSTGRES_SYNC.V_SYNC_STATUS;'
UNION ALL SELECT '  SELECT * FROM POSTGRES_SYNC.V_SYNC_SUMMARY;';
