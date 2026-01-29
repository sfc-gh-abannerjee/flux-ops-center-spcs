# Cascade Analysis Guide

**Complete reference for cascade failure analysis in Flux Operations Center.**

---

## Overview

The cascade analysis system identifies high-risk grid nodes ("Patient Zeros") that could trigger cascade failures and simulates failure propagation through the network.

**Key Capabilities:**
- Graph centrality metrics (betweenness, PageRank) via NetworkX
- BFS-based cascade simulation
- GNN-based risk prediction
- Cortex Agent integration for natural language queries
- **NEW: Actionable analysis** - Economic impact, mitigation playbooks, restoration sequencing

---

## Quick Start

### API Endpoints

```bash
# Get high-risk Patient Zero candidates
curl "http://localhost:3001/api/cascade/patient-zero-candidates?limit=10"

# Run cascade simulation
curl -X POST "http://localhost:3001/api/cascade/simulate-realtime" \
  -d "patient_zero_id=SUB-HOU-124" \
  -d "temperature_c=-10" \
  -d "load_multiplier=1.8" \
  -d "failure_threshold=0.15"

# Get scenario presets
curl "http://localhost:3001/api/cascade/scenarios"
```

### SQL Procedures

```sql
-- Get top 10 Patient Zero candidates
CALL SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(10, TRUE);

-- Estimate impact for specific node
CALL SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT('SUB-HOU-124');

-- Get scenario recommendations
CALL SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS();
```

---

## #Actionable Analysis (NEW)

These endpoints transform cascade analysis from "technically impressive" to "actually useful for operators."

### 1. Economic Impact Calculator

**Endpoint**: `POST /api/cascade/economic-impact`

Converts cascade results into dollar impact:
- Regulatory penalties (PUCT, ERCOT compliance)
- Lost revenue (unserved energy)
- Restoration costs (crew, equipment)
- Severity tier assessment

```bash
# Calculate economic impact of a cascade
curl -X POST "http://localhost:3001/api/cascade/economic-impact" \
  -H "Content-Type: application/json" \
  -d '{"estimated_customers_affected": 64800, "affected_capacity_mw": 450, "total_affected_nodes": 87, "max_cascade_depth": 5, "cascade_order": [...]}'
```

**Example Response:**
```json
{
  "economic_impact": {
    "total_estimated_cost": 2847500.00,
    "breakdown": {
      "regulatory_penalties": {"subtotal": 1850000.00},
      "lost_revenue": {"subtotal": 145800.00},
      "restoration_costs": {"subtotal": 851700.00}
    }
  },
  "severity_assessment": {
    "tier": "CRITICAL",
    "description": "Regulatory investigation probable..."
  },
  "executive_summary": "$2,847,500 total exposure..."
}
```

### 2. Mitigation Playbook

**Endpoint**: `POST /api/cascade/mitigation-actions`

Generates actionable containment steps:
- Immediate actions (0-15 minutes)
- Choke point interventions
- Load transfer options
- Crew dispatch recommendations

```bash
curl -X POST "http://localhost:3001/api/cascade/mitigation-actions" \
  -H "Content-Type: application/json" \
  -d '{"patient_zero": {"node_id": "SUB-HOU-124", "node_name": "Rayford"}, ...}'
```

**Example Response:**
```json
{
  "playbook": {
    "immediate_actions": [
      {"priority": 1, "action": "ISOLATE Rayford", "time_target": "0-5 minutes"},
      {"priority": 2, "action": "ENABLE LOAD SHEDDING", "time_target": "5-10 minutes"}
    ],
    "choke_point_interventions": [...],
    "crew_dispatch": {
      "primary_location": {"node_name": "Rayford", "lat": 30.05, "lon": -95.45},
      "estimated_crews_needed": 9
    },
    "containment_probability": {
      "with_immediate_action": 0.85,
      "with_15min_delay": 0.60
    }
  }
}
```

### 3. Restoration Sequence

**Endpoint**: `POST /api/cascade/restoration-sequence`

Optimal order to restore nodes after outage:
- Prioritizes customer-hours reduction
- Respects dependency constraints
- Provides milestone tracking

