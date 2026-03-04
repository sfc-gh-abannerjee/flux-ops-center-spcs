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
--
-- IMPORTANT: Uses the FROM SPECIFICATION $$ ... $$ syntax with YAML.
--   The older property-based syntax (MODELS = ..., TOOLS = ...) is NOT supported.
--   See: https://docs.snowflake.com/en/sql-reference/sql/create-agent
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>          - Database containing search services (e.g., FLUX_DB)
--   <% warehouse %>         - Warehouse for agent queries
--   <% agent_database %>    - Database to create agent in (default: SNOWFLAKE_INTELLIGENCE)
--   <% agent_schema %>      - Schema to create agent in (default: AGENTS)
--   <% agent_name %>        - Agent name (default: GRID_INTELLIGENCE_AGENT)
--
-- WHAT THIS CREATES:
--   - A Cortex Agent with access to:
--     1. Technical documentation search (equipment manuals, procedures)
--     2. Compliance documentation search (NERC, ERCOT regulations)
--
-- Usage:
--   snow sql -f scripts/sql/08_create_cortex_agent.sql \
--       -D "database=FLUX_DB" \
--       -D "warehouse=FLUX_WH" \
--       -c your_connection_name
--
-- After running this script:
--   - The SPCS service auto-discovers the agent using env vars:
--     CORTEX_AGENT_DATABASE (default: SNOWFLAKE_INTELLIGENCE)
--     CORTEX_AGENT_SCHEMA   (default: AGENTS)
--     CORTEX_AGENT_NAME     (default: GRID_INTELLIGENCE_AGENT)
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
-- Uses FROM SPECIFICATION with YAML to define the agent's tools, instructions,
-- and resource bindings. The agent orchestrates between two Cortex Search
-- services for technical docs and compliance regulations.

CREATE OR REPLACE AGENT IDENTIFIER('<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>')
  COMMENT = 'Grid Intelligence Assistant for Flux Operations Center - searches technical docs and compliance regulations'
  PROFILE = '{"display_name": "Grid Intelligence", "avatar": "ChartAgentIcon", "color": "blue"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-5

orchestration:
  budget:
    seconds: 60
    tokens: 4096

instructions:
  response: "Provide clear, actionable answers based on the documentation. When citing compliance requirements, include the specific standard number (e.g., TPL-001-5). For technical issues, include relevant equipment identifiers and procedures."
  orchestration: "You are the Grid Intelligence Assistant for utility operations. Help users find information in technical documentation and compliance regulations. Always search relevant sources before answering. Be concise and cite your sources."

tools:
  - tool_spec:
      type: cortex_search
      name: search_technical_docs
      description: "Search technical manuals, equipment documentation, maintenance procedures, and operational guides. Use this for questions about equipment specifications, troubleshooting, or maintenance."
  - tool_spec:
      type: cortex_search
      name: search_compliance_docs
      description: "Search NERC, ERCOT, and regulatory compliance documents including TPL-001, FAC-003, EOP-011, CIP standards."

tool_resources:
  search_technical_docs:
    name: "<% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH"
    max_results: "5"
    id_column: "CHUNK_ID"
    title_column: "DOCUMENT_TYPE"
  search_compliance_docs:
    name: "<% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH"
    max_results: "5"
    id_column: "DOC_ID"
    title_column: "TITLE"
$$;

SELECT 'Created Agent: <% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>.<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>' AS STATUS;

-- =============================================================================
-- SECTION 3: GRANT PERMISSIONS
-- =============================================================================
-- Grant access so the SPCS service (running as PUBLIC role) can invoke the agent

GRANT USAGE ON DATABASE IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>') TO ROLE PUBLIC;
GRANT USAGE ON SCHEMA IDENTIFIER('<% agent_database | default("SNOWFLAKE_INTELLIGENCE") %>.<% agent_schema | default("AGENTS") %>') TO ROLE PUBLIC;
GRANT USAGE ON AGENT IDENTIFIER('<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>') TO ROLE PUBLIC;

-- Grant usage on source search services
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH TO ROLE PUBLIC;
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH TO ROLE PUBLIC;

SELECT 'Granted permissions to PUBLIC role' AS STATUS;

-- =============================================================================
-- SECTION 4: VERIFICATION
-- =============================================================================

SHOW AGENTS LIKE 'GRID_INTELLIGENCE_AGENT';

-- =============================================================================
-- TROUBLESHOOTING
-- =============================================================================
-- Check agent exists:
--   SHOW AGENTS IN SCHEMA SNOWFLAKE_INTELLIGENCE.AGENTS;
--
-- Check search services are accessible:
--   SHOW CORTEX SEARCH SERVICES IN DATABASE <% database %>;
--
-- If agent returns 401/403 errors:
--   - Verify GRANT USAGE was successful
--   - Check the SPCS service role has access
--   - Verify search services are in ACTIVE state
-- =============================================================================
