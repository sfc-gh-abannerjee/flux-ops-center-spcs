#!/usr/bin/env python3
"""
Engineering: Real-Time BFS Cascade Simulation
================================================

This module implements actual BFS-based cascade failure simulation,
resolving the compromise of using pre-computed static scenarios.

Key Features:
- True graph traversal using adjacency list
- Failure probability based on distance, load, and scenario parameters
- Wave depth tracking for Sankey diagram visualization
- Dynamic Patient Zero selection based on GNN predictions

Can be used as:
1. Standalone script for batch simulation
2. Import into FastAPI for real-time API endpoint
"""

import os
import time
import json
import sys
import numpy as np
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Set, Tuple, Any
from snowflake.snowpark import Session

# Import centralized configuration
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB, CONNECTION, SCHEMA_ML_DEMO, SCHEMA_CASCADE_ANALYSIS

# Configuration
CONNECTION_NAME = CONNECTION


@dataclass
class CascadeNode:
    """Node in the cascade failure chain."""
    node_id: str
    node_name: str
    node_type: str
    lat: Optional[float]
    lon: Optional[float]
    capacity_kw: float
    voltage_kv: float
    criticality_score: float
    downstream_transformers: int
    order: int = 0
    wave_depth: int = 0
    triggered_by: Optional[str] = None
    failure_probability: float = 0.0


@dataclass
class WaveBreakdown:
    """Statistics for a single cascade wave."""
    wave_number: int
    nodes_failed: int = 0
    capacity_lost_mw: float = 0.0
    customers_affected: int = 0
    substations: int = 0
    transformers: int = 0


@dataclass
class CascadeResult:
    """Complete result of a cascade simulation."""
    scenario_name: str
    patient_zero: CascadeNode
    cascade_order: List[CascadeNode]
    propagation_paths: List[Dict]
    wave_breakdown: List[WaveBreakdown]
    total_affected_nodes: int = 0
    affected_capacity_mw: float = 0.0
    estimated_customers_affected: int = 0
    max_cascade_depth: int = 0
    simulation_timestamp: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        return {
            'scenario_name': self.scenario_name,
            'patient_zero': asdict(self.patient_zero),
            'cascade_order': [asdict(n) for n in self.cascade_order],
            'propagation_paths': self.propagation_paths,
            'wave_breakdown': [asdict(w) for w in self.wave_breakdown],
            'total_affected_nodes': self.total_affected_nodes,
            'affected_capacity_mw': self.affected_capacity_mw,
            'estimated_customers_affected': self.estimated_customers_affected,
            'max_cascade_depth': self.max_cascade_depth,
            'simulation_timestamp': self.simulation_timestamp,
        }


