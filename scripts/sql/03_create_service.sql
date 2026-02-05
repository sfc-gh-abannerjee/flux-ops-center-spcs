-- =============================================================================
-- Flux Ops Center - 03: Create SPCS Service
-- =============================================================================
-- Deploys the Flux Operations Center as a Snowpark Container Service.
--
-- PREREQUISITES:
--   1. Database objects deployed via flux-utility-solutions
--      (scripts/30_ops_center_dependencies.sql creates all required views/tables)
--   2. Image repository created (01_image_repository.sql)
--   3. Docker image pushed to repository
--   4. Compute pool created (02_compute_pool.sql)
--   5. Postgres instance created (05_postgres_setup.sql)
--   6. PostGIS data loaded (backend/scripts/load_postgis_data.py)
--   7. Cortex Agent exists (see CORTEX AGENT CONFIGURATION below)
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>       - Target database name
--   <% schema %>         - Schema for service (default: PUBLIC)
--   <% service_name %>   - SPCS service name
--   <% compute_pool %>   - Compute pool to use
--   <% image_repo %>     - Image repository name
--   <% image_tag %>      - Docker image tag (default: latest)
--   <% warehouse %>      - Warehouse for queries
--   <% postgres_host %>  - Postgres instance hostname (from SHOW POSTGRES INSTANCES)
--   <% postgres_secret %> - Secret containing Postgres credentials (optional)
--   <% cortex_agent_name %> - Cortex Agent name (default: GRID_INTELLIGENCE_AGENT)
--   <% cortex_agent_database %> - Database containing Cortex Agent (default: SNOWFLAKE_INTELLIGENCE)
--   <% cortex_agent_schema %> - Schema containing Cortex Agent (default: AGENTS)
--
-- CORTEX AGENT CONFIGURATION:
--   The Grid Intelligence Assistant requires a Cortex Agent. You must either:
--   1. Create an agent named GRID_INTELLIGENCE_AGENT in SNOWFLAKE_INTELLIGENCE.AGENTS
--   2. OR pass your own agent location via the cortex_agent_* variables
--
--   Example with custom agent:
--     -D "cortex_agent_name=MY_AGENT" \
--     -D "cortex_agent_database=MY_DATABASE" \
--     -D "cortex_agent_schema=MY_SCHEMA"
--
-- Usage:
--   snow sql -f scripts/sql/03_create_service.sql \
--       -D "database=FLUX_DB" \
--       -D "schema=PUBLIC" \
--       -D "service_name=FLUX_OPS_CENTER_SERVICE" \
--       -D "compute_pool=FLUX_OPS_CENTER_POOL" \
--       -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
--       -D "image_tag=latest" \
--       -D "warehouse=FLUX_WH" \
--       -D "postgres_host=<instance>.postgres.snowflake.app" \
--       -D "cortex_agent_name=GRID_INTELLIGENCE_AGENT" \
--       -c your_connection_name
-- =============================================================================

USE DATABASE IDENTIFIER('<% database %>');
USE SCHEMA IDENTIFIER('<% schema %>');

-- =============================================================================
-- CREATE SERVICE
-- =============================================================================
-- The service runs the Flux Ops Center container with access to Snowflake data.
-- Environment variables configure the app to connect to the correct database.

CREATE SERVICE IF NOT EXISTS IDENTIFIER('<% service_name %>')
    IN COMPUTE POOL IDENTIFIER('<% compute_pool %>')
    FROM SPECIFICATION $$
spec:
  containers:
    - name: flux-ops-center
      image: /<% database %>/<% schema %>/<% image_repo %>/flux_ops_center:<% image_tag %>
      env:
        # Snowflake configuration
        SNOWFLAKE_DATABASE: <% database %>
        SNOWFLAKE_WAREHOUSE: <% warehouse %>
        SNOWFLAKE_SCHEMA: PRODUCTION
        APPLICATIONS_SCHEMA: APPLICATIONS
        ML_SCHEMA: ML_DEMO
        CASCADE_SCHEMA: CASCADE_ANALYSIS
        # Cortex Agent configuration (for Grid Intelligence Assistant)
        # Users must ensure the agent exists and is accessible
        # Default: SNOWFLAKE_INTELLIGENCE.AGENTS.GRID_INTELLIGENCE_AGENT
        CORTEX_AGENT_DATABASE: <% cortex_agent_database | default('SNOWFLAKE_INTELLIGENCE') %>
        CORTEX_AGENT_SCHEMA: <% cortex_agent_schema | default('AGENTS') %>
        CORTEX_AGENT_NAME: <% cortex_agent_name | default('GRID_INTELLIGENCE_AGENT') %>
        # Postgres configuration (dual-backend architecture)
        # The app connects to Postgres for real-time spatial queries
        VITE_POSTGRES_HOST: <% postgres_host %>
        VITE_POSTGRES_PORT: "5432"
        VITE_POSTGRES_DATABASE: postgres
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
    QUERY_WAREHOUSE = IDENTIFIER('<% warehouse %>')
    COMMENT = 'Flux Operations Center - Grid Visualization & GNN Risk Prediction';

-- =============================================================================
-- GRANT ACCESS
-- =============================================================================
-- Grant service usage to roles that need to access the endpoint

GRANT USAGE ON SERVICE IDENTIFIER('<% service_name %>') TO ROLE PUBLIC;

-- =============================================================================
-- GET SERVICE URL
-- =============================================================================

-- Wait for service to start (may take 1-2 minutes)
SELECT SYSTEM$GET_SERVICE_STATUS('<% service_name %>');

-- Get the public endpoint URL
SHOW ENDPOINTS IN SERVICE IDENTIFIER('<% service_name %>');

-- =============================================================================
-- VERIFICATION
-- =============================================================================

SELECT 
    'SPCS Service Deployment' AS STEP,
    '<% service_name %>' AS SERVICE_NAME,
    '<% compute_pool %>' AS COMPUTE_POOL,
    '<% database %>/<% schema %>/<% image_repo %>/flux_ops_center:<% image_tag %>' AS IMAGE,
    'Check SHOW ENDPOINTS output for URL' AS NEXT_ACTION;

-- =============================================================================
-- TROUBLESHOOTING
-- =============================================================================
-- View service logs:
--   CALL SYSTEM$GET_SERVICE_LOGS('<% service_name %>', '0', 'flux-ops-center', 100);
--
-- Check service status:
--   SELECT SYSTEM$GET_SERVICE_STATUS('<% service_name %>');
--
-- Restart service:
--   ALTER SERVICE IDENTIFIER('<% service_name %>') SUSPEND;
--   ALTER SERVICE IDENTIFIER('<% service_name %>') RESUME;
-- =============================================================================
