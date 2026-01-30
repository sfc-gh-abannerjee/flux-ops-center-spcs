# Flux Operations Center - Data Loading Guide

This guide documents how to load the production demo data for the Flux Operations Center, including large-scale AMI datasets.

---

## Data Overview

| Dataset | Rows | Size | Location | Format |
|---------|------|------|----------|--------|
| **AMI_INTERVAL_READINGS** | 7+ billion | ~80 GB | S3 External Stage | Parquet |
| Other tables | ~1.6M total | ~7 GB | Snowflake | Native |

---

## AMI Interval Readings

### Source Details

| Property | Value |
|----------|-------|
| **Location** | `s3://<your-bucket>/raw/ami/ami_interval_readings/` |
| **File Count** | ~385 parquet files |
| **Total Size** | ~80 GB compressed |
| **Row Count** | 7+ billion |
| **Date Range** | 4 months of data |
| **Interval** | 15-minute readings (96 readings/meter/day) |
| **Unique Meters** | ~600K |

### Schema

| Column | Type | Description |
|--------|------|-------------|
| METER_ID | VARCHAR | Unique meter identifier |
| TIMESTAMP | TIMESTAMP_NTZ | Reading timestamp (15-min intervals) |
| USAGE_KWH | FLOAT | Energy consumption in kWh |
| VOLTAGE | NUMBER(22,0) | Voltage reading |
| POWER_FACTOR | NUMBER(23,2) | Power factor |
| CUSTOMER_SEGMENT_ID | VARCHAR(11) | Customer segment reference |
| SOURCE_TABLE | VARCHAR | Source table identifier |

### Loading Instructions

#### Option 1: Direct Stage Access (Same Snowflake Account)

If you have access to the external stage:

```sql
-- Verify the stage exists
DESC STAGE <your_database>.PRODUCTION.EXT_RAW_AMI;

-- List files in the stage
LIST @<your_database>.PRODUCTION.EXT_RAW_AMI/ami_interval_readings/ PATTERN='.*parquet';

-- Sample query directly from stage
SELECT $1:METER_ID::VARCHAR as METER_ID, 
       $1:TIMESTAMP::TIMESTAMP_NTZ as TIMESTAMP,
       $1:USAGE_KWH::FLOAT as USAGE_KWH
FROM @<your_database>.PRODUCTION.EXT_RAW_AMI/ami_interval_readings/
(FILE_FORMAT => (TYPE = PARQUET))
LIMIT 10;
```

#### Option 2: Load to New Table (Recommended for Production)

Run the following SQL to create a new table and load the data:

```sql
-- Set context
USE DATABASE <your_database>;
USE SCHEMA PRODUCTION;
USE WAREHOUSE <your_warehouse>;

-- IMPORTANT: Scale up warehouse for large data load
ALTER WAREHOUSE <your_warehouse> SET WAREHOUSE_SIZE = 'XLARGE';

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
ALTER WAREHOUSE <your_warehouse> SET WAREHOUSE_SIZE = 'MEDIUM';

-- Verify load
SELECT COUNT(*) as total_rows,
       MIN(TIMESTAMP) as min_date,
       MAX(TIMESTAMP) as max_date,
       COUNT(DISTINCT METER_ID) as unique_meters
FROM AMI_INTERVAL_READINGS;
```

#### Option 3: Cross-Account Access (External User)

For users in a different Snowflake account:
1. Add your AWS account to the S3 bucket policy, OR
2. Create a storage integration with your external ID, OR
3. Request a data share

---

## Stage Configuration Details

The external stage uses a Snowflake storage integration with AWS IAM role:

| Property | Value |
|----------|-------|
| Stage URL | `s3://<your-bucket>/raw/ami/` |
| Storage Integration | `S3_INTEGRATION` |
| AWS Role ARN | `arn:aws:iam::<your-account-id>:role/<your-role-name>` |
| File Format | PARQUET (snappy compression) |

---

## Data Quality

The AMI data should be audited for quality:

| Check | Expected |
|-------|----------|
| Temporal Continuity | 96 readings/meter/day |
| Voltage Quality | 99%+ in normal 110-125V range |
| Referential Integrity | All meters exist in METER_INFRASTRUCTURE |
| Date Coverage | Complete coverage for specified date range |

---

## Performance Tips

1. **Warehouse Sizing**: Use XLARGE or larger for the initial load (~30 seconds with XLARGE)
2. **Clustering**: The table is clustered by (date, meter_id) for optimal query performance
3. **Parallel Loading**: Snowflake automatically parallelizes across all parquet files

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Access denied to S3 | Verify storage integration trust policy includes your Snowflake account |
| Load timeout | Scale up warehouse to XLARGE or larger |
| Schema mismatch | Use MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE |

---

## Related Documents

- [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) - Local dev setup
- [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) - Snowflake→Postgres sync
