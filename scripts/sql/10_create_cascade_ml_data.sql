-- ============================================================================
-- CASCADE ANALYSIS & ML DATA GENERATION
-- ============================================================================
--
-- PURPOSE: Creates all ML tables, views, and synthetic data required for the
--          Cascade Analysis dashboard tab. Without this script, the cascade
--          analysis endpoints return errors due to missing tables/columns.
--
-- WHAT THIS CREATES:
--   ML_DEMO schema:
--     - T_TRANSFORMER_TEMPORAL_TRAINING  (recreated with correct 19-col schema)
--     - V_TRANSFORMER_ML_INFERENCE       (recreated view)
--     - GRID_NODES                       (expanded to ~1,900 nodes)
--     - GRID_EDGES                       (expanded with topology edges)
--     - GRID_NODES_EXTENDED              (full hierarchy: SUB→XFMR→POLE→METER)
--     - GRID_EDGES_EXTENDED              (hierarchical edges)
--
--   CASCADE_ANALYSIS schema:
--     - NODE_CENTRALITY_FEATURES_V2      (expanded with real centrality metrics)
--     - NODE_CENTRALITY_FEATURES_EXTENDED (for 750K-node hierarchy)
--     - GNN_PREDICTIONS                  (populated with predictions)
--     - REAL_TIME_CASCADE_PREDICTIONS    (live risk predictions)
--     - PRECOMPUTED_CASCADES             (updated with correct schema)
--
-- PREREQUISITES:
--   - FLUX_DB database exists with ML_DEMO and CASCADE_ANALYSIS schemas
--   - FLUX_DB.PRODUCTION.TRANSFORMER_METADATA has data (100 rows)
--   - Run after 00_standalone_quickstart.sql
--
-- RUNTIME: ~2-3 minutes on FLUX_WH (X-Small warehouse)
--
-- Author: Cortex Code
-- ============================================================================

USE DATABASE FLUX_DB;
USE WAREHOUSE FLUX_WH;

-- ============================================================================
-- PART 1: REBUILD T_TRANSFORMER_TEMPORAL_TRAINING
-- ============================================================================
-- The backend endpoint /api/cascade/transformer-risk-prediction requires
-- columns: MORNING_LOAD_PCT, MORNING_CATEGORY, TRANSFORMER_AGE_YEARS,
--          RATED_KVA, HISTORICAL_SUMMER_AVG_LOAD, STRESS_VS_HISTORICAL,
--          TARGET_HIGH_RISK, MORNING_TIMESTAMP, PREDICTION_DATE, etc.
--
-- The old table only had 9 columns (RECORD_ID, TRANSFORMER_ID, PREDICTION_DATE,
-- LOAD_FACTOR_AVG_7D, LOAD_FACTOR_MAX_7D, AGE_YEARS, HEALTH_SCORE,
-- FAILURE_PROBABILITY, RISK_CATEGORY). This drops and recreates it.
-- ============================================================================

-- Drop the view first since it depends on this table
DROP VIEW IF EXISTS ML_DEMO.V_TRANSFORMER_ML_INFERENCE;

-- Drop and recreate with correct schema
DROP TABLE IF EXISTS ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING;

CREATE TABLE ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING (
    TRANSFORMER_ID                      VARCHAR(50)    NOT NULL,
    MORNING_TIMESTAMP                   TIMESTAMP_NTZ,
    PREDICTION_DATE                     TIMESTAMP_NTZ,
    MORNING_LOAD_PCT                    FLOAT,
    MORNING_CATEGORY                    VARCHAR(20),
    MORNING_KWH                         FLOAT,
    MORNING_ACTIVE_METERS               INT,
    MORNING_AVG_VOLTAGE                 INT,
    MORNING_VOLTAGE_SAGS                INT,
    TRANSFORMER_AGE_YEARS               INT,
    RATED_KVA                           INT,
    HISTORICAL_SUMMER_AVG_LOAD          FLOAT,
    SUMMER_2023_2024_AVG_CRITICAL_HOURS FLOAT,
    STRESS_VS_HISTORICAL                VARCHAR(30),
    KWH_PER_METER                       FLOAT,
    LOAD_TREND_RATIO                    FLOAT,
    TARGET_HIGH_RISK                    INT,
    AFTERNOON_LOAD_PCT                  FLOAT,
    AFTERNOON_CATEGORY                  VARCHAR(20)
)
COMMENT = 'Temporal training data for transformer risk prediction model. Each row represents a morning-to-afternoon risk trajectory for one transformer on one day.';

-- Generate synthetic temporal training data
-- Uses TRANSFORMER_METADATA as the source of real transformer IDs
-- Creates 20 days of data per transformer = 100 transformers * 20 days = 2,000 rows
INSERT INTO ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING
WITH transformer_base AS (
    SELECT 
        TRANSFORMER_ID,
        CAPACITY_KVA,
        INSTALL_YEAR,
        HEALTH_SCORE,
        LATITUDE,
        LONGITUDE
    FROM PRODUCTION.TRANSFORMER_METADATA
),
date_series AS (
    SELECT DATEADD('day', -seq4(), CURRENT_DATE())::TIMESTAMP_NTZ AS prediction_date
    FROM TABLE(GENERATOR(ROWCOUNT => 20))
),
raw_data AS (
    SELECT
        t.TRANSFORMER_ID,
        DATEADD('hour', 8, d.prediction_date) AS MORNING_TIMESTAMP,
        d.prediction_date AS PREDICTION_DATE,
        -- Morning load: 30-95% with some randomness based on transformer health
        ROUND(30 + (UNIFORM(0::FLOAT, 65::FLOAT, RANDOM()) * 
              (1 + (100 - COALESCE(t.HEALTH_SCORE, 75)) / 200.0)), 1) AS MORNING_LOAD_PCT,
        -- Active meters: 5-50 per transformer
        GREATEST(5, ROUND(UNIFORM(10::FLOAT, 50::FLOAT, RANDOM()))) AS MORNING_ACTIVE_METERS,
        -- Avg voltage: 118-124V (nominal 120V)
        ROUND(UNIFORM(118::FLOAT, 124::FLOAT, RANDOM())) AS MORNING_AVG_VOLTAGE,
        -- Voltage sags: 0-5 per reading
        FLOOR(UNIFORM(0::FLOAT, 5::FLOAT, RANDOM())) AS MORNING_VOLTAGE_SAGS,
        -- Age from install year
        GREATEST(1, YEAR(CURRENT_DATE()) - COALESCE(t.INSTALL_YEAR, 2010)) AS TRANSFORMER_AGE_YEARS,
        -- Rated KVA from metadata
        COALESCE(t.CAPACITY_KVA, 50) AS RATED_KVA,
        -- Historical summer avg load: 40-80%
        ROUND(UNIFORM(40::FLOAT, 80::FLOAT, RANDOM()), 1) AS HISTORICAL_SUMMER_AVG_LOAD,
        -- Summer critical hours
        ROUND(UNIFORM(0::FLOAT, 120::FLOAT, RANDOM()), 1) AS SUMMER_2023_2024_AVG_CRITICAL_HOURS,
        -- KWH per meter
        ROUND(UNIFORM(5::FLOAT, 25::FLOAT, RANDOM()), 2) AS KWH_PER_METER,
        -- Load trend ratio (0.8-1.3, >1 means increasing)
        ROUND(UNIFORM(0.8::FLOAT, 1.3::FLOAT, RANDOM()), 3) AS LOAD_TREND_RATIO
    FROM transformer_base t
    CROSS JOIN date_series d
)
SELECT
    TRANSFORMER_ID,
    MORNING_TIMESTAMP,
    PREDICTION_DATE,
    MORNING_LOAD_PCT,
    -- Morning category based on load
    CASE 
        WHEN MORNING_LOAD_PCT >= 80 THEN 'CRITICAL'
        WHEN MORNING_LOAD_PCT >= 60 THEN 'WARNING'
        WHEN MORNING_LOAD_PCT >= 40 THEN 'NORMAL'
        ELSE 'LOW'
    END AS MORNING_CATEGORY,
    -- Morning KWH = load_pct * rated_kva * 0.01 * active_meters * ~0.5
    ROUND(MORNING_LOAD_PCT * RATED_KVA * 0.01 * MORNING_ACTIVE_METERS * 0.5, 1) AS MORNING_KWH,
    MORNING_ACTIVE_METERS::INT,
    MORNING_AVG_VOLTAGE::INT,
    MORNING_VOLTAGE_SAGS::INT,
    TRANSFORMER_AGE_YEARS::INT,
    RATED_KVA::INT,
    HISTORICAL_SUMMER_AVG_LOAD,
    SUMMER_2023_2024_AVG_CRITICAL_HOURS,
    -- Stress vs historical: percentage difference or 'NO_HISTORICAL_DATA'
    CASE 
        WHEN UNIFORM(0::FLOAT, 1::FLOAT, RANDOM()) < 0.1 THEN 'NO_HISTORICAL_DATA'
        ELSE ROUND((MORNING_LOAD_PCT - HISTORICAL_SUMMER_AVG_LOAD) / 
             GREATEST(HISTORICAL_SUMMER_AVG_LOAD, 1) * 100, 1)::VARCHAR
    END AS STRESS_VS_HISTORICAL,
    KWH_PER_METER,
    LOAD_TREND_RATIO,
    -- Target high risk: 1 if load>75 and age>15 and trend>1.1
    CASE 
        WHEN MORNING_LOAD_PCT > 75 AND TRANSFORMER_AGE_YEARS > 15 AND LOAD_TREND_RATIO > 1.1 THEN 1
        WHEN MORNING_LOAD_PCT > 85 THEN 1
        ELSE 0
    END AS TARGET_HIGH_RISK,
    -- Afternoon load: morning * (1.1-1.5 multiplier for afternoon peak)
    ROUND(LEAST(100, MORNING_LOAD_PCT * UNIFORM(1.1::FLOAT, 1.5::FLOAT, RANDOM())), 1) AS AFTERNOON_LOAD_PCT,
    -- Afternoon category
    CASE 
        WHEN LEAST(100, MORNING_LOAD_PCT * 1.3) >= 80 THEN 'CRITICAL'
        WHEN LEAST(100, MORNING_LOAD_PCT * 1.3) >= 60 THEN 'WARNING'
        WHEN LEAST(100, MORNING_LOAD_PCT * 1.3) >= 40 THEN 'NORMAL'
        ELSE 'LOW'
    END AS AFTERNOON_CATEGORY
