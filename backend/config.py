"""
Centralized configuration for Flux Ops Center SPCS backend.

All database references should use this module to ensure configurability
across different deployment environments.

Environment Variables:
    SNOWFLAKE_DATABASE: Target database name (default: FLUX_DB)
    SNOWFLAKE_WAREHOUSE: Compute warehouse (default: FLUX_WH)
    SNOWFLAKE_CONNECTION: Connection name for CLI tools (default: cpe_demo_CLI)
    
Usage:
    from config import DB, WAREHOUSE, get_table_path
    
    # Use DB variable in f-strings
    cursor.execute(f"SELECT * FROM {DB}.APPLICATIONS.FLUX_OPS_CENTER_KPIS")
    
    # Or use helper function
    table = get_table_path("APPLICATIONS", "FLUX_OPS_CENTER_KPIS")
    cursor.execute(f"SELECT * FROM {table}")
"""

import os
from typing import Optional

# =============================================================================
# Core Database Configuration
# =============================================================================

# Primary database - configurable via environment variable
DB = os.getenv("SNOWFLAKE_DATABASE", "FLUX_DB")

# Compute warehouse
WAREHOUSE = os.getenv("SNOWFLAKE_WAREHOUSE", "FLUX_WH")

# Connection name for Snowflake CLI
CONNECTION = os.getenv("SNOWFLAKE_CONNECTION", "cpe_demo_CLI")

# =============================================================================
# Schema Names
# =============================================================================

SCHEMA_PRODUCTION = "PRODUCTION"
SCHEMA_APPLICATIONS = "APPLICATIONS"
SCHEMA_ML_DEMO = "ML_DEMO"
SCHEMA_CASCADE_ANALYSIS = "CASCADE_ANALYSIS"
SCHEMA_RAW = "RAW"

# =============================================================================
# Helper Functions
# =============================================================================

def get_table_path(schema: str, table: str, database: Optional[str] = None) -> str:
    """
    Get fully qualified table path.
    
    Args:
        schema: Schema name (e.g., "PRODUCTION", "APPLICATIONS")
        table: Table or view name
        database: Optional database override (defaults to DB env var)
        
    Returns:
        Fully qualified path like "FLUX_DB.PRODUCTION.TRANSFORMER_METADATA"
    """
    db = database or DB
    return f"{db}.{schema}.{table}"


def get_production_table(table: str) -> str:
    """Get path to a PRODUCTION schema table."""
    return get_table_path(SCHEMA_PRODUCTION, table)


def get_applications_table(table: str) -> str:
    """Get path to an APPLICATIONS schema table/view."""
    return get_table_path(SCHEMA_APPLICATIONS, table)


def get_ml_demo_table(table: str) -> str:
    """Get path to a ML_DEMO schema table."""
    return get_table_path(SCHEMA_ML_DEMO, table)


def get_cascade_table(table: str) -> str:
    """Get path to a CASCADE_ANALYSIS schema table."""
    return get_table_path(SCHEMA_CASCADE_ANALYSIS, table)


# =============================================================================
# Common Table References (for autocomplete and consistency)
# =============================================================================

class Tables:
    """Common table references for IDE autocomplete."""
    
    # PRODUCTION tables
    TRANSFORMER_METADATA = get_production_table("TRANSFORMER_METADATA")
    SUBSTATIONS = get_production_table("SUBSTATIONS")
    CIRCUIT_METADATA = get_production_table("CIRCUIT_METADATA")
    METER_INFRASTRUCTURE = get_production_table("METER_INFRASTRUCTURE")
    AMI_INTERVAL_READINGS = get_production_table("AMI_INTERVAL_READINGS")
    TRANSFORMER_HOURLY_LOAD = get_production_table("TRANSFORMER_HOURLY_LOAD")
    HOUSTON_WEATHER_HOURLY = get_production_table("HOUSTON_WEATHER_HOURLY")
    WORK_ORDERS = get_production_table("WORK_ORDERS")
    OUTAGE_RESTORATION_TRACKER = get_production_table("OUTAGE_RESTORATION_TRACKER")
    GRID_POLES_INFRASTRUCTURE = get_production_table("GRID_POLES_INFRASTRUCTURE")
    
    # APPLICATIONS views
    FLUX_OPS_CENTER_KPIS = get_applications_table("FLUX_OPS_CENTER_KPIS")
    FLUX_OPS_CENTER_TOPOLOGY = get_applications_table("FLUX_OPS_CENTER_TOPOLOGY")
    FLUX_OPS_CENTER_TOPOLOGY_METRO = get_applications_table("FLUX_OPS_CENTER_TOPOLOGY_METRO")
    FLUX_OPS_CENTER_TOPOLOGY_FEEDERS = get_applications_table("FLUX_OPS_CENTER_TOPOLOGY_FEEDERS")
    SERVICE_AREAS_MV = get_applications_table("FLUX_OPS_CENTER_SERVICE_AREAS_MV")
    VEGETATION_RISK_COMPUTED = get_applications_table("VEGETATION_RISK_COMPUTED")
    VEGETATION_RISK_ENHANCED = get_applications_table("VEGETATION_RISK_ENHANCED")
    CIRCUIT_STATUS_REALTIME = get_applications_table("CIRCUIT_STATUS_REALTIME")
    
    # ML_DEMO tables
    GRID_NODES = get_ml_demo_table("GRID_NODES")
    GRID_EDGES = get_ml_demo_table("GRID_EDGES")
    T_TRANSFORMER_TEMPORAL_TRAINING = get_ml_demo_table("T_TRANSFORMER_TEMPORAL_TRAINING")
    V_TRANSFORMER_ML_INFERENCE = get_ml_demo_table("V_TRANSFORMER_ML_INFERENCE")
    
    # CASCADE_ANALYSIS tables
    NODE_CENTRALITY_FEATURES = get_cascade_table("NODE_CENTRALITY_FEATURES")
    NODE_CENTRALITY_FEATURES_V2 = get_cascade_table("NODE_CENTRALITY_FEATURES_V2")
    PRECOMPUTED_CASCADES = get_cascade_table("PRECOMPUTED_CASCADES")
    GNN_PREDICTIONS = get_cascade_table("GNN_PREDICTIONS")
    
    # RAW tables
    HOUSTON_BUILDINGS_FOOTPRINTS = get_table_path(SCHEMA_RAW, "HOUSTON_BUILDINGS_FOOTPRINTS")


# =============================================================================
# Snowflake Session Configuration
# =============================================================================

def configure_session(session) -> None:
    """
    Configure a Snowpark session to use the correct database/warehouse.
    
    Args:
        session: Snowpark Session object
    """
    session.sql(f"USE DATABASE {DB}").collect()
    session.sql(f"USE WAREHOUSE {WAREHOUSE}").collect()


def get_connection_params() -> dict:
    """
    Get Snowflake connection parameters from environment.
    
    Returns:
        Dict suitable for snowflake.connector.connect()
    """
    return {
        "account": os.getenv("SNOWFLAKE_ACCOUNT"),
        "user": os.getenv("SNOWFLAKE_USER"),
        "password": os.getenv("SNOWFLAKE_PASSWORD"),
        "database": DB,
        "warehouse": WAREHOUSE,
        "schema": SCHEMA_PRODUCTION,
    }


# Print configuration when module is loaded (for debugging)
if os.getenv("FLUX_DEBUG"):
    print(f"[config] Database: {DB}")
    print(f"[config] Warehouse: {WAREHOUSE}")
    print(f"[config] Connection: {CONNECTION}")
