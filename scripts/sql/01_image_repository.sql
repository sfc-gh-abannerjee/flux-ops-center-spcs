-- =============================================================================
-- Flux Ops Center - 01: Image Repository Setup
-- =============================================================================
-- Creates the Snowflake image repository for Flux Ops Center container images.
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>     - Target database name (e.g., FLUX_DB, FLUX_PROD)
--   <% schema %>       - Schema for SPCS objects (default: PUBLIC)
--   <% image_repo %>   - Image repository name
--
-- Usage:
--   snow sql -f scripts/sql/01_image_repository.sql \
--       -D "database=FLUX_DB" \
--       -D "schema=PUBLIC" \
--       -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
--       -c your_connection_name
-- =============================================================================

-- Use the target database (must exist - deploy flux-utility-solutions first)
USE DATABASE IDENTIFIER('<% database %>');
USE SCHEMA IDENTIFIER('<% schema %>');

-- =============================================================================
-- CREATE IMAGE REPOSITORY
-- =============================================================================
-- The image repository stores Docker images for SPCS services.
-- Images are pushed using: docker push <registry_url>/<% image_repo %>/image:tag

CREATE IMAGE REPOSITORY IF NOT EXISTS IDENTIFIER('<% image_repo %>')
    COMMENT = 'Image repository for Flux Operations Center containers';

-- Show repository details (includes registry URL for docker push)
SHOW IMAGE REPOSITORIES LIKE '<% image_repo %>';

-- =============================================================================
-- VERIFICATION
-- =============================================================================

SELECT 
    'Image Repository Setup' AS STEP,
    '<% image_repo %>' AS REPOSITORY_NAME,
    'SUCCESS' AS STATUS,
    'Push Docker image before running 03_create_service.sql' AS NEXT_ACTION;

-- =============================================================================
-- NEXT STEPS
-- =============================================================================
-- 1. Note the repository_url from SHOW IMAGE REPOSITORIES output
-- 2. Run: docker login <org>-<account>.registry.snowflakecomputing.com
-- 3. Build: docker build -t flux_ops_center:latest -f Dockerfile.spcs .
-- 4. Tag:   docker tag flux_ops_center:latest <repository_url>/flux_ops_center:latest
-- 5. Push:  docker push <repository_url>/flux_ops_center:latest
-- 6. Then run 02_compute_pool.sql
-- =============================================================================
