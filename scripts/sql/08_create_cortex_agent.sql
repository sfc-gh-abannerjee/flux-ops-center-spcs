-- =============================================================================
-- Flux Ops Center - 08: Create Grid Intelligence Agent
-- =============================================================================
-- Creates the Cortex Agent used by the Grid Intelligence Assistant chat feature.
-- The agent enables natural language queries about grid operations, equipment,
-- and compliance using RAG with the search services created in 07_create_cortex_search.sql.
--
-- PREREQUISITES:
--   1. Cortex Search Services must exist (run 07_create_cortex_search.sql first):
--      - <database>.PRODUCTION.TECHNICAL_DOCS_SEARCH
--      - <database>.ML_DEMO.COMPLIANCE_DOCS_SEARCH
--   2. Warehouse must be available for agent execution
--   3. (Optional) Semantic model for text-to-SQL queries
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>          - Database containing search services
--   <% warehouse %>         - Warehouse for agent queries
--   <% agent_database %>    - Database to create agent in (default: SNOWFLAKE_INTELLIGENCE)
--   <% agent_schema %>      - Schema to create agent in (default: AGENTS)
--   <% agent_name %>        - Agent name (default: GRID_INTELLIGENCE_AGENT)
--
-- WHAT THIS CREATES:
--   - A Cortex Agent with access to:
--     1. Technical documentation search (equipment manuals, procedures)
--     2. Compliance documentation search (NERC, ERCOT regulations)
--     3. (Optional) Semantic model for SQL queries on grid data
--
-- Usage:
--   snow sql -f scripts/sql/08_create_cortex_agent.sql \
--       -D "database=FLUX_DB" \
--       -D "warehouse=FLUX_WH" \
--       -D "agent_database=SNOWFLAKE_INTELLIGENCE" \
--       -D "agent_schema=AGENTS" \
--       -D "agent_name=GRID_INTELLIGENCE_AGENT" \
--       -c your_connection_name
--
-- After running this script:
--   - Deploy SPCS service (03_create_service.sql) with matching agent config
--   - Or update existing service with: ALTER SERVICE ... SET env vars
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- =============================================================================
-- SECTION 1: CREATE AGENT DATABASE/SCHEMA (if needed)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>');
CREATE SCHEMA IF NOT EXISTS IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>');

USE DATABASE IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>');
USE SCHEMA IDENTIFIER('<% agent_schema | default("AGENTS") %>');
USE WAREHOUSE IDENTIFIER('<% warehouse %>');

-- =============================================================================
-- SECTION 2: CREATE GRID INTELLIGENCE AGENT
-- =============================================================================
-- This agent is designed for utility grid operations teams to:
-- - Search technical documentation for equipment troubleshooting
-- - Look up NERC/ERCOT compliance requirements
-- - Query grid data using natural language (if semantic model available)

CREATE OR REPLACE CORTEX AGENT IDENTIFIER('<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>')
    COMMENT = 'Grid Intelligence Assistant for Flux Operations Center - searches technical docs and compliance regulations'
    -- Agent orchestration model
    MODELS = ('claude-sonnet-4-5')
    -- Search tools for RAG
    TOOLS = (
        -- Technical documentation search
        (
            TYPE = 'CORTEX_SEARCH',
            NAME = 'search_technical_docs',
            DESCRIPTION = 'Search technical manuals, equipment documentation, maintenance procedures, and operational guides. Use this for questions about equipment specifications, troubleshooting, or maintenance.',
            CORTEX_SEARCH_SERVICE = '<% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH',
            ID_COLUMN = 'CHUNK_ID',
            TITLE_COLUMN = 'DOCUMENT_TYPE',
            MAX_RESULTS = 5
        ),
        -- Compliance documentation search
        (
            TYPE = 'CORTEX_SEARCH',
            NAME = 'search_compliance_docs',
            DESCRIPTION = 'Search NERC, ERCOT, and regulatory compliance documents. Use this for questions about regulations, standards, compliance requirements, TPL-001, FAC-003, EOP-011, CIP standards.',
            CORTEX_SEARCH_SERVICE = '<% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH',
            ID_COLUMN = 'DOC_ID',
            TITLE_COLUMN = 'TITLE',
            MAX_RESULTS = 5
        )
    )
    PROFILE = (
        DISPLAY_NAME = 'Grid Intelligence',
        AVATAR = 'ChartAgentIcon',
        COLOR = 'blue'
    )
    INSTRUCTIONS = (
        RESPONSE = 'Provide clear, actionable answers based on the documentation. When citing compliance requirements, include the specific standard number (e.g., TPL-001-5). For technical issues, include relevant equipment identifiers and procedures.',
        ORCHESTRATION = 'You are the Grid Intelligence Assistant for utility operations. Help users find information in technical documentation and compliance regulations. Always search relevant sources before answering. Be concise and cite your sources.'
    )
    BUDGET = (
        TOKENS = 4096,
        SECONDS = 60
    );

