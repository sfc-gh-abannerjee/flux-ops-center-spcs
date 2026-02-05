#!/usr/bin/env python3
"""
Postgres Schema Setup for Flux Operations Center
=================================================

This script initializes the Snowflake Managed Postgres database with the required
tables and PostGIS extensions for spatial query acceleration.

ARCHITECTURE:
- Snowflake: Source of truth for all data
- Postgres: PostGIS cache for fast spatial queries (<20ms vs seconds)
- Sync: Snowflake stored procedures push data to Postgres (see docs/POSTGRES_SYNC_RELIABILITY.md)

PREREQUISITES:
1. Snowflake Managed Postgres instance provisioned
2. PostGIS extension enabled on the Postgres instance
3. Environment variables configured (see below)

ENVIRONMENT VARIABLES:
    VITE_POSTGRES_HOST     - Postgres hostname (required)
    VITE_POSTGRES_PORT     - Postgres port (default: 5432)
    VITE_POSTGRES_DATABASE - Database name (default: postgres)
    VITE_POSTGRES_USER     - Database user (required)
    VITE_POSTGRES_PASSWORD - Database password (required)

USAGE:
    # Set environment variables first
    export VITE_POSTGRES_HOST="your-postgres-host.snowflakecomputing.app"
    export VITE_POSTGRES_USER="application"
    export VITE_POSTGRES_PASSWORD="your-secure-password"
    
    # Run setup
    python setup_postgres_schema.py

TABLES CREATED:
    - meters_spatial: Smart meter locations with grid connectivity
    - substations_spatial: Substation locations with capacity data
    - transformers_spatial: Transformer locations with attributes
    - power_lines_lod: Power line geometries with LOD optimization
    - poles_spatial: Utility pole locations from OSM
    - osm_buildings: Building footprints for impact analysis
    - osm_water: Water body polygons for map visualization
    - vegetation_risk_cache: Tree locations with pre-computed risk scores
    - topology_connections_cache: Grid topology with PostGIS geometries

SNOWFLAKE SOURCE TABLES:
    - METER_INFRASTRUCTURE → meters_spatial (596K rows)
    - SUBSTATIONS → substations_spatial (275 rows)
    - TRANSFORMER_METADATA → transformers_spatial (91K rows)
    - GRID_POWER_LINES → power_lines_lod (13K rows)
    - OSM_POLES_TRULY_LAND_ONLY → poles_spatial (62K rows)
    - HOUSTON_BUILDINGS_CLEAN → osm_buildings (2.6M rows)
    - HOUSTON_WATER_BODIES → osm_water (10K rows)
    - VEGETATION_POWER_LINE_RISK → vegetation_risk_cache (3.6K rows)

See docs/POSTGRES_SYNC_RELIABILITY.md for sync architecture details.
"""

import os
import sys
import psycopg2
from psycopg2 import sql


def get_connection_params():
    """Get Postgres connection parameters from environment variables."""
    host = os.environ.get("VITE_POSTGRES_HOST")
    port = int(os.environ.get("VITE_POSTGRES_PORT", "5432"))
    database = os.environ.get("VITE_POSTGRES_DATABASE", "postgres")
    user = os.environ.get("VITE_POSTGRES_USER")
    password = os.environ.get("VITE_POSTGRES_PASSWORD")
    
    if not all([host, user, password]):
        print("ERROR: Missing required environment variables.")
        print("Required: VITE_POSTGRES_HOST, VITE_POSTGRES_USER, VITE_POSTGRES_PASSWORD")
        print("\nExample:")
        print('  export VITE_POSTGRES_HOST="your-host.snowflakecomputing.app"')
        print('  export VITE_POSTGRES_USER="application"')
        print('  export VITE_POSTGRES_PASSWORD="your-secure-password"')
        sys.exit(1)
    
    return {
        "host": host,
        "port": port,
        "database": database,
        "user": user,
        "password": password
    }


def setup_extensions(conn):
    """Enable required Postgres extensions."""
    print("Setting up extensions...")
    with conn.cursor() as cur:
        # PostGIS for spatial queries
        cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
        
        # Check PostGIS version
        cur.execute("SELECT PostGIS_Version();")
        version = cur.fetchone()[0]
        print(f"  PostGIS version: {version}")
    conn.commit()
    print("  Extensions enabled.")


