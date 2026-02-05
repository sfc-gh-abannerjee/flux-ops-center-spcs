-- =============================================================================
-- Compliance Documents Sample Data
-- =============================================================================
-- This file contains sample NERC/ERCOT compliance documents for the 
-- Grid Intelligence Agent's Compliance Search feature.
--
-- Usage:
--   snow sql -f data/cortex_search_data/compliance_docs.sql \
--       -D "database=FLUX_DB" -c your_connection_name
-- =============================================================================

USE DATABASE IDENTIFIER('<% database %>');
USE SCHEMA ML_DEMO;

-- Create the compliance docs table if it doesn't exist
CREATE TABLE IF NOT EXISTS COMPLIANCE_DOCS (
    DOC_ID VARCHAR(50) PRIMARY KEY,
    DOC_TYPE VARCHAR(100),
    TITLE VARCHAR(500),
    CONTENT VARCHAR(16777216),
    CATEGORY VARCHAR(100),
    EFFECTIVE_DATE DATE,
    REVISION VARCHAR(50),
    APPLICABILITY VARCHAR(16777216),
    KEYWORDS VARCHAR(16777216),
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Insert compliance documents
INSERT INTO COMPLIANCE_DOCS (DOC_ID, DOC_TYPE, TITLE, CONTENT, CATEGORY, EFFECTIVE_DATE, REVISION, APPLICABILITY, KEYWORDS)
VALUES
('NERC-TPL-001-5.1', 'Reliability Standard', 'Transmission System Planning Performance Requirements',
'Purpose: Establish Transmission system planning performance requirements within the planning horizon to develop a Bulk Electric System (BES) that will operate reliably over a broad spectrum of System conditions and following a wide range of probable Contingencies.

Requirements:
R1. Each Planning Coordinator and Transmission Planner shall maintain System models for performing the studies needed to complete the Transmission System Planning assessments.
R2. Each Planning Coordinator and Transmission Planner shall perform assessments of the Transmission system performance.
R3. For the steady state portion of the Planning Assessment, each Transmission Planner and Planning Coordinator shall perform studies for the planning events.

Cascade Prevention Requirements:
- System must maintain stability following N-1 contingencies
- System must demonstrate acceptable performance for multiple facility outages (N-1-1)
- Cascading shall not occur for any single Contingency
- Thermal limits, voltage limits, and stability limits must not be exceeded

Violation Risk Factor: High
Time Horizon: Long-term Planning',
'Transmission Planning', '2024-01-01', '5.1', 
'Transmission Planners, Planning Coordinators, Transmission Operators',
'cascade prevention, N-1 contingency, transmission planning, system stability'),

('NERC-FAC-001-3', 'Reliability Standard', 'Facility Interconnection Requirements',
'Purpose: To avoid adverse impacts on the reliability of the Bulk Electric System at or beyond the Point of Interconnection.

Requirements for Cascade Prevention:
R1. Each Transmission Owner shall document, maintain, and publish Facility interconnection requirements for generation and transmission Facilities.
R2. Interconnection requirements must address:
- Power factor design criteria
- Voltage regulation requirements
- Fault current capability
- System protection requirements
- Metering requirements

Cascade Protection Requirements:
- Adequate fault clearing capability to prevent cascade propagation
- Proper coordination of protection systems between interconnected systems
- Real-time monitoring of interconnection flows
- Automatic under-frequency load shedding schemes

Violation Risk Factor: Medium
Time Horizon: Operations Planning, Same-day Operations',
'Facility Design', '2023-07-01', '3',
'Transmission Owners, Generator Owners',
'interconnection, fault clearing, protection coordination, cascade prevention'),

('NERC-TOP-001-5', 'Reliability Standard', 'Transmission Operations',
'Purpose: To prevent instability, uncontrolled separation, or Cascading outages that adversely impact the reliability of the Interconnection.

Real-Time Cascade Prevention Requirements:
R1. Each Transmission Operator shall perform operational planning analysis.
R2. Each Transmission Operator shall monitor its Transmission Operator Area to ensure that:
- System Operating Limits and Interconnection Reliability Operating Limits are not exceeded
- Real and Reactive Power flows are within operational limits
- Voltage profiles are maintained within acceptable ranges

R3. Operators must take corrective action when anticipating or experiencing:
- Equipment overloads
- Abnormal frequency conditions  
- Voltage deviations outside acceptable range
- Imminent cascading conditions

Emergency Procedures:
- Implement load shedding when necessary to prevent cascade
- Coordinate with neighboring Transmission Operators
- Restore system to normal operation as quickly as safely possible

Violation Risk Factor: High
Time Horizon: Real-time Operations, Same-day Operations',
'System Operations', '2024-04-01', '5',
'Transmission Operators, Reliability Coordinators',
'real-time operations, system limits, load shedding, cascade prevention'),

('NERC-EOP-011-3', 'Reliability Standard', 'Emergency Operations',
'Purpose: To address capacity and energy emergencies and to minimize impacts to the Interconnection.

Emergency Levels for Cascade Risk:
- Energy Emergency Alert Level 1 (EEA1): All resources in use, operating reserves may be below required minimum
- Energy Emergency Alert Level 2 (EEA2): Load management procedures in effect
- Energy Emergency Alert Level 3 (EEA3): Firm load interruption imminent or in progress

Cascade Prevention During Emergencies:
R1. Each Balancing Authority shall have an Operating Plan to mitigate capacity and energy emergencies.
R2. Operating Plan must include:
- Notification procedures to Reliability Coordinator
- Criteria for declaring emergency alerts
- Load reduction procedures (voluntary and mandatory)
- Capacity reserve sharing arrangements

Automatic Load Shedding:
- Under-frequency load shedding (UFLS) programs activated at specific frequency thresholds
- Under-voltage load shedding (UVLS) for voltage collapse prevention
- Coordinated with neighboring systems to prevent cascading outages

Violation Risk Factor: High
Time Horizon: Emergency Operations',
'Emergency Operations', '2023-10-01', '3',
'Balancing Authorities, Transmission Operators',
'emergency operations, load shedding, UFLS, UVLS, cascade prevention'),

('NERC-PRC-006-5', 'Reliability Standard', 'Automatic Underfrequency Load Shedding',
'Purpose: To establish design and documentation requirements for automatic underfrequency load shedding (UFLS) programs to arrest declining frequency, assist recovery of frequency following underfrequency events, and provide last resort system preservation measures.

UFLS Requirements for Cascade Prevention:
R1. Each Planning Coordinator shall develop and document a UFLS program.
R2. The UFLS program shall:
- Arrest frequency decline within the Interconnection
- Be coordinated with neighboring Planning Coordinators
- Include automatic time-delayed underfrequency island detection

Load Shedding Frequency Thresholds (typical):
- 59.5 Hz: First stage (5% load shed)
- 59.0 Hz: Second stage (10% load shed)  
- 58.5 Hz: Third stage (15% load shed)
- Below 58.5 Hz: Additional stages as required

Cascade Interruption Strategy:
- Rapid load reduction to arrest frequency decline
- Islanding detection to prevent cascading into healthy areas
- Automatic restoration when frequency recovers

Violation Risk Factor: High
Time Horizon: Long-term Planning',
'Protection Systems', '2024-01-01', '5',
'Planning Coordinators, Transmission Planners, Distribution Providers',
'UFLS, underfrequency, load shedding, cascade arrest'),

('NERC-PRC-023-6', 'Reliability Standard', 'Transmission Relay Loadability',
'Purpose: To ensure that transmission relays are set such that they do not limit transmission loadability and do not inadvertently trip during recoverable system conditions.

Relay Coordination for Cascade Prevention:
R1. Transmission Owners shall set relays so they do not trip during recoverable transients.
R2. Relays must remain in service during:
- Stable power swings
- Dynamic transfers
- Temporary overloads within equipment ratings

Protective Relay Requirements:
- Phase distance relays must not restrict circuit loadability
- Ground distance relays must coordinate properly
- Overcurrent relays must allow emergency loading
- Communication-aided schemes must be properly coordinated

Anti-Cascade Relay Features:
- Out-of-step blocking to prevent tripping on power swings
- Load encroachment logic to prevent spurious trips
- Fault type discrimination to prevent sympathetic tripping
- Breaker failure protection with proper coordination

Violation Risk Factor: High
Time Horizon: Real-time Operations, Long-term Planning',
'Protection Systems', '2023-07-01', '6',
'Transmission Owners, Generator Owners',
'relay settings, protection coordination, power swings, cascade prevention'),

('ERCOT-OP-01', 'Operating Procedure', 'ERCOT Grid Operations for Extreme Weather',
'Purpose: Provide operational guidance for managing the ERCOT grid during extreme weather events that may cause cascading failures.

Winter Storm Procedures (Lessons from Uri 2021):
1. Pre-Event Preparation:
   - Review weatherization status of generation facilities
   - Pre-position operating reserves above normal levels
   - Coordinate with natural gas pipeline operators
   - Prepare load shedding rotation schedules

2. During Event Operations:
   - Monitor generation availability hourly
   - Track natural gas curtailments to generators
   - Implement controlled rotating outages if necessary
   - Maintain system frequency above 59.4 Hz

3. Cascade Prevention Measures:
   - Island formation if interconnection becomes unstable
   - Automatic generator tripping to prevent damage
   - Load shedding to match available generation
   - Priority restoration to critical infrastructure

Summer Heat Wave Procedures:
1. Monitor transformer loading and enable cooling
2. Curtail non-essential load during peak hours
3. Activate demand response programs
4. Request emergency energy from neighboring regions

Critical Infrastructure Priority:
1. Hospitals and medical facilities
2. Water treatment plants
3. Emergency services (police, fire, 911)
4. Natural gas compressor stations
5. Telecommunications hubs',
'Operating Procedures', '2024-03-01', '2024.1',
'ERCOT Control Room Operators, QSEs, Transmission Operators',
'extreme weather, winter storm, heat wave, load shedding, cascade prevention'),

('CNP-STD-001', 'Internal Standard', 'CenterPoint Energy Transformer Loading Standards',
'Purpose: Establish loading limits and monitoring requirements for distribution transformers to prevent thermal damage and cascading failures.

Normal Loading Limits:
- Residential transformers: 100% nameplate for continuous operation
- Commercial transformers: 100% nameplate for continuous operation
- Industrial transformers: Per customer agreement

Emergency Loading Limits:
- Up to 120% for 4 hours maximum (with enhanced monitoring)
- Up to 140% for 30 minutes (emergency only)
- Above 140%: Immediate load reduction required

Temperature Monitoring Thresholds:
- Hot spot temperature alarm: 110C
- Hot spot temperature trip: 130C
- Top oil temperature alarm: 95C
- Top oil temperature trip: 105C

Cascade Prevention Requirements:
1. Transformers exceeding 90% load for >2 hours require investigation
2. Adjacent transformer loading must be monitored when one unit fails
3. Automatic load transfer schemes must be tested annually
4. Mobile transformer deployment criteria established

Summer Peak Procedures:
- Pre-position mobile transformers in high-risk areas
- Enable enhanced oil cooling systems
- Monitor thermal stress accumulation
- Coordinate with ERCOT for system-wide conditions

Violation of these standards may result in equipment damage and potential cascading outages affecting customer service.',
'Internal Standards', '2024-01-15', '2024.1',
'Distribution Operations, Engineering, Planning',
'transformer loading, thermal limits, summer peak, cascade prevention')

ON CONFLICT (DOC_ID) DO NOTHING;

SELECT 'Loaded ' || COUNT(*) || ' compliance documents' AS STATUS FROM COMPLIANCE_DOCS;
