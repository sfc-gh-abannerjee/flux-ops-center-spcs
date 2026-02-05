-- =============================================================================
-- Flux Ops Center - 02: Compute Pool Setup
-- =============================================================================
-- Creates the SPCS compute pool for running Flux Ops Center containers.
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>       - Target database name
--   <% compute_pool %>   - Compute pool name
--   <% instance_family %> - Instance type (default: CPU_X64_S)
--   <% min_nodes %>      - Minimum nodes (default: 1)
--   <% max_nodes %>      - Maximum nodes (default: 2)
--
-- Usage:
--   snow sql -f scripts/sql/02_compute_pool.sql \
--       -D "database=FLUX_DB" \
--       -D "compute_pool=FLUX_OPS_CENTER_POOL" \
--       -D "instance_family=CPU_X64_S" \
--       -D "min_nodes=1" \
--       -D "max_nodes=2" \
--       -c your_connection_name
-- =============================================================================

-- Use the target database
USE DATABASE IDENTIFIER('<% database %>');

-- =============================================================================
-- CREATE COMPUTE POOL
-- =============================================================================
-- Compute pools provide the infrastructure for running SPCS containers.
-- Instance families:
--   CPU_X64_XS  - Extra small (2 vCPU, 8 GB)
--   CPU_X64_S   - Small (4 vCPU, 16 GB) - Recommended for Ops Center
--   CPU_X64_M   - Medium (8 vCPU, 32 GB)
--   CPU_X64_L   - Large (16 vCPU, 64 GB)
--   HIGHMEM_*   - High memory variants
--   GPU_NV_*    - GPU instances (for ML workloads)

CREATE COMPUTE POOL IF NOT EXISTS IDENTIFIER('<% compute_pool %>')
    MIN_NODES = <% min_nodes %>
    MAX_NODES = <% max_nodes %>
    INSTANCE_FAMILY = <% instance_family %>
    AUTO_RESUME = TRUE
    AUTO_SUSPEND_SECS = 300
    COMMENT = 'Compute pool for Flux Operations Center SPCS service';

-- =============================================================================
-- VERIFICATION
-- =============================================================================

DESCRIBE COMPUTE POOL IDENTIFIER('<% compute_pool %>');

SELECT 
    'Compute Pool Setup' AS STEP,
    '<% compute_pool %>' AS POOL_NAME,
    '<% instance_family %>' AS INSTANCE_FAMILY,
    '<% min_nodes %>' AS MIN_NODES,
    '<% max_nodes %>' AS MAX_NODES,
    'SUCCESS' AS STATUS;

-- =============================================================================
-- NEXT STEPS
-- =============================================================================
-- 1. Ensure Docker image is pushed (see 01_image_repository.sql)
-- 2. Run 03_create_service.sql to deploy the SPCS service
-- =============================================================================
