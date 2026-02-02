# Flux Operations Center - Terraform Deployment

This directory contains Terraform configuration for deploying Flux Operations Center infrastructure to Snowflake.

## Prerequisites

1. **Terraform** >= 1.0.0 installed
2. **Snowflake account** with ACCOUNTADMIN or appropriate privileges
3. **Snowflake Terraform provider** authentication configured

## Authentication

Configure the Snowflake provider by setting environment variables:

```bash
export SNOWFLAKE_ACCOUNT="your-org-your-account"
export SNOWFLAKE_USER="your_username"
export SNOWFLAKE_PASSWORD="your_password"
# Or use key-pair authentication:
export SNOWFLAKE_PRIVATE_KEY_PATH="~/.ssh/snowflake_key.p8"
```

## Quick Start

```bash
# 1. Navigate to terraform directory
cd terraform

# 2. Copy and customize variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# 3. Initialize Terraform
terraform init

# 4. Preview changes
terraform plan

# 5. Apply infrastructure
terraform apply
```

## What Gets Created

| Resource | Description |
|----------|-------------|
| Database | `FLUX_OPS_CENTER` - Main database |
| Schema | `PUBLIC` - Schema for all objects |
| Warehouse | `FLUX_OPS_CENTER_WH` - Query warehouse |
| Image Repository | `FLUX_OPS_CENTER_REPO` - For Docker images |
| Compute Pool | `FLUX_OPS_CENTER_POOL` - SPCS compute |
| Stage | `FLUX_OPS_CENTER_STAGE` - For service specs |
| Tables | Grid infrastructure tables |

## Post-Terraform Steps

After `terraform apply`, you need to:

### 1. Build and Push Docker Image

```bash
# Get the registry URL from terraform output
terraform output docker_login_command
terraform output docker_push_command

# Build the image
cd ..
docker build -t flux_ops_center:latest -f Dockerfile.spcs .

# Login and push
docker login <registry_url>
docker tag flux_ops_center:latest <full_repo_url>/flux_ops_center:latest
docker push <full_repo_url>/flux_ops_center:latest
```

### 2. Create the SPCS Service

```bash
# Get the CREATE SERVICE SQL
terraform output create_service_sql

# Run in Snowflake Worksheets or via SnowSQL
```

### 3. Get Service URL

```sql
SHOW ENDPOINTS IN SERVICE FLUX_OPS_CENTER_SERVICE;
```

## Customization

### Using Existing Resources

To use existing database/warehouse instead of creating new ones:

```hcl
# terraform.tfvars
create_database  = false
database_name    = "MY_EXISTING_DB"

create_warehouse = false
warehouse_name   = "MY_EXISTING_WH"

create_compute_pool = false
compute_pool_name   = "MY_EXISTING_POOL"
```

### GPU Compute Pool

For ML workloads requiring GPU:

```hcl
compute_pool_instance_family = "GPU_NV_S"
```

## Cleanup

```bash
# Destroy all resources (WARNING: This deletes everything!)
terraform destroy
```

**Note:** The SPCS service must be dropped manually before destroying:

```sql
DROP SERVICE IF EXISTS FLUX_OPS_CENTER_SERVICE;
```

## Related Documentation

- [Snowflake Terraform Provider](https://registry.terraform.io/providers/Snowflake-Labs/snowflake/latest/docs)
- [SPCS Documentation](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview)
- [Flux Utility Platform](https://github.com/sfc-gh-abannerjee/flux-utility-solutions)
