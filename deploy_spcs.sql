-- Snowflake SPCS Deployment for Flux Operations Center
-- Grid 360 Replacement Platform

-- ============================================
-- PHASE 1: Create Compute Pool (if not exists)
-- ============================================

CREATE COMPUTE POOL IF NOT EXISTS FLUX_OPERATIONS_POOL
  MIN_INSTANCES = 1
  MAX_INSTANCES = 3
  INSTANCE_FAMILY = CPU_X64_M
  AUTO_RESUME = TRUE
  AUTO_SUSPEND_SECS = 600
  COMMENT = 'Compute pool for Flux Operations Center (Grid 360 replacement)';

DESCRIBE COMPUTE POOL FLUX_OPERATIONS_POOL;

-- ============================================
-- PHASE 2: Create Database & Schema Structure
-- ============================================

CREATE DATABASE IF NOT EXISTS GRID_COMMAND_PLATFORM
  COMMENT = 'Snowflake Flux - Grid 360 Replacement Platform';

CREATE SCHEMA IF NOT EXISTS GRID_COMMAND_PLATFORM.CORE
  COMMENT = 'Core asset tables (poles, transformers, meters)';

CREATE SCHEMA IF NOT EXISTS GRID_COMMAND_PLATFORM.CDC
  COMMENT = 'Real-time CDC tables (Hybrid Tables for outages, crews)';

CREATE SCHEMA IF NOT EXISTS GRID_COMMAND_PLATFORM.APPS
  COMMENT = 'Application tables (Dynamic Tables for KPIs, dashboards)';

-- ============================================
-- PHASE 3: Create Test Data Tables
-- ============================================

-- Assets table (core grid infrastructure)
CREATE OR REPLACE TABLE GRID_COMMAND_PLATFORM.CORE.ASSETS (
  asset_id VARCHAR(50) PRIMARY KEY,
  asset_name VARCHAR(200),
  asset_type VARCHAR(50), -- 'pole', 'transformer', 'meter'
  latitude FLOAT,
  longitude FLOAT,
  health_score FLOAT, -- 0-100 (for poles)
  load_percent FLOAT, -- 0-100 (for transformers)
  usage_kwh FLOAT,    -- current usage (for meters)
  last_updated TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  metadata VARIANT
);

-- KPI metrics table (for dashboard)
CREATE OR REPLACE TABLE GRID_COMMAND_PLATFORM.APPS.KPI_METRICS (
  metric_date DATE,
  metric_name VARCHAR(100),
  metric_value FLOAT,
  last_updated TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (metric_date, metric_name)
);

