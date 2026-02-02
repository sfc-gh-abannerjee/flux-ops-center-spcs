# =============================================================================
# Flux Operations Center - Terraform Outputs
# =============================================================================

output "database_name" {
  description = "Name of the database"
  value       = local.database_name
}

output "schema_name" {
  description = "Name of the schema"
  value       = local.schema_name
}

output "warehouse_name" {
  description = "Name of the warehouse"
  value       = var.create_warehouse ? snowflake_warehouse.ops_center_wh[0].name : var.warehouse_name
}

output "image_repository_name" {
  description = "Name of the image repository"
  value       = snowflake_image_repository.ops_center_repo.name
}

output "image_repository_url" {
  description = "Full URL for docker push"
  value       = "${snowflake_image_repository.ops_center_repo.repository_url}"
}

output "compute_pool_name" {
  description = "Name of the compute pool"
  value       = local.compute_pool_name
}

output "stage_name" {
  description = "Name of the stage"
  value       = snowflake_stage.ops_center_stage.name
}

output "docker_login_command" {
  description = "Command to login to Snowflake image registry"
  value       = "docker login ${split("/", snowflake_image_repository.ops_center_repo.repository_url)[0]}"
}

output "docker_push_command" {
  description = "Command to push the Ops Center image"
  value       = "docker push ${snowflake_image_repository.ops_center_repo.repository_url}/flux_ops_center:latest"
}

output "create_service_sql" {
  description = "SQL to create the SPCS service (run after pushing image)"
  value       = <<-EOT
    CREATE SERVICE IF NOT EXISTS FLUX_OPS_CENTER_SERVICE
      IN COMPUTE POOL ${local.compute_pool_name}
      FROM SPECIFICATION $$
    spec:
      containers:
        - name: flux-ops-center
          image: /${local.database_name}/${local.schema_name}/${var.image_repository_name}/flux_ops_center:latest
          resources:
            requests:
              cpu: 2
              memory: 4Gi
            limits:
              cpu: 4
              memory: 8Gi
      endpoints:
        - name: app
          port: 8080
          public: true
    $$
      COMMENT = 'Flux Operations Center - Real-time Grid Visualization';
  EOT
}
