-- =============================================================================
-- FLUX OPS CENTER - Production Views DDL Export
-- Generated: Wed Jan 28 18:37:33 CST 2026
-- Purpose: Create views required for semantic model and demo functionality
-- =============================================================================

USE DATABASE SI_DEMOS;
USE SCHEMA PRODUCTION;



create or replace view AMI_READINGS_WITH_VOLTAGE_EVENTS(
        METER_ID,
        TIMESTAMP,
        USAGE_KWH,
        CUSTOMER_SEGMENT_ID,
        SOURCE_TABLE,
        VOLTAGE,
        POWER_FACTOR,
        VOLTAGE_SAG_EVENT_ID,
        SAG_TYPE,
        VOLTAGE_DROP_AMOUNT,
        VOLTAGE_ADJUSTED
) as
SELECT
  air.METER_ID,
  air.TIMESTAMP,
  air.USAGE_KWH,
  air.CUSTOMER_SEGMENT_ID,
  air.SOURCE_TABLE,
  air.VOLTAGE,
  air.POWER_FACTOR,
  vsa.event_id AS voltage_sag_event_id,
  vsa.sag_type,
  vsa.voltage_drop_amount,
  CASE
    WHEN vsa.event_id IS NOT NULL THEN air.VOLTAGE - vsa.voltage_drop_amount
    ELSE air.VOLTAGE
  END AS voltage_adjusted
FROM SI_DEMOS.PRODUCTION.AMI_INTERVAL_READINGS air
JOIN SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE mi ON air.METER_ID =
mi.METER_ID
LEFT JOIN SI_DEMOS.PRODUCTION.VOLTAGE_SAG_EVENTS vsa
  ON mi.TRANSFORMER_ID = vsa.TRANSFORMER_ID
  AND air.TIMESTAMP BETWEEN vsa.sag_start_time AND vsa.sag_end_time
WHERE mi.TRANSFORMER_ID IS NOT NULL;



create or replace view AMI_READINGS_FINAL(
        METER_ID,
        TIMESTAMP,
        USAGE_KWH,
        OUTAGE_ID,
        OUTAGE_CAUSE,
        VOLTAGE,
        USAGE_KWH_ADJUSTED,
        POWER_FACTOR,
        VOLTAGE_SAG_EVENT_ID,
        SAG_TYPE,
        VOLTAGE_DROP_AMOUNT
) as
SELECT
  arv.METER_ID,
  arv.TIMESTAMP,
  arv.USAGE_KWH,
  oe.outage_id,
  oe.outage_cause,
  CASE
    WHEN oe.outage_id IS NOT NULL THEN NULL
    ELSE arv.voltage_adjusted
  END AS VOLTAGE,
  CASE
    WHEN oe.outage_id IS NOT NULL THEN 0
    ELSE arv.USAGE_KWH
  END AS USAGE_KWH_ADJUSTED,
  arv.POWER_FACTOR,
  arv.voltage_sag_event_id,
  arv.sag_type,
  arv.voltage_drop_amount
FROM SI_DEMOS.PRODUCTION.AMI_READINGS_WITH_VOLTAGE_EVENTS arv
JOIN SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE mi ON arv.METER_ID =
mi.METER_ID
LEFT JOIN SI_DEMOS.PRODUCTION.OUTAGE_EVENTS oe
  ON mi.TRANSFORMER_ID = oe.TRANSFORMER_ID
  AND arv.TIMESTAMP BETWEEN oe.outage_start_time AND oe.outage_end_time;



create or replace view ERCOT_LOAD_UNIFIED(
        TIMESTAMP_UTC,
        ERCOT_TOTAL_MW,
        HOUSTON_SHARE_PCT,
        SOURCE,
        YEAR,
        MONTH
) COMMENT='ERCOT system load data from Yes Energy Marketplace - Hourly
electricity demand for Texas grid'
 as

  SELECT
    TIMESTAMP_UTC,
    ERCOT_TOTAL_MW,
    HOUSTON_SHARE_PCT,
    'HISTORICAL' as SOURCE,
    YEAR,
    MONTH
  FROM SI_DEMOS.APPLICATIONS.ERCOT_HISTORICAL_LOAD
  WHERE TIMESTAMP_UTC < '2025-07-01'

  UNION ALL


  SELECT
    TIMESTAMP_UTC,
    ERCOT_TOTAL_MW,
    HOUSTON_SHARE_PCT,
    'PRODUCTION' as SOURCE,
    YEAR(TIMESTAMP_UTC) as YEAR,
    MONTH(TIMESTAMP_UTC) as MONTH
  FROM SI_DEMOS.PRODUCTION.ERCOT_HISTORICAL_LOAD;



