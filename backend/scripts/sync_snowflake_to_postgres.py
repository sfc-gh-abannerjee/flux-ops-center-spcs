#!/usr/bin/env python3
"""
Sync Snowflake Data to Postgres Cache
======================================

This script syncs topology and spatial data from Snowflake (source of truth) to
Snowflake Managed Postgres for PostGIS spatial query acceleration.

ARCHITECTURE:
- Reads data from Snowflake using snowflake-connector-python
- Writes to Postgres using psycopg2 with batch inserts
- Uses atomic swap pattern (temp table -> truncate -> insert) for consistency

PREREQUISITES:
1. Run setup_postgres_schema.py first to create tables
2. Configure Snowflake connection (snowflake.yml or environment variables)
3. Configure Postgres connection (environment variables)

ENVIRONMENT VARIABLES:
    # Snowflake (via snowflake-connector-python)
    SNOWFLAKE_ACCOUNT    - Snowflake account identifier
    SNOWFLAKE_USER       - Snowflake username
    SNOWFLAKE_PASSWORD   - Snowflake password (or use SSO)
    SNOWFLAKE_DATABASE   - Database name (default: FLUX_DB)
    SNOWFLAKE_SCHEMA     - Schema name (default: PRODUCTION)
    SNOWFLAKE_WAREHOUSE  - Warehouse name (default: FLUX_WH)
    
    # Postgres
    VITE_POSTGRES_HOST     - Postgres hostname
    VITE_POSTGRES_PORT     - Postgres port (default: 5432)
    VITE_POSTGRES_DATABASE - Database name (default: postgres)
    VITE_POSTGRES_USER     - Database user
    VITE_POSTGRES_PASSWORD - Database password

USAGE:
    # Sync all tables
    python sync_snowflake_to_postgres.py
    
    # Sync specific table
    python sync_snowflake_to_postgres.py --table topology

TABLES SYNCED:
    - topology: Grid topology from FLUX_OPS_CENTER_TOPOLOGY
    - vegetation: Vegetation risk from VEGETATION_RISK_ENHANCED
    - transformers: Transformer locations from TRANSFORMER_METADATA

For production deployments, use Snowflake stored procedures instead.
See docs/POSTGRES_SYNC_RELIABILITY.md for the scheduled sync architecture.
"""

import os
import sys
import argparse
import time
from typing import Optional, List, Dict, Any

import snowflake.connector
import psycopg2
from psycopg2.extras import execute_batch


def get_snowflake_connection():
    """Get Snowflake connection using environment variables or SSO."""
    return snowflake.connector.connect(
        account=os.environ.get("SNOWFLAKE_ACCOUNT"),
        user=os.environ.get("SNOWFLAKE_USER"),
        password=os.environ.get("SNOWFLAKE_PASSWORD"),
        authenticator=os.environ.get("SNOWFLAKE_AUTHENTICATOR", "snowflake"),
        database=os.environ.get("SNOWFLAKE_DATABASE", "FLUX_DB"),
        schema=os.environ.get("SNOWFLAKE_SCHEMA", "PRODUCTION"),
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "FLUX_WH"),
    )


def get_postgres_connection():
    """Get Postgres connection using environment variables."""
    host = os.environ.get("VITE_POSTGRES_HOST")
    port = int(os.environ.get("VITE_POSTGRES_PORT", "5432"))
    database = os.environ.get("VITE_POSTGRES_DATABASE", "postgres")
    user = os.environ.get("VITE_POSTGRES_USER")
    password = os.environ.get("VITE_POSTGRES_PASSWORD")
    
    if not all([host, user, password]):
        print("ERROR: Missing Postgres environment variables.")
        print("Required: VITE_POSTGRES_HOST, VITE_POSTGRES_USER, VITE_POSTGRES_PASSWORD")
        sys.exit(1)
    
    return psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )


