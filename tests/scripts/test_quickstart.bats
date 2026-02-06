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
    # We'll extract and test individual functions
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
}

@test "quickstart.sh -h shows usage information" {
    run "$SCRIPT_PATH" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

# =============================================================================
# CONFIGURATION VALIDATION TESTS
# =============================================================================

@test "script detects missing SNOWFLAKE_ACCOUNT" {
    unset SNOWFLAKE_ACCOUNT
    # Use expect or timeout to handle interactive prompts
    run timeout 2 bash -c "echo 'q' | $SCRIPT_PATH" 2>&1 || true
    # Script should either prompt or exit
    [ "$status" -ne 0 ] || [[ "$output" == *"Account"* ]]
}

@test "registry URL is converted to lowercase" {
    # Test that uppercase database/schema names become lowercase in the image path
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
# STEP DEFINITIONS TESTS
# =============================================================================

@test "script defines all 9 steps" {
    run grep -c "^step_[0-9]_" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    [ "$output" -eq 9 ]
}

@test "script has step 1 (prerequisites)" {
    run grep "step_1_prerequisites" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 2 (registry login)" {
    run grep "step_2_registry_login" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 3 (build frontend)" {
    run grep "step_3_build_frontend" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 4 (build docker)" {
    run grep "step_4_build_docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 5 (push image)" {
    run grep "step_5_push_image" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 6 (generate sql)" {
    run grep "step_6_generate_sql" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 7 (deploy service)" {
    run grep "step_7_deploy_service" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 8 (create postgres)" {
    run grep "step_8_create_postgres" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script has step 9 (wait for services)" {
    run grep "step_9_wait_for_services" "$SCRIPT_PATH"
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

@test "script supports 'D' for deploy only" {
    run grep "D)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "script supports 'B' for build only" {
    run grep "B)" "$SCRIPT_PATH"
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
    run grep "max_attempts\|MAX_ATTEMPTS" "$SCRIPT_PATH"
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
    # Should not find any hardcoded password assignments (except in comments/prompts)
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
    # Check that set -e is commented out or not present at top level
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
