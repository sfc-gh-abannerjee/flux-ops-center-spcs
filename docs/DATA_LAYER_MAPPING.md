# Flux Operations Center - Spatial Data Layer Mapping

> **Last Validated**: February 2026
> 
> This document maps Snowflake source tables to Postgres PostGIS tables for spatial visualization
> in the Flux Operations Center SPCS-hosted React application.

## Overview

The Flux Operations Center displays 8 spatial layers on a 3D map powered by **deck.gl 9.2** with MapLibre GL.
Data flows from Snowflake (source of truth) to Snowflake Managed Postgres (PostGIS cache)
for fast spatial queries (<20ms).

```
Snowflake (Analytics) → Bulk Load / Sync → Postgres (PostGIS) → React App (deck.gl)
```

---

## Production Instances

| Type | Instance Name | Host |
|------|---------------|------|
| **Snowflake** | `FLUX_DB.PRODUCTION` | GZB42423.snowflakecomputing.com |
| **Postgres** | `FLUX_OPERATIONS_POSTGRES` | mthi2s7canh3xpfhyzdhuuj7pu...snowflake.app |

---

## Spatial Layers

### 1. Building Footprints (3D Buildings)

| Property | Value |
|----------|-------|
| **Rows** | 2,670,707 |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.HOUSTON_BUILDINGS_CLEAN` |
| **Postgres Target** | `building_footprints` |
| **Geometry Type** | Polygon (4326) |
| **3D Extrusion** | `height_meters` column for building height |

**Column Mapping:**
| Snowflake Column | Postgres Column | Type |
|------------------|-----------------|------|
| BUILDING_ID | building_id | VARCHAR(50) PK |
| BUILDING_NAME | building_name | VARCHAR(255) |
| BUILDING_TYPE | building_type | VARCHAR(50) |
| HEIGHT_METERS | height_meters | DOUBLE |
| NUM_FLOORS | num_floors | INTEGER |
| LOCATION (Geography) | geom | Polygon(4326) |

**deck.gl Usage:**
```javascript
// 3D building extrusion with PolygonLayer
new PolygonLayer({
  id: 'buildings-3d',
  data: buildingsGeoJSON.features,
  extruded: true,
  getPolygon: d => d.geometry.coordinates,
  getElevation: d => d.properties.height_meters,
  getFillColor: [170, 170, 170],
  material: true
});
```

---

### 2. Power Lines

| Property | Value |
|----------|-------|
| **Rows** | 13,104 |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.GRID_POWER_LINES` |
| **Postgres Target** | `grid_power_lines` |
| **Geometry Type** | LineString (4326) |

**Column Mapping:**
| Snowflake Column | Postgres Column | Type |
|------------------|-----------------|------|
| LINE_ID | line_id | VARCHAR(100) PK |
| CIRCUIT_ID | circuit_id | VARCHAR(100) |
| SUBSTATION_ID | substation_id | VARCHAR(50) |
| LINE_TYPE | line_type | VARCHAR(50) |
| VOLTAGE_CLASS | voltage_class | VARCHAR(20) |
| TRANSFORMER_COUNT | transformer_count | INTEGER |
| METERS_SERVED | meters_served | INTEGER |
| LINE_LENGTH_M | line_length_m | DOUBLE |
| GEOMETRY | geom | LineString(4326) |

**deck.gl Usage:**
```javascript
// Power lines styled by voltage class with PathLayer
new PathLayer({
  id: 'power-lines',
  data: powerLinesGeoJSON.features,
  getPath: d => d.geometry.coordinates,
  getColor: d => {
    const voltage = d.properties.voltage_class;
    if (voltage === 'HIGH') return [255, 0, 0];
    if (voltage === 'MEDIUM') return [255, 136, 0];
    return [0, 255, 0];
  },
  getWidth: 2,
  widthUnits: 'pixels'
});
```

---

### 3. Vegetation Risk (Trees)

| Property | Value |
|----------|-------|
| **Rows** | 49,265 |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.VEGETATION_POWER_LINE_RISK` |
| **Postgres Target** | `vegetation_risk` |
| **Geometry Type** | Point (4326) |

**Column Mapping:**
| Snowflake Column | Postgres Column | Type |
|------------------|-----------------|------|
| TREE_ID | tree_id | VARCHAR(100) PK |
| CLASS | class | VARCHAR(50) |
| SUBTYPE | subtype | VARCHAR(100) |
| LONGITUDE | longitude | DOUBLE |
| LATITUDE | latitude | DOUBLE |
| HEIGHT_M | height_m | DOUBLE |
| CANOPY_RADIUS_M | canopy_radius_m | DOUBLE |
| RISK_SCORE | risk_score | DOUBLE |
| RISK_LEVEL | risk_level | VARCHAR(20) |
| DISTANCE_TO_LINE_M | distance_to_line_m | DOUBLE |
| NEAREST_LINE_ID | nearest_line_id | VARCHAR(100) |
| NEAREST_LINE_VOLTAGE_KV | nearest_line_voltage_kv | DOUBLE |
| CLEARANCE_DEFICIT_M | clearance_deficit_m | DOUBLE |
| YEARS_TO_ENCROACHMENT | years_to_encroachment | DOUBLE |
| DATA_SOURCE | data_source | VARCHAR(100) |
| (computed) | geom | Point(4326) |

**deck.gl Usage:**
```javascript
// Vegetation risk with ScatterplotLayer (color by risk score)
new ScatterplotLayer({
  id: 'vegetation-risk',
  data: vegetationGeoJSON.features,
  getPosition: d => d.geometry.coordinates,
  getFillColor: d => {
    const risk = d.properties.risk_score;
    // Green → Yellow → Red gradient
    return [255 * risk, 255 * (1 - risk), 0];
  },
  getRadius: d => 5 + d.properties.canopy_radius_m,
  radiusUnits: 'meters',
  opacity: 0.8
});
```

---

### 4. Water Bodies

| Property | Value |
|----------|-------|
| **Rows** | 12,758 |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.HOUSTON_WATER_BODIES` |
| **Postgres Target** | `osm_water` |
| **Geometry Type** | Geometry (4326) - MultiPolygon |

