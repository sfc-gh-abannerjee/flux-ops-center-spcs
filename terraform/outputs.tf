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

output "stage_name" {
  description = "Name of the stage"
  value       = snowflake_stage.ops_center_stage.name
}

# =============================================================================
# SPCS Setup SQL
# =============================================================================
# The Snowflake Terraform provider does not support SPCS resources.
# Run this SQL after terraform apply to complete the setup.

output "spcs_setup_sql" {
  description = "SQL commands to create SPCS resources (run after terraform apply)"
  value       = <<-EOT
    -- =======================================================================
    -- SPCS Setup SQL for Flux Operations Center
    -- Run these commands after terraform apply completes
    -- =======================================================================

    USE ROLE ACCOUNTADMIN;
    USE DATABASE ${local.database_name};
    USE SCHEMA ${local.schema_name};

    -- 1. Create Image Repository
    CREATE IMAGE REPOSITORY IF NOT EXISTS ${var.image_repository_name}
      COMMENT = 'Container images for Flux Operations Center';

    -- 2. Create Compute Pool
    CREATE COMPUTE POOL IF NOT EXISTS ${var.compute_pool_name}
      MIN_NODES = ${var.compute_pool_min_nodes}
      MAX_NODES = ${var.compute_pool_max_nodes}
      INSTANCE_FAMILY = ${var.compute_pool_instance_family}
      AUTO_RESUME = TRUE
      AUTO_SUSPEND_SECS = ${var.compute_pool_auto_suspend_secs}
      COMMENT = 'Compute pool for Flux Operations Center SPCS';

    -- 3. Create External Access Integrations (required for basemap tiles and fonts)
    
    -- CARTO Network Rule (basemap tiles)
    CREATE NETWORK RULE IF NOT EXISTS FLUX_CARTO_NETWORK_RULE
      TYPE = HOST_PORT
      VALUE_LIST = (
        'basemaps.cartocdn.com:443',
        'tiles.basemaps.cartocdn.com:443',
        'tiles-a.basemaps.cartocdn.com:443',
        'tiles-b.basemaps.cartocdn.com:443',
        'tiles-c.basemaps.cartocdn.com:443',
        'tiles-d.basemaps.cartocdn.com:443',
        'a.basemaps.cartocdn.com:443',
        'b.basemaps.cartocdn.com:443',
        'c.basemaps.cartocdn.com:443',
        'd.basemaps.cartocdn.com:443',
        'unpkg.com:443'
      )
      MODE = EGRESS
      COMMENT = 'Allows map tile loading from CARTO CDN';
    
    CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS FLUX_CARTO_INTEGRATION
      ALLOWED_NETWORK_RULES = (${local.database_name}.${local.schema_name}.FLUX_CARTO_NETWORK_RULE)
      ENABLED = TRUE
      COMMENT = 'External access for CARTO basemap tiles';
    
    GRANT USAGE ON INTEGRATION FLUX_CARTO_INTEGRATION TO ROLE SYSADMIN;
    
    -- Google Fonts Network Rule (UI typography)
    CREATE NETWORK RULE IF NOT EXISTS FLUX_GOOGLE_FONTS_NETWORK_RULE
      TYPE = HOST_PORT
      VALUE_LIST = (
        'fonts.googleapis.com:443',
        'fonts.gstatic.com:443'
      )
      MODE = EGRESS
      COMMENT = 'Allows Google Fonts loading';
    
    CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS GOOGLE_FONTS_EAI
      ALLOWED_NETWORK_RULES = (${local.database_name}.${local.schema_name}.FLUX_GOOGLE_FONTS_NETWORK_RULE)
      ENABLED = TRUE
      COMMENT = 'External access for Google Fonts';
    
    GRANT USAGE ON INTEGRATION GOOGLE_FONTS_EAI TO ROLE SYSADMIN;

    -- 4. Get Repository URL (for docker push)
    SHOW IMAGE REPOSITORIES LIKE '${var.image_repository_name}';
    -- Copy the repository_url from output for docker commands

    -- 5. After pushing image AND setting up Postgres, create the service:
    -- NOTE: Replace <POSTGRES_HOST> with host from SHOW POSTGRES INSTANCES
    /*
    CREATE SERVICE IF NOT EXISTS FLUX_OPS_CENTER_SERVICE
      IN COMPUTE POOL ${var.compute_pool_name}
      FROM SPECIFICATION $$
    spec:
      containers:
        - name: flux-ops-center
          image: /${local.database_name}/${local.schema_name}/${var.image_repository_name}/flux_ops_center:latest
          env:
            SNOWFLAKE_DATABASE: ${local.database_name}
            SNOWFLAKE_WAREHOUSE: ${var.create_warehouse ? var.warehouse_name : "YOUR_WAREHOUSE"}
            SNOWFLAKE_SCHEMA: PRODUCTION
            APPLICATIONS_SCHEMA: APPLICATIONS
            ML_SCHEMA: ML_DEMO
            CASCADE_SCHEMA: CASCADE_ANALYSIS
            VITE_POSTGRES_HOST: <POSTGRES_HOST>
            VITE_POSTGRES_PORT: "5432"
            VITE_POSTGRES_DATABASE: postgres
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
      EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI)
      COMMENT = 'Flux Operations Center - Real-time Grid Visualization';
    */
  EOT
}