```bash
curl -X POST "http://localhost:3001/api/cascade/restoration-sequence" \
  -H "Content-Type: application/json" \
  -d '{"cascade_order": [...], "propagation_paths": [...]}'
```

**Example Response:**
```json
{
  "restoration_sequence": [
    {"sequence": 1, "node_name": "Rayford", "customers_restored": 5000, "rationale": "Patient Zero - restore first"},
    {"sequence": 2, "node_name": "NE Houston 4", "cumulative_customers": 7850}
  ],
  "milestones": [
    {"milestone": "50% customers restored", "after_step": 12, "hours": 8.5}
  ]
}
```

### 4. Investment Comparison

**Endpoint**: `POST /api/cascade/compare-mitigations`

ROI analysis for grid hardening investments:
- Cost to harden each node
- Risk reduction achieved
- 5-year ROI calculation
- Budget-aware recommendations

```bash
curl -X POST "http://localhost:3001/api/cascade/compare-mitigations?investment_budget=1000000" \
  -H "Content-Type: application/json" \
  -d '{"node_ids": ["SUB-HOU-124", "SUB-HOU-172"]}'
```

### 5. Real-Time Risk Score

**Endpoint**: `GET /api/cascade/realtime-risk`

Current cascade risk based on live grid state:
- Load stress factor
- Peak hour factor
- Equipment stress
- Network vulnerability

```bash
curl "http://localhost:3001/api/cascade/realtime-risk"
```

**Example Response:**
```json
{
  "realtime_risk": {
    "score": 62.5,
    "level": "HIGH",
    "color": "#fd7e14",
    "recommended_action": "Increase monitoring frequency. Prepare load shedding procedures."
  },
  "risk_factors": {
    "load_stress": {"score": 28.0, "max": 40},
    "peak_hour": {"score": 20.0, "max": 20},
    "equipment_stress": {"score": 12.5, "max": 25}
  }
}
```

---

## Cortex Agent Tools

### 1. `cascade_patient_zeros`

**Purpose**: Identify high-risk nodes that could trigger cascade failures

**Example Queries**:
- "Which substations are most critical for cascade failures?"
- "Show me the top 10 Patient Zero candidates"
- "What nodes have the highest betweenness centrality?"

### 2. `cascade_impact`

**Purpose**: Estimate the impact of a specific node failure

**Example Queries**:
- "What happens if Rayford Substation fails?"
- "Estimate cascade impact for SUB-HOU-124"

### 3. `cascade_scenarios`

**Purpose**: Get recommended parameters for cascade simulation

**Example Queries**:
- "How do I configure a Winter Storm Uri simulation?"
- "What parameters should I use for hurricane scenario?"

---

## Key Metrics

### Betweenness Centrality
- **What it measures**: How often a node lies on shortest paths between other nodes
- **Range**: 0 to 1 (higher = more critical)
- **Interpretation**:
  - \> 0.5: CRITICAL BOTTLENECK
  - 0.1 - 0.5: HIGH importance
  - < 0.1: MODERATE importance

### Cascade Risk Score
- **Formula**: Weighted combination of betweenness, PageRank, and network reach
- **Range**: 0 to 1
- **Use**: Primary ranking metric for Patient Zero identification

### Network Reach
- **1-hop**: Direct neighbors (immediate impact)
- **2-hop**: Two degrees of separation
- **3-hop**: Three degrees of separation

---

## Predefined Scenarios

| Scenario | Temperature | Load | Threshold | Reference |
|----------|-------------|------|-----------|-----------|
| **Winter Storm Uri** | -10°C | 1.8x | 0.15 | Feb 2021 Texas freeze |
| **Summer Peak** | 42°C | 1.6x | 0.20 | July 2023 heat wave |
| **Hurricane Event** | 28°C | 1.2x | 0.10 | Hurricane Harvey 2017 |
| **Normal Operations** | 25°C | 1.0x | 0.35 | Baseline |

---

## Top Risk Nodes

| Rank | Node | Risk Score | Betweenness | Customers |
|------|------|------------|-------------|-----------|
| 1 | SUB-HOU-124 (Rayford) | 0.772 | 0.906 | 64,800 |
| 2 | SUB-HOU-172 (NE Houston 4) | 0.585 | 0.498 | 28,750 |

