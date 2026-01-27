-- ============================================================================
-- Priority 5: Pre-Computed Cascade Scenarios
-- Engineering: Instant demo scenarios with pre-computed cascade analysis
-- ============================================================================

-- Create schema for cascade analysis results
CREATE SCHEMA IF NOT EXISTS SI_DEMOS.CASCADE_ANALYSIS;

-- Grant access
GRANT USAGE ON SCHEMA SI_DEMOS.CASCADE_ANALYSIS TO ROLE ACCOUNTADMIN;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA SI_DEMOS.CASCADE_ANALYSIS TO ROLE ACCOUNTADMIN;
GRANT ALL PRIVILEGES ON FUTURE TABLES IN SCHEMA SI_DEMOS.CASCADE_ANALYSIS TO ROLE ACCOUNTADMIN;

-- ============================================================================
-- 1. Graph Centrality Features for ML Model Enhancement
-- Uses node metadata (downstream_transformers, downstream_capacity) as proxy
-- for graph centrality since full graph traversal is expensive at scale
-- ============================================================================

CREATE OR REPLACE TABLE SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES AS
SELECT 
    n.NODE_ID,
    n.NODE_TYPE,
    n.CAPACITY_KW,
    n.VOLTAGE_KV,
    n.CRITICALITY_SCORE,
    n.DOWNSTREAM_TRANSFORMERS AS DEGREE_CENTRALITY,
    0 AS DISTRIBUTION_DEGREE,
    0 AS PEER_DEGREE,
    n.CRITICALITY_SCORE AS NORMALIZED_DEGREE,
    n.DOWNSTREAM_TRANSFORMERS AS NEIGHBORS_1HOP,
    n.DOWNSTREAM_CAPACITY_KVA / 1000 AS NEIGHBORS_2HOP,
    CASE WHEN n.DOWNSTREAM_TRANSFORMERS > 0 
         THEN (n.DOWNSTREAM_CAPACITY_KVA / 1000.0) / n.DOWNSTREAM_TRANSFORMERS 
         ELSE 0 END AS REACH_EXPANSION_RATIO,
    CURRENT_TIMESTAMP() AS COMPUTED_AT
FROM SI_DEMOS.ML_DEMO.GRID_NODES n
WHERE n.NODE_TYPE = 'SUBSTATION';

-- ============================================================================
-- 2. Pre-Computed Cascade Scenarios Table
-- ============================================================================

