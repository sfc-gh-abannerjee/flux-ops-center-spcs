#!/usr/bin/env python3
"""
Engineering: Load building footprints from Snowflake to PostGIS

This script:
1. Creates a new table with POLYGON geometry (not POINT)
2. Loads all 2.7M buildings from Snowflake SI_DEMOS.RAW.HOUSTON_BUILDINGS_FOOTPRINTS
3. Creates spatial index for instant MVT tile generation

Run once to populate PostGIS, then MVT tiles serve instantly.
"""

import asyncio
import asyncpg
import snowflake.connector
import os
import time
import json
from dotenv import load_dotenv

load_dotenv()

POSTGRES_CONFIG = {
    'host': os.getenv('VITE_POSTGRES_HOST'),
    'port': int(os.getenv('VITE_POSTGRES_PORT', 5432)),
    'database': os.getenv('VITE_POSTGRES_DATABASE'),
    'user': os.getenv('VITE_POSTGRES_USER'),
    'password': os.getenv('VITE_POSTGRES_PASSWORD'),
    'ssl': 'require'
}

SNOWFLAKE_CONNECTION = os.getenv('SNOWFLAKE_CONNECTION_NAME', 'cpe_demo_CLI')
BATCH_SIZE = 10000

async def main():
    print("=" * 60)
    print("Engineering: Building Footprints ETL (Snowflake → PostGIS)")
    print("=" * 60)
    
    # Connect to PostgreSQL
    print("\n[1/5] Connecting to PostgreSQL...")
    pg_conn = await asyncpg.connect(**POSTGRES_CONFIG)
    print(f"  ✓ Connected to {POSTGRES_CONFIG['host']}")
    
    # Create table with POLYGON geometry
    print("\n[2/5] Creating building_footprints table...")
    await pg_conn.execute("""
        DROP TABLE IF EXISTS building_footprints;
        
        CREATE TABLE building_footprints (
            building_id VARCHAR(50) PRIMARY KEY,
            building_name VARCHAR(255),
            building_type VARCHAR(50),
            height_meters DOUBLE PRECISION,
            num_floors INTEGER,
            geom GEOMETRY(POLYGON, 4326)
        );
    """)
    print("  ✓ Table created")
    
    # Connect to Snowflake
    print("\n[3/5] Connecting to Snowflake...")
    sf_conn = snowflake.connector.connect(connection_name=SNOWFLAKE_CONNECTION)
    sf_cursor = sf_conn.cursor()
    print(f"  ✓ Connected via {SNOWFLAKE_CONNECTION}")
    
    # Count total rows
    sf_cursor.execute("SELECT COUNT(*) FROM SI_DEMOS.RAW.HOUSTON_BUILDINGS_FOOTPRINTS")
    total_rows = sf_cursor.fetchone()[0]
    print(f"  ✓ Found {total_rows:,} buildings to load")
    
    # Fetch and insert in batches
    print(f"\n[4/5] Loading buildings (batch size: {BATCH_SIZE:,})...")
    start_time = time.time()
    
    sf_cursor.execute("""
        SELECT 
            BUILDING_ID,
            BUILDING_NAME,
            BUILDING_TYPE,
            HEIGHT_METERS,
            NUM_FLOORS,
            ST_ASGEOJSON(GEOMETRY) as geojson
        FROM SI_DEMOS.RAW.HOUSTON_BUILDINGS_FOOTPRINTS
    """)
    
    loaded = 0
    batch = []
    
    while True:
        rows = sf_cursor.fetchmany(BATCH_SIZE)
        if not rows:
            break
        
        for row in rows:
            building_id, name, btype, height, floors, geojson_str = row
            if geojson_str:
                try:
                    geom = json.loads(geojson_str)
                    if geom.get('type') == 'Polygon':
                        batch.append((
                            building_id,
                            name,
                            btype,
                            float(height) if height else None,
                            floors,
                            geojson_str
                        ))
                except:
                    pass
        
        if batch:
            await pg_conn.executemany("""
                INSERT INTO building_footprints (building_id, building_name, building_type, height_meters, num_floors, geom)
                VALUES ($1, $2, $3, $4, $5, ST_GeomFromGeoJSON($6))
                ON CONFLICT (building_id) DO NOTHING
            """, batch)
            loaded += len(batch)
            batch = []
            
            elapsed = time.time() - start_time
            rate = loaded / elapsed if elapsed > 0 else 0
            pct = (loaded / total_rows) * 100
            print(f"  → {loaded:,} / {total_rows:,} ({pct:.1f}%) - {rate:.0f} rows/sec", end='\r')
    
    print(f"\n  ✓ Loaded {loaded:,} buildings in {time.time() - start_time:.1f}s")
    
    # Create spatial index
    print("\n[5/5] Creating spatial index...")
    await pg_conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_building_footprints_geom 
        ON building_footprints USING GIST (geom);
    """)
    print("  ✓ GIST index created")
    
    # Verify
    count = await pg_conn.fetchval("SELECT COUNT(*) FROM building_footprints")
    geom_type = await pg_conn.fetchval("SELECT GeometryType(geom) FROM building_footprints LIMIT 1")
    print(f"\n  Final count: {count:,} buildings")
    print(f"  Geometry type: {geom_type}")
    
    # Cleanup
    sf_cursor.close()
    sf_conn.close()
    await pg_conn.close()
    
    print("\n" + "=" * 60)
    print("✓ ETL Complete! MVT tiles now available at:")
    print("  /api/spatial/tiles/buildings/{z}/{x}/{y}.mvt")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
