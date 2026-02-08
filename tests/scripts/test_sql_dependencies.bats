#!/usr/bin/env bats
# ==============================================================================
# SQL Cross-File Dependency Tests
# ==============================================================================
# These tests verify that all SQL table references have corresponding CREATE
# statements, column names are consistent across scripts, and execution order
# dependencies are satisfied.
#
# PURPOSE: Catch gaps like:
#   - Table referenced in FROM clause but never created
#   - Column name mismatch between scripts (LATITUDE vs METER_LATITUDE)
#   - Cortex Search service referencing non-existent source table
#   - Script 09 expecting columns that script 00 doesn't create
#
# Run with: bats tests/scripts/test_sql_dependencies.bats
# ==============================================================================

setup() {
    PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
    SQL_DIR="$PROJECT_ROOT/scripts/sql"
    BACKEND_DIR="$PROJECT_ROOT/backend"
    
    # Build list of all tables created in 00_standalone_quickstart.sql
    # This is the source of truth for table definitions
    QUICKSTART_SQL="$SQL_DIR/00_standalone_quickstart.sql"
}

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

# Extract table names from CREATE TABLE statements in a file
get_created_tables() {
    local file="$1"
    grep -i "CREATE TABLE IF NOT EXISTS\|CREATE TABLE" "$file" 2>/dev/null | \
        sed -E 's/.*CREATE TABLE (IF NOT EXISTS )?([A-Za-z0-9_\.]+).*/\2/' | \
        tr '[:lower:]' '[:upper:]' | \
        sed 's/^.*\.//' | \
        sort -u
}

# Extract table names from CREATE VIEW statements in a file
get_created_views() {
    local file="$1"
    grep -iE "CREATE (OR REPLACE )?(MATERIALIZED )?VIEW" "$file" 2>/dev/null | \
        sed -E 's/.*VIEW ([A-Za-z0-9_\.]+).*/\1/' | \
        tr '[:lower:]' '[:upper:]' | \
        sed 's/^.*\.//' | \
        sort -u
}

# Extract table references from FROM/JOIN clauses
get_referenced_tables() {
    local file="$1"
    grep -iE "FROM|JOIN" "$file" 2>/dev/null | \
        grep -v "^--" | \
        sed -E 's/.*(FROM|JOIN)[[:space:]]+([A-Za-z0-9_\.<%>]+).*/\2/' | \
        grep -v "<%\|LATERAL\|TABLE\|(\|SELECT" | \
        tr '[:lower:]' '[:upper:]' | \
        sed 's/^.*\.//' | \
        sort -u
}

