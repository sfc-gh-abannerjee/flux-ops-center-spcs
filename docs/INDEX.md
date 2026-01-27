# Cascade Failure Analysis Documentation Index

## Overview

This directory contains comprehensive documentation for the Grid Operations cascade failure analysis system integrated with Snowflake Cortex Agent.

---

## Documentation Files

### 1. Evaluation Report
**File**: `CASCADE_ML_TOOLS_EVALUATION_REPORT.md` (625 lines)

Comprehensive technical evaluation comparing Cortex Agent performance with and without ML-backed cascade tools.

**Key Sections**:
- Executive Summary
- Test Methodology
- Detailed Test Results (3 test cases)
- Quantitative Comparison
- Technical Deep Dive
- Operational Implications
- Recommendations

**Key Finding**: Without ML tools, customer impact is underestimated by **11.7x** (5,552 vs 64,800 customers).

---

### 2. Quick Reference Guide
**File**: `CASCADE_QUICK_REFERENCE.md` (216 lines)

Practical guide for using cascade analysis tools.

**Contents**:
- Tool descriptions and example queries
- Key metrics explained
- Common query patterns
- API endpoints
- Direct SQL procedures

---

### 3. Implementation Summary
**File**: `../backend/scripts/CASCADE_IMPLEMENTATION_SUMMARY.md` (287 lines)

Technical implementation details for the cascade analysis system.

**Contents**:
- Resolved compromises (6 total)
- Files created/modified
- Database tables
- API endpoints
- Execution instructions

---

## Quick Links

| Topic | Document | Section |
|-------|----------|---------|
| What tools are available? | Quick Reference | Available Tools |
| How accurate are the tools? | Evaluation Report | Quantitative Comparison |
| What's the customer impact of SUB-HOU-124 failure? | Evaluation Report | Test T2 |
| How do I run a Winter Storm Uri simulation? | Quick Reference | cascade_scenarios |
| Why can't I use SQL for centrality? | Evaluation Report | Technical Deep Dive |
| What stored procedures exist? | Quick Reference | Stored Procedures |

---

## Key Statistics

| Metric | Value |
|--------|-------|
| Grid Nodes | 91,829 |
| Grid Edges | 2.5M |
| Nodes with True Centrality | 1,873 |
| Top Risk Node | SUB-HOU-124 (Rayford Substation) |
| Highest Betweenness | 0.906 |
| Max Customer Impact | 64,800 |

---

## Tool Summary

| Tool | Type | Purpose |
|------|------|---------|
| `cascade_patient_zeros` | Stored Procedure | Find high-risk nodes by centrality |
| `cascade_impact` | Stored Procedure | Estimate node failure impact |
| `cascade_scenarios` | Stored Procedure | Get simulation parameters |
| `/api/cascade/simulate-realtime` | REST API | BFS simulation |

---

## Files in Repository

```
flux_ops_center_spcs/
├── docs/
│   ├── INDEX.md                              # This file
│   ├── CASCADE_ML_TOOLS_EVALUATION_REPORT.md # Full evaluation report
│   └── CASCADE_QUICK_REFERENCE.md            # Quick reference guide
│
├── backend/
│   ├── scripts/
│   │   ├── CASCADE_IMPLEMENTATION_SUMMARY.md # Implementation details
│   │   ├── compute_graph_centrality.py       # NetworkX centrality computation
│   │   ├── cascade_simulator.py              # BFS cascade simulation
│   │   └── train_gnn_model.py               # GNN training pipeline
│   │
│   ├── sql/
│   │   ├── create_cascade_agent.sql         # Agent stored procedures
│   │   ├── update_agent_cascade_tools.sql   # Agent update script
│   │   └── priority5_cascade_agent_tools_v2.sql # Alternative UDF implementation
│   │
│   └── server_fastapi.py                    # FastAPI with cascade endpoints
│
├── test_cascade_agent.py                    # Agent tool verification
└── test_cascade_with_without_ml.py          # ML vs non-ML comparison test
```

---

## Contact

For questions or issues with cascade analysis:
- Review documentation in this directory
- Check stored procedure definitions in `backend/sql/`
- Run test scripts to verify tool functionality

---

*Documentation generated: January 25, 2026*
