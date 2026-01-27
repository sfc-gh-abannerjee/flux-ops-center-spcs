#!/usr/bin/env python3
"""
#Pattern: Sync OSM Water Polygons from Snowflake to PostGIS

Architecture Story:
- Snowflake = Data Hub / Source of Truth (OSM data lands here)
- PostGIS = Spatial Query Acceleration Layer (sub-100ms viewport queries)

This script demonstrates the "Snowflake as data hub" pattern where:
1. Raw geospatial data is ingested into Snowflake
2. Operational data is synced to PostGIS for fast spatial queries
3. PostGIS spatial indexes enable fast viewport filtering

Usage:
    python sync_osm_water_to_postgres.py
"""

import json
import time
import psycopg2
import snowflake.connector

# Snowflake connection (uses ~/.snowflake/config.toml)
SNOW_CONNECTION = "cpe_demo_CLI"

# PostGIS connection (Snowflake Managed Postgres)
PG_CONFIG = {
    "host": "<your_postgres_host>",
    "port": 5432,
    "database": "postgres",
    "user": "application",
    "password": "<REDACTED_PASSWORD>"
}

# Houston metro bounding box (generous)
HOUSTON_BBOX = {
    "min_lon": -96.0,
    "max_lon": -94.5,
    "min_lat": 29.0,
    "max_lat": 30.5
}

def get_snowflake_connection():
    """Connect to Snowflake using config.toml connection"""
    return snowflake.connector.connect(connection_name=SNOW_CONNECTION)

def fetch_osm_water_from_snowflake():
    """Fetch OSM water polygons from Snowflake for Houston area"""
    print("📥 Fetching OSM water data from Snowflake...")
    start = time.time()
    
    conn = get_snowflake_connection()
    cursor = conn.cursor()
    
    # Query OSM water polygons - filter to actual water types (not coastline/flood zones)
    query = f"""
        SELECT 
            OSM_ID,
            NAME,
            WATER_TYPE,
            ST_ASGEOJSON(GEOMETRY) as geojson,
            ST_AREA(GEOMETRY) * 0.000247105 as acres
        FROM SI_DEMOS.FLUX_GEO.OSM_WATER_POLYGONS
        WHERE ST_XMIN(GEOMETRY) <= {HOUSTON_BBOX['max_lon']}
          AND ST_XMAX(GEOMETRY) >= {HOUSTON_BBOX['min_lon']}
          AND ST_YMIN(GEOMETRY) <= {HOUSTON_BBOX['max_lat']}
          AND ST_YMAX(GEOMETRY) >= {HOUSTON_BBOX['min_lat']}
          AND WATER_TYPE IN ('water', 'river', 'stream', 'canal')
        ORDER BY ST_AREA(GEOMETRY) DESC
    """
    
    cursor.execute(query)
    rows = cursor.fetchall()
    columns = [desc[0] for desc in cursor.description]
    results = [dict(zip(columns, row)) for row in rows]
    
    conn.close()
    
    elapsed = time.time() - start
    print(f"✅ Fetched {len(results):,} water features from Snowflake in {elapsed:.1f}s")
    
    # Show sample
    if results:
        print("\n📊 Sample features:")
        for r in results[:5]:
            name = r.get('NAME') or 'Unnamed'
            wtype = r.get('WATER_TYPE', 'unknown')
            acres = r.get('ACRES', 0)
            print(f"   - {name} ({wtype}): {acres:.1f} acres")
    
    return results

def create_postgres_table(pg_conn):
    """Create PostGIS table for OSM water with spatial index"""
    print("\n🏗️  Creating PostGIS table with spatial index...")
    
    cursor = pg_conn.cursor()
    
    # Drop and recreate for clean sync
    cursor.execute("DROP TABLE IF EXISTS osm_water CASCADE")
    
    # Create table with proper PostGIS geometry column
    cursor.execute("""
        CREATE TABLE osm_water (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT UNIQUE,
            name VARCHAR(255),
            water_type VARCHAR(50),
            acres NUMERIC(12,2),
            geom GEOMETRY(Geometry, 4326)
        )
    """)
    
    # Create spatial index for fast viewport queries
    cursor.execute("""
        CREATE INDEX idx_osm_water_geom ON osm_water USING GIST(geom)
    """)
    
    # Create index on water_type for filtering
    cursor.execute("""
        CREATE INDEX idx_osm_water_type ON osm_water(water_type)
    """)
    
    pg_conn.commit()
    print("✅ Table and spatial indexes created")

