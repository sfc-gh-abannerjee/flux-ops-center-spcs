# Snowflake ML Demo: Predictive Asset Maintenance

## #Reference Architecture

**Product Positioning**: Counter Palantir's "black-box" asset maintenance by demonstrating CNP can build transparent, production-grade ML using standard tools.

---

## Executive Summary

| Aspect | Value |
|--------|-------|
| **Use Case** | Predict transformer thermal overload before failure |
| **Business Impact** | Reduce unplanned outages, optimize maintenance scheduling |
| **Snowflake Products** | Snowpark ML, Model Registry, **ML Experiments**, **SHAP Explainability**, **ML Lineage**, **ML Observability** |
| **Build Time** | 1-2 hours (vs. weeks with Palantir professional services teams) |
| **Ownership** | 100% CNP team (no external dependencies) |

---

## Snowflake ML Capabilities Demonstrated

| Capability | Description | Competitive Value |
|------------|-------------|-------------------|
| **Snowpark ML** | Feature engineering + model training | Standard Python APIs |
| **ML Experiments** | Hyperparameter tracking, model comparison | Self-service iteration |
| **Model Registry** | Version control, governance, deployment | Centralized management |
| **SHAP Explainability** | Shapley values for every prediction | **Counter black-box narrative** |
| **ML Lineage** | Data source → model audit trail | Regulatory compliance |
| **ML Observability** | Drift detection, performance monitoring | Production readiness |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SNOWFLAKE DATA CLOUD                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────┐     ┌──────────────────────┐                     │
│   │ TRANSFORMER_THERMAL_  │     │ TRANSFORMER_METADATA │                     │
│   │ STRESS_MATERIALIZED   │     │ (91K transformers)   │                     │
│   │ (211M hourly records) │     │                      │                     │
│   └──────────┬────────────┘     └──────────┬───────────┘                     │
│              │                             │                                 │
│              └──────────────┬──────────────┘                                 │
│                             ▼                                                │
│              ┌──────────────────────────────┐                                │
│              │    V_TRANSFORMER_ML_FEATURES  │                                │
│              │    (Feature Engineering)      │                                │
│              └──────────────┬───────────────┘                                │
│                             │                                                │
│                    ┌────────┴────────┐                                       │
│                    ▼                 ▼                                       │
│        ┌─────────────────┐   ┌────────────────┐                              │
│        │ ML Experiments   │   │ Background     │                              │
│        │ - conservative   │   │ Data (SHAP)    │                              │
│        │ - balanced       │   │ 100 samples    │                              │
│        │ - aggressive     │   │                │                              │
│        └────────┬─────────┘   └───────┬────────┘                              │
│                 │                     │                                       │
│                 └──────────┬──────────┘                                       │
│                            ▼                                                  │
│              ┌──────────────────────────────┐                                │
│              │   Snowflake Model Registry    │                                │
│              │   TRANSFORMER_FAILURE_        │                                │
│              │   PREDICTOR v2_explainable    │                                │
│              │   ✓ SHAP Explainability       │                                │
│              │   ✓ ML Lineage               │                                │
│              └──────────────┬───────────────┘                                │
│                             │                                                │
│          ┌──────────────────┼──────────────────┐                             │
│          ▼                  ▼                  ▼                             │
│   ┌────────────┐     ┌────────────┐     ┌────────────┐                       │
│   │ Batch      │     │ EXPLAIN()  │     │ Model      │                       │
│   │ Scoring    │     │ SHAP       │     │ Monitor    │                       │
│   │ (Task)     │     │ Values     │     │ (Drift)    │                       │
│   └────────────┘     └────────────┘     └────────────┘                       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

### Primary: TRANSFORMER_THERMAL_STRESS_MATERIALIZED

| Attribute | Value |
|-----------|-------|
| Total Records | 211M rows |
| Time Coverage | Jul-Aug 2024, Jul-Aug 2025 |
| Granularity | Hourly per transformer |
| Transformers | 91,554 unique |

### Features Used

| Feature | Type | Description | Importance |
|---------|------|-------------|------------|
| `LOAD_FACTOR_PCT` | Numeric | Current load as % of capacity | HIGH |
| `TRANSFORMER_AGE_YEARS` | Numeric | Equipment age | HIGH |
| `HOUR_OF_DAY` | Numeric | Time of day (2-7 PM = peak) | MEDIUM |
| `VOLTAGE_SAG_COUNT` | Numeric | Power quality events | MEDIUM |
| `STRESS_VS_HISTORICAL` | Categorical | Comparison to baseline | HIGH |
| `IS_PEAK_HOUR` | Binary | Peak demand hours flag | MEDIUM |
| `IS_AGING_EQUIPMENT` | Binary | Age >= 20 years | MEDIUM |

