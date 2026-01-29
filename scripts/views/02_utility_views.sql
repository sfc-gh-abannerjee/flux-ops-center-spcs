-- =============================================================================
-- FLUX OPS CENTER - Utility Views DDL Export
-- Generated: Wed Jan 28 18:38:21 CST 2026
-- Purpose: Asset registry and helper views for Cortex Agent/Analyst
-- =============================================================================

USE DATABASE SI_DEMOS;
USE SCHEMA PRODUCTION;



create or replace view VW_AGENT_SEARCHABLE_ASSETS(
        ASSET_TYPE,
        ASSET_ID,
        ASSET_DISPLAY_NAME,
        ASSET_DESCRIPTION,
        LATITUDE,
        LONGITUDE,
        ADDRESS_FULL,
        CITY,
        PRIMARY_PROPERTY_TYPE,
        CAPACITY_KVA,
        STATUS,
        HEALTH_SCORE,
        SEARCHABLE_TEXT
) COMMENT='Unified asset search for Cortex Agent. After materialization,
enable search optimization on searchable_text column.'
 as
SELECT
  'METER' as asset_type,
  meter_id as asset_id,
  meter_display_name as asset_display_name,
  CONCAT(
    'Meter ', meter_id, ' serving ', property_type_category, ' property',
    CASE WHEN building_name != 'Unnamed Building' THEN CONCAT(' at ',
building_name) ELSE '' END,
    ', connected to ', transformer_capacity_kva, ' KVA transformer on
circuit ', circuit_name
  ) as asset_description,
  meter_latitude as latitude,
  meter_longitude as longitude,
  'Houston, TX' as address_full,
  'Houston' as city,
  property_major_category as primary_property_type,
  transformer_capacity_kva as capacity_kva,
  'Active' as status,
  outage_risk_score_0_100 as health_score,
  CONCAT(
    meter_id, ' ', property_type_category, ' ', building_name, ' ',
circuit_name, ' ',
    'meter serving ', property_major_category, ' ',
transformer_capacity_kva, ' KVA'
  ) as searchable_text
FROM SI_DEMOS.PRODUCTION.VW_CORTEX_ANALYST_METER_FACTS

UNION ALL

SELECT
  'TRANSFORMER' as asset_type,
  transformer_id as asset_id,
  transformer_display_name as asset_display_name,
  CONCAT(
    rated_capacity_kva, ' KVA transformer serving ', total_meters_served, '
meters (',
    residential_meter_count, ' residential, ', commercial_meter_count, '
commercial) at ',
    utilization_percentage, '% utilization'
  ) as asset_description,
  NULL as latitude,
  NULL as longitude,
  transformer_location_description as address_full,
  'Houston' as city,
  dominant_property_type_served as primary_property_type,
  rated_capacity_kva as capacity_kva,
  CASE WHEN is_overloaded = 'Yes' THEN 'Overloaded' ELSE 'Normal' END as
status,
  property_capacity_alignment_score as health_score,
  CONCAT(
    transformer_id, ' ', rated_capacity_kva, ' KVA transformer ',
    dominant_property_type_served, ' ', property_mix_description, ' ',
overload_risk_category, ' risk'
  ) as searchable_text
FROM SI_DEMOS.PRODUCTION.VW_CORTEX_ANALYST_TRANSFORMER_FACTS

UNION ALL

SELECT
  'BUILDING' as asset_type,
  building_id as asset_id,
  building_name as asset_display_name,
  CONCAT(
    COALESCE(building_name, 'Unnamed building'), ', ', property_category, '
building with ',
    num_floors, ' floors, serving ', meter_count, ' meters'
  ) as asset_description,
  latitude,
  longitude,
  COALESCE(building_name, 'Unnamed') as address_full,
  'Houston' as city,
  property_category as primary_property_type,
  avg_transformer_capacity_kva as capacity_kva,
  building_size_category as status,
  CASE WHEN meter_count > 0 THEN 100 ELSE 50 END as health_score,
  CONCAT(
    COALESCE(building_name, ''), ' ', building_type, ' ', property_category,
' ',
    num_floors, ' floors ', meter_count, ' meters ', building_size_category
  ) as searchable_text
FROM SI_DEMOS.PRODUCTION.VW_BUILDING_ASSET_REGISTRY;



