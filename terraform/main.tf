# =============================================================================
# Flux Operations Center - Terraform Module
# =============================================================================
# This module provisions Snowflake infrastructure required for
# Flux Ops Center SPCS deployment.
#
# IMPORTANT: The Snowflake Terraform provider (as of v1.x) does NOT support:
#   - snowflake_compute_pool
#   - snowflake_image_repository  
#   - snowflake_service (SPCS)
#
# These SPCS resources must be created via SQL after Terraform apply.
# See outputs.tf for the SQL commands to run.
#
# Usage:
#   cd terraform
#   terraform init
#   terraform plan
#   terraform apply
#   # Then run the SQL from: terraform output spcs_setup_sql
# =============================================================================

terraform {
  required_version = ">= 1.0.0"
  
  required_providers {
    snowflake = {
      source  = "Snowflake-Labs/snowflake"
      version = ">= 0.89.0"
    }
  }
}

# =============================================================================
# DATABASE & SCHEMA
# =============================================================================

resource "snowflake_database" "ops_center_db" {
  count = var.create_database ? 1 : 0
  
  name    = var.database_name
  comment = "Database for Flux Operations Center"
  
  data_retention_time_in_days = 7
}

resource "snowflake_schema" "ops_center_schema" {
  count = var.create_schema ? 1 : 0
  
  database = var.create_database ? snowflake_database.ops_center_db[0].name : var.database_name
  name     = var.schema_name
  comment  = "Schema for Flux Operations Center"
}

locals {
  database_name = var.create_database ? snowflake_database.ops_center_db[0].name : var.database_name
  schema_name   = var.create_schema ? snowflake_schema.ops_center_schema[0].name : var.schema_name
}

# =============================================================================
# WAREHOUSE
# =============================================================================

resource "snowflake_warehouse" "ops_center_wh" {
  count = var.create_warehouse ? 1 : 0
  
  name           = var.warehouse_name
  warehouse_size = var.warehouse_size
  
  auto_suspend           = 60
  auto_resume            = true
  initially_suspended    = true
  
  comment = "Warehouse for Flux Operations Center queries"
}

# =============================================================================
# STAGE FOR SERVICE SPEC
# =============================================================================

resource "snowflake_stage" "ops_center_stage" {
  name     = var.stage_name
  database = local.database_name
  schema   = local.schema_name
  
  comment = "Stage for Flux Operations Center service specifications"
  
  depends_on = [snowflake_schema.ops_center_schema]
}

# =============================================================================
# GRID INFRASTRUCTURE TABLES
# =============================================================================

resource "snowflake_table" "substations" {
  database = local.database_name
  schema   = local.schema_name
  name     = "SUBSTATIONS"
  
  comment = "Grid substations for Flux Operations Center"
  
  column {
    name     = "SUBSTATION_ID"
    type     = "VARCHAR(50)"
    nullable = false
  }
  
  column {
    name     = "NAME"
    type     = "VARCHAR(200)"
    nullable = true
  }
  
  column {
    name     = "LATITUDE"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "LONGITUDE"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "VOLTAGE_KV"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "CAPACITY_MVA"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "STATUS"
    type     = "VARCHAR(20)"
    nullable = true
  }
  
  depends_on = [snowflake_schema.ops_center_schema]
}

resource "snowflake_table" "transformers" {
  database = local.database_name
  schema   = local.schema_name
  name     = "TRANSFORMERS"
  
  comment = "Grid transformers for Flux Operations Center"
  
  column {
    name     = "TRANSFORMER_ID"
    type     = "VARCHAR(50)"
    nullable = false
  }
  
  column {
    name     = "SUBSTATION_ID"
    type     = "VARCHAR(50)"
    nullable = true
  }
  
  column {
    name     = "LATITUDE"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "LONGITUDE"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "CAPACITY_KVA"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "AGE_YEARS"
    type     = "INTEGER"
    nullable = true
  }
  
  column {
    name     = "RISK_SCORE"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "LAST_MAINTENANCE"
    type     = "DATE"
    nullable = true
  }
  
  depends_on = [snowflake_schema.ops_center_schema]
}

resource "snowflake_table" "power_lines" {
  database = local.database_name
  schema   = local.schema_name
  name     = "POWER_LINES"
  
  comment = "Grid power lines for visualization"
  
  column {
    name     = "LINE_ID"
    type     = "VARCHAR(50)"
    nullable = false
  }
  
  column {
    name     = "FROM_NODE"
    type     = "VARCHAR(50)"
    nullable = true
  }
  
  column {
    name     = "TO_NODE"
    type     = "VARCHAR(50)"
    nullable = true
  }
  
  column {
    name     = "VOLTAGE_KV"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "LENGTH_KM"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "GEOMETRY"
    type     = "GEOGRAPHY"
    nullable = true
  }
  
  depends_on = [snowflake_schema.ops_center_schema]
}

# =============================================================================
# CASCADE ANALYSIS TABLES
# =============================================================================

