-- =============================================================================
-- Flux Operations Center - Deploy from Git Integration
-- =============================================================================
-- Deploys Flux Operations Center SPCS infrastructure using Snowflake Git
-- Integration. This script creates SPCS components only - data objects
-- must be deployed first via flux-utility-solutions.
--
-- PREREQUISITES:
--   1. flux-utility-solutions deployed (creates database, tables, views)
--   2. Git repository integration configured (see setup_git_integration.sql)
--   3. Docker image built and pushed to image repository
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>       - Target database name
--   <% schema %>         - Schema for SPCS objects (default: PUBLIC)
--   <% warehouse %>      - Warehouse for queries
--   <% git_repo %>       - Git repository name in Snowflake
--   <% image_repo %>     - Image repository name
--   <% compute_pool %>   - Compute pool name
--   <% service_name %>   - SPCS service name
--   <% image_tag %>      - Docker image tag (default: latest)
--   <% postgres_host %>  - Snowflake Postgres instance host (REQUIRED for map visualization)
--
-- Usage:
--   snow sql -f git_deploy/deploy_from_git.sql \
--       -D "database=FLUX_DB" \
--       -D "schema=PUBLIC" \
--       -D "warehouse=FLUX_WH" \
--       -D "git_repo=FLUX_OPS_CENTER_REPO" \
--       -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
--       -D "compute_pool=FLUX_OPS_CENTER_POOL" \
--       -D "service_name=FLUX_OPS_CENTER_SERVICE" \
--       -D "image_tag=latest" \
--       -D "postgres_host=your_host.postgres.snowflake.app" \
--       -c your_connection_name
-- =============================================================================

-- Fetch latest from remote
ALTER GIT REPOSITORY IDENTIFIER('<% git_repo %>') FETCH;

-- =============================================================================
-- 1. VERIFY DATABASE EXISTS (from flux-utility-solutions)
-- =============================================================================
-- The database and data objects should already exist from deploying
-- flux-utility-solutions. This script only creates SPCS infrastructure.

USE DATABASE IDENTIFIER('<% database %>');
USE SCHEMA IDENTIFIER('<% schema %>');
USE WAREHOUSE IDENTIFIER('<% warehouse %>');

-- Verify required schemas exist
SELECT 
    'Prerequisites Check' AS STEP,
    CASE WHEN COUNT(*) >= 4 THEN 'OK' ELSE 'MISSING SCHEMAS - Deploy flux-utility-solutions first' END AS STATUS
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME IN ('PRODUCTION', 'APPLICATIONS', 'ML_DEMO', 'CASCADE_ANALYSIS');

-- =============================================================================
-- 2. EXTERNAL ACCESS INTEGRATIONS (Required for basemap tiles & fonts)
-- =============================================================================
-- These integrations allow the SPCS service frontend to load map tiles from CARTO
-- and fonts from Google. Without these, browser CSP will block the requests.

-- 2a. CARTO Network Rule (basemap tiles)
CREATE NETWORK RULE IF NOT EXISTS <% database %>.<% schema %>.FLUX_CARTO_NETWORK_RULE
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
    MODE = EGRESS
    COMMENT = 'Allows map tile loading from CARTO CDN';

-- 2b. Google Fonts Network Rule (UI typography)
CREATE NETWORK RULE IF NOT EXISTS <% database %>.<% schema %>.FLUX_GOOGLE_FONTS_NETWORK_RULE
    TYPE = HOST_PORT
    VALUE_LIST = (
        'fonts.googleapis.com:443',
        'fonts.gstatic.com:443'
    )
    MODE = EGRESS
    COMMENT = 'Allows Google Fonts loading';

-- 2c. Create External Access Integrations
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS FLUX_CARTO_INTEGRATION
    ALLOWED_NETWORK_RULES = (<% database %>.<% schema %>.FLUX_CARTO_NETWORK_RULE)
    ENABLED = TRUE
    COMMENT = 'External access for CARTO basemap tiles';

CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS GOOGLE_FONTS_EAI
    ALLOWED_NETWORK_RULES = (<% database %>.<% schema %>.FLUX_GOOGLE_FONTS_NETWORK_RULE)
    ENABLED = TRUE
    COMMENT = 'External access for Google Fonts';

-- =============================================================================
-- 3. IMAGE REPOSITORY
-- =============================================================================

CREATE IMAGE REPOSITORY IF NOT EXISTS IDENTIFIER('<% image_repo %>')
    COMMENT = 'Image repository for Flux Operations Center containers';

SHOW IMAGE REPOSITORIES LIKE '<% image_repo %>';

-- =============================================================================
-- 3. COMPUTE POOL
-- =============================================================================

CREATE COMPUTE POOL IF NOT EXISTS IDENTIFIER('<% compute_pool %>')
    MIN_NODES = 1
    MAX_NODES = 2
    INSTANCE_FAMILY = CPU_X64_S
    AUTO_RESUME = TRUE
    AUTO_SUSPEND_SECS = 300
    COMMENT = 'Compute pool for Flux Operations Center';

DESCRIBE COMPUTE POOL IDENTIFIER('<% compute_pool %>');

-- =============================================================================
-- 4. CREATE SERVICE
-- =============================================================================
-- IMPORTANT: Ensure Docker image is pushed before running this section!
--   docker login <registry_url>
--   docker build -t flux_ops_center:<% image_tag %> -f Dockerfile.spcs .
--   docker push <repository_url>/flux_ops_center:<% image_tag %>

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
        # Postgres configuration (dual-backend architecture)
        # Set postgres_host to your Snowflake Postgres instance host
        # Get from: SHOW POSTGRES INSTANCES LIKE 'your_instance_name';
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
    EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI)
    COMMENT = 'Flux Operations Center - Grid Visualization & GNN Risk Prediction';

-- Grant access
GRANT USAGE ON SERVICE IDENTIFIER('<% service_name %>') TO ROLE PUBLIC;

-- =============================================================================
-- 5. VERIFICATION
-- =============================================================================

-- Check service status
SELECT SYSTEM$GET_SERVICE_STATUS('<% service_name %>') AS SERVICE_STATUS;

-- Get endpoint URL
SHOW ENDPOINTS IN SERVICE IDENTIFIER('<% service_name %>');

SELECT 
    'Git Deployment Complete' AS STEP,
    '<% service_name %>' AS SERVICE,
    '<% database %>' AS DATABASE,
    'Check SHOW ENDPOINTS output for application URL' AS NEXT_ACTION;

-- =============================================================================
-- TROUBLESHOOTING
-- =============================================================================
-- View service logs:
--   CALL SYSTEM$GET_SERVICE_LOGS('<% service_name %>', '0', 'flux-ops-center', 100);
--
-- Restart service:
--   ALTER SERVICE IDENTIFIER('<% service_name %>') SUSPEND;
--   ALTER SERVICE IDENTIFIER('<% service_name %>') RESUME;
-- =============================================================================
