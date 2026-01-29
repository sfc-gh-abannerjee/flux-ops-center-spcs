# Flux Operations Center - Data Loading Guide

This guide documents how to load the production demo data for the Flux Operations Center, including the 7.1 billion row AMI dataset.

---

## Data Overview

| Dataset | Rows | Size | Location | Format |
|---------|------|------|----------|--------|
| **AMI_INTERVAL_READINGS** | 7,105,569,024 | 78.7 GB | S3 External Stage | Parquet |
| Other tables | ~1.6M total | ~7 GB | Snowflake (SI_DEMOS.PRODUCTION) | Native |

---

## AMI Interval Readings (7.1 Billion Rows)

### Source Details

| Property | Value |
|----------|-------|
| **Location** | `s3://abannerjee-ami-demo/raw/ami/ami_interval_readings/` |
| **File Count** | ~385 parquet files |
| **Total Size** | 78.7 GB compressed |
| **Row Count** | 7,105,569,024 |
| **Date Range** | July 2024, August 2024, July 2025, August 2025 (4 months) |
| **Interval** | 15-minute readings (96 readings/meter/day) |
| **Unique Meters** | 596,906 |
| **Days Covered** | 124 days (31 days × 4 months) |

### Schema

| Column | Type | Description |
|--------|------|-------------|
| METER_ID | VARCHAR | Unique meter identifier (MTR-800K-XXXXXXX format) |
| TIMESTAMP | TIMESTAMP_NTZ | Reading timestamp (15-min intervals) |
| USAGE_KWH | FLOAT | Energy consumption in kWh |
| VOLTAGE | NUMBER(22,0) | Voltage reading |
| POWER_FACTOR | NUMBER(23,2) | Power factor |
| CUSTOMER_SEGMENT_ID | VARCHAR(11) | Customer segment reference |
| SOURCE_TABLE | VARCHAR | Source table identifier |

### Loading Instructions

#### Option 1: Direct Stage Access (Same Snowflake Account)

If you have access to the same Snowflake account (GZB42423), the data is already in the external stage:

```sql
-- Verify the stage exists
DESC STAGE SI_DEMOS.PRODUCTION.EXT_RAW_AMI;

-- List files in the stage
LIST @SI_DEMOS.PRODUCTION.EXT_RAW_AMI/ami_interval_readings/ PATTERN='.*parquet';

-- Sample query directly from stage
SELECT $1:METER_ID::VARCHAR as METER_ID, 
       $1:TIMESTAMP::TIMESTAMP_NTZ as TIMESTAMP,
       $1:USAGE_KWH::FLOAT as USAGE_KWH
FROM @SI_DEMOS.PRODUCTION.EXT_RAW_AMI/ami_interval_readings/
(FILE_FORMAT => (TYPE = PARQUET))
LIMIT 10;
```

#### Option 2: Load to New Table (Recommended for Production)

Run the following SQL to create a new table and load the data:

```sql
-- Set context
USE DATABASE SI_DEMOS;
USE SCHEMA PRODUCTION;
USE WAREHOUSE SI_DEMO_WH;

-- IMPORTANT: Scale up warehouse for large data load
ALTER WAREHOUSE SI_DEMO_WH SET WAREHOUSE_SIZE = 'XLARGE';

-- Create target table if it doesn't exist
CREATE TABLE IF NOT EXISTS AMI_INTERVAL_READINGS (
    METER_ID VARCHAR,
    TIMESTAMP TIMESTAMP_NTZ,
    USAGE_KWH FLOAT,
    VOLTAGE NUMBER(22,0),
    POWER_FACTOR NUMBER(23,2),
    CUSTOMER_SEGMENT_ID VARCHAR(11),
    SOURCE_TABLE VARCHAR
) CLUSTER BY (DATE_TRUNC('day', TIMESTAMP), METER_ID);

-- Load from external stage
COPY INTO AMI_INTERVAL_READINGS
FROM @EXT_RAW_AMI/ami_interval_readings/
FILE_FORMAT = (TYPE = PARQUET)
MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE
ON_ERROR = 'CONTINUE';

-- Reset warehouse size
ALTER WAREHOUSE SI_DEMO_WH SET WAREHOUSE_SIZE = 'MEDIUM';

-- Verify load
SELECT COUNT(*) as total_rows,
       MIN(TIMESTAMP) as min_date,
       MAX(TIMESTAMP) as max_date,
       COUNT(DISTINCT METER_ID) as unique_meters
FROM AMI_INTERVAL_READINGS;
```

**Expected Output:**
```
| TOTAL_ROWS    | MIN_DATE            | MAX_DATE            | UNIQUE_METERS |
|---------------|---------------------|---------------------|---------------|
| 7,105,569,024 | 2024-07-01 00:00:00 | 2025-08-31 23:45:00 | 596,906       |
```
**Note:** Data spans 4 months (Jul/Aug 2024 and Jul/Aug 2025), not continuous 14 months.

#### Option 3: Cross-Account Access (External User)

For users in a different Snowflake account, contact the data owner (Abhinav Bannerjee) to:
1. Add your AWS account to the S3 bucket policy, OR
2. Create a storage integration with your external ID, OR
3. Request a data share

---

## Stage Configuration Details

The external stage uses a Snowflake storage integration with AWS IAM role:

| Property | Value |
|----------|-------|
| Stage URL | `s3://abannerjee-ami-demo/raw/ami/` |
| Storage Integration | `S3_INTEGRATION` |
| AWS Role ARN | `arn:aws:iam::484577546576:role/abannerjee-ami-demo-access-role` |
| File Format | PARQUET (snappy compression) |

---

## Data Quality

The AMI data has been audited for quality (see SCENARIO_AUDIT_LOG.md):

| Check | Status | Notes |
|-------|--------|-------|
| Temporal Continuity | PASS | Perfect 96 readings/meter/day |
| Voltage Quality | PASS | 99.99% in normal 110-125V range |
| Referential Integrity | PASS | All meters exist in METER_INFRASTRUCTURE |
| Date Coverage | PASS | Complete 14-month coverage |

---

## Performance Tips

1. **Warehouse Sizing**: Use XLARGE or larger for the initial load (~30 seconds with XLARGE)
2. **Clustering**: The table is clustered by (date, meter_id) for optimal query performance
3. **Parallel Loading**: Snowflake automatically parallelizes across all 385 parquet files

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Access denied to S3 | Verify storage integration trust policy includes your Snowflake account |
| Load timeout | Scale up warehouse to XLARGE or larger |
| Schema mismatch | Use MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE |

---

## Related Documents

- [SCENARIO_AUDIT_LOG.md](../../SCENARIO_AUDIT_LOG.md) - Full data quality audit
- [PROJECT_STATUS.md](../../PROJECT_STATUS.md) - Project status and scale assessment
- [CENTERPOINT_ARCHITECTURE.md](../CENTERPOINT_ARCHITECTURE.md) - Full architecture doc

---

*Last Updated: January 28, 2026*