create or replace view ERCOT_LMP_UNIFIED(
        TIMESTAMP_UTC,
        LMP_ENERGY,
        LMP_CONGESTION,
        LMP_LOSS,
        LMP_TOTAL,
        SOURCE,
        YEAR,
        MONTH
) COMMENT='Locational Marginal Pricing from Yes Energy Marketplace -
Real-time and day-ahead electricity prices for Houston ERCOT zone'
 as

  SELECT
    TIMESTAMP_UTC,
    LMP_ENERGY,
    LMP_CONGESTION,
    LMP_LOSS,
    LMP_TOTAL,
    'HISTORICAL' as SOURCE,
    YEAR(TIMESTAMP_UTC) as YEAR,
    MONTH(TIMESTAMP_UTC) as MONTH
  FROM SI_DEMOS.APPLICATIONS.ERCOT_LMP_HOUSTON_ZONE

  UNION ALL


  SELECT
    TIMESTAMP_UTC,
    LMP_ENERGY,
    LMP_CONGESTION,
    LMP_LOSS,
    LMP_TOTAL,
    'PRODUCTION' as SOURCE,
    YEAR(TIMESTAMP_UTC) as YEAR,
    MONTH(TIMESTAMP_UTC) as MONTH
  FROM SI_DEMOS.PRODUCTION.ERCOT_LMP_HOUSTON_ZONE;



create or replace view ENERGY_BURDEN_ANALYSIS(
        METER_ID,
        TRANSFORMER_ID,
        USAGE_MONTH,
        YEAR,
        MONTH,
        MONTHLY_KWH,
        AVG_LMP,
        ESTIMATED_MONTHLY_BILL_USD,
        CUSTOMER_SEGMENT_ID,
        BUILDING_TYPE,
        COUNTY_NAME,
        CBG_MEDIAN_INCOME,
        INCOME_CLASSIFICATION,
        HOUSING_THERMAL_QUALITY,
        THERMAL_LOAD_MULTIPLIER,
        ENERGY_BURDEN_RISK_FLAG,
        ANNUAL_ENERGY_BURDEN_PCT,
        BURDEN_CLASSIFICATION,
        LOW_INCOME_FLAG,
        OLD_HOUSING_FLAG,
        HIGH_USAGE_FLAG,
        BURDEN_2024_BASELINE,
        BURDEN_CHANGE_VS_2024_PCT,
        METERS_IN_SEGMENT,
        SEGMENT_TOTAL_KWH,
        SEGMENT_AVG_KWH,
        ZIP_CODE,
        CITY,
        IS_MASTER_METER,
        BURDEN_CLASSIFICATION_REFINED
) COMMENT='Energy Burden Analysis with Master Meter Detection and YoY Change
- Production-Grade Framework for Utility Customer Analytics. Master meters
(multi-unit buildings) are identified and excluded from individual household
burden calculations. Fix Jan 22 2026: Deduplicated CUSTOMERS_MASTER_DATA
join to prevent row multiplication for multi-tenant meters.'
 as
WITH monthly_lmp AS (
  SELECT DATE_TRUNC('month', TIMESTAMP_UTC) as usage_month, AVG(LMP_TOTAL)
as avg_lmp
  FROM SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED
  GROUP BY DATE_TRUNC('month', TIMESTAMP_UTC)
),
meter_demographics AS (
  SELECT
    mu.METER_ID, mu.CUSTOMER_SEGMENT_ID, mu.BUILDING_TYPE,
    CASE mu.CUSTOMER_SEGMENT_ID
      WHEN 'RESIDENTIAL' THEN 85000
      WHEN 'COMMERCIAL' THEN 150000
      WHEN 'INDUSTRIAL' THEN 500000
      ELSE 85000
    END as median_income,
    2005 as median_year_built
  FROM (SELECT DISTINCT METER_ID, CUSTOMER_SEGMENT_ID, BUILDING_TYPE FROM
SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE) mu
),
usage_percentiles AS (
  SELECT
    CUSTOMER_SEGMENT_ID,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY MONTHLY_KWH) as
