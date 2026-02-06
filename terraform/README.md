# Terraform Deployment

Deploy Flux Operations Center using Terraform.

**[Full Documentation →](../docs/deployment/TERRAFORM.md)**

---

## Quick Start

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars
terraform init
terraform apply
```

## After Terraform

1. **Push Docker image** - See [Docker Images Guide](../docs/DOCKER_IMAGES.md)
2. **Set up Postgres** - Run output from `terraform output postgres_setup_sql`
3. **Load PostGIS data** - `python backend/scripts/load_postgis_data.py`
4. **Create SPCS service** - Run output from `terraform output spcs_setup_sql`

## Files

| File | Purpose |
|------|---------|
| `main.tf` | Main Terraform configuration |
| `variables.tf` | Input variables |
| `outputs.tf` | Output values |
| `terraform.tfvars.example` | Example configuration |

## See Also

- [Full Terraform Guide](../docs/deployment/TERRAFORM.md)
- [Docker Images](../docs/DOCKER_IMAGES.md)
- [All Deployment Options](../docs/deployment/)
