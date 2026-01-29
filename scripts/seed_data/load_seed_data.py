#!/usr/bin/env python3
"""
FLUX Ops Center - Seed Data Loader
===================================
Python script to load production-quality seed data into any Snowflake account.

Usage:
    python load_seed_data.py --connection <connection_name>
    python load_seed_data.py --account <account> --user <user> --password <password>

Requirements:
    pip install snowflake-connector-python pandas pyarrow

This script:
1. Creates the database and schema if they don't exist
2. Creates all required tables with proper schemas
3. Loads parquet files from the local seed_data directory
4. Verifies row counts match expected values
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

try:
    import snowflake.connector
    from snowflake.connector.pandas_tools import write_pandas
    import pandas as pd
    DEPENDENCIES_AVAILABLE = True
except ImportError as e:
    DEPENDENCIES_AVAILABLE = False
    logger.error(f"Missing dependencies: {e}")
    logger.error("Install with: pip install snowflake-connector-python pandas pyarrow")


# Configuration
DEFAULT_DATABASE = "FLUX_DEMO"
DEFAULT_SCHEMA = "PRODUCTION"
DEFAULT_WAREHOUSE = "COMPUTE_WH"

# Expected row counts for verification
EXPECTED_COUNTS = {
    'SUBSTATIONS': 275,
    'CIRCUIT_METADATA': 8842,
    'TRANSFORMER_METADATA': 91554,
    'GRID_POLES_INFRASTRUCTURE': 62038,
    'HOUSTON_WEATHER_HOURLY': 4464,
    'ERCOT_LMP_HOUSTON_ZONE': 45213,
    'POWER_QUALITY_READINGS': 10000,
    'SAP_WORK_ORDERS': 250488,
    'OUTAGE_EVENTS': 34252,
    'TECHNICAL_MANUALS_PDF_CHUNKS': 20000,
    'METER_INFRASTRUCTURE': 10000,
    'CUSTOMERS_MASTER_DATA': 11849,
}

# Table DDL definitions
TABLE_DDLS = {
    'SUBSTATIONS': """
        CREATE TABLE IF NOT EXISTS {schema}.SUBSTATIONS (
            SUBSTATION_ID VARCHAR,
            SUBSTATION_NAME VARCHAR,
            LATITUDE FLOAT,
            LONGITUDE FLOAT,
            CAPACITY_MW FLOAT,
            VOLTAGE_LEVEL_KV FLOAT,
            INSTALL_DATE DATE,
            STATUS VARCHAR,
            REGION VARCHAR
        )
    """,
    'CIRCUIT_METADATA': """
        CREATE TABLE IF NOT EXISTS {schema}.CIRCUIT_METADATA (
            CIRCUIT_ID VARCHAR,
            CIRCUIT_NAME VARCHAR,
            SUBSTATION_ID VARCHAR,
            VOLTAGE_CLASS VARCHAR,
            CIRCUIT_TYPE VARCHAR,
            TOTAL_CUSTOMERS NUMBER,
            TOTAL_TRANSFORMERS NUMBER,
            LINE_MILES FLOAT,
            INSTALL_DATE DATE,
            LATITUDE FLOAT,
            LONGITUDE FLOAT,
            STATUS VARCHAR
        )
    """,
    'TRANSFORMER_METADATA': """
        CREATE TABLE IF NOT EXISTS {schema}.TRANSFORMER_METADATA (
            TRANSFORMER_ID VARCHAR,
            TRANSFORMER_NAME VARCHAR,
            CIRCUIT_ID VARCHAR,
            SUBSTATION_ID VARCHAR,
            KVA_RATING FLOAT,
            VOLTAGE_PRIMARY FLOAT,
            VOLTAGE_SECONDARY FLOAT,
            PHASE_CONFIG VARCHAR,
            INSTALL_DATE DATE,
            MANUFACTURER VARCHAR,
            LATITUDE FLOAT,
            LONGITUDE FLOAT,
            STATUS VARCHAR,
            LOAD_FACTOR FLOAT,
            LAST_MAINTENANCE_DATE DATE
        )
    """,
    'GRID_POLES_INFRASTRUCTURE': """
        CREATE TABLE IF NOT EXISTS {schema}.GRID_POLES_INFRASTRUCTURE (
            POLE_ID VARCHAR,
            POLE_TYPE VARCHAR,
            MATERIAL VARCHAR,
            HEIGHT_FT NUMBER,
            INSTALL_DATE DATE,
            CIRCUIT_ID VARCHAR,
            LATITUDE FLOAT,
            LONGITUDE FLOAT,
            CONDITION_STATUS VARCHAR,
            LAST_INSPECTION_DATE DATE
        )
    """,
    'HOUSTON_WEATHER_HOURLY': """
        CREATE TABLE IF NOT EXISTS {schema}.HOUSTON_WEATHER_HOURLY (
            TIMESTAMP TIMESTAMP_NTZ,
            TEMPERATURE_F FLOAT,
            HUMIDITY_PCT FLOAT,
            WIND_SPEED_MPH FLOAT,
            PRECIPITATION_IN FLOAT,
            WEATHER_CONDITION VARCHAR,
            HEAT_INDEX FLOAT,
            WIND_CHILL FLOAT
        )
    """,
    'ERCOT_LMP_HOUSTON_ZONE': """
        CREATE TABLE IF NOT EXISTS {schema}.ERCOT_LMP_HOUSTON_ZONE (
            TIMESTAMP TIMESTAMP_NTZ,
            LMP_PRICE FLOAT,
            ENERGY_PRICE FLOAT,
            CONGESTION_PRICE FLOAT,
            LOSS_PRICE FLOAT,
            ZONE VARCHAR
        )
    """,
    'POWER_QUALITY_READINGS': """
        CREATE TABLE IF NOT EXISTS {schema}.POWER_QUALITY_READINGS (
            READING_ID VARCHAR,
            METER_ID VARCHAR,
            TIMESTAMP TIMESTAMP_NTZ,
            VOLTAGE FLOAT,
            FREQUENCY FLOAT,
            THD_VOLTAGE FLOAT,
            THD_CURRENT FLOAT,
            POWER_FACTOR FLOAT,
            SAG_EVENT BOOLEAN,
            SWELL_EVENT BOOLEAN
        )
    """,
    'SAP_WORK_ORDERS': """
        CREATE TABLE IF NOT EXISTS {schema}.SAP_WORK_ORDERS (
            WORK_ORDER_ID VARCHAR,
            WORK_ORDER_TYPE VARCHAR,
            PRIORITY VARCHAR,
            STATUS VARCHAR,
            CUSTOMER_ID VARCHAR,
            DESCRIPTION VARCHAR,
            CREATED_DATE TIMESTAMP_NTZ,
            SCHEDULED_DATE TIMESTAMP_NTZ,
            COMPLETED_DATE TIMESTAMP_NTZ,
            CREW_ID VARCHAR,
            ESTIMATED_DURATION_HOURS FLOAT,
            ACTUAL_DURATION_HOURS FLOAT,
            LABOR_COST FLOAT,
            PARTS_COST FLOAT
        )
    """,
    'OUTAGE_EVENTS': """
        CREATE TABLE IF NOT EXISTS {schema}.OUTAGE_EVENTS (
            OUTAGE_ID VARCHAR,
            TRANSFORMER_ID VARCHAR,
            CIRCUIT_ID VARCHAR,
            OUTAGE_START_TIME TIMESTAMP_NTZ,
            OUTAGE_END_TIME TIMESTAMP_NTZ,
            OUTAGE_CAUSE VARCHAR,
            CUSTOMERS_AFFECTED NUMBER,
            WEATHER_RELATED BOOLEAN,
            RESTORATION_CREW VARCHAR
        )
    """,
    'TECHNICAL_MANUALS_PDF_CHUNKS': """
        CREATE TABLE IF NOT EXISTS {schema}.TECHNICAL_MANUALS_PDF_CHUNKS (
            CHUNK_ID VARCHAR,
            DOCUMENT_NAME VARCHAR,
            CHUNK_INDEX NUMBER,
            CHUNK_TEXT VARCHAR
        )
    """,
    'METER_INFRASTRUCTURE': """
        CREATE TABLE IF NOT EXISTS {schema}.METER_INFRASTRUCTURE (
            METER_ID VARCHAR,
            METER_LATITUDE FLOAT,
            METER_LONGITUDE FLOAT,
            COMMISSIONED_DATE DATE,
            METER_TYPE VARCHAR,
            CUSTOMER_SEGMENT_ID VARCHAR,
            POLE_ID VARCHAR,
            CIRCUIT_ID VARCHAR,
            TRANSFORMER_ID VARCHAR,
            SUBSTATION_ID VARCHAR,
            POLE_TYPE VARCHAR,
            POLE_MATERIAL VARCHAR,
            POLE_HEIGHT_FT NUMBER,
            CONDITION_STATUS VARCHAR,
            ZIP_CODE VARCHAR,
            CITY VARCHAR,
            COUNTY_NAME VARCHAR,
            HEALTH_SCORE FLOAT
        )
    """,
    'CUSTOMERS_MASTER_DATA': """
        CREATE TABLE IF NOT EXISTS {schema}.CUSTOMERS_MASTER_DATA (
            CUSTOMER_ID VARCHAR,
            FIRST_NAME VARCHAR,
            LAST_NAME VARCHAR,
            FULL_NAME VARCHAR,
            PRIMARY_METER_ID VARCHAR,
            CUSTOMER_SEGMENT VARCHAR,
            SERVICE_ADDRESS VARCHAR,
            SERVICE_COUNTY VARCHAR,
            PHONE VARCHAR,
            EMAIL VARCHAR,
            ACCOUNT_STATUS VARCHAR,
            SERVICE_START_DATE DATE,
            CREATED_AT TIMESTAMP_NTZ,
            DATA_SOURCE VARCHAR,
            ZIP_CODE NUMBER,
            CITY VARCHAR
        )
    """,
    'AMI_INTERVAL_READINGS': """
        CREATE TABLE IF NOT EXISTS {schema}.AMI_INTERVAL_READINGS (
            METER_ID VARCHAR,
            TIMESTAMP TIMESTAMP_NTZ,
            USAGE_KWH FLOAT,
            VOLTAGE NUMBER,
            POWER_FACTOR NUMBER(23,2),
            CUSTOMER_SEGMENT_ID VARCHAR,
            SOURCE_TABLE VARCHAR
        )
    """,
}

# Mapping of tables to their parquet directories
TABLE_TO_DIR = {
    'SUBSTATIONS': 'reference',
    'CIRCUIT_METADATA': 'reference',
    'TRANSFORMER_METADATA': 'reference',
    'GRID_POLES_INFRASTRUCTURE': 'reference',
    'HOUSTON_WEATHER_HOURLY': 'reference',
    'ERCOT_LMP_HOUSTON_ZONE': 'reference',
    'POWER_QUALITY_READINGS': 'reference',
    'SAP_WORK_ORDERS': 'operational',
    'OUTAGE_EVENTS': 'operational',
    'TECHNICAL_MANUALS_PDF_CHUNKS': 'operational',
    'METER_INFRASTRUCTURE': 'samples',
    'CUSTOMERS_MASTER_DATA': 'samples',
}


def get_connection(args):
    """Create Snowflake connection from args."""
    if args.connection:
        # Use named connection from ~/.snowflake/connections.toml
        logger.info(f"Connecting using named connection: {args.connection}")
        return snowflake.connector.connect(connection_name=args.connection)
    else:
        # Use explicit credentials
        logger.info(f"Connecting to account: {args.account}")
        return snowflake.connector.connect(
            account=args.account,
            user=args.user,
            password=args.password,
            warehouse=args.warehouse or DEFAULT_WAREHOUSE,
            role=args.role or 'ACCOUNTADMIN',
        )


def setup_database(cursor, database, schema):
    """Create database and schema if they don't exist."""
    logger.info(f"Setting up database: {database}.{schema}")
    
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {database}")
    cursor.execute(f"USE DATABASE {database}")
    cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
    cursor.execute(f"USE SCHEMA {schema}")
    
    logger.info(f"Database {database}.{schema} ready")


