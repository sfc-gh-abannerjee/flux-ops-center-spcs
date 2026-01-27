#!/usr/bin/env python3
"""
Fix vegetation_risk table to reference actual power line IDs instead of fake LINE-xxxx IDs.

Uses PostGIS spatial query to find the nearest real power line for each tree.
"""
import asyncio
import asyncpg
import time

PG_CONFIG = {
    'host': '<your_postgres_host>',
    'port': 5432,
    'database': 'postgres',
    'user': 'application',
    'password': '<REDACTED_PASSWORD>',
    'ssl': 'require'
}


async def main():
    print("=" * 70)
    print("Fix Vegetation Risk - Link to Real Power Lines")
    print("=" * 70)
    
    conn = await asyncpg.connect(**PG_CONFIG)
    
    # Check current state
    print("\n📊 Current state:")
    fake_count = await conn.fetchval("""
        SELECT COUNT(*) FROM vegetation_risk 
        WHERE nearest_line_id LIKE 'LINE-%'
    """)
    print(f"   Trees with fake LINE-xxxx IDs: {fake_count:,}")
    
    total_trees = await conn.fetchval("SELECT COUNT(*) FROM vegetation_risk")
    print(f"   Total trees: {total_trees:,}")
    
    # Check power lines
    line_count = await conn.fetchval("SELECT COUNT(*) FROM power_lines_spatial")
    print(f"   Power lines available: {line_count:,}")
    
    if fake_count == 0:
        print("\n✅ All trees already have real line IDs!")
        await conn.close()
        return
    
    # Update trees with nearest real power line
    print("\n🔧 Finding nearest real power line for each tree...")
    print("   (Using PostGIS spatial query with index)")
    start = time.time()
    
    # Use a batch approach with lateral join for efficiency
    # This finds the nearest power line within 100m for each tree
    result = await conn.execute("""
        WITH nearest_lines AS (
            SELECT DISTINCT ON (v.tree_id)
                v.tree_id,
                p.power_line_id,
                ST_Distance(v.geom::geography, p.geom::geography) as distance_m
            FROM vegetation_risk v
            CROSS JOIN LATERAL (
                SELECT power_line_id, geom
                FROM power_lines_spatial p
                WHERE ST_DWithin(v.geom::geography, p.geom::geography, 100)
                ORDER BY v.geom <-> p.geom
                LIMIT 1
            ) p
            WHERE v.nearest_line_id LIKE 'LINE-%'
        )
        UPDATE vegetation_risk v
        SET 
            nearest_line_id = n.power_line_id,
            distance_to_line_m = ROUND(n.distance_m::numeric, 1)
        FROM nearest_lines n
        WHERE v.tree_id = n.tree_id
    """)
    
    elapsed = time.time() - start
    updated_count = int(result.split()[-1]) if result else 0
    print(f"   ✅ Updated {updated_count:,} trees in {elapsed:.1f}s")
    
    # Handle trees that might not have a line within 100m - expand search
    remaining = await conn.fetchval("""
        SELECT COUNT(*) FROM vegetation_risk 
        WHERE nearest_line_id LIKE 'LINE-%'
    """)
    
    if remaining > 0:
        print(f"\n🔧 {remaining:,} trees still need line assignment (expanding search to 500m)...")
        start = time.time()
        
        result = await conn.execute("""
            WITH nearest_lines AS (
                SELECT DISTINCT ON (v.tree_id)
                    v.tree_id,
                    p.power_line_id,
                    ST_Distance(v.geom::geography, p.geom::geography) as distance_m
                FROM vegetation_risk v
                CROSS JOIN LATERAL (
                    SELECT power_line_id, geom
                    FROM power_lines_spatial p
                    WHERE ST_DWithin(v.geom::geography, p.geom::geography, 500)
                    ORDER BY v.geom <-> p.geom
                    LIMIT 1
                ) p
                WHERE v.nearest_line_id LIKE 'LINE-%'
            )
            UPDATE vegetation_risk v
            SET 
                nearest_line_id = n.power_line_id,
                distance_to_line_m = ROUND(n.distance_m::numeric, 1)
            FROM nearest_lines n
            WHERE v.tree_id = n.tree_id
        """)
        
        elapsed = time.time() - start
        print(f"   ✅ Updated additional trees in {elapsed:.1f}s")
    
    # Final check
    print("\n📊 Final state:")
    remaining = await conn.fetchval("""
        SELECT COUNT(*) FROM vegetation_risk 
        WHERE nearest_line_id LIKE 'LINE-%'
    """)
    real_count = await conn.fetchval("""
        SELECT COUNT(*) FROM vegetation_risk 
        WHERE nearest_line_id NOT LIKE 'LINE-%'
    """)
    print(f"   Trees with real line IDs: {real_count:,}")
    print(f"   Trees still with fake IDs: {remaining:,}")
    
    # Sample verification
    print("\n📋 Sample of updated trees:")
    samples = await conn.fetch("""
        SELECT 
            v.tree_id,
            v.nearest_line_id,
            v.distance_to_line_m,
            p.class as line_class
        FROM vegetation_risk v
        LEFT JOIN power_lines_spatial p ON v.nearest_line_id = p.power_line_id
        WHERE v.nearest_line_id NOT LIKE 'LINE-%'
        LIMIT 5
    """)
    for s in samples:
        print(f"   Tree {s['tree_id'][:8]}... -> Line {s['nearest_line_id'][:8]}... ({s['line_class']}) at {s['distance_to_line_m']}m")
    
    await conn.close()
    print("\n✅ Vegetation line references fixed!")


if __name__ == '__main__':
    asyncio.run(main())
