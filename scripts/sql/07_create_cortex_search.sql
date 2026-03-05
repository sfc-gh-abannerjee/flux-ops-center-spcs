-- =============================================================================
-- Flux Ops Center - 07: Create Cortex Search Services
-- =============================================================================
-- Creates Cortex Search Services required by the Grid Intelligence Agent.
-- These search services enable RAG (Retrieval Augmented Generation) for the
-- Grid Intelligence Assistant chat feature.
--
-- PREREQUISITES:
--   1. Source tables must exist:
--      - <database>.PRODUCTION.CUSTOMERS_MASTER_DATA (customer profiles)
--      - <database>.PRODUCTION.METER_INFRASTRUCTURE (meter metadata)
--      - <database>.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS (technical docs)
--      - <database>.ML_DEMO.COMPLIANCE_DOCS (NERC/regulatory docs)
--   2. Warehouse must be available for indexing
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>   - Target database name (e.g., FLUX_DB, FLUX_OPS_CENTER)
--   <% warehouse %>  - Warehouse for search service indexing
--
-- WHAT THIS CREATES:
--   1. CUSTOMER_SEARCH_SERVICE - Customer profile lookup (686K profiles)
--   2. AMI_METADATA_SEARCH - Meter metadata lookup (597K meters)
--   3. TECHNICAL_DOCS_SEARCH - Search technical manuals, equipment docs
--   4. COMPLIANCE_DOCS_SEARCH - Search NERC and regulatory compliance documents
--
-- NOTE: Service names must match those referenced in 08_create_cortex_agent.sql
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

-- IMPORTANT: Cortex Search service creation requires ACCOUNTADMIN role.
--   SYSADMIN will fail with internal errors on some accounts.
USE ROLE ACCOUNTADMIN;
USE DATABASE IDENTIFIER('<% database %>');
USE WAREHOUSE IDENTIFIER('<% warehouse %>');

-- =============================================================================
-- SECTION 1: CUSTOMER SEARCH SERVICE
-- =============================================================================
-- 686,000 customers indexed for natural language search
-- Supports: name, address, city, county, segment lookup

USE SCHEMA PRODUCTION;

CREATE OR REPLACE CORTEX SEARCH SERVICE CUSTOMER_SEARCH_SERVICE
    ON SEARCH_TEXT
    ATTRIBUTES CUSTOMER_SEGMENT, CITY, SERVICE_COUNTY, ACCOUNT_STATUS
    WAREHOUSE = IDENTIFIER('<% warehouse %>')
    TARGET_LAG = '1 day'
    COMMENT = 'Customer search - 686K profiles, searchable by name, address, segment'
AS (
    SELECT
        CUSTOMER_ID,
        FULL_NAME,
        CUSTOMER_SEGMENT,
        SERVICE_ADDRESS,
        CITY,
        SERVICE_COUNTY,
        ACCOUNT_STATUS,
        PRIMARY_METER_ID,
        PHONE,
        EMAIL,
        -- Concatenated search text for full-text search
        CONCAT(
            COALESCE(FULL_NAME, ''), ' ',
            COALESCE(CUSTOMER_SEGMENT, ''), ' ',
            COALESCE(SERVICE_ADDRESS, ''), ' ',
            COALESCE(CITY, ''), ' ',
            COALESCE(SERVICE_COUNTY, ''), ' County ',
            COALESCE(ACCOUNT_STATUS, ''), ' customer'
        ) AS SEARCH_TEXT
    FROM <% database %>.PRODUCTION.CUSTOMERS_MASTER_DATA
);

SELECT 'Created: <% database %>.PRODUCTION.CUSTOMER_SEARCH_SERVICE' AS STATUS;

-- =============================================================================
-- SECTION 2: AMI METADATA SEARCH SERVICE
-- =============================================================================
-- 597,000 meters indexed for meter lookup
-- Supports: meter ID, location, transformer, customer segment

-- First create the searchable view
CREATE OR REPLACE VIEW PRODUCTION.AMI_METADATA_SEARCHABLE AS
SELECT
    m.METER_ID,
    m.CUSTOMER_SEGMENT_ID,
    m.CITY,
    m.ZIP_CODE,
    m.COUNTY_NAME,
    m.TRANSFORMER_ID,
    m.SUBSTATION_ID,
    0 AS AVG_DAILY_KWH,
    CONCAT(
        m.METER_ID, ' ',
        COALESCE(m.CITY, ''), ' ',
        COALESCE(m.ZIP_CODE, ''), ' ',
        COALESCE(m.COUNTY_NAME, ''), ' ',
        COALESCE(m.TRANSFORMER_ID, ''), ' ',
        COALESCE(m.CUSTOMER_SEGMENT_ID, '')
    ) AS SEARCH_TEXT
FROM PRODUCTION.METER_INFRASTRUCTURE m;

CREATE OR REPLACE CORTEX SEARCH SERVICE AMI_METADATA_SEARCH
    ON SEARCH_TEXT
    ATTRIBUTES CUSTOMER_SEGMENT_ID, CITY, ZIP_CODE, COUNTY_NAME, TRANSFORMER_ID, SUBSTATION_ID
    WAREHOUSE = IDENTIFIER('<% warehouse %>')
    TARGET_LAG = '1 hour'
    COMMENT = 'Meter metadata search - 597K meters, searchable by ID, location, topology'
AS (
    SELECT 
        SEARCH_TEXT,
        METER_ID,
        CUSTOMER_SEGMENT_ID,
        CITY,
        ZIP_CODE,
        COUNTY_NAME,
        TRANSFORMER_ID,
        SUBSTATION_ID,
        AVG_DAILY_KWH
    FROM <% database %>.PRODUCTION.AMI_METADATA_SEARCHABLE
);

SELECT 'Created: <% database %>.PRODUCTION.AMI_METADATA_SEARCH' AS STATUS;

-- =============================================================================
-- SECTION 3: TECHNICAL DOCUMENTATION SEARCH SERVICE
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
-- SECTION 4: COMPLIANCE DOCUMENTATION SEARCH SERVICE
-- =============================================================================
-- Enables searching through NERC and other regulatory compliance
-- documents including TPL-001, FAC-003, EOP-011, CIP-002, etc.

USE SCHEMA ML_DEMO;

CREATE OR REPLACE CORTEX SEARCH SERVICE COMPLIANCE_DOCS_SEARCH
    ON CONTENT
    ATTRIBUTES DOC_ID, DOC_TYPE, TITLE, CATEGORY, KEYWORDS, APPLICABILITY
    WAREHOUSE = IDENTIFIER('<% warehouse %>')
    TARGET_LAG = '1 hour'
    COMMENT = 'Regulatory compliance document search for Grid Intelligence Agent'
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
-- SECTION 5: VERIFICATION
-- =============================================================================

SELECT 
    'Cortex Search Services Created' AS STEP,
    '<% database %>' AS DATABASE,
    'PRODUCTION: CUSTOMER_SEARCH_SERVICE, AMI_METADATA_SEARCH, TECHNICAL_DOCS_SEARCH | ML_DEMO: COMPLIANCE_DOCS_SEARCH' AS SERVICES,
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
-- =====================================================================