def create_tables(cursor, schema):
    """Create all tables."""
    logger.info("Creating tables...")
    
    for table_name, ddl in TABLE_DDLS.items():
        try:
            cursor.execute(ddl.format(schema=schema))
            logger.info(f"  Created/verified: {table_name}")
        except Exception as e:
            logger.error(f"  Failed to create {table_name}: {e}")


def load_parquet_files(conn, cursor, schema, seed_data_dir, table_name):
    """Load parquet files for a specific table."""
    subdir = TABLE_TO_DIR.get(table_name)
    if not subdir:
        logger.warning(f"No directory mapping for {table_name}")
        return 0
    
    # Find parquet files matching this table
    parquet_dir = seed_data_dir / subdir
    if not parquet_dir.exists():
        logger.warning(f"Directory not found: {parquet_dir}")
        return 0
    
    # Match files by table name pattern
    table_pattern = table_name.lower().replace('_', '_')
    parquet_files = list(parquet_dir.glob(f"{table_pattern}*.parquet"))
    
    if not parquet_files:
        # Try alternate patterns
        alt_patterns = {
            'METER_INFRASTRUCTURE': 'meter_infrastructure_10k',
            'CUSTOMERS_MASTER_DATA': 'customers_master_data_10k',
        }
        if table_name in alt_patterns:
            parquet_files = list(parquet_dir.glob(f"{alt_patterns[table_name]}*.parquet"))
    
    if not parquet_files:
        logger.warning(f"No parquet files found for {table_name} in {parquet_dir}")
        return 0
    
    total_rows = 0
    for pq_file in sorted(parquet_files):
        try:
            df = pd.read_parquet(pq_file)
            
            # Write to Snowflake
            success, num_chunks, num_rows, _ = write_pandas(
                conn=conn,
                df=df,
                table_name=table_name,
                schema=schema,
                quote_identifiers=False,
            )
            
            if success:
                total_rows += len(df)
                logger.info(f"    Loaded {pq_file.name}: {len(df):,} rows")
            else:
                logger.error(f"    Failed to load {pq_file.name}")
                
        except Exception as e:
            logger.error(f"    Error loading {pq_file.name}: {e}")
    
    return total_rows