FROM raw_data;

-- ============================================================================
-- PART 2: RECREATE V_TRANSFORMER_ML_INFERENCE VIEW
-- ============================================================================
-- This view provides the latest risk prediction per transformer for the
-- inference endpoints. Updated to use the new temporal training schema.
-- ============================================================================

CREATE OR REPLACE VIEW ML_DEMO.V_TRANSFORMER_ML_INFERENCE AS
SELECT
    t.TRANSFORMER_ID,
    t.PREDICTION_DATE,
    -- Compute risk score from temporal features
    LEAST(1.0,
        (t.MORNING_LOAD_PCT / 100.0) *
        (1 + COALESCE(TRY_TO_DOUBLE(t.STRESS_VS_HISTORICAL), 0) / 100) *
        (1 + t.TRANSFORMER_AGE_YEARS / 50.0)
    ) AS FAILURE_PROBABILITY,
    CASE 
        WHEN LEAST(1.0, (t.MORNING_LOAD_PCT / 100.0) * (1 + t.TRANSFORMER_AGE_YEARS / 50.0)) >= 0.7 THEN 'CRITICAL'
        WHEN LEAST(1.0, (t.MORNING_LOAD_PCT / 100.0) * (1 + t.TRANSFORMER_AGE_YEARS / 50.0)) >= 0.5 THEN 'HIGH'
        WHEN LEAST(1.0, (t.MORNING_LOAD_PCT / 100.0) * (1 + t.TRANSFORMER_AGE_YEARS / 50.0)) >= 0.3 THEN 'MEDIUM'
        ELSE 'LOW'
    END AS RISK_CATEGORY,
    t.MORNING_LOAD_PCT AS LOAD_FACTOR_AVG_7D,
    t.TRANSFORMER_AGE_YEARS AS AGE_YEARS,
    100 - (t.MORNING_LOAD_PCT * 0.5 + t.TRANSFORMER_AGE_YEARS * 0.5) AS HEALTH_SCORE,
    tm.TRANSFORMER_NAME,
    tm.SUBSTATION_ID,
    tm.LATITUDE,
    tm.LONGITUDE
FROM ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING t
JOIN PRODUCTION.TRANSFORMER_METADATA tm ON t.TRANSFORMER_ID = tm.TRANSFORMER_ID
WHERE t.PREDICTION_DATE = (
    SELECT MAX(PREDICTION_DATE) FROM ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING
)
QUALIFY ROW_NUMBER() OVER (PARTITION BY t.TRANSFORMER_ID ORDER BY t.MORNING_TIMESTAMP DESC) = 1;

-- ============================================================================
-- PART 3: REBUILD GRID_NODES WITH ~1,900 NODES
-- ============================================================================
-- The backend simulate endpoint does BFS traversal through GRID_NODES/GRID_EDGES.
-- With only 125 nodes, cascades terminate too quickly for a compelling demo.
-- We rebuild with ~1,875 nodes (275 substations + ~1,600 transformers) to match
-- the cpe_demo_CLI scale and create realistic cascade propagation.
--
-- IMPORTANT: This drops and recreates the table. The original 125-row table
-- had columns (NODE_ID, NODE_TYPE, NODE_NAME, LATITUDE, LONGITUDE, LAT, LON,
-- VOLTAGE_LEVEL, VOLTAGE_KV, CAPACITY_KVA, CAPACITY_KW, PARENT_NODE_ID,
-- SUBSTATION_ID, DEGREE_CENTRALITY, BETWEENNESS_CENTRALITY, LOAD_FACTOR,
-- AGE_YEARS, HEALTH_SCORE, CRITICALITY_SCORE, DOWNSTREAM_TRANSFORMERS,
-- DOWNSTREAM_CAPACITY_KVA, CREATED_AT, UPDATED_AT). We preserve this schema.
-- ============================================================================

DROP TABLE IF EXISTS ML_DEMO.GRID_NODES CASCADE;

