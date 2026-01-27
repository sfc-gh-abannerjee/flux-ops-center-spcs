# Cascade Analysis Quick Reference Guide

## Overview

This guide provides quick reference for using the Grid Operations Cortex Agent's cascade analysis capabilities.

---

## Available Tools

### 1. `cascade_patient_zeros`

**Purpose**: Identify high-risk nodes that could trigger cascade failures

**Example Queries**:
- "Which substations are most critical for cascade failures?"
- "Show me the top 10 Patient Zero candidates"
- "What nodes have the highest betweenness centrality?"

**Returns**:
| Field | Description |
|-------|-------------|
| node_id | Unique identifier (e.g., SUB-HOU-124) |
| node_name | Human-readable name |
| cascade_risk_score | Combined risk metric (0-1) |
| betweenness_centrality | Network bottleneck score (0-1) |
| pagerank | Network importance (0-1) |
| downstream_customers | Estimated customer impact |

**Top Candidates**:
| Rank | Node | Risk Score | Betweenness | Customers |
|------|------|------------|-------------|-----------|
| 1 | SUB-HOU-124 (Rayford) | 0.772 | 0.906 | 64,800 |
| 2 | SUB-HOU-172 (NE Houston 4) | 0.585 | 0.498 | 28,750 |

---

### 2. `cascade_impact`

**Purpose**: Estimate the impact of a specific node failure

**Example Queries**:
- "What happens if Rayford Substation fails?"
- "Estimate cascade impact for SUB-HOU-124"
- "How many customers would be affected if SUB-HOU-172 fails?"

**Input**: `patient_zero_id` (e.g., "SUB-HOU-124")

**Returns**:
| Field | Description |
|-------|-------------|
| patient_zero | Node details with centrality metrics |
| direct_neighbors_wave1 | First wave impact count |
| wave2_reach | Second wave propagation |
| wave3_reach | Third wave propagation |
| total_network_reach | Total nodes affected |
| estimated_customers_affected | Customer impact |
| network_criticality | Assessment (CRITICAL/HIGH/MODERATE) |
| recommendation | Operational guidance |

**Example Output for SUB-HOU-124**:
```
Betweenness Centrality: 0.906 (CRITICAL BOTTLENECK)
Wave 1: 1,296 nodes
Wave 2: 43 nodes
Wave 3: 78 nodes
Total Reach: 1,417 nodes
Customers Affected: 64,800
```

---

### 3. `cascade_scenarios`

**Purpose**: Get recommended parameters for cascade simulation

**Example Queries**:
- "How do I configure a Winter Storm Uri simulation?"
- "What parameters should I use for hurricane scenario?"
- "Show me the predefined cascade scenarios"

**Returns**: Four predefined scenarios with parameters:

| Scenario | Temperature | Load | Threshold | Historical Context |
|----------|-------------|------|-----------|-------------------|
| **Winter Storm Uri** | -10°C | 1.8x | 0.15 | Feb 2021 Texas freeze |
| **Summer Peak** | 42°C | 1.6x | 0.20 | July 2023 heat wave |
| **Hurricane Event** | 28°C | 1.2x | 0.10 | Hurricane Harvey 2017 |
| **Normal Operations** | 25°C | 1.0x | 0.35 | Baseline |

---

## Key Metrics Explained

### Betweenness Centrality
- **What it measures**: How often a node lies on shortest paths between other nodes
- **Range**: 0 to 1 (higher = more critical)
- **Interpretation**:
  - > 0.5: CRITICAL BOTTLENECK
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
- **Total**: Sum of all reachable nodes within 3 hops

---

## Common Query Patterns

### Identifying Critical Infrastructure
```
"Which substations have betweenness centrality above 0.5?"
"Show me nodes that are critical bottlenecks"
"What are the top 5 Patient Zero candidates by cascade risk?"
```

### Impact Assessment
```
"What happens if [NODE_ID] fails?"
"How many customers would lose power if [SUBSTATION] fails?"
"Estimate the cascade impact for [NODE_NAME]"
```

### Scenario Planning
```
"What parameters for Winter Storm Uri simulation?"
"Configure a summer peak demand scenario"
"How should I model a hurricane cascade event?"
```

### Comparison Queries
```
"Compare cascade risk between SUB-HOU-124 and SUB-HOU-172"
"Which of these substations has higher betweenness: [list]?"
"Rank these nodes by cascade impact potential"
```

---

## Important Notes

### ⚠️ Always Use ML Tools for Cascade Analysis

Without the cascade-specific tools, the agent:
- **Cannot** compute true graph centrality
- **Underestimates** customer impact by up to 11.7x
- **Misses** cascade propagation patterns
- **Cannot** identify critical bottlenecks

### Recommended Patient Zero

**SUB-HOU-124 (Rayford Substation)** is the highest-risk node:
- Betweenness: 0.906 (highest in network)
- Risk Score: 0.772
- Impact: 64,800 customers
- Assessment: CRITICAL BOTTLENECK

Use this as the default Patient Zero for worst-case scenario planning.

---

## API Endpoints (Advanced)

For real-time BFS simulation, use the FastAPI backend:

```bash
# Cascade simulation
curl -X POST "http://localhost:3001/api/cascade/simulate-realtime" \
  -d "patient_zero_id=SUB-HOU-124" \
  -d "temperature_c=-10" \
  -d "load_multiplier=1.8" \
  -d "failure_threshold=0.15"

# Get patient zero candidates
curl "http://localhost:3001/api/cascade/patient-zero-candidates?limit=10"

# Get predefined scenarios
curl "http://localhost:3001/api/cascade/scenarios"
```

---

## Stored Procedures (Direct SQL)

```sql
-- Get top 10 Patient Zero candidates
CALL SI_DEMOS.CASCADE_ANALYSIS.GET_PATIENT_ZERO_CANDIDATES(10, TRUE);

-- Estimate impact for specific node
CALL SI_DEMOS.CASCADE_ANALYSIS.ESTIMATE_CASCADE_IMPACT('SUB-HOU-124');

-- Get scenario recommendations
CALL SI_DEMOS.CASCADE_ANALYSIS.GET_CASCADE_SCENARIO_RECOMMENDATIONS();
```

---

## Support

For questions about cascade analysis:
1. Check this quick reference guide
2. Review the full evaluation report: `docs/CASCADE_ML_TOOLS_EVALUATION_REPORT.md`
3. See implementation details: `scripts/CASCADE_IMPLEMENTATION_SUMMARY.md`

---

*Last Updated: January 25, 2026*
