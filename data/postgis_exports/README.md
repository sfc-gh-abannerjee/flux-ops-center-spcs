# PostGIS Spatial Data Exports

This directory contains compressed CSV exports of static spatial data for the Flux Operations Center.

## Data Files

These files are **NOT stored in git** due to their size. Download from GitHub Releases.

### Core Spatial Layers (~330MB total compressed)

| File | Table | Rows | Size | Description |
|------|-------|------|------|-------------|
| `building_footprints.csv.gz` | `building_footprints` | 2,670,707 | ~310MB | Building polygons with height data |
| `osm_water.csv.gz` | `osm_water` | 12,758 | ~6MB | Water body polygons (rivers, lakes, bayous) |
| `grid_power_lines.csv.gz` | `grid_power_lines` | 13,104 | ~800KB | Power line geometries |
| `vegetation_risk.csv.gz` | `vegetation_risk` | 49,265 | ~4MB | Vegetation risk points near power lines |
| `substations.csv.gz` | `substations` | 275 | ~12KB | Substation locations |
| `transformers.csv.gz` | `transformers` | 91,554 | ~3MB | Transformer records |
| `customers_spatial.csv.gz` | `customers_spatial` | 100,000 | ~6MB | Customer locations |
| `meter_locations_enhanced.csv.gz` | `meter_locations_enhanced` | 100,000 | ~5MB | Meter locations |

### Cache/Derived Tables (~60MB total compressed)

| File | Table | Rows | Size | Description |
|------|-------|------|------|-------------|
| `grid_assets_cache.csv.gz` | `grid_assets_cache` | 726,263 | ~55MB | Unified asset cache for deck.gl |
| `topology_connections_cache.csv.gz` | `topology_connections_cache` | 153,592 | ~5MB | Network topology connections |

## Downloading Data

### Option 1: From GitHub Releases (Recommended)

```bash
# Download all data files from the latest release
RELEASE_URL="https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs/releases/latest/download"

curl -LO "$RELEASE_URL/building_footprints.csv.gz"
curl -LO "$RELEASE_URL/osm_water.csv.gz"
curl -LO "$RELEASE_URL/grid_power_lines.csv.gz"
curl -LO "$RELEASE_URL/vegetation_risk.csv.gz"
curl -LO "$RELEASE_URL/substations.csv.gz"
curl -LO "$RELEASE_URL/transformers.csv.gz"
curl -LO "$RELEASE_URL/customers_spatial.csv.gz"
curl -LO "$RELEASE_URL/meter_locations_enhanced.csv.gz"
curl -LO "$RELEASE_URL/grid_assets_cache.csv.gz"
curl -LO "$RELEASE_URL/topology_connections_cache.csv.gz"
```

### Option 2: Using gh CLI

```bash
gh release download --pattern "*.csv.gz" --dir ./data/postgis_exports
```

## Loading Data

Use the provided Python script to load data into your Postgres instance:

```bash
# Load all layers
python backend/scripts/load_postgis_data.py \
  --service your_pg_service \
  --local-data ./data/postgis_exports

# Load specific layers only
python backend/scripts/load_postgis_data.py \
  --service your_pg_service \
  --local-data ./data/postgis_exports \
  --layers buildings water powerlines vegetation

# Available layer keys:
#   Core: buildings, water, powerlines, vegetation, substations, transformers, customers, meters
#   Cache: grid_assets, topology
```

## Creating a GitHub Release (Maintainers Only)

When you need to update the data files:

```bash
# 1. Export data from production Postgres (if needed)
# See backend/scripts/export_postgis_data.sh

# 2. Create and push a tag
git tag -a v1.0.0-data -m "PostGIS data export - February 2026"
git push origin v1.0.0-data

# 3. Create release and upload files
gh release create v1.0.0-data \
  --title "PostGIS Spatial Data v1.0.0" \
  --notes "Static spatial data for Flux Operations Center PostGIS setup." \
  ./data/postgis_exports/*.csv.gz

# 4. Update load_postgis_data.py with new release tag
# Edit GITHUB_REPO and RELEASE_TAG at top of file
```

## Data Source

This data was exported from the production Flux Operations Postgres instance:
- Host: `mthi2s7canh3xpfhyzdhuuj7pu...snowflake.app`
- Contains cleaned and adjusted building footprints with proper polygon geometries
- Water body polygons from OpenStreetMap
- Power grid line geometries
- Vegetation risk analysis results

## Why Not Sync from Snowflake?

These layers are **static reference data** that rarely changes:

1. **Different geometry types**: Snowflake has point geometries, Postgres has full polygon footprints
2. **Performance**: Bulk COPY is 10-100x faster than row-by-row sync
3. **Simplicity**: No need for Snowflake connectivity or stored procedures
4. **Data quality**: Production Postgres has cleaned/adjusted data

For **dynamic data** (outages, work orders), use the Snowflake sync procedures instead.

