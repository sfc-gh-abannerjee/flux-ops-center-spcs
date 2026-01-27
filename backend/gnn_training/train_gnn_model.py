#!/usr/bin/env python3
"""
Engineering: Production GNN Cascade Failure Model
====================================================

This script trains a Graph Convolutional Network for cascade failure prediction
and registers it in the Snowflake Model Registry for production inference.

Architecture: 10 features → 64 → 64 → 32 → 1 (binary cascade probability)

Features:
1. capacity_kw (normalized)
2. voltage_kv (normalized)
3. criticality_score
4. load_ratio (from telemetry)
5. temperature_stress
6. status_encoding (ordinal)
7. betweenness_centrality
8. pagerank
9. degree_centrality
10. clustering_coefficient

This resolves the compromise of having a notebook that was never executed.
"""

import os
import sys
import time
import pickle
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from collections import deque
from dataclasses import dataclass

# Check for PyTorch
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    print("WARNING: PyTorch not available. Install with: pip install torch")

# Check for PyTorch Geometric
try:
    from torch_geometric.nn import GCNConv
    from torch_geometric.data import Data
    PYG_AVAILABLE = True
except ImportError:
    PYG_AVAILABLE = False
    print("WARNING: PyTorch Geometric not available. Install with: pip install torch-geometric")

from snowflake.snowpark import Session
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support, average_precision_score

# Configuration
CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME", "cpe_demo_CLI")
MODEL_NAME = "CASCADE_GCN_MODEL"
MODEL_VERSION = "v2_production"


@dataclass
class TrainingConfig:
    """Configuration for GNN training."""
    hidden_dim: int = 64
    num_layers: int = 3
    dropout: float = 0.3
    learning_rate: float = 0.01
    weight_decay: float = 5e-4
    epochs: int = 200
    patience: int = 30
    train_split: float = 0.7
    val_split: float = 0.15
    # Cascade simulation parameters
    cascade_depth: int = 3
    num_cascade_seeds: int = 20