**Recommended Patient Zero**: SUB-HOU-124 for worst-case scenario planning.

---

## Data Architecture

### Tables

| Table | Schema | Records | Description |
|-------|--------|---------|-------------|
| `GRID_NODES` | SI_DEMOS.ML_DEMO | 91,829 | Grid topology nodes |
| `GRID_EDGES` | SI_DEMOS.ML_DEMO | 2.5M | Node connections |
| `NODE_CENTRALITY_FEATURES_V2` | SI_DEMOS.CASCADE_ANALYSIS | 1,873 | Precomputed centrality |
| `HIGH_RISK_PATIENT_ZEROS` | SI_DEMOS.CASCADE_ANALYSIS | ~100 | Top risk candidates |
| `GNN_PREDICTIONS` | SI_DEMOS.ML_DEMO | 91,829 | GNN risk predictions |

### Node Features

| Feature | Description |
|---------|-------------|
| CAPACITY_KW | Node capacity |
| VOLTAGE_KV | Operating voltage |
| CRITICALITY_SCORE | Base criticality |
| DOWNSTREAM_TRANSFORMERS | Count of downstream transformers |
| DEGREE_CENTRALITY | Number of connections |
| BETWEENNESS_CENTRALITY | Network bottleneck score |
| PAGERANK | Network importance |
| CASCADE_RISK_SCORE | Combined risk metric |

---

## Algorithm

### BFS Cascade Propagation

```python
# BFS via FastAPI endpoint
visited = {seed_idx}
queue = deque([(seed_idx, 0)])
while queue:
    current, depth = queue.popleft()
    if depth >= cascade_depth:
        continue
    cascade_labels[current] = 1
    for neighbor in adjacency.get(current, []):
        if neighbor not in visited:
            visited.add(neighbor)
            queue.append((neighbor, depth + 1))
```

### Customer Impact Formula

```
estimated_customers = downstream_transformers × 50
```

---

## ML Model

### GNN Architecture

```
Input: 10 features
Layer 1: GCNConv(10 → 64) + BatchNorm + ReLU + Dropout(0.3)
Layer 2: GCNConv(64 → 64) + BatchNorm + ReLU + Dropout(0.3)
Layer 3: GCNConv(64 → 32) + BatchNorm + ReLU
Output: Linear(32 → 1) + Sigmoid
```

### Performance
- **AUC-ROC**: 0.9988
- **Framework**: PyTorch Geometric
- **Training**: SPCS GPU (NVIDIA A10G)

---

## Troubleshooting

### No centrality data returned

```sql
-- Check if centrality table has data
SELECT COUNT(*) FROM SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_V2;

-- If empty, run centrality computation script
-- backend/scripts/compute_graph_centrality.py
```

### Cascade simulation returns empty

```sql
-- Verify grid topology exists
SELECT COUNT(*) FROM SI_DEMOS.ML_DEMO.GRID_NODES;
SELECT COUNT(*) FROM SI_DEMOS.ML_DEMO.GRID_EDGES;
```

### Topology visualization shows 0 connections

See [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) for Postgres sync troubleshooting.

---

## Files Reference

| File | Purpose |
|------|---------|
| `backend/server_fastapi.py` | API endpoints |
| `backend/scripts/compute_graph_centrality.py` | NetworkX centrality computation |
| `backend/scripts/cascade_simulator.py` | BFS simulation |
| `backend/scripts/train_gnn_model.py` | GNN training |
| `backend/sql/create_cascade_agent.sql` | Agent + procedures |

---

## Related Documentation

- [POSTGRES_SYNC_RELIABILITY.md](./POSTGRES_SYNC_RELIABILITY.md) - Topology data sync
- [LOCAL_DEVELOPMENT_GUIDE.md](./LOCAL_DEVELOPMENT_GUIDE.md) - Local dev setup
- [archive/evaluations/CASCADE_ML_TOOLS_EVALUATION_REPORT.md](../archive/evaluations/CASCADE_ML_TOOLS_EVALUATION_REPORT.md) - Detailed evaluation

---

*Last Updated: January 28, 2026*
