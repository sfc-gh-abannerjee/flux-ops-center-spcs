-- =============================================================================
-- Flux Ops Center - 05a: External Access Integration for Postgres
-- =============================================================================
-- Creates the external access integration required for Snowflake stored 
-- procedures to connect to Snowflake Managed Postgres.
--
-- PREREQUISITES:
--   1. Postgres instance created (05_postgres_setup.sql)
--   2. Postgres credentials saved from instance creation
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>           - Target database name (e.g., FLUX_DB)
--   <% schema %>             - Schema for secrets (e.g., APPLICATIONS)
--   <% postgres_host %>      - Postgres instance hostname (from SHOW POSTGRES INSTANCES)
--   <% postgres_user %>      - Postgres application user (from CREATE POSTGRES INSTANCE output)
--   <% postgres_password %>  - Postgres application password (from CREATE POSTGRES INSTANCE output)
--   <% integration_name %>   - Name for the external access integration
--
-- Usage:
--   snow sql -f scripts/sql/05a_external_access.sql \
--       -D "database=FLUX_DB" \
--       -D "schema=APPLICATIONS" \
--       -D "postgres_host=<instance>.postgres.snowflake.app" \
--       -D "postgres_user=application" \
--       -D "postgres_password=<your_password>" \
--       -D "integration_name=FLUX_POSTGRES_INTEGRATION" \
--       -c your_connection_name
--
-- IMPORTANT: 
--   This script creates a SECRET with the Postgres password.
--   Run this script only once after setting up the Postgres instance.
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE IDENTIFIER('<% database %>');
USE SCHEMA IDENTIFIER('<% schema %>');

-- =============================================================================
-- 1. CREATE NETWORK RULE FOR POSTGRES EGRESS
-- =============================================================================
-- Allows stored procedures to connect to Postgres instance

CREATE OR REPLACE NETWORK RULE FLUX_POSTGRES_EGRESS_RULE
    TYPE = HOST_PORT
    VALUE_LIST = ('<% postgres_host %>:5432')
    MODE = EGRESS
    COMMENT = 'Allows Snowflake procedures to connect to Flux Ops Postgres instance';

-- =============================================================================
-- 2. CREATE SECRET FOR POSTGRES CREDENTIALS
-- =============================================================================
-- Stores Postgres credentials securely for use by stored procedures

CREATE OR REPLACE SECRET POSTGRES_CREDENTIALS
    TYPE = PASSWORD
    USERNAME = '<% postgres_user %>'
    PASSWORD = '<% postgres_password %>'
    COMMENT = 'Credentials for Flux Ops Center Postgres instance';

-- =============================================================================
-- 3. CREATE EXTERNAL ACCESS INTEGRATION
-- =============================================================================
-- Combines the network rule and secret for use by stored procedures

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION <% integration_name %>
    ALLOWED_NETWORK_RULES = (FLUX_POSTGRES_EGRESS_RULE)
    ALLOWED_AUTHENTICATION_SECRETS = (POSTGRES_CREDENTIALS)
    ENABLED = TRUE
    COMMENT = 'External access integration for Flux Ops Postgres connectivity';

-- =============================================================================
-- 4. GRANT USAGE TO ROLES
-- =============================================================================
-- Grant access so procedures can use the integration

GRANT USAGE ON INTEGRATION <% integration_name %> TO ROLE SYSADMIN;
GRANT USAGE ON SECRET POSTGRES_CREDENTIALS TO ROLE SYSADMIN;

-- =============================================================================
-- 5. VERIFICATION
-- =============================================================================

SELECT 
    '=== EXTERNAL ACCESS INTEGRATION CREATED ===' AS MESSAGE
UNION ALL
SELECT 'Integration: <% integration_name %>'
UNION ALL
SELECT 'Network Rule: FLUX_POSTGRES_EGRESS_RULE'
UNION ALL
SELECT 'Secret: POSTGRES_CREDENTIALS'
UNION ALL
SELECT 'Postgres Host: <% postgres_host %>'
UNION ALL
SELECT '============================================'
UNION ALL
SELECT 'Next Steps:'
UNION ALL
SELECT '  1. Run 06_postgres_sync.sql to create sync procedures'
UNION ALL
SELECT '  2. Call SETUP_DYNAMIC_POSTGRES_TABLES() to create tables'
UNION ALL
SELECT '  3. Load static data: python backend/scripts/load_postgis_data.py'
UNION ALL
SELECT '  4. Call SYNC_ALL_DYNAMIC_TO_POSTGRES() to sync dynamic data';

-- Show created objects
SHOW NETWORK RULES LIKE 'FLUX_POSTGRES%';
SHOW SECRETS LIKE 'POSTGRES%';
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'FLUX_POSTGRES%';

-- =============================================================================
-- USAGE IN STORED PROCEDURES
-- =============================================================================
-- 
-- When creating stored procedures that connect to Postgres, use:
--
-- CREATE OR REPLACE PROCEDURE MY_SYNC_PROCEDURE()
-- RETURNS VARCHAR
-- LANGUAGE PYTHON
-- RUNTIME_VERSION = '3.11'
-- PACKAGES = ('snowflake-snowpark-python', 'psycopg2')
-- HANDLER = 'sync_data'
-- EXTERNAL_ACCESS_INTEGRATIONS = (<% integration_name %>)
-- SECRETS = ('pg_creds' = <% database %>.<% schema %>.POSTGRES_CREDENTIALS)
-- AS
-- $$
-- import _snowflake
-- import psycopg2
--
-- def sync_data(session):
--     # Get credentials using correct method for PASSWORD type secrets
--     creds = _snowflake.get_username_password('pg_creds')
--     
--     conn = psycopg2.connect(
--         host='<% postgres_host %>',
--         database='postgres',
--         user=creds.username,
--         password=creds.password,
--         port=5432,
--         sslmode='require'
--     )
--     # ... rest of sync logic
-- $$;
--
-- =============================================================================
