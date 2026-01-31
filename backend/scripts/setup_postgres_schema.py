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
    - topology_connections_cache: Grid topology with PostGIS geometries
    - vegetation_risk_cache: Tree locations with pre-computed risk scores
    - osm_water: Water body polygons for map visualization
    - osm_buildings: Building footprints for impact analysis
    - power_lines_lod: Power line geometries with LOD optimization
    - transformers_spatial: Transformer locations with attributes

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
    """Create vegetation risk cache table."""
    print("Creating vegetation_risk_cache...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS vegetation_risk_cache (
                id SERIAL PRIMARY KEY,
                tree_id VARCHAR(100) NOT NULL,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom GEOMETRY(Point, 4326),
                height_m DOUBLE PRECISION,
                canopy_radius_m DOUBLE PRECISION,
                species VARCHAR(100),
                health_score DOUBLE PRECISION,
                risk_score DOUBLE PRECISION,
                fall_zone_m DOUBLE PRECISION,
                nearest_line_id VARCHAR(100),
                nearest_line_distance_m DOUBLE PRECISION,
                encroachment_category VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial index for vegetation proximity queries
            CREATE INDEX IF NOT EXISTS idx_vegetation_geom 
                ON vegetation_risk_cache USING GIST (geom);
            
            -- Risk-based queries
            CREATE INDEX IF NOT EXISTS idx_vegetation_risk 
                ON vegetation_risk_cache (risk_score DESC);
        """)
    conn.commit()
    print("  vegetation_risk_cache created.")


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


def setup_osm_buildings(conn):
    """Create OSM buildings table."""
    print("Creating osm_buildings...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS osm_buildings (
                id SERIAL PRIMARY KEY,
                osm_id BIGINT,
                name VARCHAR(255),
                building_type VARCHAR(50),
                geom GEOMETRY(Polygon, 4326),
                centroid GEOMETRY(Point, 4326),
                area_sq_m DOUBLE PRECISION,
                height_m DOUBLE PRECISION,
                levels INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial indexes for MVT tile generation
            CREATE INDEX IF NOT EXISTS idx_osm_buildings_geom 
                ON osm_buildings USING GIST (geom);
            CREATE INDEX IF NOT EXISTS idx_osm_buildings_centroid 
                ON osm_buildings USING GIST (centroid);
        """)
    conn.commit()
    print("  osm_buildings created.")


def setup_power_lines(conn):
    """Create power lines table with LOD support."""
    print("Creating power_lines_lod...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS power_lines_lod (
                id SERIAL PRIMARY KEY,
                line_id VARCHAR(100) NOT NULL,
                circuit_id VARCHAR(100),
                substation_id VARCHAR(100),
                voltage_class VARCHAR(20),
                voltage_kv DOUBLE PRECISION,
                geom GEOMETRY(LineString, 4326),
                geom_simplified GEOMETRY(LineString, 4326),
                length_km DOUBLE PRECISION,
                conductor_type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Spatial indexes for both detail levels
            CREATE INDEX IF NOT EXISTS idx_power_lines_geom 
                ON power_lines_lod USING GIST (geom);
            CREATE INDEX IF NOT EXISTS idx_power_lines_simplified 
                ON power_lines_lod USING GIST (geom_simplified);
            
            -- Lookup indexes
            CREATE INDEX IF NOT EXISTS idx_power_lines_circuit 
                ON power_lines_lod (circuit_id);
            CREATE INDEX IF NOT EXISTS idx_power_lines_voltage 
                ON power_lines_lod (voltage_class);
        """)
    conn.commit()
    print("  power_lines_lod created.")


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
                age_years INTEGER,
                manufacturer VARCHAR(100),
                installation_date DATE,
                last_maintenance DATE,
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
            CREATE INDEX IF NOT EXISTS idx_transformers_status 
                ON transformers_spatial (status);
        """)
    conn.commit()
    print("  transformers_spatial created.")


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
        "topology_connections_cache",
        "vegetation_risk_cache", 
        "osm_water",
        "osm_buildings",
        "power_lines_lod",
        "transformers_spatial"
    ]
    
    with conn.cursor() as cur:
        for table in tables:
            cur.execute(f"""
                SELECT COUNT(*) FROM information_schema.tables 
                WHERE table_name = %s
            """, (table,))
            exists = cur.fetchone()[0] > 0
            status = "OK" if exists else "MISSING"
            print(f"  {table}: {status}")
    
    print("\nSetup complete!")
    print("\nNEXT STEPS:")
    print("1. Configure Snowflake stored procedures to sync data")
    print("2. See docs/POSTGRES_SYNC_RELIABILITY.md for sync architecture")
    print("3. Run: CALL <database>.APPLICATIONS.SYNC_TOPOLOGY_TO_POSTGRES();")


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
        setup_topology_cache(conn)
        setup_vegetation_cache(conn)
        setup_osm_water(conn)
        setup_osm_buildings(conn)
        setup_power_lines(conn)
        setup_transformers(conn)
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