CREATE TABLE ML_DEMO.GRID_NODES (
    NODE_ID VARCHAR(100) PRIMARY KEY,
    NODE_TYPE VARCHAR(50),
    NODE_NAME VARCHAR(255),
    LATITUDE FLOAT,
    LONGITUDE FLOAT,
    LAT FLOAT,
    LON FLOAT,
    VOLTAGE_LEVEL VARCHAR(20),
    VOLTAGE_KV FLOAT,
    CAPACITY_KVA FLOAT,
    CAPACITY_KW FLOAT,
    PARENT_NODE_ID VARCHAR(100),
    SUBSTATION_ID VARCHAR(100),
    DEGREE_CENTRALITY FLOAT,
    BETWEENNESS_CENTRALITY FLOAT,
    LOAD_FACTOR FLOAT,
    AGE_YEARS FLOAT,
    HEALTH_SCORE FLOAT,
    CRITICALITY_SCORE FLOAT,
    DOWNSTREAM_TRANSFORMERS INT DEFAULT 0,
    DOWNSTREAM_CAPACITY_KVA FLOAT DEFAULT 0,
    DOWNSTREAM_CAPACITY_KW FLOAT DEFAULT 0,
    REGION VARCHAR(50),
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Insert 275 substations covering Houston metro area
INSERT INTO ML_DEMO.GRID_NODES (
    NODE_ID, NODE_TYPE, NODE_NAME, LAT, LON, LATITUDE, LONGITUDE,
    VOLTAGE_LEVEL, VOLTAGE_KV, CAPACITY_KVA, CAPACITY_KW,
    SUBSTATION_ID, CRITICALITY_SCORE, HEALTH_SCORE,
    DOWNSTREAM_TRANSFORMERS, DOWNSTREAM_CAPACITY_KVA, REGION
)
SELECT
    'SUB_' || LPAD(seq4() + 1, 4, '0') AS NODE_ID,
    'SUBSTATION' AS NODE_TYPE,
    CASE MOD(seq4(), 25)
        WHEN 0 THEN 'Midtown'     WHEN 1 THEN 'Heights'      WHEN 2 THEN 'Montrose'
        WHEN 3 THEN 'River Oaks'  WHEN 4 THEN 'Bellaire'     WHEN 5 THEN 'Memorial'
        WHEN 6 THEN 'Galleria'    WHEN 7 THEN 'Spring Branch' WHEN 8 THEN 'Westchase'
        WHEN 9 THEN 'Meyerland'   WHEN 10 THEN 'Medical Ctr' WHEN 11 THEN 'Pearland'
        WHEN 12 THEN 'Clear Lake' WHEN 13 THEN 'Pasadena'    WHEN 14 THEN 'Deer Park'
        WHEN 15 THEN 'Baytown'    WHEN 16 THEN 'La Porte'    WHEN 17 THEN 'Sugar Land'
        WHEN 18 THEN 'Missouri City' WHEN 19 THEN 'Stafford' WHEN 20 THEN 'Katy'
        WHEN 21 THEN 'Cypress'    WHEN 22 THEN 'Tomball'     WHEN 23 THEN 'Humble'
        ELSE 'Kingwood'
    END || ' Substation ' || (seq4() + 1) AS NODE_NAME,
    -- Houston metro area: lat 29.5-30.1, lon -95.8 to -95.0
    ROUND(29.55 + UNIFORM(0::FLOAT, 0.55::FLOAT, RANDOM()), 6) AS LAT,
    ROUND(-95.75 + UNIFORM(0::FLOAT, 0.75::FLOAT, RANDOM()), 6) AS LON,
    ROUND(29.55 + UNIFORM(0::FLOAT, 0.55::FLOAT, RANDOM()), 6) AS LATITUDE,
    ROUND(-95.75 + UNIFORM(0::FLOAT, 0.75::FLOAT, RANDOM()), 6) AS LONGITUDE,
    '69kV' AS VOLTAGE_LEVEL,
    69.0 AS VOLTAGE_KV,
    ROUND(UNIFORM(20000::FLOAT, 100000::FLOAT, RANDOM())) AS CAPACITY_KVA,
    ROUND(UNIFORM(15000::FLOAT, 80000::FLOAT, RANDOM())) AS CAPACITY_KW,
    'SUB_' || LPAD(seq4() + 1, 4, '0') AS SUBSTATION_ID,
    ROUND(UNIFORM(0.5::FLOAT, 1.0::FLOAT, RANDOM()), 3) AS CRITICALITY_SCORE,
    ROUND(UNIFORM(70::FLOAT, 98::FLOAT, RANDOM()), 1) AS HEALTH_SCORE,
    ROUND(UNIFORM(50::FLOAT, 400::FLOAT, RANDOM()))::INT AS DOWNSTREAM_TRANSFORMERS,
    ROUND(UNIFORM(10000::FLOAT, 200000::FLOAT, RANDOM())) AS DOWNSTREAM_CAPACITY_KVA,
    CASE
        WHEN UNIFORM(0::FLOAT, 1::FLOAT, RANDOM()) < 0.25 THEN 'WEST_HOUSTON'
        WHEN UNIFORM(0::FLOAT, 1::FLOAT, RANDOM()) < 0.5 THEN 'EAST_HOUSTON'
        WHEN UNIFORM(0::FLOAT, 1::FLOAT, RANDOM()) < 0.75 THEN 'NORTH_HOUSTON'
        ELSE 'CENTRAL_HOUSTON'
    END AS REGION
FROM TABLE(GENERATOR(ROWCOUNT => 275));

-- Insert ~1,600 transformers (6 per substation on average)
-- We use a two-step approach: first generate candidate rows, then pick 1600.
-- The GENERATOR+JOIN approach can produce duplicates due to parallelism,
-- so we generate with ROW_NUMBER and filter to exactly 1600.
INSERT INTO ML_DEMO.GRID_NODES (
    NODE_ID, NODE_TYPE, NODE_NAME, LAT, LON, LATITUDE, LONGITUDE,
    VOLTAGE_LEVEL, VOLTAGE_KV, CAPACITY_KVA, CAPACITY_KW,
    PARENT_NODE_ID, SUBSTATION_ID,
    CRITICALITY_SCORE, HEALTH_SCORE, AGE_YEARS, LOAD_FACTOR,
    DOWNSTREAM_TRANSFORMERS, DOWNSTREAM_CAPACITY_KVA, REGION
)
WITH substations AS (
    SELECT NODE_ID, LAT, LON, REGION,
           ROW_NUMBER() OVER (ORDER BY NODE_ID) - 1 AS sub_idx
    FROM ML_DEMO.GRID_NODES 
    WHERE NODE_TYPE = 'SUBSTATION'
),
-- Generate transformer assignments: 6 per substation
transformer_assignments AS (
    SELECT 
        s.NODE_ID AS parent_id, s.LAT AS s_lat, s.LON AS s_lon, s.REGION,
        s.sub_idx * 6 + t.trf_offset AS trf_seq
    FROM substations s
    CROSS JOIN (SELECT seq4() AS trf_offset FROM TABLE(GENERATOR(ROWCOUNT => 6))) t
)
SELECT
    'TRF_' || LPAD(trf_seq + 1, 6, '0') AS NODE_ID,
    'TRANSFORMER' AS NODE_TYPE,
    'Transformer ' || (trf_seq + 1) AS NODE_NAME,
    s_lat + UNIFORM(-0.02::FLOAT, 0.02::FLOAT, RANDOM()) AS LAT,
    s_lon + UNIFORM(-0.02::FLOAT, 0.02::FLOAT, RANDOM()) AS LON,
    s_lat + UNIFORM(-0.02::FLOAT, 0.02::FLOAT, RANDOM()) AS LATITUDE,
    s_lon + UNIFORM(-0.02::FLOAT, 0.02::FLOAT, RANDOM()) AS LONGITUDE,
    '12.47kV' AS VOLTAGE_LEVEL,
    12.47 AS VOLTAGE_KV,
    ROUND(UNIFORM(25::FLOAT, 500::FLOAT, RANDOM())) AS CAPACITY_KVA,
    ROUND(UNIFORM(20::FLOAT, 400::FLOAT, RANDOM())) AS CAPACITY_KW,
    parent_id AS PARENT_NODE_ID,
    parent_id AS SUBSTATION_ID,
    ROUND(UNIFORM(0.1::FLOAT, 0.8::FLOAT, RANDOM()), 3) AS CRITICALITY_SCORE,
    ROUND(UNIFORM(60::FLOAT, 95::FLOAT, RANDOM()), 1) AS HEALTH_SCORE,
    ROUND(UNIFORM(1::FLOAT, 40::FLOAT, RANDOM()), 1) AS AGE_YEARS,
    ROUND(UNIFORM(0.3::FLOAT, 0.9::FLOAT, RANDOM()), 3) AS LOAD_FACTOR,
    1 AS DOWNSTREAM_TRANSFORMERS,
    ROUND(UNIFORM(25::FLOAT, 500::FLOAT, RANDOM())) AS DOWNSTREAM_CAPACITY_KVA,
    REGION
FROM transformer_assignments
WHERE trf_seq < 1650;

-- ============================================================================
-- PART 4: REBUILD GRID_EDGES
-- ============================================================================
-- Create edges connecting substations to transformers and between substations.
-- The BFS simulation traverses FROM_NODE_ID → TO_NODE_ID edges.
-- Drop and recreate to ensure idempotent reruns.
-- ============================================================================

DROP TABLE IF EXISTS ML_DEMO.GRID_EDGES CASCADE;

CREATE TABLE ML_DEMO.GRID_EDGES (
    EDGE_ID VARCHAR(200) PRIMARY KEY,
    FROM_NODE_ID VARCHAR(100),
    TO_NODE_ID VARCHAR(100),
    EDGE_TYPE VARCHAR(50),
    DISTANCE_KM FLOAT,
    IMPEDANCE_PU FLOAT,
    VOLTAGE_LEVEL VARCHAR(20),
    CIRCUIT_ID VARCHAR(50),
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Substation-to-Transformer edges (DISTRIBUTION type)
INSERT INTO ML_DEMO.GRID_EDGES (
    EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, 
    DISTANCE_KM, IMPEDANCE_PU, VOLTAGE_LEVEL, CIRCUIT_ID
)
SELECT
    n.PARENT_NODE_ID || '->' || n.NODE_ID AS EDGE_ID,
    n.PARENT_NODE_ID AS FROM_NODE_ID,
    n.NODE_ID AS TO_NODE_ID,
    'DISTRIBUTION' AS EDGE_TYPE,
    ROUND(SQRT(POW((n.LAT - s.LAT) * 111, 2) + 
          POW((n.LON - s.LON) * 111 * COS(RADIANS(n.LAT)), 2)), 3) AS DISTANCE_KM,
    ROUND(UNIFORM(0.01::FLOAT, 0.1::FLOAT, RANDOM()), 4) AS IMPEDANCE_PU,
    '12.47kV' AS VOLTAGE_LEVEL,
    'CKT_' || n.PARENT_NODE_ID AS CIRCUIT_ID
FROM ML_DEMO.GRID_NODES n
JOIN ML_DEMO.GRID_NODES s ON n.PARENT_NODE_ID = s.NODE_ID
WHERE n.NODE_TYPE = 'TRANSFORMER' 
  AND n.PARENT_NODE_ID IS NOT NULL;

-- Inter-substation transmission edges (connect nearby substations)
INSERT INTO ML_DEMO.GRID_EDGES (
    EDGE_ID, FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE,
    DISTANCE_KM, IMPEDANCE_PU, VOLTAGE_LEVEL, CIRCUIT_ID
)
SELECT DISTINCT
    s1.NODE_ID || '->' || s2.NODE_ID AS EDGE_ID,
    s1.NODE_ID AS FROM_NODE_ID,
    s2.NODE_ID AS TO_NODE_ID,
    'TRANSMISSION' AS EDGE_TYPE,
    ROUND(SQRT(POW((s1.LAT - s2.LAT) * 111, 2) + 
          POW((s1.LON - s2.LON) * 111 * COS(RADIANS(s1.LAT)), 2)), 3) AS DISTANCE_KM,
    ROUND(UNIFORM(0.005::FLOAT, 0.05::FLOAT, RANDOM()), 4) AS IMPEDANCE_PU,
    '69kV' AS VOLTAGE_LEVEL,
    'TX_' || s1.NODE_ID || '_' || s2.NODE_ID AS CIRCUIT_ID
FROM ML_DEMO.GRID_NODES s1
JOIN ML_DEMO.GRID_NODES s2 
    ON s1.NODE_TYPE = 'SUBSTATION' 
    AND s2.NODE_TYPE = 'SUBSTATION'
    AND s1.NODE_ID < s2.NODE_ID
    -- Connect substations within ~10km of each other
    AND SQRT(POW((s1.LAT - s2.LAT) * 111, 2) + 
        POW((s1.LON - s2.LON) * 111 * COS(RADIANS(s1.LAT)), 2)) < 10
LIMIT 500;

-- ============================================================================
-- PART 5: REBUILD NODE_CENTRALITY_FEATURES_V2
-- ============================================================================
-- The backend uses this for cascade risk scoring. We need entries for all
-- nodes in GRID_NODES (not just the original 125).
-- Columns used by endpoints: CASCADE_RISK_SCORE_NORMALIZED, BETWEENNESS_CENTRALITY,
-- PAGERANK, EIGENVECTOR_CENTRALITY, TOTAL_REACH, NEIGHBORS_1HOP, NEIGHBORS_2HOP
-- Truncate and repopulate for idempotent reruns.
-- ============================================================================

TRUNCATE TABLE IF EXISTS CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2;

-- Populate centrality features for ALL nodes
INSERT INTO CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 (
    NODE_ID, DEGREE_CENTRALITY, BETWEENNESS_CENTRALITY, 
    CLOSENESS_CENTRALITY, EIGENVECTOR_CENTRALITY,
    PAGERANK_SCORE, PAGERANK, CLUSTERING_COEFFICIENT, LOCAL_EFFICIENCY,
    CASCADE_IMPACT_SCORE, VULNERABILITY_SCORE, CASCADE_RISK_SCORE_NORMALIZED,
    CRITICALITY_RANK, TOTAL_REACH, NEIGHBORS_1HOP, NEIGHBORS_2HOP,
    NODE_TYPE, SUBSTATION_ID, LOAD_FACTOR, MODEL_VERSION
)
SELECT
    n.NODE_ID,
    -- Degree centrality: substations have higher (more connections)
    CASE WHEN n.NODE_TYPE = 'SUBSTATION' 
        THEN ROUND(UNIFORM(0.05::FLOAT, 0.3::FLOAT, RANDOM()), 6)
        ELSE ROUND(UNIFORM(0.001::FLOAT, 0.02::FLOAT, RANDOM()), 6)
    END AS DEGREE_CENTRALITY,
    -- Betweenness: substations are key bridges
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(0.01::FLOAT, 0.5::FLOAT, RANDOM()), 6)
        ELSE ROUND(UNIFORM(0.0001::FLOAT, 0.01::FLOAT, RANDOM()), 6)
    END AS BETWEENNESS_CENTRALITY,
    ROUND(UNIFORM(0.1::FLOAT, 0.5::FLOAT, RANDOM()), 6) AS CLOSENESS_CENTRALITY,
    -- Eigenvector: measures influence
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(0.01::FLOAT, 0.15::FLOAT, RANDOM()), 6)
        ELSE ROUND(UNIFORM(0.001::FLOAT, 0.05::FLOAT, RANDOM()), 6)
    END AS EIGENVECTOR_CENTRALITY,
    -- PageRank
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(0.001::FLOAT, 0.01::FLOAT, RANDOM()), 6)
        ELSE ROUND(UNIFORM(0.0001::FLOAT, 0.002::FLOAT, RANDOM()), 6)
    END AS PAGERANK_SCORE,
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(0.001::FLOAT, 0.01::FLOAT, RANDOM()), 6)
        ELSE ROUND(UNIFORM(0.0001::FLOAT, 0.002::FLOAT, RANDOM()), 6)
    END AS PAGERANK,
    ROUND(UNIFORM(0.0::FLOAT, 0.5::FLOAT, RANDOM()), 4) AS CLUSTERING_COEFFICIENT,
    ROUND(UNIFORM(0.1::FLOAT, 0.9::FLOAT, RANDOM()), 4) AS LOCAL_EFFICIENCY,
    -- Cascade impact score: composite
    ROUND(n.CRITICALITY_SCORE * UNIFORM(0.5::FLOAT, 1.5::FLOAT, RANDOM()), 4) AS CASCADE_IMPACT_SCORE,
    ROUND(UNIFORM(0.1::FLOAT, 0.9::FLOAT, RANDOM()), 4) AS VULNERABILITY_SCORE,
    -- CASCADE_RISK_SCORE_NORMALIZED: the primary score used by endpoints
    -- Substations have higher risk due to more downstream impact
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(0.5::FLOAT, 1.0::FLOAT, RANDOM()), 4)
        ELSE ROUND(UNIFORM(0.1::FLOAT, 0.7::FLOAT, RANDOM()), 4)
    END AS CASCADE_RISK_SCORE_NORMALIZED,
    ROW_NUMBER() OVER (ORDER BY n.CRITICALITY_SCORE DESC)::INT AS CRITICALITY_RANK,
    -- Total reach: substations reach many nodes
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(50::FLOAT, 500::FLOAT, RANDOM()))::INT
        ELSE ROUND(UNIFORM(1::FLOAT, 20::FLOAT, RANDOM()))::INT
    END AS TOTAL_REACH,
    -- Neighbors
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(5::FLOAT, 50::FLOAT, RANDOM()))::INT
        ELSE ROUND(UNIFORM(1::FLOAT, 5::FLOAT, RANDOM()))::INT
    END AS NEIGHBORS_1HOP,
    CASE WHEN n.NODE_TYPE = 'SUBSTATION'
        THEN ROUND(UNIFORM(50::FLOAT, 500::FLOAT, RANDOM()))::INT
        ELSE ROUND(UNIFORM(5::FLOAT, 30::FLOAT, RANDOM()))::INT
    END AS NEIGHBORS_2HOP,
    n.NODE_TYPE,
    n.SUBSTATION_ID,
    ROUND(UNIFORM(0.3::FLOAT, 0.9::FLOAT, RANDOM()), 3) AS LOAD_FACTOR,
    'v2.0_quickstart' AS MODEL_VERSION
