# Cascade Analysis Integration Guide

## Overview

This document describes the integration of GridGuard-style GNN cascade failure analysis into the Flux Operations Center SPCS application. The integration enables:

1. **Temporal ML Prediction** - Predict afternoon transformer stress from morning state (75-85% accuracy target)
2. **GNN-based Cascade Simulation** - Model cascade failure propagation through grid topology
3. **NERC Compliance Search** - RAG-powered search for regulatory compliance documents
4. **Current Risk Visualization** - deck.gl layers for cascade visualization

## Data Architecture

### Tables Created in SI_DEMOS.ML_DEMO

| Table | Records | Description |
|-------|---------|-------------|
| `GRID_NODES` | 91,829 | Grid topology nodes (275 substations + 91,554 transformers) |
| `GRID_EDGES` | 2.5M | Connections (substation→transformer + circuit peers) |
| `T_TRANSFORMER_TEMPORAL_TRAINING` | 2.07M | Temporal ML training data (8 AM → 4 PM prediction) |
| `COMPLIANCE_DOCS` | 8 | NERC/ERCOT/CNP compliance documents |

### Cortex Services

| Service | Type | Description |
|---------|------|-------------|
| `COMPLIANCE_SEARCH` | Cortex Search | RAG search for cascade prevention regulations |

## API Endpoints

### Cascade Analysis Endpoints (FastAPI)

```
GET  /api/cascade/grid-topology       - Get grid topology for visualization
GET  /api/cascade/high-risk-nodes     - Identify potential "Patient Zero" nodes
POST /api/cascade/simulate            - Run cascade failure simulation
GET  /api/cascade/scenarios           - Get predefined scenarios (Uri, Heatwave, etc.)
GET  /api/cascade/transformer-risk-prediction - Get ML risk predictions
```

### Example: Run Cascade Simulation

```python
import requests

response = requests.post("http://localhost:3001/api/cascade/simulate", json={
    "scenario_name": "SUMMER_PEAK_2025",
    "temperature_c": 40,
    "load_multiplier": 1.4,
    "failure_threshold": 0.6
})

result = response.json()
# Returns: patient_zero, cascade_order, propagation_paths, affected_capacity_mw
```

## ML Model: Temporal Prediction

### Problem Definition
- **Input**: 8 AM transformer state (load %, temperature, historical stress)
- **Output**: Probability of high-risk at 4 PM (binary classification)
- **Why it works**: Morning state has predictive signal but isn't deterministic (unlike threshold detection)

### Feature Engineering

```sql
-- Key features from T_TRANSFORMER_TEMPORAL_TRAINING
MORNING_LOAD_PCT          -- Current load at 8 AM
MORNING_CATEGORY          -- Stress category (NORMAL, ELEVATED, HIGH, etc.)
TRANSFORMER_AGE_YEARS     -- Equipment age affects failure probability
HISTORICAL_SUMMER_AVG_LOAD -- Historical baseline for comparison
STRESS_VS_HISTORICAL      -- Deviation from normal operations
KWH_PER_METER            -- Energy intensity per customer
LOAD_TREND_RATIO         -- Current vs historical ratio
```

### Expected Performance
- **Target Accuracy**: 75-85% (realistic for temporal prediction)
- **Positive Class Rate**: 6.73% (imbalanced, use PR-AUC as metric)
- **Key Insight**: 48.6% of high-risk-at-8AM stay high-risk, 4.4% of borderline become high-risk

## Cascade Simulation Algorithm

### BFS-based Propagation

```
1. Identify Patient Zero (highest criticality node)
2. BFS from failed node through GRID_EDGES
3. For each downstream node:
   - Calculate failure_probability = criticality × load_multiplier × temperature_factor
   - If probability > threshold: mark as failed, add to cascade_order
4. Continue until no more failures or max waves reached
5. Calculate impact: affected_capacity_mw, customers_affected
```

### Predefined Scenarios

| Scenario | Temp (°C) | Load Mult. | Threshold | Reference |
|----------|-----------|------------|-----------|-----------|
| Summer Peak 2025 | 40 | 1.4 | 0.6 | July 2023 heatwave |
| Winter Storm Uri | -10 | 1.6 | 0.5 | Feb 2021, 4.5M affected |
| Hurricane Season | 30 | 1.2 | 0.55 | Hurricane Harvey patterns |
| Normal Operations | 25 | 1.0 | 0.8 | Baseline |

## Frontend Integration (Pending)

### Cascade Visualization Layer (deck.gl)

```typescript
// Types defined in src/types/index.ts
interface CascadeNode {
  node_id: string;
  node_type: 'SUBSTATION' | 'TRANSFORMER';
  lat: number;
  lon: number;
  failure_order?: number;
  cascade_risk?: number;
}

interface CascadePropagationPath {
  from_node: string;
  to_node: string;
  order: number;
  distance_km: number;
}
```

### Planned Layers
- `PatientZeroLayer` - Red pulsing marker for initial failure
- `CascadeWaveLayer` - Orange gradient for cascade propagation waves
- `PropagationPathLayer` - Animated arcs showing failure spread

## Compliance Search (Cortex Agent)

### Search Query Example

```sql
SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
    'SI_DEMOS.ML_DEMO.COMPLIANCE_SEARCH',
    '{"query": "cascade prevention requirements", "columns": ["DOC_ID", "TITLE", "CATEGORY"], "limit": 3}'
);
```

### Documents Indexed
- NERC-TPL-001-5.1: Transmission System Planning
- NERC-FAC-001-3: Facility Interconnection Requirements
- NERC-TOP-001-5: Transmission Operations
- NERC-EOP-011-3: Emergency Operations
- NERC-PRC-006-5: Automatic Underfrequency Load Shedding
- NERC-PRC-023-6: Transmission Relay Loadability
- ERCOT-OP-01: Grid Operations for Extreme Weather
- CNP-STD-001: Transformer Loading Standards

## Next Steps

1. **Update ML Notebook** - Train XGBoost model with temporal features
2. **Add deck.gl Layers** - Cascade visualization in frontend
3. **Enhance Cortex Agent** - Add cascade_simulator and compliance_search tools
4. **Build Scenario UI** - What-if simulator component

## Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │         Flux Operations Center          │
                    │              (deck.gl Map)              │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │        FastAPI Backend          │
                    │   /api/cascade/*  endpoints     │
                    └────────────────┬────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
┌────────┴────────┐       ┌──────────┴──────────┐     ┌──────────┴──────────┐
│   GRID_NODES    │       │    GRID_EDGES       │     │  COMPLIANCE_SEARCH  │
│  (91K nodes)    │       │   (2.5M edges)      │     │  (Cortex Search)    │
└─────────────────┘       └─────────────────────┘     └─────────────────────┘
         │                           │                           │
         └───────────────────────────┴───────────────────────────┘
                                     │
                          ┌──────────┴──────────┐
                          │  ML_DATA_SCIENCE    │
                          │   _POOL (GPU)       │
                          │   GNN Inference     │
                          └─────────────────────┘
```

## Engineering Value

This integration demonstrates Snowflake's ability to:

1. **Compete with GE/OSIsoft** - Real-time grid analytics with Cortex AI
2. **Reference Winter Storm Uri** - Concrete use case utility executives understand
3. **Multi-modal AI** - Cortex Analyst (SQL) + Cortex Search (RAG) + ML (prediction)
4. **SPCS GPU Compute** - GNN model training and inference at scale
5. **End-to-end Platform** - Data → ML → App in single environment