resource "snowflake_table" "cascade_simulations" {
  database = local.database_name
  schema   = local.schema_name
  name     = "CASCADE_SIMULATIONS"
  
  comment = "Cascade failure simulation results"
  
  column {
    name     = "SIMULATION_ID"
    type     = "VARCHAR(50)"
    nullable = false
  }
  
  column {
    name     = "TRIGGER_NODE"
    type     = "VARCHAR(50)"
    nullable = true
  }
  
  column {
    name     = "TIMESTAMP"
    type     = "TIMESTAMP_NTZ"
    nullable = true
  }
  
  column {
    name     = "AFFECTED_NODES"
    type     = "VARIANT"
    nullable = true
  }
  
  column {
    name     = "TOTAL_LOAD_SHED_MW"
    type     = "FLOAT"
    nullable = true
  }
  
  column {
    name     = "CASCADE_DEPTH"
    type     = "INTEGER"
    nullable = true
  }
  
  depends_on = [snowflake_schema.ops_center_schema]
}

# =============================================================================
# SERVICE ROLE (Optional)
# =============================================================================
# Note: Using snowflake_account_role (v1.x compatible)

resource "snowflake_account_role" "ops_center_service_role" {
  count = var.create_service_role ? 1 : 0
  
  name    = var.service_role_name
  comment = "Role for Flux Operations Center service"
}

# Grant privileges using the v1.x compatible resource
resource "snowflake_grant_privileges_to_account_role" "warehouse_usage" {
  count = var.create_service_role && var.create_warehouse ? 1 : 0
  
  privileges        = ["USAGE"]
  account_role_name = snowflake_account_role.ops_center_service_role[0].name
  
  on_account_object {
    object_type = "WAREHOUSE"
    object_name = snowflake_warehouse.ops_center_wh[0].name
  }
}

resource "snowflake_grant_privileges_to_account_role" "database_usage" {
  count = var.create_service_role ? 1 : 0
  
  privileges        = ["USAGE"]
  account_role_name = snowflake_account_role.ops_center_service_role[0].name
  
  on_account_object {
    object_type = "DATABASE"
    object_name = local.database_name
  }
}

# =============================================================================
# SNOWFLAKE POSTGRES (Dual-Backend Architecture)
# =============================================================================
# Network rules and policies for Snowflake Postgres.
# Note: CREATE POSTGRES INSTANCE is not yet supported by the Terraform provider.
# The SQL command is output for manual execution.

# Network rule for Postgres ingress (MODE = POSTGRES_INGRESS)
resource "snowflake_network_rule" "postgres_ingress" {
  count = var.create_postgres ? 1 : 0
  
  name       = "${var.postgres_instance_name}_INGRESS_RULE"
  database   = local.database_name
  schema     = local.schema_name
  type       = "IPV4"
  mode       = "INGRESS"  # Note: POSTGRES_INGRESS mode may require manual adjustment
  value_list = [var.postgres_network_cidr]
  comment    = "Ingress rule for ${var.postgres_instance_name} - restrict CIDR in production"
  
  depends_on = [snowflake_schema.ops_center_schema]
}

# Note: Egress rules with 0.0.0.0/0 are not supported for Snowflake Postgres.
# If you need egress for FDW connections, add specific destination CIDRs.
# For now, we only create ingress rules to allow incoming connections.

# Network policy for Postgres instance (ingress only)
resource "snowflake_network_policy" "postgres_policy" {
  count = var.create_postgres ? 1 : 0
  
  name    = "${var.postgres_instance_name}_NETWORK_POLICY"
  comment = "Network policy for ${var.postgres_instance_name}"
  
  allowed_network_rule_list = [
    snowflake_network_rule.postgres_ingress[0].qualified_name
  ]
  
  depends_on = [
    snowflake_network_rule.postgres_ingress
  ]
}

# POSTGRES_SYNC schema for sync procedures
resource "snowflake_schema" "postgres_sync" {
  count = var.create_postgres ? 1 : 0
  
  database = local.database_name
  name     = "POSTGRES_SYNC"
  comment  = "Procedures and tasks for syncing Snowflake data to Postgres"
  
  depends_on = [snowflake_database.ops_center_db]
}

# Sync log table
resource "snowflake_table" "sync_log" {
  count = var.create_postgres ? 1 : 0
  
  database = local.database_name
  schema   = snowflake_schema.postgres_sync[0].name
  name     = "SYNC_LOG"
  comment  = "Log of sync operations to Postgres"
  
  column {
    name     = "SYNC_ID"
    type     = "VARCHAR(50)"
    nullable = false
  }
  
  column {
    name     = "SYNC_OPERATION"
    type     = "VARCHAR(100)"
    nullable = false
  }
  
  column {
    name     = "TABLE_NAME"
    type     = "VARCHAR(100)"
    nullable = false
  }
  
  column {
    name     = "RECORDS_SYNCED"
    type     = "INTEGER"
    nullable = true
  }
  
  column {
    name     = "STATUS"
    type     = "VARCHAR(20)"
    nullable = false
  }
  
  column {
    name     = "ERROR_MESSAGE"
    type     = "VARCHAR(2000)"
    nullable = true
  }
  
  column {
    name     = "DURATION_SECONDS"
    type     = "NUMBER(10,2)"
    nullable = true
  }
  
  column {
    name     = "SYNC_TIMESTAMP"
    type     = "TIMESTAMP_NTZ"
    nullable = true
  }
  
  depends_on = [snowflake_schema.postgres_sync]
}