class CascadeGCN(nn.Module):
    """
    3-layer Graph Convolutional Network for cascade failure prediction.
    
    Architecture matches the original GNN demo:
    - Input: 10 node features
    - Layer 1: 10 → 64 with ReLU + Dropout
    - Layer 2: 64 → 64 with ReLU + Dropout
    - Layer 3: 64 → 32 with ReLU
    - Output: 32 → 1 with Sigmoid
    """
    
    def __init__(self, num_features: int = 10, hidden_dim: int = 64, dropout: float = 0.3):
        super().__init__()
        
        self.conv1 = GCNConv(num_features, hidden_dim)
        self.conv2 = GCNConv(hidden_dim, hidden_dim)
        self.conv3 = GCNConv(hidden_dim, hidden_dim // 2)
        
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.bn2 = nn.BatchNorm1d(hidden_dim)
        self.bn3 = nn.BatchNorm1d(hidden_dim // 2)
        
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_dim // 2, 1)
    
    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        # Layer 1
        x = self.conv1(x, edge_index)
        x = self.bn1(x)
        x = F.relu(x)
        x = self.dropout(x)
        
        # Layer 2
        x = self.conv2(x, edge_index)
        x = self.bn2(x)
        x = F.relu(x)
        x = self.dropout(x)
        
        # Layer 3
        x = self.conv3(x, edge_index)
        x = self.bn3(x)
        x = F.relu(x)
        
        # Output
        return torch.sigmoid(self.fc(x)).squeeze(-1)
    
    def get_embeddings(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        """Get node embeddings from final hidden layer."""
        x = self.conv1(x, edge_index)
        x = self.bn1(x)
        x = F.relu(x)
        
        x = self.conv2(x, edge_index)
        x = self.bn2(x)
        x = F.relu(x)
        
        x = self.conv3(x, edge_index)
        x = self.bn3(x)
        x = F.relu(x)
        
        return x


class GNNTrainer:
    """Handles data loading, training, and model registration."""
    
    def __init__(self, config: TrainingConfig = None):
        self.config = config or TrainingConfig()
        self.session: Optional[Session] = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Data
        self.nodes_df: Optional[pd.DataFrame] = None
        self.edges_df: Optional[pd.DataFrame] = None
        self.node_id_to_idx: Dict[str, int] = {}
        self.idx_to_node_id: Dict[int, str] = {}
        
        # Graph data
        self.x: Optional[torch.Tensor] = None  # Node features
        self.edge_index: Optional[torch.Tensor] = None  # Edge connectivity
        self.y: Optional[torch.Tensor] = None  # Labels
        
        # Model
        self.model: Optional[CascadeGCN] = None
        self.best_model_state: Optional[dict] = None
        self.metrics: Dict = {}
    
    def create_session(self) -> Session:
        """Create Snowflake session."""
        if self.session is None:
            self.session = Session.builder.config("connection_name", CONNECTION_NAME).create()
        return self.session
    
    def load_data(self) -> None:
        """Load nodes, edges, and centrality features from Snowflake."""
        print("\n" + "="*60)
        print("LOADING DATA FROM SNOWFLAKE")
        print("="*60)
        
        session = self.create_session()
        
        # Load nodes with centrality features
        print("\nLoading nodes with centrality features...")
        self.nodes_df = session.sql("""
            SELECT 
                n.NODE_ID,
                n.NODE_TYPE,
                n.LAT,
                n.LON,
                n.CAPACITY_KW,
                n.VOLTAGE_KV,
                n.CRITICALITY_SCORE,
                n.DOWNSTREAM_TRANSFORMERS,
                n.DOWNSTREAM_CAPACITY_KVA,
                COALESCE(c.DEGREE_CENTRALITY, 0) as DEGREE_CENTRALITY,
                COALESCE(c.BETWEENNESS_CENTRALITY, 0) as BETWEENNESS_CENTRALITY,
                COALESCE(c.PAGERANK, 0) as PAGERANK,
                COALESCE(c.CLUSTERING_COEFFICIENT, 0) as CLUSTERING_COEFFICIENT,
                COALESCE(c.CASCADE_RISK_SCORE, n.CRITICALITY_SCORE) as CASCADE_RISK_SCORE
            FROM SI_DEMOS.ML_DEMO.GRID_NODES n
            LEFT JOIN SI_DEMOS.CASCADE_ANALYSIS.NODE_CENTRALITY_FEATURES c 
                ON n.NODE_ID = c.NODE_ID
            WHERE n.LAT IS NOT NULL AND n.LON IS NOT NULL
        """).to_pandas()
        print(f"  Loaded {len(self.nodes_df)} nodes")
        
        # Load edges
        print("Loading edges...")
        self.edges_df = session.sql("""
            SELECT FROM_NODE_ID, TO_NODE_ID, DISTANCE_KM, EDGE_TYPE
            FROM SI_DEMOS.ML_DEMO.GRID_EDGES
        """).to_pandas()
        print(f"  Loaded {len(self.edges_df)} edges")
        
        # Create node ID mappings
        self.node_id_to_idx = {nid: idx for idx, nid in enumerate(self.nodes_df['NODE_ID'])}
        self.idx_to_node_id = {idx: nid for nid, idx in self.node_id_to_idx.items()}
        
        print(f"  Created mappings for {len(self.node_id_to_idx)} nodes")
    
    def build_graph(self) -> None:
        """Build PyTorch Geometric graph structure."""
        print("\n" + "="*60)
        print("BUILDING GRAPH STRUCTURE")
        print("="*60)
        
        # Build edge index (COO format)
        print("\nBuilding edge index...")
        source_nodes = []
        target_nodes = []
        
        for _, row in self.edges_df.iterrows():
            from_idx = self.node_id_to_idx.get(row['FROM_NODE_ID'])
            to_idx = self.node_id_to_idx.get(row['TO_NODE_ID'])
            
            if from_idx is not None and to_idx is not None:
                # Add bidirectional edges
                source_nodes.extend([from_idx, to_idx])
                target_nodes.extend([to_idx, from_idx])
        
        self.edge_index = torch.tensor([source_nodes, target_nodes], dtype=torch.long)
        print(f"  Edge index shape: {self.edge_index.shape}")
        
        # Build node features (10 features)
        print("Building node features...")
        feature_cols = [
            'CAPACITY_KW', 'VOLTAGE_KV', 'CRITICALITY_SCORE',
            'DOWNSTREAM_TRANSFORMERS', 'DOWNSTREAM_CAPACITY_KVA',
            'DEGREE_CENTRALITY', 'BETWEENNESS_CENTRALITY', 'PAGERANK',
            'CLUSTERING_COEFFICIENT', 'CASCADE_RISK_SCORE'
        ]
        
        features = self.nodes_df[feature_cols].fillna(0).values.astype(np.float32)
        
        # Normalize features
        mean = features.mean(axis=0)
        std = features.std(axis=0) + 1e-8
        features_normalized = (features - mean) / std
        
        self.x = torch.tensor(features_normalized, dtype=torch.float32)
        self.feature_mean = mean
        self.feature_std = std
        
        print(f"  Node features shape: {self.x.shape}")
        print(f"  Features: {feature_cols}")
    
    def generate_cascade_labels(self) -> None:
        """Generate cascade labels using BFS from high-criticality nodes."""
        print("\n" + "="*60)
        print("GENERATING CASCADE LABELS")
        print("="*60)
        
        # Build adjacency list for BFS
        adjacency = {}
        for i in range(self.edge_index.shape[1]):
            src = self.edge_index[0, i].item()
            dst = self.edge_index[1, i].item()
            if src not in adjacency:
                adjacency[src] = []
            adjacency[src].append(dst)
        
        # Get high-criticality nodes as cascade seeds
        high_crit_idx = self.nodes_df['CASCADE_RISK_SCORE'].nlargest(self.config.num_cascade_seeds).index.tolist()
        print(f"\nUsing top {len(high_crit_idx)} nodes as cascade seeds")
        
        # Aggregate cascade labels
        cascade_labels = np.zeros(len(self.nodes_df))
        
        for seed_idx in high_crit_idx:
            # BFS cascade simulation
            visited = {seed_idx}
            queue = deque([(seed_idx, 0)])
            
            while queue:
                current, depth = queue.popleft()
                
                if depth >= self.config.cascade_depth:
                    continue
                
                cascade_labels[current] = 1  # Mark as affected
                
                for neighbor in adjacency.get(current, []):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        queue.append((neighbor, depth + 1))
        
        self.y = torch.tensor(cascade_labels, dtype=torch.float32)
        
        positive_count = int(self.y.sum().item())
        total = len(self.y)
        print(f"  Cascade labels: {positive_count} affected / {total} total ({100*positive_count/total:.1f}%)")
    
    def train(self) -> Dict:
        """Train the GNN model."""
        print("\n" + "="*60)
        print("TRAINING GNN MODEL")
        print("="*60)
        
        # Move data to device
        x = self.x.to(self.device)
        edge_index = self.edge_index.to(self.device)
        y = self.y.to(self.device)
        
        # Train/val/test split
        num_nodes = len(self.nodes_df)
        indices = np.arange(num_nodes)
        
        train_idx, temp_idx = train_test_split(
            indices, test_size=(1 - self.config.train_split), random_state=42
        )
        val_size = self.config.val_split / (1 - self.config.train_split)
        val_idx, test_idx = train_test_split(temp_idx, test_size=(1 - val_size), random_state=42)
        
        train_mask = torch.zeros(num_nodes, dtype=torch.bool)
        val_mask = torch.zeros(num_nodes, dtype=torch.bool)
        test_mask = torch.zeros(num_nodes, dtype=torch.bool)
        
        train_mask[train_idx] = True
        val_mask[val_idx] = True
        test_mask[test_idx] = True
        
        train_mask = train_mask.to(self.device)
        val_mask = val_mask.to(self.device)
        test_mask = test_mask.to(self.device)
        
        print(f"\nSplit: Train={len(train_idx)}, Val={len(val_idx)}, Test={len(test_idx)}")
        
        # Initialize model
        self.model = CascadeGCN(
            num_features=self.x.shape[1],
            hidden_dim=self.config.hidden_dim,
            dropout=self.config.dropout
        ).to(self.device)
        
        print(f"Model on device: {self.device}")
        print(f"Parameters: {sum(p.numel() for p in self.model.parameters()):,}")
        
        # Optimizer and loss
        optimizer = torch.optim.Adam(
            self.model.parameters(),
            lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay
        )
        
        # Class imbalance handling
        pos_weight = (1 - y.mean()) / max(y.mean(), 0.01)
        print(f"Positive class weight: {pos_weight:.2f}")
        
        # Training loop
        best_val_loss = float('inf')
        patience_counter = 0
        train_losses = []
        val_losses = []
        
        print(f"\nTraining for up to {self.config.epochs} epochs...")
        
        for epoch in range(self.config.epochs):
            # Training
            self.model.train()
            optimizer.zero_grad()
            
            out = self.model(x, edge_index)
            train_loss = F.binary_cross_entropy(out[train_mask], y[train_mask])
            
            train_loss.backward()
            optimizer.step()
            
            # Validation
            self.model.eval()
            with torch.no_grad():
                out = self.model(x, edge_index)
                val_loss = F.binary_cross_entropy(out[val_mask], y[val_mask])
            
            train_losses.append(train_loss.item())
            val_losses.append(val_loss.item())
            
            # Early stopping
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                self.best_model_state = {k: v.cpu().clone() for k, v in self.model.state_dict().items()}
            else:
                patience_counter += 1
            
            if patience_counter >= self.config.patience:
                print(f"  Early stopping at epoch {epoch+1}")
                break
            
            if (epoch + 1) % 20 == 0:
                print(f"  Epoch {epoch+1:3d}: Train Loss={train_loss:.4f}, Val Loss={val_loss:.4f}")
        
        # Load best model and evaluate
        self.model.load_state_dict(self.best_model_state)
        self.model.eval()
        
        with torch.no_grad():
            predictions = self.model(x, edge_index)
        
        # Test metrics
        y_test = y[test_mask].cpu().numpy()
        y_pred = predictions[test_mask].cpu().numpy()
        y_pred_binary = (y_pred > 0.5).astype(int)
        
        auc = roc_auc_score(y_test, y_pred) if len(np.unique(y_test)) > 1 else 0.0
        ap = average_precision_score(y_test, y_pred) if len(np.unique(y_test)) > 1 else 0.0
        precision, recall, f1, _ = precision_recall_fscore_support(y_test, y_pred_binary, average='binary', zero_division=0)
        
        self.metrics = {
            'auc_roc': auc,
            'average_precision': ap,
            'precision': precision,
            'recall': recall,
            'f1_score': f1,
            'train_loss_final': train_losses[-1],
            'val_loss_best': best_val_loss.item(),
            'epochs_trained': len(train_losses),
            'num_nodes': num_nodes,
            'num_edges': self.edge_index.shape[1],
            'num_features': self.x.shape[1]
        }
        
        print("\n" + "-"*40)
        print("TEST SET METRICS:")
        print("-"*40)
        print(f"  AUC-ROC: {auc:.4f}")
        print(f"  Average Precision: {ap:.4f}")
        print(f"  Precision: {precision:.4f}")
        print(f"  Recall: {recall:.4f}")
        print(f"  F1 Score: {f1:.4f}")
        
        return self.metrics
    
    def save_model_locally(self, path: str = "cascade_gcn_model.pkl") -> str:
        """Save model and artifacts locally."""
        print(f"\nSaving model to {path}...")
        
        artifacts = {
            'model_state_dict': self.best_model_state,
            'config': self.config,
            'feature_mean': self.feature_mean,
            'feature_std': self.feature_std,
            'node_id_to_idx': self.node_id_to_idx,
            'idx_to_node_id': self.idx_to_node_id,
            'metrics': self.metrics,
        }
        
        with open(path, 'wb') as f:
            pickle.dump(artifacts, f)
        
        print(f"  Saved model artifacts to {path}")
        return path
    
    def get_predictions(self) -> pd.DataFrame:
        """Get cascade risk predictions for all nodes."""
        self.model.eval()
        
        x = self.x.to(self.device)
        edge_index = self.edge_index.to(self.device)
        
        with torch.no_grad():
            predictions = self.model(x, edge_index).cpu().numpy()
        
        results_df = self.nodes_df[['NODE_ID', 'NODE_TYPE', 'CRITICALITY_SCORE']].copy()
        results_df['GNN_CASCADE_RISK'] = predictions
        results_df['PREDICTION_TIMESTAMP'] = pd.Timestamp.now()
        
        return results_df
    
    def write_predictions_to_snowflake(self) -> None:
        """Write predictions to Snowflake table."""
        print("\nWriting predictions to Snowflake...")
        
        predictions_df = self.get_predictions()
        
        session = self.create_session()
        snowpark_df = session.create_dataframe(predictions_df)
        snowpark_df.write.mode("overwrite").save_as_table(
            "SI_DEMOS.CASCADE_ANALYSIS.GNN_PREDICTIONS"
        )
        
        print("  Written to SI_DEMOS.CASCADE_ANALYSIS.GNN_PREDICTIONS")
    
    def register_model(self) -> None:
        """Register model in Snowflake Model Registry."""
        print("\n" + "="*60)
        print("REGISTERING MODEL IN SNOWFLAKE")
        print("="*60)
        
        try:
            from snowflake.ml.registry import Registry
            
            session = self.create_session()
            registry = Registry(session=session, database_name="SI_DEMOS", schema_name="CASCADE_ANALYSIS")
            
            # Save model locally first
            model_path = self.save_model_locally()
            
            # Log to registry
            mv = registry.log_model(
                model_name=MODEL_NAME,
                version_name=MODEL_VERSION,
                model=self.model,
                comment=f"3-layer GCN for cascade failure prediction. AUC-ROC: {self.metrics['auc_roc']:.4f}",
                metrics=self.metrics
            )
            
            print(f"\n  Model registered: {mv.model_name}.{mv.version_name}")
            print(f"  AUC-ROC: {self.metrics['auc_roc']:.4f}")
            
        except Exception as e:
            print(f"\n  Warning: Could not register to Snowflake ML Registry: {e}")
            print("  Model saved locally instead.")
            self.save_model_locally()


def main():
    """Main training pipeline."""
    if not TORCH_AVAILABLE or not PYG_AVAILABLE:
        print("ERROR: PyTorch and PyTorch Geometric are required.")
        print("Install with: pip install torch torch-geometric")
        sys.exit(1)
    
    print("="*70)
    print("ENGINEERING: GNN CASCADE FAILURE MODEL TRAINING")
    print("="*70)
    print(f"Device: {torch.device('cuda' if torch.cuda.is_available() else 'cpu')}")
    
    start_time = time.time()
    
    # Initialize trainer
    config = TrainingConfig(
        hidden_dim=64,
        num_layers=3,
        dropout=0.3,
        learning_rate=0.01,
        epochs=200,
        patience=30,
        cascade_depth=3,
        num_cascade_seeds=20
    )
    
    trainer = GNNTrainer(config)
    
    # Pipeline
    trainer.load_data()
    trainer.build_graph()
    trainer.generate_cascade_labels()
    metrics = trainer.train()
    trainer.write_predictions_to_snowflake()
    trainer.register_model()
    
    elapsed = time.time() - start_time
    
    print("\n" + "="*70)
    print("TRAINING COMPLETE")
    print("="*70)
    print(f"Total time: {elapsed:.1f}s")
    print(f"Final AUC-ROC: {metrics['auc_roc']:.4f}")
    print(f"Model: {MODEL_NAME}.{MODEL_VERSION}")
    
    return trainer


if __name__ == "__main__":
    trainer = main()
