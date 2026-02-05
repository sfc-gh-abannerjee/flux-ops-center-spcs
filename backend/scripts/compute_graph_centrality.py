#!/usr/bin/env python3
"""
Engineering: Compute True Graph Centrality Metrics
=====================================================

This script computes actual graph centrality metrics using NetworkX,
resolving the compromise of using proxy metadata instead of true graph algorithms.

Metrics computed:
- Degree centrality (exact)
- Betweenness centrality (approximation for large graphs)
- Closeness centrality (approximation)
- PageRank (eigenvector-based importance)
- Clustering coefficient (local connectivity)

The results are written back to Snowflake for use in GNN training and
cascade failure prediction.
"""

import os
import sys
import time
import numpy as np
import pandas as pd
import networkx as nx
from concurrent.futures import ThreadPoolExecutor, as_completed
from snowflake.snowpark import Session

# Import centralized configuration
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB, WAREHOUSE, CONNECTION, SCHEMA_ML_DEMO, SCHEMA_CASCADE_ANALYSIS

# Configuration
CONNECTION_NAME = CONNECTION
BATCH_SIZE = 10000  # For parallel processing
BETWEENNESS_SAMPLE_SIZE = 500  # Sample nodes for betweenness approximation


def create_session():
    """Create Snowflake session using connection name."""
    session = Session.builder.config("connection_name", CONNECTION_NAME).create()
    # Set default database and schema context
    session.sql(f"USE DATABASE {DB}").collect()
    session.sql(f"USE SCHEMA {SCHEMA_CASCADE_ANALYSIS}").collect()
    session.sql(f"USE WAREHOUSE {WAREHOUSE}").collect()
    return session


def load_grid_data(session):
    """Load grid nodes and edges from Snowflake."""
    print("Loading grid nodes...")
    nodes_df = session.sql(f"""
        SELECT 
            NODE_ID,
            NODE_NAME,
            NODE_TYPE,
            LAT,
            LON,
            CAPACITY_KW,
            VOLTAGE_KV,
            CRITICALITY_SCORE,
            DOWNSTREAM_TRANSFORMERS,
            DOWNSTREAM_CAPACITY_KVA
        FROM {DB}.{SCHEMA_ML_DEMO}.GRID_NODES
        WHERE LAT IS NOT NULL AND LON IS NOT NULL
    """).to_pandas()
    print(f"  Loaded {len(nodes_df)} nodes")
    
    print("Loading grid edges...")
    edges_df = session.sql(f"""
        SELECT 
            EDGE_ID,
            FROM_NODE_ID,
            TO_NODE_ID,
            EDGE_TYPE,
            DISTANCE_KM,
            IMPEDANCE_PU
        FROM {DB}.{SCHEMA_ML_DEMO}.GRID_EDGES
    """).to_pandas()
    print(f"  Loaded {len(edges_df)} edges")
    
    return nodes_df, edges_df


