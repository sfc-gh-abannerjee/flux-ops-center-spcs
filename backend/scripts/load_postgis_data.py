#!/usr/bin/env python3
"""
Load PostGIS spatial data into a Snowflake Managed Postgres instance.

This script downloads pre-cleaned spatial data from GitHub Releases and loads it
into your Postgres instance. The data includes:

Core Spatial Layers:
- building_footprints: 2.6M building polygons with height data (~310MB compressed)
- osm_water: 12K water body polygons (~6MB compressed)
- grid_power_lines: 13K power line geometries (~800KB compressed)
- vegetation_risk: 49K vegetation risk points (~4MB compressed)
- substations: 275 substation points (~12KB compressed)
- transformers: 91K transformer records (~3MB compressed)
- customers_spatial: 100K customer points (~6MB compressed)
- meter_locations_enhanced: 100K meter points (~5MB compressed)

Cache/Derived Tables:
- grid_assets_cache: 726K unified asset cache (~55MB compressed)
- topology_connections_cache: Network topology (~5MB compressed)

Usage:
    # Using pg_service.conf (recommended):
    python load_postgis_data.py --service flux_ops_postgres
    
    # Using connection string:
    python load_postgis_data.py --host <host> --user <user> --password <pass>
    
    # Load specific layers only:
    python load_postgis_data.py --service flux_ops_postgres --layers buildings water
    
    # Load core layers only (skip cache tables):
    python load_postgis_data.py --service flux_ops_postgres --layers buildings water powerlines vegetation substations transformers customers meters
    
    # Use local data files (skip download):
    python load_postgis_data.py --service flux_ops_postgres --local-data ./data/postgis_exports
"""

import argparse
import gzip
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

# GitHub release URL pattern - update RELEASE_TAG when new data is published
GITHUB_REPO = "sfc-gh-abannerjee/flux-ops-center-spcs"
RELEASE_TAG = "v1.0.0-data"  # Update this when publishing new data

DATA_FILES = {
    # Core spatial layers
    "buildings": {
        "filename": "building_footprints.csv.gz",
        "table": "building_footprints",
        "rows": 2670707,
        "size_mb": 310,
    },
    "water": {
        "filename": "osm_water.csv.gz",
        "table": "osm_water",
        "rows": 12758,
        "size_mb": 6,
    },
    "powerlines": {
        "filename": "grid_power_lines.csv.gz",
        "table": "grid_power_lines",
        "rows": 13104,
        "size_mb": 1,
    },
    "vegetation": {
        "filename": "vegetation_risk.csv.gz",
        "table": "vegetation_risk",
        "rows": 49265,
        "size_mb": 4,
    },
    "substations": {
        "filename": "substations.csv.gz",
        "table": "substations",
        "rows": 275,
        "size_mb": 0.012,
    },
    "transformers": {
        "filename": "transformers.csv.gz",
        "table": "transformers",
        "rows": 91554,
        "size_mb": 3,
    },
    "customers": {
        "filename": "customers_spatial.csv.gz",
        "table": "customers_spatial",
        "rows": 100000,
        "size_mb": 6,
    },
    "meters": {
        "filename": "meter_locations_enhanced.csv.gz",
        "table": "meter_locations_enhanced",
        "rows": 100000,
        "size_mb": 5,
    },
    # Cache/derived tables
    "grid_assets": {
        "filename": "grid_assets_cache.csv.gz",
        "table": "grid_assets_cache",
        "rows": 726263,
        "size_mb": 55,
    },
    "topology": {
        "filename": "topology_connections_cache.csv.gz",
        "table": "topology_connections_cache",
        "rows": 153592,
        "size_mb": 5,
    },
}

