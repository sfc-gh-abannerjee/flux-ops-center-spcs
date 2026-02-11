-- =============================================================================
-- Flux Ops Center - 04: Deployment Validation
-- =============================================================================
-- Validates that all Flux Ops Center components are properly deployed.
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>       - Target database name
--   <% service_name %>   - SPCS service name
--   <% compute_pool %>   - Compute pool name
--   <% image_repo %>     - Image repository name
--
-- Usage:
--   snow sql -f scripts/sql/04_validation.sql \
--       -D "database=FLUX_DB" \
--       -D "service_name=FLUX_OPS_CENTER_SERVICE" \
--       -D "compute_pool=FLUX_OPS_CENTER_POOL" \
--       -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
--       -c your_connection_name
-- =============================================================================

USE DATABASE IDENTIFIER('<% database %>');

-- =============================================================================
-- 1. VALIDATE INFRASTRUCTURE
-- =============================================================================

-- Check image repository exists
SELECT 
    'Image Repository' AS COMPONENT,
    CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END AS STATUS
FROM INFORMATION_SCHEMA.IMAGE_REPOSITORIES
WHERE REPOSITORY_NAME = '<% image_repo %>';

-- Check compute pool status (using flow operator for robust sequencing)
DESCRIBE COMPUTE POOL IDENTIFIER('<% compute_pool %>')
->>
SELECT 
    'Compute Pool' AS COMPONENT,
    "name" AS POOL_NAME,
    "state" AS STATUS,
    "instance_family" AS INSTANCE_FAMILY,
    "min_nodes" AS MIN_NODES,
    "max_nodes" AS MAX_NODES
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- =============================================================================
-- 2. VALIDATE SERVICE
-- =============================================================================

-- Check service status
SELECT SYSTEM$GET_SERVICE_STATUS('<% service_name %>') AS SERVICE_STATUS;

-- Get service endpoint
SHOW ENDPOINTS IN SERVICE IDENTIFIER('<% service_name %>');

-- =============================================================================
-- 3. VALIDATE DATA DEPENDENCIES
-- =============================================================================
-- These objects should be created by flux-utility-solutions

-- Check PRODUCTION tables exist
SELECT 
    'PRODUCTION Tables' AS CATEGORY,
    TABLE_NAME,
    ROW_COUNT,
    CASE WHEN ROW_COUNT > 0 THEN 'OK' ELSE 'EMPTY' END AS STATUS
FROM <% database %>.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'PRODUCTION'
  AND TABLE_NAME IN ('SUBSTATIONS', 'TRANSFORMER_METADATA', 'CIRCUIT_METADATA', 
                     'METER_INFRASTRUCTURE', 'AMI_INTERVAL_READINGS')
ORDER BY TABLE_NAME;

-- Check APPLICATIONS views exist
SELECT 
    'APPLICATIONS Views' AS CATEGORY,
    TABLE_NAME AS VIEW_NAME,
    'EXISTS' AS STATUS
FROM <% database %>.INFORMATION_SCHEMA.VIEWS
WHERE TABLE_SCHEMA = 'APPLICATIONS'
  AND TABLE_NAME IN ('FLUX_OPS_CENTER_KPIS', 'FLUX_OPS_CENTER_TOPOLOGY',
                     'FLUX_OPS_CENTER_TOPOLOGY_NODES', 'FLUX_OPS_CENTER_SERVICE_AREAS_MV',
                     'VEGETATION_RISK_COMPUTED', 'CIRCUIT_STATUS_REALTIME')
ORDER BY TABLE_NAME;

-- Check ML_DEMO tables exist
SELECT 
    'ML_DEMO Tables' AS CATEGORY,
    TABLE_NAME,
    CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 'TABLE' ELSE TABLE_TYPE END AS TYPE,
    'EXISTS' AS STATUS
FROM <% database %>.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'ML_DEMO'
  AND TABLE_NAME IN ('GRID_NODES', 'GRID_EDGES', 'T_TRANSFORMER_TEMPORAL_TRAINING')
ORDER BY TABLE_NAME;

-- Check CASCADE_ANALYSIS tables exist
SELECT 
    'CASCADE_ANALYSIS Tables' AS CATEGORY,
    TABLE_NAME,
    'EXISTS' AS STATUS
FROM <% database %>.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'CASCADE_ANALYSIS'
  AND TABLE_NAME IN ('NODE_CENTRALITY_FEATURES_V2', 'PRECOMPUTED_CASCADES', 'GNN_PREDICTIONS')
ORDER BY TABLE_NAME;

-- =============================================================================
-- 4. SUMMARY
-- =============================================================================

SELECT 
    '=== DEPLOYMENT VALIDATION SUMMARY ===' AS MESSAGE
UNION ALL
SELECT 'Database: <% database %>'
UNION ALL
SELECT 'Service: <% service_name %>'
UNION ALL
SELECT 'Compute Pool: <% compute_pool %>'
UNION ALL
SELECT 'Image Repository: <% image_repo %>'
UNION ALL
SELECT '===================================='
UNION ALL
SELECT 'Run SHOW ENDPOINTS for the application URL';

-- =============================================================================
-- QUICK REFERENCE
-- =============================================================================
-- View logs:
--   CALL SYSTEM$GET_SERVICE_LOGS('<% service_name %>', '0', 'flux-ops-center', 100);
--
-- Check status:
--   SELECT SYSTEM$GET_SERVICE_STATUS('<% service_name %>');
--
-- Get endpoint URL:
--   SHOW ENDPOINTS IN SERVICE IDENTIFIER('<% service_name %>');
-- =============================================================================