SELECT 'Created Agent: <% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>.<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>' AS STATUS;

-- =============================================================================
-- SECTION 3: GRANT PERMISSIONS
-- =============================================================================
-- Grant access so the SPCS service can invoke the agent

GRANT USAGE ON DATABASE IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>') TO ROLE PUBLIC;
GRANT USAGE ON SCHEMA IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>') TO ROLE PUBLIC;

-- Grant usage on the agent itself
GRANT USAGE ON CORTEX AGENT IDENTIFIER('<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>') TO ROLE PUBLIC;

-- Grant usage on source search services
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH TO ROLE PUBLIC;
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH TO ROLE PUBLIC;

SELECT 'Granted permissions to PUBLIC role' AS STATUS;

-- =============================================================================
-- SECTION 4: VERIFICATION
-- =============================================================================

SELECT 
    'Grid Intelligence Agent Created' AS STEP,
    '<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>.<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>' AS AGENT_FQN,
    '<% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH' AS TECHNICAL_SEARCH,
    '<% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH' AS COMPLIANCE_SEARCH,
    'Configure SPCS service with matching CORTEX_AGENT_* env vars' AS NEXT_ACTION;

-- Show the created agent
DESCRIBE AGENT IDENTIFIER('<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>');

-- =============================================================================
-- SECTION 5: CONFIGURE SPCS SERVICE (Example)
-- =============================================================================
-- After creating the agent, update your SPCS service to use it:
--
--   ALTER SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER SUSPEND;
--   
--   -- Recreate with correct agent config
--   DROP SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER;
--   CREATE SERVICE FLUX_DB.APPLICATIONS.FLUX_OPS_CENTER
--   IN COMPUTE POOL FLUX_INTERACTIVE_POOL
--   FROM SPECIFICATION $$
--   spec:
--     containers:
--     - name: flux-ops-center
--       image: /flux_db/applications/flux_ops_center_repo/flux-ops-center:latest
--       env:
--         SNOWFLAKE_WAREHOUSE: "FLUX_WH"
--         CORTEX_AGENT_DATABASE: "<% agent_database | default('SNOWFLAKE_INTELLIGENCE') %>"
--         CORTEX_AGENT_SCHEMA: "<% agent_schema | default('AGENTS') %>"
--         CORTEX_AGENT_NAME: "<% agent_name | default('GRID_INTELLIGENCE_AGENT') %>"
--     endpoints:
--     - name: ui
--       port: 8080
--       public: true
--   $$
--   EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_POSTGRES_INTEGRATION, GOOGLE_FONTS_EAI)
--   QUERY_WAREHOUSE = FLUX_WH;

-- =============================================================================
-- TROUBLESHOOTING
-- =============================================================================
-- Test the agent directly:
--   SELECT SNOWFLAKE.CORTEX.AGENT(
--       '<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>.<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>',
--       'What are the NERC requirements for vegetation management?'
--   );
--
-- Check agent exists:
--   SHOW CORTEX AGENTS IN SCHEMA <% agent_database %>.<% agent_schema %>;
--
-- Check search services are accessible:
--   SHOW CORTEX SEARCH SERVICES IN DATABASE <% database %>;
--
-- If agent returns 401/403 errors:
--   - Verify GRANT USAGE was successful
--   - Check the SPCS service role has access
--   - Verify search services are in ACTIVE state
-- =============================================================================