p99_threshold
  FROM SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE
  GROUP BY CUSTOMER_SEGMENT_ID
),
baseline_2024 AS (
  SELECT
    mu.METER_ID,
    ROUND((((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
           NULLIF(ROUND(md.median_income * (0.50 +
(MOD(ABS(HASH(mu.METER_ID)), 100) / 100.0))), 0)) * 100, 2) AS burden_2024
  FROM SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE mu
  INNER JOIN monthly_lmp lmp ON mu.USAGE_MONTH = lmp.usage_month
  INNER JOIN meter_demographics md ON mu.METER_ID = md.METER_ID
  WHERE YEAR(mu.USAGE_MONTH) = 2024 AND MONTH(mu.USAGE_MONTH) = 7
),
-- FIX: Deduplicate CUSTOMERS_MASTER_DATA to get one row per meter
customers_deduped AS (
  SELECT
    PRIMARY_METER_ID,
    ZIP_CODE,
    CITY,
    COUNT(*) as CUSTOMERS_ON_METER  -- Track multi-tenant count
  FROM SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA
  GROUP BY PRIMARY_METER_ID, ZIP_CODE, CITY
)
SELECT
  mu.METER_ID, mu.TRANSFORMER_ID, mu.USAGE_MONTH,
  YEAR(mu.USAGE_MONTH) as YEAR, MONTH(mu.USAGE_MONTH) as MONTH,
  mu.MONTHLY_KWH, lmp.avg_lmp AS AVG_LMP,
  ROUND((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40, 2) AS
ESTIMATED_MONTHLY_BILL_USD,
  mu.CUSTOMER_SEGMENT_ID, mu.BUILDING_TYPE,
  zcl.COUNTY as COUNTY_NAME,
  ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))) as CBG_MEDIAN_INCOME,
  CASE WHEN mu.CUSTOMER_SEGMENT_ID = 'RESIDENTIAL' THEN
    CASE WHEN md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0)) > 100000 THEN 'High Income'
         WHEN md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0)) > 75000 THEN 'Upper Middle Income'
         WHEN md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0)) > 50000 THEN 'Middle Income'
         ELSE 'Lower Income' END
  ELSE mu.CUSTOMER_SEGMENT_ID END as INCOME_CLASSIFICATION,
  CASE WHEN md.median_year_built + MOD(ABS(HASH(mu.METER_ID || 'year')), 40)
- 20 < 1980 THEN 'Poor Insulation (Pre-1980)'
       WHEN md.median_year_built + MOD(ABS(HASH(mu.METER_ID || 'year')), 40)
- 20 < 2000 THEN 'Fair Insulation (1980-1999)'
       ELSE 'Good Insulation (Post-2000)' END as HOUSING_THERMAL_QUALITY,
  CASE WHEN md.median_year_built + MOD(ABS(HASH(mu.METER_ID || 'year')), 40)
- 20 < 1980 THEN 1.30
       WHEN md.median_year_built + MOD(ABS(HASH(mu.METER_ID || 'year')), 40)
- 20 < 2000 THEN 1.15
       ELSE 1.00 END as THERMAL_LOAD_MULTIPLIER,
  CASE WHEN mu.CUSTOMER_SEGMENT_ID = 'RESIDENTIAL' THEN
    (ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))) < 50000
     AND md.median_year_built + MOD(ABS(HASH(mu.METER_ID || 'year')), 40) -
