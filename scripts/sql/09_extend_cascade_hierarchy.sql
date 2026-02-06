-- ============================================================================
-- EXTEND CASCADE ANALYSIS TO FULL HIERARCHY
-- Substation → Transformer → Pole → Meter
-- ============================================================================
-- 
-- This script extends the cascade analysis graph to include poles and meters,
-- enabling end-to-end ML inference from substations down to customer meters.
--
-- Current coverage: 91,829 nodes (275 substations + 91,554 transformers)
-- Target coverage:  750,721 nodes (+62,038 poles + 596,906 meters)
--
-- Prerequisites:
--   - FLUX_DB.PRODUCTION.GRID_POLES_INFRASTRUCTURE populated
--   - FLUX_DB.PRODUCTION.METER_INFRASTRUCTURE populated
--   - FLUX_DB.ML_DEMO.GRID_NODES exists
--   - FLUX_DB.ML_DEMO.GRID_EDGES exists
--
-- Author: Cortex Code
-- Date: 2026-02-06
-- ============================================================================

USE DATABASE FLUX_DB;
USE WAREHOUSE FLUX_WH;

-- ============================================================================
-- STEP 1: Create Extended Node Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID VARCHAR(100) PRIMARY KEY,
    NODE_NAME VARCHAR(255),
    NODE_TYPE VARCHAR(50),  -- SUBSTATION, TRANSFORMER, POLE, METER
    LAT FLOAT,
    LON FLOAT,
    CAPACITY_KW FLOAT,
    VOLTAGE_KV FLOAT,
    CRITICALITY_SCORE FLOAT,
    DOWNSTREAM_TRANSFORMERS INT DEFAULT 0,
    DOWNSTREAM_CAPACITY_KVA FLOAT DEFAULT 0,
    PARENT_NODE_ID VARCHAR(100),  -- Hierarchical link
    HIERARCHY_LEVEL INT,  -- 1=SUB, 2=XFMR, 3=POLE, 4=METER
    HEALTH_SCORE FLOAT,
    COUNTY_NAME VARCHAR(100),
    CITY VARCHAR(100),
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ============================================================================
-- STEP 2: Copy existing nodes (Substations + Transformers)
-- ============================================================================

INSERT INTO ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS, DOWNSTREAM_CAPACITY_KVA,
    PARENT_NODE_ID, HIERARCHY_LEVEL, HEALTH_SCORE
)
SELECT 
    NODE_ID,
    NODE_NAME,
    NODE_TYPE,
    LAT,
    LON,
    CAPACITY_KW,
    VOLTAGE_KV,
    CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS,
    DOWNSTREAM_CAPACITY_KVA,
    NULL,  -- Will update parent links after
    CASE NODE_TYPE 
        WHEN 'SUBSTATION' THEN 1 
        WHEN 'TRANSFORMER' THEN 2 
        ELSE 3 
    END,
    CRITICALITY_SCORE * 100  -- Normalize to health score
FROM ML_DEMO.GRID_NODES
WHERE NODE_ID NOT IN (SELECT NODE_ID FROM ML_DEMO.GRID_NODES_EXTENDED);

-- Update transformer parent links to substations
UPDATE ML_DEMO.GRID_NODES_EXTENDED t
SET PARENT_NODE_ID = (
    SELECT DISTINCT e.FROM_NODE_ID 
    FROM ML_DEMO.GRID_EDGES e
    WHERE e.TO_NODE_ID = t.NODE_ID 
      AND e.EDGE_TYPE = 'DISTRIBUTION'
    LIMIT 1
)
WHERE t.NODE_TYPE = 'TRANSFORMER' AND t.PARENT_NODE_ID IS NULL;

-- ============================================================================
-- STEP 3: Add Poles to Extended Node Table
-- ============================================================================

INSERT INTO ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS, PARENT_NODE_ID,
    HIERARCHY_LEVEL, HEALTH_SCORE, COUNTY_NAME
)
SELECT 
    p.POLE_ID,
    COALESCE(p.POLE_ID, 'Pole ' || p.OSM_POLE_ID),
    'POLE',
    p.LATITUDE,
    p.LONGITUDE,
    5.0,  -- ~5kW distribution capacity per pole
    12.47,  -- Standard distribution voltage
    COALESCE(p.HEALTH_SCORE, 85) / 100.0,  -- Normalize to 0-1
    0,  -- Poles don't have downstream transformers
    p.TRANSFORMER_ID,  -- Parent is transformer
    3,  -- Hierarchy level 3
    COALESCE(p.HEALTH_SCORE, 85),
    NULL  -- County will be enriched later
