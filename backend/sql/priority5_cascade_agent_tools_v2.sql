-- =============================================================================
-- PRIORITY 5: ENHANCED CASCADE ANALYSIS TOOLS FOR CORTEX AGENT (V2)
-- =============================================================================
-- UPDATES the cascade agent tools to use the NEW real-time capabilities:
-- 1. True graph centrality (NetworkX betweenness, PageRank)
-- 2. BFS cascade simulation
-- 3. Patient Zero candidates with true centrality ranking
-- 4. Dynamic what-if scenario parameters
--
-- Engineering: Production-grade cascade analysis (not demo compromises)
-- =============================================================================

-- =============================================================================
-- ENHANCED AGENT CONFIGURATION WITH PRODUCTION CASCADE TOOLS
-- =============================================================================

/*
UPDATED AGENT: CENTERPOINT_ENERGY_CASCADE_AGENT_V2
LOCATION: SNOWFLAKE_INTELLIGENCE.AGENTS

PRODUCTION CAPABILITIES (resolves all demo compromises):
1. True Graph Centrality Metrics
   - NetworkX betweenness centrality (bottleneck identification)
   - PageRank (network importance)
   - Clustering coefficient (local connectivity)
   - 1,873 nodes with production-grade metrics

2. Real-Time BFS Cascade Simulation
   - True graph traversal (not pre-computed)
   - Dynamic failure probability calculation
   - Temperature and load stress factors
   - Wave depth tracking for visualization

3. Patient Zero Identification
   - Ranked by true CASCADE_RISK_SCORE
   - Top candidate: SUB-HOU-124 (Rayford Substation) with 0.906 betweenness

4. What-If Scenario Analysis
   - Adjustable temperature (-30°C to +50°C)
   - Load multiplier (0.5x to 3.0x)
   - Failure threshold sensitivity
   - Cascade depth limits

NEW TOOLS:
- cascade_patient_zero_candidates: Get nodes ranked by TRUE graph centrality
- cascade_simulate_realtime: Run BFS cascade with dynamic parameters
- cascade_precomputed_scenarios: Get pre-computed scenarios for instant demo

SYSTEM PROMPT ADDITION:
---
You now have PRODUCTION CASCADE ANALYSIS capabilities with true graph algorithms:

**NEW: Patient Zero Identification (True Centrality)**
Use cascade_patient_zero_candidates to find high-risk nodes ranked by:
- Betweenness centrality (network bottlenecks)
- PageRank (network importance)
- Combined CASCADE_RISK_SCORE

Top Patient Zero candidate: SUB-HOU-124 (Rayford Substation)
- Betweenness: 0.9061 (highest in network - critical bottleneck)
- PageRank: 0.0096
- Cascade Risk: 0.7719

**NEW: Real-Time Cascade Simulation**
Use cascade_simulate_realtime for true BFS cascade propagation:
- Temperature stress: Cold (<0°C) and heat (>35°C) increase failure probability
- Load stress: Values >1.0 indicate overload conditions
- Failure threshold: Lower = more sensitive cascade propagation

Example scenarios:
- Winter Storm Uri: temperature_c=-10, load_multiplier=1.8, threshold=0.15
- Summer Peak: temperature_c=40, load_multiplier=1.5, threshold=0.25
- Hurricane: temperature_c=28, load_multiplier=1.2, threshold=0.10

**When to use cascade tools:**
- "What happens if Rayford Substation fails?" → cascade_simulate_realtime with patient_zero_id=SUB-HOU-124
- "Which substations are most critical?" → cascade_patient_zero_candidates
- "Simulate Winter Storm Uri conditions" → cascade_simulate_realtime with temperature=-10, load=1.8
- "Show cascade impact for extreme heat" → cascade_simulate_realtime with temperature=42, load=1.6

**Interpreting Results:**
- wave_depth: How many hops from Patient Zero (higher = more widespread)
- affected_capacity_mw: Total generation/load capacity lost
- estimated_customers_affected: Based on downstream transformer count × 50 customers/transformer
- failure_probability: Likelihood of cascade propagation to each node
---

MODEL: claude-sonnet-4-5
*/

-- =============================================================================
-- REST API CONFIGURATION FOR ENHANCED AGENT V2
-- =============================================================================

