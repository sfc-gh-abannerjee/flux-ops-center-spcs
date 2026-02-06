#!/usr/bin/env bats
# ==============================================================================
# Notebook Deployment Tests
# ==============================================================================
# Tests for Snowflake Notebook deployment method parity with quickstart.sh
#
# Run with: bats tests/scripts/test_notebooks.bats
# ==============================================================================

setup() {
    PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
    NOTEBOOKS_DIR="$PROJECT_ROOT/notebooks"
    DEPLOY_NOTEBOOK="$NOTEBOOKS_DIR/setup/01_deploy_spcs_infrastructure.ipynb"
}

# ==============================================================================
# FILE EXISTENCE TESTS
# ==============================================================================

@test "notebooks directory exists" {
    [ -d "$NOTEBOOKS_DIR" ]
}

@test "notebooks/setup directory exists" {
    [ -d "$NOTEBOOKS_DIR/setup" ]
}

@test "deployment notebook exists" {
    [ -f "$DEPLOY_NOTEBOOK" ]
}

@test "deployment notebook is valid JSON" {
    run python3 -c "import json; json.load(open('$DEPLOY_NOTEBOOK'))"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# NOTEBOOK STRUCTURE TESTS
# ==============================================================================

@test "notebook has cells array" {
    run python3 -c "
import json
nb = json.load(open('$DEPLOY_NOTEBOOK'))
assert 'cells' in nb, 'Missing cells array'
print('cells found')
"
    [ "$status" -eq 0 ]
}

@test "notebook has at least 10 cells" {
    run python3 -c "
import json
nb = json.load(open('$DEPLOY_NOTEBOOK'))
cell_count = len(nb.get('cells', []))
assert cell_count >= 10, f'Only {cell_count} cells, expected 10+'
print(f'{cell_count} cells')
"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# CONFIGURATION PARITY TESTS
# ==============================================================================

@test "notebook defines DATABASE configuration" {
    run grep -l "DATABASE.*=" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook defines WAREHOUSE configuration" {
    run grep "WAREHOUSE" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook defines IMAGE_REPO configuration" {
    run grep "IMAGE_REPO" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook defines COMPUTE_POOL configuration" {
    run grep "COMPUTE_POOL" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook defines SERVICE_NAME configuration" {
    run grep "SERVICE_NAME" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook defines POSTGRES_INSTANCE configuration" {
    run grep "POSTGRES_INSTANCE" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# INFRASTRUCTURE CREATION TESTS (Parity with quickstart.sh)
# ==============================================================================

@test "notebook creates image repository" {
    run grep "CREATE IMAGE REPOSITORY" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook creates compute pool" {
    run grep "CREATE COMPUTE POOL" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook creates SPCS service" {
    run grep "CREATE SERVICE" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook grants service usage to PUBLIC" {
    run grep "GRANT USAGE ON SERVICE" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# POSTGRES SUPPORT TESTS
# ==============================================================================

@test "notebook mentions Postgres instance" {
    run grep -i "postgres" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook shows postgres creation SQL" {
    run grep "CREATE POSTGRES" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook includes POSTGRES_HOST configuration" {
    run grep "POSTGRES_HOST" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# SERVICE SPEC TESTS
# ==============================================================================

@test "notebook includes service specification" {
    run grep "spec:" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook service spec has containers section" {
    run grep "containers:" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook service spec has endpoints section" {
    run grep "endpoints:" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook configures SNOWFLAKE_DATABASE env var" {
    run grep "SNOWFLAKE_DATABASE" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook configures VITE_POSTGRES_HOST env var" {
    run grep "VITE_POSTGRES_HOST" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# VERIFICATION COMMANDS TESTS
# ==============================================================================

@test "notebook checks service status" {
    run grep "GET_SERVICE_STATUS" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook shows endpoints" {
    run grep "SHOW ENDPOINTS" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# POST-DEPLOYMENT INSTRUCTIONS (Parity with derived views)
# ==============================================================================

@test "notebook mentions load_postgis_data.py in next steps" {
    run grep "load_postgis_data" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook mentions compute_graph_centrality.py" {
    run grep "compute_graph_centrality" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook mentions cascade_simulator.py" {
    run grep "cascade_simulator" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# TROUBLESHOOTING SECTION TESTS
# ==============================================================================

@test "notebook includes service logs command" {
    run grep "GET_SERVICE_LOGS" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

@test "notebook includes service restart commands" {
    run grep "SUSPEND" "$DEPLOY_NOTEBOOK"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# DOCUMENTATION SYNC TESTS
# ==============================================================================

@test "NOTEBOOKS.md deployment docs exist" {
    [ -f "$PROJECT_ROOT/docs/deployment/NOTEBOOKS.md" ]
}

@test "NOTEBOOKS.md mentions derived views" {
    run grep -i "derived.*view" "$PROJECT_ROOT/docs/deployment/NOTEBOOKS.md"
    [ "$status" -eq 0 ]
}

@test "NOTEBOOKS.md mentions load_postgis_data.py" {
    run grep "load_postgis_data" "$PROJECT_ROOT/docs/deployment/NOTEBOOKS.md"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# OTHER NOTEBOOKS EXISTENCE TESTS
# ==============================================================================

@test "postgres_sync_manual notebook exists" {
    [ -f "$NOTEBOOKS_DIR/postgres_sync_manual.ipynb" ]
}

@test "postgres_sync_manual notebook is valid JSON" {
    run python3 -c "import json; json.load(open('$NOTEBOOKS_DIR/postgres_sync_manual.ipynb'))"
    [ "$status" -eq 0 ]
}
