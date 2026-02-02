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