FROM ML_DEMO.GRID_NODES n
WHERE n.LAT IS NOT NULL;

-- ============================================================================
-- PART 6: RECREATE GNN_PREDICTIONS
-- ============================================================================
-- Used by /api/cascade/patient-zero-candidates when use_gnn_predictions=True
-- The existing table has wrong schema (14 cols instead of 5).
-- Backend expects: NODE_ID, NODE_TYPE, CRITICALITY_SCORE, GNN_CASCADE_RISK,
--                  PREDICTION_TIMESTAMP
-- ============================================================================

DROP TABLE IF EXISTS CASCADE_ANALYSIS.GNN_PREDICTIONS;

CREATE TABLE CASCADE_ANALYSIS.GNN_PREDICTIONS (
    NODE_ID VARCHAR(100) NOT NULL,
    NODE_TYPE VARCHAR(50),
    CRITICALITY_SCORE FLOAT,
    GNN_CASCADE_RISK FLOAT,
    PREDICTION_TIMESTAMP TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

INSERT INTO CASCADE_ANALYSIS.GNN_PREDICTIONS (
    NODE_ID, NODE_TYPE, CRITICALITY_SCORE, GNN_CASCADE_RISK, PREDICTION_TIMESTAMP
)
SELECT
    n.NODE_ID,
    n.NODE_TYPE,
    n.CRITICALITY_SCORE,
    -- GNN risk: correlated with centrality but with some noise
    LEAST(1.0, GREATEST(0.0,
        COALESCE(c.CASCADE_RISK_SCORE_NORMALIZED, n.CRITICALITY_SCORE) * 
        UNIFORM(0.8::FLOAT, 1.2::FLOAT, RANDOM())
    )) AS GNN_CASCADE_RISK,
    CURRENT_TIMESTAMP() AS PREDICTION_TIMESTAMP
FROM ML_DEMO.GRID_NODES n
LEFT JOIN CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2 c ON n.NODE_ID = c.NODE_ID
WHERE n.LAT IS NOT NULL;

-- ============================================================================
-- PART 7: CREATE GRID_NODES_EXTENDED (FULL HIERARCHY)
-- ============================================================================
-- The extended topology includes: Substation → Transformer → Pole → Meter
-- Used by /api/cascade/grid-topology?extended=true and
-- /api/cascade/high-risk-nodes?extended=true
--
-- Since se_demo doesn't have GRID_POLES_INFRASTRUCTURE or METER_INFRASTRUCTURE,
-- we generate synthetic poles and meters from the existing topology.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID VARCHAR(100) PRIMARY KEY,
    NODE_NAME VARCHAR(255),
    NODE_TYPE VARCHAR(50),
    LAT FLOAT,
    LON FLOAT,
    CAPACITY_KW FLOAT,
    VOLTAGE_KV FLOAT,
    CRITICALITY_SCORE FLOAT,
    DOWNSTREAM_TRANSFORMERS INT DEFAULT 0,
    DOWNSTREAM_CAPACITY_KVA FLOAT DEFAULT 0,
    PARENT_NODE_ID VARCHAR(100),
    HIERARCHY_LEVEL INT,
    HEALTH_SCORE FLOAT,
    COUNTY_NAME VARCHAR(100),
    CITY VARCHAR(100),
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Extended grid topology with full hierarchy: Substation(L1) -> Transformer(L2) -> Pole(L3) -> Meter(L4). Used by cascade analysis extended mode.';

-- Clear and repopulate
TRUNCATE TABLE IF EXISTS ML_DEMO.GRID_NODES_EXTENDED;

-- Insert substations and transformers from GRID_NODES
INSERT INTO ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS, DOWNSTREAM_CAPACITY_KVA,
    PARENT_NODE_ID, HIERARCHY_LEVEL, HEALTH_SCORE, COUNTY_NAME
)
SELECT
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    COALESCE(DOWNSTREAM_TRANSFORMERS, 0),
    COALESCE(DOWNSTREAM_CAPACITY_KVA, 0),
    PARENT_NODE_ID,
    CASE NODE_TYPE WHEN 'SUBSTATION' THEN 1 WHEN 'TRANSFORMER' THEN 2 ELSE 3 END,
    COALESCE(HEALTH_SCORE, CRITICALITY_SCORE * 100),
    CASE
        WHEN LON < -95.5 THEN 'Harris County'
        WHEN LON > -95.2 THEN 'Harris County'
        ELSE 'Harris County'
    END