FROM PRODUCTION.GRID_POLES_INFRASTRUCTURE p
WHERE p.TRANSFORMER_ID IS NOT NULL
  AND p.POLE_ID NOT IN (SELECT NODE_ID FROM ML_DEMO.GRID_NODES_EXTENDED);

-- ============================================================================
-- STEP 4: Add Meters to Extended Node Table
-- ============================================================================

INSERT INTO ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS, PARENT_NODE_ID,
    HIERARCHY_LEVEL, HEALTH_SCORE, COUNTY_NAME, CITY
)
SELECT 
    m.METER_ID,
    m.METER_ID,
    'METER',
    m.METER_LATITUDE,
    m.METER_LONGITUDE,
    0.5,  -- ~500W per residential meter
    0.120,  -- 120V service voltage
    COALESCE(m.HEALTH_SCORE, 90) / 100.0,
    0,
    -- Link to pole if available, otherwise transformer
    COALESCE(
        NULLIF(m.POLE_ID, ''),
        m.TRANSFORMER_ID
    ),
    4,  -- Hierarchy level 4
    COALESCE(m.HEALTH_SCORE, 90),
    m.COUNTY_NAME,
    m.CITY
FROM PRODUCTION.METER_INFRASTRUCTURE m
WHERE m.TRANSFORMER_ID IS NOT NULL
  AND m.METER_ID NOT IN (SELECT NODE_ID FROM ML_DEMO.GRID_NODES_EXTENDED);

-- ============================================================================
-- STEP 5: Create Extended Edge Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID VARCHAR(200) PRIMARY KEY,
    FROM_NODE_ID VARCHAR(100),
    TO_NODE_ID VARCHAR(100),
    EDGE_TYPE VARCHAR(50),  -- TRANSMISSION, DISTRIBUTION, POLE_CONNECTION, METER_CONNECTION
    DISTANCE_KM FLOAT,
    IMPEDANCE_OHMS FLOAT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Copy existing edges
INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM
)
SELECT 
    FROM_NODE_ID || '_' || TO_NODE_ID,
    FROM_NODE_ID,
    TO_NODE_ID,
    EDGE_TYPE,
    DISTANCE_KM
FROM ML_DEMO.GRID_EDGES
WHERE FROM_NODE_ID || '_' || TO_NODE_ID NOT IN (
    SELECT EDGE_ID FROM ML_DEMO.GRID_EDGES_EXTENDED
);

-- ============================================================================
-- STEP 6: Add Pole-to-Transformer Edges
-- ============================================================================

INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM
)
SELECT 
    p.POLE_ID || '_' || p.TRANSFORMER_ID,
    p.TRANSFORMER_ID,  -- From transformer
    p.POLE_ID,         -- To pole
    'POLE_CONNECTION',
    -- Calculate actual distance if coordinates available
    CASE 
        WHEN t.LAT IS NOT NULL AND p.LATITUDE IS NOT NULL THEN
            SQRT(
                POW((p.LATITUDE - t.LAT) * 111, 2) + 
                POW((p.LONGITUDE - t.LON) * 111 * COS(RADIANS(p.LATITUDE)), 2)
            )
        ELSE 0.1  -- Default 100m
    END
FROM PRODUCTION.GRID_POLES_INFRASTRUCTURE p
JOIN ML_DEMO.GRID_NODES_EXTENDED t ON p.TRANSFORMER_ID = t.NODE_ID
WHERE p.TRANSFORMER_ID IS NOT NULL
  AND p.POLE_ID || '_' || p.TRANSFORMER_ID NOT IN (
      SELECT EDGE_ID FROM ML_DEMO.GRID_EDGES_EXTENDED
  );

-- ============================================================================
-- STEP 7: Add Meter-to-Pole Edges
-- ============================================================================

INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM
)
SELECT 
    m.METER_ID || '_' || m.POLE_ID,
    m.POLE_ID,    -- From pole
    m.METER_ID,   -- To meter
    'METER_CONNECTION',
    -- Calculate actual distance
    CASE 
        WHEN p.LATITUDE IS NOT NULL AND m.METER_LATITUDE IS NOT NULL THEN
            SQRT(
                POW((m.METER_LATITUDE - p.LATITUDE) * 111, 2) + 
                POW((m.METER_LONGITUDE - p.LONGITUDE) * 111 * COS(RADIANS(m.METER_LATITUDE)), 2)
            )
        ELSE 0.05  -- Default 50m
    END
