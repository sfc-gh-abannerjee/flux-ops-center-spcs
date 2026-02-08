#!/usr/bin/env bats
# ==============================================================================
# API Dependency Tests
# ==============================================================================
# These tests verify that:
#   1. Backend API endpoints have all required database tables
#   2. Frontend API calls have matching backend endpoints
#   3. Postgres tables referenced by backend actually get created
#
# PURPOSE: Catch gaps like:
#   - Backend endpoint queries table that doesn't exist
#   - Frontend calls API endpoint that backend doesn't implement
#   - Postgres view references non-existent base table
#
# Run with: bats tests/scripts/test_api_dependencies.bats
# ==============================================================================

setup() {
    PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
    BACKEND_DIR="$PROJECT_ROOT/backend"
    FRONTEND_DIR="$PROJECT_ROOT/src"
    SQL_DIR="$PROJECT_ROOT/scripts/sql"
    QUICKSTART_SQL="$SQL_DIR/00_standalone_quickstart.sql"
    SERVER_FILE="$BACKEND_DIR/server_fastapi.py"
    LOAD_SCRIPT="$BACKEND_DIR/scripts/load_postgis_data.py"
}

# ==============================================================================
# BACKEND API ENDPOINT EXISTENCE TESTS
# ==============================================================================
# Verify all critical API endpoints exist in server_fastapi.py