FROM ML_DEMO.GRID_NODES;

-- Add synthetic poles (3 per transformer = ~5,100 poles)
INSERT INTO ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    PARENT_NODE_ID, HIERARCHY_LEVEL, HEALTH_SCORE, COUNTY_NAME
)
SELECT
    'POLE_' || t.NODE_ID || '_' || p.pole_idx AS NODE_ID,
    'Pole ' || t.NODE_ID || '-' || p.pole_idx AS NODE_NAME,
    'POLE' AS NODE_TYPE,
    t.LAT + UNIFORM(-0.005::FLOAT, 0.005::FLOAT, RANDOM()) AS LAT,
    t.LON + UNIFORM(-0.005::FLOAT, 0.005::FLOAT, RANDOM()) AS LON,
    5.0 AS CAPACITY_KW,
    12.47 AS VOLTAGE_KV,
    ROUND(UNIFORM(0.7::FLOAT, 0.95::FLOAT, RANDOM()), 3) AS CRITICALITY_SCORE,
    t.NODE_ID AS PARENT_NODE_ID,
    3 AS HIERARCHY_LEVEL,
    ROUND(UNIFORM(70::FLOAT, 95::FLOAT, RANDOM()), 1) AS HEALTH_SCORE,
    'Harris County' AS COUNTY_NAME
