#!/usr/bin/env python3
"""
Engineering: Enrich meters in Postgres cache with customer data from Snowflake
- Single-family meters: Show customer name + count of 1
- Multi-family meters: Show property name + actual customer count
"""
import snowflake.connector
import psycopg2
from io import StringIO
import os
import time

def enrich_meters():
    print("🔄 Engineering: Enriching meters with customer data...\n")
    start = time.time()
    
    # Connect to Snowflake
    print("Step 1: Fetching customer-meter mappings from Snowflake...")
    sf_conn = snowflake.connector.connect(
        connection_name=os.getenv('SNOWFLAKE_CONNECTION_NAME', 'cpe_demo_CLI')
    )
    sf_cursor = sf_conn.cursor()
    
    # Get customer data with actual customer count per meter
    # For multi-family: aggregate to show count + property name
    # For single-family: show individual customer name
    sf_cursor.execute("""
        WITH meter_counts AS (
            SELECT 
                PRIMARY_METER_ID,
                COUNT(*) as customer_count
            FROM SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA
            WHERE PRIMARY_METER_ID IS NOT NULL
            GROUP BY PRIMARY_METER_ID
        ),
        meter_details AS (
            SELECT 
                c.PRIMARY_METER_ID,
                mc.customer_count,
                -- For multi-family (count > 1): use first customer as property rep
                -- For single-family: use actual customer name
                FIRST_VALUE(c.FULL_NAME) OVER (
                    PARTITION BY c.PRIMARY_METER_ID 
                    ORDER BY c.CREATED_AT DESC
                ) as customer_name,
                FIRST_VALUE(c.CUSTOMER_SEGMENT) OVER (
                    PARTITION BY c.PRIMARY_METER_ID 
                    ORDER BY c.CREATED_AT DESC
                ) as customer_segment,
                FIRST_VALUE(c.SERVICE_ADDRESS) OVER (
                    PARTITION BY c.PRIMARY_METER_ID 
                    ORDER BY c.CREATED_AT DESC
                ) as service_address,
                ROW_NUMBER() OVER (PARTITION BY c.PRIMARY_METER_ID ORDER BY c.CREATED_AT DESC) as rn
            FROM SI_DEMOS.PRODUCTION.CUSTOMERS_MASTER_DATA c
            JOIN meter_counts mc ON c.PRIMARY_METER_ID = mc.PRIMARY_METER_ID
            WHERE c.FULL_NAME IS NOT NULL
        )
        SELECT 
            PRIMARY_METER_ID,
            customer_name,
            customer_segment,
            service_address,
            customer_count
        FROM meter_details
        WHERE rn = 1
    """)
    
    customer_data = sf_cursor.fetchall()
    print(f"✓ Fetched {len(customer_data):,} meter enrichment records")
    
    # Stats
    single_family = sum(1 for r in customer_data if r[4] == 1)
    multi_family = len(customer_data) - single_family
    print(f"   - Single-family meters: {single_family:,}")
    print(f"   - Multi-family meters: {multi_family:,}")
    
    sf_cursor.close()
    sf_conn.close()
    
    # Connect to Postgres
    print("\nStep 2: Loading customer data into temp table...")
    pg_conn = psycopg2.connect(
        host='<your_postgres_host>',
        port=5432,
        database='postgres',
        user='application',
        password='<REDACTED_PASSWORD>',
        sslmode='require'
    )
    pg_cursor = pg_conn.cursor()
    
    # Create temp table
    pg_cursor.execute("""
        DROP TABLE IF EXISTS customer_enrichment;
        CREATE TEMP TABLE customer_enrichment (
            meter_id TEXT PRIMARY KEY,
            customer_name VARCHAR(200),
            customer_segment VARCHAR(50),
            service_address VARCHAR(200),
            customer_count INTEGER
        )
    """)
    
    # Bulk load via COPY
    buffer = StringIO()
    for row in customer_data:
        meter_id, name, segment, address, count = row
        def escape(val):
            if val is None:
                return '\\N'
            return str(val).replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
        buffer.write(f"{escape(meter_id)}\t{escape(name)}\t{escape(segment)}\t{escape(address)}\t{count}\n")
    
    buffer.seek(0)
    pg_cursor.copy_from(buffer, 'customer_enrichment', sep='\t', null='\\N',
                        columns=['meter_id', 'customer_name', 'customer_segment', 'service_address', 'customer_count'])
    print(f"✓ Loaded {len(customer_data):,} rows into temp table")
    
    # Bulk update via JOIN - now with actual customer count
    print("\nStep 3: Updating meters via bulk JOIN...")
    pg_cursor.execute("""
        UPDATE grid_assets_cache g
        SET customer_name = c.customer_name,
            customer_segment = c.customer_segment,
            service_address = c.service_address,
            connected_customers = c.customer_count
        FROM customer_enrichment c
        WHERE g.asset_id = c.meter_id
        AND g.asset_type = 'meter'
    """)
    updated = pg_cursor.rowcount
    pg_conn.commit()
    print(f"✓ Updated {updated:,} meters")
    
    # Verify
    print("\nStep 4: Verifying enrichment...")
    pg_cursor.execute("""
        SELECT 
            CASE 
                WHEN connected_customers = 1 THEN 'Single-family'
                WHEN connected_customers BETWEEN 2 AND 10 THEN 'Small multi-family (2-10)'
                WHEN connected_customers BETWEEN 11 AND 50 THEN 'Medium multi-family (11-50)'
                ELSE 'Large multi-family (50+)'
            END as category,
            COUNT(*) as meter_count
        FROM grid_assets_cache 
        WHERE asset_type = 'meter' AND connected_customers IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
    """)
    print("\n📊 Meter distribution by customer count:")
    for row in pg_cursor.fetchall():
        print(f"   - {row[0]}: {row[1]:,}")
    
    # Sample multi-family meters
    pg_cursor.execute("""
        SELECT asset_id, customer_name, customer_segment, service_address, connected_customers
        FROM grid_assets_cache 
        WHERE asset_type = 'meter' AND connected_customers > 1
        ORDER BY connected_customers DESC
        LIMIT 3
    """)
    print(f"\n📋 Sample multi-family meters:")
    for row in pg_cursor.fetchall():
        print(f"   - {row[0]}: {row[4]} customers @ {row[3]} ({row[2]})")
    
    elapsed = time.time() - start
    print(f"\n✅ Enrichment complete in {elapsed:.1f}s")
    
    pg_cursor.close()
    pg_conn.close()

if __name__ == '__main__':
    enrich_meters()
