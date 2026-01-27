-- =============================================================================
-- PRIORITY 3: Multi-View Cortex Agent Configuration
-- =============================================================================
-- Creates a new agent that uses all 6 domain-specific semantic views
-- Following Snowflake's multi-model support (GA March 2025)
-- =============================================================================

-- First, let's check if we can create agents via SQL (or if we need Snowsight)
-- Note: As of Jan 2026, agents are typically created via Snowsight or REST API

-- The agent configuration for CENTERPOINT_ENERGY_MULTIVIEW_AGENT should:
-- 1. Reference all 6 domain-specific semantic views
-- 2. Use claude-sonnet-4-5 model (same as existing agent)
-- 3. Include the existing Cortex Search tool for technical manuals
-- 4. Have system instructions for domain routing

-- =============================================================================
-- Agent Configuration (for Snowsight UI or REST API)
-- =============================================================================

/*
AGENT NAME: CENTERPOINT_ENERGY_MULTIVIEW_AGENT
LOCATION: SNOWFLAKE_INTELLIGENCE.AGENTS

SYSTEM PROMPT:
You are Grid Operations's Grid Intelligence Assistant. You help utility operations teams analyze grid infrastructure, monitor energy consumption, track reliability metrics, understand weather impacts, manage customer programs, and coordinate maintenance activities.

You have access to 6 specialized semantic views organized by domain:
1. GRID_INFRASTRUCTURE_SEMANTIC_VIEW - Physical assets (meters, transformers, circuits, substations, poles)
2. ENERGY_CONSUMPTION_SEMANTIC_VIEW - Usage data (AMI readings, monthly aggregates, real-time streaming)
3. RELIABILITY_SEMANTIC_VIEW - Outages, voltage sags, SAIDI/SAIFI metrics, equipment stress
4. WEATHER_ENERGY_MARKET_SEMANTIC_VIEW - Weather, ERCOT pricing, storm correlations
5. CUSTOMER_ANALYTICS_SEMANTIC_VIEW - Customer data, energy burden, building types
6. MAINTENANCE_VEGETATION_SEMANTIC_VIEW - Work orders, vegetation risk, field operations

Route questions to the appropriate semantic view based on the domain:
- Asset/topology questions → GRID_INFRASTRUCTURE_SEMANTIC_VIEW
- Usage/consumption questions → ENERGY_CONSUMPTION_SEMANTIC_VIEW
- Outage/reliability questions → RELIABILITY_SEMANTIC_VIEW
- Weather/pricing questions → WEATHER_ENERGY_MARKET_SEMANTIC_VIEW
- Customer/affordability questions → CUSTOMER_ANALYTICS_SEMANTIC_VIEW
- Maintenance/vegetation questions → MAINTENANCE_VEGETATION_SEMANTIC_VIEW

For cross-domain questions, query multiple views and combine results.

Key metrics to remember:
- Total meters: 596,906
- Total transformers: 24,631
- July 2025 load: 3.12 TWh (+4.9% YoY vs July 2024)
- SAIDI target: <60 minutes/customer/year
- High energy burden threshold: >6% of income

MODEL: claude-sonnet-4-5

TOOLS:
1. Cortex Analyst with semantic views:
   - SI_DEMOS.APPLICATIONS.GRID_INFRASTRUCTURE_SEMANTIC_VIEW
   - SI_DEMOS.APPLICATIONS.ENERGY_CONSUMPTION_SEMANTIC_VIEW
   - SI_DEMOS.APPLICATIONS.RELIABILITY_SEMANTIC_VIEW
   - SI_DEMOS.APPLICATIONS.WEATHER_ENERGY_MARKET_SEMANTIC_VIEW
   - SI_DEMOS.APPLICATIONS.CUSTOMER_ANALYTICS_SEMANTIC_VIEW
   - SI_DEMOS.APPLICATIONS.MAINTENANCE_VEGETATION_SEMANTIC_VIEW

2. Cortex Search:
   - SI_DEMOS.APPLICATIONS.TECHNICAL_MANUALS_PDF_CHUNKS_SEARCH_SERVICE
   - For technical documentation, equipment manuals, safety procedures
*/

-- =============================================================================
-- REST API Configuration for Agent Creation
-- =============================================================================