CREATE OR REPLACE TABLE SI_DEMOS.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES (
    scenario_id VARCHAR(100),
    scenario_name VARCHAR(255),
    patient_zero_id VARCHAR(100),
    patient_zero_name VARCHAR(255),
    simulation_params VARIANT,
    cascade_order VARIANT,           -- Array of {node_id, order, wave_depth}
    wave_breakdown VARIANT,          -- Array of {wave_number, nodes_failed, capacity_lost_mw, ...}
    node_type_breakdown VARIANT,     -- Array of {source, target, value}
    propagation_paths VARIANT,       -- Array of {from_node, to_node, order, distance_km}
    total_affected_nodes INTEGER,
    affected_capacity_mw FLOAT,
    estimated_customers_affected INTEGER,
    max_cascade_depth INTEGER,
    simulation_timestamp TIMESTAMP_NTZ,
    computed_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ============================================================================
-- 3. High Risk Patient Zeros View
-- ============================================================================

CREATE OR REPLACE VIEW SI_DEMOS.CASCADE_ANALYSIS.HIGH_RISK_PATIENT_ZEROS AS
SELECT 
    n.NODE_ID,
    n.NODE_NAME,
    n.NODE_TYPE,
    n.CAPACITY_KW,
    n.VOLTAGE_KV,
    n.CRITICALITY_SCORE,
    n.DOWNSTREAM_TRANSFORMERS,
    n.DOWNSTREAM_CAPACITY_KVA,
    c.DEGREE_CENTRALITY,
    c.NEIGHBORS_2HOP AS NETWORK_REACH,
    -- Combined risk score
    (n.CRITICALITY_SCORE * 0.4 + 
     COALESCE(c.NORMALIZED_DEGREE, 0) * 0.3 + 
     COALESCE(c.REACH_EXPANSION_RATIO, 0) * 0.3) AS CASCADE_RISK_SCORE
FROM SI_DEMOS.ML_DEMO.GRID_NODES n
LEFT JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES c ON n.NODE_ID = c.NODE_ID
WHERE n.NODE_TYPE = 'SUBSTATION'
  AND n.CRITICALITY_SCORE > 0.5
ORDER BY CASCADE_RISK_SCORE DESC
LIMIT 10;

-- ============================================================================
-- 4. Pre-Computed Winter Storm Uri Demo Scenario
-- ============================================================================

INSERT INTO SI_DEMOS.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES (
    scenario_id, scenario_name, patient_zero_id, patient_zero_name,
    simulation_params, cascade_order, wave_breakdown, node_type_breakdown,
    propagation_paths, total_affected_nodes, affected_capacity_mw,
    estimated_customers_affected, max_cascade_depth, simulation_timestamp
)
SELECT
    'winter_storm_uri_2021_demo',
    'Winter Storm Uri 2021',
    'SUB-HOU-010',
    'Roark Substation',
    PARSE_JSON('{"temperature_c": -10, "load_multiplier": 1.8, "failure_threshold": 0.3}'),
    PARSE_JSON('[
      {"node_id": "SUB-HOU-010", "node_name": "Roark Substation", "node_type": "SUBSTATION", "order": 0, "wave_depth": 0, "capacity_kw": 270000, "downstream_transformers": 1756, "lat": 29.9511, "lon": -95.4134},
      {"node_id": "SUB-HOU-121", "node_name": "Kingwood Substation", "node_type": "SUBSTATION", "order": 1, "wave_depth": 1, "capacity_kw": 270000, "downstream_transformers": 1613, "lat": 30.0380, "lon": -95.2010},
      {"node_id": "SUB-HOU-006", "node_name": "Cardiff Substation", "node_type": "SUBSTATION", "order": 2, "wave_depth": 1, "capacity_kw": 270000, "downstream_transformers": 1590, "lat": 29.8321, "lon": -95.3890},
      {"node_id": "SUB-HOU-142", "node_name": "Kuykendahl Substation", "node_type": "SUBSTATION", "order": 3, "wave_depth": 2, "capacity_kw": 280000, "downstream_transformers": 1422, "lat": 30.0120, "lon": -95.4823},
      {"node_id": "SUB-HOU-096", "node_name": "Crosby Substation", "node_type": "SUBSTATION", "order": 4, "wave_depth": 2, "capacity_kw": 270000, "downstream_transformers": 1391, "lat": 29.9100, "lon": -95.0612}
    ]'),
    PARSE_JSON('[
      {"wave_number": 0, "nodes_failed": 1, "capacity_lost_mw": 270, "customers_affected": 87800, "substations": 1, "transformers": 0},
      {"wave_number": 1, "nodes_failed": 2, "capacity_lost_mw": 540, "customers_affected": 160150, "substations": 2, "transformers": 0},
      {"wave_number": 2, "nodes_failed": 2, "capacity_lost_mw": 550, "customers_affected": 140650, "substations": 2, "transformers": 0}
    ]'),
    NULL,
    PARSE_JSON('[
      {"from_node": "SUB-HOU-010", "to_node": "SUB-HOU-121", "order": 1, "distance_km": 12.5},
      {"from_node": "SUB-HOU-010", "to_node": "SUB-HOU-006", "order": 2, "distance_km": 8.3},
      {"from_node": "SUB-HOU-121", "to_node": "SUB-HOU-142", "order": 3, "distance_km": 6.7},
      {"from_node": "SUB-HOU-006", "to_node": "SUB-HOU-096", "order": 4, "distance_km": 15.2}
    ]'),
    5,
    1360.0,
    388600,
    2,
    CURRENT_TIMESTAMP()
WHERE NOT EXISTS (
    SELECT 1 FROM SI_DEMOS.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES 
    WHERE scenario_id = 'winter_storm_uri_2021_demo'
);

-- ============================================================================
-- 5. API View for Pre-computed Cascades
-- ============================================================================

CREATE OR REPLACE VIEW SI_DEMOS.CASCADE_ANALYSIS.V_PRECOMPUTED_SCENARIOS AS
SELECT 
    scenario_id,
    scenario_name,
    patient_zero_id,
    patient_zero_name,
    total_affected_nodes,
    affected_capacity_mw,
    estimated_customers_affected,
    max_cascade_depth,
    simulation_params,
    simulation_timestamp
FROM SI_DEMOS.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES
ORDER BY computed_at DESC;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES IS 
'Engineering: Graph centrality features for ML model enhancement. Uses downstream metrics as proxy for graph centrality.';

COMMENT ON TABLE SI_DEMOS.CASCADE_ANALYSIS.PRECOMPUTED_CASCADES IS 
'Engineering: Pre-computed cascade scenarios for instant demo delivery. Winter Storm Uri and other historical scenarios.';

COMMENT ON VIEW SI_DEMOS.CASCADE_ANALYSIS.HIGH_RISK_PATIENT_ZEROS IS 
'Engineering: Top 10 high-risk substations for cascade failure initiation based on criticality and network position.';

-- ============================================================================
-- Verification
-- ============================================================================

-- SELECT * FROM SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES LIMIT 5;
-- SELECT * FROM SI_DEMOS.CASCADE_ANALYSIS.HIGH_RISK_PATIENT_ZEROS;
-- SELECT * FROM SI_DEMOS.CASCADE_ANALYSIS.V_PRECOMPUTED_SCENARIOS;