def verify_counts(cursor, schema):
    """Verify loaded row counts."""
    logger.info("\nVerifying row counts...")
    
    results = []
    for table_name, expected in EXPECTED_COUNTS.items():
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {schema}.{table_name}")
            actual = cursor.fetchone()[0]
            status = "OK" if actual >= expected * 0.9 else "WARN"  # Allow 10% variance
            results.append((table_name, expected, actual, status))
            logger.info(f"  {table_name}: {actual:,} rows (expected: {expected:,}) [{status}]")
        except Exception as e:
            results.append((table_name, expected, 0, "ERROR"))
            logger.error(f"  {table_name}: ERROR - {e}")
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description='Load FLUX Ops Center seed data into Snowflake',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Using named connection from ~/.snowflake/connections.toml
    python load_seed_data.py --connection my_connection

    # Using explicit credentials
    python load_seed_data.py --account xy12345.us-east-1 --user admin --password secret

    # Specify custom database/schema
    python load_seed_data.py --connection my_conn --database MY_DB --schema MY_SCHEMA
        """
    )
    
    # Connection options
    conn_group = parser.add_argument_group('Connection')
    conn_group.add_argument('--connection', '-c', help='Named connection from connections.toml')
    conn_group.add_argument('--account', '-a', help='Snowflake account identifier')
    conn_group.add_argument('--user', '-u', help='Snowflake username')
    conn_group.add_argument('--password', '-p', help='Snowflake password')
    conn_group.add_argument('--warehouse', '-w', help=f'Warehouse (default: {DEFAULT_WAREHOUSE})')
    conn_group.add_argument('--role', '-r', help='Role (default: ACCOUNTADMIN)')
    
    # Target options
    target_group = parser.add_argument_group('Target')
    target_group.add_argument('--database', '-d', default=DEFAULT_DATABASE,
                             help=f'Target database (default: {DEFAULT_DATABASE})')
    target_group.add_argument('--schema', '-s', default=DEFAULT_SCHEMA,
                             help=f'Target schema (default: {DEFAULT_SCHEMA})')
    
    # Other options
    parser.add_argument('--skip-create', action='store_true',
                       help='Skip database/table creation (load only)')
    parser.add_argument('--tables', nargs='+',
                       help='Specific tables to load (default: all)')
    parser.add_argument('--verify-only', action='store_true',
                       help='Only verify existing data, do not load')
    
    args = parser.parse_args()
    
    # Validate args
    if not args.connection and not (args.account and args.user):
        parser.error("Either --connection or --account/--user/--password required")
    
    if not DEPENDENCIES_AVAILABLE:
        sys.exit(1)
    
    # Find seed data directory
    script_dir = Path(__file__).parent
    seed_data_dir = script_dir
    
    if not (seed_data_dir / 'reference').exists():
        logger.error(f"Seed data not found in {seed_data_dir}")
        logger.error("Expected subdirectories: reference/, operational/, samples/")
        sys.exit(1)
    
    logger.info("=" * 60)
    logger.info("FLUX Ops Center - Seed Data Loader")
    logger.info("=" * 60)
    logger.info(f"Seed data directory: {seed_data_dir}")
    logger.info(f"Target: {args.database}.{args.schema}")
    logger.info("")
    
    try:
        # Connect to Snowflake
        conn = get_connection(args)
        cursor = conn.cursor()
        
        if not args.verify_only:
            # Setup database and schema
            if not args.skip_create:
                setup_database(cursor, args.database, args.schema)
                create_tables(cursor, args.schema)
            else:
                cursor.execute(f"USE DATABASE {args.database}")
                cursor.execute(f"USE SCHEMA {args.schema}")
            
            # Determine which tables to load
            tables_to_load = args.tables if args.tables else list(TABLE_TO_DIR.keys())
            
            # Load data
            logger.info("\nLoading parquet files...")
            for table_name in tables_to_load:
                logger.info(f"  Loading {table_name}...")
                rows = load_parquet_files(conn, cursor, args.schema, seed_data_dir, table_name)
                if rows > 0:
                    logger.info(f"    Total: {rows:,} rows loaded")
        
        # Verify counts
        cursor.execute(f"USE DATABASE {args.database}")
        cursor.execute(f"USE SCHEMA {args.schema}")
        verify_counts(cursor, args.schema)
        
        logger.info("\n" + "=" * 60)
        logger.info("Seed data loading complete!")
        logger.info("=" * 60)
        logger.info("\nNext steps:")
        logger.info("1. Run scripts/views/01_semantic_model_views.sql")
        logger.info("2. Run scripts/views/02_utility_views.sql")
        logger.info("3. Deploy Flux Data Forge to generate AMI readings")
        logger.info("4. Deploy Flux Ops Center application")
        
    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()


if __name__ == '__main__':
    main()