# SQL schemas for each table
SCHEMAS = {
    "building_footprints": """
        DROP TABLE IF EXISTS building_footprints CASCADE;
        CREATE TABLE building_footprints (
            building_id VARCHAR(50) PRIMARY KEY,
            building_name VARCHAR(255),
            building_type VARCHAR(50),
            height_meters DOUBLE PRECISION,
            num_floors INTEGER,
            geom GEOMETRY(Polygon, 4326)
        );
    """,
    "osm_water": """
        DROP TABLE IF EXISTS osm_water CASCADE;
        CREATE TABLE osm_water (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT UNIQUE,
            name VARCHAR(255),
            water_type VARCHAR(50),
            acres NUMERIC(12,2),
            geom GEOMETRY(Geometry, 4326)
        );
    """,
    "grid_power_lines": """
        DROP TABLE IF EXISTS grid_power_lines CASCADE;
        CREATE TABLE grid_power_lines (
            line_id VARCHAR(100) PRIMARY KEY,
            circuit_id VARCHAR(100) NOT NULL,
            substation_id VARCHAR(50) NOT NULL,
            line_type VARCHAR(50) NOT NULL,
            voltage_class VARCHAR(20),
            transformer_count INTEGER,
            meters_served INTEGER,
            line_length_m DOUBLE PRECISION,
            geom GEOMETRY(LineString, 4326),
            centroid_lat DOUBLE PRECISION,
            centroid_lon DOUBLE PRECISION,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """,
    "vegetation_risk": """
        DROP TABLE IF EXISTS vegetation_risk CASCADE;
        CREATE TABLE vegetation_risk (
            tree_id VARCHAR(100) PRIMARY KEY,
            class VARCHAR(50),
            subtype VARCHAR(100),
            longitude DOUBLE PRECISION,
            latitude DOUBLE PRECISION,
            height_m DOUBLE PRECISION,
            canopy_radius_m DOUBLE PRECISION,
            risk_score DOUBLE PRECISION,
            risk_level VARCHAR(20),
            distance_to_line_m DOUBLE PRECISION,
            nearest_line_id VARCHAR(100),
            nearest_line_voltage_kv DOUBLE PRECISION,
            clearance_deficit_m DOUBLE PRECISION,
            years_to_encroachment DOUBLE PRECISION,
            data_source VARCHAR(100),
            geom GEOMETRY(Point, 4326)
        );
    """,
    "substations": """
        DROP TABLE IF EXISTS substations CASCADE;
        CREATE TABLE substations (
            substation_id VARCHAR(50) PRIMARY KEY,
            substation_name VARCHAR(200),
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            capacity_mva DOUBLE PRECISION,
            voltage_level VARCHAR(50),
            commissioned_date DATE,
            operational_status VARCHAR(50),
            geom GEOGRAPHY(Point, 4326)
        );
    """,
    "transformers": """
        DROP TABLE IF EXISTS transformers CASCADE;
        CREATE TABLE transformers (
            transformer_id TEXT PRIMARY KEY,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            substation_id TEXT,
            rated_kva DOUBLE PRECISION,
            install_year INTEGER,
            health_score DOUBLE PRECISION,
            age_years INTEGER,
            location_area TEXT,
            feeder_id TEXT
        );
    """,
    "customers_spatial": """
        DROP TABLE IF EXISTS customers_spatial CASCADE;
        CREATE TABLE customers_spatial (
            customer_id VARCHAR(50) PRIMARY KEY,
            full_name VARCHAR(200),
            customer_segment VARCHAR(50),
            service_address VARCHAR(300),
            city VARCHAR(100),
            county VARCHAR(100),
            meter_id VARCHAR(50),
            transformer_id VARCHAR(50),
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            geom GEOMETRY(Point, 4326)
        );
    """,
    "meter_locations_enhanced": """
        DROP TABLE IF EXISTS meter_locations_enhanced CASCADE;
        CREATE TABLE meter_locations_enhanced (
            meter_id VARCHAR(50) PRIMARY KEY,
            transformer_id VARCHAR(50),
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            circuit_id VARCHAR(50),
            city VARCHAR(100),
            zip_code VARCHAR(10),
            county_name VARCHAR(100),
            geom GEOMETRY(Point, 4326)
        );
    """,
    "grid_assets_cache": """
        DROP TABLE IF EXISTS grid_assets_cache CASCADE;
        CREATE TABLE grid_assets_cache (
            asset_id TEXT PRIMARY KEY,
            asset_name TEXT,
            asset_type TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            circuit_id TEXT,
            load_percent DOUBLE PRECISION,
            health_score DOUBLE PRECISION,
            status TEXT,
            voltage TEXT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            geom GEOMETRY(Point, 4326),
            rotation_rad DOUBLE PRECISION DEFAULT 0,
            city VARCHAR(100),
            zip_code VARCHAR(20),
            county_name VARCHAR(100),
            connected_customers INTEGER,
            service_address VARCHAR(200),
            customer_name VARCHAR(200),
            customer_segment VARCHAR(50),
            circuits_served INTEGER,
            capacity_mva DOUBLE PRECISION,
            substation_name VARCHAR(200)
        );
    """,
    "topology_connections_cache": """
        DROP TABLE IF EXISTS topology_connections_cache CASCADE;
        CREATE TABLE topology_connections_cache (
            from_asset_id VARCHAR(255),
            to_asset_id VARCHAR(255),
            from_circuit_id VARCHAR(255),
            to_circuit_id VARCHAR(255),
            from_latitude DOUBLE PRECISION,
            from_longitude DOUBLE PRECISION,
            to_latitude DOUBLE PRECISION,
            to_longitude DOUBLE PRECISION,
            connection_type VARCHAR(50),
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """,
}

