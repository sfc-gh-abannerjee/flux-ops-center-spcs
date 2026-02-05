-- =============================================================================
-- Flux Ops Center - 07: Create Cortex Search Services
-- =============================================================================
-- Creates Cortex Search Services required by the Grid Intelligence Agent.
-- These search services enable RAG (Retrieval Augmented Generation) for the
-- Grid Intelligence Assistant chat feature.
--
-- PREREQUISITES:
--   1. Source tables must exist:
--      - <database>.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS (technical docs)
--      - <database>.ML_DEMO.COMPLIANCE_DOCS (NERC/regulatory docs)
--   2. Warehouse must be available for indexing
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>   - Target database name (e.g., FLUX_DB, FLUX_OPS_CENTER)
--   <% warehouse %>  - Warehouse for search service indexing
--
-- WHAT THIS CREATES:
--   1. TECHNICAL_DOCS_SEARCH - Search technical manuals, equipment docs
--   2. COMPLIANCE_SEARCH - Search NERC/ERCOT compliance documents
--
-- Usage:
--   snow sql -f scripts/sql/07_create_cortex_search.sql \
--       -D "database=FLUX_DB" \
--       -D "warehouse=FLUX_WH" \
--       -c your_connection_name
--
-- After running this script:
--   - Create the Grid Intelligence Agent (08_create_cortex_agent.sql)
--   - Configure the SPCS service to use the agent
-- =============================================================================

USE ROLE SYSADMIN;
USE DATABASE IDENTIFIER('<% database %>');
USE WAREHOUSE IDENTIFIER('<% warehouse %>');

-- =============================================================================
-- SECTION 1: TECHNICAL DOCUMENTATION SEARCH SERVICE
-- =============================================================================
-- Enables searching through technical manuals, equipment documentation,
-- maintenance procedures, and operational guides.

USE SCHEMA PRODUCTION;

CREATE OR REPLACE CORTEX SEARCH SERVICE TECHNICAL_DOCS_SEARCH
    ON CHUNK_TEXT
    ATTRIBUTES CHUNK_ID, DOCUMENT_ID, DOCUMENT_TYPE, SOURCE_SYSTEM, LANGUAGE
    WAREHOUSE = IDENTIFIER('<% warehouse %>')
    TARGET_LAG = '1 hour'
    COMMENT = 'Technical documentation search for Grid Intelligence Agent'
AS (
    SELECT
        CHUNK_ID::VARCHAR AS CHUNK_ID,
        DOCUMENT_ID,
        DOCUMENT_TYPE,
        SOURCE_SYSTEM,
        LANGUAGE,
        CHUNK_TEXT
    FROM <% database %>.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS
    WHERE CHUNK_TEXT IS NOT NULL
);

SELECT 'Created: <% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH' AS STATUS;

-- =============================================================================
-- SECTION 2: COMPLIANCE DOCUMENTATION SEARCH SERVICE
-- =============================================================================
-- Enables searching through NERC, ERCOT, and other regulatory compliance
-- documents including TPL-001, FAC-003, EOP-011, CIP-002, etc.

USE SCHEMA ML_DEMO;

CREATE OR REPLACE CORTEX SEARCH SERVICE COMPLIANCE_DOCS_SEARCH
    ON CONTENT
    ATTRIBUTES DOC_ID, DOC_TYPE, TITLE, CATEGORY, KEYWORDS, APPLICABILITY
    WAREHOUSE = IDENTIFIER('<% warehouse %>')
    TARGET_LAG = '1 hour'
    COMMENT = 'NERC/ERCOT compliance document search for Grid Intelligence Agent'
AS (
    SELECT 
        DOC_ID,
        DOC_TYPE,
        TITLE,
        CONTENT,
        CATEGORY,
        KEYWORDS,
        APPLICABILITY,
        EFFECTIVE_DATE::VARCHAR AS EFFECTIVE_DATE,
        REVISION
    FROM <% database %>.ML_DEMO.COMPLIANCE_DOCS
    WHERE CONTENT IS NOT NULL
);

SELECT 'Created: <% database %>.ML_DEMO.COMPLIANCE_DOCS_SEARCH' AS STATUS;

-- =============================================================================
-- SECTION 3: VERIFICATION
-- =============================================================================

SELECT 
    'Cortex Search Services Created' AS STEP,
    '<% database %>' AS DATABASE,
    'PRODUCTION.TECHNICAL_DOCS_SEARCH, ML_DEMO.COMPLIANCE_DOCS_SEARCH' AS SERVICES,
    'Run 08_create_cortex_agent.sql next' AS NEXT_ACTION;

-- Show created services
SHOW CORTEX SEARCH SERVICES IN DATABASE IDENTIFIER('<% database %>');

-- =============================================================================
-- TROUBLESHOOTING
-- =============================================================================
-- Check indexing status:
--   SHOW CORTEX SEARCH SERVICES LIKE '%SEARCH%' IN DATABASE <% database %>;
--   Look for 'indexing_state' = 'ACTIVE' and 'serving_state' = 'ACTIVE'
--
-- If tables don't exist:
--   Run 00_standalone_quickstart.sql first, OR
--   Deploy flux-utility-solutions to create the source tables
--
-- Test a search (after indexing completes):
--   SELECT * FROM TABLE(
--       <% database %>.PRODUCTION.TECHNICAL_DOCS_SEARCH!SEARCH(
--           query => 'transformer maintenance',
--           columns => ['DOCUMENT_TYPE', 'CHUNK_TEXT'],
--           limit => 5
--       )
--   );
-- =============================================================================
