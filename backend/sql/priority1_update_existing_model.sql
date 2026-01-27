-- =============================================================================
-- PRIORITY 1: Update Existing Semantic Model with Missing Tables
-- =============================================================================
-- This script adds the missing tables identified in the #audit to the 
-- existing CENTERPOINTENERGY_SEMANTIC_MODEL while preserving all existing
-- tables, relationships, facts, dimensions, metrics, and verified queries.
-- =============================================================================

-- First, backup the current model by exporting DDL (manual step - already done)
-- Next, we CREATE OR REPLACE with all existing + new tables

CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.CENTERPOINTENERGY_SEMANTIC_MODEL
    TABLES (
        -- =====================================================================
        -- EXISTING TABLES (preserved from current model)
        -- =====================================================================
        AMI_READINGS_ENHANCED AS SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL 
            PRIMARY KEY (METER_ID, TIMESTAMP) 
            WITH SYNONYMS = ('AMI_READINGS', 'INTERVAL_READINGS', 'METER_READINGS')
            COMMENT = 'Enhanced AMI readings with voltage sag events, outage tracking, and anomaly detection for grid reliability analysis',
        
        BUILDING_METER_ASSOCIATIONS AS SI_DEMOS.PRODUCTION.METER_BUILDING_MATCHES 
            PRIMARY KEY (METER_ID, BUILDING_ID) 
            WITH SYNONYMS = ('BUILDING_ASSIGNMENTS', 'BUILDING_MATCHES', 'METER_BUILDING_LINKS')
            COMMENT = 'Meter-to-building associations with classification confidence enabling spatial analytics and building-type energy analysis. Links meters to physical buildings using HCAD ground truth (62% at 98% confidence) and ML inference (35% at 88.5% confidence)',
        
        SI_DEMOS.PRODUCTION.CIRCUIT_METADATA 
            PRIMARY KEY (CIRCUIT_ID) 
            WITH SYNONYMS = ('CIRCUIT_INFO', 'CIRCUITS', 'DISTRIBUTION_CIRCUITS')
            COMMENT = 'Circuit metadata with transformer and meter counts, voltage levels, and geographic boundaries for distribution planning',
        
        SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA 
            PRIMARY KEY (CUSTOMER_ID) 
            WITH SYNONYMS = ('CUSTOMER_DATA', 'CUSTOMER_MASTER', 'CUSTOMERS')
            COMMENT = 'Customer master data with demographic info and meter associations linking customers to grid infrastructure',
        
        SI_DEMOS.PRODUCTION.CUSTOMER_OUTAGE_EVENTS 
            UNIQUE (CUSTOMER_OUTAGE_ID) 
            COMMENT = 'Customer-level power outage events exploded from transformer outages, supporting Customer 360 storm resilience analytics with individual customer tracking, outage history, and restoration metrics for both storm and thermal events',
        
        SI_DEMOS.PRODUCTION.ENERGY_BURDEN_ANALYSIS 
            PRIMARY KEY (METER_ID, YEAR, MONTH) 
            WITH SYNONYMS = ('CUSTOMER AFFORDABILITY', 'ENERGY AFFORDABILITY ANALYSIS', 'METER ENERGY BURDEN')
            COMMENT = 'Meter-level energy burden analysis with year-over-year comparison to 2024 baseline showing burden trends by customer segment',
        
        SI_DEMOS.PRODUCTION.ENERGY_BURDEN_TRENDS 
            WITH SYNONYMS = ('AFFORDABILITY TRENDS', 'COST BURDEN', 'ENERGY BURDEN')
            COMMENT = 'Historical energy cost burden analysis by customer segment and building type',
        
        SI_DEMOS.PRODUCTION.EQUIPMENT_STRESS_TRENDS_HISTORICAL 
            WITH SYNONYMS = ('EQUIPMENT STRESS', 'TRANSFORMER HISTORY', 'TRANSFORMER STRESS TRENDS')
            COMMENT = 'Historical transformer stress patterns showing multi-year summer load trends',
        
        SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED 
            WITH SYNONYMS = ('ELECTRICITY PRICES', 'ERCOT PRICING', 'LMP')
            COMMENT = 'Unified ERCOT locational marginal pricing data for Houston zone (Aug 2024 + Jul-Aug 2025)',
        
        SI_DEMOS.PRODUCTION.ERCOT_LOAD_UNIFIED 
            WITH SYNONYMS = ('ERCOT HISTORICAL LOAD', 'ERCOT LOAD', 'GRID LOAD')
            COMMENT = 'Unified ERCOT load data spanning 2023-2025 for year-over-year trend analysis',
        
        SI_DEMOS.PRODUCTION.GRID_POLES_INFRASTRUCTURE 
            PRIMARY KEY (POLE_ID) 
            WITH SYNONYMS = ('POLE_INFRASTRUCTURE', 'POLES', 'UTILITY_POLES')
            COMMENT = 'Grid pole infrastructure with health scores, equipment attachments, and topology links to transformers/circuits/substations',
        
        SI_DEMOS.PRODUCTION.GRID_RELIABILITY_METRICS 
            WITH SYNONYMS = ('GRID_PERFORMANCE', 'RELIABILITY_METRICS', 'SAIDI_SAIFI')
            COMMENT = 'Monthly grid reliability metrics including SAIDI, SAIFI, and CAIDI for regulatory reporting and performance tracking',
        
        SI_DEMOS.PRODUCTION.HOUSTON_WEATHER_HOURLY 
            WITH SYNONYMS = ('CLIMATE', 'WEATHER', 'WEATHER DATA')
            COMMENT = 'Hourly weather data for Houston enriched with wind speed and precipitation from WeatherSource marketplace',
        
        SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE 
            PRIMARY KEY (METER_ID),
        
        SI_DEMOS.PRODUCTION.OUTAGE_EVENTS 
            PRIMARY KEY (OUTAGE_ID) 
            WITH SYNONYMS = ('INTERRUPTIONS', 'OUTAGES', 'POWER_OUTAGES')
            COMMENT = 'Power outage events escalated from severe voltage sags with customer impact and duration tracking',
        
        SI_DEMOS.PRODUCTION.REVENUE_ANOMALY_DETECTION 
            WITH SYNONYMS = ('BILLING ANOMALIES', 'REVENUE ANOMALIES', 'USAGE ANOMALIES')
            COMMENT = 'Revenue and usage anomaly detection with year-over-year pricing comparison against 2024 baseline',
        
        SI_DEMOS.PRODUCTION.REVENUE_HISTORICAL_BASELINE 
            WITH SYNONYMS = ('HISTORICAL PRICING', 'PRICING TRENDS', 'REVENUE BASELINE')
            COMMENT = 'Monthly baseline for revenue and pricing trends across historical periods',
        
        SI_DEMOS.PRODUCTION.STORM_OUTAGE_IMPACT_ANALYSIS 
            WITH SYNONYMS = ('STORM EVENTS', 'STORM IMPACT', 'WEATHER OUTAGES')
            COMMENT = 'Storm and weather event impact analysis with historical correlation baseline',
        
        SI_DEMOS.PRODUCTION.SUBSTATIONS 
            PRIMARY KEY (SUBSTATION_ID) 
            WITH SYNONYMS = ('SUBSTATION_INFO', 'SUBSTATION_MASTER')
            COMMENT = 'Substation infrastructure with capacity, location, operational status, and critical infrastructure flags for transmission planning',
        
        SI_DEMOS.PRODUCTION.SUMMER_LOAD_YOY_COMPARISON 
            WITH SYNONYMS = ('SUMMER COMPARISON', 'SUMMER LOAD TRENDS', 'YOY LOAD')
            COMMENT = 'Year-over-year comparison of summer (July-August) load patterns across 2023-2025',
        
        SI_DEMOS.PRODUCTION.TRANSFORMER_HOURLY_LOAD 
            WITH SYNONYMS = ('CAPACITY_MONITORING', 'TRANSFORMER_LOADS', 'XFMR_LOAD')
            COMMENT = 'Hourly transformer load analysis with overload detection, weather correlation, and voltage sag prediction',
        
        SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA 
            PRIMARY KEY (TRANSFORMER_ID),
        
        SI_DEMOS.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED 
            WITH SYNONYMS = ('OVERLOAD ANALYSIS', 'THERMAL ANALYSIS', 'TRANSFORMER STRESS')
            COMMENT = 'Transformer thermal stress with historical summer pattern comparison showing stress trends',
        
        SI_DEMOS.PRODUCTION.VOLTAGE_SAG_EVENTS 
            PRIMARY KEY (EVENT_ID) 
            WITH SYNONYMS = ('POWER_QUALITY_EVENTS', 'SAG_EVENTS', 'VOLTAGE_SAGS')
            COMMENT = 'Voltage sag events with causal links to transformer overload, equipment faults, and aging infrastructure',
        
        SI_DEMOS.PRODUCTION.WEATHER_OUTAGE_CORRELATION_HISTORICAL 
            WITH SYNONYMS = ('STORM CORRELATION', 'WEATHER IMPACT', 'WEATHER OUTAGE PATTERNS')
            COMMENT = 'Historical correlation between weather conditions and outage patterns with enriched weather data',
        
        SI_DEMOS.PRODUCTION.WEATHER_STRESS_EVENTS 
            WITH SYNONYMS = ('HEAT_EVENTS', 'WEATHER_CONDITIONS')
            COMMENT = 'Daily weather stress events for demand forecasting and grid stress analysis',
        
        SI_DEMOS.PRODUCTION.CIRCUIT_VEGETATION_RISK 
            PRIMARY KEY (CIRCUIT_ID) 
            WITH SYNONYMS = ('circuit tree risk', 'tree hazard by circuit', 'vegetation risk')
            COMMENT = 'Circuit-level vegetation risk scores from Overture Maps tree proximity analysis. Links to CIRCUIT_METADATA for risk prioritization and outage correlation.',
        
        SI_DEMOS.PRODUCTION.VEGETATION_TRANSFORMER_RISK 
            PRIMARY KEY (TREE_ID) 
            WITH SYNONYMS = ('transformer tree risk', 'transformer vegetation exposure', 'tree transformer proximity')
            COMMENT = 'Individual tree-to-transformer proximity risk from Overture Maps data. 801 tree-transformer associations with distance-based risk scoring. Use for field crew prioritization and targeted vegetation management.',
        
        -- =====================================================================
        -- NEW TABLES (Priority 1 additions)
        -- =====================================================================
        SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE 
            PRIMARY KEY (METER_ID, USAGE_MONTH)
            WITH SYNONYMS = ('MONTHLY_AMI', 'YOY_USAGE', 'METER_MONTHLY_USAGE', 'MONTHLY_CONSUMPTION')
            COMMENT = 'Pre-aggregated monthly AMI usage with 2.4M rows enabling fast monthly/yearly trend analysis. Contains meter-level monthly kWh totals, reading counts, customer segments, and building types for YoY comparison queries.',
        
        SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS 
            PRIMARY KEY (WORK_ORDER_ID)
            WITH SYNONYMS = ('MAINTENANCE_ORDERS', 'WORK_ORDERS', 'SAP_ORDERS', 'FIELD_WORK')
            COMMENT = 'SAP-sourced work orders with 250K maintenance records including preventive, corrective, and emergency work types. Contains scheduling, cost tracking, equipment associations, and crew assignments for operations intelligence.',
        
        SI_DEMOS.PRODUCTION.AMI_STREAMING_DATA 
            PRIMARY KEY (METER_ID, READING_TIMESTAMP)
            WITH SYNONYMS = ('REAL_TIME_READINGS', 'STREAMING_AMI', 'LIVE_METER_DATA')
            COMMENT = 'Real-time AMI streaming data with 5.4M readings for live operations monitoring. Includes meter readings, voltage, power factor, and temperature with full grid topology linkage (transformer, circuit, substation).',
        
        SI_DEMOS.PRODUCTION.VEGETATION_POWER_LINE_RISK 
            PRIMARY KEY (TREE_ID)
            WITH SYNONYMS = ('POWER_LINE_VEGETATION', 'TREE_LINE_PROXIMITY', 'LINE_CLEARANCE_RISK')
            COMMENT = 'Tree-to-power-line proximity risk from Overture Maps with 3,611 tree-line associations. Contains distance measurements, line class, and risk scoring for right-of-way vegetation management.'
    )
    RELATIONSHIPS (
        -- =====================================================================
        -- EXISTING RELATIONSHIPS (preserved)
        -- =====================================================================
        AMI_TO_METER_INFRA AS AMI_READINGS_ENHANCED(METER_ID) REFERENCES METER_INFRASTRUCTURE(METER_ID),
        AMI_TO_OUTAGE AS AMI_READINGS_ENHANCED(OUTAGE_ID) REFERENCES OUTAGE_EVENTS(OUTAGE_ID),
        AMI_TO_VOLTAGE_SAG AS AMI_READINGS_ENHANCED(VOLTAGE_SAG_EVENT_ID) REFERENCES VOLTAGE_SAG_EVENTS(EVENT_ID),
        BUILDING_TO_METER AS BUILDING_METER_ASSOCIATIONS(METER_ID) REFERENCES METER_INFRASTRUCTURE(METER_ID),
        CIRCUIT_TO_SUBSTATION AS CIRCUIT_METADATA(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        CUSTOMER_TO_METER AS CUSTOMERS_MASTER_DATA(PRIMARY_METER_ID) REFERENCES METER_INFRASTRUCTURE(METER_ID),
        POLE_TO_CIRCUIT AS GRID_POLES_INFRASTRUCTURE(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        POLE_TO_SUBSTATION AS GRID_POLES_INFRASTRUCTURE(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        POLE_TO_TRANSFORMER AS GRID_POLES_INFRASTRUCTURE(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        METER_TO_CIRCUIT AS METER_INFRASTRUCTURE(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        METER_TO_SUBSTATION AS METER_INFRASTRUCTURE(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        METER_TO_TRANSFORMER AS METER_INFRASTRUCTURE(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        VEG_CIRCUIT_TO_OUTAGE AS OUTAGE_EVENTS(CIRCUIT_ID) REFERENCES CIRCUIT_VEGETATION_RISK(CIRCUIT_ID),
        OUTAGE_TO_TRANSFORMER AS OUTAGE_EVENTS(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        OUTAGE_TO_VOLTAGE_SAG AS OUTAGE_EVENTS(CAUSED_BY_SAG_EVENT_ID) REFERENCES VOLTAGE_SAG_EVENTS(EVENT_ID),
        XFMR_LOAD_TO_TRANSFORMER AS TRANSFORMER_HOURLY_LOAD(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        TRANSFORMER_TO_CIRCUIT AS TRANSFORMER_METADATA(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        TRANSFORMER_TO_SUBSTATION AS TRANSFORMER_METADATA(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        VOLTAGE_SAG_TO_TRANSFORMER AS VOLTAGE_SAG_EVENTS(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        VEG_RISK_TO_CIRCUIT AS CIRCUIT_VEGETATION_RISK(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        VEG_RISK_TO_SUBSTATION AS CIRCUIT_VEGETATION_RISK(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        TREE_RISK_TO_CIRCUIT AS VEGETATION_TRANSFORMER_RISK(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        TREE_RISK_TO_TRANSFORMER AS VEGETATION_TRANSFORMER_RISK(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        
        -- =====================================================================
        -- NEW RELATIONSHIPS (Priority 1 additions)
        -- =====================================================================
        -- AMI_MONTHLY_USAGE relationships
        MONTHLY_TO_METER AS AMI_MONTHLY_USAGE(METER_ID) REFERENCES METER_INFRASTRUCTURE(METER_ID),
        MONTHLY_TO_TRANSFORMER AS AMI_MONTHLY_USAGE(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        
        -- SAP_WORK_ORDERS relationships
        WORK_ORDER_TO_TRANSFORMER AS SAP_WORK_ORDERS(EQUIPMENT_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        
        -- AMI_STREAMING_DATA relationships
        STREAMING_TO_METER AS AMI_STREAMING_DATA(METER_ID) REFERENCES METER_INFRASTRUCTURE(METER_ID),
        STREAMING_TO_TRANSFORMER AS AMI_STREAMING_DATA(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        STREAMING_TO_CIRCUIT AS AMI_STREAMING_DATA(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        STREAMING_TO_SUBSTATION AS AMI_STREAMING_DATA(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID)
    )
    FACTS (
        -- =====================================================================
        -- EXISTING FACTS (preserved - abbreviated for readability, full list from original)
        -- =====================================================================
        AMI_READINGS_ENHANCED.POWER_FACTOR AS POWER_FACTOR COMMENT = 'Power factor measurement',
        AMI_READINGS_ENHANCED.USAGE_KWH AS USAGE_KWH COMMENT = 'Original energy usage in kWh (15-minute interval)',
        AMI_READINGS_ENHANCED.USAGE_KWH_ADJUSTED AS USAGE_KWH_ADJUSTED WITH SYNONYMS = ('actual usage', 'adjusted usage') COMMENT = 'Adjusted usage (0 during outages)',
        AMI_READINGS_ENHANCED.VOLTAGE AS VOLTAGE COMMENT = 'Voltage reading adjusted for sags (NULL during outages)',
        AMI_READINGS_ENHANCED.VOLTAGE_DROP_AMOUNT AS VOLTAGE_DROP_AMOUNT WITH SYNONYMS = ('sag magnitude', 'voltage drop') COMMENT = 'Voltage reduction amount during sag events (volts)',
        
        BUILDING_METER_ASSOCIATIONS.CONFIDENCE_SCORE AS CONFIDENCE_SCORE WITH SYNONYMS = ('classification confidence', 'confidence percentage', 'match confidence') COMMENT = 'Classification confidence score (0-100). HCAD ground truth averages 98%, ML inference averages 88.5%',
        BUILDING_METER_ASSOCIATIONS.DISTANCE_METERS AS DISTANCE_METERS WITH SYNONYMS = ('meter distance', 'proximity') COMMENT = 'Distance from meter to building centroid in meters',
        
        CIRCUIT_METADATA.METER_COUNT AS METER_COUNT COMMENT = 'Meter count on circuit',
        CIRCUIT_METADATA.TRANSFORMER_COUNT AS TRANSFORMER_COUNT COMMENT = 'Transformer count on circuit',
        CIRCUIT_METADATA.VOLTAGE_LEVEL_KV AS VOLTAGE_LEVEL_KV COMMENT = 'Circuit voltage level (kV)',
        
        CUSTOMER_OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES AS CUSTOMER_OUTAGE_DURATION_MINUTES COMMENT = 'Duration of customer outage in minutes (for regulatory SAIDI calculations and service credit billing)',
        
        GRID_POLES_INFRASTRUCTURE.HEALTH_SCORE AS POLE_HEALTH_SCORE WITH SYNONYMS = ('integrity score', 'pole health') COMMENT = 'Overall health score (0-100) based on structural integrity',
        GRID_POLES_INFRASTRUCTURE.LOAD_UTILIZATION_PCT AS POLE_LOAD_UTILIZATION_PCT WITH SYNONYMS = ('pole load', 'utilization') COMMENT = 'Load utilization percentage',
        
        GRID_RELIABILITY_METRICS.SAIDI_MINUTES_PER_CUSTOMER AS SAIDI_MINUTES_PER_CUSTOMER WITH SYNONYMS = ('average outage duration', 'SAIDI', 'system average interruption duration index') COMMENT = 'System Average Interruption Duration Index - average minutes of outage per customer',
        GRID_RELIABILITY_METRICS.SAIFI_INTERRUPTIONS_PER_CUSTOMER AS SAIFI_INTERRUPTIONS_PER_CUSTOMER WITH SYNONYMS = ('average interruption frequency', 'SAIFI', 'system average interruption frequency index') COMMENT = 'System Average Interruption Frequency Index - average interruptions per customer',
        GRID_RELIABILITY_METRICS.CAIDI_AVG_OUTAGE_DURATION_MINUTES AS CAIDI_AVG_OUTAGE_DURATION_MINUTES WITH SYNONYMS = ('CAIDI', 'customer average interruption duration index') COMMENT = 'Customer Average Interruption Duration Index - average outage duration when interrupted',
        
        HOUSTON_WEATHER_HOURLY.TEMP_F AS TEMP_F COMMENT = 'Temperature in Fahrenheit',
        HOUSTON_WEATHER_HOURLY.HUMIDITY_PCT AS HUMIDITY_PCT COMMENT = 'Humidity percentage',
        HOUSTON_WEATHER_HOURLY.WIND_SPEED_MPH AS WIND_SPEED_MPH COMMENT = 'Hourly wind speed in miles per hour',
        
        OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES AS OUTAGE_DURATION_MINUTES WITH SYNONYMS = ('interruption duration', 'outage length') COMMENT = 'Outage duration in minutes',
        
        ERCOT_LMP_UNIFIED.LMP_TOTAL AS LMP_TOTAL COMMENT = 'Total locational marginal price ($/MWh)',
        ERCOT_LOAD_UNIFIED.ERCOT_TOTAL_MW AS ERCOT_TOTAL_MW COMMENT = 'Total ERCOT load in megawatts',
        
        TRANSFORMER_HOURLY_LOAD.LOAD_KW AS LOAD_KW COMMENT = 'Transformer load in kW',
        TRANSFORMER_THERMAL_STRESS_MATERIALIZED.STRESS_LEVEL AS STRESS_LEVEL COMMENT = 'Thermal stress level category',
        
        -- =====================================================================
        -- NEW FACTS (Priority 1 additions)
        -- =====================================================================
        -- AMI_MONTHLY_USAGE facts
        AMI_MONTHLY_USAGE.MONTHLY_KWH AS MONTHLY_KWH WITH SYNONYMS = ('monthly consumption', 'monthly usage') COMMENT = 'Total monthly energy consumption in kWh',
        AMI_MONTHLY_USAGE.READING_COUNT AS MONTHLY_READING_COUNT COMMENT = 'Number of interval readings aggregated for the month',
        AMI_MONTHLY_USAGE.AVG_USAGE_PER_READING AS AVG_USAGE_PER_READING COMMENT = 'Average kWh per reading interval',
        
        -- SAP_WORK_ORDERS facts
        SAP_WORK_ORDERS.ESTIMATED_COST_USD AS ESTIMATED_COST_USD WITH SYNONYMS = ('estimated cost', 'planned cost') COMMENT = 'Estimated work order cost in USD',
        SAP_WORK_ORDERS.ACTUAL_COST_USD AS ACTUAL_COST_USD WITH SYNONYMS = ('actual cost', 'final cost') COMMENT = 'Actual work order cost in USD',
        SAP_WORK_ORDERS.LABOR_HOURS AS LABOR_HOURS COMMENT = 'Labor hours recorded for work order',
        SAP_WORK_ORDERS.SERVICE_LAT AS WORK_ORDER_LAT COMMENT = 'Service location latitude',
        SAP_WORK_ORDERS.SERVICE_LON AS WORK_ORDER_LON COMMENT = 'Service location longitude',
        
        -- AMI_STREAMING_DATA facts
        AMI_STREAMING_DATA.USAGE_KWH AS STREAMING_USAGE_KWH WITH SYNONYMS = ('real-time usage', 'live consumption') COMMENT = 'Real-time energy usage reading in kWh',
        AMI_STREAMING_DATA.VOLTAGE AS STREAMING_VOLTAGE COMMENT = 'Real-time voltage reading',
        AMI_STREAMING_DATA.POWER_FACTOR AS STREAMING_POWER_FACTOR COMMENT = 'Real-time power factor',
        AMI_STREAMING_DATA.TEMPERATURE_C AS STREAMING_TEMPERATURE_C COMMENT = 'Ambient temperature at meter location in Celsius',
        AMI_STREAMING_DATA.LATITUDE AS STREAMING_LATITUDE COMMENT = 'Meter latitude for real-time mapping',
        AMI_STREAMING_DATA.LONGITUDE AS STREAMING_LONGITUDE COMMENT = 'Meter longitude for real-time mapping',
        
        -- VEGETATION_POWER_LINE_RISK facts
        VEGETATION_POWER_LINE_RISK.DISTANCE_TO_LINE_METERS AS TREE_LINE_DISTANCE_METERS WITH SYNONYMS = ('line clearance', 'tree proximity') COMMENT = 'Distance from tree to nearest power line in meters',
        VEGETATION_POWER_LINE_RISK.RISK_SCORE AS LINE_VEGETATION_RISK_SCORE COMMENT = 'Risk score (0-100) based on tree proximity to power line'
    )
    DIMENSIONS (
        -- =====================================================================
        -- EXISTING DIMENSIONS (preserved - abbreviated, full list from original)
        -- =====================================================================
        AMI_READINGS_ENHANCED.METER_ID AS METER_ID COMMENT = 'Unique meter identifier',
        AMI_READINGS_ENHANCED.TIMESTAMP AS READING_TIMESTAMP WITH SYNONYMS = ('reading time', 'timestamp') COMMENT = 'Timestamp of the reading',
        
        BUILDING_METER_ASSOCIATIONS.BUILDING_TYPE AS BUILDING_TYPE WITH SYNONYMS = ('property type', 'structure type') COMMENT = 'Building classification (Residential, Commercial, Industrial)',
        BUILDING_METER_ASSOCIATIONS.BUILDING_SUBTYPE AS BUILDING_SUBTYPE COMMENT = 'Detailed building subtype from HCAD classification',
        
        CIRCUIT_METADATA.CIRCUIT_ID AS CIRCUIT_ID COMMENT = 'Unique circuit identifier',
        CIRCUIT_METADATA.CIRCUIT_NAME AS CIRCUIT_NAME COMMENT = 'Human-readable circuit name',
        
        CUSTOMERS_MASTER_DATA.CUSTOMER_ID AS CUSTOMER_ID COMMENT = 'Unique customer identifier',
        CUSTOMERS_MASTER_DATA.CUSTOMER_NAME AS CUSTOMER_NAME COMMENT = 'Customer name',
        CUSTOMERS_MASTER_DATA.CUSTOMER_SEGMENT AS CUSTOMER_SEGMENT WITH SYNONYMS = ('segment', 'customer type') COMMENT = 'Customer segment (Residential, Commercial, Industrial)',
        
        OUTAGE_EVENTS.OUTAGE_ID AS OUTAGE_ID COMMENT = 'Unique outage event identifier',
        OUTAGE_EVENTS.OUTAGE_TYPE AS OUTAGE_TYPE WITH SYNONYMS = ('cause', 'outage cause') COMMENT = 'Type/cause of outage',
        
        SUBSTATIONS.SUBSTATION_ID AS SUBSTATION_ID COMMENT = 'Unique substation identifier',
        SUBSTATIONS.SUBSTATION_NAME AS SUBSTATION_NAME COMMENT = 'Substation name',
        
        TRANSFORMER_METADATA.TRANSFORMER_ID AS TRANSFORMER_ID COMMENT = 'Unique transformer identifier',
        TRANSFORMER_METADATA.TRANSFORMER_TYPE AS TRANSFORMER_TYPE COMMENT = 'Transformer type classification',
        
        HOUSTON_WEATHER_HOURLY.HOUR AS WEATHER_HOUR COMMENT = 'Hour of weather observation',
        HOUSTON_WEATHER_HOURLY.DATE AS WEATHER_DATE COMMENT = 'Date of weather observation',
        
        -- =====================================================================
        -- NEW DIMENSIONS (Priority 1 additions)
        -- =====================================================================
        -- AMI_MONTHLY_USAGE dimensions
        AMI_MONTHLY_USAGE.USAGE_MONTH AS USAGE_MONTH WITH SYNONYMS = ('billing month', 'consumption month') COMMENT = 'Month of aggregated usage (first day of month)',
        AMI_MONTHLY_USAGE.CUSTOMER_SEGMENT_ID AS MONTHLY_CUSTOMER_SEGMENT COMMENT = 'Customer segment for monthly aggregation',
        AMI_MONTHLY_USAGE.BUILDING_TYPE AS MONTHLY_BUILDING_TYPE COMMENT = 'Building type associated with meter',
        
        -- SAP_WORK_ORDERS dimensions
        SAP_WORK_ORDERS.WORK_ORDER_ID AS WORK_ORDER_ID WITH SYNONYMS = ('order id', 'maintenance id') COMMENT = 'Unique work order identifier',
        SAP_WORK_ORDERS.SAP_ORDER_NUMBER AS SAP_ORDER_NUMBER COMMENT = 'SAP system order number',
        SAP_WORK_ORDERS.WORK_TYPE AS WORK_TYPE WITH SYNONYMS = ('maintenance type', 'order type') COMMENT = 'Type of work (PREVENTIVE, CORRECTIVE, EMERGENCY, INSPECTION)',
        SAP_WORK_ORDERS.WORK_ORDER_STATUS AS WORK_ORDER_STATUS WITH SYNONYMS = ('order status', 'status') COMMENT = 'Current status of work order',
        SAP_WORK_ORDERS.PRIORITY AS WORK_ORDER_PRIORITY WITH SYNONYMS = ('urgency', 'priority level') COMMENT = 'Work order priority (EMERGENCY, HIGH, MEDIUM, LOW)',
        SAP_WORK_ORDERS.ASSIGNED_CREW_ID AS ASSIGNED_CREW_ID COMMENT = 'Crew assigned to work order',
        SAP_WORK_ORDERS.CREATED_DATE AS WORK_ORDER_CREATED_DATE COMMENT = 'Date work order was created',
        SAP_WORK_ORDERS.SCHEDULED_START_DATE AS SCHEDULED_START_DATE COMMENT = 'Scheduled start date',
        SAP_WORK_ORDERS.ACTUAL_COMPLETION_DATE AS ACTUAL_COMPLETION_DATE COMMENT = 'Actual completion date',
        
        -- AMI_STREAMING_DATA dimensions
        AMI_STREAMING_DATA.READING_TIMESTAMP AS STREAMING_TIMESTAMP WITH SYNONYMS = ('real-time timestamp', 'live reading time') COMMENT = 'Timestamp of real-time reading',
        AMI_STREAMING_DATA.SERVICE_AREA AS SERVICE_AREA COMMENT = 'Service area for real-time monitoring',
        AMI_STREAMING_DATA.CUSTOMER_SEGMENT AS STREAMING_CUSTOMER_SEGMENT COMMENT = 'Customer segment from streaming data',
        
        -- VEGETATION_POWER_LINE_RISK dimensions
        VEGETATION_POWER_LINE_RISK.TREE_ID AS POWER_LINE_TREE_ID COMMENT = 'Tree identifier from Overture Maps',
        VEGETATION_POWER_LINE_RISK.NEAREST_POWER_LINE_ID AS NEAREST_POWER_LINE_ID COMMENT = 'Nearest power line identifier',
        VEGETATION_POWER_LINE_RISK.LINE_CLASS AS POWER_LINE_CLASS COMMENT = 'Power line class (distribution, transmission)',
        VEGETATION_POWER_LINE_RISK.VEGETATION_RISK_LEVEL AS LINE_VEGETATION_RISK_LEVEL WITH SYNONYMS = ('clearance risk', 'encroachment level') COMMENT = 'Risk level category (CRITICAL, HIGH, MEDIUM, LOW)'
    )
    METRICS (
        -- =====================================================================
        -- EXISTING METRICS (preserved from original model)
        -- =====================================================================
        TOTAL_ENERGY_CONSUMPTION AS SUM(AMI_READINGS_ENHANCED.USAGE_KWH) 
            WITH SYNONYMS = ('total consumption', 'total kwh', 'total usage')
            COMMENT = 'Total energy consumption in kWh',
        
        AVERAGE_USAGE AS AVG(AMI_READINGS_ENHANCED.USAGE_KWH)
            WITH SYNONYMS = ('avg consumption', 'average kwh', 'mean usage')
            COMMENT = 'Average energy consumption per reading',
        
        TOTAL_OUTAGE_MINUTES AS SUM(OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES)
            WITH SYNONYMS = ('cumulative outage time', 'total downtime')
            COMMENT = 'Total outage duration across all events',
        
        AVERAGE_OUTAGE_DURATION AS AVG(OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES)
            WITH SYNONYMS = ('avg outage length', 'mean interruption time')
            COMMENT = 'Average outage duration per event',
        
        OUTAGE_COUNT AS COUNT(DISTINCT OUTAGE_EVENTS.OUTAGE_ID)
            WITH SYNONYMS = ('number of outages', 'outage events', 'interruption count')
            COMMENT = 'Count of distinct outage events',
        
        CUSTOMER_COUNT AS COUNT(DISTINCT CUSTOMERS_MASTER_DATA.CUSTOMER_ID)
            COMMENT = 'Count of distinct customers',
        
        METER_COUNT AS COUNT(DISTINCT METER_INFRASTRUCTURE.METER_ID)
            WITH SYNONYMS = ('number of meters', 'meter population')
            COMMENT = 'Count of distinct meters',
        
        TRANSFORMER_COUNT AS COUNT(DISTINCT TRANSFORMER_METADATA.TRANSFORMER_ID)
            COMMENT = 'Count of distinct transformers',
        
        -- =====================================================================
        -- NEW METRICS (Priority 1 additions)
        -- =====================================================================
        -- Monthly usage metrics
        TOTAL_MONTHLY_CONSUMPTION AS SUM(AMI_MONTHLY_USAGE.MONTHLY_KWH)
            WITH SYNONYMS = ('monthly total', 'monthly energy')
            COMMENT = 'Total monthly energy consumption from pre-aggregated data',
        
        AVERAGE_MONTHLY_CONSUMPTION AS AVG(AMI_MONTHLY_USAGE.MONTHLY_KWH)
            WITH SYNONYMS = ('avg monthly usage', 'mean monthly consumption')
            COMMENT = 'Average monthly consumption per meter',
        
        -- Work order metrics
        TOTAL_WORK_ORDERS AS COUNT(DISTINCT SAP_WORK_ORDERS.WORK_ORDER_ID)
            WITH SYNONYMS = ('work order count', 'maintenance count')
            COMMENT = 'Total number of work orders',
        
        TOTAL_MAINTENANCE_COST AS SUM(SAP_WORK_ORDERS.ACTUAL_COST_USD)
            WITH SYNONYMS = ('maintenance spend', 'total cost')
            COMMENT = 'Total actual cost of all work orders',
        
        AVERAGE_WORK_ORDER_COST AS AVG(SAP_WORK_ORDERS.ACTUAL_COST_USD)
            WITH SYNONYMS = ('avg order cost', 'mean maintenance cost')
            COMMENT = 'Average cost per work order',
        
        TOTAL_LABOR_HOURS AS SUM(SAP_WORK_ORDERS.LABOR_HOURS)
            WITH SYNONYMS = ('crew hours', 'labor time')
            COMMENT = 'Total labor hours across all work orders',
        
        -- Streaming data metrics
        REAL_TIME_TOTAL_LOAD AS SUM(AMI_STREAMING_DATA.USAGE_KWH)
            WITH SYNONYMS = ('live load', 'current consumption')
            COMMENT = 'Real-time total load from streaming data',
        
        REAL_TIME_AVG_VOLTAGE AS AVG(AMI_STREAMING_DATA.VOLTAGE)
            WITH SYNONYMS = ('live voltage', 'current voltage')
            COMMENT = 'Real-time average voltage across meters',
        
        -- Vegetation risk metrics
        HIGH_RISK_TREE_COUNT AS COUNT(DISTINCT CASE WHEN VEGETATION_POWER_LINE_RISK.VEGETATION_RISK_LEVEL = 'CRITICAL' OR VEGETATION_POWER_LINE_RISK.VEGETATION_RISK_LEVEL = 'HIGH' THEN VEGETATION_POWER_LINE_RISK.TREE_ID END)
            WITH SYNONYMS = ('hazard trees', 'priority vegetation')
            COMMENT = 'Count of high/critical risk trees near power lines'
    )
    AI_SQL_GENERATION 'For year-over-year comparisons, use AMI_MONTHLY_USAGE for faster query performance. For monthly trends, prefer AMI_MONTHLY_USAGE over aggregating AMI_READINGS_ENHANCED. For real-time operational dashboards, use AMI_STREAMING_DATA. For maintenance analytics, join SAP_WORK_ORDERS with TRANSFORMER_METADATA via EQUIPMENT_ID. When asked about transformer maintenance, check both work orders and thermal stress data. For vegetation-related outages, correlate CIRCUIT_VEGETATION_RISK with OUTAGE_EVENTS. Use BUILDING_METER_ASSOCIATIONS for building-type energy analysis. For energy affordability analysis, use ENERGY_BURDEN_ANALYSIS and ENERGY_BURDEN_TRENDS.'
    AI_QUESTION_CATEGORIZATION 'Grid Infrastructure questions involve meters, transformers, circuits, substations, poles. Usage and Consumption questions involve AMI readings, monthly usage, energy consumption, kWh. Outage and Reliability questions involve outages, SAIDI, SAIFI, voltage sags, interruptions. Weather and Climate questions involve temperature, humidity, wind, storms, weather events. Customer questions involve customers, billing, energy burden, affordability, segments. Work Order questions involve maintenance, SAP, work orders, crews, costs, field work. Vegetation Risk questions involve trees, vegetation, clearance, power line proximity. ERCOT and Pricing questions involve LMP, electricity prices, grid load, energy market. Real-time Monitoring questions involve streaming data, live readings, current conditions.'
    VERIFIED_QUERIES (
        -- =====================================================================
        -- EXISTING VERIFIED QUERIES (preserved from original model)
        -- =====================================================================
        (
            question = 'What is the total energy consumption for July 2025?',
            verified_query = 'SELECT SUM(USAGE_KWH) as TOTAL_KWH FROM SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL WHERE DATE_TRUNC(''MONTH'', TIMESTAMP) = ''2025-07-01''',
            verified_answer = 'Approximately 3.12 TWh (3,120,000,000 kWh) for July 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many outages occurred in 2025?',
            verified_query = 'SELECT COUNT(DISTINCT OUTAGE_ID) as OUTAGE_COUNT FROM SI_DEMOS.PRODUCTION.OUTAGE_EVENTS WHERE YEAR(START_TIME) = 2025',
            verified_answer = 'The count varies based on current data but represents all recorded outage events for 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What are the top 10 transformers by load?',
            verified_query = 'SELECT TRANSFORMER_ID, AVG(LOAD_KW) as AVG_LOAD_KW FROM SI_DEMOS.PRODUCTION.TRANSFORMER_HOURLY_LOAD GROUP BY TRANSFORMER_ID ORDER BY AVG_LOAD_KW DESC LIMIT 10',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What is the average SAIDI for 2025?',
            verified_query = 'SELECT AVG(SAIDI_MINUTES_PER_CUSTOMER) as AVG_SAIDI FROM SI_DEMOS.PRODUCTION.GRID_RELIABILITY_METRICS WHERE YEAR(MONTH) = 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show me the summer load comparison between 2024 and 2025',
            verified_query = 'SELECT YEAR, MONTH, TOTAL_LOAD_TWH, AVG_KWH_PER_METER FROM SI_DEMOS.PRODUCTION.SUMMER_LOAD_YOY_COMPARISON WHERE MONTH IN (7, 8) ORDER BY YEAR, MONTH',
            verified_answer = 'July 2024: 2.98 TWh, July 2025: 3.12 TWh (+4.9% YoY increase)',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Which circuits have the highest vegetation risk?',
            verified_query = 'SELECT CIRCUIT_ID, CIRCUIT_NAME, VEGETATION_RISK_SCORE, HIGH_RISK_TREE_COUNT FROM SI_DEMOS.PRODUCTION.CIRCUIT_VEGETATION_RISK ORDER BY VEGETATION_RISK_SCORE DESC LIMIT 10',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What is the current ERCOT price for Houston?',
            verified_query = 'SELECT TIMESTAMP, LMP_TOTAL, LMP_ENERGY, LMP_CONGESTION FROM SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED WHERE SETTLEMENT_POINT = ''HB_HOUSTON'' ORDER BY TIMESTAMP DESC LIMIT 1',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many customers are in each segment?',
            verified_query = 'SELECT CUSTOMER_SEGMENT, COUNT(DISTINCT CUSTOMER_ID) as CUSTOMER_COUNT FROM SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA GROUP BY CUSTOMER_SEGMENT ORDER BY CUSTOMER_COUNT DESC',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What percentage of meters have high energy burden?',
            verified_query = 'SELECT COUNT(CASE WHEN ANNUAL_ENERGY_BURDEN_PCT > 6 THEN 1 END) * 100.0 / COUNT(*) as HIGH_BURDEN_PCT FROM SI_DEMOS.PRODUCTION.ENERGY_BURDEN_ANALYSIS WHERE YEAR = 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show transformer thermal stress distribution',
            verified_query = 'SELECT STRESS_CATEGORY, COUNT(*) as TRANSFORMER_COUNT FROM SI_DEMOS.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED GROUP BY STRESS_CATEGORY ORDER BY TRANSFORMER_COUNT DESC',
            use_as_onboarding_question = TRUE
        ),
        
        -- =====================================================================
        -- NEW VERIFIED QUERIES (Priority 1 additions)
        -- =====================================================================
        (
            question = 'What is the year-over-year monthly usage trend?',
            verified_query = 'SELECT DATE_TRUNC(''MONTH'', USAGE_MONTH) as MONTH, SUM(MONTHLY_KWH) as TOTAL_KWH FROM SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE GROUP BY DATE_TRUNC(''MONTH'', USAGE_MONTH) ORDER BY MONTH',
            verified_answer = 'Monthly usage trends from pre-aggregated data showing seasonal patterns',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many open work orders are there by priority?',
            verified_query = 'SELECT PRIORITY, COUNT(*) as ORDER_COUNT FROM SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS WHERE WORK_ORDER_STATUS NOT IN (''COMPLETED'', ''CANCELLED'') GROUP BY PRIORITY ORDER BY CASE PRIORITY WHEN ''EMERGENCY'' THEN 1 WHEN ''HIGH'' THEN 2 WHEN ''MEDIUM'' THEN 3 ELSE 4 END',
            verified_answer = 'Work order counts grouped by priority level',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What is the total maintenance cost by work type?',
            verified_query = 'SELECT WORK_TYPE, COUNT(*) as ORDER_COUNT, SUM(ACTUAL_COST_USD) as TOTAL_COST FROM SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS WHERE ACTUAL_COST_USD IS NOT NULL GROUP BY WORK_TYPE ORDER BY TOTAL_COST DESC',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show real-time grid load by substation',
            verified_query = 'SELECT SUBSTATION_ID, SUM(USAGE_KWH) as TOTAL_LOAD_KWH, COUNT(DISTINCT METER_ID) as METER_COUNT, AVG(VOLTAGE) as AVG_VOLTAGE FROM SI_DEMOS.PRODUCTION.AMI_STREAMING_DATA WHERE READING_TIMESTAMP > DATEADD(HOUR, -1, CURRENT_TIMESTAMP()) GROUP BY SUBSTATION_ID ORDER BY TOTAL_LOAD_KWH DESC LIMIT 20',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Which transformers need preventive maintenance?',
            verified_query = 'SELECT t.TRANSFORMER_ID, t.INSTALL_DATE, DATEDIFF(YEAR, t.INSTALL_DATE, CURRENT_DATE()) as AGE_YEARS, ts.STRESS_CATEGORY, COALESCE(w.LAST_MAINTENANCE, ''Never'') as LAST_MAINTENANCE FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA t LEFT JOIN SI_DEMOS.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED ts ON t.TRANSFORMER_ID = ts.TRANSFORMER_ID LEFT JOIN (SELECT EQUIPMENT_ID, MAX(ACTUAL_COMPLETION_DATE) as LAST_MAINTENANCE FROM SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS WHERE WORK_TYPE = ''PREVENTIVE'' GROUP BY EQUIPMENT_ID) w ON t.TRANSFORMER_ID = w.EQUIPMENT_ID WHERE DATEDIFF(YEAR, t.INSTALL_DATE, CURRENT_DATE()) > 15 OR ts.STRESS_CATEGORY IN (''CRITICAL'', ''HIGH'') ORDER BY AGE_YEARS DESC LIMIT 20',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many trees are near power lines by risk level?',
            verified_query = 'SELECT VEGETATION_RISK_LEVEL, COUNT(*) as TREE_COUNT, AVG(DISTANCE_TO_LINE_METERS) as AVG_DISTANCE_M FROM SI_DEMOS.PRODUCTION.VEGETATION_POWER_LINE_RISK GROUP BY VEGETATION_RISK_LEVEL ORDER BY CASE VEGETATION_RISK_LEVEL WHEN ''CRITICAL'' THEN 1 WHEN ''HIGH'' THEN 2 WHEN ''MEDIUM'' THEN 3 ELSE 4 END',
            use_as_onboarding_question = TRUE
        )
    );