create or replace view VW_BUILDING_ASSET_REGISTRY(
        BUILDING_ID,
        BUILDING_NAME,
        BUILDING_TYPE,
        PROPERTY_CATEGORY,
        NUM_FLOORS,
        HEIGHT_METERS,
        ESTIMATED_SQFT,
        METER_COUNT,
        TRANSFORMER_COUNT,
        AVG_TRANSFORMER_CAPACITY_KVA,
        LATITUDE,
        LONGITUDE,
        AVG_METER_DISTANCE_M,
        BUILDING_SIZE_CATEGORY
) COMMENT='Building asset registry with served meters, energy assets, and
property characteristics'
 as
SELECT
  b.building_id,
  b.building_name,
  b.building_type,

  CASE
    WHEN b.building_type IN ('house', 'detached', 'semidetached_house',
'bungalow') THEN 'Single-Family'
    WHEN b.building_type IN ('apartments', 'terrace') THEN 'Multi-Family'
    WHEN b.building_type IN ('retail', 'commercial', 'office') THEN
'Commercial'
    WHEN b.building_type IN ('industrial', 'warehouse', 'factory') THEN
'Industrial'
    ELSE 'Other'
  END as property_category,
  b.num_floors,
  b.height_meters,
  ROUND(b.num_floors *
    CASE
      WHEN b.num_floors <= 2 THEN 2000
      WHEN b.num_floors <= 4 THEN 5000
      ELSE 10000
    END
  , 0) as estimated_sqft,

  COUNT(DISTINCT m.METER_ID) as meter_count,
  COUNT(DISTINCT m.TRANSFORMER_ID) as transformer_count,
  ROUND(AVG(t.RATED_KVA), 0) as avg_transformer_capacity_kva,

  b.latitude,
  b.longitude,

  ROUND(AVG(m.distance_to_building_meters), 2) as avg_meter_distance_m,
  CASE
    WHEN COUNT(DISTINCT m.METER_ID) = 0 THEN 'No Meters'
    WHEN COUNT(DISTINCT m.METER_ID) = 1 THEN 'Single Meter'
    WHEN COUNT(DISTINCT m.METER_ID) <= 5 THEN 'Few Meters (2-5)'
    WHEN COUNT(DISTINCT m.METER_ID) <= 20 THEN 'Multi-Unit (6-20)'
    ELSE 'Large Building (20+)'
  END as building_size_category

FROM SI_DEMOS.PRODUCTION.HOUSTON_BUILDINGS_CLEAN b
LEFT JOIN SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE m ON b.building_id =
m.building_id
LEFT JOIN SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t ON m.TRANSFORMER_ID =
t.TRANSFORMER_ID
GROUP BY
  b.building_id, b.building_name, b.building_type, b.num_floors,
  b.height_meters, b.latitude, b.longitude;



create or replace view VW_CORTEX_ANALYST_METER_FACTS(
        METER_ID,
        METER_DISPLAY_NAME,
        CUSTOMER_ACCOUNT_NUMBER,
        PROPERTY_TYPE_CATEGORY,
        PROPERTY_MAJOR_CATEGORY,
        BUILDING_SQUARE_FOOTAGE,
        BUILDING_FLOOR_COUNT,
        BUILDING_TYPE_NAME,
        BUILDING_NAME,
        HAS_BUILDING_ASSOCIATED,
        BUILDING_PROXIMITY_METERS,
        TRANSFORMER_CAPACITY_KVA,
        TRANSFORMER_LOAD_PERCENTAGE,
        CIRCUIT_NAME,
        SUBSTATION_NAME,
        VOLTAGE_LEVEL_KV,
        METER_LATITUDE,
        METER_LONGITUDE,
        CITY_NAME,
        COUNTY_NAME,
        ESTIMATED_MONTHLY_CONSUMPTION_KWH,
        LOAD_PROFILE_CLUSTER_NAME,
        OUTAGE_RISK_SCORE_0_100,
        DATA_QUALITY_RATING
) COMMENT='Cortex Analyst optimized: business-friendly names, no NULLs,
pre-calculated metrics'
 as
