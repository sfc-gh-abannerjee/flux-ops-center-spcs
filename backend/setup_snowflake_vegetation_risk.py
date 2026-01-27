#!/usr/bin/env python3
"""
ARCHITECTURE: Sync Power Lines to Snowflake and Create Dynamic Table

Production Data Flow:
1. GIS System (ESRI) → Snowflake (via data pipeline)
2. Snowflake computes vegetation risk using ST_DISTANCE
3. Computed results sync to Postgres for low-latency serving

For this demo, we reverse sync Postgres → Snowflake to set up the architecture.
"""

import asyncio
import asyncpg
import snowflake.connector
import os
from datetime import datetime

# Postgres connection
POSTGRES_HOST = "<your_postgres_host>"
POSTGRES_PORT = 5432
POSTGRES_DB = "postgres"
POSTGRES_USER = "application"
POSTGRES_PASSWORD = "<REDACTED_PASSWORD>"

# Snowflake connection (uses snow CLI config)
SNOWFLAKE_ACCOUNT = "gzb42423"
SNOWFLAKE_DATABASE = "SI_DEMOS"
SNOWFLAKE_SCHEMA = "APPLICATIONS"
SNOWFLAKE_WAREHOUSE = "SI_DEMO_WH"


async def sync_power_lines_to_snowflake():
    """
    Sync power line geometries from Postgres to Snowflake.
    In production, this would be GIS → Snowflake directly.
    """
    print("=" * 70)
    print("ARCHITECTURE: Sync Power Lines to Snowflake")
    print("=" * 70)
    
    # Connect to Postgres
    print("\n[1/4] Connecting to PostgreSQL...")
    pg_conn = await asyncpg.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )
    
    # Export power lines with WKT geometry
    print("[2/4] Exporting power lines from PostgreSQL...")
    rows = await pg_conn.fetch("""
        SELECT 
            power_line_id,
            class as line_class,
            length_meters,
            centroid_lon,
            centroid_lat,
            ST_AsText(geom) as geom_wkt
        FROM power_lines_spatial
    """)
    print(f"   Exported {len(rows):,} power lines")
    await pg_conn.close()
    
    # Connect to Snowflake using snow CLI connection
    print("[3/4] Connecting to Snowflake...")
    import subprocess
    import json
    
    # Get connection info from snow CLI
    result = subprocess.run(
        ["snow", "connection", "list", "--format", "json"],
        capture_output=True, text=True
    )
    connections = json.loads(result.stdout)
    cpe_conn = next((c for c in connections if c.get("connection_name") == "cpe_demo_CLI"), None)
    
    if not cpe_conn:
        print("   ERROR: Could not find cpe_demo_CLI connection")
        return
    
    # Use snow sql to insert data
    print("[4/4] Inserting power lines into Snowflake...")
    
    # Clear existing data
    subprocess.run([
        "snow", "sql", "-q", 
        "TRUNCATE TABLE SI_DEMOS.APPLICATIONS.POWER_LINES_SPATIAL",
        "-c", "cpe_demo_CLI"
    ], capture_output=True)
    
    # Insert in batches
    batch_size = 100
    inserted = 0
    
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        values = []
        
        for r in batch:
            wkt = r['geom_wkt'].replace("'", "''") if r['geom_wkt'] else None
            if wkt:
                values.append(f"""(
                    '{r['power_line_id']}',
                    '{r['line_class']}',
                    NULL,
                    {r['length_meters'] or 'NULL'},
                    NULL,
                    {r['centroid_lon'] or 'NULL'},
                    {r['centroid_lat'] or 'NULL'},
                    NULL,
                    NULL,
                    TO_GEOGRAPHY('{wkt}'),
                    CURRENT_TIMESTAMP()
                )""")
        
        if values:
            insert_sql = f"""
                INSERT INTO SI_DEMOS.APPLICATIONS.POWER_LINES_SPATIAL 
                (POWER_LINE_ID, LINE_CLASS, VOLTAGE_KV, LENGTH_METERS, CIRCUIT_ID,
                 FROM_LONGITUDE, FROM_LATITUDE, TO_LONGITUDE, TO_LATITUDE, GEOM, CREATED_AT)
                VALUES {','.join(values)}
            """
            
            result = subprocess.run([
                "snow", "sql", "-q", insert_sql, "-c", "cpe_demo_CLI"
            ], capture_output=True, text=True)
            
            if "error" in result.stderr.lower():
                print(f"   Error inserting batch: {result.stderr[:200]}")
            else:
                inserted += len(batch)
        
        if (i + batch_size) % 500 == 0:
            print(f"   Inserted {inserted:,} / {len(rows):,}...")
    
    print(f"\n   Successfully synced {inserted:,} power lines to Snowflake")
    
    # Verify
    result = subprocess.run([
        "snow", "sql", "-q", 
        "SELECT COUNT(*) as cnt FROM SI_DEMOS.APPLICATIONS.POWER_LINES_SPATIAL",
        "-c", "cpe_demo_CLI"
    ], capture_output=True, text=True)
    print(f"   Verification: {result.stdout}")