# Spatial indexes for each table
INDEXES = {
    "building_footprints": [
        "CREATE INDEX IF NOT EXISTS idx_building_footprints_geom ON building_footprints USING GIST (geom);",
    ],
    "osm_water": [
        "CREATE INDEX IF NOT EXISTS idx_osm_water_geom ON osm_water USING GIST (geom);",
        "CREATE INDEX IF NOT EXISTS idx_osm_water_type ON osm_water (water_type);",
    ],
    "grid_power_lines": [
        "CREATE INDEX IF NOT EXISTS idx_grid_power_lines_geom ON grid_power_lines USING GIST (geom);",
        "CREATE INDEX IF NOT EXISTS idx_grid_power_lines_circuit ON grid_power_lines (circuit_id);",
        "CREATE INDEX IF NOT EXISTS idx_grid_power_lines_substation ON grid_power_lines (substation_id);",
        "CREATE INDEX IF NOT EXISTS idx_grid_power_lines_type ON grid_power_lines (line_type);",
    ],
    "vegetation_risk": [
        "CREATE INDEX IF NOT EXISTS idx_vegetation_geom ON vegetation_risk USING GIST (geom);",
        "CREATE INDEX IF NOT EXISTS idx_vegetation_risk ON vegetation_risk (risk_level);",
    ],
    "substations": [
        "CREATE INDEX IF NOT EXISTS idx_substations_geom ON substations USING GIST (geom);",
    ],
    "transformers": [
        "CREATE INDEX IF NOT EXISTS idx_transformers_pkey ON transformers (transformer_id);",
    ],
    "customers_spatial": [
        "CREATE INDEX IF NOT EXISTS idx_customers_geom ON customers_spatial USING GIST (geom);",
        "CREATE INDEX IF NOT EXISTS idx_customers_segment ON customers_spatial (customer_segment);",
        "CREATE INDEX IF NOT EXISTS idx_customers_transformer ON customers_spatial (transformer_id);",
    ],
    "meter_locations_enhanced": [
        "CREATE INDEX IF NOT EXISTS idx_meters_geom ON meter_locations_enhanced USING GIST (geom);",
        "CREATE INDEX IF NOT EXISTS idx_meters_circuit ON meter_locations_enhanced (circuit_id);",
        "CREATE INDEX IF NOT EXISTS idx_meters_transformer ON meter_locations_enhanced (transformer_id);",
    ],
    "grid_assets_cache": [
        "CREATE INDEX IF NOT EXISTS idx_grid_assets_geom ON grid_assets_cache USING GIST (geom);",
        "CREATE INDEX IF NOT EXISTS idx_assets_type ON grid_assets_cache (asset_type);",
        "CREATE INDEX IF NOT EXISTS idx_assets_circuit ON grid_assets_cache (circuit_id);",
        "CREATE INDEX IF NOT EXISTS idx_cache_type_health ON grid_assets_cache (asset_type, health_score);",
    ],
    "topology_connections_cache": [
        "CREATE INDEX IF NOT EXISTS idx_topo_from_asset ON topology_connections_cache (from_asset_id);",
        "CREATE INDEX IF NOT EXISTS idx_topo_to_asset ON topology_connections_cache (to_asset_id);",
        "CREATE INDEX IF NOT EXISTS idx_topo_from_circuit ON topology_connections_cache (from_circuit_id);",
        "CREATE INDEX IF NOT EXISTS idx_topo_to_circuit ON topology_connections_cache (to_circuit_id);",
    ],
}