SELECT
  m.METER_ID as meter_id,
  CONCAT('Meter-', SUBSTR(m.METER_ID, -6)) as meter_display_name,
  COALESCE(m.CUSTOMER_SEGMENT_ID, 'UNKNOWN') as customer_account_number,

  COALESCE(m.property_category, 'Unclassified') as property_type_category,
  CASE
    WHEN m.property_category IN ('Single-Family', 'Low-Rise Multi-Family',
'High-Rise Multi-Family', 'Residential') THEN 'Residential'
    WHEN m.property_category IN ('Small Commercial', 'Large Commercial')
THEN 'Commercial'
    WHEN m.property_category = 'Industrial' THEN 'Industrial'
    ELSE 'Other'
  END as property_major_category,
  COALESCE(m.estimated_sqft, 0) as building_square_footage,
  COALESCE(b.num_floors, 0) as building_floor_count,
  COALESCE(m.building_type, 'Unknown') as building_type_name,
  COALESCE(b.building_name, 'Unnamed Building') as building_name,
  CASE WHEN m.building_id IS NOT NULL THEN 'Yes' ELSE 'No' END as
has_building_associated,
  COALESCE(ROUND(m.distance_to_building_meters, 0), 9999) as
building_proximity_meters,

  COALESCE(t.RATED_KVA, 0) as transformer_capacity_kva,
  COALESCE(ROUND(t.LOAD_UTILIZATION_PCT, 1), 0) as
transformer_load_percentage,
  COALESCE(c.CIRCUIT_NAME, 'Unknown Circuit') as circuit_name,
  COALESCE(c.SUBSTATION_ID, 'Unknown Substation') as substation_name,
  COALESCE(c.VOLTAGE_LEVEL_KV, 0) as voltage_level_kv,

  ROUND(m.METER_LATITUDE, 6) as meter_latitude,
  ROUND(m.METER_LONGITUDE, 6) as meter_longitude,
  'Houston' as city_name,
  'Harris County' as county_name,

  CASE
    WHEN m.property_category = 'Single-Family' THEN 850
    WHEN m.property_category LIKE '%Multi-Family%' THEN 650
    WHEN m.property_category LIKE '%Commercial%' THEN 1200
    WHEN m.property_category = 'Industrial' THEN 2500
    ELSE 500
  END as estimated_monthly_consumption_kwh,

  CASE
    WHEN m.property_category = 'Single-Family' THEN 'Residential Standard'
    WHEN m.property_category LIKE '%Multi-Family%' THEN 'Residential
Multi-Unit'
    WHEN m.property_category LIKE '%Commercial%' THEN 'Commercial Office'
    WHEN m.property_category = 'Industrial' THEN 'Industrial Heavy'
    ELSE 'Unknown Pattern'
  END as load_profile_cluster_name,

  ROUND(CASE
    WHEN t.LOAD_UTILIZATION_PCT >= 85 THEN 80
    WHEN t.LOAD_UTILIZATION_PCT >= 75 THEN 60
    WHEN t.LOAD_UTILIZATION_PCT >= 65 THEN 40
    ELSE 20
  END, 0) as outage_risk_score_0_100,

  CASE
    WHEN m.building_id IS NULL THEN 'Poor - No Building'
    WHEN m.distance_to_building_meters <= 10 THEN 'Excellent'
    WHEN m.distance_to_building_meters <= 25 THEN 'Good'
    ELSE 'Fair'
  END as data_quality_rating

FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE m
LEFT JOIN SI_DEMOS.PRODUCTION.HOUSTON_BUILDINGS_CLEAN b ON m.building_id =
b.building_id
LEFT JOIN SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t ON m.TRANSFORMER_ID =
t.TRANSFORMER_ID
LEFT JOIN SI_DEMOS.PRODUCTION.CIRCUIT_METADATA c ON m.CIRCUIT_ID =
c.CIRCUIT_ID;



create or replace view VW_CORTEX_ANALYST_TRANSFORMER_FACTS(
        TRANSFORMER_ID,
        TRANSFORMER_DISPLAY_NAME,
        TRANSFORMER_LOCATION_DESCRIPTION,
        RATED_CAPACITY_KVA,
        CURRENT_LOAD_KVA,
        UTILIZATION_PERCENTAGE,
        AVAILABLE_HEADROOM_KVA,
        IS_OVERLOADED,
        OVERLOAD_RISK_CATEGORY,
        TOTAL_METERS_SERVED,
        RESIDENTIAL_METER_COUNT,
        COMMERCIAL_METER_COUNT,
        INDUSTRIAL_METER_COUNT,
        DOMINANT_PROPERTY_TYPE_SERVED,
        PROPERTY_MIX_DESCRIPTION,
        PEAK_LOAD_PERCENTAGE_LAST_30D,
        AVERAGE_LOAD_PERCENTAGE_LAST_30D,
        MONTHS_UNTIL_CAPACITY_REACHED,
        UPGRADE_RECOMMENDED_FLAG,
        PROPERTY_CAPACITY_ALIGNMENT_SCORE
) COMMENT='Cortex Analyst optimized transformer facts: capacity planning,
property mix, risk scoring'
 as
