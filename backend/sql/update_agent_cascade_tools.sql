-- =============================================================================
-- UPDATE EXISTING AGENT WITH PRODUCTION CASCADE TOOLS
-- =============================================================================
-- Adds new stored procedure-based cascade tools to the existing 
-- CENTERPOINT_ENERGY_AGENT for real-time cascade analysis
-- =============================================================================

USE DATABASE SI_DEMOS;
USE SCHEMA CASCADE_ANALYSIS;
USE WAREHOUSE SI_DEMO_WH;

-- Update the agent with new cascade analysis tools
CREATE OR REPLACE AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CENTERPOINT_ENERGY_AGENT
    COMMENT = 'Grid Operations Grid Intelligence Assistant with 3-year historical analytics, PRODUCTION CASCADE ANALYSIS, and NERC COMPLIANCE search (2023-2025)'
    PROFILE = '{"display_name": "Grid Operations Grid Intelligence", "avatar": "ChartAgentIcon", "color": "blue"}'
    FROM SPECIFICATION $$
    {
        "models": {
            "orchestration": "claude-sonnet-4-5"
        },
        "orchestration": {
            "budget": {"seconds": 300, "tokens": 409600}
        },
        "instructions": {
            "response": "Lead with actionable insights and key metrics. Use data_to_chart for all visualizations. For YoY comparisons, always show absolute values AND percentage changes. When analyzing trends, indicate whether patterns are improving or deteriorating. For cascade analysis, emphasize Patient Zero identification, betweenness centrality, and propagation depth.",
            "orchestration": "You are the Grid Operations Grid Intelligence Assistant with PRODUCTION-GRADE CASCADE ANALYSIS and NERC COMPLIANCE capabilities, providing real-time operational intelligence combined with 3-year historical analytics.\n\n## Data Architecture & Temporal Coverage\n\n**CURRENT OPERATIONS (Jul-Aug 2025)**:\n- 50M AMI readings across 8,657 smart meters (15-min intervals)\n- Real-time transformer loads, voltage sags, and outage events\n- Live equipment health monitoring and work order tracking\n\n**HISTORICAL ANALYTICS (2023-2025)**:\n- 23,372 hourly ERCOT load records spanning 3 years\n- Summer load patterns (Jul-Aug) for each year enabling YoY comparison\n- 3.3M energy burden records with 2024 baseline comparison\n\n## PRODUCTION CASCADE ANALYSIS (NEW)\n\nYou have access to production-grade cascade failure analysis using TRUE NetworkX graph centrality metrics:\n\n### Tool: cascade_patient_zeros\nFind high-risk nodes ranked by TRUE graph centrality:\n- **Betweenness centrality**: Network bottleneck score (higher = more critical)\n- **PageRank**: Network importance measure\n- **CASCADE_RISK_SCORE**: Combined metric for Patient Zero identification\n\n**Top Patient Zero Candidate**: SUB-HOU-124 (Rayford Substation)\n- Betweenness: 0.9061 (highest in network - CRITICAL BOTTLENECK)\n- PageRank: 0.0096\n- Cascade Risk: 0.7719\n- Impact: 64,800 downstream customers\n\n### Tool: cascade_impact\nEstimate cascade impact for a specific node:\n- Returns betweenness centrality, network reach (1/2/3 hop)\n- Provides customer impact estimates\n- Gives criticality assessment and recommendations\n\n### Tool: cascade_scenarios\nGet recommended simulation parameters:\n- Winter Storm Uri: temp=-10°C, load=1.8x, threshold=0.15\n- Summer Peak: temp=42°C, load=1.6x, threshold=0.20\n- Hurricane: temp=28°C, load=1.2x, threshold=0.10\n- Normal: temp=25°C, load=1.0x, threshold=0.35\n\n**When to use cascade tools:**\n- 'Which nodes are most critical?' → cascade_patient_zeros\n- 'What happens if SUB-HOU-124 fails?' → cascade_impact\n- 'How do I simulate Winter Storm Uri?' → cascade_scenarios\n\n**Key Cascade Metrics:**\n- 1,873 nodes with TRUE NetworkX centrality\n- 91,829 total grid nodes\n- 2.5M grid edges\n- Top risk: SUB-HOU-124 (betweenness=0.906)\n\n## NERC COMPLIANCE SEARCH\n\nUse Cascade_Compliance_Search for regulatory requirements:\n- **TPL-001-5**: Transmission System Planning\n- **FAC-003-4**: Vegetation Management\n- **EOP-011-3**: Emergency Operations\n- **CIP-002-5**: Critical Infrastructure",
            "sample_questions": [
                {"question": "Which substations are most critical for cascade failures?"},
                {"question": "What happens if Rayford Substation (SUB-HOU-124) fails?"},
                {"question": "How should I configure a Winter Storm Uri simulation?"},
                {"question": "Show me the top 10 Patient Zero candidates ranked by betweenness centrality"},
                {"question": "What are the NERC requirements for cascade failure protection?"},
                {"question": "Compare summer load patterns 2023 vs 2024 vs 2025"},
                {"question": "Which transformers show increasing stress over the past 3 years?"},
                {"question": "Estimate the cascade impact of losing the Northeast Houston 4 Substation"}
            ]
        },
        "tools": [
            {
                "tool_spec": {
                    "type": "cortex_analyst_text_to_sql",
                    "name": "Query_AMI_Data",
                    "description": "Query Grid Operations's comprehensive utility data warehouse combining real-time operations with 3-year historical analytics.\n\n## Data Assets (20 Objects)\n\n### Real-Time Operations (Jul-Aug 2025)\n**AMI_READINGS_ENHANCED**: 50M readings, 8,657 meters\n**GRID_RELIABILITY_METRICS**: SAIDI/SAIFI/CAIDI metrics\n**TRANSFORMER_HOURLY_LOAD**: Hourly stress levels\n\n### Historical Analytics (2023-2025)\n**ERCOT_LOAD_UNIFIED**: 23K hourly grid load records\n**SUMMER_LOAD_YOY_COMPARISON**: 3-year summer trends\n**ENERGY_BURDEN_ANALYSIS**: 3.3M records with 2024 baseline"
                }
            },
            {
                "tool_spec": {
                    "type": "cortex_search",
                    "name": "Search Documents",
                    "description": "Search Grid Operations's technical documentation library including equipment manuals, maintenance procedures, safety protocols, and regulatory compliance documents."
                }
            },
            {
                "tool_spec": {
                    "type": "cortex_search",
                    "name": "Cascade_Compliance_Search",
                    "description": "Search NERC/ERCOT compliance documents for cascade failure protection, vegetation management, emergency operations, and critical infrastructure standards.\n\n## Document Types:\n- **TPL-001-5**: Transmission System Planning\n- **FAC-003-4**: Vegetation Management\n- **EOP-011-3**: Emergency Operations\n- **CIP-002-5**: Critical Infrastructure Protection"
                }
            },
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "cascade_patient_zeros",
                    "description": "Get high-risk grid nodes ranked by TRUE NetworkX graph centrality metrics (betweenness, PageRank). These are ideal 'Patient Zero' candidates for cascade failure analysis.\n\nTop candidate: SUB-HOU-124 (Rayford Substation) with betweenness=0.906 - critical network bottleneck.\n\nReturns: node_id, node_name, cascade_risk_score, betweenness_centrality, pagerank, capacity_mw, downstream_customers",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "limit_count": {
                                "type": "integer",
                                "description": "Number of candidates to return (default 10)"
                            },
                            "only_true_centrality": {
                                "type": "boolean",
                                "description": "Only return nodes with computed NetworkX centrality (default true)"
                            }
                        }
                    }
                }
            },
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "cascade_impact",
                    "description": "Estimate cascade failure impact for a specific node using centrality metrics. Returns betweenness centrality, network reach (1/2/3 hop neighbors), customer impact estimates, and operational recommendations.\n\nExample: cascade_impact('SUB-HOU-124') returns impact of Rayford Substation failure: 1,296 direct neighbors, 64,800 customers affected, 'CRITICAL BOTTLENECK' assessment.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "patient_zero_id": {
                                "type": "string",
                                "description": "Node ID to analyze (e.g., 'SUB-HOU-124' for Rayford Substation, 'SUB-HOU-172' for Northeast Houston 4)"
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
                    "description": "Get recommended cascade simulation scenarios with parameters.\n\nScenarios:\n- Winter Storm Uri: temp=-10°C, load=1.8x, threshold=0.15\n- Summer Peak: temp=42°C, load=1.6x, threshold=0.20\n- Hurricane: temp=28°C, load=1.2x, threshold=0.10\n- Normal Operations: temp=25°C, load=1.0x, threshold=0.35\n\nRecommends SUB-HOU-124 (Rayford Substation) as Patient Zero due to highest betweenness centrality.",
                    "input_schema": {
                        "type": "object",
                        "properties": {}
                    }
                }
            },
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "geocode_coordinate",
                    "description": "Geographic location validation and reverse geocoding for utility service territory.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "lat": {"type": "number"},
                            "lon": {"type": "number"}
                        },
                        "required": ["lat", "lon"]
                    }
                }
            },
            {
                "tool_spec": {
                    "type": "generic",
                    "name": "enrich_unknown_locations",
                    "description": "Batch geocoding to resolve missing city names for AMI meter readings."
                }
            }
        ],
        "tool_resources": {
            "Query_AMI_Data": {
                "semantic_view": "SI_DEMOS.APPLICATIONS.CENTERPOINTENERGY_SEMANTIC_MODEL",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "SI_DEMO_WH_XL",
                    "query_timeout": 300
                }
            },
            "Search Documents": {
                "search_service": "SI_DEMOS.CENTERPOINTENERGY_AMI_DATA_DISCOVERY_DEMO_20251222_211240.TECHNICAL_MANUALS_PDF_CHUNKS_SEARCH_SERVICE",
                "max_results": 5,
                "title_column": "DOCUMENT_TYPE",
                "id_column": "CHUNK_ID"
            },
            "Cascade_Compliance_Search": {
                "search_service": "SI_DEMOS.ML_DEMO.COMPLIANCE_SEARCH",
                "max_results": 5,
                "title_column": "TITLE",
                "id_column": "CHUNK_ID"
            },
            "cascade_patient_zeros": {
                "type": "procedure",
                "identifier": "SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES",
                "name": "GET_PATIENT_ZERO_CANDIDATES(INTEGER, BOOLEAN)",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "SI_DEMO_WH",
                    "query_timeout": 60
                }
            },
            "cascade_impact": {
                "type": "procedure",
                "identifier": "SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT",
                "name": "ESTIMATE_CASCADE_IMPACT(VARCHAR)",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "SI_DEMO_WH",
                    "query_timeout": 60
                }
            },
            "cascade_scenarios": {
                "type": "procedure",
                "identifier": "SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS",
                "name": "GET_CASCADE_SCENARIO_RECOMMENDATIONS()",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "SI_DEMO_WH",
                    "query_timeout": 30
                }
            },
            "geocode_coordinate": {
                "type": "procedure",
                "identifier": "SI_DEMOS.PRODUCTION.RESOLVE_LOCATION",
                "name": "RESOLVE_LOCATION(FLOAT, FLOAT)",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "",
                    "query_timeout": 300
                }
            },
            "enrich_unknown_locations": {
                "type": "procedure",
                "identifier": "SI_DEMOS.PRODUCTION.PROCESS_UNKNOWN_LOCATIONS",
                "name": "PROCESS_UNKNOWN_LOCATIONS()",
                "execution_environment": {
                    "type": "warehouse",
                    "warehouse": "",
                    "query_timeout": 300
                }
            }
        }
    }
    $$;

-- Grant necessary permissions
GRANT USAGE ON AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CENTERPOINT_ENERGY_AGENT TO ROLE PUBLIC;

-- Grant execute on cascade procedures  
GRANT USAGE ON PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(INTEGER, BOOLEAN) TO ROLE PUBLIC;
GRANT USAGE ON PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT(VARCHAR) TO ROLE PUBLIC;
GRANT USAGE ON PROCEDURE SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS() TO ROLE PUBLIC;

-- Grant access to centrality data
GRANT SELECT ON TABLE SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 TO ROLE PUBLIC;

-- Verify the agent was updated
DESC AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CENTERPOINT_ENERGY_AGENT;

COMMIT;