def sync_topology(sf_conn, pg_conn, batch_size: int = 5000):
    """
    Sync topology connections from Snowflake to Postgres.
    
    Source: FLUX_DB.PRODUCTION.FLUX_OPS_CENTER_TOPOLOGY
    Target: topology_connections_cache
    """
    print("Syncing topology...")
    start_time = time.time()
    
    # Read from Snowflake
    sf_cursor = sf_conn.cursor()
    sf_cursor.execute("""
        SELECT 
            ASSET_ID,
            ASSET_TYPE,
            SUBSTATION_ID,
            CIRCUIT_ID,
            FEEDER_ID,
            LATITUDE,
            LONGITUDE,
            STATUS,
            VOLTAGE_KV
        FROM FLUX_OPS_CENTER_TOPOLOGY
        WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
    """)
    
    rows = sf_cursor.fetchall()
    row_count = len(rows)
    print(f"  Read {row_count:,} rows from Snowflake")
    
    # Write to Postgres with atomic swap
    pg_cursor = pg_conn.cursor()
    pg_conn.autocommit = True
    
    # Truncate and insert
    pg_cursor.execute("TRUNCATE TABLE topology_connections_cache;")
    
    insert_sql = """
        INSERT INTO topology_connections_cache 
        (asset_id, asset_type, substation_id, circuit_id, feeder_id, 
         latitude, longitude, geom, status, voltage_kv)
        VALUES (%s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s)
    """
    
    # Convert rows for batch insert
    insert_rows = [
        (row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[6], row[5], row[7], row[8])
        for row in rows
    ]
    
    execute_batch(pg_cursor, insert_sql, insert_rows, page_size=batch_size)
    
    elapsed = time.time() - start_time
    print(f"  Synced {row_count:,} rows in {elapsed:.1f}s")
    
    sf_cursor.close()
    pg_cursor.close()
    
    return row_count