### Target Variable

```
IS_HIGH_RISK = 1 if THERMAL_STRESS_CATEGORY IN ('OVERLOAD', 'SEVERE_OVERLOAD', 'CRITICAL')
             = 0 otherwise
```

### Training Data Quality

| Class | Records | Avg Load Factor | Range |
|-------|---------|-----------------|-------|
| HIGH_RISK (1) | 50,000 | 119.88% | 100-150% |
| NORMAL (0) | 50,000 | 16.95% | 0-99.99% |

**Note**: Clear separation in LOAD_FACTOR_PCT (119.88% vs 16.95%) indicates strong predictive signal.

---

## ML Experiments

### Experiment: TRANSFORMER_FAILURE_EXPERIMENT

Three model variants trained and compared:

| Run Name | n_estimators | max_depth | learning_rate | Purpose |
|----------|--------------|-----------|---------------|---------|
| `conservative` | 50 | 4 | 0.05 | Lower complexity, prevents overfitting |
| `balanced` | 100 | 6 | 0.10 | Moderate complexity (recommended) |
| `aggressive` | 200 | 8 | 0.15 | Higher complexity, may overfit |

**View in Snowsight**: AI & ML → Experiments → TRANSFORMER_FAILURE_EXPERIMENT

---

## Model Explainability (SHAP)

### Why This Matters

**Palantir's Weakness**: Black-box models that can't explain predictions
**Snowflake's Advantage**: SHAP values for every prediction

### How SHAP Works

Shapley values measure each feature's contribution to a prediction:

```
Final Prediction = Base Rate + SHAP(LOAD_FACTOR) + SHAP(AGE) + SHAP(HOUR) + ...
```

### Example Explanation

For a transformer predicted as HIGH RISK:

| Feature | Value | SHAP Contribution |
|---------|-------|-------------------|
| LOAD_FACTOR_PCT | 125% | +0.42 (pushes toward HIGH RISK) |
| IS_PEAK_HOUR | 1 | +0.15 (peak hours increase risk) |
| TRANSFORMER_AGE | 25 years | +0.08 (older = higher risk) |
| AVG_VOLTAGE | 121V | -0.05 (stable voltage reduces risk) |

### SQL Access to SHAP Values

```sql
-- Get SHAP explanations via SQL
WITH MV_ALIAS AS MODEL SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_PREDICTOR VERSION v2_explainable
SELECT 
    TRANSFORMER_ID,
    LOAD_FACTOR_PCT,
    prediction.*,
    explanation.*
FROM SI_DEMOS.ML_DEMO.T_TRANSFORMER_ML_TRAINING LIMIT 5,
    TABLE(MV_ALIAS!PREDICT(...)) as prediction,
    TABLE(MV_ALIAS!EXPLAIN(...)) as explanation;
```

### Business Value

- **Operations**: Explain to field crews WHY a transformer is flagged
- **Compliance**: Audit trail for maintenance decisions (PUC)
- **Trust**: Build confidence in ML-based decisions

---

## ML Lineage

### What's Tracked

- Source tables used for training
- Feature transformations applied
- Model versions and relationships

### Query Lineage

```sql
SELECT * FROM TABLE(
    SNOWFLAKE.CORE.GET_LINEAGE(
        object_name => 'SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_PREDICTOR',
        object_domain => 'MODEL',
        direction => 'UPSTREAM',
        distance => 3
    )
);
```

**View in Snowsight**: AI & ML → Models → TRANSFORMER_FAILURE_PREDICTOR → Lineage tab

---

## ML Observability (Model Monitoring)

### Monitor Setup

```sql
CREATE MODEL MONITOR SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_MONITOR
WITH 
    MODEL = SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_PREDICTOR VERSION v2_explainable,
    SOURCE_TABLE = SI_DEMOS.ML_DEMO.T_INFERENCE_LOG,
    PREDICTION_COLUMN = 'PREDICTION',
    LABEL_COLUMN = 'ACTUAL_OUTCOME',
    TIMESTAMP_COLUMN = 'INFERENCE_TIMESTAMP',
    AGGREGATION_WINDOW = '1 DAY',
    MODEL_TYPE = 'BINARY_CLASSIFICATION';
```