@test "backend has /api/initial-load endpoint" {
    run grep -E "@app\.(get|post).*initial-load|/api/initial-load" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/assets endpoint" {
    run grep -E "@app\.(get|post).*assets|/api/assets" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/topology endpoint" {
    run grep -E "@app\.(get|post).*/topology[^/]|/api/topology\"" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/kpis endpoint" {
    run grep -E "@app\.(get|post).*kpis|/api/kpis" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/weather endpoint" {
    run grep -E "@app\.(get|post).*weather|/api/weather" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/service-areas endpoint" {
    run grep -E "@app\.(get|post).*service-areas|/api/service-areas" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/substations endpoint" {
    run grep -E "@app\.(get|post).*substations|/api/substations" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/outages/active endpoint" {
    run grep -E "@app\.(get|post).*outages|/api/outages" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/work-orders endpoint" {
    run grep -E "@app\.(get|post).*work-orders|/api/work-orders" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# SPATIAL API ENDPOINT TESTS
# ==============================================================================

@test "backend has /api/spatial/layers/power-lines endpoint" {
    run grep -E "power-lines|power_lines" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/spatial/layers/vegetation endpoint" {
    run grep -E "vegetation" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/spatial/nearest-buildings endpoint" {
    run grep -E "nearest-buildings|nearest_buildings" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# CASCADE ANALYSIS API ENDPOINT TESTS
# ==============================================================================

@test "backend has /api/cascade/patient-zero-candidates endpoint" {
    run grep -E "patient-zero|patient_zero" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/cascade/simulate endpoint" {
    run grep -E "cascade.*simulate|/simulate" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/cascade/precomputed endpoint" {
    run grep -E "precomputed" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# CORTEX AGENT API ENDPOINT TESTS
# ==============================================================================

@test "backend has /api/agent/stream endpoint" {
    run grep -E "agent.*stream|/stream" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "backend has /api/agent/threads endpoint" {
    run grep -E "agent.*thread|/threads" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# BACKEND → SNOWFLAKE TABLE DEPENDENCY TESTS
# ==============================================================================
# Verify tables referenced in backend code exist in SQL scripts

@test "SUBSTATIONS table (used by backend) exists in SQL" {
    # Backend references this table
    run grep -i "SUBSTATIONS" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    # Table must exist in SQL
    run grep -i "CREATE TABLE.*SUBSTATIONS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "TRANSFORMER_METADATA table (used by backend) exists in SQL" {
    run grep -i "TRANSFORMER_METADATA" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE TABLE.*TRANSFORMER_METADATA" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "METER_INFRASTRUCTURE table (used by backend) exists in SQL" {
    run grep -i "METER_INFRASTRUCTURE" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE TABLE.*METER_INFRASTRUCTURE" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "CIRCUIT_METADATA table (used by backend) exists in SQL" {
    run grep -i "CIRCUIT_METADATA" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE TABLE.*CIRCUIT_METADATA" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "HOUSTON_WEATHER_HOURLY table (used by backend) exists in SQL" {
    run grep -i "HOUSTON_WEATHER" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE TABLE.*HOUSTON_WEATHER_HOURLY" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "OUTAGE_RESTORATION_TRACKER table (used by backend) exists in SQL" {
    run grep -i "OUTAGE_RESTORATION_TRACKER" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE TABLE.*OUTAGE_RESTORATION_TRACKER" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "WORK_ORDERS table (used by backend) exists in SQL" {
    run grep -i "WORK_ORDERS" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE TABLE.*WORK_ORDERS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# BACKEND → SNOWFLAKE VIEW DEPENDENCY TESTS
# ==============================================================================

@test "FLUX_OPS_CENTER_KPIS view (used by backend) exists in SQL" {
    run grep -i "FLUX_OPS_CENTER_KPIS" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_KPIS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "FLUX_OPS_CENTER_TOPOLOGY view (used by backend) exists in SQL" {
    run grep -i "FLUX_OPS_CENTER_TOPOLOGY" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_TOPOLOGY" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "FLUX_OPS_CENTER_SERVICE_AREAS view (used by backend) exists in SQL" {
    run grep -i "FLUX_OPS_CENTER_SERVICE_AREAS\|SERVICE_AREAS_MV" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_SERVICE_AREAS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# BACKEND → POSTGRES TABLE DEPENDENCY TESTS
# ==============================================================================
# Verify Postgres tables referenced in backend are created by load script

@test "buildings_spatial (Postgres) referenced by backend exists in load script" {
    run grep -i "buildings_spatial" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "buildings_spatial" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "grid_assets (Postgres) referenced by backend exists in load script" {
    # Backend references grid_assets (alias for grid_assets_cache)
    run grep -i "FROM grid_assets" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "grid_assets" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "power_lines_spatial (Postgres) referenced by backend exists in load script" {
    run grep -i "power_lines_spatial" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "power_lines_spatial" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "vegetation_risk_computed (Postgres) referenced by backend exists in load script" {
    run grep -i "vegetation_risk_computed" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "vegetation_risk_computed" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "circuit_service_areas (Postgres) referenced by backend exists in load script" {
    run grep -i "circuit_service_areas" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    run grep -i "circuit_service_areas" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "topology_connections_cache (Postgres) exists in load script" {
    run grep -i "topology_connections_cache" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "grid_assets_cache (Postgres) exists in load script" {
    run grep -i "grid_assets_cache" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# FRONTEND → BACKEND API CONSISTENCY TESTS
# ==============================================================================
# Verify frontend API calls have matching backend endpoints

@test "frontend /api/initial-load call has backend endpoint" {
    # Check frontend calls this endpoint
    run grep -r "initial-load" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    # Check backend has this endpoint
    run grep -E "initial-load|initial_load" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "frontend /api/assets call has backend endpoint" {
    run grep -r "/api/assets" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    run grep -E "/assets|def.*assets" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "frontend /api/topology call has backend endpoint" {
    run grep -r "/api/topology" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    run grep -E "/topology|def.*topology" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "frontend /api/weather call has backend endpoint" {
    run grep -r "/api/weather" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    run grep -E "/weather|def.*weather" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "frontend /api/cascade calls have backend endpoints" {
    run grep -r "/api/cascade" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    run grep -E "/cascade|def.*cascade" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

@test "frontend /api/agent calls have backend endpoints" {
    run grep -r "/api/agent" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    run grep -E "/agent|def.*agent" "$SERVER_FILE"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# CASCADE ANALYSIS DEPENDENCY TESTS
# ==============================================================================

@test "GRID_NODES table (used by cascade analysis) exists" {
    run grep -i "CREATE TABLE.*GRID_NODES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "GRID_EDGES table (used by cascade analysis) exists" {
    run grep -i "CREATE TABLE.*GRID_EDGES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "NODE_CENTRALITY_FEATURES table (used by cascade analysis) exists" {
    run grep -i "CREATE TABLE.*NODE_CENTRALITY_FEATURES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "PRECOMPUTED_CASCADES table (used by cascade analysis) exists" {
    run grep -i "CREATE TABLE.*PRECOMPUTED_CASCADES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "GNN_PREDICTIONS table (used by cascade analysis) exists" {
    run grep -i "CREATE TABLE.*GNN_PREDICTIONS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# POSTGRES SETUP SCRIPT DEPENDENCY TESTS
# ==============================================================================

@test "setup_postgres_schema.py creates required tables" {
    local schema_script="$BACKEND_DIR/scripts/setup_postgres_schema.py"
    [ -f "$schema_script" ]
    
    # Should create spatial tables
    run grep -i "CREATE TABLE" "$schema_script"
    [ "$status" -eq 0 ]
}

@test "sync_snowflake_to_postgres.py references existing Snowflake tables" {
    local sync_script="$BACKEND_DIR/scripts/sync_snowflake_to_postgres.py"
    [ -f "$sync_script" ]
    
    # Should reference FLUX_OPS_CENTER_TOPOLOGY
    run grep -i "FLUX_OPS_CENTER_TOPOLOGY\|VEGETATION_RISK" "$sync_script"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# COMPLETE DEPENDENCY CHAIN VALIDATION
# ==============================================================================

@test "full chain: Frontend → Backend → Snowflake for assets" {
    # 1. Frontend calls /api/assets
    run grep -r "/api/assets" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    # 2. Backend has endpoint and queries tables
    run grep -E "SUBSTATIONS|TRANSFORMER_METADATA|METER_INFRASTRUCTURE" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    # 3. Tables exist in SQL
    run grep -i "CREATE TABLE.*SUBSTATIONS" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "full chain: Frontend → Backend → Snowflake for topology" {
    # 1. Frontend calls topology endpoints
    run grep -r "/api/topology" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    # 2. Backend queries FLUX_OPS_CENTER_TOPOLOGY
    run grep -i "FLUX_OPS_CENTER_TOPOLOGY" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    # 3. View exists in SQL
    run grep -i "CREATE.*VIEW.*FLUX_OPS_CENTER_TOPOLOGY" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}

@test "full chain: Frontend → Backend → Postgres for spatial" {
    # 1. Frontend calls spatial endpoints
    run grep -r "spatial" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    # 2. Backend queries Postgres tables
    run grep -i "buildings_spatial\|power_lines_spatial\|vegetation_risk" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    # 3. Views exist in load script
    run grep -i "buildings_spatial\|power_lines_spatial\|vegetation_risk_computed" "$LOAD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "full chain: Frontend → Backend → Snowflake for cascade" {
    # 1. Frontend calls cascade endpoints
    run grep -r "/api/cascade" "$FRONTEND_DIR" --include="*.ts" --include="*.tsx"
    [ "$status" -eq 0 ]
    
    # 2. Backend queries cascade tables
    run grep -i "GRID_NODES\|PRECOMPUTED_CASCADES\|NODE_CENTRALITY" "$SERVER_FILE"
    [ "$status" -eq 0 ]
    
    # 3. Tables exist in SQL
    run grep -i "CREATE TABLE.*GRID_NODES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
    run grep -i "CREATE TABLE.*PRECOMPUTED_CASCADES" "$QUICKSTART_SQL"
    [ "$status" -eq 0 ]
}
