-- =============================================================================
-- Flux Ops Center - 11: Create Semantic View
-- =============================================================================
-- Creates a semantic view for natural language analytics via Cortex Analyst.
-- This semantic view is the SAME as flux-utility-solutions/scripts/08_semantic_view.sql
-- to ensure parity between both repos.
--
-- PREREQUISITES:
--   1. PRODUCTION tables must exist with semantic-view-compatible columns:
--      - AMI_READINGS_FINAL (view or table with TIMESTAMP, USAGE_KWH, VOLTAGE)
--      - CUSTOMERS_MASTER_DATA (with FULL_NAME, PRIMARY_METER_ID, CUSTOMER_SEGMENT)
--      - TRANSFORMER_HOURLY_LOAD (with LOAD_KW, THERMAL_STRESS_CATEGORY)
--      - TRANSFORMER_METADATA (with AGE_YEARS, RATED_KVA, LOCATION_AREA, CIRCUIT_ID)
--   2. If using standalone quickstart (00_standalone_quickstart.sql), all columns
--      and the AMI_READINGS_FINAL view are created automatically.
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>   - Target database name (e.g., FLUX_DB)
--   <% warehouse %>  - Warehouse for queries
--   <% user_role | default("PUBLIC") %> - Role to grant access to
--
-- Usage:
--   snow sql -f scripts/sql/11_create_semantic_view.sql \
--       -D "database=FLUX_DB" \
--       -D "warehouse=FLUX_WH" \
--       -c your_connection_name
--
-- WHAT THIS CREATES:
--   - UTILITY_SEMANTIC_VIEW in the APPLICATIONS schema
--   - Covers 4 core tables: AMI readings, customers, transformer load, transformer metadata
--   - Enables natural language queries like "average energy consumption by city"
--
-- After running this script:
--   - Use with Cortex Analyst in Snowsight
--   - Or reference from a Cortex Agent (see 08_create_cortex_agent.sql)
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE IDENTIFIER('<% database %>');
USE WAREHOUSE IDENTIFIER('<% warehouse %>');
USE SCHEMA APPLICATIONS;

-- -----------------------------------------------------------------------------
-- 1. CREATE SEMANTIC VIEW
-- -----------------------------------------------------------------------------
-- Using Snowflake DDL syntax (NOT YAML) with:
--   TABLES     - Define logical tables with PRIMARY KEY and UNIQUE constraints
--   RELATIONSHIPS - Define joins between tables
--   FACTS      - Numeric measures
--   DIMENSIONS - Categorical attributes for grouping/filtering
--   METRICS    - Aggregated calculations
--
-- IMPORTANT: The referenced key in RELATIONSHIPS must be PRIMARY KEY or UNIQUE