20 < 1990)
  ELSE FALSE END as ENERGY_BURDEN_RISK_FLAG,
  ROUND((((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100, 2) AS ANNUAL_ENERGY_BURDEN_PCT,
  CASE WHEN mu.CUSTOMER_SEGMENT_ID != 'RESIDENTIAL' THEN 'N/A
(Non-Residential)'
       WHEN (((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100 > 10 THEN 'Severe'
       WHEN (((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100 > 6 THEN 'High'
       WHEN (((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100 > 3 THEN 'Moderate'
       ELSE 'Low' END AS BURDEN_CLASSIFICATION,
  CASE WHEN mu.CUSTOMER_SEGMENT_ID = 'RESIDENTIAL' THEN
ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))) < 50000 ELSE FALSE END AS LOW_INCOME_FLAG,
  md.median_year_built + MOD(ABS(HASH(mu.METER_ID || 'year')), 40) - 20 <
1980 AS OLD_HOUSING_FLAG,
  mu.MONTHLY_KWH > CASE mu.CUSTOMER_SEGMENT_ID WHEN 'RESIDENTIAL' THEN 1500
WHEN 'COMMERCIAL' THEN 6000 WHEN 'INDUSTRIAL' THEN 35000 ELSE 1500 END AS
HIGH_USAGE_FLAG,
  b24.burden_2024 as BURDEN_2024_BASELINE,
  ROUND(ROUND((((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100, 2) - b24.burden_2024, 2) as BURDEN_CHANGE_VS_2024_PCT,
  COUNT(mu.METER_ID) OVER (PARTITION BY mu.USAGE_MONTH,
mu.CUSTOMER_SEGMENT_ID, mu.BUILDING_TYPE) as METERS_IN_SEGMENT,
  ROUND(SUM(mu.MONTHLY_KWH) OVER (PARTITION BY mu.USAGE_MONTH,
mu.CUSTOMER_SEGMENT_ID, mu.BUILDING_TYPE), 2) as SEGMENT_TOTAL_KWH,
  ROUND(AVG(mu.MONTHLY_KWH) OVER (PARTITION BY mu.USAGE_MONTH,
mu.CUSTOMER_SEGMENT_ID, mu.BUILDING_TYPE), 2) as SEGMENT_AVG_KWH,
  cmd.ZIP_CODE, cmd.CITY,
  CASE
    WHEN mu.CUSTOMER_SEGMENT_ID = 'RESIDENTIAL'
     AND mu.BUILDING_TYPE IN ('apartments', 'commercial', 'retail',
'warehouse', 'industrial')
     AND mu.MONTHLY_KWH > 5000
    THEN TRUE
    WHEN mu.CUSTOMER_SEGMENT_ID = 'RESIDENTIAL'
     AND mu.MONTHLY_KWH > up.p99_threshold
    THEN TRUE
    WHEN cmd.CUSTOMERS_ON_METER > 1 THEN TRUE  -- # Flag multi-tenant
meters
    ELSE FALSE
  END AS IS_MASTER_METER,
  CASE
    WHEN mu.CUSTOMER_SEGMENT_ID != 'RESIDENTIAL' THEN 'N/A
(Non-Residential)'
    WHEN mu.CUSTOMER_SEGMENT_ID = 'RESIDENTIAL'
     AND (mu.BUILDING_TYPE IN ('apartments', 'commercial', 'retail',
'warehouse', 'industrial') AND mu.MONTHLY_KWH > 5000
          OR mu.MONTHLY_KWH > up.p99_threshold
          OR cmd.CUSTOMERS_ON_METER > 1)  -- # Include multi-tenant in
master meter exclusion
    THEN 'N/A (Master Meter)'
    WHEN (((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100 > 10 THEN 'Severe'
    WHEN (((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100 > 6 THEN 'High'
    WHEN (((mu.MONTHLY_KWH / 1000) * lmp.avg_lmp + 40) * 12 /
NULLIF(ROUND(md.median_income * (0.50 + (MOD(ABS(HASH(mu.METER_ID)), 100) /
100.0))), 0)) * 100 > 3 THEN 'Moderate'
    ELSE 'Low'
  END AS BURDEN_CLASSIFICATION_REFINED
FROM SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE mu
INNER JOIN monthly_lmp lmp ON mu.USAGE_MONTH = lmp.usage_month
INNER JOIN meter_demographics md ON mu.METER_ID = md.METER_ID
LEFT JOIN customers_deduped cmd ON mu.METER_ID = cmd.PRIMARY_METER_ID  --
# Use deduplicated CTE
LEFT JOIN SI_DEMOS.PRODUCTION.ZIP_COUNTY_LOOKUP zcl ON cmd.ZIP_CODE =
zcl.ZIP_CODE
LEFT JOIN usage_percentiles up ON mu.CUSTOMER_SEGMENT_ID =
up.CUSTOMER_SEGMENT_ID
LEFT JOIN baseline_2024 b24 ON mu.METER_ID = b24.METER_ID;



create or replace view ENERGY_BURDEN_TRENDS(
        CUSTOMER_SEGMENT_ID,
        BUILDING_TYPE,
        COST_MONTH,
        YEAR,
        MONTH,
        METERS_IN_SEGMENT,
        TOTAL_KWH_USED,
        AVG_LMP_PRICE,
        ESTIMATED_COST_DOLLARS,
        AVG_KWH_PER_METER,
        ESTIMATED_ANNUAL_INCOME,
        ANNUAL_ENERGY_BURDEN_PCT,
        BURDEN_CATEGORY
) as
SELECT
  CUSTOMER_SEGMENT_ID,
  BUILDING_TYPE,
  USAGE_MONTH as COST_MONTH,
  YEAR(USAGE_MONTH) as YEAR,
  MONTH(USAGE_MONTH) as MONTH,

  MAX(METERS_IN_SEGMENT) as METERS_IN_SEGMENT,
  MAX(SEGMENT_TOTAL_KWH) as TOTAL_KWH_USED,

  ROUND(AVG(AVG_LMP), 2) as AVG_LMP_PRICE,
  ROUND(SUM(ESTIMATED_MONTHLY_BILL_USD), 2) as ESTIMATED_COST_DOLLARS,
  MAX(SEGMENT_AVG_KWH) as AVG_KWH_PER_METER,
  ROUND(AVG(CBG_MEDIAN_INCOME), 0) as ESTIMATED_ANNUAL_INCOME,
  ROUND(AVG(ANNUAL_ENERGY_BURDEN_PCT), 2) as ANNUAL_ENERGY_BURDEN_PCT,
  MODE(BURDEN_CLASSIFICATION) as BURDEN_CATEGORY
FROM SI_DEMOS.PRODUCTION.ENERGY_BURDEN_ANALYSIS
GROUP BY
  CUSTOMER_SEGMENT_ID,
  BUILDING_TYPE,
  USAGE_MONTH
ORDER BY COST_MONTH, CUSTOMER_SEGMENT_ID, BUILDING_TYPE;



create or replace view EQUIPMENT_STRESS_TRENDS_HISTORICAL(
        TRANSFORMER_ID,
        YEAR,
        SUMMER_CRITICAL_HOURS,
        SUMMER_HIGH_STRESS_HOURS,
        SUMMER_AVG_LOAD,
        SUMMER_PEAK_LOAD,
        RATED_KVA,
        INSTALL_YEAR,
        TRANSFORMER_AGE_YEARS
) as
WITH transformer_monthly_stress AS (
  SELECT
    thl.TRANSFORMER_ID,
    DATE_TRUNC('MONTH', thl.LOAD_HOUR) as stress_month,
    COUNT(CASE WHEN thl.STRESS_LEVEL = 'CRITICAL_OVERLOAD' THEN 1 END) as
critical_hours,
    COUNT(CASE WHEN thl.STRESS_LEVEL = 'HIGH_STRESS' THEN 1 END) as
high_stress_hours,
    ROUND(AVG(thl.HOURLY_KWH), 2) as avg_hourly_load,
    ROUND(MAX(thl.HOURLY_KWH), 2) as peak_hourly_load
  FROM SI_DEMOS.PRODUCTION.TRANSFORMER_HOURLY_LOAD thl
  GROUP BY thl.TRANSFORMER_ID, DATE_TRUNC('MONTH', thl.LOAD_HOUR)
),
summer_comparison AS (
  SELECT
    TRANSFORMER_ID,
    YEAR(stress_month) as year,
    SUM(critical_hours) as summer_critical_hours,
    SUM(high_stress_hours) as summer_high_stress_hours,
    ROUND(AVG(avg_hourly_load), 2) as summer_avg_load,
    ROUND(MAX(peak_hourly_load), 2) as summer_peak_load
  FROM transformer_monthly_stress
  WHERE MONTH(stress_month) IN (7,8)
  GROUP BY TRANSFORMER_ID, YEAR(stress_month)
)
SELECT
  sc.TRANSFORMER_ID,
  sc.year,
  sc.summer_critical_hours,
  sc.summer_high_stress_hours,
  sc.summer_avg_load,
  sc.summer_peak_load,
  tm.RATED_KVA,
  tm.INSTALL_YEAR,
  tm.AGE_YEARS as transformer_age_years
FROM summer_comparison sc
JOIN SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA tm ON sc.TRANSFORMER_ID =
tm.TRANSFORMER_ID
ORDER BY sc.year, sc.summer_critical_hours DESC;



create or replace view GRID_RELIABILITY_METRICS(
        REPORT_MONTH,
        AFFECTED_CUSTOMERS,
        TOTAL_CUSTOMERS,
        TOTAL_INTERRUPTIONS,
        TOTAL_OUTAGE_MINUTES,
        SAIDI_MINUTES_PER_CUSTOMER,
        SAIFI_INTERRUPTIONS_PER_CUSTOMER,
        CAIDI_AVG_OUTAGE_DURATION_MINUTES
) as
WITH customer_outages AS (
  SELECT
    DATE_TRUNC('month', arf.TIMESTAMP) as report_month,
    arf.METER_ID,
    COUNT(DISTINCT arf.outage_id) as interruption_count,
    SUM(DISTINCT oe.outage_duration_minutes) as total_outage_minutes
  FROM SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL arf
  JOIN SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE mi ON arf.METER_ID =
mi.METER_ID
  LEFT JOIN SI_DEMOS.PRODUCTION.OUTAGE_EVENTS oe ON arf.outage_id =
oe.outage_id
  WHERE arf.outage_id IS NOT NULL
  GROUP BY report_month, arf.METER_ID
),
monthly_metrics AS (
  SELECT
    report_month,
    COUNT(DISTINCT METER_ID) as affected_customers,
    (SELECT COUNT(DISTINCT METER_ID) FROM
SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE) as total_customers,
    SUM(interruption_count) as total_interruptions,
    SUM(total_outage_minutes) as total_outage_minutes,
    ROUND(SUM(total_outage_minutes) * 1.0 / total_customers, 2) as SAIDI,
    ROUND(SUM(interruption_count) * 1.0 / total_customers, 4) as SAIFI
  FROM customer_outages
  GROUP BY report_month
)
SELECT
  report_month,
  affected_customers,
  total_customers,
  total_interruptions,
  total_outage_minutes,
  SAIDI as saidi_minutes_per_customer,
  SAIFI as saifi_interruptions_per_customer,
  ROUND(SAIDI / NULLIF(SAIFI, 0), 2) as CAIDI_avg_outage_duration_minutes
FROM monthly_metrics
ORDER BY report_month;



create or replace view REVENUE_ANOMALY_DETECTION(
        METER_ID,
        READING_DATE,
        YEAR,
        MONTH,
        DAILY_KWH,
        DAILY_REVENUE,
        AVG_VOLTAGE,
        OUTAGE_COUNT,
        AVG_DAILY_KWH,
        STDDEV_DAILY_KWH,
        BASELINE_AVG_REVENUE,
        IS_USAGE_ANOMALY,
        IS_PRICING_ANOMALY_VS_2024,
        REVENUE_CHANGE_PCT_VS_2024
) as
WITH daily_revenue AS (
    SELECT
        ami.METER_ID,
        DATE(ami.TIMESTAMP) as reading_date,
        SUM(ami.USAGE_KWH_ADJUSTED) as daily_kwh,
        SUM(ami.USAGE_KWH_ADJUSTED * 0.12) as daily_revenue,
        AVG(ami.VOLTAGE) as avg_voltage,
        COUNT(DISTINCT ami.OUTAGE_ID) as outage_count
    FROM SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL ami
    GROUP BY ami.METER_ID, DATE(ami.TIMESTAMP)
),
meter_stats AS (
    SELECT
        METER_ID,
        AVG(daily_kwh) as avg_daily_kwh,
        STDDEV(daily_kwh) as stddev_daily_kwh
    FROM daily_revenue
    GROUP BY METER_ID
),
historical_pricing_baseline AS (
    SELECT
        DATE(reading_date) as baseline_date,
        AVG(daily_revenue) as baseline_avg_revenue,
        STDDEV(daily_revenue) as baseline_stddev_revenue
    FROM daily_revenue
    WHERE YEAR(reading_date) = 2024
    GROUP BY DATE(reading_date)
)
SELECT
    dr.METER_ID,
    dr.reading_date,
    YEAR(dr.reading_date) as year,
    MONTH(dr.reading_date) as month,
    dr.daily_kwh,
    dr.daily_revenue,
    dr.avg_voltage,
    dr.outage_count,
    ms.avg_daily_kwh,
    ms.stddev_daily_kwh,
    hpb.baseline_avg_revenue,
    CASE
        WHEN ABS(dr.daily_kwh - ms.avg_daily_kwh) > 3 * ms.stddev_daily_kwh
THEN TRUE
        ELSE FALSE
    END as is_usage_anomaly,
    CASE
        WHEN hpb.baseline_avg_revenue IS NOT NULL
             AND ABS(dr.daily_revenue - hpb.baseline_avg_revenue) > 2 *
hpb.baseline_stddev_revenue
        THEN TRUE
        ELSE FALSE
    END as is_pricing_anomaly_vs_2024,
    ROUND((dr.daily_revenue - hpb.baseline_avg_revenue) /
NULLIF(hpb.baseline_avg_revenue, 0) * 100, 2) as revenue_change_pct_vs_2024
FROM daily_revenue dr
JOIN meter_stats ms ON dr.METER_ID = ms.METER_ID
LEFT JOIN historical_pricing_baseline hpb
    ON DATE_TRUNC('DAY', dr.reading_date) = hpb.baseline_date
       OR (MONTH(dr.reading_date) = MONTH(hpb.baseline_date) AND
DAY(dr.reading_date) = DAY(hpb.baseline_date));



create or replace view REVENUE_HISTORICAL_BASELINE(
        YEAR,
        MONTH,
        AVG_LMP,
        MIN_LMP,
        MAX_LMP,
        STDDEV_LMP,
        HOURLY_PRICE_POINTS
) as
SELECT
  YEAR,
  MONTH,
  ROUND(AVG(LMP_TOTAL), 2) as avg_lmp,
  ROUND(MIN(LMP_TOTAL), 2) as min_lmp,
  ROUND(MAX(LMP_TOTAL), 2) as max_lmp,
  ROUND(STDDEV(LMP_TOTAL), 2) as stddev_lmp,
  COUNT(*) as hourly_price_points
FROM SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED
GROUP BY YEAR, MONTH
ORDER BY YEAR, MONTH;



create or replace view STORM_OUTAGE_IMPACT_ANALYSIS(
        WEATHER_EVENT_ID,
        EVENT_TYPE,
        EVENT_HOUR,
        YEAR,
        MONTH,
        SEVERITY_LEVEL,
        WIND_SPEED_MPH,
        PRECIPITATION_INCHES,
        LOCATION_AREA,
        OUTAGES_DURING_EVENT,
        TOTAL_CUSTOMERS_AFFECTED,
        TOTAL_SAIDI_MINUTES,
        AVG_WEATHER_IMPACT,
        TOTAL_CREWS_DEPLOYED,
        EVENT_CLASSIFICATION,
        REPORTABLE_TO_PUC_FLAG,
        HISTORICAL_AVG_OUTAGES_FOR_THIS_WEATHER,
        OUTAGE_VS_HISTORICAL
) as
WITH
  weather_events_hourly AS (
    SELECT
      we.WEATHER_EVENT_ID,
      we.EVENT_TYPE,
      DATE_TRUNC('hour', we.START_TIMESTAMP) AS EVENT_HOUR,
      we.SEVERITY_LEVEL,
      we.WIND_SPEED_MPH,
      we.PRECIPITATION_INCHES,
      we.LOCATION_AREA
    FROM SI_DEMOS.PRODUCTION.WEATHER_EVENTS we
  ),

  outage_timing AS (
    SELECT
      o.OUTAGE_ID,
      o.OUTAGE_CAUSE,
      DATE_TRUNC('hour', o.OUTAGE_START_TIMESTAMP) AS OUTAGE_HOUR,
      o.AFFECTED_CUSTOMERS_COUNT,
      o.SAIDI_MINUTES_ACCUMULATED,
      o.WEATHER_IMPACT_FACTOR,
      o.ASSIGNED_CREW_COUNT,
      o.RESTORATION_STATUS
    FROM SI_DEMOS.PRODUCTION.OUTAGE_RESTORATION_TRACKER o
  ),


  historical_correlation AS (
    SELECT
      weather_category,
      AVG(outage_count) as avg_outages_per_day,
      AVG(total_outage_minutes) as avg_outage_duration
    FROM SI_DEMOS.PRODUCTION.WEATHER_OUTAGE_CORRELATION_HISTORICAL
    GROUP BY weather_category
  )

SELECT
  we.WEATHER_EVENT_ID,
  we.EVENT_TYPE,
  we.EVENT_HOUR,
  YEAR(we.EVENT_HOUR) as year,
  MONTH(we.EVENT_HOUR) as month,
  we.SEVERITY_LEVEL,
  we.WIND_SPEED_MPH,
  we.PRECIPITATION_INCHES,
  we.LOCATION_AREA,

  COUNT(DISTINCT o.OUTAGE_ID) AS OUTAGES_DURING_EVENT,
  SUM(o.AFFECTED_CUSTOMERS_COUNT) AS TOTAL_CUSTOMERS_AFFECTED,
  SUM(o.SAIDI_MINUTES_ACCUMULATED) AS TOTAL_SAIDI_MINUTES,
  AVG(o.WEATHER_IMPACT_FACTOR) AS AVG_WEATHER_IMPACT,
  SUM(o.ASSIGNED_CREW_COUNT) AS TOTAL_CREWS_DEPLOYED,

  CASE
    WHEN COUNT(DISTINCT o.OUTAGE_ID) > 100 THEN 'Major Storm Event'
    WHEN COUNT(DISTINCT o.OUTAGE_ID) > 50 THEN 'Significant Event'
    WHEN COUNT(DISTINCT o.OUTAGE_ID) > 10 THEN 'Moderate Event'
    ELSE 'Minor Event'
  END AS EVENT_CLASSIFICATION,

  SUM(o.AFFECTED_CUSTOMERS_COUNT) > 10000 AS REPORTABLE_TO_PUC_FLAG,


  hc.avg_outages_per_day as historical_avg_outages_for_this_weather,
  CASE
    WHEN COUNT(DISTINCT o.OUTAGE_ID) > hc.avg_outages_per_day * 1.5 THEN
'ABOVE_HISTORICAL_AVG'
    WHEN COUNT(DISTINCT o.OUTAGE_ID) < hc.avg_outages_per_day * 0.5 THEN
'BELOW_HISTORICAL_AVG'
    ELSE 'WITHIN_HISTORICAL_RANGE'
  END as outage_vs_historical

FROM weather_events_hourly we
LEFT JOIN outage_timing o
  ON we.EVENT_HOUR = o.OUTAGE_HOUR
  AND o.OUTAGE_CAUSE IN ('WEATHER_STORM', 'WEATHER_HURRICANE',
'WEATHER_TORNADO', 'WEATHER_ICE', 'WEATHER_FLOODING')
LEFT JOIN historical_correlation hc
  ON CASE
       WHEN we.WIND_SPEED_MPH >= 30 THEN 'HIGH_WIND'
       WHEN we.PRECIPITATION_INCHES >= 1.0 THEN 'HEAVY_RAIN'
       WHEN we.PRECIPITATION_INCHES >= 0.5 THEN 'MODERATE_RAIN'
       ELSE 'NORMAL'
     END = hc.weather_category
GROUP BY
  we.WEATHER_EVENT_ID, we.EVENT_TYPE, we.EVENT_HOUR, we.SEVERITY_LEVEL,
  we.WIND_SPEED_MPH, we.PRECIPITATION_INCHES, we.LOCATION_AREA,
  hc.avg_outages_per_day;



create or replace view SUMMER_LOAD_YOY_COMPARISON(
        YEAR,
        AVG_SUMMER_LOAD_MW,
        PEAK_SUMMER_LOAD_MW,
        AVG_HOUSTON_SHARE_PCT,
        SUMMER_HOURLY_RECORDS
) as
SELECT
  YEAR,
  ROUND(AVG(CASE WHEN MONTH IN (7,8) THEN ERCOT_TOTAL_MW END), 0) as
avg_summer_load_mw,
  ROUND(MAX(CASE WHEN MONTH IN (7,8) THEN ERCOT_TOTAL_MW END), 0) as
peak_summer_load_mw,
  ROUND(AVG(CASE WHEN MONTH IN (7,8) THEN HOUSTON_SHARE_PCT END), 2) as
avg_houston_share_pct,
  COUNT(CASE WHEN MONTH IN (7,8) THEN 1 END) as summer_hourly_records
FROM SI_DEMOS.PRODUCTION.ERCOT_LOAD_UNIFIED
WHERE MONTH IN (7,8)
GROUP BY YEAR
ORDER BY YEAR;



create or replace view WEATHER_OUTAGE_CORRELATION_HISTORICAL(
        OUTAGE_DATE,
        YEAR,
        MONTH,
        OUTAGE_COUNT,
        TRANSFORMERS_AFFECTED,
        TOTAL_OUTAGE_MINUTES,
        AVG_TEMP_F,
        MAX_TEMP_F,
        AVG_WIND_SPEED,
        MAX_WIND_SPEED,
        TOTAL_PRECIP,
        HOURS_WITH_PRECIP,
        WEATHER_CATEGORY
) as
WITH daily_weather AS (
  SELECT
    WEATHER_DATE,
    ROUND(AVG(TEMP_F), 1) as avg_temp_f,
    ROUND(MAX(TEMP_F), 1) as max_temp_f,
    ROUND(AVG(WIND_SPEED_MPH), 1) as avg_wind_speed,
    ROUND(MAX(WIND_SPEED_MPH), 1) as max_wind_speed,
    ROUND(SUM(PRECIPITATION_INCHES), 2) as total_precip,
    COUNT(CASE WHEN PRECIPITATION_INCHES > 0 THEN 1 END) as
hours_with_precip
  FROM SI_DEMOS.PRODUCTION.HOUSTON_WEATHER_HOURLY
  GROUP BY WEATHER_DATE
),
daily_outages AS (
  SELECT
    DATE(OUTAGE_START_TIME) as outage_date,
    COUNT(DISTINCT OUTAGE_ID) as outage_count,
    COUNT(DISTINCT TRANSFORMER_ID) as transformers_affected,
    SUM(OUTAGE_DURATION_MINUTES) as total_outage_minutes
  FROM SI_DEMOS.PRODUCTION.OUTAGE_EVENTS
  GROUP BY DATE(OUTAGE_START_TIME)
)
SELECT
  do.outage_date,
  YEAR(do.outage_date) as year,
  MONTH(do.outage_date) as month,
  do.outage_count,
  do.transformers_affected,
  do.total_outage_minutes,
  dw.avg_temp_f,
  dw.max_temp_f,
  dw.avg_wind_speed,
  dw.max_wind_speed,
  dw.total_precip,
  dw.hours_with_precip,
  CASE
    WHEN dw.max_temp_f >= 100 THEN 'EXTREME_HEAT'
    WHEN dw.max_temp_f >= 95 THEN 'HIGH_HEAT'
    WHEN dw.max_wind_speed >= 30 THEN 'HIGH_WIND'
    WHEN dw.total_precip >= 1.0 THEN 'HEAVY_RAIN'
    WHEN dw.total_precip >= 0.5 THEN 'MODERATE_RAIN'
    ELSE 'NORMAL'
  END as weather_category
FROM daily_outages do
LEFT JOIN daily_weather dw ON do.outage_date = dw.WEATHER_DATE
ORDER BY do.outage_count DESC;

