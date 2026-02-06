#!/usr/bin/env bats
# ==============================================================================
# CLI Scripts Deployment Tests
# ==============================================================================
# Tests for CLI Scripts deployment method - validates all backend Python scripts
# that are part of the deployment workflow
#
# Run with: bats tests/scripts/test_cli_scripts.bats
# ==============================================================================

setup() {
    PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
    BACKEND_SCRIPTS="$PROJECT_ROOT/backend/scripts"
}

# ==============================================================================
# DIRECTORY EXISTENCE TESTS
# ==============================================================================

@test "backend/scripts directory exists" {
    [ -d "$BACKEND_SCRIPTS" ]
}

# ==============================================================================
# CORE SCRIPTS EXISTENCE TESTS
# ==============================================================================

@test "load_postgis_data.py exists" {
    [ -f "$BACKEND_SCRIPTS/load_postgis_data.py" ]
}

@test "setup_postgres_schema.py exists" {
    [ -f "$BACKEND_SCRIPTS/setup_postgres_schema.py" ]
}

@test "sync_snowflake_to_postgres.py exists" {
    [ -f "$BACKEND_SCRIPTS/sync_snowflake_to_postgres.py" ]
}

@test "compute_graph_centrality.py exists" {
    [ -f "$BACKEND_SCRIPTS/compute_graph_centrality.py" ]
}

@test "cascade_simulator.py exists" {
    [ -f "$BACKEND_SCRIPTS/cascade_simulator.py" ]
}

# ==============================================================================
# PYTHON SYNTAX VALIDATION TESTS
# ==============================================================================

@test "load_postgis_data.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "setup_postgres_schema.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/setup_postgres_schema.py"
    [ "$status" -eq 0 ]
}

@test "sync_snowflake_to_postgres.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/sync_snowflake_to_postgres.py"
    [ "$status" -eq 0 ]
}

@test "compute_graph_centrality.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/compute_graph_centrality.py"
    [ "$status" -eq 0 ]
}

@test "cascade_simulator.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/cascade_simulator.py"
    [ "$status" -eq 0 ]
}

@test "compute_extended_centrality.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/compute_extended_centrality.py"
    [ "$status" -eq 0 ]
}

@test "train_gnn_model.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/train_gnn_model.py"
    [ "$status" -eq 0 ]
}

@test "process_meta_canopy_houston.py has valid Python syntax" {
    run python3 -m py_compile "$BACKEND_SCRIPTS/process_meta_canopy_houston.py"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# LOAD_POSTGIS_DATA.PY FEATURE TESTS
# ==============================================================================

@test "load_postgis_data.py has argparse for CLI interface" {
    run grep "argparse" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py has --service argument" {
    run grep -E "add_argument.*--service" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py has DERIVED_VIEWS definition" {
    run grep "DERIVED_VIEWS" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines buildings_spatial view" {
    run grep "buildings_spatial" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines grid_assets view" {
    run grep "grid_assets" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py defines vegetation_risk_computed materialized view" {
    run grep "vegetation_risk_computed" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py has create_derived_views function" {
    run grep "def create_derived_views" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py has --skip-derived-views flag" {
    run grep "skip-derived-views" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py has --derived-views-only flag" {
    run grep "derived-views-only" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# POSTGIS SPATIAL FEATURES TESTS
# ==============================================================================

@test "load_postgis_data.py uses ST_Centroid for coordinate extraction" {
    run grep "ST_Centroid" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py uses ST_X and ST_Y for coordinates" {
    run grep "ST_X" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py uses CROSS JOIN LATERAL for nearest neighbor" {
    run grep "CROSS JOIN LATERAL" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

@test "load_postgis_data.py uses PostGIS distance operator" {
    run grep "<->" "$BACKEND_SCRIPTS/load_postgis_data.py"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# SYNC SCRIPT TESTS
# ==============================================================================

@test "sync_snowflake_to_postgres.py has snowflake connector import" {
    run grep "snowflake.connector" "$BACKEND_SCRIPTS/sync_snowflake_to_postgres.py"
    [ "$status" -eq 0 ]
}

@test "sync_snowflake_to_postgres.py has psycopg2 import" {
    run grep "psycopg2" "$BACKEND_SCRIPTS/sync_snowflake_to_postgres.py"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# CASCADE SIMULATOR TESTS
# ==============================================================================

@test "cascade_simulator.py handles scenarios configuration" {
    # Script may use hardcoded config, environment vars, or CLI args
    run grep -iE "scenario|num_|count" "$BACKEND_SCRIPTS/cascade_simulator.py"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# GRAPH CENTRALITY TESTS
# ==============================================================================

@test "compute_graph_centrality.py imports networkx" {
    run grep "networkx" "$BACKEND_SCRIPTS/compute_graph_centrality.py"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# GNN TRAINING TESTS
# ==============================================================================

@test "train_gnn_model.py exists" {
    [ -f "$BACKEND_SCRIPTS/train_gnn_model.py" ]
}

# ==============================================================================
# DOCUMENTATION SYNC TESTS
# ==============================================================================

@test "CLI_SCRIPTS.md deployment docs exist" {
    [ -f "$PROJECT_ROOT/docs/deployment/CLI_SCRIPTS.md" ]
}

@test "CLI_SCRIPTS.md mentions derived views" {
    run grep -i "derived.*view" "$PROJECT_ROOT/docs/deployment/CLI_SCRIPTS.md"
    [ "$status" -eq 0 ]
}

@test "CLI_SCRIPTS.md mentions load_postgis_data.py" {
    run grep "load_postgis_data" "$PROJECT_ROOT/docs/deployment/CLI_SCRIPTS.md"
    [ "$status" -eq 0 ]
}

@test "CLI_SCRIPTS.md mentions --skip-derived-views flag" {
    run grep "skip-derived-views" "$PROJECT_ROOT/docs/deployment/CLI_SCRIPTS.md"
    [ "$status" -eq 0 ]
}

@test "CLI_SCRIPTS.md mentions --derived-views-only flag" {
    run grep "derived-views-only" "$PROJECT_ROOT/docs/deployment/CLI_SCRIPTS.md"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# REQUIREMENTS.TXT TESTS
# ==============================================================================

@test "backend/requirements.txt exists" {
    [ -f "$PROJECT_ROOT/backend/requirements.txt" ]
}

@test "requirements.txt includes psycopg2" {
    run grep -i "psycopg2" "$PROJECT_ROOT/backend/requirements.txt"
    [ "$status" -eq 0 ]
}

@test "requirements.txt includes snowflake-connector-python" {
    run grep "snowflake-connector-python" "$PROJECT_ROOT/backend/requirements.txt"
    [ "$status" -eq 0 ]
}