def insert_water_features(pg_conn, features):
    """Bulk insert water features into PostGIS"""
    print(f"\n📤 Inserting {len(features):,} features into PostGIS...")
    start = time.time()
    
    cursor = pg_conn.cursor()
    
    inserted = 0
    errors = 0
    
    for feature in features:
        try:
            osm_id = feature.get('OSM_ID')
            name = feature.get('NAME') or 'Unnamed'
            water_type = feature.get('WATER_TYPE', 'water')
            acres = feature.get('ACRES', 0)
            geojson = feature.get('GEOJSON')
            
            if not geojson:
                continue
            
            # Insert using ST_GeomFromGeoJSON
            cursor.execute("""
                INSERT INTO osm_water (osm_id, name, water_type, acres, geom)
                VALUES (%s, %s, %s, %s, ST_GeomFromGeoJSON(%s))
                ON CONFLICT (osm_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    water_type = EXCLUDED.water_type,
                    acres = EXCLUDED.acres,
                    geom = EXCLUDED.geom
            """, (osm_id, name, water_type, acres, geojson))
            
            inserted += 1
            
            if inserted % 500 == 0:
                pg_conn.commit()
                print(f"   ... {inserted:,} inserted")
                
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"   ⚠️  Error inserting OSM_ID {osm_id}: {e}")
    
    pg_conn.commit()
    
    elapsed = time.time() - start
    print(f"✅ Inserted {inserted:,} features in {elapsed:.1f}s ({errors} errors)")
    
    return inserted

def analyze_table(pg_conn):
    """Run ANALYZE for query planner optimization"""
    print("\n📈 Running ANALYZE for query optimization...")
    cursor = pg_conn.cursor()
    cursor.execute("ANALYZE osm_water")
    pg_conn.commit()
    print("✅ Table analyzed")

def verify_sync(pg_conn):
    """Verify the sync with sample queries"""
    print("\n🔍 Verifying sync...")
    cursor = pg_conn.cursor()
    
    # Count by type
    cursor.execute("""
        SELECT water_type, COUNT(*), ROUND(SUM(acres)::numeric, 1) as total_acres
        FROM osm_water
        GROUP BY water_type
        ORDER BY total_acres DESC
    """)
    
    print("\n📊 Water features by type:")
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]:,} features, {row[2]:,} acres")
    
    # Test viewport query performance
    print("\n⏱️  Testing viewport query performance (Barker Reservoir area)...")
    start = time.time()
    cursor.execute("""
        SELECT COUNT(*), ROUND(SUM(acres)::numeric, 1)
        FROM osm_water
        WHERE geom && ST_MakeEnvelope(-95.8, 29.7, -95.55, 29.85, 4326)
    """)
    result = cursor.fetchone()
    elapsed = (time.time() - start) * 1000
    print(f"   Found {result[0]} features ({result[1]} acres) in {elapsed:.1f}ms")
    
    # Show largest features in Barker area
    cursor.execute("""
        SELECT name, water_type, acres
        FROM osm_water
        WHERE geom && ST_MakeEnvelope(-95.8, 29.7, -95.55, 29.85, 4326)
        ORDER BY acres DESC
        LIMIT 5
    """)
    
    print("\n📍 Largest water features in Barker Reservoir area:")
    for row in cursor.fetchall():
        print(f"   - {row[0]} ({row[1]}): {row[2]} acres")

def main():
    print("=" * 60)
    print("#Pattern: Snowflake → PostGIS Water Data Sync")
    print("=" * 60)
    print("\n🏗️  Architecture:")
    print("   Snowflake OSM_WATER_POLYGONS (source of truth)")
    print("        ↓")
    print("   PostGIS osm_water (spatial acceleration)")
    print("        ↓")
    print("   Fast API (~50ms viewport queries)")
    print()
    
    # Step 1: Fetch from Snowflake
    features = fetch_osm_water_from_snowflake()
    
    if not features:
        print("❌ No features fetched from Snowflake")
        return
    
    # Step 2: Connect to PostGIS and create table
    print("\n🔌 Connecting to PostGIS...")
    pg_conn = psycopg2.connect(**PG_CONFIG)
    print(f"✅ Connected to {PG_CONFIG['host']}")
    
    # Step 3: Create table with spatial index
    create_postgres_table(pg_conn)
    
    # Step 4: Insert features
    inserted = insert_water_features(pg_conn, features)
    
    # Step 5: Optimize
    analyze_table(pg_conn)
    
    # Step 6: Verify
    verify_sync(pg_conn)
    
    pg_conn.close()
    
    print("\n" + "=" * 60)
    print("✅ Sync complete!")
    print("=" * 60)
    print("\n📝 Next steps:")
    print("   1. Update API to query PostGIS osm_water table")
    print("   2. Enjoy sub-100ms water layer queries")
    print("   3. Demo the Snowflake → PostGIS architecture story")

if __name__ == "__main__":
    main()
