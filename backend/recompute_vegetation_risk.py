#!/usr/bin/env python3
"""
Engineering: Recompute vegetation risk using REAL PostGIS spatial analysis.

This is how a real utility would handle vegetation risk:
1. Batch computation using spatial joins (not real-time API calls)
2. Risk stored in database as source of truth
3. Frontend just displays the authoritative data

This script:
1. Computes REAL distance to nearest power line for each tree
2. Computes REAL distance to nearest grid assets
3. Calculates proper risk scores based on actual spatial relationships
4. Updates the vegetation_risk table with accurate values

Run this once to fix the synthetic data, or schedule it to run after LiDAR updates.
"""

import asyncio
import asyncpg
import os
import time
from dotenv import load_dotenv

load_dotenv()

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", 5432))
POSTGRES_DB = os.getenv("POSTGRES_DB", "flux_demo")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")

async def recompute_vegetation_risk():
    """
    Recompute vegetation risk for all trees using PostGIS spatial analysis.
    
    Risk calculation based on:
    - Distance to nearest power line (primary factor)
    - Distance to nearest grid asset (secondary factor)
    - Tree fall zone (height + canopy radius)
    """
    print("=" * 70)
    print("#VEGETATION RISK RECOMPUTATION")
    print("Using PostGIS spatial analysis for REAL proximity data")
    print("=" * 70)
    
    conn = await asyncpg.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )
    
    try:
        # Step 1: Check current state
        print("\n[1/5] Analyzing current vegetation data...")
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_trees,
                COUNT(CASE WHEN nearest_line_id LIKE 'LINE-%' THEN 1 END) as fake_line_refs,
                AVG(risk_score) as avg_risk,
                AVG(distance_to_line_m) as avg_distance
            FROM vegetation_risk
        """)
        print(f"   Total trees: {stats['total_trees']:,}")
        print(f"   Fake LINE-XXXX references: {stats['fake_line_refs']:,}")
        print(f"   Current avg risk: {stats['avg_risk']:.2f}")
        print(f"   Current avg distance to line: {stats['avg_distance']:.1f}m (SYNTHETIC)")
        
        # Step 2: Add real proximity columns if they don't exist
        print("\n[2/5] Ensuring real proximity columns exist...")
        await conn.execute("""
            ALTER TABLE vegetation_risk 
            ADD COLUMN IF NOT EXISTS real_distance_to_line_m FLOAT,
            ADD COLUMN IF NOT EXISTS real_nearest_line_id VARCHAR(100),
            ADD COLUMN IF NOT EXISTS real_nearest_asset_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS real_nearest_asset_type VARCHAR(30),
            ADD COLUMN IF NOT EXISTS real_nearest_asset_distance_m FLOAT,
            ADD COLUMN IF NOT EXISTS computed_risk_score FLOAT,
            ADD COLUMN IF NOT EXISTS computed_risk_level VARCHAR(20),
            ADD COLUMN IF NOT EXISTS risk_factors TEXT,
            ADD COLUMN IF NOT EXISTS last_risk_computation TIMESTAMP DEFAULT NOW()
        """)
        print("   Columns ready.")
        
        # Step 3: Compute real distance to nearest power line for all trees
        print("\n[3/5] Computing REAL distance to nearest power line...")
        print("   This uses PostGIS ST_Distance on actual power line geometries...")
        start = time.time()
        
        # Use a lateral join for efficient nearest-neighbor lookup
        updated_lines = await conn.execute("""
            UPDATE vegetation_risk v
            SET 
                real_distance_to_line_m = nearest.distance_m,
                real_nearest_line_id = nearest.power_line_id
            FROM (
                SELECT DISTINCT ON (v2.tree_id)
                    v2.tree_id,
                    p.power_line_id,
                    ST_Distance(v2.geom::geography, p.geom::geography) as distance_m
                FROM vegetation_risk v2
                CROSS JOIN LATERAL (
                    SELECT power_line_id, geom
                    FROM power_lines_spatial
                    ORDER BY v2.geom <-> geom
                    LIMIT 1
                ) p
            ) nearest
            WHERE v.tree_id = nearest.tree_id
        """)
        elapsed = time.time() - start
        print(f"   Power line distances computed in {elapsed:.1f}s")
        
        # Step 4: Compute real distance to nearest grid asset
        print("\n[4/5] Computing REAL distance to nearest grid asset...")
        start = time.time()
        
        updated_assets = await conn.execute("""
            UPDATE vegetation_risk v
            SET 
                real_nearest_asset_id = nearest.asset_id,
                real_nearest_asset_type = nearest.asset_type,
                real_nearest_asset_distance_m = nearest.distance_m
            FROM (
                SELECT DISTINCT ON (v2.tree_id)
                    v2.tree_id,
                    a.asset_id,
                    a.asset_type,
                    ST_Distance(
                        v2.geom::geography,
                        ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography
                    ) as distance_m
                FROM vegetation_risk v2
                CROSS JOIN LATERAL (
                    SELECT asset_id, asset_type, longitude, latitude
                    FROM grid_assets
                    WHERE longitude IS NOT NULL AND latitude IS NOT NULL
                    ORDER BY ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) <-> v2.geom
                    LIMIT 1
                ) a
            ) nearest
            WHERE v.tree_id = nearest.tree_id
        """)
        elapsed = time.time() - start
        print(f"   Asset distances computed in {elapsed:.1f}s")
        
        # Step 5: Compute risk scores based on REAL proximity
        print("\n[5/5] Computing risk scores from REAL spatial data...")
        start = time.time()
        
        # Risk calculation:
        # - Fall zone = height_m + canopy_radius_m
        # - If power line within fall zone: HIGH risk (0.7-1.0)
        # - If asset within fall zone: MODERATE risk (0.4-0.7)
        # - If nothing in fall zone: LOW risk (0.0-0.3)
        await conn.execute("""
            UPDATE vegetation_risk
            SET 
                computed_risk_score = CASE
                    -- Critical: Power line within fall zone
                    WHEN real_distance_to_line_m <= (height_m + canopy_radius_m) THEN
                        LEAST(1.0, 0.85 + (1 - real_distance_to_line_m / NULLIF(height_m + canopy_radius_m, 0)) * 0.15)
                    -- Warning: Power line within 1.5x fall zone
                    WHEN real_distance_to_line_m <= (height_m + canopy_radius_m) * 1.5 THEN
                        0.5 + (1 - real_distance_to_line_m / NULLIF((height_m + canopy_radius_m) * 1.5, 0)) * 0.3
                    -- Moderate: Grid asset within fall zone (no nearby power line)
                    WHEN real_nearest_asset_distance_m <= (height_m + canopy_radius_m) THEN
                        CASE 
                            WHEN real_nearest_asset_type IN ('substation', 'transformer') THEN
                                0.5 + (1 - real_nearest_asset_distance_m / NULLIF(height_m + canopy_radius_m, 0)) * 0.35
                            ELSE
                                0.4 + (1 - real_nearest_asset_distance_m / NULLIF(height_m + canopy_radius_m, 0)) * 0.25
                        END
                    -- Low: Nothing in fall zone
                    ELSE
                        LEAST(0.2, height_m / 100.0)  -- Baseline based on tree size
                END,
                computed_risk_level = CASE
                    WHEN real_distance_to_line_m <= (height_m + canopy_radius_m) THEN 'critical'
                    WHEN real_distance_to_line_m <= (height_m + canopy_radius_m) * 1.5 THEN 'warning'
                    WHEN real_nearest_asset_distance_m <= (height_m + canopy_radius_m) THEN 'monitor'
                    ELSE 'safe'
                END,
                risk_factors = CASE
                    WHEN real_distance_to_line_m <= (height_m + canopy_radius_m) THEN
                        'Power line at ' || ROUND(real_distance_to_line_m::numeric, 1) || 'm within ' || 
                        ROUND((height_m + canopy_radius_m)::numeric, 1) || 'm fall zone'
                    WHEN real_distance_to_line_m <= (height_m + canopy_radius_m) * 1.5 THEN
                        'Power line at ' || ROUND(real_distance_to_line_m::numeric, 1) || 'm near fall zone'
                    WHEN real_nearest_asset_distance_m <= (height_m + canopy_radius_m) THEN
                        real_nearest_asset_type || ' at ' || ROUND(real_nearest_asset_distance_m::numeric, 1) || 'm within fall zone'
                    ELSE
                        'No infrastructure within ' || ROUND((height_m + canopy_radius_m)::numeric, 1) || 'm fall zone'
                END,
                last_risk_computation = NOW()
            WHERE height_m IS NOT NULL AND canopy_radius_m IS NOT NULL
        """)
        elapsed = time.time() - start
        print(f"   Risk scores computed in {elapsed:.1f}s")
        
        # Step 6: Copy computed values to the main columns (replace synthetic data)
        print("\n[6/6] Replacing synthetic data with REAL computed values...")
        await conn.execute("""
            UPDATE vegetation_risk
            SET 
                distance_to_line_m = real_distance_to_line_m,
                nearest_line_id = real_nearest_line_id,
                risk_score = computed_risk_score,
                risk_level = computed_risk_level
            WHERE computed_risk_score IS NOT NULL
        """)
        
        # Final stats
        print("\n" + "=" * 70)
        print("RECOMPUTATION COMPLETE")
        print("=" * 70)
        
        new_stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_trees,
                COUNT(CASE WHEN computed_risk_level = 'critical' THEN 1 END) as critical,
                COUNT(CASE WHEN computed_risk_level = 'warning' THEN 1 END) as warning,
                COUNT(CASE WHEN computed_risk_level = 'monitor' THEN 1 END) as monitor,
                COUNT(CASE WHEN computed_risk_level = 'safe' THEN 1 END) as safe,
                AVG(computed_risk_score) as avg_risk,
                AVG(real_distance_to_line_m) as avg_distance_to_line,
                MIN(real_distance_to_line_m) as min_distance_to_line,
                COUNT(CASE WHEN real_distance_to_line_m < 50 THEN 1 END) as trees_within_50m_of_line
            FROM vegetation_risk
            WHERE computed_risk_score IS NOT NULL
        """)
        
        print(f"\nRisk Distribution (based on REAL spatial analysis):")
        print(f"   Critical: {new_stats['critical']:,} trees")
        print(f"   Warning:  {new_stats['warning']:,} trees")
        print(f"   Monitor:  {new_stats['monitor']:,} trees")
        print(f"   Safe:     {new_stats['safe']:,} trees")
        print(f"\nProximity Stats:")
        print(f"   Avg distance to nearest power line: {new_stats['avg_distance_to_line']:.1f}m")
        print(f"   Min distance to power line: {new_stats['min_distance_to_line']:.1f}m")
        print(f"   Trees within 50m of power line: {new_stats['trees_within_50m_of_line']:,}")
        print(f"\n   New avg risk score: {new_stats['avg_risk']:.3f} (was {stats['avg_risk']:.3f})")
        
        # Show a sample of high-risk trees
        print("\nSample of highest-risk trees (REAL data):")
        samples = await conn.fetch("""
            SELECT 
                tree_id, 
                ROUND(height_m::numeric, 1) as height,
                ROUND(real_distance_to_line_m::numeric, 1) as dist_to_line,
                ROUND(computed_risk_score::numeric, 2) as risk,
                computed_risk_level as level,
                risk_factors
            FROM vegetation_risk
            WHERE computed_risk_score IS NOT NULL
            ORDER BY computed_risk_score DESC
            LIMIT 5
        """)
        for s in samples:
            print(f"   {s['tree_id'][:20]}... | {s['height']}m tall | {s['dist_to_line']}m to line | {s['risk']} ({s['level']})")
            print(f"      -> {s['risk_factors']}")
        
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(recompute_vegetation_risk())
