-- =============================================================================
-- PRIORITY 4: CASCADE ANALYSIS & COMPLIANCE TOOLS FOR CORTEX AGENT
-- =============================================================================
-- Adds cascade failure analysis and NERC compliance search capabilities
-- to the Grid Operations Grid Intelligence Assistant
-- 
-- Engineering: Differentiates from competitors (Palantir/GE) with:
-- 1. Predictive cascade simulation (what-if scenarios)
-- 2. Regulatory compliance RAG (NERC standards)
-- 3. Patient Zero identification
-- =============================================================================

-- =============================================================================
-- NEW CORTEX SEARCH SERVICE: COMPLIANCE DOCUMENTS
-- =============================================================================
-- Already created in previous step as: SI_DEMOS.ML_DEMO.COMPLIANCE_SEARCH

-- Verify the compliance search service exists
SHOW CORTEX SEARCH SERVICES IN SCHEMA SI_DEMOS.ML_DEMO;

-- Test the compliance search
SELECT * FROM TABLE(
    SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
        'SI_DEMOS.ML_DEMO.COMPLIANCE_SEARCH',
        '{
            "query": "cascade failure protection requirements",
            "columns": ["TITLE", "CONTENT"],
            "limit": 5
        }'
    )
);

-- =============================================================================
-- ENHANCED AGENT CONFIGURATION WITH CASCADE & COMPLIANCE TOOLS
-- =============================================================================

/*
UPDATED AGENT: CENTERPOINT_ENERGY_CASCADE_AGENT
LOCATION: SNOWFLAKE_INTELLIGENCE.AGENTS

NEW CAPABILITIES:
1. Cascade Failure Analysis
   - Patient Zero identification
   - What-if scenario simulation (Winter Storm Uri, Summer Peak, Hurricane)
   - Cascade propagation visualization
   - Affected customer/capacity estimation

2. NERC Compliance Search
   - TPL-001-5 (Transmission System Planning)
   - FAC-003-4 (Vegetation Management)
   - EOP-011-3 (Emergency Operations)
   - CIP-002-5 (Critical Cyber Assets)
   
3. ML Risk Predictions
   - Temporal prediction (8 AM → 4 PM risk)
   - High-risk transformer identification
   - Cascade impact scoring

SYSTEM PROMPT ADDITION:
---
You now have CASCADE ANALYSIS capabilities for grid resilience:

**Cascade Failure Analysis Tools:**
- Use cascade_high_risk_nodes to identify potential "Patient Zero" transformers
- Use cascade_simulate to run what-if scenarios (Winter Storm Uri, Summer Peak, Hurricane)
- Use cascade_topology to understand grid connectivity

**NERC Compliance Search:**
- Use compliance_search to find relevant regulations for:
  - Cascade protection requirements (TPL-001-5)
  - Vegetation clearance standards (FAC-003-4)
  - Emergency load shedding (EOP-011-3)
  - Critical infrastructure protection (CIP-002-5)

**When to use cascade analysis:**
- "What happens if substation X fails?"
- "Show potential cascade during extreme heat"
- "Which transformers could trigger the largest outage?"
- "What are the NERC requirements for cascade protection?"

**Key cascade metrics:**
- Patient Zero: Initial failure node
- Cascade waves: Propagation depth (typically 3-5 waves)
- Affected capacity: MW of generation/load lost
- Estimated customers: Based on transformer service areas

Remember: Cascade analysis shows POTENTIAL impact, not predictions. Use ML risk predictions for actual probability assessments.
---

MODEL: claude-sonnet-4-5

UPDATED TOOLS:
1. Cortex Analyst (existing 6 semantic views)
2. Technical Manuals Search (existing)
3. NEW: Compliance Documents Search
4. NEW: Cascade Analysis API (via function tool)
*/

-- =============================================================================
-- REST API CONFIGURATION FOR ENHANCED AGENT
-- =============================================================================