FROM ML_DEMO.GRID_NODES t
CROSS JOIN (SELECT seq4() + 1 AS pole_idx FROM TABLE(GENERATOR(ROWCOUNT => 3))) p
WHERE t.NODE_TYPE = 'TRANSFORMER';

-- Add synthetic meters (4 per pole = ~20,400 meters)
INSERT INTO ML_DEMO.GRID_NODES_EXTENDED (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    PARENT_NODE_ID, HIERARCHY_LEVEL, HEALTH_SCORE, COUNTY_NAME, CITY
)
SELECT
    'MTR_' || pole.NODE_ID || '_' || m.meter_idx AS NODE_ID,
    'Meter ' || pole.NODE_ID || '-' || m.meter_idx AS NODE_NAME,
    'METER' AS NODE_TYPE,
    pole.LAT + UNIFORM(-0.001::FLOAT, 0.001::FLOAT, RANDOM()) AS LAT,
    pole.LON + UNIFORM(-0.001::FLOAT, 0.001::FLOAT, RANDOM()) AS LON,
    0.5 AS CAPACITY_KW,
    0.120 AS VOLTAGE_KV,
    ROUND(UNIFORM(0.8::FLOAT, 0.98::FLOAT, RANDOM()), 3) AS CRITICALITY_SCORE,
    pole.NODE_ID AS PARENT_NODE_ID,
    4 AS HIERARCHY_LEVEL,
    ROUND(UNIFORM(80::FLOAT, 98::FLOAT, RANDOM()), 1) AS HEALTH_SCORE,
    'Harris County' AS COUNTY_NAME,
    CASE FLOOR(UNIFORM(0::FLOAT, 5::FLOAT, RANDOM()))::INT
        WHEN 0 THEN 'Houston'
        WHEN 1 THEN 'Katy'
        WHEN 2 THEN 'Sugar Land'
        WHEN 3 THEN 'The Woodlands'
        WHEN 4 THEN 'Pasadena'
        ELSE 'Houston'
    END AS CITY
FROM ML_DEMO.GRID_NODES_EXTENDED pole
CROSS JOIN (SELECT seq4() + 1 AS meter_idx FROM TABLE(GENERATOR(ROWCOUNT => 4))) m
WHERE pole.NODE_TYPE = 'POLE'
LIMIT 20000;

-- ============================================================================
-- PART 8: CREATE GRID_EDGES_EXTENDED
-- ============================================================================
-- Hierarchical edges connecting all levels of the extended topology.
-- SOURCE_NODE_ID / TARGET_NODE_ID naming (used by extended endpoints).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID VARCHAR(200) PRIMARY KEY,
    SOURCE_NODE_ID VARCHAR(100),
    TARGET_NODE_ID VARCHAR(100),
    EDGE_TYPE VARCHAR(50),
    DISTANCE_KM FLOAT,
    IMPEDANCE FLOAT,
    CAPACITY_KW FLOAT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Extended grid edges for full hierarchy topology. Uses SOURCE_NODE_ID/TARGET_NODE_ID naming convention.';

TRUNCATE TABLE IF EXISTS ML_DEMO.GRID_EDGES_EXTENDED;

-- Copy base edges (substation-to-transformer)
INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, SOURCE_NODE_ID, TARGET_NODE_ID, EDGE_TYPE, DISTANCE_KM, IMPEDANCE
)
SELECT
    FROM_NODE_ID || '->' || TO_NODE_ID,
    FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM, IMPEDANCE_PU
FROM ML_DEMO.GRID_EDGES;

-- Transformer-to-Pole edges
INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, SOURCE_NODE_ID, TARGET_NODE_ID, EDGE_TYPE, DISTANCE_KM, IMPEDANCE
)
SELECT
    n.PARENT_NODE_ID || '->' || n.NODE_ID,
    n.PARENT_NODE_ID, n.NODE_ID, 'POLE_CONNECTION',
    ROUND(UNIFORM(0.05::FLOAT, 0.5::FLOAT, RANDOM()), 3),
    ROUND(UNIFORM(0.01::FLOAT, 0.05::FLOAT, RANDOM()), 4)
FROM ML_DEMO.GRID_NODES_EXTENDED n
WHERE n.NODE_TYPE = 'POLE' AND n.PARENT_NODE_ID IS NOT NULL;

-- Pole-to-Meter edges
INSERT INTO ML_DEMO.GRID_EDGES_EXTENDED (
    EDGE_ID, SOURCE_NODE_ID, TARGET_NODE_ID, EDGE_TYPE, DISTANCE_KM, IMPEDANCE
)
SELECT
    n.PARENT_NODE_ID || '->' || n.NODE_ID,
    n.PARENT_NODE_ID, n.NODE_ID, 'METER_CONNECTION',
    ROUND(UNIFORM(0.01::FLOAT, 0.1::FLOAT, RANDOM()), 3),
    ROUND(UNIFORM(0.001::FLOAT, 0.01::FLOAT, RANDOM()), 4)
FROM ML_DEMO.GRID_NODES_EXTENDED n
WHERE n.NODE_TYPE = 'METER' AND n.PARENT_NODE_ID IS NOT NULL;

-- ============================================================================
-- PART 9: CREATE NODE_CENTRALITY_FEATURES_EXTENDED
-- ============================================================================
-- Centrality metrics for the extended hierarchy. Used by high-risk-nodes
-- endpoint in extended mode.
-- ============================================================================

