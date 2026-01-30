#!/usr/bin/env python3
"""
Engineering: Deploy Transformer Failure Predictor as SPCS Inference Service

This script deploys the registered ML model to Snowpark Container Services
for scalable, production-grade real-time inference.

Usage:
    SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI python deploy_inference_service.py
"""

import os
from snowflake.snowpark import Session
from snowflake.ml.registry import Registry

# Configuration
CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME", "cpe_demo_CLI")
MODEL_DATABASE = "SI_DEMOS"
MODEL_SCHEMA = "ML_DEMO"
MODEL_NAME = "TRANSFORMER_FAILURE_PREDICTOR"
MODEL_VERSION = "V2_EXPLAINABLE"

SERVICE_NAME = "TRANSFORMER_ML_INFERENCE_SVC"
COMPUTE_POOL = "FLUX_INTERACTIVE_POOL"  # CPU pool, already active
MAX_INSTANCES = 2

def main():
    print(f"Connecting to Snowflake using connection: {CONNECTION_NAME}")
    
    # Create session
    session = Session.builder.config("connection_name", CONNECTION_NAME).create()
    session.use_database(MODEL_DATABASE)
    session.use_schema(MODEL_SCHEMA)
    
    print(f"Connected as: {session.get_current_user()}")
    print(f"Database: {session.get_current_database()}")
    print(f"Schema: {session.get_current_schema()}")
    
    # Initialize registry
    reg = Registry(session=session, database_name=MODEL_DATABASE, schema_name=MODEL_SCHEMA)
    
    # Get model version
    print(f"\nGetting model: {MODEL_NAME} version {MODEL_VERSION}")
    mv = reg.get_model(MODEL_NAME).version(MODEL_VERSION)
    
    # Show model info
    print(f"Model functions: {mv.show_functions()}")
    
    # Check if service already exists
    existing_services = mv.list_services()
    print(f"\nExisting services: {existing_services}")
    
    if SERVICE_NAME in str(existing_services):
        print(f"Service {SERVICE_NAME} already exists. Skipping creation.")
        return
    
    # Create inference service
    print(f"\nCreating inference service: {SERVICE_NAME}")
    print(f"  Compute Pool: {COMPUTE_POOL}")
    print(f"  Max Instances: {MAX_INSTANCES}")
    
    mv.create_service(
        service_name=SERVICE_NAME,
        service_compute_pool=COMPUTE_POOL,
        ingress_enabled=True,
        max_instances=MAX_INSTANCES,
        # num_workers auto-picked for CPU pool
    )
    
    print(f"\n✓ Service creation initiated!")
    print(f"  Service will be ready in 5-15 minutes.")
    print(f"\nTo check status:")
    print(f"  SHOW SERVICES LIKE '{SERVICE_NAME}' IN SCHEMA {MODEL_DATABASE}.{MODEL_SCHEMA};")
    print(f"\nTo get endpoint URL:")
    print(f"  SHOW ENDPOINTS IN SERVICE {MODEL_DATABASE}.{MODEL_SCHEMA}.{SERVICE_NAME};")

if __name__ == "__main__":
    main()