SELECT
  t.TRANSFORMER_ID as transformer_id,
  CONCAT('Transformer-', SUBSTR(t.TRANSFORMER_ID, -4)) as
transformer_display_name,
  CONCAT('Location: ', ROUND(t.LATITUDE, 4), ', ', ROUND(t.LONGITUDE, 4)) as
transformer_location_description,

  t.RATED_KVA as rated_capacity_kva,
  ROUND(t.RATED_KVA * t.LOAD_UTILIZATION_PCT / 100, 1) as current_load_kva,
  ROUND(t.LOAD_UTILIZATION_PCT, 1) as utilization_percentage,
  ROUND(t.RATED_KVA * (1 - t.LOAD_UTILIZATION_PCT / 100), 1) as
available_headroom_kva,
  CASE WHEN t.LOAD_UTILIZATION_PCT >= 80 THEN 'Yes' ELSE 'No' END as
is_overloaded,
  CASE
    WHEN t.LOAD_UTILIZATION_PCT >= 90 THEN 'Critical'
    WHEN t.LOAD_UTILIZATION_PCT >= 80 THEN 'High'
    WHEN t.LOAD_UTILIZATION_PCT >= 70 THEN 'Medium'
    ELSE 'Low'
  END as overload_risk_category,

  t.METER_COUNT as total_meters_served,
  COALESCE(pm.residential_count, 0) as residential_meter_count,
  COALESCE(pm.commercial_count, 0) as commercial_meter_count,
  COALESCE(pm.industrial_count, 0) as industrial_meter_count,
  COALESCE(pm.dominant_type, 'Unknown') as dominant_property_type_served,
  COALESCE(pm.mix_description, 'No property data') as
property_mix_description,

  ROUND(t.LOAD_UTILIZATION_PCT, 1) as peak_load_percentage_last_30d,
  ROUND(t.LOAD_UTILIZATION_PCT * 0.85, 1) as
average_load_percentage_last_30d,

  CASE
    WHEN t.LOAD_UTILIZATION_PCT >= 95 THEN 3
    WHEN t.LOAD_UTILIZATION_PCT >= 90 THEN 6
    WHEN t.LOAD_UTILIZATION_PCT >= 85 THEN 12
    WHEN t.LOAD_UTILIZATION_PCT >= 80 THEN 18
    ELSE 24
  END as months_until_capacity_reached,
  CASE WHEN t.LOAD_UTILIZATION_PCT >= 80 THEN 'Yes' ELSE 'No' END as
upgrade_recommended_flag,

  ROUND(COALESCE(pm.alignment_score, 50), 0) as
property_capacity_alignment_score

FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t
LEFT JOIN (
  SELECT
    TRANSFORMER_ID,
    COUNT(CASE WHEN property_major_category = 'Residential' THEN 1 END) as
residential_count,
    COUNT(CASE WHEN property_major_category = 'Commercial' THEN 1 END) as
commercial_count,
    COUNT(CASE WHEN property_major_category = 'Industrial' THEN 1 END) as
industrial_count,
    CASE
      WHEN COUNT(CASE WHEN property_major_category = 'Residential' THEN 1
END) >= COUNT(*) * 0.8 THEN 'Residential'
      WHEN COUNT(CASE WHEN property_major_category = 'Commercial' THEN 1
END) >= COUNT(*) * 0.3 THEN 'Commercial'
      WHEN COUNT(CASE WHEN property_major_category = 'Industrial' THEN 1
END) > 0 THEN 'Mixed-Industrial'
      ELSE 'Mixed'
    END as dominant_type,
    CONCAT(
      ROUND(100.0 * COUNT(CASE WHEN property_major_category = 'Residential'
THEN 1 END) / COUNT(*), 0), '% Residential, ',
      ROUND(100.0 * COUNT(CASE WHEN property_major_category = 'Commercial'
THEN 1 END) / COUNT(*), 0), '% Commercial, ',
      ROUND(100.0 * COUNT(CASE WHEN property_major_category = 'Industrial'
THEN 1 END) / COUNT(*), 0), '% Industrial'
    ) as mix_description,
    80 as alignment_score
  FROM (
    SELECT
      TRANSFORMER_ID,
      CASE
        WHEN property_category IN ('Single-Family', 'Low-Rise Multi-Family',
'High-Rise Multi-Family', 'Residential') THEN 'Residential'
        WHEN property_category IN ('Small Commercial', 'Large Commercial')
THEN 'Commercial'
        WHEN property_category = 'Industrial' THEN 'Industrial'
        ELSE 'Other'
      END as property_major_category
    FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE
  )
  GROUP BY TRANSFORMER_ID
) pm ON t.TRANSFORMER_ID = pm.TRANSFORMER_ID;



