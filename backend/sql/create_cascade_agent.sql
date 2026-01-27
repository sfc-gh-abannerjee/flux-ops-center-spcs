-- =============================================================================
-- CASCADE ANALYSIS CORTEX AGENT - COMPLETE SETUP
-- =============================================================================
-- Creates a Cortex Agent with production-grade cascade analysis capabilities
-- 
-- Tools:
-- 1. cortex_analyst_text_to_sql - Query grid data via semantic views
-- 2. cortex_search - Technical manuals and compliance documents
-- 3. cascade_analysis (generic/custom) - Cascade simulation
--
-- Author: #Team
-- Date: 2026-01-25
-- =============================================================================

-- =============================================================================
-- STEP 1: CREATE STORED PROCEDURES FOR CASCADE TOOLS
-- =============================================================================
-- These procedures wrap the cascade analysis functionality for the agent

USE DATABASE SI_DEMOS;
USE SCHEMA CASCADE_ANALYSIS;
USE WAREHOUSE SI_DEMO_WH;

-- -----------------------------------------------------------------------------
-- Procedure: GET_PATIENT_ZERO_CANDIDATES
-- Returns high-risk nodes ranked by true graph centrality
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(
    limit_count INTEGER DEFAULT 10,
    only_true_centrality BOOLEAN DEFAULT TRUE
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    result VARIANT;
BEGIN
    IF (only_true_centrality) THEN
        -- Return only nodes with computed centrality metrics
        SELECT OBJECT_CONSTRUCT(
            'patient_zero_candidates', ARRAY_AGG(
                OBJECT_CONSTRUCT(
                    'node_id', n.NODE_ID,
                    'node_name', n.NODE_NAME,
                    'node_type', n.NODE_TYPE,
                    'cascade_risk_score', ROUND(c.CASCADE_RISK_SCORE, 4),
                    'betweenness_centrality', ROUND(c.BETWEENNESS_CENTRALITY, 4),
                    'pagerank', ROUND(c.PAGERANK, 6),
                    'capacity_mw', ROUND(n.CAPACITY_KW / 1000, 2),
                    'downstream_customers', n.DOWNSTREAM_TRANSFORMERS * 50,
                    'risk_source', 'true_centrality'
                )
            ),
            'count', COUNT(*),
            'note', 'Nodes ranked by NetworkX graph centrality (betweenness, PageRank)'
        ) INTO :result
        FROM SI_DEMOS.ML_DEMO.GRID_NODES n
        INNER JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c
            ON n.NODE_ID = c.NODE_ID
        WHERE c.CASCADE_RISK_SCORE IS NOT NULL
        ORDER BY c.CASCADE_RISK_SCORE DESC
        LIMIT :limit_count;
    ELSE
        -- Return all nodes, using criticality as proxy when centrality not available
        SELECT OBJECT_CONSTRUCT(
            'patient_zero_candidates', ARRAY_AGG(
                OBJECT_CONSTRUCT(
                    'node_id', n.NODE_ID,
                    'node_name', n.NODE_NAME,
                    'node_type', n.NODE_TYPE,
                    'cascade_risk_score', ROUND(COALESCE(c.CASCADE_RISK_SCORE, n.CRITICALITY_SCORE), 4),
                    'betweenness_centrality', ROUND(COALESCE(c.BETWEENNESS_CENTRALITY, 0), 4),
                    'pagerank', ROUND(COALESCE(c.PAGERANK, 0), 6),
                    'capacity_mw', ROUND(n.CAPACITY_KW / 1000, 2),
                    'downstream_customers', n.DOWNSTREAM_TRANSFORMERS * 50,
                    'risk_source', IFF(c.CASCADE_RISK_SCORE IS NOT NULL, 'true_centrality', 'criticality_proxy')
                )
            ),
            'count', COUNT(*)
        ) INTO :result
        FROM SI_DEMOS.ML_DEMO.GRID_NODES n
        LEFT JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c
            ON n.NODE_ID = c.NODE_ID
        WHERE n.LAT IS NOT NULL
        ORDER BY COALESCE(c.CASCADE_RISK_SCORE, n.CRITICALITY_SCORE) DESC
        LIMIT :limit_count;
    END IF;
    
    RETURN result;
END;
$$;

-- -----------------------------------------------------------------------------
-- Procedure: ESTIMATE_CASCADE_IMPACT
-- Quick cascade impact estimation using centrality metrics (no API call)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT(
    patient_zero_id VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    result VARIANT;
BEGIN
    SELECT OBJECT_CONSTRUCT(
        'patient_zero', OBJECT_CONSTRUCT(
            'node_id', n.NODE_ID,
            'node_name', n.NODE_NAME,
            'node_type', n.NODE_TYPE,
            'capacity_mw', ROUND(n.CAPACITY_KW / 1000, 2),
            'downstream_transformers', n.DOWNSTREAM_TRANSFORMERS,
            'betweenness_centrality', ROUND(COALESCE(c.BETWEENNESS_CENTRALITY, 0), 4),
            'pagerank', ROUND(COALESCE(c.PAGERANK, 0), 6),
            'cascade_risk_score', ROUND(COALESCE(c.CASCADE_RISK_SCORE, n.CRITICALITY_SCORE), 4)
        ),
        'estimated_impact', OBJECT_CONSTRUCT(
            'direct_neighbors_wave1', COALESCE(c.NEIGHBORS_1HOP, 0),
            'wave2_reach', COALESCE(c.NEIGHBORS_2HOP, 0),
            'wave3_reach', COALESCE(c.NEIGHBORS_3HOP, 0),
            'total_network_reach', COALESCE(c.TOTAL_REACH, 0),
            'estimated_customers_affected', n.DOWNSTREAM_TRANSFORMERS * 50,
            'network_criticality', IFF(COALESCE(c.BETWEENNESS_CENTRALITY, 0) > 0.5, 'CRITICAL BOTTLENECK', 
                                   IFF(COALESCE(c.BETWEENNESS_CENTRALITY, 0) > 0.1, 'HIGH', 'MODERATE'))
        ),
        'recommendation', IFF(COALESCE(c.BETWEENNESS_CENTRALITY, 0) > 0.5,
            'This node has very high betweenness centrality - it is a critical network bottleneck. Failure would severely impact grid connectivity. Recommend immediate contingency planning.',
            IFF(COALESCE(c.BETWEENNESS_CENTRALITY, 0) > 0.1,
                'This node has elevated betweenness centrality. Consider backup routes and load transfer procedures.',
                'This node has moderate network importance. Standard operating procedures apply.'
            )
        )
    ) INTO :result
    FROM SI_DEMOS.ML_DEMO.GRID_NODES n
    LEFT JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c ON n.NODE_ID = c.NODE_ID
    WHERE n.NODE_ID = :patient_zero_id;
    
    IF (result IS NULL) THEN
        RETURN OBJECT_CONSTRUCT('error', 'Node not found: ' || patient_zero_id);
    END IF;
    
    RETURN result;
END;
$$;

-- -----------------------------------------------------------------------------
-- Procedure: GET_CASCADE_SCENARIO_RECOMMENDATIONS
-- Returns recommended scenario parameters for cascade simulation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
BEGIN
    RETURN OBJECT_CONSTRUCT(
        'scenarios', ARRAY_CONSTRUCT(
            OBJECT_CONSTRUCT(
                'name', 'Winter Storm Uri',
                'description', 'Extreme cold weather scenario based on February 2021 Texas freeze',
                'parameters', OBJECT_CONSTRUCT(
                    'temperature_c', -10,
                    'load_multiplier', 1.8,
                    'failure_threshold', 0.15
                ),
                'historical_impact', '4.5 million customers affected, 111 fatalities'
            ),
            OBJECT_CONSTRUCT(
                'name', 'Summer Peak Demand',
                'description', 'Extreme heat wave with record electricity demand',
                'parameters', OBJECT_CONSTRUCT(
                    'temperature_c', 42,
                    'load_multiplier', 1.6,
                    'failure_threshold', 0.20
                ),
                'historical_impact', 'July 2023 broke demand records, rolling outages narrowly avoided'
            ),
            OBJECT_CONSTRUCT(
                'name', 'Hurricane Event',
                'description', 'Major hurricane landfall scenario with wind/flooding damage',
                'parameters', OBJECT_CONSTRUCT(
                    'temperature_c', 28,
                    'load_multiplier', 1.2,
                    'failure_threshold', 0.10
                ),
                'historical_impact', 'Hurricane Harvey (2017) caused 300,000+ outages'
            ),
            OBJECT_CONSTRUCT(
                'name', 'Normal Operations',
                'description', 'Baseline scenario for comparison - typical operating conditions',
                'parameters', OBJECT_CONSTRUCT(
                    'temperature_c', 25,
                    'load_multiplier', 1.0,
                    'failure_threshold', 0.35
                ),
                'historical_impact', 'Standard grid operations baseline'
            )
        ),
        'recommended_patient_zero', 'SUB-HOU-124',
        'recommended_patient_zero_name', 'Rayford Substation',
        'reason', 'Highest betweenness centrality (0.906) - critical network bottleneck',
        'api_endpoint', 'POST /api/cascade/simulate-realtime for real-time BFS simulation'
    );
END;
$$;


-- =============================================================================
-- STEP 2: CREATE THE CORTEX AGENT
-- =============================================================================
-- Creates the agent in SNOWFLAKE_INTELLIGENCE.AGENTS for visibility in SI UI

-- Ensure the database and schema exist
CREATE DATABASE IF NOT EXISTS SNOWFLAKE_INTELLIGENCE;
CREATE SCHEMA IF NOT EXISTS SNOWFLAKE_INTELLIGENCE.AGENTS;

-- Grant necessary permissions
GRANT USAGE ON DATABASE SNOWFLAKE_INTELLIGENCE TO ROLE PUBLIC;
GRANT USAGE ON SCHEMA SNOWFLAKE_INTELLIGENCE.AGENTS TO ROLE PUBLIC;

-- Create the Cascade Analysis Agent
CREATE OR REPLACE AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CASCADE_ANALYSIS_AGENT
    COMMENT = 'Grid Intelligence Assistant with production-grade cascade failure analysis using true graph centrality'
    PROFILE = '{"display_name": "GridGuard Cascade Analyst", "description": "Analyze grid vulnerabilities and simulate cascade failures"}'
    FROM SPECIFICATION $$
    {
        "models": {
            "orchestration": "claude-4-sonnet"
        },
        "instructions": {
            "orchestration": "You are GridGuard, a cascade failure analysis specialist for Grid Operations. Your primary role is to help operations teams understand grid vulnerabilities and simulate cascade failure scenarios.\n\nTOOL SELECTION:\n- Use 'cascade_patient_zeros' to identify high-risk nodes that could trigger cascades\n- Use 'cascade_impact' to estimate the impact of a specific node failure\n- Use 'cascade_scenarios' to get recommended scenario parameters\n- Use 'grid_data' for general grid infrastructure queries\n- Use 'technical_docs' for equipment specifications and procedures\n\nKEY KNOWLEDGE:\n- Top cascade risk node: SUB-HOU-124 (Rayford Substation) with betweenness=0.906\n- 1,873 nodes have true NetworkX centrality metrics\n- Grid has 91,829 total nodes and 2.5M edges\n\nALWAYS provide actionable recommendations based on centrality analysis.",
            "response": "Format responses with clear structure:\n1. Start with a summary of findings\n2. Present key metrics in a table when possible\n3. End with operational recommendations\n\nUse technical terminology appropriate for utility operations professionals. When discussing cascade risk, always reference betweenness centrality and PageRank scores."
        },
        "tools": [
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "cascade_patient_zeros",
                    "description": "Get list of high-risk nodes ranked by TRUE graph centrality (betweenness, PageRank) that could be 'Patient Zero' for cascade failures. The top candidate is SUB-HOU-124 (Rayford Substation) with betweenness=0.906.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "limit_count": {
                                "type": "integer",
                                "description": "Number of candidates to return (default 10)",
                                "default": 10
                            },
                            "only_true_centrality": {
                                "type": "boolean",
                                "description": "Only return nodes with computed NetworkX centrality (default true)",
                                "default": true
                            }
                        }
                    }
                }
            },
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "cascade_impact",
                    "description": "Estimate cascade failure impact for a specific node using centrality metrics. Returns betweenness centrality, network reach, and impact assessment.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "patient_zero_id": {
                                "type": "string",
                                "description": "Node ID to analyze (e.g., 'SUB-HOU-124' for Rayford Substation)"
                            }
                        },
                        "required": ["patient_zero_id"]
                    }
                }
            },
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "cascade_scenarios",
                    "description": "Get recommended cascade simulation scenarios with parameters for Winter Storm Uri, Summer Peak, Hurricane, and Normal Operations.",
                    "input_schema": {
                        "type": "object",
                        "properties": {}
                    }
                }
            },
            {
                "tool_spec": {
                    "type": "cortex_analyst_text_to_sql",
                    "name": "grid_data",
                    "description": "Query grid infrastructure data including nodes, edges, transformers, and substations using natural language."
                }
            },
            {
                "tool_spec": {
                    "type": "cortex_search",
                    "name": "technical_docs",
                    "description": "Search technical documentation, equipment manuals, and operational procedures."
                }
            }
        ],
        "tool_resources": {
            "cascade_patient_zeros": {
                "type": "procedure",
                "identifier": "SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES",
                "execution_environment": {
                    "type": "warehouse",
                    "name": "SI_DEMO_WH"
                }
            },
            "cascade_impact": {
                "type": "procedure",
                "identifier": "SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT",
                "execution_environment": {
                    "type": "warehouse",
                    "name": "SI_DEMO_WH"
                }
            },
            "cascade_scenarios": {
                "type": "procedure",
                "identifier": "SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS",
                "execution_environment": {
                    "type": "warehouse",
                    "name": "SI_DEMO_WH"
                }
            },
            "grid_data": {
                "semantic_view": "SI_DEMOS.APPLICATIONS.GRID_INFRASTRUCTURE_SEMANTIC_VIEW",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "SI_DEMO_WH"
                },
                "query_timeout": 60
            },
            "technical_docs": {
                "search_service": "SI_DEMOS.APPLICATIONS.TECHNICAL_MANUALS_PDF_CHUNKS_SEARCH_SERVICE",
                "max_results": 10,
                "columns": ["chunk_text", "document_title", "page_number"]
            }
        }
    }
    $$;

