-- =============================================================================
-- Flux Ops Center - 05b: External Access for Map Tiles & Fonts
-- =============================================================================
-- Creates external access integrations required for the map visualization:
--   1. CARTO basemap tiles (CartoDB dark matter style)
--   2. Google Fonts (UI typography)
--
-- PREREQUISITES:
--   1. Database created (00_standalone_quickstart.sql or flux-utility-solutions)
--   2. ACCOUNTADMIN role access
--
-- Variables (Jinja2 syntax for Snow CLI):
--   <% database %>  - Target database name (e.g., FLUX_DB)
--   <% schema %>    - Schema for network rules (e.g., APPLICATIONS)
--
-- Usage:
--   snow sql -f scripts/sql/05b_map_external_access.sql \
--       -D "database=FLUX_DB" \
--       -D "schema=APPLICATIONS" \
--       -c your_connection_name
--
-- WHY THIS IS NEEDED:
--   SPCS services run in an isolated network environment. To load map tiles
--   from CARTO's CDN, the service needs explicit network egress rules.
--   Without these integrations, the basemap will fail to load.
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE IDENTIFIER('<% database %>');
USE SCHEMA IDENTIFIER('<% schema %>');

-- =============================================================================
-- 1. CARTO BASEMAP NETWORK RULE
-- =============================================================================
-- The map uses CARTO's Dark Matter style which loads tiles from multiple CDN
-- subdomains for parallel loading (a, b, c, d prefixes).

CREATE OR REPLACE NETWORK RULE FLUX_CARTO_NETWORK_RULE
    TYPE = HOST_PORT
    VALUE_LIST = (
        'basemaps.cartocdn.com:443',
        'tiles.basemaps.cartocdn.com:443',
        'tiles-a.basemaps.cartocdn.com:443',
        'tiles-b.basemaps.cartocdn.com:443',
        'tiles-c.basemaps.cartocdn.com:443',
        'tiles-d.basemaps.cartocdn.com:443',
        'a.basemaps.cartocdn.com:443',
        'b.basemaps.cartocdn.com:443',
        'c.basemaps.cartocdn.com:443',
        'd.basemaps.cartocdn.com:443',
        'unpkg.com:443'
    )
    MODE = EGRESS
    COMMENT = 'Allows map tile loading from CARTO CDN for Flux Ops Center';

-- =============================================================================
-- 2. GOOGLE FONTS NETWORK RULE
-- =============================================================================
-- The UI uses Google Fonts for consistent typography across browsers.

CREATE OR REPLACE NETWORK RULE FLUX_GOOGLE_FONTS_NETWORK_RULE
    TYPE = HOST_PORT
    VALUE_LIST = (
        'fonts.googleapis.com:443',
        'fonts.gstatic.com:443'
    )
    MODE = EGRESS
    COMMENT = 'Allows Google Fonts loading for Flux Ops Center UI';

-- =============================================================================
-- 3. CREATE EXTERNAL ACCESS INTEGRATIONS
-- =============================================================================

-- CARTO Integration (map tiles)
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION FLUX_CARTO_INTEGRATION
    ALLOWED_NETWORK_RULES = (FLUX_CARTO_NETWORK_RULE)
    ENABLED = TRUE
    COMMENT = 'External access for CARTO basemap tiles';

-- Google Fonts Integration (typography)
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION GOOGLE_FONTS_EAI
    ALLOWED_NETWORK_RULES = (FLUX_GOOGLE_FONTS_NETWORK_RULE)
    ENABLED = TRUE
    COMMENT = 'External access for Google Fonts';

-- =============================================================================
-- 4. GRANT USAGE TO ROLES
-- =============================================================================

GRANT USAGE ON INTEGRATION FLUX_CARTO_INTEGRATION TO ROLE SYSADMIN;
GRANT USAGE ON INTEGRATION GOOGLE_FONTS_EAI TO ROLE SYSADMIN;

-- =============================================================================
-- 5. VERIFICATION
-- =============================================================================

SELECT 
    '=== MAP EXTERNAL ACCESS CREATED ===' AS MESSAGE
UNION ALL SELECT 'CARTO Integration: FLUX_CARTO_INTEGRATION'
UNION ALL SELECT 'Google Fonts Integration: GOOGLE_FONTS_EAI'
UNION ALL SELECT '===================================='
UNION ALL SELECT 'Next Steps:'
UNION ALL SELECT '  1. Include these integrations when creating the SPCS service:'
UNION ALL SELECT '     EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_POSTGRES_INTEGRATION, FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI)'
UNION ALL SELECT '  2. Or update existing service with ALTER SERVICE';

-- Show created objects
SHOW NETWORK RULES LIKE 'FLUX_%';
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'FLUX_%';
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'GOOGLE_%';

-- =============================================================================
-- UPDATING EXISTING SERVICE
-- =============================================================================
-- If you already have a running service without these integrations, update it:
--
-- ALTER SERVICE <% database %>.<% schema %>.FLUX_OPS_CENTER
--     SET EXTERNAL_ACCESS_INTEGRATIONS = (
--         FLUX_POSTGRES_INTEGRATION,
--         FLUX_CARTO_INTEGRATION,
--         GOOGLE_FONTS_EAI
--     );
--
-- Then restart the service:
--   ALTER SERVICE <% database %>.<% schema %>.FLUX_OPS_CENTER SUSPEND;
--   ALTER SERVICE <% database %>.<% schema %>.FLUX_OPS_CENTER RESUME;
-- =============================================================================