class CascadeSimulator:
    """
    BFS-based cascade failure simulator using actual grid topology.
    
    This replaces the pre-computed static scenarios with real-time
    graph traversal and failure probability calculation.
    """
    
    def __init__(self, session: Optional[Session] = None):
        """Initialize simulator with optional existing session."""
        self.session = session
        self._nodes: Dict[str, Dict] = {}
        self._adjacency: Dict[str, List[Tuple[str, float]]] = {}
        self._centrality: Dict[str, Dict] = {}
        self._loaded = False
    
    def _create_session(self) -> Session:
        """Create Snowflake session if not provided."""
        if self.session is None:
            self.session = Session.builder.config("connection_name", CONNECTION_NAME).create()
        return self.session
    
    def load_topology(self, force_reload: bool = False) -> None:
        """Load grid topology into memory for fast simulation."""
        if self._loaded and not force_reload:
            return
        
        session = self._create_session()
        print("Loading grid topology...")
        
        # Load nodes
        nodes_df = session.sql(f"""
            SELECT 
                n.NODE_ID,
                n.NODE_NAME,
                n.NODE_TYPE,
                n.LAT,
                n.LON,
                n.CAPACITY_KW,
                n.VOLTAGE_KV,
                n.CRITICALITY_SCORE,
                n.DOWNSTREAM_TRANSFORMERS,
                n.DOWNSTREAM_CAPACITY_KVA,
                COALESCE(c.BETWEENNESS_CENTRALITY, 0) as BETWEENNESS,
                COALESCE(c.PAGERANK, 0) as PAGERANK,
                COALESCE(c.CASCADE_RISK_SCORE, n.CRITICALITY_SCORE) as CASCADE_RISK
            FROM {DB}.{SCHEMA_ML_DEMO}.GRID_NODES n
            LEFT JOIN {DB}.{SCHEMA_CASCADE_ANALYSIS}.NODE_CENTRALITY_FEATURES c 
                ON n.NODE_ID = c.NODE_ID
            WHERE n.LAT IS NOT NULL AND n.LON IS NOT NULL
        """).to_pandas()
        
        self._nodes = {
            row['NODE_ID']: {
                'node_id': row['NODE_ID'],
                'node_name': row['NODE_NAME'],
                'node_type': row['NODE_TYPE'],
                'lat': float(row['LAT']) if row['LAT'] else None,
                'lon': float(row['LON']) if row['LON'] else None,
                'capacity_kw': float(row['CAPACITY_KW'] or 0),
                'voltage_kv': float(row['VOLTAGE_KV'] or 0),
                'criticality_score': float(row['CRITICALITY_SCORE'] or 0),
                'downstream_transformers': int(row['DOWNSTREAM_TRANSFORMERS'] or 0),
                'betweenness': float(row['BETWEENNESS'] or 0),
                'pagerank': float(row['PAGERANK'] or 0),
                'cascade_risk': float(row['CASCADE_RISK'] or 0),
            }
            for _, row in nodes_df.iterrows()
        }
        print(f"  Loaded {len(self._nodes)} nodes")
        
        # Load edges and build adjacency list
        edges_df = session.sql(f"""
            SELECT FROM_NODE_ID, TO_NODE_ID, DISTANCE_KM, EDGE_TYPE
            FROM {DB}.{SCHEMA_ML_DEMO}.GRID_EDGES
        """).to_pandas()
        
        self._adjacency = {}
        for _, row in edges_df.iterrows():
            from_node = row['FROM_NODE_ID']
            to_node = row['TO_NODE_ID']
            distance = float(row['DISTANCE_KM'] or 1.0)
            
            # Skip if nodes not in our node set
            if from_node not in self._nodes or to_node not in self._nodes:
                continue
            
            # Add bidirectional edges
            if from_node not in self._adjacency:
                self._adjacency[from_node] = []
            if to_node not in self._adjacency:
                self._adjacency[to_node] = []
            
            self._adjacency[from_node].append((to_node, distance))
            self._adjacency[to_node].append((from_node, distance))
        
        print(f"  Built adjacency list for {len(self._adjacency)} nodes")
        self._loaded = True
    
    def get_high_risk_nodes(self, limit: int = 20) -> List[Dict]:
        """Get top high-risk nodes for Patient Zero selection."""
        self.load_topology()
        
        nodes = list(self._nodes.values())
        # Sort by cascade risk score (from centrality or criticality)
        nodes.sort(key=lambda n: n['cascade_risk'], reverse=True)
        
        return nodes[:limit]
    
    def calculate_failure_probability(
        self,
        source_node: Dict,
        target_node: Dict,
        distance_km: float,
        temperature_c: float,
        load_multiplier: float
    ) -> float:
        """
        Calculate probability that target node fails given source failure.
        
        Formula considers:
        - Distance (closer = higher probability)
        - Source criticality (more critical = wider impact)
        - Target betweenness (high betweenness = more vulnerable)
        - Temperature stress (extreme temps = higher failure)
        - Load conditions (overload = higher failure)
        """
        # Distance factor: exponential decay
        distance_factor = np.exp(-distance_km / 5.0)  # 5km characteristic distance
        
        # Source criticality effect
        source_effect = source_node['criticality_score']
        
        # Target vulnerability (betweenness = many paths go through it)
        target_vulnerability = target_node['betweenness'] * 100 + 0.1
        
        # Temperature stress factor
        if temperature_c < 0:
            temp_stress = 1.0 + abs(temperature_c) / 20.0  # Cold stress
        elif temperature_c > 35:
            temp_stress = 1.0 + (temperature_c - 35) / 15.0  # Heat stress
        else:
            temp_stress = 1.0
        
        # Combined probability (capped at 0.95)
        prob = min(0.95, 
            distance_factor * 
            source_effect * 
            target_vulnerability * 
            temp_stress * 
            load_multiplier * 
            0.5  # Base scaling factor
        )
        
        return prob
    
    def simulate(
        self,
        patient_zero_id: str,
        scenario_name: str = "Custom Scenario",
        temperature_c: float = 25.0,
        load_multiplier: float = 1.0,
        failure_threshold: float = 0.3,
        max_waves: int = 10,
        max_nodes: int = 100
    ) -> CascadeResult:
        """
        Run BFS cascade simulation from Patient Zero.
        
        Args:
            patient_zero_id: Starting node for cascade
            scenario_name: Name for the simulation
            temperature_c: Ambient temperature (affects failure rate)
            load_multiplier: Load stress factor (>1 = overloaded)
            failure_threshold: Minimum probability for cascade propagation
            max_waves: Maximum cascade depth
            max_nodes: Maximum total affected nodes
            
        Returns:
            CascadeResult with full cascade chain and statistics
        """
        self.load_topology()
        
        if patient_zero_id not in self._nodes:
            raise ValueError(f"Patient Zero {patient_zero_id} not found in topology")
        
        print(f"\nSimulating cascade from {patient_zero_id}...")
        print(f"  Scenario: {scenario_name}")
        print(f"  Temperature: {temperature_c}°C, Load: {load_multiplier}x")
        print(f"  Failure threshold: {failure_threshold}")
        
        start_time = time.time()
        
        # Initialize Patient Zero
        p0_data = self._nodes[patient_zero_id]
        patient_zero = CascadeNode(
            node_id=p0_data['node_id'],
            node_name=p0_data['node_name'],
            node_type=p0_data['node_type'],
            lat=p0_data['lat'],
            lon=p0_data['lon'],
            capacity_kw=p0_data['capacity_kw'],
            voltage_kv=p0_data['voltage_kv'],
            criticality_score=p0_data['criticality_score'],
            downstream_transformers=p0_data['downstream_transformers'],
            order=0,
            wave_depth=0,
            triggered_by=None,
            failure_probability=1.0
        )
        
        # BFS queue: (node_id, wave_depth, triggered_by)
        queue = deque([(patient_zero_id, 0, None)])
        visited: Set[str] = {patient_zero_id}
        
        cascade_order: List[CascadeNode] = [patient_zero]
        propagation_paths: List[Dict] = []
        wave_stats: Dict[int, WaveBreakdown] = {0: WaveBreakdown(wave_number=0)}
        
        # Update wave 0 stats
        wave_stats[0].nodes_failed = 1
        wave_stats[0].capacity_lost_mw = p0_data['capacity_kw'] / 1000
        wave_stats[0].customers_affected = p0_data['downstream_transformers'] * 50
        if p0_data['node_type'] == 'SUBSTATION':
            wave_stats[0].substations = 1
        else:
            wave_stats[0].transformers = 1
        
        # BFS cascade propagation
        while queue and len(cascade_order) < max_nodes:
            current_id, current_wave, triggered_by = queue.popleft()
            
            if current_wave >= max_waves:
                continue
            
            current_node = self._nodes[current_id]
            
            # Get neighbors
            neighbors = self._adjacency.get(current_id, [])
            
            for neighbor_id, distance in neighbors:
                if neighbor_id in visited:
                    continue
                
                neighbor_node = self._nodes[neighbor_id]
                
                # Calculate failure probability
                fail_prob = self.calculate_failure_probability(
                    current_node,
                    neighbor_node,
                    distance,
                    temperature_c,
                    load_multiplier
                )
                
                if fail_prob >= failure_threshold:
                    visited.add(neighbor_id)
                    
                    # Create cascade node
                    cascade_node = CascadeNode(
                        node_id=neighbor_node['node_id'],
                        node_name=neighbor_node['node_name'],
                        node_type=neighbor_node['node_type'],
                        lat=neighbor_node['lat'],
                        lon=neighbor_node['lon'],
                        capacity_kw=neighbor_node['capacity_kw'],
                        voltage_kv=neighbor_node['voltage_kv'],
                        criticality_score=neighbor_node['criticality_score'],
                        downstream_transformers=neighbor_node['downstream_transformers'],
                        order=len(cascade_order),
                        wave_depth=current_wave + 1,
                        triggered_by=current_id,
                        failure_probability=fail_prob
                    )
                    cascade_order.append(cascade_node)
                    
                    # Record propagation path
                    propagation_paths.append({
                        'from_node': current_id,
                        'to_node': neighbor_id,
                        'order': len(cascade_order) - 1,
                        'distance_km': distance,
                        'failure_probability': fail_prob
                    })
                    
                    # Update wave stats
                    wave_num = current_wave + 1
                    if wave_num not in wave_stats:
                        wave_stats[wave_num] = WaveBreakdown(wave_number=wave_num)
                    
                    wave_stats[wave_num].nodes_failed += 1
                    wave_stats[wave_num].capacity_lost_mw += neighbor_node['capacity_kw'] / 1000
                    wave_stats[wave_num].customers_affected += neighbor_node['downstream_transformers'] * 50
                    if neighbor_node['node_type'] == 'SUBSTATION':
                        wave_stats[wave_num].substations += 1
                    else:
                        wave_stats[wave_num].transformers += 1
                    
                    # Add to queue
                    queue.append((neighbor_id, current_wave + 1, current_id))
        
        # Build result
        total_capacity = sum(n.capacity_kw for n in cascade_order) / 1000
        total_customers = sum(n.downstream_transformers * 50 for n in cascade_order)
        max_depth = max(n.wave_depth for n in cascade_order) if cascade_order else 0
        
        result = CascadeResult(
            scenario_name=scenario_name,
            patient_zero=patient_zero,
            cascade_order=cascade_order,
            propagation_paths=propagation_paths,
            wave_breakdown=sorted(wave_stats.values(), key=lambda w: w.wave_number),
            total_affected_nodes=len(cascade_order),
            affected_capacity_mw=total_capacity,
            estimated_customers_affected=total_customers,
            max_cascade_depth=max_depth,
            simulation_timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        
        elapsed = time.time() - start_time
        print(f"\nSimulation completed in {elapsed:.2f}s")
        print(f"  Total affected: {result.total_affected_nodes} nodes")
        print(f"  Capacity lost: {result.affected_capacity_mw:.1f} MW")
        print(f"  Customers affected: {result.estimated_customers_affected:,}")
        print(f"  Cascade depth: {result.max_cascade_depth} waves")
        
        return result
    
    def store_result(self, result: CascadeResult) -> str:
        """Store simulation result in Snowflake for retrieval."""
        session = self._create_session()
        
        scenario_id = f"{result.scenario_name.lower().replace(' ', '_')}_{int(time.time())}"
        
        # Convert to JSON strings
        cascade_order_json = json.dumps([asdict(n) for n in result.cascade_order])
        wave_breakdown_json = json.dumps([asdict(w) for w in result.wave_breakdown])
        propagation_paths_json = json.dumps(result.propagation_paths)
        params_json = json.dumps({
            'scenario_name': result.scenario_name,
            'max_cascade_depth': result.max_cascade_depth
        })
        
        session.sql(f"""
            INSERT INTO {DB}.{SCHEMA_CASCADE_ANALYSIS}.PRECOMPUTED_CASCADES (
                scenario_id, scenario_name, patient_zero_id, patient_zero_name,
                simulation_params, cascade_order, wave_breakdown, propagation_paths,
                total_affected_nodes, affected_capacity_mw, estimated_customers_affected,
                max_cascade_depth, simulation_timestamp
            ) VALUES (
                '{scenario_id}',
                '{result.scenario_name}',
                '{result.patient_zero.node_id}',
                '{result.patient_zero.node_name}',
                PARSE_JSON('{params_json}'),
                PARSE_JSON($${cascade_order_json}$$),
                PARSE_JSON($${wave_breakdown_json}$$),
                PARSE_JSON($${propagation_paths_json}$$),
                {result.total_affected_nodes},
                {result.affected_capacity_mw},
                {result.estimated_customers_affected},
                {result.max_cascade_depth},
                CURRENT_TIMESTAMP()
            )
        """).collect()
        
        print(f"  Stored result as scenario_id: {scenario_id}")
        return scenario_id


def run_scenario_simulations():
    """Run simulations for standard scenarios."""
    simulator = CascadeSimulator()
    simulator.load_topology()
    
    # Get high-risk nodes
    high_risk = simulator.get_high_risk_nodes(limit=5)
    print("\nTop 5 High-Risk Nodes for Patient Zero:")
    for i, node in enumerate(high_risk, 1):
        print(f"  {i}. {node['node_id']} ({node['node_name']}) - Risk: {node['cascade_risk']:.4f}")
    
    # Scenarios to simulate
    scenarios = [
        {
            'name': 'Winter Storm Uri 2021',
            'temperature_c': -10.0,
            'load_multiplier': 1.8,
            'failure_threshold': 0.25,
            'patient_zero': high_risk[0]['node_id']
        },
        {
            'name': 'Summer Heat Wave 2023',
            'temperature_c': 42.0,
            'load_multiplier': 1.5,
            'failure_threshold': 0.3,
            'patient_zero': high_risk[1]['node_id']
        },
        {
            'name': 'Hurricane Harvey Impact',
            'temperature_c': 28.0,
            'load_multiplier': 1.2,
            'failure_threshold': 0.2,  # Lower threshold for storm damage
            'patient_zero': high_risk[2]['node_id']
        }
    ]
    
    results = []
    for scenario in scenarios:
        result = simulator.simulate(
            patient_zero_id=scenario['patient_zero'],
            scenario_name=scenario['name'],
            temperature_c=scenario['temperature_c'],
            load_multiplier=scenario['load_multiplier'],
            failure_threshold=scenario['failure_threshold']
        )
        scenario_id = simulator.store_result(result)
        results.append((scenario_id, result))
    
    return results


if __name__ == "__main__":
    print("="*70)
    print("ENGINEERING: REAL-TIME CASCADE SIMULATION")
    print("="*70)
    
    results = run_scenario_simulations()
    
    print("\n" + "="*70)
    print("SIMULATION SUMMARY")
    print("="*70)
    for scenario_id, result in results:
        print(f"\n{result.scenario_name}:")
        print(f"  Patient Zero: {result.patient_zero.node_name}")
        print(f"  Affected: {result.total_affected_nodes} nodes, {result.affected_capacity_mw:.1f} MW")
        print(f"  Customers: {result.estimated_customers_affected:,}")
        print(f"  Scenario ID: {scenario_id}")