-- Grant usage on the agent
GRANT USAGE ON AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CASCADE_ANALYSIS_AGENT TO ROLE PUBLIC;

-- Grant execute on procedures to agent execution context
GRANT USAGE ON PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(INTEGER, BOOLEAN) TO ROLE PUBLIC;
GRANT USAGE ON PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT(VARCHAR) TO ROLE PUBLIC;
GRANT USAGE ON PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS() TO ROLE PUBLIC;

-- Grant access to centrality table
GRANT SELECT ON TABLE SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 TO ROLE PUBLIC;

-- =============================================================================
-- STEP 3: VERIFICATION
-- =============================================================================

-- Test the stored procedures
SELECT SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(5, TRUE) as top_5_candidates;
SELECT SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT('SUB-HOU-124') as rayford_impact;
SELECT SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS() as scenarios;

-- Verify agent was created
SHOW AGENTS IN SCHEMA SNOWFLAKE_INTELLIGENCE.AGENTS;
DESC AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CASCADE_ANALYSIS_AGENT;

COMMIT;

-- =============================================================================
-- USAGE EXAMPLES
-- =============================================================================
/*
Example queries for the CASCADE_ANALYSIS_AGENT:

1. "Which substations are most critical for cascade failures?"
   → Uses cascade_patient_zeros tool

2. "What happens if SUB-HOU-124 fails?"
   → Uses cascade_impact tool

3. "How should I configure a Winter Storm Uri simulation?"
   → Uses cascade_scenarios tool

4. "How many transformers are connected to SUB-HOU-124?"
   → Uses grid_data (Cortex Analyst) tool

5. "What are the maintenance procedures for substation failures?"
   → Uses technical_docs (Cortex Search) tool

Real-time simulation via API:
curl -X POST "http://localhost:3001/api/cascade/simulate-realtime?patient_zero_id=SUB-HOU-124&temperature_c=-10&load_multiplier=1.8&failure_threshold=0.15"
*/
