/*
================================================================================
SNOWFLAKE ML DEMO: PREDICTIVE ASSET MAINTENANCE
================================================================================

USE CASE: Predict transformer thermal overload risk before failure occurs

BUSINESS VALUE:
- Predictive Asset Maintenance: Leveraging Cortex AI to identify distribution 
  assets at risk for failure (e.g., a 25-year-old transformer during a heatwave)
- Target 1-2% O&M reduction via proactive maintenance scheduling

PRODUCTS DEMONSTRATED:
1. Snowpark ML - Feature engineering and model training
2. Snowflake Model Registry - Model versioning and governance
3. Warehouse Inference - Real-time predictions via SQL/UDF

DATA SOURCE: <% database %>.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED
- 211M hourly readings
- Jul-Aug 2024 and Jul-Aug 2025 (summer peak periods)

DEPLOYMENT:
- Git Integration: EXECUTE IMMEDIATE FROM @stage/01_ml_demo_setup.sql USING (database => 'MY_DB');
- CLI: snow sql -f 01_ml_demo_setup.sql -D database=MY_DB

================================================================================
*/

-- ============================================================================
-- SECTION 1: CREATE ML SCHEMA AND OBJECTS
-- ============================================================================

USE ROLE SYSADMIN;
USE DATABASE <% database %>;  -- Set via: EXECUTE IMMEDIATE FROM @stage USING (database => 'MY_DB');

-- Create schema for ML assets
CREATE SCHEMA IF NOT EXISTS ML_DEMO;

USE SCHEMA ML_DEMO;

COMMENT ON SCHEMA ML_DEMO IS 
'Snowflake ML Demo: Predictive Asset Maintenance for Transformer Failure Prediction. 
Demonstrates Snowflake ML capabilities for utility asset management.';

-- ============================================================================
-- SECTION 2: CREATE TRAINING DATA VIEW
-- ============================================================================

-- Training data view with feature engineering
CREATE OR REPLACE VIEW V_TRANSFORMER_ML_FEATURES AS
SELECT 
    -- Identifiers
    TRANSFORMER_ID,
    LOAD_HOUR,
    YEAR,
    MONTH,
    
    -- Numeric features (continuous)
    LOAD_FACTOR_PCT,                                              -- Key stress indicator
    TRANSFORMER_AGE_YEARS,                                        -- Equipment age
    RATED_KVA,                                                    -- Capacity class
    ACTIVE_METERS,                                                -- Load complexity
    AVG_VOLTAGE,                                                  -- Voltage stability
    VOLTAGE_SAG_COUNT,                                            -- Power quality events
    COALESCE(HISTORICAL_SUMMER_AVG_LOAD, 0) AS HISTORICAL_AVG_LOAD, -- Baseline comparison
    
    -- Temporal features (cyclical)
    HOUR(LOAD_HOUR) AS HOUR_OF_DAY,                              -- Time-based patterns
    DAYOFWEEK(LOAD_HOUR) AS DAY_OF_WEEK,                         -- Weekly patterns
    
    -- Categorical features
    STRESS_VS_HISTORICAL,                                         -- Anomaly indicator
    COUNTY_NAME,                                                  -- Geographic segment
    
    -- Derived features (domain knowledge)
    CASE WHEN HOUR(LOAD_HOUR) BETWEEN 14 AND 19 THEN 1 ELSE 0 END AS IS_PEAK_HOUR,
    CASE WHEN TRANSFORMER_AGE_YEARS >= 20 THEN 1 ELSE 0 END AS IS_AGING_EQUIPMENT,
    CASE WHEN RATED_KVA <= 150 THEN 'SMALL'
         WHEN RATED_KVA <= 500 THEN 'MEDIUM'
         ELSE 'LARGE' END AS CAPACITY_CLASS,
    
    -- Target variable
    -- HIGH_RISK = transformer in OVERLOAD, SEVERE_OVERLOAD, or CRITICAL state
    CASE WHEN THERMAL_STRESS_CATEGORY IN ('OVERLOAD', 'SEVERE_OVERLOAD', 'CRITICAL') 
         THEN 1 ELSE 0 END AS IS_HIGH_RISK,
    
    -- Original category for analysis
    THERMAL_STRESS_CATEGORY,
    
    -- Data quality filter
    DATA_QUALITY_RELIABLE
    
FROM <% database %>.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED
WHERE DATA_QUALITY_RELIABLE = TRUE;

COMMENT ON VIEW V_TRANSFORMER_ML_FEATURES IS 
'Feature-engineered view for transformer failure prediction ML model.
Target: IS_HIGH_RISK (1 = OVERLOAD/SEVERE_OVERLOAD/CRITICAL, 0 = otherwise)
Use July 2025 for training, August 2025 for validation.';

