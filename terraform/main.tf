# =============================================================================
# Flux Operations Center - Terraform Module
# =============================================================================
# This module provisions all Snowflake infrastructure required for
# Flux Ops Center SPCS deployment.
#
# Usage:
#   cd terraform
#   terraform init
#   terraform plan -var-file="terraform.tfvars"
#   terraform apply -var-file="terraform.tfvars"
# =============================================================================

terraform {
  required_version = ">= 1.0.0"
  
  required_providers {
    snowflake = {
      source  = "Snowflake-Labs/snowflake"
      version = ">= 0.87.0"
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
  
  is_managed = false
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
# IMAGE REPOSITORY
# =============================================================================

resource "snowflake_image_repository" "ops_center_repo" {
  name     = var.image_repository_name
  database = local.database_name
  schema   = local.schema_name
  
  depends_on = [snowflake_schema.ops_center_schema]
}

# =============================================================================
# COMPUTE POOL
# =============================================================================

resource "snowflake_compute_pool" "ops_center_pool" {
  count = var.create_compute_pool ? 1 : 0
  
  name            = var.compute_pool_name
  instance_family = var.compute_pool_instance_family
  min_nodes       = var.compute_pool_min_nodes
  max_nodes       = var.compute_pool_max_nodes
  
  auto_resume  = true
  auto_suspend_secs = var.compute_pool_auto_suspend_secs
  
  comment = "Compute pool for Flux Operations Center SPCS"
}

locals {
  compute_pool_name = var.create_compute_pool ? snowflake_compute_pool.ops_center_pool[0].name : var.compute_pool_name
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

resource "snowflake_role" "ops_center_service_role" {
  count = var.create_service_role ? 1 : 0
  
  name    = var.service_role_name
  comment = "Role for Flux Operations Center service"
}

resource "snowflake_grant_privileges_to_role" "warehouse_usage" {
  count = var.create_service_role && var.create_warehouse ? 1 : 0
  
  privileges = ["USAGE"]
  role_name  = snowflake_role.ops_center_service_role[0].name
  
  on_account_object {
    object_type = "WAREHOUSE"
    object_name = snowflake_warehouse.ops_center_wh[0].name
  }
}

resource "snowflake_grant_privileges_to_role" "schema_usage" {
  count = var.create_service_role ? 1 : 0
  
  privileges = ["USAGE"]
  role_name  = snowflake_role.ops_center_service_role[0].name
  
  on_schema {
    schema_name = "\"${local.database_name}\".\"${local.schema_name}\""
  }
}