output "docker_commands" {
  description = "Docker commands to build and push the image"
  value       = <<-EOT
    # 1. Login to Snowflake registry (get URL from: SHOW IMAGE REPOSITORIES)
    docker login <org>-<account>.registry.snowflakecomputing.com

    # 2. Build the image
    cd spcs_app
    docker build -t flux_ops_center:latest .

    # 3. Tag for Snowflake
    docker tag flux_ops_center:latest \
      <org>-<account>.registry.snowflakecomputing.com/${local.database_name}/${local.schema_name}/${var.image_repository_name}/flux_ops_center:latest

    # 4. Push to Snowflake
    docker push \
      <org>-<account>.registry.snowflakecomputing.com/${local.database_name}/${local.schema_name}/${var.image_repository_name}/flux_ops_center:latest
  EOT
}

# =============================================================================
# Snowflake Postgres Setup SQL
# =============================================================================
# The Snowflake Terraform provider does not support CREATE POSTGRES INSTANCE.
# Run this SQL after terraform apply to create the Postgres instance.

output "postgres_setup_sql" {
  description = "SQL to create Snowflake Postgres instance (run after terraform apply)"
  value = var.create_postgres ? <<-EOT
    -- =======================================================================
    -- Snowflake Postgres Setup for Flux Operations Center
    -- Run these commands after terraform apply completes
    -- =======================================================================
    -- IMPORTANT: Save the credentials displayed after CREATE POSTGRES INSTANCE!
    --            They cannot be retrieved later.
    -- =======================================================================

    USE ROLE ACCOUNTADMIN;

    -- Create ingress rule with POSTGRES_INGRESS mode (required for Snowflake Postgres)
    -- Note: 0.0.0.0/0 allows all IPs - restrict to specific CIDRs in production
    CREATE NETWORK RULE IF NOT EXISTS ${local.database_name}.${local.schema_name}.${var.postgres_instance_name}_INGRESS_RULE
      TYPE = IPV4
      VALUE_LIST = ('${var.postgres_network_cidr}')
      MODE = POSTGRES_INGRESS
      COMMENT = 'Ingress rule for ${var.postgres_instance_name}';

    -- Create network policy with ingress rule only
    -- Note: Egress rules with 0.0.0.0/0 are not supported; add specific CIDRs if needed
    CREATE NETWORK POLICY IF NOT EXISTS ${var.postgres_instance_name}_NETWORK_POLICY
      ALLOWED_NETWORK_RULE_LIST = (
        ${local.database_name}.${local.schema_name}.${var.postgres_instance_name}_INGRESS_RULE
      )
      COMMENT = 'Network policy for ${var.postgres_instance_name}';

    -- Create Postgres instance
    -- SAVE THE CREDENTIALS SHOWN AFTER THIS COMMAND!
    CREATE POSTGRES INSTANCE IF NOT EXISTS ${var.postgres_instance_name}
      COMPUTE_FAMILY = '${var.postgres_compute_family}'
      STORAGE_SIZE_GB = ${var.postgres_storage_gb}
      AUTHENTICATION_AUTHORITY = POSTGRES
      POSTGRES_VERSION = ${var.postgres_version}
      NETWORK_POLICY = '${var.postgres_instance_name}_NETWORK_POLICY'
      HIGH_AVAILABILITY = ${var.postgres_high_availability ? "TRUE" : "FALSE"}
      COMMENT = 'Flux Ops Center operational database - PostGIS for geospatial queries';

    -- Show instance details (including host for connection)
    SHOW POSTGRES INSTANCES LIKE '${var.postgres_instance_name}';
  EOT
  : "# Postgres setup disabled (create_postgres = false)"
}

output "postgres_instance_name" {
  description = "Name of the Snowflake Postgres instance"
  value       = var.create_postgres ? var.postgres_instance_name : null
}

output "postgres_network_policy" {
  description = "Name of the Postgres network policy"
  value       = var.create_postgres ? "${var.postgres_instance_name}_NETWORK_POLICY" : null
}