def setup_topology_cache(conn):
    """Create topology connections cache table."""
    print("Creating topology_connections_cache...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS topology_connections_cache (
                id SERIAL PRIMARY KEY,
                asset_id VARCHAR(100) NOT NULL,
                asset_type VARCHAR(50) NOT NULL,
                substation_id VARCHAR(100),
                circuit_id VARCHAR(100),
                feeder_id VARCHAR(100),
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                geom GEOMETRY(Point, 4326),
                status VARCHAR(20) DEFAULT 'ACTIVE',
                voltage_kv DOUBLE PRECISION,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for fast PostGIS queries
            CREATE INDEX IF NOT EXISTS idx_topology_geom 
                ON topology_connections_cache USING GIST (geom);
            
            -- Lookup indexes
            CREATE INDEX IF NOT EXISTS idx_topology_asset_id 
                ON topology_connections_cache (asset_id);
            CREATE INDEX IF NOT EXISTS idx_topology_substation 
                ON topology_connections_cache (substation_id);
            CREATE INDEX IF NOT EXISTS idx_topology_circuit 
                ON topology_connections_cache (circuit_id);
        """)
    conn.commit()
    print("  topology_connections_cache created.")


def setup_vegetation_cache(conn):
    """Create vegetation risk table matching production schema."""
    print("Creating vegetation_risk...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS vegetation_risk (
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
            
            -- Spatial index for vegetation proximity queries
            CREATE INDEX IF NOT EXISTS idx_vegetation_geom 
                ON vegetation_risk USING GIST (geom);
            
            -- Risk-based queries
            CREATE INDEX IF NOT EXISTS idx_vegetation_risk 
                ON vegetation_risk (risk_level);
        """)
    conn.commit()
    print("  vegetation_risk created (49K rows expected).")


def setup_osm_water(conn):
    """Create OSM water bodies table."""
    print("Creating osm_water...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS osm_water (
                id SERIAL PRIMARY KEY,
                osm_id BIGINT,
                name VARCHAR(255),
                water_type VARCHAR(50),
                geom GEOMETRY(MultiPolygon, 4326),
                area_sq_km DOUBLE PRECISION,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for viewport queries
            CREATE INDEX IF NOT EXISTS idx_osm_water_geom 
                ON osm_water USING GIST (geom);
        """)
    conn.commit()
    print("  osm_water created.")


def setup_building_footprints(conn):
    """Create building footprints table for 3D visualization."""
    print("Creating building_footprints...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS building_footprints (
                building_id VARCHAR(50) PRIMARY KEY,
                building_name VARCHAR(255),
                building_type VARCHAR(50),
                height_meters DOUBLE PRECISION,
                num_floors INTEGER,
                geom GEOMETRY(Polygon, 4326)
            );
            
            -- Spatial index for viewport queries and 3D tile generation
            CREATE INDEX IF NOT EXISTS idx_building_footprints_geom 
                ON building_footprints USING GIST (geom);
        """)
    conn.commit()
    print("  building_footprints created (2.67M rows expected).")