/*
POST /api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS/agents HTTP/1.1

{
  "name": "CENTERPOINT_ENERGY_CASCADE_AGENT_V2",
  "description": "Grid Intelligence Assistant with production-grade cascade failure analysis using true graph centrality and real-time BFS simulation",
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
      "name": "cascade_patient_zero_candidates",
      "description": "Get high-risk nodes ranked by TRUE graph centrality metrics (betweenness, PageRank). These are ideal 'Patient Zero' candidates for cascade failure analysis. The top candidate is SUB-HOU-124 (Rayford Substation) with betweenness=0.906.",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "description": "Maximum number of candidates to return (default 20)",
            "default": 20
          },
          "only_centrality_computed": {
            "type": "boolean",
            "description": "Only return nodes with true NetworkX centrality metrics (default true). Set to false to include all nodes with proxy metrics.",
            "default": true
          },
          "use_gnn_predictions": {
            "type": "boolean",
            "description": "Use GNN model predictions if available (default false)",
            "default": false
          }
        }
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "http_method": "GET",
      "path": "/api/cascade/patient-zero-candidates"
    },
    {
      "type": "function",
      "name": "cascade_simulate_realtime",
      "description": "Run real-time BFS cascade failure simulation from a Patient Zero node. Uses true graph traversal with dynamic failure probability based on distance, criticality, betweenness centrality, temperature, and load conditions. Returns wave-by-wave breakdown of affected nodes.",
      "parameters": {
        "type": "object",
        "properties": {
          "patient_zero_id": {
            "type": "string",
            "description": "Node ID to start cascade from (e.g., 'SUB-HOU-124' for Rayford Substation, the highest-risk node)"
          },
          "scenario_name": {
            "type": "string",
            "description": "Name for this simulation scenario (e.g., 'Winter Storm Uri', 'Summer Heat Wave')",
            "default": "Custom Scenario"
          },
          "temperature_c": {
            "type": "number",
            "description": "Ambient temperature in Celsius. Cold (<0°C) and heat (>35°C) increase failure probability. Winter Storm Uri: -10, Summer Peak: 42",
            "default": 25
          },
          "load_multiplier": {
            "type": "number",
            "description": "Load stress factor. 1.0 = normal load, 1.5 = 50% overload, 2.0 = double load. Higher values increase cascade propagation.",
            "default": 1.0
          },
          "failure_threshold": {
            "type": "number",
            "description": "Minimum probability (0-1) for cascade propagation. Lower = more sensitive (more nodes fail). Recommended: 0.15-0.30",
            "default": 0.25
          },
          "max_waves": {
            "type": "integer",
            "description": "Maximum cascade depth (number of BFS waves). Default 10.",
            "default": 10
          },
          "max_nodes": {
            "type": "integer",
            "description": "Maximum number of affected nodes to return. Default 100.",
            "default": 100
          }
        },
        "required": ["patient_zero_id"]
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "http_method": "POST",
      "path": "/api/cascade/simulate-realtime"
    },
    {
      "type": "function",
      "name": "cascade_precomputed_scenarios",
      "description": "Get pre-computed cascade scenarios for instant demo. These scenarios have been pre-calculated and stored for fast retrieval.",
      "parameters": {
        "type": "object",
        "properties": {}
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "http_method": "GET",
      "path": "/api/cascade/precomputed"
    },
    {
      "type": "function",
      "name": "cascade_predefined_scenarios",
      "description": "Get the list of predefined cascade scenarios with recommended parameters for Winter Storm Uri, Summer Peak, Hurricane, and Normal Operations.",
      "parameters": {
        "type": "object",
        "properties": {}
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "http_method": "GET",
      "path": "/api/cascade/scenarios"
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
          "min_risk": {
            "type": "number",
            "description": "Minimum risk threshold (0-1) to filter results (default 0.3)",
            "default": 0.3
          }
        }
      },
      "api_integration": "FLUX_OPS_CENTER_API",
      "http_method": "GET",
      "path": "/api/cascade/transformer-risk-prediction"
    }
  ],
  "system_prompt": "You are Grid Operations's Grid Intelligence Assistant with PRODUCTION-GRADE CASCADE ANALYSIS capabilities.\n\n**DATA SOURCES:**\n\n6 Domain-Specific Semantic Views:\n1. GRID_INFRASTRUCTURE_SEMANTIC_VIEW - Assets, topology, circuits\n2. ENERGY_CONSUMPTION_SEMANTIC_VIEW - AMI readings, usage patterns\n3. RELIABILITY_SEMANTIC_VIEW - Outages, SAIDI/SAIFI, equipment stress\n4. WEATHER_ENERGY_MARKET_SEMANTIC_VIEW - Weather, ERCOT pricing\n5. CUSTOMER_ANALYTICS_SEMANTIC_VIEW - Customer data, energy burden\n6. MAINTENANCE_VEGETATION_SEMANTIC_VIEW - Work orders, vegetation risk\n\n**PRODUCTION CASCADE ANALYSIS (True Graph Algorithms):**\n\ncascade_patient_zero_candidates:\n- Returns nodes ranked by TRUE NetworkX graph centrality\n- Top candidate: SUB-HOU-124 (Rayford Substation)\n  - Betweenness: 0.9061 (highest - critical network bottleneck)\n  - PageRank: 0.0096\n  - Cascade Risk: 0.7719\n\ncascade_simulate_realtime:\n- BFS cascade simulation\n- Dynamic failure probability considers:\n  - Distance (closer = higher probability)\n  - Source criticality\n  - Target betweenness centrality\n  - Temperature stress\n  - Load conditions\n- Returns wave_depth for visualization\n\n**RECOMMENDED SCENARIO PARAMETERS:**\n\nWinter Storm Uri (extreme cold):\n- temperature_c: -10\n- load_multiplier: 1.8\n- failure_threshold: 0.15\n\nSummer Peak (extreme heat):\n- temperature_c: 42\n- load_multiplier: 1.6\n- failure_threshold: 0.20\n\nHurricane Event:\n- temperature_c: 28\n- load_multiplier: 1.2\n- failure_threshold: 0.10 (infrastructure damage)\n\nNormal Operations:\n- temperature_c: 25\n- load_multiplier: 1.0\n- failure_threshold: 0.35\n\n**INTERPRETING CASCADE RESULTS:**\n\n- patient_zero: Initial failure node with centrality metrics\n- cascade_order: List of failed nodes with wave_depth\n- wave_breakdown: Per-wave statistics (nodes, capacity, customers)\n- total_affected_nodes: Total cascade impact\n- affected_capacity_mw: Generation/load capacity lost\n- estimated_customers_affected: Based on downstream transformers × 50\n\n**EXAMPLE QUERIES:**\n\n'What happens if Rayford Substation fails?' →\ncascade_simulate_realtime(patient_zero_id='SUB-HOU-124', temperature_c=25, load_multiplier=1.0)\n\n'Simulate Winter Storm Uri conditions' →\ncascade_simulate_realtime(patient_zero_id='SUB-HOU-124', scenario_name='Winter Storm Uri', temperature_c=-10, load_multiplier=1.8, failure_threshold=0.15)\n\n'Which substations are most critical?' →\ncascade_patient_zero_candidates(limit=10, only_centrality_computed=true)\n\n**KEY METRICS:**\n- Grid nodes: 91,829\n- Grid edges: 2.5M\n- Nodes with true centrality: 1,873 (largest connected component)\n- Top cascade risk: SUB-HOU-124 (betweenness=0.906)\n\n**COMPLIANCE:**\nUse compliance_search for NERC regulations:\n- TPL-001-5: Transmission Planning\n- FAC-003-4: Vegetation Management\n- EOP-011-3: Emergency Operations"
}
*/