-- Outages Hybrid Table (real-time updates <10ms)
CREATE OR REPLACE HYBRID TABLE GRID_COMMAND_PLATFORM.CDC.OUTAGES_LIVE (
  outage_id VARCHAR(50) PRIMARY KEY,
  latitude FLOAT,
  longitude FLOAT,
  customers_affected INT,
  status VARCHAR(50), -- 'ACTIVE', 'RESTORED'
  start_time TIMESTAMP_NTZ,
  estimated_restoration TIMESTAMP_NTZ,
  last_updated TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ============================================
-- PHASE 4: Populate Test Data
-- ============================================

-- Populate from production data (SI_DEMOS.PRODUCTION)
-- Using real Grid Operations grid assets

-- Insert poles from GRID_POLES_INFRASTRUCTURE
INSERT INTO GRID_COMMAND_PLATFORM.CORE.ASSETS 
  (asset_id, asset_name, asset_type, latitude, longitude, health_score, load_percent, usage_kwh, metadata)
SELECT 
  POLE_ID as asset_id,
  'Pole ' || POLE_ID as asset_name,
  'pole' as asset_type,
  LATITUDE,
  LONGITUDE,
  UNIFORM(60, 100, RANDOM()) as health_score, -- Simulated health score
  NULL as load_percent,
  NULL as usage_kwh,
  OBJECT_CONSTRUCT(
    'location_area', LOCATION_AREA,
    'feeder_id', FEEDER_ID,
    'circuit_id', CIRCUIT_ID,
    'voltage_class', VOLTAGE_CLASS
  ) as metadata
FROM SI_DEMOS.PRODUCTION.GRID_POLES_INFRASTRUCTURE
WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL;

-- Insert transformers from TRANSFORMER_METADATA
INSERT INTO GRID_COMMAND_PLATFORM.CORE.ASSETS 
  (asset_id, asset_name, asset_type, latitude, longitude, health_score, load_percent, usage_kwh, metadata)
SELECT 
  TRANSFORMER_ID as asset_id,
  'Transformer ' || ASSET_ID as asset_name,
  'transformer' as asset_type,
  LATITUDE,
  LONGITUDE,
  NULL as health_score,
  UNIFORM(40, 95, RANDOM()) as load_percent, -- Simulated load
  NULL as usage_kwh,
  OBJECT_CONSTRUCT(
    'rated_kva', RATED_KVA,
    'substation_id', SUBSTATION_ID,
    'feeder_id', FEEDER_ID,
    'install_year', INSTALL_YEAR,
    'age_years', AGE_YEARS
  ) as metadata
FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA
WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL;

-- Insert meters from METER_INFRASTRUCTURE
INSERT INTO GRID_COMMAND_PLATFORM.CORE.ASSETS 
  (asset_id, asset_name, asset_type, latitude, longitude, health_score, load_percent, usage_kwh, metadata)
SELECT 
  METER_ID as asset_id,
  'Meter ' || METER_ID as asset_name,
  'meter' as asset_type,
  METER_LATITUDE as latitude,
  METER_LONGITUDE as longitude,
  NULL as health_score,
  NULL as load_percent,
  UNIFORM(10, 50, RANDOM()) as usage_kwh, -- Simulated current usage
  OBJECT_CONSTRUCT(
    'transformer_id', TRANSFORMER_ID,
    'circuit_id', CIRCUIT_ID,
    'substation_id', SUBSTATION_ID,
    'city', CITY,
    'zip_code', ZIP_CODE
  ) as metadata
FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE
WHERE METER_LATITUDE IS NOT NULL AND METER_LONGITUDE IS NOT NULL;

-- Insert KPI metrics
INSERT INTO GRID_COMMAND_PLATFORM.APPS.KPI_METRICS 
  (metric_date, metric_name, metric_value)
VALUES
  (CURRENT_DATE(), 'SAIDI', 152.3),
  (CURRENT_DATE(), 'SAIFI', 1.42),
  (CURRENT_DATE(), 'ACTIVE_OUTAGES', 8),
  (CURRENT_DATE(), 'TOTAL_LOAD_MW', 2874),
  (CURRENT_DATE(), 'CREWS_ACTIVE', 12);

-- Insert sample outages
INSERT INTO GRID_COMMAND_PLATFORM.CDC.OUTAGES_LIVE 
  (outage_id, latitude, longitude, customers_affected, status, start_time, estimated_restoration)
VALUES
  ('OUT-001', 29.7604, -95.3698, 1200, 'ACTIVE', CURRENT_TIMESTAMP(), DATEADD(hour, 2, CURRENT_TIMESTAMP())),
  ('OUT-002', 29.7804, -95.3898, 450, 'ACTIVE', CURRENT_TIMESTAMP(), DATEADD(hour, 1, CURRENT_TIMESTAMP())),
  ('OUT-003', 29.7404, -95.3498, 850, 'ACTIVE', CURRENT_TIMESTAMP(), DATEADD(hour, 3, CURRENT_TIMESTAMP()));

-- ============================================
-- PHASE 5: Create Image Repository
-- ============================================

CREATE IMAGE REPOSITORY IF NOT EXISTS SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER_REPO
  COMMENT = 'Docker image repository for Flux Operations Center';

SHOW IMAGE REPOSITORIES IN SCHEMA SI_DEMOS.APPLICATIONS;

-- ============================================
-- PHASE 6: Create SPCS Service Specification
-- ============================================

-- Note: Build and push Docker image first using:
--
-- docker build -t flux-ops-center:latest .
-- docker tag flux-ops-center:latest GZB42423.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center:latest
-- docker push GZB42423.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center:latest
--
-- Then create service:

CREATE SERVICE IF NOT EXISTS SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER
  IN COMPUTE POOL FLUX_OPERATIONS_POOL
  FROM SPECIFICATION $$
    spec:
      containers:
      - name: frontend
        image: /SI_DEMOS/APPLICATIONS/flux_ops_center:latest
        env:
          SNOWFLAKE_ACCOUNT: GZB42423
          SNOWFLAKE_DATABASE: GRID_COMMAND_PLATFORM
          SNOWFLAKE_SCHEMA: CORE
          SNOWFLAKE_WAREHOUSE: GRID_COMMAND_REALTIME_WH
          NODE_ENV: production
        resources:
          requests:
            memory: 2Gi
            cpu: 1
          limits:
            memory: 4Gi
            cpu: 2
        readinessProbe:
          port: 8080
          path: /
      endpoints:
      - name: web
        port: 8080
        public: true
  $$
  MIN_INSTANCES = 1
  MAX_INSTANCES = 3
  AUTO_SUSPEND_SECS = 600
  COMMENT = 'Flux Operations Center - Grid 360 Replacement';

-- ============================================
-- PHASE 7: Get Service Status & Endpoint
-- ============================================

SHOW SERVICES IN SCHEMA SI_DEMOS.APPLICATIONS;

DESCRIBE SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER;

SHOW ENDPOINTS IN SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER;

-- ============================================
-- PHASE 8: Service Management Commands
-- ============================================

-- View service logs
CALL SYSTEM$GET_SERVICE_LOGS('SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER', 0, 'frontend', 100);

-- Check service status
CALL SYSTEM$GET_SERVICE_STATUS('SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER');

-- Suspend service (for maintenance)
-- ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER SUSPEND;

-- Resume service
-- ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER RESUME;

-- Drop service (for redeployment)
-- DROP SERVICE IF EXISTS SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER;

-- ============================================
-- PHASE 9: Grant Access (if needed)
-- ============================================

-- Grant usage on compute pool
GRANT USAGE ON COMPUTE POOL FLUX_OPERATIONS_POOL TO ROLE ACCOUNTADMIN;

-- Grant access to service
GRANT USAGE ON SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER TO ROLE ACCOUNTADMIN;

-- Grant access to database/schemas
GRANT USAGE ON DATABASE GRID_COMMAND_PLATFORM TO ROLE ACCOUNTADMIN;
GRANT USAGE ON SCHEMA GRID_COMMAND_PLATFORM.CORE TO ROLE ACCOUNTADMIN;
GRANT USAGE ON SCHEMA GRID_COMMAND_PLATFORM.CDC TO ROLE ACCOUNTADMIN;
GRANT USAGE ON SCHEMA GRID_COMMAND_PLATFORM.APPS TO ROLE ACCOUNTADMIN;

-- Grant SELECT on tables
GRANT SELECT ON ALL TABLES IN SCHEMA GRID_COMMAND_PLATFORM.CORE TO ROLE ACCOUNTADMIN;
GRANT SELECT ON ALL TABLES IN SCHEMA GRID_COMMAND_PLATFORM.CDC TO ROLE ACCOUNTADMIN;
GRANT SELECT ON ALL TABLES IN SCHEMA GRID_COMMAND_PLATFORM.APPS TO ROLE ACCOUNTADMIN;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check asset counts
SELECT asset_type, COUNT(*) as count
FROM GRID_COMMAND_PLATFORM.CORE.ASSETS
GROUP BY asset_type;

-- Check KPIs
SELECT * FROM GRID_COMMAND_PLATFORM.APPS.KPI_METRICS
ORDER BY metric_name;

-- Check active outages
SELECT * FROM GRID_COMMAND_PLATFORM.CDC.OUTAGES_LIVE
WHERE status = 'ACTIVE'
ORDER BY customers_affected DESC;

-- Sample query for map data
SELECT 
  asset_id,
  asset_name,
  asset_type,
  latitude,
  longitude,
  health_score,
  load_percent,
  usage_kwh
FROM GRID_COMMAND_PLATFORM.CORE.ASSETS
WHERE latitude BETWEEN 29.68 AND 29.84
  AND longitude BETWEEN -95.45 AND -95.29
LIMIT 1000;