def setup_power_lines(conn):
    """Create grid power lines table matching production schema."""
    print("Creating grid_power_lines...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS grid_power_lines (
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
            
            -- Spatial index for power line queries
            CREATE INDEX IF NOT EXISTS idx_grid_power_lines_geom 
                ON grid_power_lines USING GIST (geom);
            
            -- Lookup indexes
            CREATE INDEX IF NOT EXISTS idx_grid_power_lines_circuit 
                ON grid_power_lines (circuit_id);
            CREATE INDEX IF NOT EXISTS idx_grid_power_lines_substation 
                ON grid_power_lines (substation_id);
            CREATE INDEX IF NOT EXISTS idx_grid_power_lines_type 
                ON grid_power_lines (line_type);
        """)
    conn.commit()
    print("  grid_power_lines created (13K rows expected).")


def setup_meters(conn):
    """Create meters spatial table for smart meter locations."""
    print("Creating meters_spatial...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS meters_spatial (
                id SERIAL PRIMARY KEY,
                meter_id VARCHAR(100) NOT NULL,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom GEOMETRY(Point, 4326),
                transformer_id VARCHAR(100),
                circuit_id VARCHAR(100),
                substation_id VARCHAR(100),
                pole_id VARCHAR(100),
                meter_type VARCHAR(50),
                customer_segment VARCHAR(50),
                city VARCHAR(100),
                county VARCHAR(100),
                zip_code VARCHAR(20),
                commissioned_date DATE,
                health_score DOUBLE PRECISION,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for proximity queries
            CREATE INDEX IF NOT EXISTS idx_meters_geom 
                ON meters_spatial USING GIST (geom);
            
            -- Lookup indexes for grid topology queries
            CREATE INDEX IF NOT EXISTS idx_meters_transformer 
                ON meters_spatial (transformer_id);
            CREATE INDEX IF NOT EXISTS idx_meters_circuit 
                ON meters_spatial (circuit_id);
            CREATE INDEX IF NOT EXISTS idx_meters_substation 
                ON meters_spatial (substation_id);
            CREATE INDEX IF NOT EXISTS idx_meters_zip 
                ON meters_spatial (zip_code);
        """)
    conn.commit()
    print("  meters_spatial created.")


def setup_substations(conn):
    """Create substations spatial table."""
    print("Creating substations_spatial...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS substations_spatial (
                id SERIAL PRIMARY KEY,
                substation_id VARCHAR(100) NOT NULL,
                name VARCHAR(255),
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom GEOMETRY(Point, 4326),
                capacity_mva DOUBLE PRECISION,
                current_load_mw DOUBLE PRECISION,
                peak_load_mw DOUBLE PRECISION,
                voltage_level VARCHAR(20),
                substation_type VARCHAR(50),
                operational_status VARCHAR(50) DEFAULT 'Operational',
                region VARCHAR(50),
                commissioned_date DATE,
                last_inspection_date DATE,
                critical_infrastructure BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for proximity queries
            CREATE INDEX IF NOT EXISTS idx_substations_geom 
                ON substations_spatial USING GIST (geom);
            
            -- Lookup indexes
            CREATE INDEX IF NOT EXISTS idx_substations_status 
                ON substations_spatial (operational_status);
            CREATE INDEX IF NOT EXISTS idx_substations_region 
                ON substations_spatial (region);
        """)
    conn.commit()
    print("  substations_spatial created.")


def setup_transformers(conn):
    """Create transformers spatial table."""
    print("Creating transformers_spatial...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS transformers_spatial (
                id SERIAL PRIMARY KEY,
                transformer_id VARCHAR(100) NOT NULL,
                substation_id VARCHAR(100),
                circuit_id VARCHAR(100),
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom GEOMETRY(Point, 4326),
                rated_kva DOUBLE PRECISION,
                current_load_kva DOUBLE PRECISION,
                load_utilization_pct DOUBLE PRECISION,
                age_years INTEGER,
                health_score DOUBLE PRECISION,
                manufacturer VARCHAR(100),
                model_number VARCHAR(100),
                install_year INTEGER,
                last_maintenance DATE,
                transformer_role VARCHAR(50),
                phase_code VARCHAR(10),
                primary_voltage_kv DOUBLE PRECISION,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                rotation_degrees DOUBLE PRECISION DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for proximity queries
            CREATE INDEX IF NOT EXISTS idx_transformers_geom 
                ON transformers_spatial USING GIST (geom);
            
            -- Lookup indexes
            CREATE INDEX IF NOT EXISTS idx_transformers_substation 
                ON transformers_spatial (substation_id);
            CREATE INDEX IF NOT EXISTS idx_transformers_circuit 
                ON transformers_spatial (circuit_id);
            CREATE INDEX IF NOT EXISTS idx_transformers_status 
                ON transformers_spatial (status);
            CREATE INDEX IF NOT EXISTS idx_transformers_health 
                ON transformers_spatial (health_score);
        """)
    conn.commit()
    print("  transformers_spatial created.")