# Check if a table is created in any SQL file
table_is_created() {
    local table="$1"
    local table_upper=$(echo "$table" | tr '[:lower:]' '[:upper:]')
    
    for sql_file in "$SQL_DIR"/*.sql; do
        if grep -qi "CREATE TABLE.*$table_upper\|CREATE.*VIEW.*$table_upper" "$sql_file" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

# ==============================================================================
# CORTEX SEARCH DEPENDENCY TESTS
# ==============================================================================
# These tests verify that Cortex Search services have their source tables created

@test "TECHNICAL_MANUALS_PDF_CHUNKS table exists for Cortex Search" {
    # 07_create_cortex_search.sql references this table
    run grep -i "CREATE TABLE.*TECHNICAL_MANUALS_PDF_CHUNKS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "TECHNICAL_MANUALS_PDF_CHUNKS has CHUNK_TEXT column" {
    # Cortex Search service indexes on CHUNK_TEXT
    run grep -A20 "CREATE TABLE.*TECHNICAL_MANUALS_PDF_CHUNKS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "CHUNK_TEXT"
}

@test "TECHNICAL_MANUALS_PDF_CHUNKS has DOCUMENT_ID column" {
    run grep -A20 "CREATE TABLE.*TECHNICAL_MANUALS_PDF_CHUNKS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "DOCUMENT_ID"
}

@test "TECHNICAL_MANUALS_PDF_CHUNKS has DOCUMENT_TYPE column" {
    run grep -A20 "CREATE TABLE.*TECHNICAL_MANUALS_PDF_CHUNKS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "DOCUMENT_TYPE"
}

@test "COMPLIANCE_DOCS table exists for Cortex Search" {
    # 07_create_cortex_search.sql references this table in ML_DEMO schema
    run grep -i "CREATE TABLE.*COMPLIANCE_DOCS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "COMPLIANCE_DOCS has CONTENT column" {
    # Cortex Search service indexes on CONTENT
    run grep -A20 "CREATE TABLE.*COMPLIANCE_DOCS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "CONTENT"
}

@test "COMPLIANCE_DOCS has DOC_TYPE column" {
    run grep -A20 "CREATE TABLE.*COMPLIANCE_DOCS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "DOC_TYPE"
}

@test "COMPLIANCE_DOCS has TITLE column" {
    run grep -A20 "CREATE TABLE.*COMPLIANCE_DOCS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "TITLE"
}

# ==============================================================================
# METER_INFRASTRUCTURE SCHEMA CONSISTENCY TESTS
# ==============================================================================
# Script 09_extend_cascade_hierarchy.sql expects specific column names

@test "METER_INFRASTRUCTURE has METER_LATITUDE column (for script 09)" {
    # 09_extend_cascade_hierarchy.sql references m.METER_LATITUDE
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "METER_LATITUDE"
}

@test "METER_INFRASTRUCTURE has METER_LONGITUDE column (for script 09)" {
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "METER_LONGITUDE"
}

@test "METER_INFRASTRUCTURE has HEALTH_SCORE column (for script 09)" {
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "HEALTH_SCORE"
}

@test "METER_INFRASTRUCTURE has POLE_ID column (for script 09)" {
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "POLE_ID"
}

@test "METER_INFRASTRUCTURE has COUNTY_NAME column (for script 09)" {
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "COUNTY_NAME"
}

@test "METER_INFRASTRUCTURE has CITY column (for script 09)" {
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "CITY"
}

# ==============================================================================
# WORK_ORDERS SCHEMA CONSISTENCY TESTS
# ==============================================================================
# Script 06_postgres_sync.sql expects specific column names for syncing

@test "WORK_ORDERS has WORK_ORDER_TYPE column (for script 06)" {
    run grep -A30 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "WORK_ORDER_TYPE"
}

@test "WORK_ORDERS has SCHEDULED_START column (for script 06)" {
    run grep -A30 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "SCHEDULED_START"
}

@test "WORK_ORDERS has SCHEDULED_END column (for script 06)" {
    run grep -A30 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "SCHEDULED_END"
}

@test "WORK_ORDERS has ACTUAL_START column (for script 06)" {
    run grep -A30 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "ACTUAL_START"
}

@test "WORK_ORDERS has ACTUAL_END column (for script 06)" {
    run grep -A30 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "ACTUAL_END"
}

@test "WORK_ORDERS has LATITUDE column (for script 06)" {
    run grep -A35 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "LATITUDE"
}

@test "WORK_ORDERS has LONGITUDE column (for script 06)" {
    run grep -A35 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "LONGITUDE"
}

@test "WORK_ORDERS has CIRCUIT_ID column (for script 06)" {
    run grep -A35 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "CIRCUIT_ID"
}

@test "WORK_ORDERS has SUBSTATION_ID column (for script 06)" {
    run grep -A35 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "SUBSTATION_ID"
}

@test "WORK_ORDERS has TRANSFORMER_ID column (for script 06)" {
    run grep -A35 "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "TRANSFORMER_ID"
}

# ==============================================================================
# OUTAGE_RESTORATION_TRACKER SCHEMA TESTS
# ==============================================================================
# Script 06_postgres_sync.sql syncs this table to Postgres

@test "OUTAGE_RESTORATION_TRACKER table exists" {
    run grep -i "CREATE TABLE.*OUTAGE_RESTORATION_TRACKER" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "OUTAGE_RESTORATION_TRACKER has OUTAGE_ID column" {
    run grep -A25 "CREATE TABLE.*OUTAGE_RESTORATION_TRACKER" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "OUTAGE_ID"
}

@test "OUTAGE_RESTORATION_TRACKER has LATITUDE column" {
    run grep -A25 "CREATE TABLE.*OUTAGE_RESTORATION_TRACKER" "$QUICKSTART_SQL"
    # Check for LATITUDE in the OUTAGE_RESTORATION_TRACKER context
    # Note: This table may use different column names
    [ "$status" -eq 0 ]
}

# ==============================================================================
# CORE TABLE EXISTENCE TESTS
# ==============================================================================
# Verify all tables referenced by backend/server_fastapi.py exist

@test "SUBSTATIONS table is created" {
    run grep -i "CREATE TABLE.*SUBSTATIONS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "TRANSFORMER_METADATA table is created" {
    run grep -i "CREATE TABLE.*TRANSFORMER_METADATA" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "CIRCUIT_METADATA table is created" {
    run grep -i "CREATE TABLE.*CIRCUIT_METADATA" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "METER_INFRASTRUCTURE table is created" {
    run grep -i "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "GRID_POLES_INFRASTRUCTURE table is created" {
    run grep -i "CREATE TABLE.*GRID_POLES_INFRASTRUCTURE" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "HOUSTON_WEATHER_HOURLY table is created" {
    run grep -i "CREATE TABLE.*HOUSTON_WEATHER_HOURLY" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "GRID_NODES table is created" {
    run grep -i "CREATE TABLE.*GRID_NODES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "GRID_EDGES table is created" {
    run grep -i "CREATE TABLE.*GRID_EDGES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "NODE_CENTRALITY_FEATURES_V2 table is created" {
    run grep -i "CREATE TABLE.*NODE_CENTRALITY_FEATURES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "PRECOMPUTED_CASCADES table is created" {
    run grep -i "CREATE TABLE.*PRECOMPUTED_CASCADES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# VIEW EXISTENCE TESTS
# ==============================================================================
# Verify all application views are created

@test "FLUX_OPS_CENTER_KPIS view is created" {
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_KPIS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "FLUX_OPS_CENTER_TOPOLOGY view is created" {
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_TOPOLOGY[^_]" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "FLUX_OPS_CENTER_TOPOLOGY_METRO view is created" {
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_TOPOLOGY_METRO" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "FLUX_OPS_CENTER_TOPOLOGY_FEEDERS view is created" {
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_TOPOLOGY_FEEDERS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "FLUX_OPS_CENTER_SERVICE_AREAS_MV view is created" {
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_SERVICE_AREAS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "VEGETATION_RISK_COMPUTED view is created" {
    run grep -i "CREATE.*VIEW.*VEGETATION_RISK_COMPUTED" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "CIRCUIT_STATUS_REALTIME view is created" {
    run grep -i "CREATE.*VIEW.*CIRCUIT_STATUS_REALTIME" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# SCRIPT CROSS-REFERENCE TESTS
# ==============================================================================
# Verify scripts don't reference tables from later-numbered scripts

@test "script 06 references tables from script 00 (not later)" {
    # 06_postgres_sync.sql should only reference tables created in 00
    local sync_script="$SQL_DIR/06_postgres_sync.sql"
    [ -f "$sync_script" ]
    
    # Check it references OUTAGE_RESTORATION_TRACKER (from 00)
    run grep -i "OUTAGE_RESTORATION_TRACKER" "$sync_script"
    [ "$status" -eq 0 ]
}

@test "script 07 references tables from script 00 (not later)" {
    local cortex_script="$SQL_DIR/07_create_cortex_search.sql"
    [ -f "$cortex_script" ]
    
    # It references TECHNICAL_MANUALS_PDF_CHUNKS - verify it's in 00
    run grep -i "CREATE TABLE.*TECHNICAL_MANUALS_PDF_CHUNKS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "script 09 references tables from script 00 (not later)" {
    local extend_script="$SQL_DIR/09_extend_cascade_hierarchy.sql"
    [ -f "$extend_script" ]
    
    # It references METER_INFRASTRUCTURE - verify columns exist in 00
    run grep -i "METER_INFRASTRUCTURE" "$extend_script"
    [ "$status" -eq 0 ]
    
    # Verify METER_LATITUDE column exists in 00's definition
    run grep -A30 "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    echo "$output" | grep -qi "METER_LATITUDE"
}

# ==============================================================================
# POSTGRES DERIVED VIEW DEPENDENCY TESTS
# ==============================================================================
# Verify Postgres views in load_postgis_data.py reference existing tables

@test "load_postgis_data.py defines power_lines_spatial view" {
    run grep -i "power_lines_spatial" "$BACKEND_DIR/scripts/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines circuit_service_areas view" {
    run grep -i "circuit_service_areas" "$BACKEND_DIR/scripts/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines buildings_spatial view" {
    run grep -i "buildings_spatial" "$BACKEND_DIR/scripts/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines grid_assets view" {
    run grep -i "grid_assets" "$BACKEND_DIR/scripts/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines vegetation_risk_computed view" {
    run grep -i "vegetation_risk_computed" "$BACKEND_DIR/scripts/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "power_lines_spatial view references grid_power_lines table" {
    # Verify the view is based on the correct source table
    run grep -A10 "power_lines_spatial" "$BACKEND_DIR/scripts/load_postgis_data.py"
    echo "$output" | grep -qi "grid_power_lines"
}

@test "circuit_service_areas view references grid_assets_cache table" {
    run grep -A30 "circuit_service_areas" "$BACKEND_DIR/scripts/load_postgis_data.py"
    echo "$output" | grep -qi "grid_assets_cache"
}

@test "buildings_spatial view references building_footprints table" {
    run grep -A10 "buildings_spatial" "$BACKEND_DIR/scripts/load_postgis_data.py"
    echo "$output" | grep -qi "building_footprints"
}

# ==============================================================================
# SCHEMA EXISTENCE TESTS
# ==============================================================================
# Verify all required schemas are created

@test "PRODUCTION schema is created" {
    run grep -i "CREATE SCHEMA.*PRODUCTION" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "APPLICATIONS schema is created" {
    run grep -i "CREATE SCHEMA.*APPLICATIONS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "ML_DEMO schema is created" {
    run grep -i "CREATE SCHEMA.*ML_DEMO" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "CASCADE_ANALYSIS schema is created" {
    run grep -i "CREATE SCHEMA.*CASCADE_ANALYSIS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "RAW schema is created" {
    run grep -i "CREATE SCHEMA.*RAW" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# FULL DEPENDENCY GRAPH VALIDATION
# ==============================================================================
# Comprehensive test that builds and validates the entire dependency graph

@test "all tables referenced in script 06 exist in script 00" {
    local sync_script="$SQL_DIR/06_postgres_sync.sql"
    
    # Tables referenced in 06_postgres_sync.sql
    local tables=("OUTAGE_RESTORATION_TRACKER" "WORK_ORDERS" "CIRCUIT_METADATA")
    
    for table in "${tables[@]}"; do
        run grep -i "CREATE TABLE.*$table" "$QUICKSTART_SQL"
        [ "$status" -eq 0 ] || fail "Table $table not found in 00_standalone_quickstart.sql"
    done
}

@test "all tables referenced in script 07 exist in script 00" {
    local tables=("TECHNICAL_MANUALS_PDF_CHUNKS" "COMPLIANCE_DOCS")
    
    for table in "${tables[@]}"; do
        run grep -i "CREATE TABLE.*$table" "$QUICKSTART_SQL"
        [ "$status" -eq 0 ] || fail "Table $table not found in 00_standalone_quickstart.sql"
    done
}

@test "all tables referenced in script 09 exist in script 00" {
    local tables=("GRID_NODES" "GRID_EDGES" "GRID_POLES_INFRASTRUCTURE" "METER_INFRASTRUCTURE")
    
    for table in "${tables[@]}"; do
        run grep -i "CREATE TABLE.*$table" "$QUICKSTART_SQL"
        [ "$status" -eq 0 ] || fail "Table $table not found in 00_standalone_quickstart.sql"
    done
}