create or replace view VW_METER_ASSET_REGISTRY(
        METER_ID,
        CUSTOMER_SEGMENT_ID,
        BUILDING_TYPE,
        PROPERTY_CATEGORY,
        PROPERTY_MAJOR_CATEGORY,
        BUILDING_SQFT,
        NUM_FLOORS,
        HEIGHT_METERS,
        BUILDING_NAME,
        LATITUDE,
        LONGITUDE,
        TRANSFORMER_ID,
        TRANSFORMER_CAPACITY_KVA,
        TRANSFORMER_UTILIZATION_PCT,
        CIRCUIT_ID,
        CIRCUIT_NAME,
        SUBSTATION_ID,
        VOLTAGE_KV,
        POLE_ID,
        HAS_BUILDING_MATCH,
        BUILDING_ID,
        BUILDING_DISTANCE_M,
        MATCH_QUALITY,
        DATA_QUALITY_SCORE
) COMMENT='Canonical meter asset registry with property, transformer, and
circuit attributes. Primary view for meter lookups and analysis.'
 as
SELECT

  m.METER_ID as meter_id,
  m.CUSTOMER_SEGMENT_ID as customer_segment_id,


  COALESCE(m.building_type, 'Unknown') as building_type,
  COALESCE(m.property_category, 'Unclassified') as property_category,
  CASE
    WHEN m.property_category IN ('Single-Family', 'Low-Rise Multi-Family',
'High-Rise Multi-Family', 'Residential') THEN 'Residential'
    WHEN m.property_category IN ('Small Commercial', 'Large Commercial')
THEN 'Commercial'
    WHEN m.property_category = 'Industrial' THEN 'Industrial'
    ELSE 'Other'
  END as property_major_category,
  COALESCE(m.estimated_sqft, 0) as building_sqft,
  COALESCE(b.num_floors, 0) as num_floors,
  COALESCE(b.height_meters, 0) as height_meters,
  COALESCE(b.building_name, 'Unnamed') as building_name,


  m.METER_LATITUDE as latitude,
  m.METER_LONGITUDE as longitude,


  m.TRANSFORMER_ID as transformer_id,
  t.RATED_KVA as transformer_capacity_kva,
  ROUND(t.LOAD_UTILIZATION_PCT, 2) as transformer_utilization_pct,
  m.CIRCUIT_ID as circuit_id,
  c.CIRCUIT_NAME as circuit_name,
  c.SUBSTATION_ID as substation_id,
  c.VOLTAGE_LEVEL_KV as voltage_kv,
  m.POLE_ID as pole_id,


  CASE WHEN m.building_id IS NOT NULL THEN TRUE ELSE FALSE END as
has_building_match,
  m.building_id as building_id,
  ROUND(COALESCE(m.distance_to_building_meters, 9999), 2) as
building_distance_m,
  CASE
    WHEN m.building_id IS NOT NULL AND m.distance_to_building_meters <= 10
THEN 'Excellent'
    WHEN m.building_id IS NOT NULL AND m.distance_to_building_meters <= 25
THEN 'Good'
    WHEN m.building_id IS NOT NULL AND m.distance_to_building_meters <= 50