CREATE OR REPLACE SEMANTIC VIEW UTILITY_SEMANTIC_VIEW
TABLES (
    -- AMI Readings table
    ami AS <% database %>.PRODUCTION.AMI_READINGS_FINAL
        WITH SYNONYMS = ('meter readings', 'interval data', 'energy data'),
    
    -- Customers table - note UNIQUE constraint on PRIMARY_METER_ID for relationship
    customers AS <% database %>.PRODUCTION.CUSTOMERS_MASTER_DATA
        PRIMARY KEY (CUSTOMER_ID)
        UNIQUE (PRIMARY_METER_ID)
        WITH SYNONYMS = ('customer profiles', 'accounts'),
    
    -- Transformer hourly load
    xfmr_load AS <% database %>.PRODUCTION.TRANSFORMER_HOURLY_LOAD
        WITH SYNONYMS = ('transformer loading', 'hourly load'),
    
    -- Transformer metadata
    xfmr AS <% database %>.PRODUCTION.TRANSFORMER_METADATA
        PRIMARY KEY (TRANSFORMER_ID)
        WITH SYNONYMS = ('transformers', 'transformer assets')
)
RELATIONSHIPS (
    -- AMI readings link to customers via meter ID
    ami(METER_ID) REFERENCES customers(PRIMARY_METER_ID),
    -- Transformer load links to transformer metadata
    xfmr_load(TRANSFORMER_ID) REFERENCES xfmr(TRANSFORMER_ID)
)
FACTS (
    -- Energy consumption facts
    ami.USAGE_KWH AS USAGE_KWH 
        WITH SYNONYMS = ('consumption', 'energy usage', 'kwh')
        COMMENT = 'Energy consumption in kilowatt-hours',
    ami.VOLTAGE AS VOLTAGE
        WITH SYNONYMS = ('volts', 'voltage reading')
        COMMENT = 'Voltage reading in volts',
    
    -- Transformer load facts
    xfmr_load.LOAD_KW AS LOAD_KW
        WITH SYNONYMS = ('load', 'power')
        COMMENT = 'Current load in kilowatts',
    xfmr_load.LOAD_FACTOR_PCT AS LOAD_FACTOR_PCT
        WITH SYNONYMS = ('utilization', 'loading percent')
        COMMENT = 'Load as percentage of rated capacity',
    
    -- Transformer asset facts
    xfmr.HEALTH_SCORE AS HEALTH_SCORE
        COMMENT = 'Asset health score 0-100',
    xfmr.AGE_YEARS AS AGE_YEARS
        COMMENT = 'Transformer age in years',
    xfmr.RATED_KVA AS RATED_KVA
        WITH SYNONYMS = ('capacity', 'rating')
        COMMENT = 'Rated capacity in kVA'
)
DIMENSIONS (
    -- AMI dimensions
    ami.METER_ID AS METER_ID
        WITH SYNONYMS = ('meter', 'meter number')
        COMMENT = 'Unique smart meter identifier',
    ami.TIMESTAMP AS TIMESTAMP
        WITH SYNONYMS = ('reading time', 'time', 'date')
        COMMENT = '15-minute interval timestamp',
    
    -- Customer dimensions
    customers.CUSTOMER_ID AS CUSTOMER_ID
        WITH SYNONYMS = ('customer', 'account')
        COMMENT = 'Unique customer identifier',
    customers.FULL_NAME AS FULL_NAME
        WITH SYNONYMS = ('name', 'customer name')
        COMMENT = 'Customer full name',
    customers.CITY AS CITY
        COMMENT = 'Service city',
    customers.ZIP_CODE AS ZIP_CODE
        WITH SYNONYMS = ('zip', 'postal code')
        COMMENT = 'Service ZIP code',
    customers.CUSTOMER_SEGMENT AS CUSTOMER_SEGMENT
        WITH SYNONYMS = ('segment', 'type')
        COMMENT = 'Customer type (RESIDENTIAL, COMMERCIAL, INDUSTRIAL)',
    
    -- Transformer dimensions
    xfmr.TRANSFORMER_ID AS TRANSFORMER_ID
        WITH SYNONYMS = ('transformer', 'xfmr')
        COMMENT = 'Transformer identifier',
    xfmr.LOCATION_AREA AS LOCATION_AREA
        COMMENT = 'Geographic area',
    xfmr.SUBSTATION_ID AS SUBSTATION_ID
        COMMENT = 'Parent substation',
    xfmr.CIRCUIT_ID AS CIRCUIT_ID
        COMMENT = 'Circuit/feeder assignment',
    
    -- Transformer load dimensions
    xfmr_load.THERMAL_STRESS_CATEGORY AS THERMAL_STRESS_CATEGORY
        WITH SYNONYMS = ('stress level', 'thermal risk')
        COMMENT = 'Thermal stress category (LOW, MODERATE, HIGH, CRITICAL)',
    xfmr_load.LOAD_HOUR AS LOAD_HOUR
        WITH SYNONYMS = ('hour')
        COMMENT = 'Hour of measurement'
)
METRICS (
    -- Energy consumption metrics
    ami.TOTAL_CONSUMPTION AS SUM(ami.USAGE_KWH)
        WITH SYNONYMS = ('total kwh', 'total usage')
        COMMENT = 'Total energy consumption in kWh',
    ami.AVG_CONSUMPTION AS AVG(ami.USAGE_KWH)
        WITH SYNONYMS = ('average kwh', 'avg usage')
        COMMENT = 'Average energy consumption per interval',
    ami.METER_COUNT AS COUNT(DISTINCT ami.METER_ID)
        COMMENT = 'Count of distinct meters reporting',
    ami.AVG_VOLTAGE AS AVG(ami.VOLTAGE)
        COMMENT = 'Average voltage across readings',
    
    -- Customer metrics
    customers.CUSTOMER_COUNT AS COUNT(DISTINCT customers.CUSTOMER_ID)
        COMMENT = 'Total number of customers',
    
    -- Transformer metrics
    xfmr.TRANSFORMER_COUNT AS COUNT(DISTINCT xfmr.TRANSFORMER_ID)
        COMMENT = 'Total transformers',
    xfmr.AVG_AGE AS AVG(xfmr.AGE_YEARS)
        COMMENT = 'Average transformer age',
    xfmr.AVG_HEALTH_SCORE AS AVG(xfmr.HEALTH_SCORE)
        COMMENT = 'Average health score',
    
    -- Load metrics
    xfmr_load.AVG_LOAD_FACTOR AS AVG(xfmr_load.LOAD_FACTOR_PCT)
        COMMENT = 'Average load factor percentage',
    xfmr_load.PEAK_LOAD_FACTOR AS MAX(xfmr_load.LOAD_FACTOR_PCT)
        COMMENT = 'Maximum load factor percentage'
)
COMMENT = 'Utility grid analytics semantic model for AMI readings, transformer health, and customer profiles. Covers Houston metro area data from July 2024 - August 2025.';

-- -----------------------------------------------------------------------------
-- 2. GRANT ACCESS TO USER ROLE
-- -----------------------------------------------------------------------------

GRANT SELECT ON SEMANTIC VIEW UTILITY_SEMANTIC_VIEW 
    TO ROLE IDENTIFIER('<% user_role | default("PUBLIC") %>');

-- -----------------------------------------------------------------------------
-- 3. VERIFY DEPLOYMENT
-- -----------------------------------------------------------------------------

SHOW SEMANTIC VIEWS IN SCHEMA APPLICATIONS;

-- Show semantic view structure
DESCRIBE SEMANTIC VIEW UTILITY_SEMANTIC_VIEW;

-- =============================================================================
-- DEPLOYMENT COMPLETE
-- 
-- The semantic view can be used with:
--   1. Cortex Analyst (via API or Snowsight)
--   2. Cortex Agent (see 08_create_cortex_agent.sql)
--
-- Next: Deploy the SPCS service (scripts 01-03) if not already done
-- =============================================================================
