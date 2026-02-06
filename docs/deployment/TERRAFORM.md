# Terraform Deployment

Deploy Flux Operations Center infrastructure using Terraform.

**Best for:** Enterprise deployments, multi-environment management, Infrastructure as Code.

---

## Prerequisites

- Terraform >= 1.0.0
- Snowflake account with ACCOUNTADMIN privileges
- Docker for pushing images (or use [pre-built images](../DOCKER_IMAGES.md))

---

## Quick Start

```bash
cd terraform

# Configure variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Deploy
terraform init
terraform plan
terraform apply
```

---

## Authentication

Set environment variables for the Snowflake provider:

```bash
# Password auth
export SNOWFLAKE_ACCOUNT="your-org-your-account"
export SNOWFLAKE_USER="your_username"
export SNOWFLAKE_PASSWORD="your_password"

# Or key-pair auth (recommended for automation)
export SNOWFLAKE_ACCOUNT="your-org-your-account"
export SNOWFLAKE_USER="your_username"
export SNOWFLAKE_PRIVATE_KEY_PATH="~/.ssh/snowflake_key.p8"
```

---

## What Gets Created

| Resource | Name | Description |
|----------|------|-------------|
| Database | `FLUX_OPS_CENTER` | Main database |
| Schema | `PUBLIC` | Schema for objects |
| Warehouse | `FLUX_OPS_CENTER_WH` | Query warehouse |
| Image Repository | `FLUX_OPS_CENTER_REPO` | For Docker images |
| Compute Pool | `FLUX_OPS_CENTER_POOL` | SPCS compute |
| Stage | `FLUX_OPS_CENTER_STAGE` | For service specs |

---

## Post-Terraform Steps

Terraform creates infrastructure but doesn't deploy the application. Complete these steps:

### 1. Push Docker Image

```bash
# Get registry info from terraform output
terraform output docker_login_command
terraform output docker_push_command

# Option A: Use pre-built image (recommended)
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
docker tag ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main <registry_url>/flux-ops-center:latest
docker push <registry_url>/flux-ops-center:latest

# Option B: Build locally
docker build -t flux-ops-center:latest .
docker tag flux-ops-center:latest <registry_url>/flux-ops-center:latest
docker push <registry_url>/flux-ops-center:latest
```

### 2. Set Up Snowflake Postgres

```bash
# Get Postgres setup SQL
terraform output postgres_setup_sql

# Run in Snowflake (save credentials!)
```

### 3. Load PostGIS Data

```bash
python backend/scripts/load_postgis_data.py --service flux_ops_postgres
```

This loads ~390MB of spatial data and automatically creates derived views:
- `buildings_spatial` - Building footprints with centroid coordinates
- `grid_assets` - Asset locations for risk analysis
- `vegetation_risk_computed` - Pre-computed vegetation risk with spatial joins

### 4. Create SPCS Service

```bash
# Get service creation SQL
terraform output spcs_setup_sql

# Update <POSTGRES_HOST> placeholder and run
```

### 5. Get Service URL

```sql
SHOW ENDPOINTS IN SERVICE FLUX_OPS_CENTER_SERVICE;
```

---

## Configuration Options

### terraform.tfvars

```hcl
# Required
snowflake_account = "your-org-your-account"
snowflake_region  = "us-west-2"

# Optional - use existing resources
create_database     = true
database_name       = "FLUX_OPS_CENTER"

create_warehouse    = true
warehouse_name      = "FLUX_OPS_CENTER_WH"
warehouse_size      = "XSMALL"

create_compute_pool = true
compute_pool_name   = "FLUX_OPS_CENTER_POOL"
compute_pool_family = "CPU_X64_S"
compute_pool_min    = 1
compute_pool_max    = 2
```

### Using Existing Resources

```hcl
# Don't create new database, use existing
create_database = false
database_name   = "MY_EXISTING_DB"

# Don't create new warehouse, use existing
create_warehouse = false
warehouse_name   = "MY_EXISTING_WH"

# Don't create new compute pool, use existing
create_compute_pool = false
compute_pool_name   = "MY_EXISTING_POOL"
```

### GPU Compute Pool

For ML workloads requiring GPU:

```hcl
compute_pool_family = "GPU_NV_S"
```

---

## Outputs

```bash
# View all outputs
terraform output

# Specific outputs
terraform output docker_login_command
terraform output docker_push_command
terraform output postgres_setup_sql
terraform output spcs_setup_sql
terraform output service_url
```

---

## Cleanup

```bash
# First, drop the service (required before destroying)
snow sql -q "DROP SERVICE IF EXISTS FLUX_OPS_CENTER_SERVICE"

# Then destroy infrastructure
terraform destroy
```

**Warning:** This deletes all resources including data. Back up first.

---

## Multi-Environment Setup

Create separate tfvars for each environment:

```bash
terraform/
├── terraform.tfvars.dev
├── terraform.tfvars.staging
└── terraform.tfvars.prod
```

Deploy to specific environment:

```bash
# Development
terraform plan -var-file="terraform.tfvars.dev"
terraform apply -var-file="terraform.tfvars.dev"

# Production
terraform plan -var-file="terraform.tfvars.prod"
terraform apply -var-file="terraform.tfvars.prod"
```

---

## Troubleshooting

### "Provider error: insufficient privileges"

Ensure your user has ACCOUNTADMIN or equivalent role.

### "Resource already exists"

Set `create_*` to `false` and provide existing resource names.

### Terraform state issues

```bash
# Refresh state
terraform refresh

# Import existing resource
terraform import snowflake_database.main FLUX_OPS_CENTER
```

---

## See Also

- [Quick Start](./QUICKSTART.md) - Automated deployment
- [Docker Images](../DOCKER_IMAGES.md) - Pre-built images
- [CLI Scripts](./CLI_SCRIPTS.md) - Manual SQL deployment
- [Snowflake Terraform Provider Docs](https://registry.terraform.io/providers/Snowflake-Labs/snowflake/latest/docs)