def download_file(url: str, dest: Path, desc: str) -> bool:
    """Download a file with progress indicator."""
    print(f"  Downloading {desc}...")
    try:
        urllib.request.urlretrieve(url, dest)
        return True
    except Exception as e:
        print(f"  ERROR: Failed to download {url}: {e}")
        return False


def get_download_url(filename: str) -> str:
    """Get GitHub release download URL for a file."""
    return f"https://github.com/{GITHUB_REPO}/releases/download/{RELEASE_TAG}/{filename}"


def run_psql(sql: str, conn_args: list, desc: str) -> bool:
    """Run SQL via psql."""
    cmd = ["psql"] + conn_args + ["-c", sql]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  ERROR: {desc} failed: {result.stderr}")
            return False
        return True
    except Exception as e:
        print(f"  ERROR: {desc} failed: {e}")
        return False


def load_csv_to_table(csv_path: Path, table: str, conn_args: list) -> bool:
    """Load CSV data into table using COPY."""
    # Build psql command with \copy
    copy_cmd = f"\\COPY {table} FROM STDIN WITH (FORMAT CSV, HEADER)"
    
    # Pipe: gunzip -> psql
    psql_cmd = ["psql"] + conn_args + ["-c", copy_cmd]
    
    try:
        # Use gunzip to decompress, pipe to psql
        gunzip = subprocess.Popen(
            ["gunzip", "-c", str(csv_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        psql = subprocess.Popen(
            psql_cmd,
            stdin=gunzip.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        gunzip.stdout.close()  # Allow gunzip to receive SIGPIPE
        
        stdout, stderr = psql.communicate()
        gunzip.wait()
        
        if psql.returncode != 0:
            print(f"  ERROR: COPY failed: {stderr}")
            return False
        return True
    except Exception as e:
        print(f"  ERROR: Load failed: {e}")
        return False


def build_conn_args(args) -> list:
    """Build psql connection arguments from args."""
    conn_args = []
    
    if args.service:
        conn_args.extend([f"service={args.service}"])
        return conn_args
    
    if args.host:
        conn_args.extend(["-h", args.host])
    if args.port:
        conn_args.extend(["-p", str(args.port)])
    if args.user:
        conn_args.extend(["-U", args.user])
    if args.database:
        conn_args.extend(["-d", args.database])
    
    return conn_args


def verify_connection(conn_args: list) -> bool:
    """Verify we can connect to Postgres."""
    print("Verifying Postgres connection...")
    cmd = ["psql"] + conn_args + ["-c", "SELECT 1;"]
    
    env = os.environ.copy()
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if result.returncode != 0:
            print(f"ERROR: Cannot connect to Postgres: {result.stderr}")
            return False
        print("  Connection successful!")
        return True
    except Exception as e:
        print(f"ERROR: Connection test failed: {e}")
        return False


def verify_postgis(conn_args: list) -> bool:
    """Verify PostGIS extension is available."""
    print("Verifying PostGIS extension...")
    sql = "SELECT PostGIS_Version();"
    cmd = ["psql"] + conn_args + ["-t", "-c", sql]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print("  PostGIS not found. Creating extension...")
            create_sql = "CREATE EXTENSION IF NOT EXISTS postgis;"
            if not run_psql(create_sql, conn_args, "Create PostGIS"):
                return False
        version = result.stdout.strip()
        print(f"  PostGIS version: {version}")
        return True
    except Exception as e:
        print(f"ERROR: PostGIS check failed: {e}")
        return False


def load_layer(layer_key: str, data_dir: Path, conn_args: list) -> bool:
    """Load a single layer into Postgres."""
    info = DATA_FILES[layer_key]
    table = info["table"]
    filename = info["filename"]
    
    print(f"\n{'='*60}")
    print(f"Loading {layer_key}: {table}")
    print(f"  Expected rows: {info['rows']:,}")
    print(f"{'='*60}")
    
    # Get data file
    csv_path = data_dir / filename
    if not csv_path.exists():
        # Try to download
        url = get_download_url(filename)
        print(f"  Data file not found locally, downloading...")
        if not download_file(url, csv_path, filename):
            return False
    
    print(f"  Using: {csv_path}")
    
    # Create table schema
    print(f"  Creating table schema...")
    if not run_psql(SCHEMAS[table], conn_args, "Create schema"):
        return False
    
    # Load data
    print(f"  Loading data (this may take a while for large tables)...")
    if not load_csv_to_table(csv_path, table, conn_args):
        return False
    
    # Create indexes
    print(f"  Creating spatial indexes...")
    for idx_sql in INDEXES[table]:
        if not run_psql(idx_sql, conn_args, "Create index"):
            return False
    
    # Verify row count
    print(f"  Verifying load...")
    count_sql = f"SELECT COUNT(*) FROM {table};"
    cmd = ["psql"] + conn_args + ["-t", "-c", count_sql]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        count = int(result.stdout.strip())
        expected = info["rows"]
        if count == expected:
            print(f"  SUCCESS: {count:,} rows loaded (matches expected)")
        else:
            print(f"  WARNING: {count:,} rows loaded (expected {expected:,})")
    
    # ANALYZE for query optimization
    run_psql(f"ANALYZE {table};", conn_args, "Analyze table")
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Load PostGIS spatial data into Snowflake Managed Postgres",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    # Connection options
    conn_group = parser.add_argument_group("Connection Options")
    conn_group.add_argument("--service", "-s", 
                           help="pg_service.conf service name (recommended)")
    conn_group.add_argument("--host", "-H", help="Postgres host")
    conn_group.add_argument("--port", "-p", type=int, default=5432, help="Postgres port")
    conn_group.add_argument("--user", "-U", help="Postgres user")
    conn_group.add_argument("--database", "-d", default="postgres", help="Database name")
    
    # Data options
    data_group = parser.add_argument_group("Data Options")
    data_group.add_argument("--local-data", type=Path,
                           help="Path to local data directory (skip download)")
    data_group.add_argument("--layers", nargs="+", 
                           choices=list(DATA_FILES.keys()),
                           default=list(DATA_FILES.keys()),
                           help="Layers to load (default: all)")
    
    # Other options
    parser.add_argument("--skip-verify", action="store_true",
                       help="Skip connection verification")
    parser.add_argument("--download-only", action="store_true",
                       help="Only download data, don't load")
    
    args = parser.parse_args()
    
    # Validate connection args
    if not args.service and not args.host:
        parser.error("Either --service or --host is required")
    
    # Set up data directory
    if args.local_data:
        data_dir = args.local_data
        if not data_dir.exists():
            print(f"ERROR: Local data directory not found: {data_dir}")
            sys.exit(1)
    else:
        data_dir = Path(tempfile.mkdtemp(prefix="postgis_data_"))
        print(f"Using temp directory for downloads: {data_dir}")
    
    # Build connection args
    conn_args = build_conn_args(args)
    
    # Handle PGPASSWORD from environment or prompt
    if args.service:
        # Service file handles auth
        pass
    elif not os.environ.get("PGPASSWORD") and args.user:
        import getpass
        password = getpass.getpass(f"Password for {args.user}: ")
        os.environ["PGPASSWORD"] = password
    
    if args.download_only:
        print("Download-only mode: downloading data files...")
        for layer_key in args.layers:
            info = DATA_FILES[layer_key]
            url = get_download_url(info["filename"])
            dest = data_dir / info["filename"]
            download_file(url, dest, info["filename"])
        print(f"\nData downloaded to: {data_dir}")
        sys.exit(0)
    
    # Verify connection
    if not args.skip_verify:
        if not verify_connection(conn_args):
            sys.exit(1)
        if not verify_postgis(conn_args):
            sys.exit(1)
    
    # Load each layer
    success_count = 0
    for layer_key in args.layers:
        if load_layer(layer_key, data_dir, conn_args):
            success_count += 1
    
    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY: Loaded {success_count}/{len(args.layers)} layers successfully")
    print(f"{'='*60}")
    
    if success_count < len(args.layers):
        sys.exit(1)


if __name__ == "__main__":
    main()