def setup_poles(conn):
    """Create poles spatial table for utility pole locations."""
    print("Creating poles_spatial...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS poles_spatial (
                id SERIAL PRIMARY KEY,
                pole_id VARCHAR(100) NOT NULL,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom GEOMETRY(Point, 4326),
                power_type VARCHAR(50),
                voltage VARCHAR(50),
                pole_type VARCHAR(50),
                pole_material VARCHAR(50),
                height_ft DOUBLE PRECISION,
                condition_status VARCHAR(50),
                osm_source BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for proximity queries
            CREATE INDEX IF NOT EXISTS idx_poles_geom 
                ON poles_spatial USING GIST (geom);
            
            -- Lookup indexes
            CREATE INDEX IF NOT EXISTS idx_poles_power_type 
                ON poles_spatial (power_type);
            CREATE INDEX IF NOT EXISTS idx_poles_condition 
                ON poles_spatial (condition_status);
        """)
    conn.commit()
    print("  poles_spatial created.")


def setup_application_role(conn):
    """Configure application role settings for connection management."""
    print("Configuring role settings...")
    with conn.cursor() as cur:
        # Set reasonable timeouts to prevent connection buildup
        cur.execute("""
            ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';
        """)
        cur.execute("""
            ALTER ROLE CURRENT_USER SET statement_timeout = '300s';
        """)
    conn.commit()
    print("  Role timeouts configured (idle: 60s, statement: 300s).")


def verify_setup(conn):
    """Verify all tables were created successfully."""
    print("\nVerifying setup...")
    tables = [
        ("building_footprints", "2.67M buildings"),
        ("grid_power_lines", "13K power lines"),
        ("vegetation_risk", "49K vegetation"),
        ("osm_water", "12K water bodies"),
        ("substations_spatial", "275 substations"),
        ("transformers_spatial", "91K transformers"),
        ("meters_spatial", "596K meters"),
        ("poles_spatial", "62K poles"),
        ("topology_connections_cache", "topology cache")
    ]
    
    with conn.cursor() as cur:
        for table, description in tables:
            cur.execute(f"""
                SELECT COUNT(*) FROM information_schema.tables 
                WHERE table_name = %s
            """, (table,))
            exists = cur.fetchone()[0] > 0
            status = "✓ OK" if exists else "✗ MISSING"
            print(f"  {table}: {status} ({description})")
    
    print("\nSetup complete!")
    print("\nNEXT STEPS:")
    print("1. Run Snowflake sync procedures to populate data")
    print("2. See docs/DATA_LAYER_MAPPING.md for column mappings")
    print("3. See docs/POSTGRES_SYNC_RELIABILITY.md for sync architecture")


def main():
    """Main entry point."""
    print("=" * 60)
    print("Flux Operations Center - Postgres Schema Setup")
    print("=" * 60)
    print()
    
    params = get_connection_params()
    print(f"Connecting to: {params['host']}:{params['port']}/{params['database']}")
    
    try:
        conn = psycopg2.connect(**params)
        conn.autocommit = True
        print("Connected successfully.\n")
        
        # Setup all components
        setup_extensions(conn)
        
        # Core spatial layers (match production schema)
        setup_building_footprints(conn)  # 3D buildings - 2.67M rows
        setup_power_lines(conn)           # Power lines - 13K rows
        setup_vegetation_cache(conn)      # Vegetation risk - 49K rows
        setup_osm_water(conn)             # Water bodies - 12K rows
        
        # Infrastructure layers
        setup_substations(conn)           # Substations - 275 rows
        setup_transformers(conn)          # Transformers - 91K rows
        setup_meters(conn)                # Meters - 596K rows
        setup_poles(conn)                 # Poles - 62K rows
        
        # Cache/topology layers
        setup_topology_cache(conn)
        
        # Configure role settings
        setup_application_role(conn)
        
        # Verify
        verify_setup(conn)
        
    except psycopg2.Error as e:
        print(f"\nERROR: Database error: {e}")
        sys.exit(1)
    finally:
        if 'conn' in locals():
            conn.close()


if __name__ == "__main__":
    main()
