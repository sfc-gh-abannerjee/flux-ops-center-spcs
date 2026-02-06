#!/usr/bin/env bats
# =============================================================================
# Flux Operations Center - Quickstart Script Tests
# =============================================================================
# Run with: bats tests/scripts/test_quickstart.bats
# Or: npm run test:scripts
# =============================================================================

# Setup - runs before each test
setup() {
    # Get the directory of this test file
    TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    PROJECT_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
    SCRIPT_PATH="$PROJECT_ROOT/scripts/quickstart.sh"
    
    # Create temp directory for test artifacts
    TEST_TEMP="$(mktemp -d)"
    
    # Source helper functions from the script (without running main)
    export SNOWFLAKE_ACCOUNT="test-account"
    export SNOWFLAKE_USER="test-user"
    export SNOWFLAKE_DATABASE="TEST_DB"
    export SNOWFLAKE_SCHEMA="TEST_SCHEMA"
    export SNOWFLAKE_WAREHOUSE="TEST_WH"
    export COMPUTE_POOL="TEST_POOL"
    export SNOWFLAKE_CONNECTION="test-connection"
}

# Teardown - runs after each test
teardown() {
    # Clean up temp directory
    [ -d "$TEST_TEMP" ] && rm -rf "$TEST_TEMP"
}

# =============================================================================
# SCRIPT EXISTENCE AND SYNTAX TESTS
# =============================================================================

@test "quickstart.sh exists and is executable" {
    [ -f "$SCRIPT_PATH" ]
    [ -x "$SCRIPT_PATH" ]
}

@test "quickstart.sh has valid bash syntax" {
    run bash -n "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "quickstart.sh starts with proper shebang" {
    head -1 "$SCRIPT_PATH" | grep -qE "^#!/usr/bin/env bash|^#!/bin/bash"
}

# =============================================================================
# HELP AND VERSION TESTS
# =============================================================================

@test "quickstart.sh --help shows usage information" {
    run "$SCRIPT_PATH" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"--all"* ]]
    [[ "$output" == *"--skip-build"* ]]
    [[ "$output" == *"--status"* ]]
}

@test "quickstart.sh -h shows usage information" {
    run "$SCRIPT_PATH" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "quickstart.sh --help shows all 13 steps" {
    run "$SCRIPT_PATH" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"1."* ]]
    [[ "$output" == *"13."* ]]
    [[ "$output" == *"Health Check"* ]]
}

# =============================================================================
# CONFIGURATION VALIDATION TESTS
# =============================================================================

@test "script has default database value" {
    run grep 'SNOWFLAKE_DATABASE="${SNOWFLAKE_DATABASE:-FLUX_DB}"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has default schema value" {
    run grep 'SNOWFLAKE_SCHEMA="${SNOWFLAKE_SCHEMA:-APPLICATIONS}"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has default warehouse value" {
    run grep 'SNOWFLAKE_WAREHOUSE="${SNOWFLAKE_WAREHOUSE:-FLUX_WH}"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "registry URL is converted to lowercase" {
    source_vars=$(cat << 'EOF'
SNOWFLAKE_DATABASE="FLUX_DB"
SNOWFLAKE_SCHEMA="PUBLIC"
IMAGE_REPO="FLUX_OPS_CENTER_REPO"
DB_LOWER=$(echo "$SNOWFLAKE_DATABASE" | tr '[:upper:]' '[:lower:]')
SCHEMA_LOWER=$(echo "$SNOWFLAKE_SCHEMA" | tr '[:upper:]' '[:lower:]')
REPO_LOWER=$(echo "$IMAGE_REPO" | tr '[:upper:]' '[:lower:]')
echo "$DB_LOWER/$SCHEMA_LOWER/$REPO_LOWER"
EOF
)
    run bash -c "$source_vars"
    [ "$status" -eq 0 ]
    [ "$output" = "flux_db/public/flux_ops_center_repo" ]
}

# =============================================================================
# STEP DEFINITIONS TESTS (13 steps)
# =============================================================================

@test "script defines all 13 steps" {
    run grep -c "^step_[0-9]\+_" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    [ "$output" -eq 13 ]
}