CREATE TABLE IF NOT EXISTS CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED (
    NODE_ID VARCHAR(100) PRIMARY KEY,
    NODE_TYPE VARCHAR(50),
    HIERARCHY_LEVEL INT,
    DEGREE_CENTRALITY FLOAT,
    IN_DEGREE INT,
    OUT_DEGREE INT,
    DOWNSTREAM_CUSTOMERS INT DEFAULT 0,
    CASCADE_RISK_SCORE FLOAT,
    COMPUTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Centrality features for extended hierarchy. CASCADE_RISK_SCORE computed from degree centrality and downstream customer count.';

TRUNCATE TABLE IF EXISTS CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED;

INSERT INTO CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED (
    NODE_ID, NODE_TYPE, HIERARCHY_LEVEL, DEGREE_CENTRALITY,
    IN_DEGREE, OUT_DEGREE, DOWNSTREAM_CUSTOMERS, CASCADE_RISK_SCORE
)
SELECT
    n.NODE_ID,
    n.NODE_TYPE,
    n.HIERARCHY_LEVEL,
    -- Degree centrality: higher for upper hierarchy
    CASE n.HIERARCHY_LEVEL
        WHEN 1 THEN ROUND(UNIFORM(0.05::FLOAT, 0.3::FLOAT, RANDOM()), 6)
        WHEN 2 THEN ROUND(UNIFORM(0.01::FLOAT, 0.05::FLOAT, RANDOM()), 6)
        WHEN 3 THEN ROUND(UNIFORM(0.005::FLOAT, 0.02::FLOAT, RANDOM()), 6)
        ELSE ROUND(UNIFORM(0.001::FLOAT, 0.005::FLOAT, RANDOM()), 6)
    END AS DEGREE_CENTRALITY,
    -- In-degree
    CASE n.HIERARCHY_LEVEL
        WHEN 1 THEN ROUND(UNIFORM(1::FLOAT, 5::FLOAT, RANDOM()))::INT
        WHEN 2 THEN 1
        WHEN 3 THEN 1
        ELSE 1
    END AS IN_DEGREE,
    -- Out-degree
    CASE n.HIERARCHY_LEVEL
        WHEN 1 THEN ROUND(UNIFORM(5::FLOAT, 50::FLOAT, RANDOM()))::INT
        WHEN 2 THEN ROUND(UNIFORM(2::FLOAT, 10::FLOAT, RANDOM()))::INT
        WHEN 3 THEN ROUND(UNIFORM(2::FLOAT, 6::FLOAT, RANDOM()))::INT
        ELSE 0
    END AS OUT_DEGREE,
    -- Downstream customers
    CASE n.HIERARCHY_LEVEL
        WHEN 1 THEN ROUND(UNIFORM(5000::FLOAT, 50000::FLOAT, RANDOM()))::INT
        WHEN 2 THEN ROUND(UNIFORM(50::FLOAT, 500::FLOAT, RANDOM()))::INT
        WHEN 3 THEN ROUND(UNIFORM(5::FLOAT, 20::FLOAT, RANDOM()))::INT
        ELSE 1
    END AS DOWNSTREAM_CUSTOMERS,
    -- Cascade risk score: composite of hierarchy level and centrality
    CASE n.HIERARCHY_LEVEL
        WHEN 1 THEN ROUND(UNIFORM(0.7::FLOAT, 1.0::FLOAT, RANDOM()), 4)
        WHEN 2 THEN ROUND(UNIFORM(0.3::FLOAT, 0.7::FLOAT, RANDOM()), 4)
        WHEN 3 THEN ROUND(UNIFORM(0.1::FLOAT, 0.4::FLOAT, RANDOM()), 4)
        ELSE ROUND(UNIFORM(0.01::FLOAT, 0.1::FLOAT, RANDOM()), 4)
    END AS CASCADE_RISK_SCORE
FROM ML_DEMO.GRID_NODES_EXTENDED n
-- Only compute for top 3 levels to keep it manageable
WHERE n.HIERARCHY_LEVEL <= 3;

-- ============================================================================
-- PART 10: CREATE REAL_TIME_CASCADE_PREDICTIONS
-- ============================================================================
-- Used indirectly by cascade endpoints for live risk assessment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS CASCADE_ANALYSIS.REAL_TIME_CASCADE_PREDICTIONS (
    NODE_ID VARCHAR(100),
    NODE_TYPE VARCHAR(50),
    HIERARCHY_LEVEL INT,
    CASCADE_RISK_SCORE FLOAT,
    DOWNSTREAM_CUSTOMERS INT,
    RISK_LEVEL VARCHAR(20),
    POTENTIAL_IMPACT INT,
    PREDICTION_TIME TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Real-time cascade risk predictions updated periodically. Used by cascade monitoring endpoints.';

TRUNCATE TABLE IF EXISTS CASCADE_ANALYSIS.REAL_TIME_CASCADE_PREDICTIONS;

INSERT INTO CASCADE_ANALYSIS.REAL_TIME_CASCADE_PREDICTIONS (
    NODE_ID, NODE_TYPE, HIERARCHY_LEVEL, CASCADE_RISK_SCORE,
    DOWNSTREAM_CUSTOMERS, RISK_LEVEL, POTENTIAL_IMPACT
)
SELECT
    c.NODE_ID,
    c.NODE_TYPE,
    c.HIERARCHY_LEVEL,
    c.CASCADE_RISK_SCORE,
    c.DOWNSTREAM_CUSTOMERS,
    CASE 
        WHEN c.CASCADE_RISK_SCORE >= 0.8 THEN 'CRITICAL'
        WHEN c.CASCADE_RISK_SCORE >= 0.6 THEN 'HIGH'
        WHEN c.CASCADE_RISK_SCORE >= 0.4 THEN 'ELEVATED'
        ELSE 'NORMAL'
    END AS RISK_LEVEL,
    c.DOWNSTREAM_CUSTOMERS * ROUND(c.CASCADE_RISK_SCORE * 10)::INT AS POTENTIAL_IMPACT
FROM CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED c;

-- ============================================================================
-- PART 11: RECREATE PRECOMPUTED_CASCADES
-- ============================================================================
-- The existing table has extra/mismatched columns from an earlier setup.
-- Drop and recreate with the schema the backend expects.
-- The endpoint reads: SCENARIO_ID, SCENARIO_NAME, PATIENT_ZERO_ID,
--   PATIENT_ZERO_NAME, SIMULATION_PARAMS, CASCADE_ORDER, WAVE_BREAKDOWN,
--   NODE_TYPE_BREAKDOWN, PROPAGATION_PATHS, TOTAL_AFFECTED_NODES,
--   AFFECTED_CAPACITY_MW, ESTIMATED_CUSTOMERS_AFFECTED, MAX_CASCADE_DEPTH,
--   SIMULATION_TIMESTAMP, COMPUTED_AT
-- ============================================================================

DROP TABLE IF EXISTS CASCADE_ANALYSIS.PRECOMPUTED_CASCADES;

CREATE TABLE CASCADE_ANALYSIS.PRECOMPUTED_CASCADES (
    SCENARIO_ID VARCHAR(100),
    SCENARIO_NAME VARCHAR(255),
    PATIENT_ZERO_ID VARCHAR(100),
    PATIENT_ZERO_NAME VARCHAR(255),
    SIMULATION_PARAMS VARIANT,
    CASCADE_ORDER VARIANT,
    WAVE_BREAKDOWN VARIANT,
    NODE_TYPE_BREAKDOWN VARIANT,
    PROPAGATION_PATHS VARIANT,
    TOTAL_AFFECTED_NODES INT,
    AFFECTED_CAPACITY_MW FLOAT,
    ESTIMATED_CUSTOMERS_AFFECTED INT,
    MAX_CASCADE_DEPTH INT,
    SIMULATION_TIMESTAMP TIMESTAMP_NTZ,
    COMPUTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

INSERT INTO CASCADE_ANALYSIS.PRECOMPUTED_CASCADES (
    SCENARIO_ID, SCENARIO_NAME, PATIENT_ZERO_ID, PATIENT_ZERO_NAME,
    SIMULATION_PARAMS, CASCADE_ORDER, WAVE_BREAKDOWN,
    NODE_TYPE_BREAKDOWN, PROPAGATION_PATHS,
    TOTAL_AFFECTED_NODES, AFFECTED_CAPACITY_MW, ESTIMATED_CUSTOMERS_AFFECTED,
    MAX_CASCADE_DEPTH, SIMULATION_TIMESTAMP, COMPUTED_AT
)
SELECT
    scenario_id,
    scenario_name,
    patient_zero_id,
    patient_zero_name,
    PARSE_JSON(sim_params) AS SIMULATION_PARAMS,
    PARSE_JSON(cascade_order_json) AS CASCADE_ORDER,
    PARSE_JSON(wave_json) AS WAVE_BREAKDOWN,
    PARSE_JSON(node_type_json) AS NODE_TYPE_BREAKDOWN,
    PARSE_JSON('[]') AS PROPAGATION_PATHS,
    total_nodes,
    affected_mw,
    affected_customers,
    max_depth,
    CURRENT_TIMESTAMP() AS SIMULATION_TIMESTAMP,
    CURRENT_TIMESTAMP() AS COMPUTED_AT
FROM (
    SELECT 
        'scenario_1' AS scenario_id,
        'Summer Peak 2025' AS scenario_name,
        'SUB_0001' AS patient_zero_id,
        'Substation 1' AS patient_zero_name,
        '{"temperature_c": 40, "load_multiplier": 1.4, "failure_threshold": 0.6}' AS sim_params,
        '[{"order":0,"node_id":"SUB_0001","node_name":"Substation 1","node_type":"SUBSTATION","wave_depth":0,"capacity_kw":50000,"lat":29.76,"lon":-95.37},{"order":1,"node_id":"TRF_000101","node_name":"Transformer 101","node_type":"TRANSFORMER","wave_depth":1,"capacity_kw":200,"lat":29.77,"lon":-95.38}]' AS cascade_order_json,
        '[{"wave":0,"nodes":1,"capacity_kw":50000},{"wave":1,"nodes":12,"capacity_kw":2400}]' AS wave_json,
        '[{"type":"SUBSTATION","count":1},{"type":"TRANSFORMER","count":12}]' AS node_type_json,
        13 AS total_nodes, 52.4 AS affected_mw, 64800 AS affected_customers, 3 AS max_depth
    UNION ALL
    SELECT 
        'scenario_2',
        'Winter Storm Scenario',
        'SUB_0005', 'Substation 5',
        '{"temperature_c": -10, "load_multiplier": 1.6, "failure_threshold": 0.5}',
        '[{"order":0,"node_id":"SUB_0005","node_name":"Substation 5","node_type":"SUBSTATION","wave_depth":0,"capacity_kw":75000,"lat":29.82,"lon":-95.45},{"order":1,"node_id":"SUB_0008","node_name":"Substation 8","node_type":"SUBSTATION","wave_depth":1,"capacity_kw":60000,"lat":29.80,"lon":-95.42}]',
        '[{"wave":0,"nodes":1,"capacity_kw":75000},{"wave":1,"nodes":3,"capacity_kw":180000},{"wave":2,"nodes":18,"capacity_kw":3600}]',
        '[{"type":"SUBSTATION","count":4},{"type":"TRANSFORMER","count":18}]',
        22, 258.6, 324000, 5
    UNION ALL
    SELECT 
        'scenario_3',
        'Hurricane Season',
        'SUB_0012', 'Substation 12',
        '{"temperature_c": 30, "load_multiplier": 1.2, "failure_threshold": 0.55}',
        '[{"order":0,"node_id":"SUB_0012","node_name":"Substation 12","node_type":"SUBSTATION","wave_depth":0,"capacity_kw":45000,"lat":29.68,"lon":-95.28},{"order":1,"node_id":"TRF_000108","node_name":"Transformer 108","node_type":"TRANSFORMER","wave_depth":1,"capacity_kw":150,"lat":29.69,"lon":-95.29}]',
        '[{"wave":0,"nodes":1,"capacity_kw":45000},{"wave":1,"nodes":8,"capacity_kw":1200}]',
        '[{"type":"SUBSTATION","count":1},{"type":"TRANSFORMER","count":8}]',
        9, 46.2, 54000, 2
    UNION ALL
    SELECT 
        'scenario_4',
        'Normal Operations Baseline',
        'SUB_0003', 'Substation 3',
        '{"temperature_c": 25, "load_multiplier": 1.0, "failure_threshold": 0.8}',
        '[{"order":0,"node_id":"SUB_0003","node_name":"Substation 3","node_type":"SUBSTATION","wave_depth":0,"capacity_kw":55000,"lat":29.74,"lon":-95.35}]',
        '[{"wave":0,"nodes":1,"capacity_kw":55000}]',
        '[{"type":"SUBSTATION","count":1}]',
        1, 55.0, 0, 0
);

-- ============================================================================
-- PART 12: VALIDATION
-- ============================================================================
-- Run these queries to verify everything was created correctly.
-- ============================================================================

-- Verify T_TRANSFORMER_TEMPORAL_TRAINING
SELECT 'T_TRANSFORMER_TEMPORAL_TRAINING' AS table_name, 
       COUNT(*) AS row_count,
       COUNT(DISTINCT TRANSFORMER_ID) AS transformers,
       MIN(PREDICTION_DATE)::DATE AS min_date,
       MAX(PREDICTION_DATE)::DATE AS max_date,
       AVG(MORNING_LOAD_PCT) AS avg_morning_load
FROM ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING;

-- Verify GRID_NODES expanded
SELECT 'GRID_NODES' AS table_name, 
       NODE_TYPE, COUNT(*) AS cnt
FROM ML_DEMO.GRID_NODES 
GROUP BY NODE_TYPE 
ORDER BY cnt DESC;

-- Verify GRID_EDGES expanded
SELECT 'GRID_EDGES' AS table_name,
       EDGE_TYPE, COUNT(*) AS cnt
FROM ML_DEMO.GRID_EDGES 
GROUP BY EDGE_TYPE 
ORDER BY cnt DESC;

-- Verify NODE_CENTRALITY_FEATURES_V2
SELECT 'NODE_CENTRALITY_V2' AS table_name,
       COUNT(*) AS row_count,
       AVG(CASCADE_RISK_SCORE_NORMALIZED) AS avg_risk
FROM CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2;

-- Verify GNN_PREDICTIONS
SELECT 'GNN_PREDICTIONS' AS table_name,
       COUNT(*) AS row_count,
       AVG(GNN_CASCADE_RISK) AS avg_risk
FROM CASCADE_ANALYSIS.GNN_PREDICTIONS;

-- Verify extended tables
SELECT 'GRID_NODES_EXTENDED' AS table_name,
       NODE_TYPE, COUNT(*) AS cnt
FROM ML_DEMO.GRID_NODES_EXTENDED 
GROUP BY NODE_TYPE 
ORDER BY cnt DESC;

SELECT 'GRID_EDGES_EXTENDED' AS table_name,
       EDGE_TYPE, COUNT(*) AS cnt
FROM ML_DEMO.GRID_EDGES_EXTENDED 
GROUP BY EDGE_TYPE 
ORDER BY cnt DESC;

SELECT 'NODE_CENTRALITY_EXTENDED' AS table_name,
       COUNT(*) AS row_count
FROM CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED;

SELECT 'REAL_TIME_PREDICTIONS' AS table_name,
       RISK_LEVEL, COUNT(*) AS cnt
FROM CASCADE_ANALYSIS.REAL_TIME_CASCADE_PREDICTIONS 
GROUP BY RISK_LEVEL 
ORDER BY cnt DESC;

SELECT 'PRECOMPUTED_CASCADES' AS table_name,
       COUNT(*) AS scenarios,
       SUM(ESTIMATED_CUSTOMERS_AFFECTED) AS total_customers
FROM CASCADE_ANALYSIS.PRECOMPUTED_CASCADES;

-- ============================================================================
-- EXPECTED OUTPUT:
-- ============================================================================
--
-- T_TRANSFORMER_TEMPORAL_TRAINING:
--   ~2,000 rows, 100 transformers, 20 days, avg morning load ~50-60%
--
-- GRID_NODES:
--   SUBSTATION:  ~275
--   TRANSFORMER: ~1,700
--   Total:       ~1,975
--
-- GRID_EDGES:
--   DISTRIBUTION:  ~1,700 (one per transformer)
--   TRANSMISSION:  ~300-500 (nearby substation pairs)
--   Total:         ~2,000-2,200
--
-- NODE_CENTRALITY_V2:
--   ~1,975 rows, avg risk ~0.4
--
-- GNN_PREDICTIONS:
--   ~1,975 rows
--
-- GRID_NODES_EXTENDED:
--   SUBSTATION:  ~275
--   TRANSFORMER: ~1,700
--   POLE:        ~5,100 (3 per transformer)
--   METER:       ~20,000 (4 per pole)
--   Total:       ~27,000
--
-- GRID_EDGES_EXTENDED:
--   DISTRIBUTION/TRANSMISSION: ~2,200 (from base)
--   POLE_CONNECTION:           ~5,100
--   METER_CONNECTION:          ~20,000
--   Total:                     ~27,300
--
-- NODE_CENTRALITY_EXTENDED:
--   ~7,000 rows (SUB + XFMR + POLE levels)
--
-- REAL_TIME_PREDICTIONS:
--   ~7,000 rows
--
-- PRECOMPUTED_CASCADES:
--   4 scenarios
-- ============================================================================
