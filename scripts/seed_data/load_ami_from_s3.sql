-- =============================================================================
-- Load AMI Interval Readings from External S3 Stage
-- =============================================================================
-- Source: s3://abannerjee-ami-demo/raw/ami/ami_interval_readings/
-- Rows: 7,105,569,024 (7.1 billion)
-- Files: ~385 parquet files
-- Size: 78.7 GB compressed
-- Date Range: Jul/Aug 2024 and Jul/Aug 2025 (4 months, 124 days)
-- Meters: 596,906 unique
-- =============================================================================

-- Step 1: Set context
USE DATABASE SI_DEMOS;
USE SCHEMA PRODUCTION;
USE WAREHOUSE SI_DEMO_WH;

-- Step 2: Scale up warehouse for large data load (XLARGE recommended)
-- IMPORTANT: This speeds up load from ~5 min (MEDIUM) to ~30 sec (XLARGE)
ALTER WAREHOUSE SI_DEMO_WH SET WAREHOUSE_SIZE = 'XLARGE';

-- Step 3: Create the external stage (if not exists)
-- Note: This requires the storage integration to already exist
CREATE STAGE IF NOT EXISTS EXT_RAW_AMI
    URL = 's3://abannerjee-ami-demo/raw/ami/'
    STORAGE_INTEGRATION = S3_INTEGRATION
    FILE_FORMAT = (TYPE = PARQUET)
    COMMENT = 'External stage for AMI interval readings (7.1B rows, 78.7GB)';

-- Step 4: Create target table (if not exists)
CREATE TABLE IF NOT EXISTS AMI_INTERVAL_READINGS (
    METER_ID VARCHAR,
    TIMESTAMP TIMESTAMP_NTZ,
    USAGE_KWH FLOAT,
    VOLTAGE NUMBER(22,0),
    POWER_FACTOR NUMBER(23,2),
    CUSTOMER_SEGMENT_ID VARCHAR(11),
    SOURCE_TABLE VARCHAR
) CLUSTER BY (DATE_TRUNC('day', TIMESTAMP), METER_ID)
COMMENT = 'AMI 15-minute interval readings - 7.1B rows, 596K meters, Jul 2024-Aug 2025';

-- Step 5: Verify stage access by listing files
LIST @EXT_RAW_AMI/ami_interval_readings/ PATTERN='.*parquet';

-- Step 6: Preview data (optional)
SELECT $1:METER_ID::VARCHAR as METER_ID, 
       $1:TIMESTAMP::TIMESTAMP_NTZ as TIMESTAMP,
       $1:USAGE_KWH::FLOAT as USAGE_KWH,
       $1:VOLTAGE::NUMBER(22,0) as VOLTAGE,
       $1:POWER_FACTOR::NUMBER(23,2) as POWER_FACTOR
FROM @EXT_RAW_AMI/ami_interval_readings/
(FILE_FORMAT => (TYPE = PARQUET))
LIMIT 10;

-- Step 7: Load data from S3 to Snowflake table
-- Expected time: ~30 seconds with XLARGE warehouse
COPY INTO AMI_INTERVAL_READINGS
FROM @EXT_RAW_AMI/ami_interval_readings/
FILE_FORMAT = (TYPE = PARQUET)
MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE
ON_ERROR = 'CONTINUE';

-- Step 8: Reset warehouse to normal size
ALTER WAREHOUSE SI_DEMO_WH SET WAREHOUSE_SIZE = 'MEDIUM';

-- Step 9: Verify the load
SELECT 
    COUNT(*) as total_rows,
    MIN(TIMESTAMP) as min_date,
    MAX(TIMESTAMP) as max_date,
    COUNT(DISTINCT METER_ID) as unique_meters,
    COUNT(DISTINCT DATE_TRUNC('day', TIMESTAMP)) as days_covered
FROM AMI_INTERVAL_READINGS;

-- Expected output:
-- +---------------+---------------------+---------------------+---------------+--------------+
-- | TOTAL_ROWS    | MIN_DATE            | MAX_DATE            | UNIQUE_METERS | DAYS_COVERED |
-- +---------------+---------------------+---------------------+---------------+--------------+
-- | 7,105,569,024 | 2024-07-01 00:00:00 | 2025-08-31 23:45:00 | 596,906       | 124          |
-- +---------------+---------------------+---------------------+---------------+--------------+
-- Note: Data covers 4 months (Jul/Aug 2024 and Jul/Aug 2025), not continuous

-- Step 10: Verify data quality
SELECT 
    '15-min intervals per day' as check_name,
    ROUND(COUNT(*) / COUNT(DISTINCT METER_ID) / COUNT(DISTINCT DATE_TRUNC('day', TIMESTAMP)), 2) as readings_per_meter_per_day
FROM AMI_INTERVAL_READINGS;
-- Expected: 96 readings/meter/day (24 hours * 4 readings/hour = 96)
