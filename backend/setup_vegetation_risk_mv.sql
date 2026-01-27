-- ============================================================================
-- ARCHITECTURE: Vegetation Risk as Materialized View
-- ============================================================================
-- This is how a real utility would handle vegetation risk:
-- 1. Risk computation lives in the DATABASE, not application code
-- 2. Materialized view pre-computes risk using PostGIS spatial joins
-- 3. Refresh on schedule (after LiDAR updates) or via trigger
-- 4. Frontend/API just SELECT from the view - no computation
-- ============================================================================

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS vegetation_risk_computed CASCADE;

-- Create the materialized view with REAL spatial risk computation
CREATE MATERIALIZED VIEW vegetation_risk_computed AS
WITH 
-- Step 1: Find nearest power line for each tree using lateral join
nearest_power_line AS (
    SELECT DISTINCT ON (v.tree_id)
        v.tree_id,
        p.power_line_id,
        p.voltage_kv,
        p.line_class,
        ST_Distance(v.geom::geography, p.geom::geography) as distance_to_line_m
    FROM vegetation_risk v
    CROSS JOIN LATERAL (
        SELECT power_line_id, voltage_kv, line_class, geom
        FROM power_lines_spatial
        ORDER BY v.geom <-> geom
        LIMIT 1
    ) p
),

-- Step 2: Find nearest grid asset for each tree
nearest_asset AS (
    SELECT DISTINCT ON (v.tree_id)
        v.tree_id,
        a.asset_id,
        a.asset_type,
        ST_Distance(
            v.geom::geography,
            ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography
        ) as distance_to_asset_m
    FROM vegetation_risk v
    CROSS JOIN LATERAL (
        SELECT asset_id, asset_type, longitude, latitude
        FROM grid_assets
        WHERE longitude IS NOT NULL AND latitude IS NOT NULL
        ORDER BY ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) <-> v.geom
        LIMIT 1
    ) a
)

-- Step 3: Compute risk scores from REAL spatial relationships
SELECT 
    v.tree_id,
    v.species,
    v.height_m,
    v.canopy_radius_m,
    v.latitude,
    v.longitude,
    v.geom,
    
    -- Fall zone = height + canopy radius (how far tree can reach if it falls)
    (v.height_m + v.canopy_radius_m) as fall_zone_m,
    
    -- REAL nearest power line data
    pl.power_line_id as nearest_line_id,
    pl.voltage_kv as nearest_line_voltage_kv,
    pl.line_class as nearest_line_class,
    pl.distance_to_line_m,
    
    -- REAL nearest asset data  
    a.asset_id as nearest_asset_id,
    a.asset_type as nearest_asset_type,
    a.distance_to_asset_m,
    
    -- Risk score based on REAL proximity
    CASE
        -- Critical: Power line within fall zone
        WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) THEN
            LEAST(1.0, 0.85 + (1 - pl.distance_to_line_m / NULLIF(v.height_m + v.canopy_radius_m, 0)) * 0.15)
        -- Warning: Power line within 1.5x fall zone
        WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) * 1.5 THEN
            0.5 + (1 - pl.distance_to_line_m / NULLIF((v.height_m + v.canopy_radius_m) * 1.5, 0)) * 0.3
        -- Moderate: Grid asset within fall zone (no nearby power line)
        WHEN a.distance_to_asset_m <= (v.height_m + v.canopy_radius_m) THEN
            CASE 
                WHEN a.asset_type IN ('substation', 'transformer') THEN
                    0.5 + (1 - a.distance_to_asset_m / NULLIF(v.height_m + v.canopy_radius_m, 0)) * 0.35
                ELSE
                    0.4 + (1 - a.distance_to_asset_m / NULLIF(v.height_m + v.canopy_radius_m, 0)) * 0.25
            END
        -- Low: Nothing in fall zone
        ELSE
            LEAST(0.2, v.height_m / 100.0)
    END as risk_score,
    
    -- Risk level categorical
    CASE
        WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) THEN 'critical'
        WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) * 1.5 THEN 'warning'
        WHEN a.distance_to_asset_m <= (v.height_m + v.canopy_radius_m) THEN 'monitor'
        ELSE 'safe'
    END as risk_level,
    
    -- Human-readable risk explanation
    CASE
        WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) THEN
            'Power line (' || COALESCE(pl.voltage_kv::text, '?') || 'kV) at ' || 
            ROUND(pl.distance_to_line_m::numeric, 1) || 'm within ' || 
            ROUND((v.height_m + v.canopy_radius_m)::numeric, 1) || 'm fall zone'
        WHEN pl.distance_to_line_m <= (v.height_m + v.canopy_radius_m) * 1.5 THEN
            'Power line at ' || ROUND(pl.distance_to_line_m::numeric, 1) || 'm approaching fall zone'
        WHEN a.distance_to_asset_m <= (v.height_m + v.canopy_radius_m) THEN
            a.asset_type || ' at ' || ROUND(a.distance_to_asset_m::numeric, 1) || 'm within fall zone'
        ELSE
            'No infrastructure within ' || ROUND((v.height_m + v.canopy_radius_m)::numeric, 1) || 'm fall zone'
    END as risk_explanation,
    
    -- Metadata
    NOW() as computed_at
    