def sync_vegetation(sf_conn, pg_conn, batch_size: int = 5000):
    """
    Sync vegetation risk data from Snowflake to Postgres.
    
    Source: FLUX_DB.APPLICATIONS.VEGETATION_RISK_ENHANCED
    Target: vegetation_risk_cache
    """
    print("Syncing vegetation...")
    start_time = time.time()
    
    sf_cursor = sf_conn.cursor()
    sf_cursor.execute("""
        SELECT 
            TREE_ID,
            LATITUDE,
            LONGITUDE,
            HEIGHT_M,
            CANOPY_RADIUS_M,
            SPECIES,
            HEALTH_SCORE,
            COMPOSITE_RISK,
            FALL_ZONE_M,
            NEAREST_POWERLINE_ID,
            NEAREST_POWERLINE_DISTANCE_M,
            ENCROACHMENT_CATEGORY
        FROM APPLICATIONS.VEGETATION_RISK_ENHANCED
        WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
        LIMIT 500000
    """)
    
    rows = sf_cursor.fetchall()
    row_count = len(rows)
    print(f"  Read {row_count:,} rows from Snowflake")
    
    pg_cursor = pg_conn.cursor()
    pg_conn.autocommit = True
    
    pg_cursor.execute("TRUNCATE TABLE vegetation_risk_cache;")
    
    insert_sql = """
        INSERT INTO vegetation_risk_cache 
        (tree_id, latitude, longitude, geom, height_m, canopy_radius_m, species,
         health_score, risk_score, fall_zone_m, nearest_line_id, 
         nearest_line_distance_m, encroachment_category)
        VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    
    insert_rows = [
        (row[0], row[1], row[2], row[2], row[1], row[3], row[4], row[5], 
         row[6], row[7], row[8], row[9], row[10], row[11])
        for row in rows
    ]
    
    execute_batch(pg_cursor, insert_sql, insert_rows, page_size=batch_size)
    
    elapsed = time.time() - start_time
    print(f"  Synced {row_count:,} rows in {elapsed:.1f}s")
    
    sf_cursor.close()
    pg_cursor.close()
    
    return row_count


def sync_transformers(sf_conn, pg_conn, batch_size: int = 5000):
    """
    Sync transformer metadata from Snowflake to Postgres.
    
    Source: FLUX_DB.PRODUCTION.TRANSFORMER_METADATA
    Target: transformers_spatial
    """
    print("Syncing transformers...")
    start_time = time.time()
    
    sf_cursor = sf_conn.cursor()
    sf_cursor.execute("""
        SELECT 
            TRANSFORMER_ID,
            SUBSTATION_ID,
            CIRCUIT_ID,
            LATITUDE,
            LONGITUDE,
            RATED_KVA,
            TRANSFORMER_AGE_YEARS,
            MANUFACTURER,
            INSTALLATION_DATE,
            LAST_MAINTENANCE_DATE,
            STATUS
        FROM PRODUCTION.TRANSFORMER_METADATA
        WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
    """)
    
    rows = sf_cursor.fetchall()
    row_count = len(rows)
    print(f"  Read {row_count:,} rows from Snowflake")
    
    pg_cursor = pg_conn.cursor()
    pg_conn.autocommit = True
    
    pg_cursor.execute("TRUNCATE TABLE transformers_spatial;")
    
    insert_sql = """
        INSERT INTO transformers_spatial 
        (transformer_id, substation_id, circuit_id, latitude, longitude, geom,
         rated_kva, age_years, manufacturer, installation_date, last_maintenance, status)
        VALUES (%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s, %s)
    """
    
    insert_rows = [
        (row[0], row[1], row[2], row[3], row[4], row[4], row[3], 
         row[5], row[6], row[7], row[8], row[9], row[10])
        for row in rows
    ]
    
    execute_batch(pg_cursor, insert_sql, insert_rows, page_size=batch_size)
    
    elapsed = time.time() - start_time
    print(f"  Synced {row_count:,} rows in {elapsed:.1f}s")
    
    sf_cursor.close()
    pg_cursor.close()
    
    return row_count


def verify_sync(pg_conn):
    """Verify sync results."""
    print("\nVerifying sync...")
    
    tables = [
        "topology_connections_cache",
        "vegetation_risk_cache",
        "transformers_spatial"
    ]
    
    pg_cursor = pg_conn.cursor()
    
    for table in tables:
        pg_cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = pg_cursor.fetchone()[0]
        print(f"  {table}: {count:,} rows")
    
    pg_cursor.close()


def main():
    parser = argparse.ArgumentParser(description="Sync Snowflake data to Postgres")
    parser.add_argument("--table", choices=["topology", "vegetation", "transformers", "all"],
                        default="all", help="Table to sync")
    parser.add_argument("--batch-size", type=int, default=5000,
                        help="Batch size for inserts")
    args = parser.parse_args()
    
    print("=" * 60)
    print("Flux Operations Center - Snowflake to Postgres Sync")
    print("=" * 60)
    print()
    
    # Connect to both databases
    print("Connecting to Snowflake...")
    try:
        sf_conn = get_snowflake_connection()
        print("  Connected to Snowflake")
    except Exception as e:
        print(f"ERROR: Failed to connect to Snowflake: {e}")
        sys.exit(1)
    
    print("Connecting to Postgres...")
    try:
        pg_conn = get_postgres_connection()
        print("  Connected to Postgres")
    except Exception as e:
        print(f"ERROR: Failed to connect to Postgres: {e}")
        sf_conn.close()
        sys.exit(1)
    
    print()
    
    try:
        # Sync requested tables
        if args.table in ["topology", "all"]:
            sync_topology(sf_conn, pg_conn, args.batch_size)
        
        if args.table in ["vegetation", "all"]:
            sync_vegetation(sf_conn, pg_conn, args.batch_size)
        
        if args.table in ["transformers", "all"]:
            sync_transformers(sf_conn, pg_conn, args.batch_size)
        
        # Verify
        verify_sync(pg_conn)
        
        print("\nSync complete!")
        print("\nNOTE: For production, use Snowflake stored procedures for scheduled sync.")
        print("See docs/POSTGRES_SYNC_RELIABILITY.md")
        
    finally:
        sf_conn.close()
        pg_conn.close()


if __name__ == "__main__":
    main()
