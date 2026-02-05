# Flux Operations Center - Database Dependencies

Flux Operations Center requires database objects that are created by **[flux-utility-solutions](https://github.com/sfc-gh-abannerjee/flux-utility-solutions)**.

## Important: Deploy flux-utility-solutions First

This directory previously contained a standalone DDL script, but to ensure consistency across the Flux Utility Platform and avoid duplication, all database objects are now managed in the **flux-utility-solutions** repository.

## Deployment Steps

### Step 1: Deploy Core Platform (flux-utility-solutions)

```bash
# Clone the core platform
git clone https://github.com/sfc-gh-abannerjee/flux-utility-solutions.git
cd flux-utility-solutions

# Deploy database infrastructure
snow sql -f scripts/01_database_infrastructure.sql \
    -D "database=FLUX_DB" \
    -D "admin_role=ACCOUNTADMIN" \
    -D "user_role=PUBLIC" \
    -c your_connection_name

# Deploy warehouses
snow sql -f scripts/02_warehouses.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -D "warehouse_size=MEDIUM" \
    -c your_connection_name

# Deploy core tables (substations, transformers, meters, etc.)
for script in 03 04 05 06 07; do
    snow sql -f scripts/${script}_*.sql \
        -D "database=FLUX_DB" \
        -D "warehouse=FLUX_WH" \
        -c your_connection_name
done
```

### Step 2: Deploy Ops Center Dependencies

```bash
# Still in flux-utility-solutions directory
snow sql -f scripts/30_ops_center_dependencies.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -D "admin_role=ACCOUNTADMIN" \
    -D "user_role=PUBLIC" \
    -c your_connection_name
```

This creates all Ops Center-specific objects:

| Schema | Objects Created |
|--------|-----------------|
| `APPLICATIONS` | FLUX_OPS_CENTER_KPIS, FLUX_OPS_CENTER_TOPOLOGY, FLUX_OPS_CENTER_TOPOLOGY_NODES, FLUX_OPS_CENTER_SERVICE_AREAS_MV, VEGETATION_RISK_COMPUTED, CIRCUIT_STATUS_REALTIME |
| `ML_DEMO` | GRID_NODES, GRID_EDGES, T_TRANSFORMER_TEMPORAL_TRAINING, V_TRANSFORMER_ML_INFERENCE |
| `CASCADE_ANALYSIS` | NODE_CENTRALITY_FEATURES_V2, PRECOMPUTED_CASCADES, GNN_PREDICTIONS |

### Step 3: Deploy SPCS Service (this repo)

```bash
# Return to flux_ops_center_spcs directory
cd ../flux_ops_center_spcs

# Deploy SPCS infrastructure
snow sql -f scripts/sql/01_image_repository.sql \
    -D "database=FLUX_DB" -D "schema=PUBLIC" \
    -D "image_repo=FLUX_OPS_CENTER_IMAGES" \
    -c your_connection_name

# Push Docker image, then create compute pool and service
# See scripts/sql/README.md for complete instructions
```

## Schema Overview

### PRODUCTION Schema (from flux-utility-solutions)

Core grid infrastructure data consumed by Ops Center:

| Table | Description |
|-------|-------------|
| `SUBSTATIONS` | Electrical substations (root of grid hierarchy) |
| `TRANSFORMER_METADATA` | Distribution transformers with CIM attributes |
| `CIRCUIT_METADATA` | Electrical circuits connecting transformers |
| `METER_INFRASTRUCTURE` | Smart meters with geographic data |
| `AMI_INTERVAL_READINGS` | AMI usage data (time-series) |
| `CUSTOMERS_MASTER_DATA` | Customer records |
| `TRANSFORMER_HOURLY_LOAD` | Aggregated transformer load |

### APPLICATIONS Schema (from flux-utility-solutions)

Ops Center views created by `30_ops_center_dependencies.sql`:

| View | Description |
|------|-------------|
| `FLUX_OPS_CENTER_KPIS` | Dashboard KPIs (total customers, outages, load) |
| `FLUX_OPS_CENTER_TOPOLOGY` | Grid connectivity graph (edges) |
| `FLUX_OPS_CENTER_TOPOLOGY_NODES` | Grid asset nodes |
| `FLUX_OPS_CENTER_TOPOLOGY_METRO` | Substation-level aggregations |
| `FLUX_OPS_CENTER_TOPOLOGY_FEEDERS` | Feeder/circuit details |
| `FLUX_OPS_CENTER_SERVICE_AREAS_MV` | Service area summaries |
| `VEGETATION_RISK_COMPUTED` | Tree proximity risk analysis |
| `CIRCUIT_STATUS_REALTIME` | Real-time circuit status |

### ML_DEMO Schema (from flux-utility-solutions)

Machine learning objects for GNN cascade analysis:

| Object | Description |
|--------|-------------|
| `GRID_NODES` | Graph nodes for GNN |
| `GRID_EDGES` | Graph edges for GNN |
| `T_TRANSFORMER_TEMPORAL_TRAINING` | ML training data |
| `V_TRANSFORMER_ML_INFERENCE` | Latest predictions view |

### CASCADE_ANALYSIS Schema (from flux-utility-solutions)

Pre-computed cascade failure analysis:

| Table | Description |
|-------|-------------|
| `NODE_CENTRALITY_FEATURES_V2` | GNN centrality features |
| `PRECOMPUTED_CASCADES` | Simulated cascade scenarios |
| `GNN_PREDICTIONS` | Real-time GNN model outputs |

## Why This Architecture?

1. **Single Source of Truth** - All data objects defined in one place (flux-utility-solutions)
2. **No Duplication** - Avoids conflicts between repos
3. **Consistent Parameterization** - All scripts use `<% variable %>` Jinja2 syntax
4. **Multiple Deployment Paths** - CLI, Terraform, Git Integration all supported
5. **Clear Dependencies** - Flux Ops Center explicitly depends on flux-utility-solutions

## Related Documentation

- [flux-utility-solutions](https://github.com/sfc-gh-abannerjee/flux-utility-solutions) - Core platform
- [scripts/sql/README.md](../scripts/sql/README.md) - SPCS deployment scripts
- [SPCS Documentation](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview)
