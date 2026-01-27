#!/usr/bin/env python3
"""
ARCHITECTURE: Setup Vegetation Risk Materialized View

This script creates a materialized view that:
1. Pre-computes risk using PostGIS spatial joins
2. Auto-refreshes via triggers when source data changes
3. Serves as the SINGLE SOURCE OF TRUTH for vegetation risk

Run once to set up, then the MV maintains itself.
"""

import psycopg2
import os
import sys

# Database connection
POSTGRES_HOST = "<your_postgres_host>"
POSTGRES_PORT = 5432
POSTGRES_DB = "postgres"
POSTGRES_USER = "application"
POSTGRES_PASSWORD = "<REDACTED_PASSWORD>"

def setup_vegetation_risk_mv():
    print("=" * 70)
    print("ARCHITECTURE: Setting up Vegetation Risk Materialized View")
    print("=" * 70)
    
    conn = psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )
    conn.autocommit = True
    cur = conn.cursor()
    
    try:
        # Step 1: Check source tables exist
        print("\n[1/6] Checking source tables...")
        cur.execute("""
            SELECT 
                (SELECT COUNT(*) FROM vegetation_risk) as veg_count,
                (SELECT COUNT(*) FROM power_lines_spatial) as lines_count,
                (SELECT COUNT(*) FROM grid_assets_cache) as assets_count
        """)
        counts = cur.fetchone()
        print(f"   vegetation_risk: {counts[0]:,} rows")
        print(f"   power_lines_spatial: {counts[1]:,} rows")
        print(f"   grid_assets_cache: {counts[2]:,} rows")
        
        if counts[1] == 0:
            print("\n   ERROR: No power lines in database. Cannot compute risk.")
            return
        
        # Step 2: Drop existing MV
        print("\n[2/6] Dropping existing materialized view if exists...")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS vegetation_risk_computed CASCADE")
        print("   Done.")
        
        # Step 3: Create the materialized view
        print("\n[3/6] Creating materialized view with PostGIS spatial joins...")
        print("   This computes REAL distance to nearest power line for all trees...")
        
        create_mv_sql = """
        CREATE MATERIALIZED VIEW vegetation_risk_computed AS
        WITH 
        nearest_power_line AS (
            SELECT DISTINCT ON (v.tree_id)
                v.tree_id,
                p.power_line_id,
                p.class as line_class,
                ST_Distance(v.geom::geography, p.geom::geography) as distance_to_line_m
            FROM vegetation_risk v
            CROSS JOIN LATERAL (
                SELECT power_line_id, class, geom
                FROM power_lines_spatial
                ORDER BY v.geom <-> geom
                LIMIT 1
            ) p
        ),
        nearest_asset AS (
            SELECT DISTINCT ON (v.tree_id)
                v.tree_id,
                a.asset_id,
                a.asset_type,
                ST_Distance(v.geom::geography, a.geom::geography) as distance_to_asset_m
            FROM vegetation_risk v
            CROSS JOIN LATERAL (
                SELECT asset_id, asset_type, geom
                FROM grid_assets_cache
                WHERE geom IS NOT NULL
                ORDER BY v.geom <-> geom
                LIMIT 1
            ) a
        )
        SELECT 
            v.tree_id,
            v.class as species,
            v.subtype,
            v.height_m,
            v.canopy_radius_m,
            v.latitude,
            v.longitude,
            v.geom,
            (v.height_m + v.canopy_radius_m) as fall_zone_m,
            pl.power_line_id as nearest_line_id,
            pl.line_class as nearest_line_class,
            pl.distance_to_line_m,
            a.asset_id as nearest_asset_id,
            a.asset_type as nearest_asset_type,
            a.distance_to_asset_m,
            CASE
                WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) THEN
                    LEAST(1.0, 0.85 + (1 - pl.distance_to_line_m / NULLIF(v.height_m + v.canopy_radius_m, 0)) * 0.15)
                WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) * 1.5 THEN
                    0.5 + (1 - pl.distance_to_line_m / NULLIF((v.height_m + v.canopy_radius_m) * 1.5, 0)) * 0.3
                WHEN a.distance_to_asset_m <= (v.height_m + v.canopy_radius_m) THEN
                    CASE 
                        WHEN a.asset_type IN ('substation', 'transformer') THEN
                            0.5 + (1 - a.distance_to_asset_m / NULLIF(v.height_m + v.canopy_radius_m, 0)) * 0.35
                        ELSE
                            0.4 + (1 - a.distance_to_asset_m / NULLIF(v.height_m + v.canopy_radius_m, 0)) * 0.25
                    END
                ELSE
                    LEAST(0.2, v.height_m / 100.0)
            END as risk_score,
            CASE
                WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) THEN 'critical'
                WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) * 1.5 THEN 'warning'
                WHEN a.distance_to_asset_m <= (v.height_m + v.canopy_radius_m) THEN 'monitor'
                ELSE 'safe'
            END as risk_level,
            CASE
                WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) THEN
                    'Power line at ' || ROUND(pl.distance_to_line_m::numeric, 1) || 'm within ' || 
                    ROUND((v.height_m + v.canopy_radius_m)::numeric, 1) || 'm fall zone'
                WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) * 1.5 THEN
                    'Power line at ' || ROUND(pl.distance_to_line_m::numeric, 1) || 'm approaching fall zone'
                WHEN a.distance_to_asset_m <= (v.height_m + v.canopy_radius_m) THEN
                    a.asset_type || ' at ' || ROUND(a.distance_to_asset_m::numeric, 1) || 'm within fall zone'
                ELSE
                    'No infrastructure within ' || ROUND((v.height_m + v.canopy_radius_m)::numeric, 1) || 'm fall zone'
            END as risk_explanation,
            NOW() as computed_at
        FROM vegetation_risk v
        LEFT JOIN nearest_power_line pl ON v.tree_id = pl.tree_id
        LEFT JOIN nearest_asset a ON v.tree_id = a.tree_id
        WHERE v.height_m IS NOT NULL AND v.canopy_radius_m IS NOT NULL
        """
        cur.execute(create_mv_sql)
        print("   Materialized view created.")
        
        # Step 4: Create indexes
        print("\n[4/6] Creating indexes for fast queries...")
        cur.execute("CREATE INDEX idx_veg_risk_mv_risk_score ON vegetation_risk_computed(risk_score DESC)")
        cur.execute("CREATE INDEX idx_veg_risk_mv_risk_level ON vegetation_risk_computed(risk_level)")
        cur.execute("CREATE INDEX idx_veg_risk_mv_geom ON vegetation_risk_computed USING GIST(geom)")
        cur.execute("CREATE UNIQUE INDEX idx_veg_risk_mv_tree_id ON vegetation_risk_computed(tree_id)")
        print("   Indexes created.")
        
        # Step 5: Create refresh function and triggers
        print("\n[5/6] Setting up auto-refresh triggers...")
        
        # Create refresh function
        cur.execute("""
            CREATE OR REPLACE FUNCTION refresh_vegetation_risk_mv()
            RETURNS TRIGGER AS $$
            BEGIN
                REFRESH MATERIALIZED VIEW CONCURRENTLY vegetation_risk_computed;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql
        """)
        
        # Create triggers (drop first if exist)
        cur.execute("DROP TRIGGER IF EXISTS trg_refresh_veg_risk_on_vegetation ON vegetation_risk")
        cur.execute("""
            CREATE TRIGGER trg_refresh_veg_risk_on_vegetation
            AFTER INSERT OR UPDATE OR DELETE ON vegetation_risk
            FOR EACH STATEMENT
            EXECUTE FUNCTION refresh_vegetation_risk_mv()
        """)
        
        cur.execute("DROP TRIGGER IF EXISTS trg_refresh_veg_risk_on_power_lines ON power_lines_spatial")
        cur.execute("""
            CREATE TRIGGER trg_refresh_veg_risk_on_power_lines
            AFTER INSERT OR UPDATE OR DELETE ON power_lines_spatial
            FOR EACH STATEMENT
            EXECUTE FUNCTION refresh_vegetation_risk_mv()
        """)
        print("   Triggers created - MV will auto-refresh when data changes.")
        
        # Step 6: Verify and report
        print("\n[6/6] Verifying computed risk distribution...")
        cur.execute("""
            SELECT 
                risk_level,
                COUNT(*) as tree_count,
                ROUND(AVG(risk_score)::numeric, 3) as avg_risk,
                ROUND(AVG(distance_to_line_m)::numeric, 1) as avg_dist_to_line,
                ROUND(MIN(distance_to_line_m)::numeric, 1) as min_dist_to_line
            FROM vegetation_risk_computed
            GROUP BY risk_level
            ORDER BY avg_risk DESC
        """)
        
        print("\n" + "=" * 70)
        print("RISK DISTRIBUTION (computed from REAL spatial data)")
        print("=" * 70)
        print(f"{'Level':<12} {'Count':>10} {'Avg Risk':>10} {'Avg Dist':>12} {'Min Dist':>10}")
        print("-" * 54)
        
        total = 0
        for row in cur.fetchall():
            level, count, avg_risk, avg_dist, min_dist = row
            print(f"{level:<12} {count:>10,} {avg_risk:>10.3f} {avg_dist:>10.1f}m {min_dist:>8.1f}m")
            total += count
        
        print("-" * 54)
        print(f"{'TOTAL':<12} {total:>10,}")
        
        # Show sample critical trees
        print("\n" + "=" * 70)
        print("SAMPLE CRITICAL TREES (highest risk)")
        print("=" * 70)
        cur.execute("""
            SELECT 
                tree_id,
                ROUND(height_m::numeric, 1) as height,
                ROUND(fall_zone_m::numeric, 1) as fall_zone,
                ROUND(distance_to_line_m::numeric, 1) as dist_to_line,
                nearest_line_class,
                ROUND(risk_score::numeric, 2) as risk,
                risk_explanation
            FROM vegetation_risk_computed
            WHERE risk_level = 'critical'
            ORDER BY risk_score DESC
            LIMIT 5
        """)
        
        for row in cur.fetchall():
            tree_id, height, fall_zone, dist, line_class, risk, explanation = row
            print(f"\n{tree_id[:30]}...")
            print(f"   Height: {height}m | Fall zone: {fall_zone}m | Distance to line: {dist}m")
            print(f"   Line class: {line_class} | Risk: {risk} | {explanation}")
        
        print("\n" + "=" * 70)
        print("SUCCESS: Materialized view is ready")
        print("=" * 70)
        print("\nThe API should now query from vegetation_risk_computed instead of vegetation_risk")
        print("Risk data will auto-update when vegetation or power line data changes.")
        
    except Exception as e:
        print(f"\nERROR: {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    setup_vegetation_risk_mv()