### Drift Detection

```sql
SELECT * FROM TABLE(
    MODEL_MONITOR_DRIFT_METRIC(
        'SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_MONITOR',
        'JS_DIVERGENCE',
        'LOAD_FACTOR_PCT',
        '1 DAY',
        DATEADD(DAY, -30, CURRENT_DATE()),
        CURRENT_DATE()
    )
);
```

### Performance Monitoring

```sql
SELECT * FROM TABLE(
    MODEL_MONITOR_PERFORMANCE_METRIC(
        'SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_MONITOR',
        'RECALL',  -- Critical for safety!
        '1 DAY',
        DATEADD(DAY, -30, CURRENT_DATE()),
        CURRENT_DATE()
    )
);
```

---

## Competitive Positioning vs. Palantir

| Aspect | Palantir Grid 360 | Snowflake ML |
|--------|-------------------|--------------|
| **Build Time** | Weeks (requires professional services teams) | Hours (CNP team) |
| **Ownership** | Palantir proprietary | 100% CNP owned |
| **Model Transparency** | Black box | **SHAP values** |
| **Experiment Tracking** | Manual | **ML Experiments UI** |
| **Data Lineage** | Limited | **Full audit trail** |
| **Model Monitoring** | Requires Palantir setup | **Native ML Observability** |
| **Feature Engineering** | Ontology-based | Standard SQL/Python |
| **Data Movement** | Requires Palantir ingestion | Zero data movement |
| **Cost** | #fees + platform license | Compute-only (pay-per-use) |

---

## Files Included

| File | Purpose |
|------|---------|
| `01_ml_demo_setup.sql` | Create schemas, views, training data |
| `transformer_failure_prediction.ipynb` | Snowflake Notebook for full ML workflow |
| `snowflake.yml` | Project definition for CLI deployment |
| `ML_DEMO_REFERENCE.md` | This document |

---

## Quick Start

### 1. Run SQL Setup

```bash
snow sql -f ml/01_ml_demo_setup.sql --connection cpe_demo_CLI
```

### 2. Deploy Notebook to Snowflake

```bash
cd ml/
snow notebook deploy transformer_failure_prediction \
    --database SI_DEMOS \
    --schema ML_DEMO \
    --connection cpe_demo_CLI
```

### 3. Open in Snowsight

URL: https://app.snowflake.com/SFSEHOL/si_ae_enablement_retail_hmjrfl/#/notebooks/SI_DEMOS.ML_DEMO.TRANSFORMER_FAILURE_PREDICTION

### 4. Run All Cells

The notebook will:
1. Load balanced training data
2. Train 3 model variants (experiment tracking)
3. Register best model with SHAP explainability
4. Demonstrate lineage tracking
5. Set up model monitoring
6. Run inference on August holdout data

---

## Demo Script (#Talking Points)

### Opening

> "Let me show you how CNP can build production-grade predictive maintenance in 1-2 hours - something that would take weeks with Palantir professional services teams."

### Key Demo Points

1. **Experiments**: "Your team can iterate on models themselves - compare 3 variants with different hyperparameters"

2. **Explainability**: "Unlike Palantir's black box, every prediction includes SHAP values explaining WHY"

3. **Lineage**: "Full audit trail from source data to model - critical for PUC compliance"

4. **Monitoring**: "Built-in drift detection alerts you when the model needs retraining"

### Closing

> "This is all built with standard Python and SQL - skills your team already has. No proprietary Palantir Ontology, no #dependency, no vendor lock-in."

---

## Retraining Triggers

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Accuracy drop | < 80% | Retrain immediately |
| Recall drop | < 85% | Retrain (safety critical!) |
| Drift detected | JS Divergence > 0.1 | Investigate, likely retrain |
| Seasonal change | Spring/Fall | Evaluate model on new patterns |

---

## Next Steps

1. **Phase 1**: Deploy batch scoring task for daily operations
2. **Phase 2**: Integrate SHAP explanations into Flux Operations Center
3. **Phase 3**: Connect high-risk predictions to SAP Work Order system
4. **Phase 4**: Add weather forecast features for proactive predictions
5. **Phase 5**: Extend to other asset types (substations, feeders)

---

*Generated: Jan 25, 2026 | # Abhinav Bannerjee | Account: Grid Operations*
*Snowflake ML Version: snowflake-ml-python 1.7.0+*