-- ============================================================================
-- SECTION 3: CREATE TRAINING DATASET (SAMPLED & BALANCED)
-- ============================================================================

-- Create balanced training dataset (sampled for efficient training)
CREATE OR REPLACE TABLE T_TRANSFORMER_ML_TRAINING AS
WITH high_risk_samples AS (
    -- Minority class: high-risk transformers (sample up to 50K)
    SELECT * 
    FROM V_TRANSFORMER_ML_FEATURES
    WHERE YEAR = 2025 AND MONTH = 7  -- July 2025 for training
      AND IS_HIGH_RISK = 1
    SAMPLE (50000 ROWS)
),
normal_samples AS (
    -- Majority class: normal transformers (sample 50K to balance)
    SELECT * 
    FROM V_TRANSFORMER_ML_FEATURES
    WHERE YEAR = 2025 AND MONTH = 7
      AND IS_HIGH_RISK = 0
    SAMPLE (50000 ROWS)
)
SELECT * FROM high_risk_samples
UNION ALL
SELECT * FROM normal_samples;

-- Verify class balance
SELECT 
    IS_HIGH_RISK,
    COUNT(*) AS COUNT,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS PERCENTAGE
FROM T_TRANSFORMER_ML_TRAINING
GROUP BY IS_HIGH_RISK;

-- ============================================================================
-- SECTION 4: CREATE INFERENCE VIEW FOR REAL-TIME SCORING
-- ============================================================================

-- View for scoring current/recent transformer readings
CREATE OR REPLACE VIEW V_TRANSFORMER_CURRENT_RISK AS
SELECT 
    t.TRANSFORMER_ID,
    t.LOAD_HOUR,
    t.LOAD_FACTOR_PCT,
    t.TRANSFORMER_AGE_YEARS,
    t.RATED_KVA,
    t.ACTIVE_METERS,
    t.AVG_VOLTAGE,
    t.VOLTAGE_SAG_COUNT,
    t.HISTORICAL_AVG_LOAD,
    t.HOUR_OF_DAY,
    t.DAY_OF_WEEK,
    t.STRESS_VS_HISTORICAL,
    t.IS_PEAK_HOUR,
    t.IS_AGING_EQUIPMENT,
    t.THERMAL_STRESS_CATEGORY AS CURRENT_STRESS,
    
    -- Join to transformer metadata for context
    m.COUNTY_NAME,
    m.SUBSTATION_ID,
    m.CIRCUIT_ID,
    m.LOCATION_AREA
    
FROM V_TRANSFORMER_ML_FEATURES t
JOIN <% database %>.PRODUCTION.TRANSFORMER_METADATA m 
    ON t.TRANSFORMER_ID = m.TRANSFORMER_ID
WHERE t.YEAR = 2025 AND t.MONTH = 8;  -- Current period (August 2025)

COMMENT ON VIEW V_TRANSFORMER_CURRENT_RISK IS 
'Real-time view for transformer risk scoring. 
Join with ML model predictions for operational alerts.';

-- ============================================================================
-- SECTION 5: CREATE RESULTS TABLE FOR MODEL PREDICTIONS
-- ============================================================================

-- Table to store model predictions
CREATE OR REPLACE TABLE T_TRANSFORMER_RISK_PREDICTIONS (
    PREDICTION_ID VARCHAR(36) DEFAULT UUID_STRING(),
    PREDICTION_TIMESTAMP TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    MODEL_NAME VARCHAR(100),
    MODEL_VERSION VARCHAR(20),
    
    -- Transformer info
    TRANSFORMER_ID VARCHAR(50),
    LOAD_HOUR TIMESTAMP_NTZ,
    COUNTY_NAME VARCHAR(50),
    
    -- Features used
    LOAD_FACTOR_PCT FLOAT,
    TRANSFORMER_AGE_YEARS INTEGER,
    IS_PEAK_HOUR INTEGER,
    
    -- Prediction results
    PREDICTED_HIGH_RISK INTEGER,       -- 0 or 1
    RISK_PROBABILITY FLOAT,            -- 0.0 to 1.0
    RISK_CATEGORY VARCHAR(20),         -- LOW, MEDIUM, HIGH, CRITICAL
    
    -- Actual outcome (for model monitoring)
    ACTUAL_STRESS_CATEGORY VARCHAR(20),
    PREDICTION_CORRECT BOOLEAN,
    
    PRIMARY KEY (PREDICTION_ID)
);

