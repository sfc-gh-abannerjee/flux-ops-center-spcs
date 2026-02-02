-- =============================================================================
-- Flux Operations Center - Deploy from Git
-- =============================================================================
-- Deploys Flux Operations Center infrastructure by executing SQL files
-- directly from the Git repository.
--
-- Prerequisites:
--   - Run setup_git_integration.sql first
--   - Git repository must be fetched
--
-- Note: Flux Ops Center is primarily deployed via Docker/SPCS, but this
-- script can set up supporting infrastructure.
-- =============================================================================

-- Configuration
SET database_name = 'FLUX_OPS_CENTER';
SET schema_name = 'PUBLIC';
SET git_repo_name = 'FLUX_OPS_CENTER_REPO';
SET warehouse_name = 'FLUX_OPS_CENTER_WH';
SET compute_pool_name = 'FLUX_OPS_CENTER_POOL';
SET image_repo_name = 'FLUX_OPS_CENTER_IMAGES';
SET service_name = 'FLUX_OPS_CENTER_SERVICE';

-- Fetch latest from remote
ALTER GIT REPOSITORY IDENTIFIER($git_repo_name) FETCH;

-- =============================================================================
-- 1. DATABASE & SCHEMA SETUP
-- =============================================================================

CREATE DATABASE IF NOT EXISTS IDENTIFIER($database_name)
    DATA_RETENTION_TIME_IN_DAYS = 7
    COMMENT = 'Database for Flux Operations Center';

USE DATABASE IDENTIFIER($database_name);

CREATE SCHEMA IF NOT EXISTS IDENTIFIER($schema_name)
    COMMENT = 'Schema for Flux Operations Center';

USE SCHEMA IDENTIFIER($schema_name);

-- Create warehouse
CREATE WAREHOUSE IF NOT EXISTS IDENTIFIER($warehouse_name)
    WAREHOUSE_SIZE = 'XSMALL'
    AUTO_SUSPEND = 60
    AUTO_RESUME = TRUE
    INITIALLY_SUSPENDED = TRUE
    COMMENT = 'Warehouse for Flux Operations Center';

USE WAREHOUSE IDENTIFIER($warehouse_name);

-- =============================================================================
-- 2. IMAGE REPOSITORY
-- =============================================================================

CREATE IMAGE REPOSITORY IF NOT EXISTS IDENTIFIER($image_repo_name)
    COMMENT = 'Image repository for Flux Operations Center';

SHOW IMAGE REPOSITORIES LIKE $image_repo_name;

-- =============================================================================
-- 3. COMPUTE POOL
-- =============================================================================

CREATE COMPUTE POOL IF NOT EXISTS IDENTIFIER($compute_pool_name)
    MIN_NODES = 1
    MAX_NODES = 2
    INSTANCE_FAMILY = CPU_X64_S
    AUTO_RESUME = TRUE
    AUTO_SUSPEND_SECS = 300
    COMMENT = 'Compute pool for Flux Operations Center';

DESCRIBE COMPUTE POOL IDENTIFIER($compute_pool_name);

-- =============================================================================
-- 4. GRID INFRASTRUCTURE TABLES
-- =============================================================================

-- Substations table
CREATE TABLE IF NOT EXISTS SUBSTATIONS (
    SUBSTATION_ID VARCHAR(50) NOT NULL,
    NAME VARCHAR(200),
    LATITUDE FLOAT,
    LONGITUDE FLOAT,
    VOLTAGE_KV FLOAT,
    CAPACITY_MVA FLOAT,
    STATUS VARCHAR(20) DEFAULT 'ACTIVE'
)
COMMENT = 'Grid substations for Flux Operations Center';

-- Transformers table
CREATE TABLE IF NOT EXISTS TRANSFORMERS (
    TRANSFORMER_ID VARCHAR(50) NOT NULL,
    SUBSTATION_ID VARCHAR(50),
    LATITUDE FLOAT,
    LONGITUDE FLOAT,
    CAPACITY_KVA FLOAT,
    AGE_YEARS INTEGER,
    RISK_SCORE FLOAT,
    LAST_MAINTENANCE DATE
)
COMMENT = 'Grid transformers for visualization and risk analysis';

-- Power lines table
CREATE TABLE IF NOT EXISTS POWER_LINES (
    LINE_ID VARCHAR(50) NOT NULL,
    FROM_NODE VARCHAR(50),
    TO_NODE VARCHAR(50),
    VOLTAGE_KV FLOAT,
    LENGTH_KM FLOAT,
    GEOMETRY GEOGRAPHY
)
COMMENT = 'Grid power lines for visualization';

-- =============================================================================
-- 5. CREATE SERVICE (after Docker image is pushed)
-- =============================================================================
-- IMPORTANT: Push the Docker image first!
--   docker login <registry_url>
--   docker build -t flux_ops_center:latest -f Dockerfile.spcs .
--   docker push <repository_url>/flux_ops_center:latest

/*
CREATE SERVICE IF NOT EXISTS IDENTIFIER($service_name)
    IN COMPUTE POOL IDENTIFIER($compute_pool_name)
    FROM SPECIFICATION $$
spec:
  containers:
    - name: flux-ops-center
      image: /FLUX_OPS_CENTER/PUBLIC/FLUX_OPS_CENTER_IMAGES/flux_ops_center:latest
      resources:
        requests:
          cpu: 2
          memory: 4Gi
        limits:
          cpu: 4
          memory: 8Gi
  endpoints:
    - name: app
      port: 8080
      public: true
$$
    COMMENT = 'Flux Operations Center - Grid Visualization & GNN Risk Prediction';
*/

-- =============================================================================
-- VERIFICATION
-- =============================================================================

SELECT 
    'Git Deployment' as STEP,
    'Infrastructure deployed from Git' as STATUS,
    'Push Docker image, then uncomment CREATE SERVICE' as NEXT_ACTION;