def create_vegetation_risk_dynamic_table():
    """
    Create a Snowflake Dynamic Table that computes vegetation risk.
    This auto-refreshes when source data changes.
    """
    print("\n" + "=" * 70)
    print("Creating Vegetation Risk Dynamic Table in Snowflake")
    print("=" * 70)
    
    # Dynamic Table SQL
    dynamic_table_sql = """
    CREATE OR REPLACE DYNAMIC TABLE SI_DEMOS.APPLICATIONS.VEGETATION_RISK_COMPUTED
        TARGET_LAG = '1 hour'
        WAREHOUSE = SI_DEMO_WH
    AS
    WITH nearest_power_line AS (
        SELECT 
            v.TREE_ID,
            p.POWER_LINE_ID,
            p.LINE_CLASS,
            p.VOLTAGE_KV,
            ST_DISTANCE(v.GEOM, p.GEOM) as DISTANCE_TO_LINE_M
        FROM SI_DEMOS.APPLICATIONS.VEGETATION_RISK_ENHANCED v
        CROSS JOIN SI_DEMOS.APPLICATIONS.POWER_LINES_SPATIAL p
        WHERE ST_DISTANCE(v.GEOM, p.GEOM) = (
            SELECT MIN(ST_DISTANCE(v.GEOM, p2.GEOM))
            FROM SI_DEMOS.APPLICATIONS.POWER_LINES_SPATIAL p2
        )
        QUALIFY ROW_NUMBER() OVER (PARTITION BY v.TREE_ID ORDER BY ST_DISTANCE(v.GEOM, p.GEOM)) = 1
    )
    SELECT 
        v.TREE_ID,
        v.SPECIES,
        v.TREE_CLASS,
        v.HEIGHT_M,
        v.CANOPY_RADIUS_M,
        v.LATITUDE,
        v.LONGITUDE,
        v.GEOM,
        
        -- Fall zone calculation
        (v.HEIGHT_M + v.CANOPY_RADIUS_M) as FALL_ZONE_M,
        
        -- Real proximity data from spatial join
        pl.POWER_LINE_ID as NEAREST_LINE_ID,
        pl.LINE_CLASS as NEAREST_LINE_CLASS,
        pl.VOLTAGE_KV as NEAREST_LINE_VOLTAGE_KV,
        pl.DISTANCE_TO_LINE_M,
        
        -- Computed risk score
        CASE
            WHEN pl.DISTANCE_TO_LINE_M <= (v.HEIGHT_M + v.CANOPY_RADIUS_M) THEN
                LEAST(1.0, 0.85 + (1 - pl.DISTANCE_TO_LINE_M / NULLIF(v.HEIGHT_M + v.CANOPY_RADIUS_M, 0)) * 0.15)
            WHEN pl.DISTANCE_TO_LINE_M <= (v.HEIGHT_M + v.CANOPY_RADIUS_M) * 1.5 THEN
                0.5 + (1 - pl.DISTANCE_TO_LINE_M / NULLIF((v.HEIGHT_M + v.CANOPY_RADIUS_M) * 1.5, 0)) * 0.3
            ELSE
                LEAST(0.2, v.HEIGHT_M / 100.0)
        END as RISK_SCORE,
        
        -- Risk level
        CASE
            WHEN pl.DISTANCE_TO_LINE_M <= (v.HEIGHT_M + v.CANOPY_RADIUS_M) THEN 'critical'
            WHEN pl.DISTANCE_TO_LINE_M <= (v.HEIGHT_M + v.CANOPY_RADIUS_M) * 1.5 THEN 'warning'
            ELSE 'safe'
        END as RISK_LEVEL,
        
        -- Human readable explanation
        CASE
            WHEN pl.DISTANCE_TO_LINE_M <= (v.HEIGHT_M + v.CANOPY_RADIUS_M) THEN
                'Power line at ' || ROUND(pl.DISTANCE_TO_LINE_M, 1) || 'm within ' || 
                ROUND(v.HEIGHT_M + v.CANOPY_RADIUS_M, 1) || 'm fall zone'
            WHEN pl.DISTANCE_TO_LINE_M <= (v.HEIGHT_M + v.CANOPY_RADIUS_M) * 1.5 THEN
                'Power line at ' || ROUND(pl.DISTANCE_TO_LINE_M, 1) || 'm approaching fall zone'
            ELSE
                'No infrastructure within ' || ROUND(v.HEIGHT_M + v.CANOPY_RADIUS_M, 1) || 'm fall zone'
        END as RISK_EXPLANATION,
        
        CURRENT_TIMESTAMP() as COMPUTED_AT
        
    FROM SI_DEMOS.APPLICATIONS.VEGETATION_RISK_ENHANCED v
    LEFT JOIN nearest_power_line pl ON v.TREE_ID = pl.TREE_ID
    WHERE v.HEIGHT_M IS NOT NULL AND v.CANOPY_RADIUS_M IS NOT NULL
    """
    
    print("\n[1/2] Creating Dynamic Table...")
    result = subprocess.run([
        "snow", "sql", "-q", dynamic_table_sql, "-c", "cpe_demo_CLI"
    ], capture_output=True, text=True)
    
    if "error" in result.stderr.lower():
        print(f"   Error: {result.stderr}")
    else:
        print(f"   Success: {result.stdout}")
    
    # Verify
    print("\n[2/2] Verifying Dynamic Table...")
    result = subprocess.run([
        "snow", "sql", "-q", 
        "SELECT RISK_LEVEL, COUNT(*) as CNT FROM SI_DEMOS.APPLICATIONS.VEGETATION_RISK_COMPUTED GROUP BY RISK_LEVEL",
        "-c", "cpe_demo_CLI"
    ], capture_output=True, text=True)
    print(f"   Risk distribution:\n{result.stdout}")


if __name__ == "__main__":
    import subprocess
    
    # Step 1: Sync power lines to Snowflake
    asyncio.run(sync_power_lines_to_snowflake())
    
    # Step 2: Create Dynamic Table
    create_vegetation_risk_dynamic_table()
    
    print("\n" + "=" * 70)
    print("ARCHITECTURE COMPLETE")
    print("=" * 70)
    print("""
Data Flow:
  [GIS/LiDAR] → [Snowflake: Source Tables]
                      ↓
              [Snowflake: Dynamic Table]
              (computes risk using ST_DISTANCE)
                      ↓
              [Sync to Postgres]
              (for low-latency serving)
                      ↓
              [Frontend]

The Dynamic Table auto-refreshes within 1 hour of source data changes.
""")
