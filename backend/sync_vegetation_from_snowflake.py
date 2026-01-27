#!/usr/bin/env python3
"""
Engineering: Sync vegetation risk data FROM Snowflake TO PostgreSQL.

The correct data flow is:
1. Source data lives in Snowflake
2. Snowflake Dynamic Table (VEGETATION_RISK_COMPUTED) does spatial joins
3. This script syncs the computed results to PostgreSQL for low-latency serving

This is the CORRECT pattern - compute in Snowflake, serve from Postgres.
"""
import asyncio
import asyncpg
import subprocess
import json
import time

PG_CONFIG = {
    'host': '<your_postgres_host>',
    'port': 5432,
    'database': 'postgres',
    'user': 'application',
    'password': '<REDACTED_PASSWORD>',
    'ssl': 'require'
}


def fetch_from_snowflake(query: str) -> list[dict]:
    """Execute query in Snowflake and return results as list of dicts."""
    result = subprocess.run(
        ["snow", "sql", "-q", query, "-c", "cpe_demo_CLI", "--format", "json"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Snowflake error: {result.stderr}")
        return []
    
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"Failed to parse JSON: {result.stdout[:500]}")
        return []


async def main():
    print("=" * 70)
    print("Engineering: Sync Vegetation Risk from Snowflake → PostgreSQL")
    print("=" * 70)
    
    # Check Snowflake source
    print("\n📊 Checking Snowflake source (VEGETATION_RISK_COMPUTED)...")
    sf_count = fetch_from_snowflake(
        "SELECT COUNT(*) as cnt FROM SI_DEMOS.APPLICATIONS.VEGETATION_RISK_COMPUTED"
    )
    print(f"   Records in Snowflake: {sf_count[0]['CNT']:,}")
    
    # Check current Postgres state
    print("\n📊 Checking PostgreSQL target...")
    pg_conn = await asyncpg.connect(**PG_CONFIG)
    
    pg_count = await pg_conn.fetchval("SELECT COUNT(*) FROM vegetation_risk")
    fake_count = await pg_conn.fetchval(
        "SELECT COUNT(*) FROM vegetation_risk WHERE nearest_line_id LIKE 'LINE-%'"
    )
    print(f"   Records in PostgreSQL: {pg_count:,}")
    print(f"   With fake LINE-xxx IDs: {fake_count:,}")
    
    if fake_count == 0:
        print("\n✅ PostgreSQL already has real line IDs!")
        await pg_conn.close()
        return
    
    # Fetch data from Snowflake in batches
    print("\n🔄 Fetching vegetation data from Snowflake...")
    start = time.time()
    
    # Get all computed vegetation risk data
    veg_data = fetch_from_snowflake("""
        SELECT 
            TREE_ID,
            SPECIES,
            TREE_CLASS,
            HEIGHT_M,
            CANOPY_RADIUS_M,
            LATITUDE,
            LONGITUDE,
            FALL_ZONE_M,
            NEAREST_LINE_ID,
            NEAREST_LINE_CLASS,
            DISTANCE_TO_LINE_M,
            RISK_SCORE,
            RISK_LEVEL
        FROM SI_DEMOS.APPLICATIONS.VEGETATION_RISK_COMPUTED
    """)
    
    print(f"   Fetched {len(veg_data):,} records in {time.time()-start:.1f}s")
    
    if not veg_data:
        print("   ERROR: No data returned from Snowflake")
        await pg_conn.close()
        return
    
    # Update PostgreSQL using temp table + JOIN pattern
    print("\n🔧 Updating PostgreSQL with real line IDs...")
    start = time.time()
    
    # Create temp table
    await pg_conn.execute("""
        CREATE TEMP TABLE veg_update (
            tree_id TEXT PRIMARY KEY,
            nearest_line_id TEXT,
            distance_to_line_m FLOAT,
            risk_score FLOAT,
            risk_level TEXT
        )
    """)
    
    # Bulk insert into temp table
    records = [
        (
            r['TREE_ID'],
            r['NEAREST_LINE_ID'],
            float(r['DISTANCE_TO_LINE_M']) if r['DISTANCE_TO_LINE_M'] else None,
            float(r['RISK_SCORE']) if r['RISK_SCORE'] else None,
            r['RISK_LEVEL']
        )
        for r in veg_data
        if r['TREE_ID'] and r['NEAREST_LINE_ID']
    ]
    
    await pg_conn.executemany("""
        INSERT INTO veg_update (tree_id, nearest_line_id, distance_to_line_m, risk_score, risk_level)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tree_id) DO NOTHING
    """, records)
    
    print(f"   Staged {len(records):,} records in temp table")
    
    # Update vegetation_risk from temp table
    result = await pg_conn.execute("""
        UPDATE vegetation_risk v
        SET 
            nearest_line_id = u.nearest_line_id,
            distance_to_line_m = COALESCE(u.distance_to_line_m, v.distance_to_line_m),
            risk_score = COALESCE(u.risk_score, v.risk_score),
            risk_level = COALESCE(u.risk_level, v.risk_level)
        FROM veg_update u
        WHERE v.tree_id = u.tree_id
    """)
    
    updated = int(result.split()[-1]) if result else 0
    print(f"   Updated {updated:,} records in {time.time()-start:.1f}s")
    
    # Cleanup
    await pg_conn.execute("DROP TABLE IF EXISTS veg_update")
    
    # Verify
    print("\n📊 Final state:")
    real_count = await pg_conn.fetchval(
        "SELECT COUNT(*) FROM vegetation_risk WHERE nearest_line_id NOT LIKE 'LINE-%'"
    )
    still_fake = await pg_conn.fetchval(
        "SELECT COUNT(*) FROM vegetation_risk WHERE nearest_line_id LIKE 'LINE-%'"
    )
    print(f"   With real line IDs: {real_count:,}")
    print(f"   Still with fake IDs: {still_fake:,}")
    
    # Sample verification
    print("\n📋 Sample records with real line IDs:")
    samples = await pg_conn.fetch("""
        SELECT 
            tree_id,
            nearest_line_id,
            distance_to_line_m,
            risk_level
        FROM vegetation_risk
        WHERE nearest_line_id NOT LIKE 'LINE-%'
        LIMIT 5
    """)
    for s in samples:
        print(f"   Tree {s['tree_id'][:12]}... → Line {s['nearest_line_id'][:12]}... at {s['distance_to_line_m']:.1f}m ({s['risk_level']})")
    
    await pg_conn.close()
    print("\n✅ Vegetation risk sync complete!")


if __name__ == '__main__':
    asyncio.run(main())