def build_networkx_graph(nodes_df, edges_df):
    """Build NetworkX graph from node and edge dataframes."""
    print("\nBuilding NetworkX graph...")
    
    G = nx.Graph()
    
    # Add nodes with attributes
    for _, row in nodes_df.iterrows():
        G.add_node(
            row['NODE_ID'],
            node_type=row['NODE_TYPE'],
            capacity_kw=row['CAPACITY_KW'] or 0,
            voltage_kv=row['VOLTAGE_KV'] or 0,
            criticality=row['CRITICALITY_SCORE'] or 0,
            downstream_transformers=row['DOWNSTREAM_TRANSFORMERS'] or 0,
            lat=row['LAT'],
            lon=row['LON']
        )
    
    # Add edges with weights (inverse distance for path-based metrics)
    valid_nodes = set(nodes_df['NODE_ID'])
    edge_count = 0
    for _, row in edges_df.iterrows():
        from_node = row['FROM_NODE_ID']
        to_node = row['TO_NODE_ID']
        
        if from_node in valid_nodes and to_node in valid_nodes:
            # Weight = inverse of distance (closer = higher weight for connectivity)
            distance = row['DISTANCE_KM'] or 1.0
            weight = 1.0 / max(distance, 0.01)
            
            G.add_edge(
                from_node, 
                to_node,
                weight=weight,
                distance_km=distance,
                edge_type=row['EDGE_TYPE']
            )
            edge_count += 1
    
    print(f"  Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    print(f"  Connected: {nx.is_connected(G)}")
    
    if not nx.is_connected(G):
        # Get largest connected component
        largest_cc = max(nx.connected_components(G), key=len)
        print(f"  Largest connected component: {len(largest_cc)} nodes")
        G = G.subgraph(largest_cc).copy()
    
    return G


def compute_centrality_metrics(G, sample_size=BETWEENNESS_SAMPLE_SIZE):
    """Compute various centrality metrics."""
    metrics = {}
    
    # 1. Degree Centrality (exact, O(n))
    print("\nComputing degree centrality...")
    start = time.time()
    metrics['degree'] = nx.degree_centrality(G)
    print(f"  Completed in {time.time() - start:.2f}s")
    
    # 2. Betweenness Centrality (approximated via k-sampling)
    print(f"Computing betweenness centrality (k={sample_size} samples)...")
    start = time.time()
    # Use approximation for large graphs
    if G.number_of_nodes() > 1000:
        metrics['betweenness'] = nx.betweenness_centrality(
            G, 
            k=min(sample_size, G.number_of_nodes()),
            normalized=True,
            weight='weight'
        )
    else:
        metrics['betweenness'] = nx.betweenness_centrality(G, normalized=True, weight='weight')
    print(f"  Completed in {time.time() - start:.2f}s")
    
    # 3. Closeness Centrality (can be slow, use sampling if needed)
    print("Computing closeness centrality...")
    start = time.time()
    if G.number_of_nodes() > 5000:
        # For very large graphs, compute for a sample
        sample_nodes = list(G.nodes())[:2000]
        closeness_partial = {}
        for node in sample_nodes:
            try:
                closeness_partial[node] = nx.closeness_centrality(G, u=node)
            except:
                closeness_partial[node] = 0.0
        # Fill in zeros for non-sampled nodes
        metrics['closeness'] = {n: closeness_partial.get(n, 0.0) for n in G.nodes()}
    else:
        metrics['closeness'] = nx.closeness_centrality(G)
    print(f"  Completed in {time.time() - start:.2f}s")
    
    # 4. PageRank (eigenvector-based, efficient)
    print("Computing PageRank...")
    start = time.time()
    metrics['pagerank'] = nx.pagerank(G, weight='weight', max_iter=100)
    print(f"  Completed in {time.time() - start:.2f}s")
    
    # 5. Clustering Coefficient (local connectivity)
    print("Computing clustering coefficient...")
    start = time.time()
    metrics['clustering'] = nx.clustering(G)
    print(f"  Completed in {time.time() - start:.2f}s")
    
    # 6. Eigenvector Centrality (can fail on disconnected graphs)
    print("Computing eigenvector centrality...")
    start = time.time()
    try:
        metrics['eigenvector'] = nx.eigenvector_centrality(G, max_iter=500, weight='weight')
    except nx.PowerIterationFailedConvergence:
        print("  Warning: Eigenvector centrality did not converge, using PageRank as proxy")
        metrics['eigenvector'] = metrics['pagerank']
    print(f"  Completed in {time.time() - start:.2f}s")
    
    return metrics


def compute_neighborhood_reach(G, max_hops=3):
    """Compute k-hop neighborhood size for each node."""
    print(f"\nComputing {max_hops}-hop neighborhood reach...")
    start = time.time()
    
    reach = {}
    nodes = list(G.nodes())
    
    for i, node in enumerate(nodes):
        if i % 1000 == 0:
            print(f"  Processing node {i}/{len(nodes)}...")
        
        # BFS to find k-hop neighborhood
        hop_counts = {0: 1}  # Distance 0 is just the node itself
        visited = {node}
        frontier = {node}
        
        for hop in range(1, max_hops + 1):
            next_frontier = set()
            for n in frontier:
                for neighbor in G.neighbors(n):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        next_frontier.add(neighbor)
            hop_counts[hop] = len(next_frontier)
            frontier = next_frontier
            
            if not frontier:
                break
        
        reach[node] = {
            'neighbors_1hop': hop_counts.get(1, 0),
            'neighbors_2hop': hop_counts.get(2, 0),
            'neighbors_3hop': hop_counts.get(3, 0),
            'total_reach': sum(hop_counts.values()) - 1,  # Exclude self
        }
    
    print(f"  Completed in {time.time() - start:.2f}s")
    return reach


def build_centrality_dataframe(nodes_df, metrics, reach):
    """Combine all metrics into a single dataframe."""
    print("\nBuilding centrality features dataframe...")
    
    records = []
    for _, row in nodes_df.iterrows():
        node_id = row['NODE_ID']
        
        # Skip nodes not in graph (disconnected)
        if node_id not in metrics['degree']:
            continue
        
        node_reach = reach.get(node_id, {})
        
        records.append({
            'NODE_ID': node_id,
            'NODE_TYPE': row['NODE_TYPE'],
            'CAPACITY_KW': row['CAPACITY_KW'],
            'VOLTAGE_KV': row['VOLTAGE_KV'],
            'CRITICALITY_SCORE': row['CRITICALITY_SCORE'],
            # True centrality metrics
            'DEGREE_CENTRALITY': metrics['degree'].get(node_id, 0),
            'BETWEENNESS_CENTRALITY': metrics['betweenness'].get(node_id, 0),
            'CLOSENESS_CENTRALITY': metrics['closeness'].get(node_id, 0),
            'PAGERANK': metrics['pagerank'].get(node_id, 0),
            'CLUSTERING_COEFFICIENT': metrics['clustering'].get(node_id, 0),
            'EIGENVECTOR_CENTRALITY': metrics['eigenvector'].get(node_id, 0),
            # Neighborhood reach
            'NEIGHBORS_1HOP': node_reach.get('neighbors_1hop', 0),
            'NEIGHBORS_2HOP': node_reach.get('neighbors_2hop', 0),
            'NEIGHBORS_3HOP': node_reach.get('neighbors_3hop', 0),
            'TOTAL_REACH': node_reach.get('total_reach', 0),
            # Derived features
            'REACH_EXPANSION_RATIO': (
                node_reach.get('neighbors_2hop', 0) / max(node_reach.get('neighbors_1hop', 1), 1)
            ),
            # Combined cascade risk score using true metrics
            'CASCADE_RISK_SCORE': (
                row['CRITICALITY_SCORE'] * 0.25 +
                metrics['betweenness'].get(node_id, 0) * 0.25 +
                metrics['pagerank'].get(node_id, 0) * 100 * 0.20 +  # Scale up PageRank
                metrics['degree'].get(node_id, 0) * 0.15 +
                metrics['eigenvector'].get(node_id, 0) * 0.15
            )
        })
    
    df = pd.DataFrame(records)
    
    # Engineering: Normalize CASCADE_RISK_SCORE to 0-1 range for proper percentage display
    # Raw scores can exceed 1.0 due to combining multiple metrics
    max_risk = df['CASCADE_RISK_SCORE'].max()
    df['CASCADE_RISK_SCORE_NORMALIZED'] = df['CASCADE_RISK_SCORE'] / max_risk if max_risk > 0 else 0
    
    print(f"  Created dataframe with {len(df)} nodes and {len(df.columns)} features")
    print(f"  CASCADE_RISK_SCORE range: {df['CASCADE_RISK_SCORE'].min():.4f} - {df['CASCADE_RISK_SCORE'].max():.4f}")
    print(f"  Normalized range: {df['CASCADE_RISK_SCORE_NORMALIZED'].min():.4f} - {df['CASCADE_RISK_SCORE_NORMALIZED'].max():.4f}")
    
    return df


def write_to_snowflake(session, df):
    """Write centrality features back to Snowflake."""
    print("\nWriting centrality features to Snowflake...")
    
    # Create Snowpark DataFrame and write
    snowpark_df = session.create_dataframe(df)
    
    # Write to table (overwrite)
    table_name = f"{DB}.{SCHEMA_CASCADE_ANALYSIS}.NODE_CENTRALITY_FEATURES_V2"
    snowpark_df.write.mode("overwrite").save_as_table(table_name)
    
    print(f"  Written to {table_name}")
    
    # Drop existing table to create view (if it exists as table)
    try:
        session.sql(f"""
            DROP TABLE IF EXISTS {DB}.{SCHEMA_CASCADE_ANALYSIS}.NODE_CENTRALITY_FEATURES
        """).collect()
    except:
        pass
    
    # Create view for backward compatibility
    try:
        session.sql(f"""
            CREATE OR REPLACE VIEW {DB}.{SCHEMA_CASCADE_ANALYSIS}.NODE_CENTRALITY_FEATURES AS
            SELECT * FROM {DB}.{SCHEMA_CASCADE_ANALYSIS}.NODE_CENTRALITY_FEATURES_V2
        """).collect()
        print(f"  Updated VIEW {DB}.{SCHEMA_CASCADE_ANALYSIS}.NODE_CENTRALITY_FEATURES")
    except Exception as e:
        print(f"  Note: Could not create view (may already exist as table): {e}")


def print_top_cascade_risks(df, n=10):
    """Print top nodes by cascade risk score."""
    print(f"\n{'='*70}")
    print("TOP {n} CASCADE RISK NODES (True Graph Centrality)")
    print('='*70)
    
    top_nodes = df.nlargest(n, 'CASCADE_RISK_SCORE')
    
    for i, (_, row) in enumerate(top_nodes.iterrows(), 1):
        print(f"\n{i}. {row['NODE_ID']}")
        print(f"   Type: {row['NODE_TYPE']}")
        print(f"   Cascade Risk Score: {row['CASCADE_RISK_SCORE']:.4f}")
        print(f"   Betweenness: {row['BETWEENNESS_CENTRALITY']:.6f}")
        print(f"   PageRank: {row['PAGERANK']:.6f}")
        print(f"   Degree: {row['DEGREE_CENTRALITY']:.4f}")
        print(f"   1-hop neighbors: {row['NEIGHBORS_1HOP']}")
        print(f"   Total reach: {row['TOTAL_REACH']}")


def main():
    """Main execution flow."""
    print("="*70)
    print("ENGINEERING: TRUE GRAPH CENTRALITY COMPUTATION")
    print("="*70)
    
    total_start = time.time()
    
    # Connect to Snowflake
    print(f"\nConnecting to Snowflake (connection: {CONNECTION_NAME})...")
    session = create_session()
    print(f"  Connected to: {session.get_current_account()}")
    
    # Load data
    nodes_df, edges_df = load_grid_data(session)
    
    # Build graph
    G = build_networkx_graph(nodes_df, edges_df)
    
    # Compute centrality metrics
    metrics = compute_centrality_metrics(G)
    
    # Compute neighborhood reach
    reach = compute_neighborhood_reach(G, max_hops=3)
    
    # Build combined dataframe
    centrality_df = build_centrality_dataframe(nodes_df, metrics, reach)
    
    # Write to Snowflake
    write_to_snowflake(session, centrality_df)
    
    # Print summary
    print_top_cascade_risks(centrality_df)
    
    total_time = time.time() - total_start
    print(f"\n{'='*70}")
    print(f"COMPLETED in {total_time:.1f} seconds")
    print(f"{'='*70}")
    
    session.close()
    return centrality_df


if __name__ == "__main__":
    main()
