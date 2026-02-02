-- =============================================================================
-- Flux Operations Center - Git Integration Setup
-- =============================================================================
-- This script sets up Snowflake Git integration to enable deployments
-- directly from the GitHub repository.
--
-- Prerequisites:
--   - ACCOUNTADMIN role (for creating integrations)
--   - GitHub Personal Access Token (for private repos)
-- =============================================================================

-- Configuration
SET database_name = 'FLUX_OPS_CENTER';
SET schema_name = 'PUBLIC';
SET git_repo_name = 'FLUX_OPS_CENTER_REPO';

-- =============================================================================
-- 1. CREATE API INTEGRATION (one-time setup per account)
-- =============================================================================

CREATE API INTEGRATION IF NOT EXISTS git_api_integration
    API_PROVIDER = git_https_api
    API_ALLOWED_PREFIXES = ('https://github.com/')
    ENABLED = TRUE
    COMMENT = 'Git API integration for Flux repositories';

-- =============================================================================
-- 2. CREATE DATABASE & SCHEMA (if needed)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS IDENTIFIER($database_name)
    COMMENT = 'Database for Flux Operations Center';

USE DATABASE IDENTIFIER($database_name);

CREATE SCHEMA IF NOT EXISTS IDENTIFIER($schema_name)
    COMMENT = 'Schema for Flux Operations Center';

USE SCHEMA IDENTIFIER($schema_name);

-- =============================================================================
-- 3. CREATE GIT REPOSITORY
-- =============================================================================

CREATE GIT REPOSITORY IF NOT EXISTS IDENTIFIER($git_repo_name)
    API_INTEGRATION = git_api_integration
    ORIGIN = 'https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs.git'
    -- Uncomment for private repos:
    -- GIT_CREDENTIALS = github_pat
    COMMENT = 'Flux Operations Center Git repository';

-- =============================================================================
-- 4. FETCH LATEST
-- =============================================================================

ALTER GIT REPOSITORY IDENTIFIER($git_repo_name) FETCH;

-- =============================================================================
-- 5. LIST AVAILABLE BRANCHES
-- =============================================================================

SHOW GIT BRANCHES IN IDENTIFIER($git_repo_name);

-- =============================================================================
-- 6. LIST FILES IN REPO
-- =============================================================================

SELECT * 
FROM TABLE(
    DIRECTORY(@FLUX_OPS_CENTER_REPO/branches/main/)
)
WHERE RELATIVE_PATH LIKE '%.sql' OR RELATIVE_PATH LIKE '%.yaml'
ORDER BY RELATIVE_PATH;

-- =============================================================================
-- VERIFICATION
-- =============================================================================

SELECT 
    'Git Integration' as STEP,
    $git_repo_name as REPOSITORY,
    'Run deploy_from_git.sql to deploy' as NEXT_ACTION,
    'SUCCESS' as STATUS;