**Column Mapping:**
| Snowflake Column | Postgres Column | Type |
|------------------|-----------------|------|
| ID | osm_id | BIGINT |
| NAMES:primary | name | VARCHAR(255) |
| (derived) | water_type | VARCHAR(50) |
| (computed) | acres | NUMERIC(12,2) |
| GEOMETRY | geom | Geometry(4326) |

**deck.gl Usage:**
```javascript
// Water body polygons with GeoJsonLayer
new GeoJsonLayer({
  id: 'water-bodies',
  data: waterGeoJSON,
  filled: true,
  getFillColor: [74, 144, 217, 150],
  stroked: false
});
```

---

### 5. Substations

| Property | Value |
|----------|-------|
| **Rows** | 275 |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.SUBSTATIONS` |
| **Postgres Target** | `substations` |
| **Geometry Type** | Point (4326) |

---

### 6. Transformers

| Property | Value |
|----------|-------|
| **Rows** | 91,554 |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.TRANSFORMER_METADATA` |
| **Postgres Target** | `transformers` |
| **Geometry Type** | Point (4326) |

---

### 7. Meters

| Property | Value |
|----------|-------|
| **Rows** | 100,000 (subset) |
| **Snowflake Source** | `FLUX_DB.PRODUCTION.METER_INFRASTRUCTURE` (596K total) |
| **Postgres Target** | `meter_locations_enhanced` |
| **Geometry Type** | Point (4326) |

---

### 8. Customers

| Property | Value |
|----------|-------|
| **Rows** | 100,000 |
| **Postgres Target** | `customers_spatial` |
| **Geometry Type** | Point (4326) |

---

## Data Loading Strategy

### Static vs Dynamic Layers

| Layer Type | Examples | Loading Method | Frequency |
|------------|----------|----------------|-----------|
| **Static** | Buildings, Water, Power Lines, Vegetation | Bulk CSV load | One-time setup |
| **Dynamic** | Meters, Outages, Work Orders | Snowflake sync | Real-time/Daily |

### Static Layers (Bulk Load)

**Why not sync from Snowflake?**
- Snowflake has only **point geometries** for buildings
- Production Postgres has **polygon footprints** (cleaned/processed separately)
- Bulk COPY is 10-100x faster than row-by-row sync
- Static data rarely changes

**Loading Static Data:**

```bash
# Download data files from GitHub Releases (if not local)
# Then load into your Postgres instance:

python backend/scripts/load_postgis_data.py \
  --service your_pg_service \
  --local-data ./data/postgis_exports

# Load specific layers only:
python backend/scripts/load_postgis_data.py \
  --service your_pg_service \
  --local-data ./data/postgis_exports \
  --layers buildings water powerlines vegetation
```

Data files are stored in `data/postgis_exports/` (gitignored due to size).
See [data/postgis_exports/README.md](../data/postgis_exports/README.md) for download instructions.

### Dynamic Layers (Snowflake Sync)

For real-time or frequently changing data, use Snowflake sync procedures:

| Schema | Object | Purpose |
|--------|--------|---------|
| `FLUX_DB.POSTGRES_SYNC` | `SYNC_STATUS` table | Track sync history |
| `FLUX_DB.POSTGRES_SYNC` | `SYNC_*_TO_POSTGRES()` | Sync procedures |
| `FLUX_DB.APPLICATIONS` | `POSTGRES_CREDENTIALS` | Production secret |
| N/A | `FLUX_POSTGRES_INTEGRATION` | External access |

```sql
-- Sync meters (dynamic data)
CALL FLUX_DB.POSTGRES_SYNC.SYNC_METERS_TO_POSTGRES();

-- Check sync status
SELECT * FROM FLUX_DB.POSTGRES_SYNC.SYNC_STATUS 
ORDER BY started_at DESC LIMIT 10;
```

---

## Local Development

### Prerequisites

1. Add to `~/.pg_service.conf`:
```ini
[flux_ops_postgres_prod]
host=<your-postgres-instance-id>.us-west-2.aws.postgres.snowflake.app
port=5432
dbname=postgres
user=snowflake_admin
sslmode=require
```

2. Get password from `POSTGRES_CREDENTIALS.txt` in project root

### Validate Data

```bash
# Check all table counts
PGPASSWORD='...' PGSERVICE=flux_ops_postgres_prod psql -c "
SELECT 'building_footprints' as tbl, COUNT(*) FROM building_footprints
UNION ALL SELECT 'grid_power_lines', COUNT(*) FROM grid_power_lines
UNION ALL SELECT 'vegetation_risk', COUNT(*) FROM vegetation_risk
UNION ALL SELECT 'osm_water', COUNT(*) FROM osm_water
ORDER BY 1;
"
```

### Sample Spatial Query

```sql
-- Get buildings within 500m of a point
SELECT building_id, building_type, height_meters
FROM building_footprints
WHERE ST_DWithin(
  geom::geography,
  ST_SetSRID(ST_MakePoint(-95.3698, 29.7604), 4326)::geography,
  500
);
```

---

## Related Documentation

- [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) - Sync architecture
- [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) - Local setup
- [scripts/sql/06_postgres_sync.sql](../scripts/sql/06_postgres_sync.sql) - Sync procedures
