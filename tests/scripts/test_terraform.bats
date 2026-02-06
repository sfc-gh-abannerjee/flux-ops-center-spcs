#!/usr/bin/env bats
# ==============================================================================
# Terraform Deployment Tests
# ==============================================================================
# Tests for Terraform deployment method parity with quickstart.sh
#
# Run with: bats tests/scripts/test_terraform.bats
# ==============================================================================

setup() {
    PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
    TERRAFORM_DIR="$PROJECT_ROOT/terraform"
}

# ==============================================================================
# FILE EXISTENCE TESTS
# ==============================================================================

@test "terraform directory exists" {
    [ -d "$TERRAFORM_DIR" ]
}

@test "main.tf exists" {
    [ -f "$TERRAFORM_DIR/main.tf" ]
}

@test "variables.tf exists" {
    [ -f "$TERRAFORM_DIR/variables.tf" ]
}

@test "outputs.tf exists" {
    [ -f "$TERRAFORM_DIR/outputs.tf" ]
}

# ==============================================================================
# TERRAFORM SYNTAX TESTS
# ==============================================================================

@test "main.tf has valid terraform block" {
    run grep "terraform {" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "main.tf requires snowflake provider" {
    run grep "Snowflake-Labs/snowflake" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "main.tf has required_version constraint" {
    run grep "required_version" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# INFRASTRUCTURE PARITY TESTS
# ==============================================================================

@test "terraform creates database resource" {
    run grep "snowflake_database" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates schema resource" {
    run grep "snowflake_schema" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates warehouse resource" {
    run grep "snowflake_warehouse" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates stage resource" {
    run grep "snowflake_stage" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# TABLE DEFINITIONS (Parity with quickstart.sh)
# ==============================================================================

@test "terraform defines SUBSTATIONS table" {
    run grep -i "substations" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform defines TRANSFORMERS table" {
    run grep -i "transformers" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform defines POWER_LINES table" {
    run grep -i "power_lines" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform defines CASCADE_SIMULATIONS table" {
    run grep -i "cascade_simulations" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# POSTGRES SUPPORT (Dual-Backend Architecture)
# ==============================================================================

@test "terraform supports postgres instance creation" {
    run grep -i "postgres" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates network rule for postgres" {
    run grep "snowflake_network_rule" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates network policy" {
    run grep "snowflake_network_policy" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates POSTGRES_SYNC schema" {
    run grep "POSTGRES_SYNC" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform creates SYNC_LOG table" {
    run grep "SYNC_LOG" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# VARIABLES TESTS
# ==============================================================================

@test "variables.tf defines database_name variable" {
    run grep "database_name" "$TERRAFORM_DIR/variables.tf"
    [ "$status" -eq 0 ]
}

@test "variables.tf defines warehouse_name variable" {
    run grep "warehouse_name" "$TERRAFORM_DIR/variables.tf"
    [ "$status" -eq 0 ]
}

@test "variables.tf defines postgres_instance_name variable" {
    run grep "postgres_instance_name" "$TERRAFORM_DIR/variables.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# OUTPUTS TESTS
# ==============================================================================

@test "outputs.tf provides spcs_setup_sql output" {
    run grep "spcs_setup_sql" "$TERRAFORM_DIR/outputs.tf"
    [ "$status" -eq 0 ]
}

@test "outputs.tf provides postgres_setup_sql output" {
    run grep -i "postgres.*sql" "$TERRAFORM_DIR/outputs.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# ROLE & GRANTS TESTS
# ==============================================================================

@test "terraform creates service role" {
    run grep "snowflake_account_role" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

@test "terraform grants warehouse usage" {
    run grep "snowflake_grant_privileges_to_account_role" "$TERRAFORM_DIR/main.tf"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# DOCUMENTATION SYNC TESTS
# ==============================================================================

@test "TERRAFORM.md deployment docs exist" {
    [ -f "$PROJECT_ROOT/docs/deployment/TERRAFORM.md" ]
}

@test "TERRAFORM.md mentions derived views" {
    run grep -i "derived.*view" "$PROJECT_ROOT/docs/deployment/TERRAFORM.md"
    [ "$status" -eq 0 ]
}

@test "TERRAFORM.md mentions load_postgis_data.py" {
    run grep "load_postgis_data" "$PROJECT_ROOT/docs/deployment/TERRAFORM.md"
    [ "$status" -eq 0 ]
}
