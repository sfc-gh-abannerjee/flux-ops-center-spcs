# ML Inference Enhancement Analysis

**Date**: 2026-02-06  
**Status**: Analysis Complete - Implementation Plan Ready

---

## Executive Summary

This document analyzes opportunities to enhance the Flux Ops Center cascade analysis using Snowflake's latest ML capabilities and identifies the gap in end-to-end inference coverage.

### Current State Issues

| Issue | Impact | Priority |
|-------|--------|----------|
| **Poles not in cascade graph** | 62,038 poles missing from ML inference | HIGH |
| **Meters not in cascade graph** | 596,906 meters missing from ML inference | HIGH |
| **Batch inference only** | ~500ms latency for risk queries | MEDIUM |
| **No online feature serving** | Features recomputed per request | MEDIUM |

### Recommended Enhancements

1. **Online Feature Store** for real-time centrality features (30ms latency)
2. **Model Serving REST API** for low-latency GNN predictions
3. **Extended Graph Topology** to include Poles and Meters

---

## Part 1: Current ML Pipeline Gaps

### Hierarchy Coverage Analysis

```
CURRENT IMPLEMENTATION:
Substation (275) → Transformer (91,554) → [STOPS HERE]

REQUIRED END-TO-END:
Substation (275) → Transformer (91,554) → Pole (62,038) → Meter (596,906)
```

### Data Linkage Status

| Entity | Count | Linked to Parent | In ML Pipeline |
|--------|-------|------------------|----------------|
| Substations | 275 | N/A | ✅ Yes |
| Transformers | 91,554 | 100% to substations | ✅ Yes |
| Poles | 62,038 | 100% to transformers | ❌ No |
| Meters | 596,906 | 100% to transformers, 66% to poles | ❌ No |

### Missing ML Tables

The following need to be created:

1. `CASCADE_ANALYSIS.POLE_CENTRALITY_FEATURES` - Graph centrality for poles
2. `CASCADE_ANALYSIS.METER_CENTRALITY_FEATURES` - Graph centrality for meters  
3. `CASCADE_ANALYSIS.POLE_GNN_PREDICTIONS` - GNN risk scores for poles
4. `CASCADE_ANALYSIS.METER_GNN_PREDICTIONS` - GNN risk scores for meters
5. Extended `GRID_NODES` to include poles and meters
6. Extended `GRID_EDGES` with pole-to-transformer and meter-to-pole edges

---

## Part 2: Snowflake ML Enhancement Opportunities

### 2.1 Online Feature Store (Recommended: HIGH)

**Current Pain**: Centrality features computed at query time from batch tables.

**Snowflake Solution**: Online Feature Store with 30ms point lookups.

```python
# Example: Create online-enabled feature view for cascade risk
from snowflake.ml.feature_store import FeatureView, OnlineConfig

online_config = OnlineConfig(
    enable=True,
    target_lag="30 seconds"  # Near real-time sync
)

cascade_risk_fv = FeatureView(
    name="CASCADE_RISK_FEATURES",
    entities=[grid_node_entity],
    feature_df=centrality_features_df,
    timestamp_col="COMPUTED_AT",
    refresh_freq="5 minutes",
    refresh_mode="INCREMENTAL",  # Only sync changed rows
    online_config=online_config
)
```

**Benefits**:
- 30ms feature retrieval (vs 500ms current)
- Automatic sync from offline tables
- Incremental refresh for cost efficiency
- Native integration with Model Registry

**Use Cases**:
- Real-time risk dashboard updates
- Interactive cascade simulation
- Alert thresholds based on live grid state

### 2.2 Model Serving REST API (Recommended: HIGH)

**Current Pain**: GNN predictions pre-computed in batch, stale until next run.

**Snowflake Solution**: Deploy GNN model to SPCS with REST endpoint.

```python
from snowflake.ml.registry import Registry

reg = Registry(session, database_name="FLUX_DB", schema_name="CASCADE_ANALYSIS")

# Get trained GNN model
gnn_model = reg.get_model("CASCADE_GNN_MODEL").version("v2")

# Deploy to SPCS with REST endpoint
gnn_model.create_service(
    service_name="CASCADE_GNN_INFERENCE",
    service_compute_pool="FLUX_INTERACTIVE_POOL",  # Existing pool
    ingress_enabled=True,  # HTTP endpoint
    gpu_requests=None,  # CPU is sufficient for inference
    max_instances=3,  # Autoscale
    min_instances=1
)
```

**REST API Usage**:
```bash
# Real-time GNN prediction for any node
curl -X POST "https://cascade-gnn-inference-<account>.snowflakecomputing.app/predict" \
  -H "Authorization: Snowflake Token=..." \
  -d '{"NODE_ID": "POLE-800K-0013570", "FEATURES": {...}}'
```