FROM PRODUCTION.METER_INFRASTRUCTURE m
JOIN PRODUCTION.GRID_POLES_INFRASTRUCTURE p ON m.POLE_ID = p.POLE_ID
WHERE m.POLE_ID IS NOT NULL AND m.POLE_ID != ''
  AND m.METER_ID || '_' || m.POLE_ID NOT IN (
      SELECT EDGE_ID FROM ML_DEMO.GRID_EDGES_EXTENDED
  );

-- Add direct meter-to-transformer edges for meters without poles
INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM
)
SELECT 
    m.METER_ID || '_' || m.TRANSFORMER_ID,
    m.TRANSFORMER_ID,  -- From transformer
    m.METER_ID,        -- To meter
    'METER_DIRECT',
    0.1  -- Default 100m
FROM PRODUCTION.METER_INFRASTRUCTURE m
WHERE (m.POLE_ID IS NULL OR m.POLE_ID = '')
  AND m.TRANSFORMER_ID IS NOT NULL
  AND m.METER_ID || '_' || m.TRANSFORMER_ID NOT IN (
      SELECT EDGE_ID FROM ML_DEMO.GRID_EDGES_EXTENDED
  );

-- ============================================================================
-- STEP 8: Create Extended Centrality Features Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED (
    NODE_ID VARCHAR(100) PRIMARY KEY,
    NODE_TYPE VARCHAR(50),
    DEGREE_CENTRALITY FLOAT,
    BETWEENNESS_CENTRALITY FLOAT,
    PAGERANK FLOAT,
    EIGENVECTOR_CENTRALITY FLOAT,
    CASCADE_RISK_SCORE FLOAT,
    DOWNSTREAM_CUSTOMERS INT DEFAULT 0,
    HIERARCHY_DEPTH INT,
    COMPUTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ============================================================================
-- STEP 9: Create Extended GNN Predictions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS CASCADE_ANALYSIS.GNN_PREDICTIONS_EXTENDED (
    NODE_ID VARCHAR(100) PRIMARY KEY,
    NODE_TYPE VARCHAR(50),
    CRITICALITY_SCORE FLOAT,
    GNN_CASCADE_RISK FLOAT,
    CONFIDENCE_SCORE FLOAT,
    PREDICTION_TIMESTAMP TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ============================================================================
-- STEP 10: Validation Queries
-- ============================================================================

-- Check node coverage by type
SELECT 
    NODE_TYPE,
    COUNT(*) as node_count,
    AVG(CRITICALITY_SCORE) as avg_criticality,
    COUNT(PARENT_NODE_ID) as with_parent_link
FROM ML_DEMO.GRID_NODES_EXTENDED
GROUP BY NODE_TYPE
ORDER BY HIERARCHY_LEVEL;

-- Check edge coverage by type
SELECT 
    EDGE_TYPE,
    COUNT(*) as edge_count,
    AVG(DISTANCE_KM) as avg_distance_km
FROM ML_DEMO.GRID_EDGES_EXTENDED
GROUP BY EDGE_TYPE;

-- Verify hierarchy integrity
SELECT 
    'Orphan Poles' as check_name,
    COUNT(*) as count
FROM ML_DEMO.GRID_NODES_EXTENDED n
WHERE n.NODE_TYPE = 'POLE' 
  AND n.PARENT_NODE_ID NOT IN (
      SELECT NODE_ID FROM ML_DEMO.GRID_NODES_EXTENDED WHERE NODE_TYPE = 'TRANSFORMER'
  )
UNION ALL
SELECT 
    'Orphan Meters',
    COUNT(*)
FROM ML_DEMO.GRID_NODES_EXTENDED n
WHERE n.NODE_TYPE = 'METER' 
  AND n.PARENT_NODE_ID NOT IN (
      SELECT NODE_ID FROM ML_DEMO.GRID_NODES_EXTENDED WHERE NODE_TYPE IN ('TRANSFORMER', 'POLE')
  );

-- ============================================================================
-- Expected Output:
-- NODE_TYPE    | node_count | avg_criticality | with_parent_link
-- SUBSTATION   | 275        | 0.96            | 0
-- TRANSFORMER  | 91,554     | 0.25            | 91,554
-- POLE         | 62,038     | 0.85            | 62,038
-- METER        | 596,906    | 0.90            | 596,906
-- TOTAL        | 750,773    |                 |
-- ============================================================================