/*
POST /api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS/agents HTTP/1.1

{
  "name": "CENTERPOINT_ENERGY_CASCADE_AGENT",
  "description": "Grid Intelligence Assistant with cascade failure analysis and NERC compliance search capabilities",
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
      "name": "technical_manuals_search",
      "config": {
        "service": "SI_DEMOS.APPLICATIONS.TECHNICAL_MANUALS_PDF_CHUNKS_SEARCH_SERVICE",
        "columns": ["chunk_text", "document_title", "page_number"],
        "filter_columns": ["document_type"],
        "max_results": 10
      }
    },
    {
      "type": "cortex_search",
      "name": "compliance_search",
      "config": {
        "service": "SI_DEMOS.ML_DEMO.COMPLIANCE_SEARCH",
        "columns": ["TITLE", "CONTENT", "DOC_TYPE"],
        "filter_columns": ["DOC_TYPE", "JURISDICTION"],
        "max_results": 5
      }
    },
    {
      "type": "function",
      "name": "cascade_high_risk_nodes",
      "description": "Get list of high-risk grid nodes that could be 'Patient Zero' for cascade failures. Returns nodes with high criticality scores.",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "description": "Maximum number of high-risk nodes to return (default 20)",
            "default": 20
          },
          "node_type": {
            "type": "string",
            "enum": ["SUBSTATION", "TRANSFORMER", "ALL"],
            "description": "Filter by node type",
            "default": "ALL"
          }
        }
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "path": "/api/cascade/high-risk-nodes"
    },
    {
      "type": "function",
      "name": "cascade_simulate",
      "description": "Simulate cascade failure propagation from a given scenario or initial failure node. Returns affected nodes, capacity, and estimated customer impact.",
      "parameters": {
        "type": "object",
        "properties": {
          "scenario_name": {
            "type": "string",
            "enum": ["Winter Storm Uri", "Summer Peak Demand", "Hurricane Event", "Normal Operations"],
            "description": "Predefined stress scenario to simulate"
          },
          "initial_failure_node": {
            "type": "string",
            "description": "Optional: Specific node ID to use as Patient Zero (default: auto-select highest risk)"
          },
          "temperature_c": {
            "type": "number",
            "description": "Ambient temperature in Celsius (affects equipment stress)"
          },
          "load_multiplier": {
            "type": "number",
            "description": "Load multiplier (1.0 = normal, 2.0 = double load)"
          }
        },
        "required": ["scenario_name"]
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "path": "/api/cascade/simulate"
    },
    {
      "type": "function",
      "name": "cascade_risk_predictions",
      "description": "Get ML-based risk predictions for transformers. Predicts afternoon (4 PM) high-risk status based on morning (8 AM) state.",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "description": "Maximum number of predictions to return (default 50)",
            "default": 50
          },
          "risk_level": {
            "type": "string",
            "enum": ["critical", "warning", "elevated", "all"],
            "description": "Filter by risk level",
            "default": "all"
          }
        }
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "path": "/api/cascade/transformer-risk-prediction"
    }
  ],
  "system_prompt": "You are Grid Operations's Grid Intelligence Assistant with enhanced CASCADE ANALYSIS and COMPLIANCE capabilities.\n\nYou have access to:\n\n**6 Domain-Specific Semantic Views:**\n1. GRID_INFRASTRUCTURE_SEMANTIC_VIEW - Assets, topology, circuits\n2. ENERGY_CONSUMPTION_SEMANTIC_VIEW - AMI readings, usage patterns\n3. RELIABILITY_SEMANTIC_VIEW - Outages, SAIDI/SAIFI, equipment stress\n4. WEATHER_ENERGY_MARKET_SEMANTIC_VIEW - Weather, ERCOT pricing\n5. CUSTOMER_ANALYTICS_SEMANTIC_VIEW - Customer data, energy burden\n6. MAINTENANCE_VEGETATION_SEMANTIC_VIEW - Work orders, vegetation risk\n\n**CASCADE ANALYSIS Tools:**\n- cascade_high_risk_nodes: Identify potential 'Patient Zero' nodes\n- cascade_simulate: Run what-if scenarios (Winter Storm Uri, Summer Peak, Hurricane)\n- cascade_risk_predictions: ML-based afternoon risk predictions\n\n**NERC COMPLIANCE Search:**\n- compliance_search: Search regulatory documents\n  - TPL-001-5: Transmission Planning\n  - FAC-003-4: Vegetation Management\n  - EOP-011-3: Emergency Operations\n  - CIP-002-5: Critical Infrastructure Protection\n\n**When to use cascade tools:**\n- 'What happens if [node] fails?' → cascade_simulate\n- 'Which transformers are highest risk?' → cascade_high_risk_nodes\n- 'What are the compliance requirements for cascade protection?' → compliance_search\n- 'Predict which transformers will be stressed this afternoon' → cascade_risk_predictions\n\n**Key Metrics:**\n- Total meters: 596,906\n- Total transformers: 24,631\n- Grid nodes: 91,829\n- Grid edges: 2.5M\n- Cascade scenarios: 4 predefined (Winter Storm Uri, Summer Peak, Hurricane, Normal)\n\n**#Positioning:**\nThis cascade analysis capability differentiates utility from competitors:\n- Proactive risk identification (not just reactive outage response)\n- Regulatory compliance integration (NERC standards)\n- What-if scenario planning (disaster preparedness)"
}
*/