**Benefits**:
- Sub-100ms inference latency
- Autoscaling for demand spikes
- No batch job dependencies
- Direct integration with frontend

### 2.3 Continuous Inference with Dynamic Tables (Recommended: MEDIUM)

**Current Pain**: Predictions require manual batch job triggers.

**Snowflake Solution**: Dynamic tables for continuous streaming inference.

```sql
-- Auto-refresh predictions every 20 minutes
CREATE OR REPLACE DYNAMIC TABLE CASCADE_GNN_PREDICTIONS_LIVE
WAREHOUSE = FLUX_WH
TARGET_LAG = '20 minutes'
REFRESH_MODE = INCREMENTAL
AS
WITH gnn_model AS MODEL FLUX_DB.CASCADE_ANALYSIS.CASCADE_GNN_MODEL
SELECT 
    n.NODE_ID,
    n.NODE_TYPE,
    n.CRITICALITY_SCORE,
    gnn_model!predict(n.FEATURES) AS GNN_CASCADE_RISK,
    CURRENT_TIMESTAMP() AS PREDICTION_TIMESTAMP
FROM FLUX_DB.ML_DEMO.GRID_NODES_EXTENDED n
WHERE n.UPDATED_AT > DATEADD('hour', -1, CURRENT_TIMESTAMP());
```

**Benefits**:
- Continuous prediction updates
- Only processes new/changed data
- No orchestration needed
- SQL-native integration

---

## Part 3: End-to-End Implementation Plan

### Phase 1: Extend Graph Topology (Week 1)

#### 1.1 Add Poles to GRID_NODES

```sql
-- Add poles to the unified node table
INSERT INTO FLUX_DB.ML_DEMO.GRID_NODES (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON, 
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS, PARENT_NODE_ID
)
SELECT 
    POLE_ID,
    POLE_ID,  -- Use ID as name
    'POLE',
    LATITUDE,
    LONGITUDE,
    5,  -- ~5kW capacity per pole
    12.47,  -- Distribution voltage
    HEALTH_SCORE / 100.0,  -- Normalize to 0-1
    0,  -- Poles don't have downstream transformers
    TRANSFORMER_ID  -- Parent link
FROM FLUX_DB.PRODUCTION.GRID_POLES_INFRASTRUCTURE
WHERE TRANSFORMER_ID IS NOT NULL;
```

#### 1.2 Add Meters to GRID_NODES

```sql
-- Add meters to the unified node table
INSERT INTO FLUX_DB.ML_DEMO.GRID_NODES (
    NODE_ID, NODE_NAME, NODE_TYPE, LAT, LON,
    CAPACITY_KW, VOLTAGE_KV, CRITICALITY_SCORE,
    DOWNSTREAM_TRANSFORMERS, PARENT_NODE_ID
)
SELECT 
    METER_ID,
    METER_ID,
    'METER',
    METER_LATITUDE,
    METER_LONGITUDE,
    0.5,  -- ~500W per meter
    0.120,  -- 120V service
    HEALTH_SCORE / 100.0,
    0,
    COALESCE(POLE_ID, TRANSFORMER_ID)  -- Link to pole or transformer
FROM FLUX_DB.PRODUCTION.METER_INFRASTRUCTURE
WHERE TRANSFORMER_ID IS NOT NULL;
```

#### 1.3 Add Edges for Poles and Meters

```sql
-- Add pole-to-transformer edges
INSERT INTO FLUX_DB.ML_DEMO.GRID_EDGES (
    FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM
)
SELECT 
    p.POLE_ID,
    p.TRANSFORMER_ID,
    'POLE_CONNECTION',
    0.1  -- Typical pole-to-transformer distance
FROM FLUX_DB.PRODUCTION.GRID_POLES_INFRASTRUCTURE p
WHERE p.TRANSFORMER_ID IS NOT NULL;

-- Add meter-to-pole edges
INSERT INTO FLUX_DB.ML_DEMO.GRID_EDGES (
    FROM_NODE_ID, TO_NODE_ID, EDGE_TYPE, DISTANCE_KM
)
SELECT 
    m.METER_ID,
    m.POLE_ID,
    'METER_CONNECTION',
    0.05  -- Typical meter-to-pole distance
FROM FLUX_DB.PRODUCTION.METER_INFRASTRUCTURE m
WHERE m.POLE_ID IS NOT NULL AND m.POLE_ID != '';
```

### Phase 2: Compute Centrality Features (Week 2)

