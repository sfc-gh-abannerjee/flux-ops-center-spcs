-- =============================================================================
-- Flux Ops Center - 08: Create Grid Intelligence Agent
-- =============================================================================
-- Creates the Cortex Agent used by the Grid Intelligence Assistant chat feature.
-- The agent enables natural language queries about grid operations, equipment,
-- and compliance using RAG with the search services created in 07_create_cortex_search.sql.
--
-- PREREQUISITES:
--   1. Cortex Search Services must exist (run 07_create_cortex_search.sql first):
--      - <database>.PRODUCTION.CUSTOMER_SEARCH_SERVICE
--      - <database>.PRODUCTION.AMI_METADATA_SEARCH
--      - <database>.PRODUCTION.TECHNICAL_DOCS_SEARCH
--      - <database>.ML_DEMO.COMPLIANCE_DOCS_SEARCH
--   2. Semantic View must exist (run 11_create_semantic_view.sql first):
--      - <database>.APPLICATIONS.UTILITY_SEMANTIC_VIEW
--   3. Warehouse must be available for agent execution
--
-- IMPORTANT: Uses the FROM SPECIFICATION $$ ... $$ syntax with YAML.
--   The older property-based syntax (MODELS = ..., TOOLS = ...) is NOT supported.
--   See: https://docs.snowflake.com/en/sql-reference/sql/create-agent
--
--   Key YAML format notes discovered during testing:
--   - Tool type for Cortex Analyst must be "cortex_analyst_text_to_sql" (NOT "cortex_analyst")
--   - Analyst tool_resources must include execution_environment with type + warehouse
--   - Search tool_resources use "search_service" key (NOT "name")
--   - max_results should be an integer (not a quoted string)
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>          - Database containing search services (e.g., FLUX_DB)
--   <% warehouse %>         - Warehouse for agent queries
--   <% agent_database %>    - Database to create agent in (default: SNOWFLAKE_INTELLIGENCE)
--   <% agent_schema %>      - Schema to create agent in (default: AGENTS)
--   <% agent_name %>        - Agent name (default: GRID_INTELLIGENCE_AGENT)
--
-- WHAT THIS CREATES:
--   A 5-tool Cortex Agent:
--     1. grid_analyst           - Cortex Analyst text-to-SQL (semantic view)
--     2. search_customers       - Customer profile search (686K profiles)
--     3. search_meters          - AMI meter metadata search (597K meters)
--     4. search_technical_docs  - Technical manuals RAG (20K chunks)
--     5. search_compliance_docs - NERC/regulatory compliance docs
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
-- and resource bindings. The agent orchestrates between Cortex Analyst (text-to-SQL
-- via semantic view), customer/meter search, technical docs, and compliance docs.

CREATE OR REPLACE AGENT IDENTIFIER('<% agent_name | default("GRID_INTELLIGENCE_AGENT") %>')
  COMMENT = 'Grid Intelligence Agent - 5-tool utility operations assistant with semantic SQL, customer/meter search, technical docs, and compliance RAG'
  PROFILE = '{"display_name": "Grid Intelligence", "avatar": "ChartAgentIcon", "color": "blue"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-5

orchestration:
  budget:
    seconds: 180
    tokens: 100000