COMMENT ON TABLE T_TRANSFORMER_RISK_PREDICTIONS IS 
'Stores transformer failure predictions from ML model.
Used for operational alerts and model performance monitoring.';

-- ============================================================================
-- SECTION 6: CREATE MONITORING VIEW
-- ============================================================================

-- Model performance monitoring view
CREATE OR REPLACE VIEW V_MODEL_PERFORMANCE_DAILY AS
SELECT 
    DATE(PREDICTION_TIMESTAMP) AS PREDICTION_DATE,
    MODEL_NAME,
    MODEL_VERSION,
    
    -- Prediction counts
    COUNT(*) AS TOTAL_PREDICTIONS,
    SUM(PREDICTED_HIGH_RISK) AS HIGH_RISK_PREDICTIONS,
    SUM(CASE WHEN ACTUAL_STRESS_CATEGORY IN ('OVERLOAD', 'SEVERE_OVERLOAD', 'CRITICAL') 
             THEN 1 ELSE 0 END) AS ACTUAL_HIGH_RISK,
    
    -- Performance metrics
    SUM(CASE WHEN PREDICTION_CORRECT THEN 1 ELSE 0 END) AS CORRECT_PREDICTIONS,
    ROUND(100.0 * SUM(CASE WHEN PREDICTION_CORRECT THEN 1 ELSE 0 END) / COUNT(*), 2) AS ACCURACY_PCT,
    
    -- Confusion matrix components
    SUM(CASE WHEN PREDICTED_HIGH_RISK = 1 AND ACTUAL_STRESS_CATEGORY IN ('OVERLOAD', 'SEVERE_OVERLOAD', 'CRITICAL') 
             THEN 1 ELSE 0 END) AS TRUE_POSITIVES,
    SUM(CASE WHEN PREDICTED_HIGH_RISK = 1 AND ACTUAL_STRESS_CATEGORY NOT IN ('OVERLOAD', 'SEVERE_OVERLOAD', 'CRITICAL') 
             THEN 1 ELSE 0 END) AS FALSE_POSITIVES,
    SUM(CASE WHEN PREDICTED_HIGH_RISK = 0 AND ACTUAL_STRESS_CATEGORY IN ('OVERLOAD', 'SEVERE_OVERLOAD', 'CRITICAL') 
             THEN 1 ELSE 0 END) AS FALSE_NEGATIVES  -- Missed failures (critical metric)
    
FROM T_TRANSFORMER_RISK_PREDICTIONS
GROUP BY DATE(PREDICTION_TIMESTAMP), MODEL_NAME, MODEL_VERSION;

COMMENT ON VIEW V_MODEL_PERFORMANCE_DAILY IS 
'Daily model performance metrics for drift detection and retraining triggers.
Key metric: FALSE_NEGATIVES (missed failures) - should trigger alert if increasing.';

-- ============================================================================
-- SECTION 7: SAMPLE DATA VERIFICATION
-- ============================================================================

-- Verify training data
SELECT 'Training Data Summary' AS REPORT;
SELECT 
    IS_HIGH_RISK,
    COUNT(*) AS RECORDS,
    ROUND(AVG(LOAD_FACTOR_PCT), 2) AS AVG_LOAD_FACTOR,
    ROUND(AVG(TRANSFORMER_AGE_YEARS), 1) AS AVG_AGE_YEARS,
    SUM(IS_PEAK_HOUR) AS PEAK_HOUR_RECORDS
FROM T_TRANSFORMER_ML_TRAINING
GROUP BY IS_HIGH_RISK;

-- Feature correlation with target
SELECT 'Feature Analysis' AS REPORT;
SELECT 
    STRESS_VS_HISTORICAL,
    IS_HIGH_RISK,
    COUNT(*) AS COUNT
FROM T_TRANSFORMER_ML_TRAINING
GROUP BY STRESS_VS_HISTORICAL, IS_HIGH_RISK
ORDER BY STRESS_VS_HISTORICAL, IS_HIGH_RISK;

-- ============================================================================
-- SECTION 8: GRANT PERMISSIONS
-- ============================================================================

-- Grant access to application roles
GRANT USAGE ON SCHEMA ML_DEMO TO ROLE PUBLIC;
GRANT SELECT ON ALL VIEWS IN SCHEMA ML_DEMO TO ROLE PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA ML_DEMO TO ROLE PUBLIC;

-- ============================================================================
-- DEMO COMPLETE
-- ============================================================================

SELECT '✅ ML Demo Setup Complete' AS STATUS,
       'Run transformer_failure_prediction.ipynb in Snowflake Notebooks' AS NEXT_STEP;