-- =============================================================================
-- CREATE API INTEGRATION FOR CASCADE TOOLS (Required for Function Tools)
-- =============================================================================

-- Note: This requires the Flux Operations Center API endpoint to be accessible
-- For SPCS deployment, the API is available at: http://flux-ops-center-service:8000

CREATE OR REPLACE API INTEGRATION FLUX_OPS_CENTER_API
    API_PROVIDER = 'SNOWFLAKE_SPCS'
    API_ALLOWED_PREFIXES = ('http://flux-ops-center-service:8000')
    ENABLED = TRUE;

-- Grant usage to the agent role
GRANT USAGE ON INTEGRATION FLUX_OPS_CENTER_API TO ROLE CORTEX_AGENT_ROLE;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Test compliance search
SELECT * FROM TABLE(
    SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
        'SI_DEMOS.ML_DEMO.COMPLIANCE_SEARCH',
        '{
            "query": "under frequency load shedding requirements",
            "columns": ["TITLE", "CONTENT"],
            "limit": 3
        }'
    )
);

-- Verify grid topology for cascade analysis
SELECT 
    NODE_TYPE,
    COUNT(*) as NODE_COUNT,
    AVG(CRITICALITY_SCORE) as AVG_CRITICALITY
FROM SI_DEMOS.ML_DEMO.GRID_NODES
GROUP BY NODE_TYPE;

-- Verify cascade edge connectivity
SELECT 
    EDGE_TYPE,
    COUNT(*) as EDGE_COUNT,
    ROUND(AVG(DISTANCE_KM), 2) as AVG_DISTANCE_KM
FROM SI_DEMOS.ML_DEMO.GRID_EDGES
GROUP BY EDGE_TYPE;

-- =============================================================================
-- SAMPLE CASCADE ANALYSIS QUERIES FOR TESTING
-- =============================================================================

-- Find top 10 Patient Zero candidates
SELECT 
    gn.NODE_ID,
    gn.NODE_NAME,
    gn.NODE_TYPE,
    gn.CRITICALITY_SCORE,
    COUNT(ge.TO_NODE) as DOWNSTREAM_CONNECTIONS,
    gn.CAPACITY_KW / 1000 as CAPACITY_MW
FROM SI_DEMOS.ML_DEMO.GRID_NODES gn
LEFT JOIN SI_DEMOS.ML_DEMO.GRID_EDGES ge ON gn.NODE_ID = ge.FROM_NODE
WHERE gn.CRITICALITY_SCORE > 0.7
GROUP BY 1, 2, 3, 4, 6
ORDER BY CRITICALITY_SCORE * COUNT(ge.TO_NODE) DESC
LIMIT 10;

-- Simulate cascade propagation depth (BFS-style)
WITH RECURSIVE cascade_bfs AS (
    -- Patient Zero (highest criticality substation)
    SELECT 
        NODE_ID as failed_node,
        NODE_NAME,
        0 as wave_number,
        CRITICALITY_SCORE
    FROM SI_DEMOS.ML_DEMO.GRID_NODES
    WHERE NODE_TYPE = 'SUBSTATION'
    ORDER BY CRITICALITY_SCORE DESC
    LIMIT 1
    
    UNION ALL
    
    -- Propagation waves
    SELECT 
        ge.TO_NODE,
        gn.NODE_NAME,
        c.wave_number + 1,
        gn.CRITICALITY_SCORE
    FROM cascade_bfs c
    JOIN SI_DEMOS.ML_DEMO.GRID_EDGES ge ON c.failed_node = ge.FROM_NODE
    JOIN SI_DEMOS.ML_DEMO.GRID_NODES gn ON ge.TO_NODE = gn.NODE_ID
    WHERE c.wave_number < 3  -- Limit to 3 waves for demo
      AND gn.CRITICALITY_SCORE > 0.5  -- Only propagate to high-criticality nodes
)
SELECT 
    wave_number,
    COUNT(*) as nodes_failed,
    ROUND(AVG(CRITICALITY_SCORE), 3) as avg_criticality
FROM cascade_bfs
GROUP BY wave_number
ORDER BY wave_number;

COMMIT;