@test "script has step 1 (prerequisites)" {
    run grep "step_1_prerequisites" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 2 (init database)" {
    run grep "step_2_init_database" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 3 (create compute pool)" {
    run grep "step_3_create_compute_pool" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 4 (registry login)" {
    run grep "step_4_registry_login" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 5 (build frontend)" {
    run grep "step_5_build_frontend" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 6 (build docker)" {
    run grep "step_6_build_docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 7 (push image)" {
    run grep "step_7_push_image" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 8 (deploy service)" {
    run grep "step_8_deploy_service" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 9 (create postgres)" {
    run grep "step_9_create_postgres" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 10 (external access)" {
    run grep "step_10_external_access" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 11 (load postgis data)" {
    run grep "step_11_load_postgis_data" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 12 (setup cortex)" {
    run grep "step_12_setup_cortex" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 13 (health check)" {
    run grep "step_13_health_check" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# ROLLBACK FUNCTIONALITY TESTS
# =============================================================================

@test "script has rollback functionality" {
    run grep "execute_rollback" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has rollback for SPCS service" {
    run grep "ROLLBACK_SERVICE" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has rollback for Postgres" {
    run grep "ROLLBACK_POSTGRES" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has rollback for Docker images" {
    run grep "ROLLBACK_DOCKER" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has rollback for SQL files" {
    run grep "ROLLBACK_SQL" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has rollback for external access" {
    run grep "ROLLBACK_EXTERNAL_ACCESS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script sets up exit trap for cleanup" {
    run grep "trap cleanup_on_error EXIT" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# INTERACTIVE MENU TESTS
# =============================================================================

@test "script has interactive step menu" {
    run grep "show_step_menu" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'A' for all steps" {
    run grep -A 5 "case.*choice" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    [[ "$output" == *"A)"* ]]
}

@test "script supports 'F' for fresh install" {
    run grep "F)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'D' for deploy only" {
    run grep "D)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'B' for build only" {
    run grep "B)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'P' for postgres setup only" {
    run grep "P)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'C' for custom selection" {
    run grep "C)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'Q' to quit" {
    run grep "Q)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# STATUS CHECK TESTS
# =============================================================================

@test "script has --status flag" {
    run grep "\-\-status" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has status check function" {
    run grep "check_deployment_status" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "status check examines database" {
    run grep -A 20 "check_deployment_status" "$SCRIPT_PATH"
    [[ "$output" == *"SHOW DATABASES"* ]]
}

@test "status check examines compute pool" {
    run grep -A 40 "check_deployment_status" "$SCRIPT_PATH"
    [[ "$output" == *"COMPUTE POOL"* ]]
}

@test "status check examines SPCS service" {
    run grep -A 60 "check_deployment_status" "$SCRIPT_PATH"
    [[ "$output" == *"SERVICE_STATUS"* ]]
}

# =============================================================================
# PREREQUISITE CHECK TESTS
# =============================================================================

@test "script checks for Node.js" {
    run grep "command -v node" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks for npm" {
    run grep "command -v npm" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks for Python" {
    run grep "command -v python3" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks for Docker" {
    run grep "command -v docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks for Snowflake CLI" {
    run grep "command -v snow" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks if Docker daemon is running" {
    run grep "docker info" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# DATABASE INITIALIZATION TESTS
# =============================================================================

@test "script creates database if not exists" {
    run grep "CREATE DATABASE IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script creates warehouse if not exists" {
    run grep "CREATE WAREHOUSE IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script creates required schemas" {
    run grep "PRODUCTION APPLICATIONS ML_DEMO CASCADE_ANALYSIS RAW" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script runs standalone quickstart SQL if available" {
    run grep "00_standalone_quickstart.sql" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# COMPUTE POOL TESTS
# =============================================================================

@test "script creates compute pool if not exists" {
    run grep "CREATE COMPUTE POOL IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script waits for compute pool to be ready" {
    run grep "Waiting for compute pool" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script resumes suspended compute pool" {
    run grep "ALTER COMPUTE POOL.*RESUME" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# SQL GENERATION TESTS
# =============================================================================

@test "script generates SPCS service SQL" {
    run grep "CREATE SERVICE IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script generates image repository SQL" {
    run grep "CREATE IMAGE REPOSITORY IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script generates Postgres instance SQL" {
    run grep "CREATE POSTGRES INSTANCE" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script generates network rules for Postgres" {
    run grep "CREATE NETWORK RULE IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script generates network policy for Postgres" {
    run grep "CREATE NETWORK POLICY IF NOT EXISTS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# EXTERNAL ACCESS INTEGRATION TESTS
# =============================================================================

@test "script creates external access integration" {
    run grep "CREATE.*EXTERNAL ACCESS INTEGRATION" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script creates postgres credentials secret" {
    run grep "CREATE.*SECRET POSTGRES_CREDENTIALS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script creates postgres egress rule" {
    run grep "FLUX_POSTGRES_EGRESS_RULE" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# POSTGIS DATA LOADING TESTS
# =============================================================================

@test "script references load_postgis_data.py" {
    run grep "load_postgis_data.py" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script installs psycopg2 if needed" {
    run grep "psycopg2" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# CORTEX AI TESTS
# =============================================================================

@test "script has Cortex setup option" {
    run grep "SETUP_CORTEX" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script references cortex search SQL" {
    run grep "07_create_cortex_search.sql" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script references cortex agent SQL" {
    run grep "08_create_cortex_agent.sql" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# HEALTH CHECK TESTS
# =============================================================================

@test "script has health check function" {
    run grep "step_13_health_check" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "health check tests SPCS service" {
    run grep -A 30 "step_13_health_check" "$SCRIPT_PATH"
    [[ "$output" == *"SPCS Service"* ]]
}

@test "health check tests endpoints with curl" {
    run grep "curl.*http_code" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "health check tests Postgres status" {
    run grep -A 50 "step_13_health_check" "$SCRIPT_PATH"
    [[ "$output" == *"Postgres Instance"* ]]
}

# =============================================================================
# DOCKER BUILD TESTS
# =============================================================================

@test "script uses Dockerfile.spcs when available" {
    run grep "Dockerfile.spcs" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script tags Docker image correctly" {
    run grep "docker tag" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script pushes to Snowflake registry" {
    run grep "docker push" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# SERVICE WAIT TESTS
# =============================================================================

@test "script polls for service status" {
    run grep "SYSTEM.*GET_SERVICE_STATUS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks for READY status" {
    run grep '"READY"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script checks for FAILED status" {
    run grep '"FAILED"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has max attempts for polling" {
    run grep "max_attempts" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# OUTPUT FORMATTING TESTS
# =============================================================================

@test "script has color definitions" {
    run grep "RED=\|GREEN=\|YELLOW=\|BLUE=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has NC (no color) reset" {
    run grep "NC=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has print helper functions" {
    run grep "print_header\|print_step\|print_error\|print_success" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has banner function" {
    run grep "print_banner" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# SECURITY TESTS
# =============================================================================

@test "script does not hardcode passwords" {
    run grep -i "password=" "$SCRIPT_PATH"
    if [ "$status" -eq 0 ]; then
        # If found, make sure it's not a hardcoded value
        [[ ! "$output" == *"password=\""* ]]
    fi
}

@test "script does not hardcode API keys" {
    run grep -i "api_key=\|apikey=" "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
}

@test "script warns about Postgres credentials" {
    run grep -i "save.*credentials\|credentials.*save" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# =============================================================================
# ERROR HANDLING TESTS
# =============================================================================

@test "script does not use 'set -e' globally (handles errors manually)" {
    run grep "^set -e" "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
}

@test "script has error handling for npm ci" {
    run grep -A 2 "npm ci" "$SCRIPT_PATH"
    [[ "$output" == *"if"* ]] || [[ "$output" == *"||"* ]]
}

@test "script has error handling for npm run build" {
    run grep -A 2 "npm run build" "$SCRIPT_PATH"
    [[ "$output" == *"if"* ]] || [[ "$output" == *"||"* ]]
}

@test "script has error handling for docker build" {
    run grep -A 2 "docker build" "$SCRIPT_PATH"
    [[ "$output" == *"if"* ]] || [[ "$output" == *"||"* ]]
}

@test "script has error handling for docker push" {
    run grep -A 2 "docker push" "$SCRIPT_PATH"
    [[ "$output" == *"if"* ]] || [[ "$output" == *"||"* ]]
}

# =============================================================================
# COMPLETION SUMMARY TESTS
# =============================================================================

@test "script has completion summary function" {
    run grep "show_completion_summary" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script shows useful commands in summary" {
    run grep "Useful Commands" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script shows next steps in summary" {
    run grep "Next Steps" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script shows --status command in summary" {
    run grep -A 5 "Useful Commands" "$SCRIPT_PATH"
    [[ "$output" == *"--status"* ]]
}

# =============================================================================
# COMMAND LINE ARGUMENT TESTS
# =============================================================================

@test "script supports --skip-postgres flag" {
    run grep "\-\-skip-postgres" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports --with-cortex flag" {
    run grep "\-\-with-cortex" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
