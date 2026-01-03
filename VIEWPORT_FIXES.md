# Viewport Filtering Fixes - January 3, 2026

## Issues Addressed

### 1. 65,770 Assets Loading (Should be 30K Max)
**Root Cause**: Progressive loading appended assets without enforcing hard caps. Multiple parallel batches could complete after limits were hit, causing overshoot.

**Fix Applied**:
- Added **hard caps during asset append** in batch completion (lines 1311-1352)
- Caps enforce zoom-based limits: 30K (zoom < 11), 60K (zoom < 12), 120K (zoom >= 13)
- Batches that would exceed limits are **rejected** with warning logs
- Asset slicing: `uniqueNew.slice(0, spaceAvailable)` ensures no overshoot

### 2. Topology Not Unloading When Zooming Out
**Root Cause**: Two issues:
1. Topology culling only triggered when assets were culled (not independent)
2. No periodic cleanup of topology outside viewport
3. Culling logic didn't check viewport bounds for topology endpoints

**Fixes Applied**:

#### A. Enhanced Topology Culling with Viewport Check (lines 1203-1250)
```typescript
// CRITICAL: Also cull topology connections for culled assets AND viewport
const remainingAssetIds = new Set(culledAssets.map(a => a.id));
const topologyBeforeCull = topology.length;

setTopology(prev => {
  const filtered = prev.filter(t => {
    // Must have both endpoints still loaded
    if (!remainingAssetIds.has(t.from_asset_id) || !remainingAssetIds.has(t.to_asset_id)) {
      return false;
    }
    // AND at least one endpoint must be in viewport cull bounds
    const fromInBounds = t.from_longitude >= cullMinLng && t.from_longitude <= cullMaxLng &&
                       t.from_latitude >= cullMinLat && t.from_latitude <= cullMaxLat;
    const toInBounds = t.to_longitude >= cullMinLng && t.to_longitude <= cullMaxLng &&
                     t.to_latitude >= cullMinLat && t.to_latitude <= cullMaxLat;
    return fromInBounds || toInBounds;
  });
  
  if (filtered.length < topologyBeforeCull) {
    console.log(`   🗑️ Culled ${(topologyBeforeCull - filtered.length).toLocaleString()} topology connections`);
  }
  
  return filtered;
});
```

#### B. Periodic Topology Cleanup (lines 1253-1280)
- **Triggers**: When `topology.length > 1000` (very aggressive)
- **Action**: Removes topology connections where neither endpoint is within `cullBuffer` (2.5x) of viewport
- **Independent**: Runs even when assets aren't being culled
- **Log**: Shows cleanup stats for debugging

```typescript
// PERIODIC TOPOLOGY CLEANUP: Aggressively remove topology outside viewport
if (topology.length > 1000) {
  setTopology(prev => {
    const cleaned = prev.filter(t => {
      const fromInBounds = t.from_longitude >= cleanupMinLng && t.from_longitude <= cleanupMaxLng &&
                         t.from_latitude >= cleanupMinLat && t.from_latitude <= cleanupMaxLat;
      const toInBounds = t.to_longitude >= cleanupMinLng && t.to_longitude <= cleanupMaxLng &&
                       t.to_latitude >= cleanupMinLat && t.to_latitude <= cleanupMaxLat;
      return fromInBounds || toInBounds;
    });
    
    if (cleaned.length < topologyBeforeCleanup) {
      console.log(`   🧹 Periodic topology cleanup: ${removed} removed`);
    }
    
    return cleaned;
  });
}
```

### 3. Topology Hard Cap
**Fix Applied** (lines 1354-1370):
- **Max topology connections**: 50,000 (prevents memory bloat)
- Batches exceeding this limit are **rejected** during append
- Similar pattern to asset hard cap

```typescript
// HARD CAP: Max 50K topology connections
const maxTopologyAllowed = 50000;
const spaceAvailable = Math.max(0, maxTopologyAllowed - prev.length);

if (spaceAvailable === 0) {
  console.log(`   ⚠️ Batch ${batchIdx + 1} topology REJECTED: Cap reached`);
  return prev;
}

const topologyToAdd = uniqueNew.slice(0, spaceAvailable);
return [...prev, ...topologyToAdd];
```

## Expected Behavior After Fixes

### Asset Loading
- **Zoom < 11**: Max 30,000 assets total
- **Zoom < 12**: Max 60,000 assets total  
- **Zoom < 13**: Max 120,000 assets total
- **Batches**: Rejected if would exceed limit (with warning log)

### Topology Loading
- **Max**: 50,000 connections total
- **Culling**: Triggered at 500+ assets (was 1000)
- **Periodic Cleanup**: Triggered at 1000+ topology connections
- **Cull Buffer**: 2.5x viewport (was 3.5x)

### Viewport Behavior
- **Load Buffer**: 1.2x viewport (loads just around visible area)
- **Cull Buffer**: 2.5x viewport (culls sooner to prevent bloat)
- **Ensures**: No thrashing (cull buffer > load buffer)

## Logging Changes

New console logs to monitor:

1. **Asset Cap Enforcement**:
   ```
   ⚠️ Batch 2/3 REJECTED: Asset cap reached (30,125/30,000)
   ✅ Batch 1/3 added 4,500/5,000 assets + 8,000 connections
   ```

2. **Topology Cap Enforcement**:
   ```
   ⚠️ Batch 3/3 topology REJECTED: Cap reached (50,200/50,000)
   ```

3. **Periodic Topology Cleanup**:
   ```
   🧹 Periodic topology cleanup: 12,450 removed (25,000 → 12,550)
   ```

4. **Enhanced Culling**:
   ```
   🗑️ Culled 15,000 topology connections (35,000 → 20,000)
   ```

## Testing Recommendations

1. **Zoom out from Houston center**:
   - Should see periodic cleanup logs
   - Topology should drop from 65K+ to <10K
   - Assets should drop to match zoom limits

2. **Pan across city**:
   - Should see asset batches rejected when cap hit
   - Should NOT exceed zoom-based asset limits
   - Console should show "Asset cap reached" warnings

3. **Select substation → Zoom out**:
   - Topology should cull even with selection active
   - Should see cleanup logs

4. **Monitor console**:
   - Look for rejection warnings (⚠️)
   - Look for cleanup stats (🧹)
   - Verify asset counts match limits

## Files Modified

- `/Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs/src/App.tsx`:
  - Lines 1203-1250: Enhanced asset/topology culling with viewport bounds
  - Lines 1253-1280: Added periodic topology cleanup
  - Lines 1311-1352: Added hard cap enforcement during asset append
  - Lines 1354-1370: Added hard cap enforcement during topology append

## Next Steps if Issues Persist

If topology still doesn't unload:

1. Check console for cleanup logs - are they triggering?
2. Verify `throttledViewport` is updating when panning/zooming
3. Check if `cullBuffer` calculation is correct
4. May need to reduce topology cleanup threshold from 1000 to 500

If assets still exceed limits:

1. Check console for rejection warnings
2. Verify `throttledZoom` matches actual zoom level
3. Check if multiple `useEffect` calls are bypassing limits
4. May need to add global ref to track total asset count across all state updates