FROM vegetation_risk v
LEFT JOIN nearest_power_line pl ON v.tree_id = pl.tree_id
LEFT JOIN nearest_asset a ON v.tree_id = a.tree_id
WHERE v.height_m IS NOT NULL 
  AND v.canopy_radius_m IS NOT NULL;

-- Create indexes for fast queries
CREATE INDEX idx_veg_risk_mv_risk_score ON vegetation_risk_computed(risk_score DESC);
CREATE INDEX idx_veg_risk_mv_risk_level ON vegetation_risk_computed(risk_level);
CREATE INDEX idx_veg_risk_mv_geom ON vegetation_risk_computed USING GIST(geom);
CREATE INDEX idx_veg_risk_mv_tree_id ON vegetation_risk_computed(tree_id);

-- Grant access
GRANT SELECT ON vegetation_risk_computed TO PUBLIC;

-- ============================================================================
-- REFRESH STRATEGY
-- ============================================================================
-- Option 1: Manual refresh after LiDAR data updates
--   REFRESH MATERIALIZED VIEW vegetation_risk_computed;
--
-- Option 2: Concurrent refresh (no lock, requires unique index)
--   CREATE UNIQUE INDEX idx_veg_risk_mv_unique ON vegetation_risk_computed(tree_id);
--   REFRESH MATERIALIZED VIEW CONCURRENTLY vegetation_risk_computed;
--
-- Option 3: Scheduled refresh via pg_cron (production)
--   SELECT cron.schedule('refresh-veg-risk', '0 2 * * *', 
--     'REFRESH MATERIALIZED VIEW CONCURRENTLY vegetation_risk_computed');
--
-- Option 4: Trigger-based refresh when source tables change
--   (See trigger setup below)
-- ============================================================================

-- Create unique index to enable CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_veg_risk_mv_unique ON vegetation_risk_computed(tree_id);

-- ============================================================================
-- TRIGGER FOR AUTO-REFRESH (Optional - for real-time updates)
-- ============================================================================
-- This function refreshes the MV when vegetation or power line data changes
-- In production, you might debounce this or use pg_cron instead

CREATE OR REPLACE FUNCTION refresh_vegetation_risk_mv()
RETURNS TRIGGER AS $$
BEGIN
    -- Use CONCURRENTLY to avoid locking reads during refresh
    REFRESH MATERIALIZED VIEW CONCURRENTLY vegetation_risk_computed;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on vegetation_risk changes (new trees, height updates, etc.)
DROP TRIGGER IF EXISTS trg_refresh_veg_risk_on_vegetation ON vegetation_risk;
CREATE TRIGGER trg_refresh_veg_risk_on_vegetation
    AFTER INSERT OR UPDATE OR DELETE ON vegetation_risk
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_vegetation_risk_mv();

-- Trigger on power_lines_spatial changes (new lines, rerouting, etc.)
DROP TRIGGER IF EXISTS trg_refresh_veg_risk_on_power_lines ON power_lines_spatial;
CREATE TRIGGER trg_refresh_veg_risk_on_power_lines
    AFTER INSERT OR UPDATE OR DELETE ON power_lines_spatial
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_vegetation_risk_mv();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Check the computed risk distribution
SELECT 
    risk_level,
    COUNT(*) as tree_count,
    ROUND(AVG(risk_score)::numeric, 3) as avg_risk,
    ROUND(AVG(distance_to_line_m)::numeric, 1) as avg_dist_to_line,
    ROUND(MIN(distance_to_line_m)::numeric, 1) as min_dist_to_line
FROM vegetation_risk_computed
GROUP BY risk_level
ORDER BY avg_risk DESC;

-- Sample high-risk trees
SELECT 
    tree_id,
    species,
    height_m,
    fall_zone_m,
    distance_to_line_m,
    nearest_line_voltage_kv,
    risk_score,
    risk_level,
    risk_explanation
FROM vegetation_risk_computed
WHERE risk_level = 'critical'
ORDER BY risk_score DESC
LIMIT 10;