```python
# Extended centrality computation script
# backend/scripts/compute_extended_centrality.py

import networkx as nx
from snowflake.snowpark import Session

def compute_full_hierarchy_centrality():
    """Compute centrality for ALL node types: SUB, XFMR, POLE, METER"""
    
    session = Session.builder.config("connection_name", "cpe_demo_CLI").create()
    
    # Load full topology
    nodes_df = session.sql("""
        SELECT NODE_ID, NODE_TYPE, PARENT_NODE_ID 
        FROM FLUX_DB.ML_DEMO.GRID_NODES_EXTENDED
    """).to_pandas()
    
    edges_df = session.sql("""
        SELECT FROM_NODE_ID, TO_NODE_ID, DISTANCE_KM
        FROM FLUX_DB.ML_DEMO.GRID_EDGES_EXTENDED
    """).to_pandas()
    
    # Build NetworkX graph
    G = nx.Graph()
    for _, row in nodes_df.iterrows():
        G.add_node(row['NODE_ID'], node_type=row['NODE_TYPE'])
    for _, row in edges_df.iterrows():
        G.add_edge(row['FROM_NODE_ID'], row['TO_NODE_ID'], 
                   weight=row['DISTANCE_KM'])
    
    # Compute centrality (memory-efficient batching for 750K nodes)
    # Use approximate algorithms for scale
    betweenness = nx.betweenness_centrality(G, k=min(1000, len(G)))
    pagerank = nx.pagerank(G, alpha=0.85)
    degree = nx.degree_centrality(G)
    
    # Store results
    # ... (insert to NODE_CENTRALITY_FEATURES_EXTENDED)
```

### Phase 3: Deploy Online Features (Week 3)

```python
from snowflake.ml.feature_store import FeatureStore, Entity, FeatureView
from snowflake.ml.feature_store.feature_view import OnlineConfig

# Initialize Feature Store
fs = FeatureStore(
    session=session,
    database="FLUX_DB",
    name="CASCADE_FEATURES",
    default_warehouse="FLUX_WH"
)

# Create entity for grid nodes
grid_node_entity = Entity(
    name="GRID_NODE",
    join_keys=["NODE_ID"],
    desc="Any grid infrastructure node"
)
fs.register_entity(grid_node_entity)

# Create online-enabled feature view
cascade_features_df = session.table("CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED")

online_config = OnlineConfig(
    enable=True,
    target_lag="30 seconds"
)

cascade_fv = FeatureView(
    name="CASCADE_RISK_FV",
    entities=[grid_node_entity],
    feature_df=cascade_features_df,
    timestamp_col="COMPUTED_AT",
    refresh_freq="5 minutes",
    online_config=online_config
)

fs.register_feature_view(
    feature_view=cascade_fv,
    version="v1"
)
```

### Phase 4: Deploy Model Serving (Week 4)

```python
from snowflake.ml.registry import Registry

reg = Registry(session, "FLUX_DB", "CASCADE_ANALYSIS")

# Log extended GNN model
mv = reg.log_model(
    model_name="CASCADE_GNN_EXTENDED",
    version_name="v1",
    model=trained_gnn_model,
    conda_dependencies=["pytorch", "torch-geometric"]
)

# Deploy to SPCS with REST API
mv.create_service(
    service_name="cascade_gnn_realtime",
    service_compute_pool="FLUX_INTERACTIVE_POOL",
    ingress_enabled=True,
    max_instances=3,
    min_instances=1
)

# Service will be available at:
# https://cascade-gnn-realtime-<account>.snowflakecomputing.app/predict
```

---

## Part 4: Expected Performance Improvements

| Metric | Current | With Enhancements |
|--------|---------|-------------------|
| Feature Lookup Latency | 500ms | 30ms |
| GNN Inference Latency | N/A (batch only) | <100ms |
| Data Freshness | Hours | 30 seconds |
| Node Coverage | 91,829 | 750,721 |
| Cascade Depth | 2 levels | 4 levels |

---

## Part 5: Cost Considerations

### Online Feature Store Costs
- Hybrid Table Storage: ~$0.10/GB/month
- Incremental Refresh: Minimal compute
- Point Lookups: Serverless pricing

### Model Serving Costs
- Compute Pool: GPU_NV_S or CPU_X64_M
- Autoscaling: Pay only for active instances
- Estimated: $50-200/day depending on traffic

### Recommendation
Start with Online Feature Store (lower cost, immediate benefit), then add Model Serving for real-time inference requirements.

---

## References

- [Online Feature Store Documentation](https://docs.snowflake.com/en/developer-guide/snowflake-ml/feature-store/create-and-serve-online-features-python)
- [Model Serving REST API](https://docs.snowflake.com/en/developer-guide/snowflake-ml/inference/real-time-inference-rest-api)
- [Continuous Inference with Dynamic Tables](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-registry/continuous-inference)
- [Production ML Workflows Blog](https://www.snowflake.com/en/blog/production-ml-workflows/)