THEN 'Fair'
    ELSE 'Poor'
  END as match_quality,


  ROUND(
    CASE WHEN m.building_id IS NOT NULL THEN 50 ELSE 0 END +
    CASE WHEN m.property_category NOT IN ('Other', 'Unclassified') THEN 30
ELSE 0 END +
    CASE WHEN m.distance_to_building_meters <= 10 THEN 20
         WHEN m.distance_to_building_meters <= 25 THEN 15
         WHEN m.distance_to_building_meters <= 50 THEN 10
         ELSE 0
    END
  , 0) as data_quality_score

FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE m
LEFT JOIN SI_DEMOS.PRODUCTION.HOUSTON_BUILDINGS_CLEAN b ON m.building_id =
b.building_id
LEFT JOIN SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t ON m.TRANSFORMER_ID =
t.TRANSFORMER_ID
LEFT JOIN SI_DEMOS.PRODUCTION.CIRCUIT_METADATA c ON m.CIRCUIT_ID =
c.CIRCUIT_ID;



create or replace view VW_TRANSFORMER_ASSET_REGISTRY(
        TRANSFORMER_ID,
        CIRCUIT_ID,
        SUBSTATION_ID,
        CIRCUIT_NAME,
        RATED_CAPACITY_KVA,
        CURRENT_LOAD_KVA,
        UTILIZATION_PCT,
        HEADROOM_KVA,
        IS_OVERLOADED,
        METER_COUNT,
        RESIDENTIAL_METER_COUNT,
        COMMERCIAL_METER_COUNT,
        INDUSTRIAL_METER_COUNT,
        PCT_RESIDENTIAL,
        PCT_COMMERCIAL,
        PCT_INDUSTRIAL,
        PROPERTY_MIX_CATEGORY,
        LATITUDE,
        LONGITUDE,
        OVERLOAD_RISK_SCORE,
        CAPACITY_ALIGNMENT_STATUS
) COMMENT='Transformer asset registry with capacity metrics, property mix,
and risk indicators'
 as
SELECT
  t.TRANSFORMER_ID as transformer_id,
  t.CIRCUIT_ID as circuit_id,
  c.SUBSTATION_ID as substation_id,
  c.CIRCUIT_NAME as circuit_name,

  t.RATED_KVA as rated_capacity_kva,
  ROUND(t.LOAD_UTILIZATION_PCT * t.RATED_KVA / 100, 2) as current_load_kva,
  ROUND(t.LOAD_UTILIZATION_PCT, 2) as utilization_pct,
  ROUND(t.RATED_KVA * (1 - t.LOAD_UTILIZATION_PCT / 100), 2) as
headroom_kva,
  CASE WHEN t.LOAD_UTILIZATION_PCT >= 80 THEN TRUE ELSE FALSE END as
is_overloaded,

  t.METER_COUNT as meter_count,
  COALESCE(pm.residential_count, 0) as residential_meter_count,
  COALESCE(pm.commercial_count, 0) as commercial_meter_count,
  COALESCE(pm.industrial_count, 0) as industrial_meter_count,

  COALESCE(pm.pct_residential, 0) as pct_residential,
  COALESCE(pm.pct_commercial, 0) as pct_commercial,
  COALESCE(pm.pct_industrial, 0) as pct_industrial,

  COALESCE(pm.property_mix_category, 'Unknown') as property_mix_category,

  t.LATITUDE as latitude,
  t.LONGITUDE as longitude,

  ROUND(CASE
    WHEN t.LOAD_UTILIZATION_PCT >= 90 THEN 90
    WHEN t.LOAD_UTILIZATION_PCT >= 80 THEN 70
    WHEN t.LOAD_UTILIZATION_PCT >= 70 THEN 50
    WHEN t.LOAD_UTILIZATION_PCT >= 60 THEN 30
    ELSE 10
  END, 0) as overload_risk_score,

  CASE
    WHEN (t.RATED_KVA IN (25, 50) AND pm.pct_residential >= 80) THEN
'Aligned'
    WHEN (t.RATED_KVA = 75 AND (pm.pct_residential + pm.pct_commercial) >=
80) THEN 'Aligned'
    ELSE 'Review'
  END as capacity_alignment_status

FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t
LEFT JOIN SI_DEMOS.PRODUCTION.CIRCUIT_METADATA c ON t.CIRCUIT_ID =
c.CIRCUIT_ID
LEFT JOIN (
  SELECT
    TRANSFORMER_ID,
    COUNT(CASE WHEN property_major_category = 'Residential' THEN 1 END) as
residential_count,
    COUNT(CASE WHEN property_major_category = 'Commercial' THEN 1 END) as
commercial_count,
    COUNT(CASE WHEN property_major_category = 'Industrial' THEN 1 END) as
industrial_count,
    ROUND(100.0 * COUNT(CASE WHEN property_major_category = 'Residential'
THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pct_residential,
    ROUND(100.0 * COUNT(CASE WHEN property_major_category = 'Commercial'
THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pct_commercial,
    ROUND(100.0 * COUNT(CASE WHEN property_major_category = 'Industrial'
THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pct_industrial,
    CASE
      WHEN COUNT(CASE WHEN property_major_category = 'Residential' THEN 1
END) >= COUNT(*) * 0.7 THEN 'Residential-Dominant'
      WHEN COUNT(CASE WHEN property_major_category = 'Commercial' THEN 1
END) >= COUNT(*) * 0.3 THEN 'Commercial-Significant'
      WHEN COUNT(CASE WHEN property_major_category = 'Industrial' THEN 1
END) > 0 THEN 'Mixed-With-Industrial'
      ELSE 'Mixed-Residential-Commercial'
    END as property_mix_category
  FROM (
    SELECT
      TRANSFORMER_ID,
      CASE
        WHEN property_category IN ('Single-Family', 'Low-Rise Multi-Family',
'High-Rise Multi-Family', 'Residential') THEN 'Residential'
        WHEN property_category IN ('Small Commercial', 'Large Commercial')
THEN 'Commercial'
        WHEN property_category = 'Industrial' THEN 'Industrial'
        ELSE 'Other'
      END as property_major_category
    FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE
  )
  GROUP BY TRANSFORMER_ID
) pm ON t.TRANSFORMER_ID = pm.TRANSFORMER_ID;



create or replace view DATA_SUMMARY(
        TABLE_NAME,
        ROW_COUNT,
        MIN_DATE,
        MAX_DATE,
        UNIQUE_METERS,
        AVG_USAGE_KWH,
        AVG_VOLTAGE,
        OUTAGE_EVENTS,
        VOLTAGE_SAG_EVENTS
) as
SELECT
    'AMI_READINGS_FINAL' as TABLE_NAME,
    COUNT(*) as ROW_COUNT,
    MIN(TIMESTAMP) as MIN_DATE,
    MAX(TIMESTAMP) as MAX_DATE,
    COUNT(DISTINCT METER_ID) as UNIQUE_METERS,
    AVG(USAGE_KWH) as AVG_USAGE_KWH,
    AVG(VOLTAGE) as AVG_VOLTAGE,
    COUNT(DISTINCT OUTAGE_ID) as OUTAGE_EVENTS,
    COUNT(DISTINCT VOLTAGE_SAG_EVENT_ID) as VOLTAGE_SAG_EVENTS
FROM SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL
UNION ALL
SELECT
    'METER_INFRASTRUCTURE' as TABLE_NAME,
    COUNT(*) as ROW_COUNT,
    NULL as MIN_DATE,
    NULL as MAX_DATE,
    COUNT(DISTINCT METER_ID) as UNIQUE_METERS,
    NULL as AVG_USAGE_KWH,
    NULL as AVG_VOLTAGE,
    NULL as OUTAGE_EVENTS,
    NULL as VOLTAGE_SAG_EVENTS
FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE
UNION ALL
SELECT
    'TRANSFORMER_METADATA' as TABLE_NAME,
    COUNT(*) as ROW_COUNT,
    NULL as MIN_DATE,
    NULL as MAX_DATE,
    NULL as UNIQUE_METERS,
    NULL as AVG_USAGE_KWH,
    NULL as AVG_VOLTAGE,
    NULL as OUTAGE_EVENTS,
    NULL as VOLTAGE_SAG_EVENTS
FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA;



create or replace view QUICK_REFERENCE(
        INSTRUCTION,
        DATA_SCALE,
        DATA_QUALITY,
        ENRICHMENT_NOTE
) as
SELECT
    'Use SI_DEMOS.PRODUCTION for all applications' as instruction,
    '11.9B AMI records, 2.63M customers' as data_scale,
    'Realistic utility Houston proportions' as data_quality,
    'Query SI_DEMOS.APPLICATIONS for enriched views' as enrichment_note;

