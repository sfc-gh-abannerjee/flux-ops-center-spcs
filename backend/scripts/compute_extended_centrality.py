#!/usr/bin/env python3
"""
Extended Graph Centrality Computation
======================================

Computes graph centrality metrics for the FULL grid hierarchy:
- Substations (275)
- Transformers (91,554)
- Poles (62,038)
- Meters (596,906)

Total: ~750K nodes

Uses memory-efficient algorithms suitable for large-scale graphs:
- Approximate betweenness centrality (k-sampling)
- PageRank with sparse matrix operations
- Degree centrality (O(n) complexity)

For production deployment, consider using Snowflake's Online Feature Store
to serve these features with 30ms latency.

Author: Cortex Code
Date: 2026-02-06
"""

import os
import sys
import time
import logging
from typing import Dict, Optional
import numpy as np

# Add parent directory for config import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB, CONNECTION

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s'
)
logger = logging.getLogger(__name__)


def compute_extended_centrality(
    connection_name: str = CONNECTION,
    database: str = DB,
    sample_size: int = 5000,
    batch_size: int = 50000
) -> Dict[str, int]:
    """
    Compute centrality metrics for the extended grid hierarchy.
    
    Args:
        connection_name: Snowflake connection name
        database: Database name
        sample_size: Number of nodes for betweenness approximation
        batch_size: Batch size for database writes
        
    Returns:
        Dict with counts of processed nodes by type
    """
    try:
        import networkx as nx
        from snowflake.snowpark import Session
    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        logger.error("Install: pip install networkx snowflake-snowpark-python")
        return {}
    
    start_time = time.time()
    
    # Create Snowflake session
    logger.info(f"Connecting to Snowflake ({connection_name})...")
    session = Session.builder.config("connection_name", connection_name).create()
    session.sql(f"USE DATABASE {database}").collect()
    session.sql(f"USE WAREHOUSE FLUX_WH").collect()
    
    # =========================================================================
    # STEP 1: Load Extended Topology
    # =========================================================================
    logger.info("Loading extended grid topology...")
    
    # Check if extended tables exist, fall back to original
    try:
        nodes_df = session.sql("""
            SELECT NODE_ID, NODE_TYPE, HIERARCHY_LEVEL, CRITICALITY_SCORE
            FROM ML_DEMO.GRID_NODES_EXTENDED
        """).to_pandas()
        
        edges_df = session.sql("""
            SELECT SOURCE_NODE_ID as FROM_NODE_ID, TARGET_NODE_ID as TO_NODE_ID, DISTANCE_KM, EDGE_TYPE
            FROM ML_DEMO.GRID_EDGES_EXTENDED
        """).to_pandas()
        logger.info("Using extended topology tables")
    except Exception:
        logger.warning("Extended tables not found, using original topology")
        nodes_df = session.sql("""
            SELECT NODE_ID, NODE_TYPE, 
                   CASE NODE_TYPE WHEN 'SUBSTATION' THEN 1 ELSE 2 END as HIERARCHY_LEVEL,
                   CRITICALITY_SCORE
            FROM ML_DEMO.GRID_NODES
        """).to_pandas()
        
        edges_df = session.sql("""
            SELECT FROM_NODE_ID, TO_NODE_ID, DISTANCE_KM, EDGE_TYPE
            FROM ML_DEMO.GRID_EDGES
        """).to_pandas()
    
    node_count = len(nodes_df)
    edge_count = len(edges_df)
    logger.info(f"Loaded {node_count:,} nodes and {edge_count:,} edges")
    
    # Log breakdown by type
    type_counts = nodes_df['NODE_TYPE'].value_counts()
    for node_type, count in type_counts.items():
        logger.info(f"  {node_type}: {count:,}")
    
    # =========================================================================
    # STEP 2: Build NetworkX Graph
    # =========================================================================
    logger.info("Building NetworkX graph...")
    
    G = nx.Graph()
    
    # Add nodes with attributes
    for _, row in nodes_df.iterrows():
        G.add_node(
            row['NODE_ID'],
            node_type=row['NODE_TYPE'],
            hierarchy_level=row['HIERARCHY_LEVEL'],
            criticality=row['CRITICALITY_SCORE'] if row['CRITICALITY_SCORE'] else 0
        )
    
    # Add edges with weights
    for _, row in edges_df.iterrows():
        from_node = row['FROM_NODE_ID']
        to_node = row['TO_NODE_ID']
        if from_node in G and to_node in G:
            distance = row['DISTANCE_KM'] if row['DISTANCE_KM'] else 1.0
            G.add_edge(from_node, to_node, weight=max(distance, 0.001))
    
    logger.info(f"Graph built: {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")
    
    # =========================================================================
    # STEP 3: Compute Centrality Metrics
    # =========================================================================
    
    # 3.1 Degree Centrality (fast, O(n))
    logger.info("Computing degree centrality...")
    t0 = time.time()
    degree_centrality = nx.degree_centrality(G)
    logger.info(f"  Completed in {time.time() - t0:.1f}s")
    
    # 3.2 PageRank (fast for sparse graphs)
    logger.info("Computing PageRank...")
    t0 = time.time()
    pagerank = nx.pagerank(G, alpha=0.85, max_iter=100)
    logger.info(f"  Completed in {time.time() - t0:.1f}s")
    
    # 3.3 Betweenness Centrality (approximate for large graphs)
    logger.info(f"Computing betweenness centrality (k={sample_size} sample)...")
    t0 = time.time()
    
    # For graphs > 10K nodes, use k-sampling approximation
    if node_count > 10000:
        k = min(sample_size, node_count)
        betweenness = nx.betweenness_centrality(G, k=k, normalized=True)
        logger.info(f"  Using k-sampling approximation (k={k})")
    else:
        betweenness = nx.betweenness_centrality(G, normalized=True)
    
    logger.info(f"  Completed in {time.time() - t0:.1f}s")
    
    # 3.4 Compute downstream customer count (for cascade impact)
    logger.info("Computing downstream customer counts...")
    downstream_customers = {}
    
    # Count meters downstream of each node using BFS
    meter_nodes = set(nodes_df[nodes_df['NODE_TYPE'] == 'METER']['NODE_ID'])
    
    for node_id in G.nodes():
        if node_id in meter_nodes:
            downstream_customers[node_id] = 1
        else:
            # BFS to count reachable meters
            # For efficiency, we use hierarchy: substations affect all downstream
            node_type = G.nodes[node_id].get('node_type', '')
            if node_type == 'SUBSTATION':
                # Count all transformers * avg meters per transformer
                downstream_customers[node_id] = len(meter_nodes) // 275  # Rough estimate
            elif node_type == 'TRANSFORMER':
                # Count connected meters
                neighbors = set(nx.single_source_shortest_path_length(G, node_id, cutoff=2).keys())
                downstream_customers[node_id] = len(neighbors & meter_nodes)
            elif node_type == 'POLE':
                neighbors = set(nx.single_source_shortest_path_length(G, node_id, cutoff=1).keys())
                downstream_customers[node_id] = len(neighbors & meter_nodes)
            else:
                downstream_customers[node_id] = 0
    
    # 3.5 Compute Cascade Risk Score (weighted combination)
    logger.info("Computing cascade risk scores...")
    cascade_risk = {}
    
    # Normalize each metric to 0-1 range
    max_betweenness = max(betweenness.values()) if betweenness else 1
    max_pagerank = max(pagerank.values()) if pagerank else 1
    max_degree = max(degree_centrality.values()) if degree_centrality else 1
    max_downstream = max(downstream_customers.values()) if downstream_customers else 1
    
    for node_id in G.nodes():
        node_type = G.nodes[node_id].get('node_type', '')
        criticality = G.nodes[node_id].get('criticality', 0)
        
        # Weighted combination based on node type
        if node_type == 'SUBSTATION':
            # Substations: high weight on downstream impact
            weights = {'betweenness': 0.3, 'pagerank': 0.2, 'downstream': 0.4, 'criticality': 0.1}
        elif node_type == 'TRANSFORMER':
            # Transformers: balance betweenness and downstream
            weights = {'betweenness': 0.35, 'pagerank': 0.25, 'downstream': 0.3, 'criticality': 0.1}
        elif node_type == 'POLE':
            # Poles: focus on network position
            weights = {'betweenness': 0.4, 'pagerank': 0.3, 'downstream': 0.2, 'criticality': 0.1}
        else:  # METER
            # Meters: minimal cascade risk (endpoints)
            weights = {'betweenness': 0.1, 'pagerank': 0.1, 'downstream': 0.0, 'criticality': 0.8}
        
        score = (
            weights['betweenness'] * (betweenness.get(node_id, 0) / max_betweenness) +
            weights['pagerank'] * (pagerank.get(node_id, 0) / max_pagerank) +
            weights['downstream'] * (downstream_customers.get(node_id, 0) / max_downstream) +
            weights['criticality'] * criticality
        )
        cascade_risk[node_id] = min(score, 1.0)  # Cap at 1.0
    
    # =========================================================================
    # STEP 4: Store Results in Snowflake
    # =========================================================================
    logger.info("Storing centrality features in Snowflake...")
    
    # Prepare data for insertion
    results = []
    for node_id in G.nodes():
        node_type = G.nodes[node_id].get('node_type', 'UNKNOWN')
        hierarchy_level = G.nodes[node_id].get('hierarchy_level', 0)
        
        results.append({
            'NODE_ID': node_id,
            'NODE_TYPE': node_type,
            'DEGREE_CENTRALITY': round(degree_centrality.get(node_id, 0), 8),
            'BETWEENNESS_CENTRALITY': round(betweenness.get(node_id, 0), 8),
            'PAGERANK': round(pagerank.get(node_id, 0), 8),
            'EIGENVECTOR_CENTRALITY': 0,  # Skip for large graphs (expensive)
            'CASCADE_RISK_SCORE': round(cascade_risk.get(node_id, 0), 6),
            'DOWNSTREAM_CUSTOMERS': downstream_customers.get(node_id, 0),
            'HIERARCHY_DEPTH': hierarchy_level
        })
    
    # Create DataFrame and write in batches
    import pandas as pd
    results_df = pd.DataFrame(results)
    
    # Create/truncate target table
    session.sql("""
        CREATE OR REPLACE TABLE CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED (
            NODE_ID VARCHAR(100) PRIMARY KEY,
            NODE_TYPE VARCHAR(50),
            DEGREE_CENTRALITY FLOAT,
            BETWEENNESS_CENTRALITY FLOAT,
            PAGERANK FLOAT,
            EIGENVECTOR_CENTRALITY FLOAT,
            CASCADE_RISK_SCORE FLOAT,
            DOWNSTREAM_CUSTOMERS INT,
            HIERARCHY_DEPTH INT,
            COMPUTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
    """).collect()
    
    # Write in batches
    total_written = 0
    for i in range(0, len(results_df), batch_size):
        batch = results_df.iloc[i:i+batch_size]
        snowpark_df = session.create_dataframe(batch)
        snowpark_df.write.mode("append").save_as_table(
            "CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED"
        )
        total_written += len(batch)
        logger.info(f"  Written {total_written:,}/{len(results_df):,} rows")
    
    # =========================================================================
    # STEP 5: Summary Statistics
    # =========================================================================
    elapsed = time.time() - start_time
    
    logger.info("=" * 60)
    logger.info("CENTRALITY COMPUTATION COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total nodes processed: {node_count:,}")
    logger.info(f"Total edges processed: {edge_count:,}")
    logger.info(f"Elapsed time: {elapsed:.1f}s")
    logger.info("")
    logger.info("Centrality Statistics:")
    
    # Summary by node type
    summary = session.sql("""
        SELECT 
            NODE_TYPE,
            COUNT(*) as count,
            AVG(CASCADE_RISK_SCORE) as avg_risk,
            MAX(CASCADE_RISK_SCORE) as max_risk,
            AVG(BETWEENNESS_CENTRALITY) as avg_betweenness
        FROM CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES_EXTENDED
        GROUP BY NODE_TYPE
        ORDER BY avg_risk DESC
    """).to_pandas()
    
    for _, row in summary.iterrows():
        logger.info(
            f"  {row['NODE_TYPE']}: {row['COUNT']:,} nodes, "
            f"avg_risk={row['AVG_RISK']:.4f}, max_risk={row['MAX_RISK']:.4f}"
        )
    
    return dict(type_counts)


def main():
    """Main entry point."""
    logger.info("=" * 60)
    logger.info("EXTENDED GRAPH CENTRALITY COMPUTATION")
    logger.info("Substation → Transformer → Pole → Meter")
    logger.info("=" * 60)
    
    counts = compute_extended_centrality(
        sample_size=5000,  # k-sampling for betweenness
        batch_size=50000   # Write batch size
    )
    
    if counts:
        logger.info("\nProcessed node types:")
        for node_type, count in counts.items():
            logger.info(f"  {node_type}: {count:,}")


if __name__ == "__main__":
    main()
