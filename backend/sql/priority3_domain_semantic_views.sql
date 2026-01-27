-- =============================================================================
-- PRIORITY 3: Domain-Specific Semantic Views + Multi-View Agent
-- =============================================================================
-- Following Snowflake best practices: "Start with 3 tables, keep scope focused"
-- "Organize by business domain - e.g., separate models for sales and marketing"
-- =============================================================================

-- =============================================================================
-- VIEW 1: GRID_INFRASTRUCTURE_SEMANTIC_VIEW
-- Domain: Physical grid assets and topology
-- Tables: 5 (within recommended limit)
-- =============================================================================
CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.GRID_INFRASTRUCTURE_SEMANTIC_VIEW
    COMMENT = 'Grid infrastructure topology: meters, transformers, circuits, substations, and poles. Use for asset inventory, network analysis, and infrastructure planning.'
    TABLES (
        SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE 
            PRIMARY KEY (METER_ID)
            WITH SYNONYMS = ('METERS', 'AMI_METERS', 'SMART_METERS')
            COMMENT = '596,906 smart meters with topology linkage to transformers, circuits, and substations',
        
        SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA 
            PRIMARY KEY (TRANSFORMER_ID)
            WITH SYNONYMS = ('TRANSFORMERS', 'DISTRIBUTION_TRANSFORMERS', 'XFMRS')
            COMMENT = '24,631 distribution transformers with installation dates, ratings, and topology',
        
        SI_DEMOS.PRODUCTION.CIRCUIT_METADATA 
            PRIMARY KEY (CIRCUIT_ID)
            WITH SYNONYMS = ('CIRCUITS', 'DISTRIBUTION_CIRCUITS', 'FEEDERS')
            COMMENT = '73 distribution circuits with voltage levels and asset counts',
        
        SI_DEMOS.PRODUCTION.SUBSTATIONS 
            PRIMARY KEY (SUBSTATION_ID)
            WITH SYNONYMS = ('SUBS', 'DISTRIBUTION_SUBSTATIONS')
            COMMENT = '22 substations serving the Houston service territory',
        
        SI_DEMOS.PRODUCTION.GRID_POLES_INFRASTRUCTURE 
            PRIMARY KEY (POLE_ID)
            WITH SYNONYMS = ('POLES', 'UTILITY_POLES', 'DISTRIBUTION_POLES')
            COMMENT = '49,000+ utility poles with health scores and equipment attachments'
    )
    RELATIONSHIPS (
        METER_TO_TRANSFORMER AS METER_INFRASTRUCTURE(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        METER_TO_CIRCUIT AS METER_INFRASTRUCTURE(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        METER_TO_SUBSTATION AS METER_INFRASTRUCTURE(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        TRANSFORMER_TO_CIRCUIT AS TRANSFORMER_METADATA(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID),
        TRANSFORMER_TO_SUBSTATION AS TRANSFORMER_METADATA(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        CIRCUIT_TO_SUBSTATION AS CIRCUIT_METADATA(SUBSTATION_ID) REFERENCES SUBSTATIONS(SUBSTATION_ID),
        POLE_TO_TRANSFORMER AS GRID_POLES_INFRASTRUCTURE(TRANSFORMER_ID) REFERENCES TRANSFORMER_METADATA(TRANSFORMER_ID),
        POLE_TO_CIRCUIT AS GRID_POLES_INFRASTRUCTURE(CIRCUIT_ID) REFERENCES CIRCUIT_METADATA(CIRCUIT_ID)
    )
    FACTS (
        -- Meter facts
        METER_INFRASTRUCTURE.METER_LATITUDE AS METER_LATITUDE COMMENT = 'Meter location latitude',
        METER_INFRASTRUCTURE.METER_LONGITUDE AS METER_LONGITUDE COMMENT = 'Meter location longitude',
        
        -- Transformer facts
        TRANSFORMER_METADATA.RATED_KVA AS TRANSFORMER_RATED_KVA COMMENT = 'Transformer rated capacity in kVA',
        
        -- Circuit facts
        CIRCUIT_METADATA.METER_COUNT AS CIRCUIT_METER_COUNT COMMENT = 'Number of meters on circuit',
        CIRCUIT_METADATA.TRANSFORMER_COUNT AS CIRCUIT_TRANSFORMER_COUNT COMMENT = 'Number of transformers on circuit',
        CIRCUIT_METADATA.VOLTAGE_LEVEL_KV AS CIRCUIT_VOLTAGE_KV COMMENT = 'Circuit voltage level in kV',
        
        -- Substation facts
        SUBSTATIONS.CAPACITY_MVA AS SUBSTATION_CAPACITY_MVA COMMENT = 'Substation capacity in MVA',
        SUBSTATIONS.LATITUDE AS SUBSTATION_LATITUDE COMMENT = 'Substation latitude',
        SUBSTATIONS.LONGITUDE AS SUBSTATION_LONGITUDE COMMENT = 'Substation longitude',
        
        -- Pole facts
        GRID_POLES_INFRASTRUCTURE.HEALTH_SCORE AS POLE_HEALTH_SCORE 
            WITH SYNONYMS = ('pole condition', 'structural score')
            COMMENT = 'Pole health score 0-100',
        GRID_POLES_INFRASTRUCTURE.POLE_HEIGHT_FT AS POLE_HEIGHT_FT COMMENT = 'Pole height in feet'
    )
    DIMENSIONS (
        METER_INFRASTRUCTURE.METER_ID AS METER_ID COMMENT = 'Unique meter identifier',
        METER_INFRASTRUCTURE.METER_TYPE AS METER_TYPE COMMENT = 'Meter type classification',
        
        TRANSFORMER_METADATA.TRANSFORMER_ID AS TRANSFORMER_ID COMMENT = 'Unique transformer identifier',
        TRANSFORMER_METADATA.TRANSFORMER_TYPE AS TRANSFORMER_TYPE COMMENT = 'Transformer type (pole-mount, pad-mount)',
        TRANSFORMER_METADATA.INSTALL_DATE AS TRANSFORMER_INSTALL_DATE COMMENT = 'Installation date',
        
        CIRCUIT_METADATA.CIRCUIT_ID AS CIRCUIT_ID COMMENT = 'Unique circuit identifier',
        CIRCUIT_METADATA.CIRCUIT_NAME AS CIRCUIT_NAME COMMENT = 'Human-readable circuit name',
        
        SUBSTATIONS.SUBSTATION_ID AS SUBSTATION_ID COMMENT = 'Unique substation identifier',
        SUBSTATIONS.SUBSTATION_NAME AS SUBSTATION_NAME COMMENT = 'Substation name',
        
        GRID_POLES_INFRASTRUCTURE.POLE_ID AS POLE_ID COMMENT = 'Unique pole identifier',
        GRID_POLES_INFRASTRUCTURE.POLE_TYPE AS POLE_TYPE COMMENT = 'Pole material type'
    )
    METRICS (
        TOTAL_METERS AS COUNT(DISTINCT METER_INFRASTRUCTURE.METER_ID)
            WITH SYNONYMS = ('meter count', 'number of meters')
            COMMENT = 'Total count of meters',
        
        TOTAL_TRANSFORMERS AS COUNT(DISTINCT TRANSFORMER_METADATA.TRANSFORMER_ID)
            WITH SYNONYMS = ('transformer count', 'xfmr count')
            COMMENT = 'Total count of transformers',
        
        TOTAL_CIRCUITS AS COUNT(DISTINCT CIRCUIT_METADATA.CIRCUIT_ID)
            COMMENT = 'Total count of circuits',
        
        TOTAL_SUBSTATIONS AS COUNT(DISTINCT SUBSTATIONS.SUBSTATION_ID)
            COMMENT = 'Total count of substations',
        
        TOTAL_POLES AS COUNT(DISTINCT GRID_POLES_INFRASTRUCTURE.POLE_ID)
            COMMENT = 'Total count of utility poles',
        
        AVERAGE_POLE_HEALTH AS AVG(GRID_POLES_INFRASTRUCTURE.HEALTH_SCORE)
            WITH SYNONYMS = ('avg pole condition', 'mean health score')
            COMMENT = 'Average pole health score',
        
        TOTAL_TRANSFORMER_CAPACITY_KVA AS SUM(TRANSFORMER_METADATA.RATED_KVA)
            COMMENT = 'Total installed transformer capacity'
    )
    MODULE_CUSTOM_INSTRUCTIONS (
        SQL_GENERATION (
            QUESTION_CATEGORIZATION = (
                'Asset inventory questions: how many meters/transformers/circuits',
                'Topology questions: which meters serve which transformer, circuit hierarchy',
                'Location questions: where are assets located, geographic distribution',
                'Infrastructure age questions: transformer installation dates, equipment age',
                'Health and condition questions: pole health scores, equipment status'
            ),
            INSTRUCTIONS = (
                'Use this view for physical asset questions',
                'For meter counts by area, group by CIRCUIT_ID or SUBSTATION_ID',
                'Transformer age = DATEDIFF(YEAR, INSTALL_DATE, CURRENT_DATE())',
                'Pole health <50 is critical, 50-69 is poor, 70-84 is fair, 85+ is good'
            )
        )
    )
    VERIFIED_QUERIES (
        (
            question = 'How many meters are there in total?',
            verified_query = 'SELECT COUNT(DISTINCT METER_ID) as TOTAL_METERS FROM SI_DEMOS.PRODUCTION.METER_INFRASTRUCTURE',
            verified_answer = '596,906 smart meters',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many transformers are there per circuit?',
            verified_query = 'SELECT CIRCUIT_ID, COUNT(DISTINCT TRANSFORMER_ID) as TRANSFORMER_COUNT FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA GROUP BY CIRCUIT_ID ORDER BY TRANSFORMER_COUNT DESC',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What is the average transformer age?',
            verified_query = 'SELECT AVG(DATEDIFF(YEAR, INSTALL_DATE, CURRENT_DATE())) as AVG_AGE_YEARS FROM SI_DEMOS.PRODUCTION.TRANSFORMER_METADATA WHERE INSTALL_DATE IS NOT NULL',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show pole health distribution',
            verified_query = 'SELECT CASE WHEN HEALTH_SCORE < 50 THEN ''Critical'' WHEN HEALTH_SCORE < 70 THEN ''Poor'' WHEN HEALTH_SCORE < 85 THEN ''Fair'' ELSE ''Good'' END as HEALTH_CATEGORY, COUNT(*) as POLE_COUNT FROM SI_DEMOS.PRODUCTION.GRID_POLES_INFRASTRUCTURE GROUP BY 1 ORDER BY CASE HEALTH_CATEGORY WHEN ''Critical'' THEN 1 WHEN ''Poor'' THEN 2 WHEN ''Fair'' THEN 3 ELSE 4 END',
            use_as_onboarding_question = TRUE
        )
    );


-- =============================================================================
-- VIEW 2: ENERGY_CONSUMPTION_SEMANTIC_VIEW
-- Domain: Energy usage, AMI readings, consumption patterns
-- Tables: 4 (within recommended limit)
-- =============================================================================
CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.ENERGY_CONSUMPTION_SEMANTIC_VIEW
    COMMENT = 'Energy consumption analytics: AMI readings, monthly aggregates, streaming data. Use for usage analysis, demand forecasting, and YoY comparisons.'
    TABLES (
        AMI_READINGS AS SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL 
            PRIMARY KEY (METER_ID, TIMESTAMP)
            WITH SYNONYMS = ('INTERVAL_READINGS', 'METER_READINGS', '15_MINUTE_DATA')
            COMMENT = 'Detailed 15-minute interval AMI readings with voltage and power factor',
        
        SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE 
            PRIMARY KEY (METER_ID, USAGE_MONTH)
            WITH SYNONYMS = ('MONTHLY_CONSUMPTION', 'MONTHLY_AMI', 'YOY_USAGE')
            COMMENT = 'Pre-aggregated monthly usage for fast trend analysis (2.4M rows)',
        
        SI_DEMOS.PRODUCTION.AMI_STREAMING_DATA 
            PRIMARY KEY (METER_ID, READING_TIMESTAMP)
            WITH SYNONYMS = ('REAL_TIME_READINGS', 'LIVE_DATA', 'STREAMING_AMI')
            COMMENT = 'Real-time streaming AMI data for live monitoring (5.4M rows)',
        
        SI_DEMOS.PRODUCTION.SUMMER_LOAD_YOY_COMPARISON 
            WITH SYNONYMS = ('SUMMER_TRENDS', 'YOY_LOAD', 'SEASONAL_COMPARISON')
            COMMENT = 'Year-over-year summer load comparison 2023-2025'
    )
    RELATIONSHIPS (
        MONTHLY_TO_READINGS AS AMI_MONTHLY_USAGE(METER_ID) REFERENCES AMI_READINGS(METER_ID),
        STREAMING_TO_READINGS AS AMI_STREAMING_DATA(METER_ID) REFERENCES AMI_READINGS(METER_ID)
    )
    FACTS (
        -- Interval readings
        AMI_READINGS.USAGE_KWH AS USAGE_KWH 
            WITH SYNONYMS = ('energy usage', 'consumption', 'kwh')
            COMMENT = '15-minute interval energy usage in kWh',
        AMI_READINGS.VOLTAGE AS VOLTAGE COMMENT = 'Voltage reading',
        AMI_READINGS.POWER_FACTOR AS POWER_FACTOR COMMENT = 'Power factor',
        
        -- Monthly aggregates
        AMI_MONTHLY_USAGE.MONTHLY_KWH AS MONTHLY_KWH 
            WITH SYNONYMS = ('monthly consumption', 'monthly usage')
            COMMENT = 'Total monthly energy consumption in kWh',
        AMI_MONTHLY_USAGE.READING_COUNT AS READING_COUNT COMMENT = 'Number of readings in month',
        AMI_MONTHLY_USAGE.AVG_USAGE_PER_READING AS AVG_USAGE_PER_READING COMMENT = 'Average usage per interval',
        
        -- Streaming data
        AMI_STREAMING_DATA.USAGE_KWH AS STREAMING_USAGE_KWH 
            WITH SYNONYMS = ('real-time usage', 'live consumption')
            COMMENT = 'Real-time energy usage',
        AMI_STREAMING_DATA.VOLTAGE AS STREAMING_VOLTAGE COMMENT = 'Real-time voltage',
        AMI_STREAMING_DATA.TEMPERATURE_C AS AMBIENT_TEMPERATURE_C COMMENT = 'Ambient temperature at meter',
        
        -- YoY comparison
        SUMMER_LOAD_YOY_COMPARISON.TOTAL_LOAD_TWH AS SUMMER_LOAD_TWH COMMENT = 'Total summer load in TWh',
        SUMMER_LOAD_YOY_COMPARISON.AVG_KWH_PER_METER AS AVG_KWH_PER_METER COMMENT = 'Average kWh per meter'
    )
    DIMENSIONS (
        AMI_READINGS.METER_ID AS METER_ID COMMENT = 'Meter identifier',
        AMI_READINGS.TIMESTAMP AS READING_TIMESTAMP 
            WITH SYNONYMS = ('timestamp', 'reading time')
            COMMENT = 'Timestamp of reading',
        
        AMI_MONTHLY_USAGE.USAGE_MONTH AS USAGE_MONTH 
            WITH SYNONYMS = ('month', 'billing period')
            COMMENT = 'Month of aggregated usage',
        AMI_MONTHLY_USAGE.CUSTOMER_SEGMENT_ID AS CUSTOMER_SEGMENT COMMENT = 'Customer segment',
        AMI_MONTHLY_USAGE.BUILDING_TYPE AS BUILDING_TYPE COMMENT = 'Building type',
        
        AMI_STREAMING_DATA.SERVICE_AREA AS SERVICE_AREA COMMENT = 'Service area for streaming data',
        
        SUMMER_LOAD_YOY_COMPARISON.YEAR AS COMPARISON_YEAR COMMENT = 'Year for comparison',
        SUMMER_LOAD_YOY_COMPARISON.MONTH AS COMPARISON_MONTH COMMENT = 'Month for comparison'
    )
    METRICS (
        TOTAL_CONSUMPTION AS SUM(AMI_READINGS.USAGE_KWH)
            WITH SYNONYMS = ('total kwh', 'total usage', 'energy total')
            COMMENT = 'Total energy consumption',
        
        AVERAGE_USAGE AS AVG(AMI_READINGS.USAGE_KWH)
            WITH SYNONYMS = ('avg usage', 'mean consumption')
            COMMENT = 'Average usage per reading',
        
        TOTAL_MONTHLY_CONSUMPTION AS SUM(AMI_MONTHLY_USAGE.MONTHLY_KWH)
            WITH SYNONYMS = ('monthly total', 'monthly energy')
            COMMENT = 'Total monthly consumption from aggregated data',
        
        REAL_TIME_LOAD AS SUM(AMI_STREAMING_DATA.USAGE_KWH)
            WITH SYNONYMS = ('live load', 'current usage')
            COMMENT = 'Real-time total load'
    )
    MODULE_CUSTOM_INSTRUCTIONS (
        SQL_GENERATION (
            QUESTION_CATEGORIZATION = (
                'Historical usage: past consumption, trends, patterns over time',
                'Monthly trends: month-over-month, seasonal patterns, billing periods',
                'Real-time monitoring: current load, live readings, now',
                'YoY comparison: year-over-year, summer comparison, growth rates'
            ),
            INSTRUCTIONS = (
                'For monthly trends, use AMI_MONTHLY_USAGE for better performance',
                'For real-time questions, use AMI_STREAMING_DATA',
                'For detailed interval analysis, use AMI_READINGS',
                'For YoY summer comparison, use SUMMER_LOAD_YOY_COMPARISON',
                'July 2024: 2.98 TWh, July 2025: 3.12 TWh (+4.9% YoY)'
            )
        )
    )
    VERIFIED_QUERIES (
        (
            question = 'What is the total energy consumption for July 2025?',
            verified_query = 'SELECT SUM(USAGE_KWH) / 1000000000 as TOTAL_TWH FROM SI_DEMOS.PRODUCTION.AMI_READINGS_FINAL WHERE DATE_TRUNC(''MONTH'', TIMESTAMP) = ''2025-07-01''',
            verified_answer = 'Approximately 3.12 TWh for July 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show monthly usage trend for 2025',
            verified_query = 'SELECT DATE_TRUNC(''MONTH'', USAGE_MONTH) as MONTH, SUM(MONTHLY_KWH) / 1000000 as TOTAL_GWH FROM SI_DEMOS.PRODUCTION.AMI_MONTHLY_USAGE WHERE YEAR(USAGE_MONTH) = 2025 GROUP BY 1 ORDER BY 1',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What is the current real-time grid load?',
            verified_query = 'SELECT SUM(USAGE_KWH) as CURRENT_LOAD_KWH, COUNT(DISTINCT METER_ID) as ACTIVE_METERS FROM SI_DEMOS.PRODUCTION.AMI_STREAMING_DATA WHERE READING_TIMESTAMP > DATEADD(MINUTE, -15, CURRENT_TIMESTAMP())',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Compare summer load 2024 vs 2025',
            verified_query = 'SELECT YEAR, MONTH, TOTAL_LOAD_TWH, AVG_KWH_PER_METER FROM SI_DEMOS.PRODUCTION.SUMMER_LOAD_YOY_COMPARISON WHERE MONTH IN (7, 8) ORDER BY YEAR, MONTH',
            verified_answer = 'July 2024: 2.98 TWh (4,986 kWh/meter), July 2025: 3.12 TWh (5,232 kWh/meter) = +4.9% growth',
            use_as_onboarding_question = TRUE
        )
    );


-- =============================================================================
-- VIEW 3: RELIABILITY_SEMANTIC_VIEW  
-- Domain: Outages, voltage sags, reliability metrics, equipment stress
-- Tables: 5 (at recommended limit)
-- =============================================================================
CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.RELIABILITY_SEMANTIC_VIEW
    COMMENT = 'Grid reliability analytics: outages, voltage sags, SAIDI/SAIFI metrics, transformer stress. Use for reliability reporting, root cause analysis, and equipment health.'
    TABLES (
        SI_DEMOS.PRODUCTION.OUTAGE_EVENTS 
            PRIMARY KEY (OUTAGE_ID)
            WITH SYNONYMS = ('OUTAGES', 'POWER_OUTAGES', 'INTERRUPTIONS')
            COMMENT = 'Outage events with duration, affected customers, and root cause',
        
        SI_DEMOS.PRODUCTION.VOLTAGE_SAG_EVENTS 
            PRIMARY KEY (EVENT_ID)
            WITH SYNONYMS = ('SAG_EVENTS', 'VOLTAGE_SAGS', 'POWER_QUALITY')
            COMMENT = 'Voltage sag events that precede outages',
        
        SI_DEMOS.PRODUCTION.GRID_RELIABILITY_METRICS 
            WITH SYNONYMS = ('RELIABILITY_METRICS', 'SAIDI_SAIFI', 'KPIs')
            COMMENT = 'Monthly SAIDI, SAIFI, CAIDI metrics for regulatory reporting',
        
        SI_DEMOS.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED 
            WITH SYNONYMS = ('THERMAL_STRESS', 'TRANSFORMER_STRESS', 'OVERLOAD_ANALYSIS')
            COMMENT = 'Transformer thermal stress levels and overload indicators',
        
        SI_DEMOS.PRODUCTION.CUSTOMER_OUTAGE_EVENTS 
            UNIQUE (CUSTOMER_OUTAGE_ID)
            WITH SYNONYMS = ('CUSTOMER_INTERRUPTIONS', 'INDIVIDUAL_OUTAGES')
            COMMENT = 'Customer-level outage events for Customer 360 analytics'
    )
    RELATIONSHIPS (
        OUTAGE_TO_SAG AS OUTAGE_EVENTS(CAUSED_BY_SAG_EVENT_ID) REFERENCES VOLTAGE_SAG_EVENTS(EVENT_ID),
        SAG_TO_TRANSFORMER AS VOLTAGE_SAG_EVENTS(TRANSFORMER_ID) REFERENCES TRANSFORMER_THERMAL_STRESS_MATERIALIZED(TRANSFORMER_ID)
    )
    FACTS (
        -- Outage facts
        OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES AS OUTAGE_DURATION_MINUTES 
            WITH SYNONYMS = ('duration', 'outage length', 'interruption time')
            COMMENT = 'Outage duration in minutes',
        OUTAGE_EVENTS.AFFECTED_CUSTOMERS AS AFFECTED_CUSTOMERS 
            WITH SYNONYMS = ('customers affected', 'impacted customers')
            COMMENT = 'Number of customers affected',
        
        -- Voltage sag facts
        VOLTAGE_SAG_EVENTS.VOLTAGE_DROP_AMOUNT AS VOLTAGE_DROP 
            WITH SYNONYMS = ('sag magnitude', 'voltage reduction')
            COMMENT = 'Voltage drop amount in volts',
        VOLTAGE_SAG_EVENTS.DURATION_SECONDS AS SAG_DURATION_SECONDS COMMENT = 'Sag duration in seconds',
        
        -- Reliability metrics
        GRID_RELIABILITY_METRICS.SAIDI_MINUTES_PER_CUSTOMER AS SAIDI 
            WITH SYNONYMS = ('system average interruption duration', 'avg outage minutes')
            COMMENT = 'SAIDI - average minutes of outage per customer',
        GRID_RELIABILITY_METRICS.SAIFI_INTERRUPTIONS_PER_CUSTOMER AS SAIFI 
            WITH SYNONYMS = ('system average interruption frequency', 'avg interruptions')
            COMMENT = 'SAIFI - average interruptions per customer',
        GRID_RELIABILITY_METRICS.CAIDI_AVG_OUTAGE_DURATION_MINUTES AS CAIDI 
            WITH SYNONYMS = ('customer average interruption duration')
            COMMENT = 'CAIDI - average duration when interrupted',
        
        -- Customer outage facts
        CUSTOMER_OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES AS CUSTOMER_OUTAGE_DURATION COMMENT = 'Individual customer outage duration'
    )
    DIMENSIONS (
        OUTAGE_EVENTS.OUTAGE_ID AS OUTAGE_ID COMMENT = 'Unique outage identifier',
        OUTAGE_EVENTS.OUTAGE_TYPE AS OUTAGE_TYPE 
            WITH SYNONYMS = ('cause', 'outage cause', 'root cause')
            COMMENT = 'Type/cause of outage',
        OUTAGE_EVENTS.START_TIME AS OUTAGE_START_TIME COMMENT = 'Outage start timestamp',
        OUTAGE_EVENTS.TRANSFORMER_ID AS AFFECTED_TRANSFORMER_ID COMMENT = 'Transformer affected',
        OUTAGE_EVENTS.CIRCUIT_ID AS AFFECTED_CIRCUIT_ID COMMENT = 'Circuit affected',
        
        VOLTAGE_SAG_EVENTS.EVENT_ID AS SAG_EVENT_ID COMMENT = 'Sag event identifier',
        VOLTAGE_SAG_EVENTS.SAG_CAUSE AS SAG_CAUSE COMMENT = 'Cause of voltage sag',
        
        GRID_RELIABILITY_METRICS.MONTH AS METRICS_MONTH COMMENT = 'Month of reliability metrics',
        
        TRANSFORMER_THERMAL_STRESS_MATERIALIZED.TRANSFORMER_ID AS STRESSED_TRANSFORMER_ID COMMENT = 'Transformer with stress',
        TRANSFORMER_THERMAL_STRESS_MATERIALIZED.STRESS_CATEGORY AS STRESS_CATEGORY 
            WITH SYNONYMS = ('stress level', 'thermal status')
            COMMENT = 'Stress category (CRITICAL, HIGH, MEDIUM, LOW)',
        
        CUSTOMER_OUTAGE_EVENTS.CUSTOMER_ID AS AFFECTED_CUSTOMER_ID COMMENT = 'Customer affected by outage'
    )
    METRICS (
        TOTAL_OUTAGES AS COUNT(DISTINCT OUTAGE_EVENTS.OUTAGE_ID)
            WITH SYNONYMS = ('outage count', 'interruption count')
            COMMENT = 'Total number of outage events',
        
        TOTAL_OUTAGE_DURATION AS SUM(OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES)
            WITH SYNONYMS = ('total downtime', 'cumulative outage time')
            COMMENT = 'Total outage minutes',
        
        AVERAGE_OUTAGE_DURATION AS AVG(OUTAGE_EVENTS.OUTAGE_DURATION_MINUTES)
            WITH SYNONYMS = ('avg outage length', 'mean duration')
            COMMENT = 'Average outage duration',
        
        TOTAL_CUSTOMERS_IMPACTED AS SUM(OUTAGE_EVENTS.AFFECTED_CUSTOMERS)
            COMMENT = 'Total customer-outage incidents',
        
        VOLTAGE_SAG_COUNT AS COUNT(DISTINCT VOLTAGE_SAG_EVENTS.EVENT_ID)
            WITH SYNONYMS = ('sag count', 'power quality events')
            COMMENT = 'Total voltage sag events',
        
        CRITICAL_TRANSFORMERS AS COUNT(DISTINCT CASE WHEN TRANSFORMER_THERMAL_STRESS_MATERIALIZED.STRESS_CATEGORY = 'CRITICAL' THEN TRANSFORMER_THERMAL_STRESS_MATERIALIZED.TRANSFORMER_ID END)
            WITH SYNONYMS = ('at-risk transformers', 'overloaded transformers')
            COMMENT = 'Count of critically stressed transformers'
    )
    MODULE_CUSTOM_INSTRUCTIONS (
        SQL_GENERATION (
            QUESTION_CATEGORIZATION = (
                'Outage analysis: outage counts, duration, affected customers, root cause',
                'Reliability KPIs: SAIDI, SAIFI, CAIDI, regulatory metrics',
                'Voltage quality: voltage sags, power quality events',
                'Equipment stress: transformer thermal stress, overload analysis',
                'Customer impact: individual customer outages, service credits'
            ),
            INSTRUCTIONS = (
                'For regulatory reporting, use GRID_RELIABILITY_METRICS',
                'To find outage root causes, join OUTAGE_EVENTS with VOLTAGE_SAG_EVENTS',
                'Transformers with CRITICAL stress need immediate attention',
                'SAIDI target is typically <60 minutes/customer/year',
                'SAIFI target is typically <1.2 interruptions/customer/year'
            )
        )
    )
    VERIFIED_QUERIES (
        (
            question = 'What is the average SAIDI for 2025?',
            verified_query = 'SELECT AVG(SAIDI_MINUTES_PER_CUSTOMER) as AVG_SAIDI_2025 FROM SI_DEMOS.PRODUCTION.GRID_RELIABILITY_METRICS WHERE YEAR(MONTH) = 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many outages occurred in July 2025?',
            verified_query = 'SELECT COUNT(DISTINCT OUTAGE_ID) as OUTAGE_COUNT FROM SI_DEMOS.PRODUCTION.OUTAGE_EVENTS WHERE DATE_TRUNC(''MONTH'', START_TIME) = ''2025-07-01''',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Which transformers are critically stressed?',
            verified_query = 'SELECT TRANSFORMER_ID, STRESS_CATEGORY, PEAK_LOAD_FACTOR FROM SI_DEMOS.PRODUCTION.TRANSFORMER_THERMAL_STRESS_MATERIALIZED WHERE STRESS_CATEGORY = ''CRITICAL'' ORDER BY PEAK_LOAD_FACTOR DESC',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show outage types by frequency',
            verified_query = 'SELECT OUTAGE_TYPE, COUNT(*) as OUTAGE_COUNT, AVG(OUTAGE_DURATION_MINUTES) as AVG_DURATION FROM SI_DEMOS.PRODUCTION.OUTAGE_EVENTS GROUP BY OUTAGE_TYPE ORDER BY OUTAGE_COUNT DESC',
            use_as_onboarding_question = TRUE
        )
    );


-- =============================================================================
-- VIEW 4: WEATHER_ENERGY_MARKET_SEMANTIC_VIEW
-- Domain: Weather, ERCOT pricing, storm correlations
-- Tables: 5 (at recommended limit)
-- =============================================================================
CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.WEATHER_ENERGY_MARKET_SEMANTIC_VIEW
    COMMENT = 'Weather and energy market analytics: weather data, ERCOT pricing, storm correlations. Use for demand forecasting, price analysis, and weather impact assessment.'
    TABLES (
        SI_DEMOS.PRODUCTION.HOUSTON_WEATHER_HOURLY 
            WITH SYNONYMS = ('WEATHER', 'CLIMATE', 'WEATHER_DATA')
            COMMENT = 'Hourly Houston weather data with temperature, humidity, wind',
        
        SI_DEMOS.PRODUCTION.WEATHER_STRESS_EVENTS 
            WITH SYNONYMS = ('HEAT_EVENTS', 'WEATHER_CONDITIONS', 'EXTREME_WEATHER')
            COMMENT = 'Daily weather stress classification for demand forecasting',
        
        SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED 
            WITH SYNONYMS = ('ELECTRICITY_PRICES', 'LMP', 'ENERGY_PRICES')
            COMMENT = 'ERCOT locational marginal pricing for Houston zone',
        
        SI_DEMOS.PRODUCTION.ERCOT_LOAD_UNIFIED 
            WITH SYNONYMS = ('GRID_LOAD', 'ERCOT_DEMAND', 'SYSTEM_LOAD')
            COMMENT = 'ERCOT total system load 2023-2025',
        
        SI_DEMOS.PRODUCTION.STORM_OUTAGE_IMPACT_ANALYSIS 
            WITH SYNONYMS = ('STORM_IMPACT', 'WEATHER_OUTAGES', 'STORM_CORRELATION')
            COMMENT = 'Storm-to-outage correlation analysis'
    )
    RELATIONSHIPS (
        -- Weather and pricing are time-correlated rather than FK-based
    )
    FACTS (
        -- Weather facts
        HOUSTON_WEATHER_HOURLY.TEMP_F AS TEMPERATURE_F 
            WITH SYNONYMS = ('temp', 'temperature')
            COMMENT = 'Temperature in Fahrenheit',
        HOUSTON_WEATHER_HOURLY.HUMIDITY_PCT AS HUMIDITY_PCT COMMENT = 'Humidity percentage',
        HOUSTON_WEATHER_HOURLY.WIND_SPEED_MPH AS WIND_SPEED_MPH COMMENT = 'Wind speed in MPH',
        HOUSTON_WEATHER_HOURLY.PRECIPITATION_INCHES AS PRECIPITATION_INCHES COMMENT = 'Precipitation in inches',
        
        -- ERCOT pricing
        ERCOT_LMP_UNIFIED.LMP_TOTAL AS LMP_TOTAL 
            WITH SYNONYMS = ('electricity price', 'energy price', 'LMP')
            COMMENT = 'Total LMP in $/MWh',
        ERCOT_LMP_UNIFIED.LMP_ENERGY AS LMP_ENERGY COMMENT = 'Energy component of LMP',
        ERCOT_LMP_UNIFIED.LMP_CONGESTION AS LMP_CONGESTION COMMENT = 'Congestion component',
        
        -- ERCOT load
        ERCOT_LOAD_UNIFIED.ERCOT_TOTAL_MW AS ERCOT_TOTAL_MW 
            WITH SYNONYMS = ('grid load', 'system demand')
            COMMENT = 'Total ERCOT load in MW',
        ERCOT_LOAD_UNIFIED.HOUSTON_SHARE_PCT AS HOUSTON_LOAD_PCT COMMENT = 'Houston share of ERCOT load',
        
        -- Storm impact
        STORM_OUTAGE_IMPACT_ANALYSIS.OUTAGE_COUNT AS STORM_OUTAGE_COUNT COMMENT = 'Outages from storm',
        STORM_OUTAGE_IMPACT_ANALYSIS.TOTAL_CUSTOMER_MINUTES AS STORM_CUSTOMER_MINUTES COMMENT = 'Customer-minutes affected'
    )
    DIMENSIONS (
        HOUSTON_WEATHER_HOURLY.DATE AS WEATHER_DATE COMMENT = 'Date of weather observation',
        HOUSTON_WEATHER_HOURLY.HOUR AS WEATHER_HOUR COMMENT = 'Hour of observation',
        
        WEATHER_STRESS_EVENTS.STRESS_DATE AS STRESS_DATE COMMENT = 'Date of weather stress event',
        WEATHER_STRESS_EVENTS.STRESS_LEVEL AS WEATHER_STRESS_LEVEL 
            WITH SYNONYMS = ('heat level', 'weather severity')
            COMMENT = 'Weather stress level classification',
        
        ERCOT_LMP_UNIFIED.TIMESTAMP AS PRICE_TIMESTAMP COMMENT = 'Timestamp of price',
        ERCOT_LMP_UNIFIED.SETTLEMENT_POINT AS SETTLEMENT_POINT COMMENT = 'ERCOT settlement point',
        
        ERCOT_LOAD_UNIFIED.TIMESTAMP AS LOAD_TIMESTAMP COMMENT = 'Timestamp of load reading',
        
        STORM_OUTAGE_IMPACT_ANALYSIS.STORM_NAME AS STORM_NAME COMMENT = 'Storm name if named',
        STORM_OUTAGE_IMPACT_ANALYSIS.STORM_DATE AS STORM_DATE COMMENT = 'Date of storm'
    )
    METRICS (
        AVERAGE_TEMPERATURE AS AVG(HOUSTON_WEATHER_HOURLY.TEMP_F)
            WITH SYNONYMS = ('avg temp', 'mean temperature')
            COMMENT = 'Average temperature',
        
        MAX_TEMPERATURE AS MAX(HOUSTON_WEATHER_HOURLY.TEMP_F)
            WITH SYNONYMS = ('high temp', 'peak temperature')
            COMMENT = 'Maximum temperature',
        
        AVERAGE_LMP AS AVG(ERCOT_LMP_UNIFIED.LMP_TOTAL)
            WITH SYNONYMS = ('avg price', 'mean LMP')
            COMMENT = 'Average electricity price',
        
        PEAK_LMP AS MAX(ERCOT_LMP_UNIFIED.LMP_TOTAL)
            WITH SYNONYMS = ('max price', 'price spike')
            COMMENT = 'Peak electricity price',
        
        AVERAGE_GRID_LOAD AS AVG(ERCOT_LOAD_UNIFIED.ERCOT_TOTAL_MW)
            WITH SYNONYMS = ('avg demand', 'mean load')
            COMMENT = 'Average ERCOT load',
        
        PEAK_GRID_LOAD AS MAX(ERCOT_LOAD_UNIFIED.ERCOT_TOTAL_MW)
            WITH SYNONYMS = ('max demand', 'peak load')
            COMMENT = 'Peak ERCOT load'
    )
    MODULE_CUSTOM_INSTRUCTIONS (
        SQL_GENERATION (
            QUESTION_CATEGORIZATION = (
                'Weather questions: temperature, humidity, wind, precipitation',
                'Price questions: electricity prices, LMP, energy costs',
                'Demand/Load questions: ERCOT load, peak demand, system load',
                'Storm impact: storm damage, weather-related outages'
            ),
            INSTRUCTIONS = (
                'For Houston zone pricing, filter SETTLEMENT_POINT = HB_HOUSTON',
                'Weather stress: HIGH when temp >95F, EXTREME when >100F',
                'Peak pricing typically occurs during hot summer afternoons',
                'Correlate high temps with high demand and high prices'
            )
        )
    )
    VERIFIED_QUERIES (
        (
            question = 'What is the current ERCOT price for Houston?',
            verified_query = 'SELECT TIMESTAMP, LMP_TOTAL, LMP_ENERGY, LMP_CONGESTION FROM SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED WHERE SETTLEMENT_POINT = ''HB_HOUSTON'' ORDER BY TIMESTAMP DESC LIMIT 1',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What was the peak temperature in July 2025?',
            verified_query = 'SELECT MAX(TEMP_F) as MAX_TEMP_F FROM SI_DEMOS.PRODUCTION.HOUSTON_WEATHER_HOURLY WHERE DATE_TRUNC(''MONTH'', DATE) = ''2025-07-01''',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show average daily price by hour',
            verified_query = 'SELECT HOUR(TIMESTAMP) as HOUR_OF_DAY, AVG(LMP_TOTAL) as AVG_LMP FROM SI_DEMOS.PRODUCTION.ERCOT_LMP_UNIFIED WHERE SETTLEMENT_POINT = ''HB_HOUSTON'' GROUP BY 1 ORDER BY 1',
            use_as_onboarding_question = TRUE
        )
    );


-- =============================================================================
-- VIEW 5: CUSTOMER_ANALYTICS_SEMANTIC_VIEW
-- Domain: Customer data, energy burden, building associations
-- Tables: 4 (within recommended limit)
-- =============================================================================
CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.CUSTOMER_ANALYTICS_SEMANTIC_VIEW
    COMMENT = 'Customer analytics: demographics, energy burden, building types. Use for customer segmentation, affordability analysis, and targeted programs.'
    TABLES (
        SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA 
            PRIMARY KEY (CUSTOMER_ID)
            WITH SYNONYMS = ('CUSTOMERS', 'CUSTOMER_DATA', 'CUSTOMER_MASTER')
            COMMENT = 'Customer master data with demographics and meter associations',
        
        SI_DEMOS.PRODUCTION.ENERGY_BURDEN_ANALYSIS 
            PRIMARY KEY (METER_ID, YEAR, MONTH)
            WITH SYNONYMS = ('AFFORDABILITY', 'ENERGY_BURDEN', 'COST_BURDEN')
            COMMENT = 'Meter-level energy burden analysis with YoY comparison',
        
        SI_DEMOS.PRODUCTION.ENERGY_BURDEN_TRENDS 
            WITH SYNONYMS = ('BURDEN_TRENDS', 'AFFORDABILITY_TRENDS')
            COMMENT = 'Historical energy burden trends by segment',
        
        BUILDING_ASSOCIATIONS AS SI_DEMOS.PRODUCTION.METER_BUILDING_MATCHES 
            PRIMARY KEY (METER_ID, BUILDING_ID)
            WITH SYNONYMS = ('BUILDING_TYPES', 'PROPERTY_TYPES', 'METER_BUILDINGS')
            COMMENT = 'Meter-to-building associations with classification confidence'
    )
    RELATIONSHIPS (
        CUSTOMER_TO_BURDEN AS CUSTOMERS_MASTER_DATA(PRIMARY_METER_ID) REFERENCES ENERGY_BURDEN_ANALYSIS(METER_ID),
        BUILDING_TO_BURDEN AS BUILDING_ASSOCIATIONS(METER_ID) REFERENCES ENERGY_BURDEN_ANALYSIS(METER_ID)
    )
    FACTS (
        -- Energy burden
        ENERGY_BURDEN_ANALYSIS.ANNUAL_ENERGY_BURDEN_PCT AS ENERGY_BURDEN_PCT 
            WITH SYNONYMS = ('affordability', 'cost burden', 'burden percentage')
            COMMENT = 'Energy cost as percentage of income',
        ENERGY_BURDEN_ANALYSIS.ESTIMATED_MONTHLY_BILL_USD AS MONTHLY_BILL_USD COMMENT = 'Estimated monthly bill',
        ENERGY_BURDEN_ANALYSIS.MONTHLY_KWH AS CUSTOMER_MONTHLY_KWH COMMENT = 'Monthly consumption',
        ENERGY_BURDEN_ANALYSIS.CBG_MEDIAN_INCOME AS MEDIAN_INCOME COMMENT = 'Census block group median income',
        
        -- Building associations
        BUILDING_ASSOCIATIONS.CONFIDENCE_SCORE AS CLASSIFICATION_CONFIDENCE 
            WITH SYNONYMS = ('confidence', 'match score')
            COMMENT = 'Building classification confidence (0-100)',
        BUILDING_ASSOCIATIONS.DISTANCE_METERS AS BUILDING_DISTANCE_M COMMENT = 'Distance from meter to building'
    )
    DIMENSIONS (
        CUSTOMERS_MASTER_DATA.CUSTOMER_ID AS CUSTOMER_ID COMMENT = 'Unique customer identifier',
        CUSTOMERS_MASTER_DATA.CUSTOMER_NAME AS CUSTOMER_NAME COMMENT = 'Customer name',
        CUSTOMERS_MASTER_DATA.CUSTOMER_SEGMENT AS CUSTOMER_SEGMENT 
            WITH SYNONYMS = ('segment', 'customer type')
            COMMENT = 'Customer segment (Residential, Commercial, Industrial)',
        CUSTOMERS_MASTER_DATA.SERVICE_ADDRESS AS SERVICE_ADDRESS COMMENT = 'Service address',
        
        ENERGY_BURDEN_ANALYSIS.METER_ID AS BURDEN_METER_ID COMMENT = 'Meter for burden analysis',
        ENERGY_BURDEN_ANALYSIS.YEAR AS BURDEN_YEAR COMMENT = 'Year of burden analysis',
        ENERGY_BURDEN_ANALYSIS.MONTH AS BURDEN_MONTH COMMENT = 'Month of burden analysis',
        ENERGY_BURDEN_ANALYSIS.BURDEN_CATEGORY AS BURDEN_CATEGORY 
            WITH SYNONYMS = ('affordability tier', 'burden level')
            COMMENT = 'Burden category classification',
        
        BUILDING_ASSOCIATIONS.BUILDING_TYPE AS BUILDING_TYPE 
            WITH SYNONYMS = ('property type', 'structure type')
            COMMENT = 'Building type (Residential, Commercial, Industrial)',
        BUILDING_ASSOCIATIONS.BUILDING_SUBTYPE AS BUILDING_SUBTYPE COMMENT = 'Detailed building subtype',
        BUILDING_ASSOCIATIONS.CLASSIFICATION_SOURCE AS CLASSIFICATION_SOURCE 
            WITH SYNONYMS = ('data source', 'confidence source')
            COMMENT = 'Source of classification (HCAD, ML_INFERENCE)'
    )
    METRICS (
        TOTAL_CUSTOMERS AS COUNT(DISTINCT CUSTOMERS_MASTER_DATA.CUSTOMER_ID)
            WITH SYNONYMS = ('customer count', 'number of customers')
            COMMENT = 'Total customer count',
        
        AVERAGE_ENERGY_BURDEN AS AVG(ENERGY_BURDEN_ANALYSIS.ANNUAL_ENERGY_BURDEN_PCT)
            WITH SYNONYMS = ('avg burden', 'mean affordability')
            COMMENT = 'Average energy burden percentage',
        
        HIGH_BURDEN_CUSTOMERS AS COUNT(DISTINCT CASE WHEN ENERGY_BURDEN_ANALYSIS.ANNUAL_ENERGY_BURDEN_PCT > 6 THEN ENERGY_BURDEN_ANALYSIS.METER_ID END)
            WITH SYNONYMS = ('at-risk customers', 'high burden count')
            COMMENT = 'Customers with energy burden >6%',
        
        AVERAGE_MONTHLY_BILL AS AVG(ENERGY_BURDEN_ANALYSIS.ESTIMATED_MONTHLY_BILL_USD)
            WITH SYNONYMS = ('avg bill', 'mean monthly cost')
            COMMENT = 'Average monthly electricity bill'
    )
    MODULE_CUSTOM_INSTRUCTIONS (
        SQL_GENERATION (
            QUESTION_CATEGORIZATION = (
                'Customer profile: customer info, demographics, segments',
                'Energy burden: affordability, cost burden, income-based analysis',
                'Building analysis: building types, property classification',
                'Targeted programs: assistance programs, at-risk customers'
            ),
            INSTRUCTIONS = (
                'Energy burden >6% is considered high burden',
                'HCAD classifications have 98% confidence, ML has 88.5%',
                'For customer outage history, join with RELIABILITY_SEMANTIC_VIEW',
                'Building types: Residential, Commercial, Industrial, Mixed-Use'
            )
        )
    )
    VERIFIED_QUERIES (
        (
            question = 'How many customers are in each segment?',
            verified_query = 'SELECT CUSTOMER_SEGMENT, COUNT(DISTINCT CUSTOMER_ID) as CUSTOMER_COUNT FROM SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA GROUP BY CUSTOMER_SEGMENT ORDER BY CUSTOMER_COUNT DESC',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What percentage of customers have high energy burden?',
            verified_query = 'SELECT COUNT(CASE WHEN ANNUAL_ENERGY_BURDEN_PCT > 6 THEN 1 END) * 100.0 / COUNT(*) as HIGH_BURDEN_PCT FROM SI_DEMOS.PRODUCTION.ENERGY_BURDEN_ANALYSIS WHERE YEAR = 2025',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Show energy burden by building type',
            verified_query = 'SELECT b.BUILDING_TYPE, AVG(e.ANNUAL_ENERGY_BURDEN_PCT) as AVG_BURDEN FROM SI_DEMOS.PRODUCTION.ENERGY_BURDEN_ANALYSIS e JOIN SI_DEMOS.PRODUCTION.METER_BUILDING_MATCHES b ON e.METER_ID = b.METER_ID WHERE e.YEAR = 2025 GROUP BY b.BUILDING_TYPE ORDER BY AVG_BURDEN DESC',
            use_as_onboarding_question = TRUE
        )
    );


-- =============================================================================
-- VIEW 6: MAINTENANCE_VEGETATION_SEMANTIC_VIEW
-- Domain: Work orders, vegetation risk, field operations
-- Tables: 4 (within recommended limit)
-- =============================================================================
CREATE OR REPLACE SEMANTIC VIEW SI_DEMOS.APPLICATIONS.MAINTENANCE_VEGETATION_SEMANTIC_VIEW
    COMMENT = 'Maintenance and vegetation analytics: SAP work orders, vegetation risk, field operations. Use for maintenance planning, vegetation management, and crew scheduling.'
    TABLES (
        SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS 
            PRIMARY KEY (WORK_ORDER_ID)
            WITH SYNONYMS = ('WORK_ORDERS', 'MAINTENANCE_ORDERS', 'FIELD_WORK')
            COMMENT = 'SAP work orders with 250K maintenance records',
        
        SI_DEMOS.PRODUCTION.CIRCUIT_VEGETATION_RISK 
            PRIMARY KEY (CIRCUIT_ID)
            WITH SYNONYMS = ('CIRCUIT_VEG_RISK', 'VEGETATION_RISK', 'TREE_HAZARD')
            COMMENT = 'Circuit-level vegetation risk scores',
        
        SI_DEMOS.PRODUCTION.VEGETATION_TRANSFORMER_RISK 
            PRIMARY KEY (TREE_ID)
            WITH SYNONYMS = ('TRANSFORMER_VEG_RISK', 'TREE_TRANSFORMER_PROXIMITY')
            COMMENT = 'Tree-to-transformer proximity risk',
        
        SI_DEMOS.PRODUCTION.VEGETATION_POWER_LINE_RISK 
            PRIMARY KEY (TREE_ID)
            WITH SYNONYMS = ('LINE_VEG_RISK', 'TREE_LINE_PROXIMITY', 'ROW_CLEARANCE')
            COMMENT = 'Tree-to-power-line proximity risk'
    )
    RELATIONSHIPS (
        VEG_TO_CIRCUIT AS CIRCUIT_VEGETATION_RISK(CIRCUIT_ID) REFERENCES CIRCUIT_VEGETATION_RISK(CIRCUIT_ID),
        TREE_XFMR_TO_CIRCUIT AS VEGETATION_TRANSFORMER_RISK(CIRCUIT_ID) REFERENCES CIRCUIT_VEGETATION_RISK(CIRCUIT_ID)
    )
    FACTS (
        -- Work order facts
        SAP_WORK_ORDERS.ESTIMATED_COST_USD AS ESTIMATED_COST 
            WITH SYNONYMS = ('planned cost', 'budget')
            COMMENT = 'Estimated work order cost',
        SAP_WORK_ORDERS.ACTUAL_COST_USD AS ACTUAL_COST 
            WITH SYNONYMS = ('final cost', 'real cost')
            COMMENT = 'Actual work order cost',
        SAP_WORK_ORDERS.LABOR_HOURS AS LABOR_HOURS COMMENT = 'Labor hours',
        SAP_WORK_ORDERS.SERVICE_LAT AS WORK_LOCATION_LAT COMMENT = 'Work location latitude',
        SAP_WORK_ORDERS.SERVICE_LON AS WORK_LOCATION_LON COMMENT = 'Work location longitude',
        
        -- Circuit vegetation
        CIRCUIT_VEGETATION_RISK.VEGETATION_RISK_SCORE AS CIRCUIT_VEG_RISK_SCORE 
            WITH SYNONYMS = ('circuit risk', 'vegetation score')
            COMMENT = 'Circuit vegetation risk score (0-100)',
        CIRCUIT_VEGETATION_RISK.HIGH_RISK_TREE_COUNT AS CIRCUIT_HIGH_RISK_TREES COMMENT = 'High risk trees on circuit',
        
        -- Tree-transformer risk
        VEGETATION_TRANSFORMER_RISK.DISTANCE_METERS AS TREE_TRANSFORMER_DISTANCE_M 
            WITH SYNONYMS = ('proximity', 'clearance')
            COMMENT = 'Distance from tree to transformer',
        VEGETATION_TRANSFORMER_RISK.RISK_SCORE AS TREE_TRANSFORMER_RISK_SCORE COMMENT = 'Tree-transformer risk score',
        
        -- Tree-line risk
        VEGETATION_POWER_LINE_RISK.DISTANCE_TO_LINE_METERS AS TREE_LINE_DISTANCE_M COMMENT = 'Distance to power line',
        VEGETATION_POWER_LINE_RISK.RISK_SCORE AS TREE_LINE_RISK_SCORE COMMENT = 'Tree-line risk score'
    )
    DIMENSIONS (
        -- Work order dimensions
        SAP_WORK_ORDERS.WORK_ORDER_ID AS WORK_ORDER_ID COMMENT = 'Work order identifier',
        SAP_WORK_ORDERS.SAP_ORDER_NUMBER AS SAP_ORDER_NUMBER COMMENT = 'SAP system order number',
        SAP_WORK_ORDERS.WORK_TYPE AS WORK_TYPE 
            WITH SYNONYMS = ('maintenance type', 'order type')
            COMMENT = 'Type: PREVENTIVE, CORRECTIVE, EMERGENCY, INSPECTION',
        SAP_WORK_ORDERS.WORK_ORDER_STATUS AS WORK_ORDER_STATUS 
            WITH SYNONYMS = ('status', 'order status')
            COMMENT = 'Work order status',
        SAP_WORK_ORDERS.PRIORITY AS WORK_PRIORITY 
            WITH SYNONYMS = ('urgency', 'priority level')
            COMMENT = 'Priority: EMERGENCY, HIGH, MEDIUM, LOW',
        SAP_WORK_ORDERS.ASSIGNED_CREW_ID AS CREW_ID COMMENT = 'Assigned crew',
        SAP_WORK_ORDERS.CREATED_DATE AS CREATED_DATE COMMENT = 'Creation date',
        SAP_WORK_ORDERS.SCHEDULED_START_DATE AS SCHEDULED_DATE COMMENT = 'Scheduled start',
        SAP_WORK_ORDERS.ACTUAL_COMPLETION_DATE AS COMPLETION_DATE COMMENT = 'Completion date',
        
        -- Vegetation dimensions
        CIRCUIT_VEGETATION_RISK.CIRCUIT_ID AS VEG_CIRCUIT_ID COMMENT = 'Circuit with vegetation risk',
        
        VEGETATION_TRANSFORMER_RISK.TREE_ID AS XFMR_TREE_ID COMMENT = 'Tree near transformer',
        VEGETATION_TRANSFORMER_RISK.TRANSFORMER_ID AS AT_RISK_TRANSFORMER_ID COMMENT = 'Transformer with tree risk',
        VEGETATION_TRANSFORMER_RISK.VEGETATION_RISK_LEVEL AS XFMR_VEG_RISK_LEVEL COMMENT = 'Risk level category',
        
        VEGETATION_POWER_LINE_RISK.TREE_ID AS LINE_TREE_ID COMMENT = 'Tree near power line',
        VEGETATION_POWER_LINE_RISK.LINE_CLASS AS POWER_LINE_CLASS COMMENT = 'Line class',
        VEGETATION_POWER_LINE_RISK.VEGETATION_RISK_LEVEL AS LINE_VEG_RISK_LEVEL COMMENT = 'Risk level'
    )
    METRICS (
        TOTAL_WORK_ORDERS AS COUNT(DISTINCT SAP_WORK_ORDERS.WORK_ORDER_ID)
            WITH SYNONYMS = ('order count', 'work order total')
            COMMENT = 'Total work orders',
        
        TOTAL_MAINTENANCE_COST AS SUM(SAP_WORK_ORDERS.ACTUAL_COST_USD)
            WITH SYNONYMS = ('total cost', 'maintenance spend')
            COMMENT = 'Total actual maintenance cost',
        
        AVERAGE_WORK_ORDER_COST AS AVG(SAP_WORK_ORDERS.ACTUAL_COST_USD)
            WITH SYNONYMS = ('avg cost', 'mean order cost')
            COMMENT = 'Average cost per work order',
        
        TOTAL_LABOR_HOURS AS SUM(SAP_WORK_ORDERS.LABOR_HOURS)
            WITH SYNONYMS = ('total hours', 'crew hours')
            COMMENT = 'Total labor hours',
        
        HIGH_RISK_CIRCUITS AS COUNT(DISTINCT CASE WHEN CIRCUIT_VEGETATION_RISK.VEGETATION_RISK_SCORE > 70 THEN CIRCUIT_VEGETATION_RISK.CIRCUIT_ID END)
            WITH SYNONYMS = ('at-risk circuits', 'priority circuits')
            COMMENT = 'Circuits with high vegetation risk',
        
        CRITICAL_TREES AS COUNT(DISTINCT CASE WHEN VEGETATION_TRANSFORMER_RISK.VEGETATION_RISK_LEVEL = 'CRITICAL' THEN VEGETATION_TRANSFORMER_RISK.TREE_ID END)
            WITH SYNONYMS = ('hazard trees', 'priority trees')
            COMMENT = 'Trees requiring immediate attention'
    )
    MODULE_CUSTOM_INSTRUCTIONS (
        SQL_GENERATION (
            QUESTION_CATEGORIZATION = (
                'Work order questions: maintenance, work orders, costs, crews',
                'Vegetation risk: tree hazards, vegetation management, clearance',
                'Field operations: scheduling, crew assignments, locations'
            ),
            INSTRUCTIONS = (
                'For maintenance analytics, use SAP_WORK_ORDERS',
                'CRITICAL vegetation risk trees need immediate trimming',
                'Correlate high vegetation risk circuits with outage data',
                'Work types: PREVENTIVE, CORRECTIVE, EMERGENCY, INSPECTION'
            )
        )
    )
    VERIFIED_QUERIES (
        (
            question = 'How many open work orders by priority?',
            verified_query = 'SELECT PRIORITY, COUNT(*) as ORDER_COUNT FROM SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS WHERE WORK_ORDER_STATUS NOT IN (''COMPLETED'', ''CANCELLED'') GROUP BY PRIORITY ORDER BY CASE PRIORITY WHEN ''EMERGENCY'' THEN 1 WHEN ''HIGH'' THEN 2 WHEN ''MEDIUM'' THEN 3 ELSE 4 END',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'What is the total maintenance cost by work type?',
            verified_query = 'SELECT WORK_TYPE, COUNT(*) as ORDERS, SUM(ACTUAL_COST_USD) as TOTAL_COST FROM SI_DEMOS.PRODUCTION.SAP_WORK_ORDERS WHERE ACTUAL_COST_USD IS NOT NULL GROUP BY WORK_TYPE ORDER BY TOTAL_COST DESC',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'Which circuits have highest vegetation risk?',
            verified_query = 'SELECT CIRCUIT_ID, CIRCUIT_NAME, VEGETATION_RISK_SCORE, HIGH_RISK_TREE_COUNT FROM SI_DEMOS.PRODUCTION.CIRCUIT_VEGETATION_RISK ORDER BY VEGETATION_RISK_SCORE DESC LIMIT 10',
            use_as_onboarding_question = TRUE
        ),
        (
            question = 'How many trees are near transformers by risk level?',
            verified_query = 'SELECT VEGETATION_RISK_LEVEL, COUNT(*) as TREE_COUNT, AVG(DISTANCE_METERS) as AVG_DISTANCE_M FROM SI_DEMOS.PRODUCTION.VEGETATION_TRANSFORMER_RISK GROUP BY VEGETATION_RISK_LEVEL ORDER BY CASE VEGETATION_RISK_LEVEL WHEN ''CRITICAL'' THEN 1 WHEN ''HIGH'' THEN 2 WHEN ''MEDIUM'' THEN 3 ELSE 4 END',
            use_as_onboarding_question = TRUE
        )
    );


-- =============================================================================
-- Verify all semantic views were created
-- =============================================================================
SHOW SEMANTIC VIEWS IN SCHEMA SI_DEMOS.APPLICATIONS;