/*
POST /api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS/agents HTTP/1.1

{
  "name": "CENTERPOINT_ENERGY_MULTIVIEW_AGENT",
  "description": "Multi-domain Grid Intelligence Assistant using 6 specialized semantic views following Snowflake best practices",
  "model": "claude-sonnet-4-5",
  "tools": [
    {
      "type": "cortex_analyst",
      "config": {
        "semantic_views": [
          "SI_DEMOS.APPLICATIONS.GRID_INFRASTRUCTURE_SEMANTIC_VIEW",
          "SI_DEMOS.APPLICATIONS.ENERGY_CONSUMPTION_SEMANTIC_VIEW",
          "SI_DEMOS.APPLICATIONS.RELIABILITY_SEMANTIC_VIEW",
          "SI_DEMOS.APPLICATIONS.WEATHER_ENERGY_MARKET_SEMANTIC_VIEW",
          "SI_DEMOS.APPLICATIONS.CUSTOMER_ANALYTICS_SEMANTIC_VIEW",
          "SI_DEMOS.APPLICATIONS.MAINTENANCE_VEGETATION_SEMANTIC_VIEW"
        ],
        "warehouse": "SI_DEMO_WH",
        "query_timeout_seconds": 120
      }
    },
    {
      "type": "cortex_search",
      "config": {
        "service": "SI_DEMOS.APPLICATIONS.TECHNICAL_MANUALS_PDF_CHUNKS_SEARCH_SERVICE",
        "columns": ["chunk_text", "document_title", "page_number"],
        "filter_columns": ["document_type"],
        "max_results": 10
      }
    }
  ],
  "system_prompt": "You are Grid Operations's Grid Intelligence Assistant. You help utility operations teams analyze grid infrastructure, monitor energy consumption, track reliability metrics, understand weather impacts, manage customer programs, and coordinate maintenance activities.\n\nYou have access to 6 specialized semantic views organized by domain:\n1. GRID_INFRASTRUCTURE_SEMANTIC_VIEW - Physical assets (meters, transformers, circuits, substations, poles)\n2. ENERGY_CONSUMPTION_SEMANTIC_VIEW - Usage data (AMI readings, monthly aggregates, real-time streaming)\n3. RELIABILITY_SEMANTIC_VIEW - Outages, voltage sags, SAIDI/SAIFI metrics, equipment stress\n4. WEATHER_ENERGY_MARKET_SEMANTIC_VIEW - Weather, ERCOT pricing, storm correlations\n5. CUSTOMER_ANALYTICS_SEMANTIC_VIEW - Customer data, energy burden, building types\n6. MAINTENANCE_VEGETATION_SEMANTIC_VIEW - Work orders, vegetation risk, field operations\n\nRoute questions to the appropriate semantic view based on the domain. For cross-domain questions, query multiple views and combine results.\n\nKey metrics:\n- Total meters: 596,906\n- Total transformers: 24,631\n- July 2025 load: 3.12 TWh (+4.9% YoY)\n- SAIDI target: <60 min/customer/year\n- High energy burden: >6% of income"
}
*/

-- =============================================================================
-- Verification Queries for New Semantic Views
-- =============================================================================

-- Test GRID_INFRASTRUCTURE_SEMANTIC_VIEW
SELECT * FROM SEMANTIC_VIEW(
    SI_DEMOS.APPLICATIONS.GRID_INFRASTRUCTURE_SEMANTIC_VIEW,
    METRICS => ['TOTAL_METERS', 'TOTAL_TRANSFORMERS', 'TOTAL_CIRCUITS']
);

-- Test ENERGY_CONSUMPTION_SEMANTIC_VIEW  
SELECT * FROM SEMANTIC_VIEW(
    SI_DEMOS.APPLICATIONS.ENERGY_CONSUMPTION_SEMANTIC_VIEW,
    METRICS => ['TOTAL_MONTHLY_CONSUMPTION'],
    DIMENSIONS => ['USAGE_MONTH'],
    WHERE => 'YEAR(USAGE_MONTH) = 2025'
);

-- Test RELIABILITY_SEMANTIC_VIEW
SELECT * FROM SEMANTIC_VIEW(
    SI_DEMOS.APPLICATIONS.RELIABILITY_SEMANTIC_VIEW,
    METRICS => ['TOTAL_OUTAGES', 'AVERAGE_OUTAGE_DURATION'],
    DIMENSIONS => ['OUTAGE_TYPE']
);

-- Test WEATHER_ENERGY_MARKET_SEMANTIC_VIEW
SELECT * FROM SEMANTIC_VIEW(
    SI_DEMOS.APPLICATIONS.WEATHER_ENERGY_MARKET_SEMANTIC_VIEW,
    METRICS => ['AVERAGE_LMP', 'AVERAGE_TEMPERATURE'],
    DIMENSIONS => ['WEATHER_DATE']
);

-- Test CUSTOMER_ANALYTICS_SEMANTIC_VIEW
SELECT * FROM SEMANTIC_VIEW(
    SI_DEMOS.APPLICATIONS.CUSTOMER_ANALYTICS_SEMANTIC_VIEW,
    METRICS => ['TOTAL_CUSTOMERS', 'AVERAGE_ENERGY_BURDEN'],
    DIMENSIONS => ['CUSTOMER_SEGMENT']
);

-- Test MAINTENANCE_VEGETATION_SEMANTIC_VIEW
SELECT * FROM SEMANTIC_VIEW(
    SI_DEMOS.APPLICATIONS.MAINTENANCE_VEGETATION_SEMANTIC_VIEW,
    METRICS => ['TOTAL_WORK_ORDERS', 'TOTAL_MAINTENANCE_COST'],
    DIMENSIONS => ['WORK_TYPE']
);