instructions:
  system: |
    ## Layer 1: Identity and Data Context
    
    You are the **Grid Intelligence Assistant**, a specialized AI assistant for 
    GridStar Energy utility grid operations. You help operations personnel, 
    engineers, and analysts understand grid performance.
    
    ### Data Available
    
    | Dataset | Scale | Coverage |
    |---------|-------|----------|
    | AMI Readings | 7.1B rows | Jul-Aug 2024, Jul-Aug 2025 |
    | Transformers | 91K assets | Full fleet |
    | Transformer Load | 211M rows | Summer peak hours |
    | Customers | 686K profiles | All segments |
    | Meters | 597K devices | All active meters |
    | Substations | 98 | Distribution network |
    | Circuits | 73 | All feeders |
    
    ### Data Characteristics
    
    - **Time Focus**: Data covers SUMMER PEAK periods (July-August)
    - **Geography**: Houston metropolitan area and surrounding counties
    - **Refresh Rate**: AMI data at 15-minute intervals
    - **Completeness**: ~98% meter reporting rate during normal operations
    
  orchestration: |
    ## Layer 2: Tool Selection
    
    Select tools based on question type:
    
    | Question Pattern | Tool | Examples |
    |-----------------|------|----------|
    | "How much...", "Total...", "Average..." | grid_analyst | Consumption totals, averages |
    | "Top 10...", "Highest...", "Lowest..." | grid_analyst | Rankings, extremes |
    | "Trend...", "Over time...", "Compare..." | grid_analyst | Time series, YoY |
    | "Which transformers...", "Overloaded..." | grid_analyst | Asset queries |
    | "Find customer...", "Who is..." | search_customers | Customer lookup |
    | "Meter MTR-...", "Meters on transformer..." | search_meters | Meter lookup |
    | "How do I...", "What causes...", "Maintenance..." | search_technical_docs | Procedures |
    | "NERC standard...", "Compliance...", "Regulatory..." | search_compliance_docs | Regulations |
    
    ### Multi-Tool Queries
    
    Some questions require multiple tools:
    1. "Find John Smith and show his usage" → search_customers → grid_analyst
    2. "Which overloaded transformers need maintenance?" → grid_analyst → search_technical_docs
    3. "What NERC standards apply to overloaded transformers?" → grid_analyst → search_compliance_docs
    
  response: |
    ## Layer 3: Response Guidelines
    
    - Use tables for rankings and comparisons
    - Include specific numbers, not vague descriptions
    - Show units (kWh, kVA, %, degrees F)
    - Reference time periods for context
    - When citing compliance requirements, include the specific standard number (e.g., TPL-001-5)
    - For technical issues, include relevant equipment identifiers and procedures
    
    ## Layer 4: Scope and Boundaries
    
    You CAN answer questions about:
    - Energy consumption patterns and trends
    - Transformer health, loading, thermal stress
    - Customer lookup and service information
    - Grid operations and circuit status
    - Technical procedures and maintenance
    - NERC and regulatory compliance standards
    - Outage patterns and voltage quality
    
    You CANNOT access:
    - Billing or payment information
    - Customer contracts or legal documents
    - Real-time SCADA data
    - Employee or HR information
    - Financial or budgeting data
    
    If asked about unavailable topics, politely explain you don't have access.

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: grid_analyst
      description: >
        Query structured utility data including AMI meter readings, transformer
        health metrics, customer profiles, and load analysis via natural language.
        Use for aggregations, trends, comparisons, rankings, and time-series analysis.
  - tool_spec:
      type: cortex_search
      name: search_customers
      description: >
        Search 686K customer profiles by name, address, city, county, ZIP code,
        or customer segment. Use for finding specific customers or account lookups.
  - tool_spec:
      type: cortex_search
      name: search_meters
      description: >
        Search 597K smart meters by meter ID, location (city, ZIP, county),
        associated transformer, or customer segment. Use for meter lookups.
  - tool_spec:
      type: cortex_search
      name: search_technical_docs
      description: >
        Search technical manuals, equipment documentation, maintenance procedures,
        and troubleshooting guides. Use for technical questions and procedures.
  - tool_spec:
      type: cortex_search
      name: search_compliance_docs
      description: >
        Search NERC and regulatory compliance documents including TPL-001,
        FAC-003, EOP-011, CIP standards, and internal utility policies.

tool_resources:
  grid_analyst:
    semantic_view: "<% database %>.APPLICATIONS.UTILITY_SEMANTIC_VIEW"
    execution_environment:
      type: warehouse
      warehouse: "<% warehouse %>"
  search_customers:
    search_service: "<% database %>.PRODUCTION.CUSTOMER_SEARCH_SERVICE"
    max_results: 5
    id_column: CUSTOMER_ID
    title_column: FULL_NAME
  search_meters:
    search_service: "<% database %>.PRODUCTION.AMI_METADATA_SEARCH"
    max_results: 5
    id_column: METER_ID
    title_column: METER_ID
  search_technical_docs:
    search_service: "<% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH"
    max_results: 5
    id_column: CHUNK_ID
    title_column: DOCUMENT_TYPE
  search_compliance_docs:
    search_service: "<% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH"
    max_results: 5
    id_column: DOC_ID
    title_column: TITLE
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
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.PRODUCTION.CUSTOMER_SEARCH_SERVICE TO ROLE PUBLIC;
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.PRODUCTION.AMI_METADATA_SEARCH TO ROLE PUBLIC;
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH TO ROLE PUBLIC;
GRANT USAGE ON CORTEX SEARCH SERVICE <% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH TO ROLE PUBLIC;

-- Grant access to semantic view for Cortex Analyst
GRANT SELECT ON SEMANTIC VIEW <% database %>.APPLICATIONS.UTILITY_SEMANTIC_VIEW TO ROLE PUBLIC;

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
-- =============================================================