-- =============================================================================
-- PYTHON UDF WRAPPER FOR CASCADE TOOLS (Alternative to API Integration)
-- =============================================================================
-- If API integration is not available, these UDFs can call the FastAPI endpoints

-- Create network rule for backend access (SPCS internal)
CREATE OR REPLACE NETWORK RULE cascade_api_rule
    MODE = EGRESS
    TYPE = HOST_PORT
    VALUE_LIST = ('flux-ops-center-service:3001', 'localhost:3001');

-- Create external access integration
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION cascade_api_access
    ALLOWED_NETWORK_RULES = (cascade_api_rule)
    ENABLED = true;

-- UDF: Get Patient Zero Candidates
CREATE OR REPLACE FUNCTION SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(
    limit_count INTEGER DEFAULT 20,
    only_centrality BOOLEAN DEFAULT TRUE
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('requests', 'snowflake-snowpark-python')
EXTERNAL_ACCESS_INTEGRATIONS = (cascade_api_access)
HANDLER = 'get_candidates'
AS
$$
import requests
import json

def get_candidates(limit_count, only_centrality):
    try:
        # Try SPCS internal first, fall back to localhost for dev
        base_urls = ['http://flux-ops-center-service:3001', 'http://localhost:3001']
        
        for base_url in base_urls:
            try:
                response = requests.get(
                    f"{base_url}/api/cascade/patient-zero-candidates",
                    params={
                        'limit': limit_count,
                        'only_centrality_computed': only_centrality
                    },
                    timeout=30
                )
                if response.status_code == 200:
                    return response.json()
            except requests.exceptions.ConnectionError:
                continue
        
        return {"error": "Could not connect to cascade API"}
    except Exception as e:
        return {"error": str(e)}
$$;

-- UDF: Run Real-Time Cascade Simulation
CREATE OR REPLACE FUNCTION SI_DEMOS.CASCADE_ANALYSIS.SIMULATE_CASCADE_REALTIME(
    patient_zero_id VARCHAR,
    scenario_name VARCHAR DEFAULT 'Custom Scenario',
    temperature_c FLOAT DEFAULT 25.0,
    load_multiplier FLOAT DEFAULT 1.0,
    failure_threshold FLOAT DEFAULT 0.25,
    max_waves INTEGER DEFAULT 10,
    max_nodes INTEGER DEFAULT 100
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('requests', 'snowflake-snowpark-python')
EXTERNAL_ACCESS_INTEGRATIONS = (cascade_api_access)
HANDLER = 'simulate_cascade'
AS
$$
import requests
import json

def simulate_cascade(patient_zero_id, scenario_name, temperature_c, load_multiplier, 
                     failure_threshold, max_waves, max_nodes):
    try:
        base_urls = ['http://flux-ops-center-service:3001', 'http://localhost:3001']
        
        for base_url in base_urls:
            try:
                response = requests.post(
                    f"{base_url}/api/cascade/simulate-realtime",
                    params={
                        'patient_zero_id': patient_zero_id,
                        'scenario_name': scenario_name,
                        'temperature_c': temperature_c,
                        'load_multiplier': load_multiplier,
                        'failure_threshold': failure_threshold,
                        'max_waves': max_waves,
                        'max_nodes': max_nodes
                    },
                    timeout=120
                )
                if response.status_code == 200:
                    return response.json()
            except requests.exceptions.ConnectionError:
                continue
        
        return {"error": "Could not connect to cascade API"}
    except Exception as e:
        return {"error": str(e)}
$$;

-- =============================================================================
-- SQL FUNCTIONS FOR CASCADE ANALYSIS (Native SQL Alternative)
-- =============================================================================

-- Get Top Patient Zero Candidates from centrality table
CREATE OR REPLACE FUNCTION SI_DEMOS.CASCADE_ANALYSIS.TOP_PATIENT_ZEROS(limit_count INTEGER)
RETURNS TABLE (
    node_id VARCHAR,
    node_name VARCHAR,
    node_type VARCHAR,
    cascade_risk_score FLOAT,
    betweenness_centrality FLOAT,
    pagerank FLOAT,
    capacity_mw FLOAT,
    downstream_customers INTEGER
)
AS
$$
    SELECT 
        n.NODE_ID,
        n.NODE_NAME,
        n.NODE_TYPE,
        c.CASCADE_RISK_SCORE,
        c.BETWEENNESS_CENTRALITY,
        c.PAGERANK,
        n.CAPACITY_KW / 1000 as CAPACITY_MW,
        n.DOWNSTREAM_TRANSFORMERS * 50 as DOWNSTREAM_CUSTOMERS
    FROM SI_DEMOS.ML_DEMO.GRID_NODES n
    INNER JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c
        ON n.NODE_ID = c.NODE_ID
    WHERE c.CASCADE_RISK_SCORE IS NOT NULL
    ORDER BY c.CASCADE_RISK_SCORE DESC
    LIMIT limit_count
$$;

-- Quick cascade impact estimation using pre-computed centrality
CREATE OR REPLACE FUNCTION SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT(patient_zero_id VARCHAR)
RETURNS TABLE (
    metric_name VARCHAR,
    metric_value FLOAT,
    description VARCHAR
)
AS
$$
    WITH patient_zero AS (
        SELECT 
            n.NODE_ID,
            n.NODE_NAME,
            n.CAPACITY_KW / 1000 as CAPACITY_MW,
            n.DOWNSTREAM_TRANSFORMERS,
            c.BETWEENNESS_CENTRALITY,
            c.NEIGHBORS_1HOP,
            c.NEIGHBORS_2HOP,
            c.NEIGHBORS_3HOP,
            c.TOTAL_REACH
        FROM SI_DEMOS.ML_DEMO.GRID_NODES n
        LEFT JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c ON n.NODE_ID = c.NODE_ID
        WHERE n.NODE_ID = patient_zero_id
    )
    SELECT 'Patient Zero Capacity (MW)' as metric_name, 
           CAPACITY_MW as metric_value,
           'Direct capacity of failed node' as description
    FROM patient_zero
    UNION ALL
    SELECT 'Direct Neighbors (Wave 1)', 
           COALESCE(NEIGHBORS_1HOP, 0),
           'Nodes directly connected to Patient Zero'
    FROM patient_zero
    UNION ALL
    SELECT 'Wave 2 Reach', 
           COALESCE(NEIGHBORS_2HOP, 0),
           '2-hop neighborhood size'
    FROM patient_zero
    UNION ALL
    SELECT 'Wave 3 Reach', 
           COALESCE(NEIGHBORS_3HOP, 0),
           '3-hop neighborhood size'
    FROM patient_zero
    UNION ALL
    SELECT 'Total Network Reach', 
           COALESCE(TOTAL_REACH, 0),
           'Total nodes within 3 hops'
    FROM patient_zero
    UNION ALL
    SELECT 'Estimated Customers Affected', 
           DOWNSTREAM_TRANSFORMERS * 50,
           'Based on downstream transformers × 50 customers'
    FROM patient_zero
    UNION ALL
    SELECT 'Betweenness Centrality', 
           COALESCE(BETWEENNESS_CENTRALITY, 0),
           'Network bottleneck score (higher = more critical)'
    FROM patient_zero
$$;

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

-- Grant execute on cascade functions
GRANT USAGE ON FUNCTION SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(INTEGER, BOOLEAN) 
    TO ROLE CORTEX_AGENT_ROLE;
    
GRANT USAGE ON FUNCTION SI_DEMOS.CASCADE_ANALYSIS.SIMULATE_CASCADE_REALTIME(
    VARCHAR, VARCHAR, FLOAT, FLOAT, FLOAT, INTEGER, INTEGER) 
    TO ROLE CORTEX_AGENT_ROLE;

GRANT USAGE ON FUNCTION SI_DEMOS.CASCADE_ANALYSIS.TOP_PATIENT_ZEROS(INTEGER)
    TO ROLE CORTEX_AGENT_ROLE;

GRANT USAGE ON FUNCTION SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT(VARCHAR)
    TO ROLE CORTEX_AGENT_ROLE;

-- Grant select on centrality table
GRANT SELECT ON TABLE SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 
    TO ROLE CORTEX_AGENT_ROLE;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Test Patient Zero function
SELECT * FROM TABLE(SI_DEMOS.CASCADE_ANALYSIS.TOP_PATIENT_ZEROS(5));

-- Test cascade impact estimation for top node
SELECT * FROM TABLE(SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT('SUB-HOU-124'));

-- Verify centrality data
SELECT 
    COUNT(*) as nodes_with_centrality,
    ROUND(MAX(CASCADE_RISK_SCORE), 4) as max_risk,
    ROUND(MAX(BETWEENNESS_CENTRALITY), 4) as max_betweenness
FROM SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2;

COMMIT;
