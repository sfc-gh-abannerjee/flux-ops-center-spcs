#!/bin/bash
# Deploy ML Notebook with External Access Integration
# 
# The Snow CLI doesn't support external_access_integrations in snowflake.yml,
# so we must apply it via ALTER NOTEBOOK after each deploy.

set -e

CONNECTION="${1:-cpe_demo_CLI}"
DATABASE="${SNOWFLAKE_DATABASE:-FLUX_DB}"
SCHEMA="ML_DEMO"
NOTEBOOK="${DATABASE}.${SCHEMA}.TRANSFORMER_FAILURE_PREDICTION"
EXTERNAL_ACCESS="PYPI_ACCESS_INTEGRATION"

echo "=== Deploying ML Notebook ==="
echo "Connection: $CONNECTION"
echo "Database: $DATABASE"
echo ""

# Step 1: Deploy notebook
echo "Step 1: Deploying notebook..."
snow notebook deploy transformer_failure_prediction \
    --database "$DATABASE" \
    --schema "$SCHEMA" \
    --connection "$CONNECTION" \
    --replace

echo ""
echo "Step 2: Configuring external access integration..."
snow sql -q "ALTER NOTEBOOK $NOTEBOOK SET EXTERNAL_ACCESS_INTEGRATIONS = ($EXTERNAL_ACCESS)" \
    --connection "$CONNECTION"

echo ""
echo "=== Deployment Complete ==="
echo "External access enabled for pip install"
echo ""
echo "Open notebook: snow notebook open transformer_failure_prediction --connection $CONNECTION"
