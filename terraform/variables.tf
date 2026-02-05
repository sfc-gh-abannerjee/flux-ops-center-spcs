# =============================================================================
# Flux Operations Center - Terraform Variables
# =============================================================================

# -----------------------------------------------------------------------------
# Database & Schema
# -----------------------------------------------------------------------------

variable "database_name" {
  description = "Name of the Snowflake database"
  type        = string
  default     = "FLUX_OPS_CENTER"
}

variable "schema_name" {
  description = "Name of the Snowflake schema"
  type        = string
  default     = "PUBLIC"
}

variable "create_database" {
  description = "Whether to create the database (false to use existing)"
  type        = bool
  default     = true
}

variable "create_schema" {
  description = "Whether to create the schema (false to use existing)"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Warehouse
# -----------------------------------------------------------------------------

variable "warehouse_name" {
  description = "Name of the Snowflake warehouse"
  type        = string
  default     = "FLUX_OPS_CENTER_WH"
}

variable "warehouse_size" {
  description = "Size of the warehouse (XSMALL, SMALL, MEDIUM, LARGE, etc.)"
  type        = string
  default     = "XSMALL"
}

variable "create_warehouse" {
  description = "Whether to create the warehouse (false to use existing)"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Image Repository
# -----------------------------------------------------------------------------

variable "image_repository_name" {
  description = "Name of the image repository for SPCS"
  type        = string
  default     = "FLUX_OPS_CENTER_REPO"
}

# -----------------------------------------------------------------------------
# Compute Pool
# -----------------------------------------------------------------------------

variable "compute_pool_name" {
  description = "Name of the SPCS compute pool"
  type        = string
  default     = "FLUX_OPS_CENTER_POOL"
}

variable "create_compute_pool" {
  description = "Whether to create the compute pool (false to use existing)"
  type        = bool
  default     = true
}

variable "compute_pool_instance_family" {
  description = "Instance family for compute pool (CPU_X64_XS, CPU_X64_S, CPU_X64_M, GPU_NV_S, etc.)"
  type        = string
  default     = "CPU_X64_S"
}

variable "compute_pool_min_nodes" {
  description = "Minimum number of nodes in compute pool"
  type        = number
  default     = 1
}

variable "compute_pool_max_nodes" {
  description = "Maximum number of nodes in compute pool"
  type        = number
  default     = 2
}

variable "compute_pool_auto_suspend_secs" {
  description = "Auto-suspend timeout in seconds"
  type        = number
  default     = 300
}

# -----------------------------------------------------------------------------
# Stage
# -----------------------------------------------------------------------------

variable "stage_name" {
  description = "Name of the stage for service specifications"
  type        = string
  default     = "FLUX_OPS_CENTER_STAGE"
}

# -----------------------------------------------------------------------------
# Service Role
# -----------------------------------------------------------------------------

variable "service_role_name" {
  description = "Name of the service role"
  type        = string
  default     = "FLUX_OPS_CENTER_SERVICE_ROLE"
}

variable "create_service_role" {
  description = "Whether to create the service role"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project" {
  description = "Project name for tagging"
  type        = string
  default     = "flux-ops-center"
}

# -----------------------------------------------------------------------------
# Snowflake Postgres (Dual-Backend Architecture)
# -----------------------------------------------------------------------------
# Flux Ops Center uses Snowflake Postgres for real-time operational queries
# and PostGIS geospatial capabilities alongside Snowflake for analytics.

variable "create_postgres" {
  description = "Whether to set up Snowflake Postgres (network policy + instance SQL output)"
  type        = bool
  default     = true
}

variable "postgres_instance_name" {
  description = "Name of the Snowflake Postgres instance"
  type        = string
  default     = "FLUX_OPS_POSTGRES"
}

variable "postgres_compute_family" {
  description = "Compute family for Postgres instance (HIGHMEM_XL recommended for geospatial/PostGIS workloads)"
  type        = string
  default     = "HIGHMEM_XL"
}

variable "postgres_storage_gb" {
  description = "Storage size in GB (10-65535)"
  type        = number
  default     = 100
  
  validation {
    condition     = var.postgres_storage_gb >= 10 && var.postgres_storage_gb <= 65535
    error_message = "Postgres storage must be between 10 and 65535 GB."
  }
}

variable "postgres_version" {
  description = "PostgreSQL version (16, 17, or 18)"
  type        = number
  default     = 17
  
  validation {
    condition     = contains([16, 17, 18], var.postgres_version)
    error_message = "Postgres version must be 16, 17, or 18."
  }
}

variable "postgres_high_availability" {
  description = "Enable high availability for Postgres instance"
  type        = bool
  default     = false
}

variable "postgres_network_cidr" {
  description = "CIDR range for Postgres network access (0.0.0.0/0 allows all - restrict in production)"
  type        = string
  default     = "0.0.0.0/0"
}
