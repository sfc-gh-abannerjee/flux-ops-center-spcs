#!/usr/bin/env python3
"""
Production: SPCS GPU Training Runner for GNN Cascade Model
===============================================================

This script runs in Snowflake SPCS on a GPU compute pool to train the GNN
cascade failure prediction model. It provides HTTP endpoints for monitoring
training status and integrates with Snowflake's authentication.

Key Features:
- GPU-accelerated training with PyTorch Geometric
- Real-time status monitoring via REST API
- Automatic Snowflake session management (SPCS OAuth)
- Model artifact persistence to Snowflake stage
- Integration with Snowflake ML Model Registry
"""

import os
import threading
import traceback
from datetime import datetime
from contextlib import asynccontextmanager

# FastAPI for status endpoint
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

# ==============================================================================
# Configuration
# ==============================================================================
SNOWFLAKE_WAREHOUSE = os.getenv("SNOWFLAKE_WAREHOUSE", "SI_DEMO_WH")
SNOWFLAKE_DATABASE = os.getenv("SNOWFLAKE_DATABASE", "SI_DEMOS")
SNOWFLAKE_SCHEMA = os.getenv("SNOWFLAKE_SCHEMA", "CASCADE_ANALYSIS")

# Training status tracking (thread-safe via GIL for simple dict updates)
training_status = {
    "status": "initializing",
    "started_at": None,
    "completed_at": None,
    "current_epoch": 0,
    "total_epochs": 200,
    "current_phase": "startup",
    "metrics": {},
    "error": None,
    "error_traceback": None,
    "device": "unknown",
    "gpu_name": None,
    "gpu_memory_gb": None,
    "nodes_loaded": 0,
    "edges_loaded": 0,
}

# ==============================================================================
# Snowflake Session Management for SPCS
# ==============================================================================
def create_snowflake_session():
    """
    Create Snowflake session using SPCS authentication.

    In SPCS, we use the login_token file for OAuth authentication.
    This is the recommended approach for containerized services.
    """
    from snowflake.snowpark import Session

    # Check if running in SPCS (token file exists)
    token_path = "/snowflake/session/token"

    if os.path.exists(token_path):
        # SPCS OAuth token authentication
        print("Detected SPCS environment, using OAuth token authentication")
        with open(token_path, "r") as f:
            token = f.read().strip()

        connection_params = {
            "account": os.getenv("SNOWFLAKE_ACCOUNT"),
            "host": os.getenv("SNOWFLAKE_HOST"),
            "authenticator": "oauth",
            "token": token,
            "warehouse": SNOWFLAKE_WAREHOUSE,
            "database": SNOWFLAKE_DATABASE,
            "schema": SNOWFLAKE_SCHEMA,
        }
    else:
        # Local development - use connection name
        print("Local environment, using connection name authentication")
        connection_name = os.getenv("SNOWFLAKE_CONNECTION_NAME", "cpe_demo_CLI")
        return Session.builder.config("connection_name", connection_name).create()

    return Session.builder.configs(connection_params).create()


# ==============================================================================
# FastAPI Application
# ==============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager - start training on startup."""
    # Start training in background thread
    training_thread = threading.Thread(target=run_training, daemon=True)
    training_thread.start()
    print("Training thread started")
    yield
    print("Application shutting down")


app = FastAPI(
    title="GNN Cascade Training Service",
    description="GPU-accelerated GNN training for cascade failure prediction",
    version="2.0",
    lifespan=lifespan
)


@app.get("/health")
async def health():
    """Health check endpoint for SPCS."""
    return {
        "status": "healthy",
        "service": "gnn-cascade-trainer",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/status")
async def get_status():
    """Get current training status."""
    return JSONResponse(content=training_status)


@app.get("/metrics")
async def get_metrics():
    """Get training metrics if available."""
    if training_status["metrics"]:
        return JSONResponse(content={
            "status": training_status["status"],
            "metrics": training_status["metrics"],
            "device": training_status["device"],
            "gpu_name": training_status["gpu_name"]
        })
    raise HTTPException(status_code=404, detail="Metrics not yet available")


@app.get("/")
async def root():
    """Root endpoint with service info."""
    return {
        "service": "GNN Cascade Failure Training",
        "version": "2.0",
        "endpoints": {
            "/health": "Health check",
            "/status": "Training status",
            "/metrics": "Training metrics"
        },
        "training_status": training_status["status"]
    }


# ==============================================================================
# Training Execution
# ==============================================================================
def run_training():
    """Execute GNN training pipeline."""
    global training_status

    try:
        # ======================================================================
        # Phase 1: Environment Setup
        # ======================================================================
        training_status["current_phase"] = "environment_setup"
        training_status["started_at"] = datetime.utcnow().isoformat()

        import torch

        # Detect GPU
        if torch.cuda.is_available():
            training_status["device"] = "cuda"
            training_status["gpu_name"] = torch.cuda.get_device_name(0)
            training_status["gpu_memory_gb"] = round(
                torch.cuda.get_device_properties(0).total_memory / 1e9, 1
            )
            print(f"GPU Detected: {training_status['gpu_name']}")
            print(f"GPU Memory: {training_status['gpu_memory_gb']} GB")
        else:
            training_status["device"] = "cpu"
            print("WARNING: No GPU detected, training will be slower")

        # Verify PyTorch Geometric
        import torch_geometric
        print(f"PyTorch Version: {torch.__version__}")
        print(f"PyTorch Geometric Version: {torch_geometric.__version__}")
        print(f"CUDA Available: {torch.cuda.is_available()}")

        # ======================================================================
        # Phase 2: Data Loading
        # ======================================================================
        training_status["status"] = "loading_data"
        training_status["current_phase"] = "data_loading"
        print("\n" + "="*60)
        print("LOADING DATA FROM SNOWFLAKE")
        print("="*60)

        from train_gnn_model import GNNTrainer, TrainingConfig

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

        training_status["total_epochs"] = config.epochs

        # Create trainer and load data
        trainer = GNNTrainer(config)
        trainer.session = create_snowflake_session()

        trainer.load_data()
        training_status["nodes_loaded"] = len(trainer.nodes_df)
        training_status["edges_loaded"] = len(trainer.edges_df)

        print(f"Loaded {training_status['nodes_loaded']} nodes")
        print(f"Loaded {training_status['edges_loaded']} edges")

        # ======================================================================
        # Phase 3: Graph Construction
        # ======================================================================
        training_status["current_phase"] = "graph_construction"
        print("\nBuilding graph structure...")
        trainer.build_graph()

        # ======================================================================
        # Phase 4: Label Generation
        # ======================================================================
        training_status["current_phase"] = "label_generation"
        print("\nGenerating cascade labels...")
        trainer.generate_cascade_labels()

        # ======================================================================
        # Phase 5: Model Training
        # ======================================================================
        training_status["status"] = "training"
        training_status["current_phase"] = "model_training"
        print("\n" + "="*60)
        print("TRAINING GNN MODEL ON GPU")
        print("="*60)

        # Custom training with status updates
        metrics = train_with_status_updates(trainer, training_status)

        training_status["metrics"] = metrics

        # ======================================================================
        # Phase 6: Save Predictions
        # ======================================================================
        training_status["status"] = "saving_predictions"
        training_status["current_phase"] = "saving_predictions"
        print("\nWriting predictions to Snowflake...")
        trainer.write_predictions_to_snowflake()

        # ======================================================================
        # Phase 7: Model Registration
        # ======================================================================
        training_status["status"] = "registering_model"
        training_status["current_phase"] = "model_registration"
        print("\nRegistering model in Snowflake ML Registry...")
        trainer.register_model()

        # ======================================================================
        # Complete
        # ======================================================================
        training_status["status"] = "completed"
        training_status["current_phase"] = "done"
        training_status["completed_at"] = datetime.utcnow().isoformat()

        print("\n" + "="*60)
        print("TRAINING COMPLETED SUCCESSFULLY")
        print("="*60)
        print(f"AUC-ROC: {metrics.get('auc_roc', 'N/A'):.4f}")
        print(f"F1 Score: {metrics.get('f1_score', 'N/A'):.4f}")
        print(f"Precision: {metrics.get('precision', 'N/A'):.4f}")
        print(f"Recall: {metrics.get('recall', 'N/A'):.4f}")

    except Exception as e:
        training_status["status"] = "failed"
        training_status["error"] = str(e)
        training_status["error_traceback"] = traceback.format_exc()
        training_status["completed_at"] = datetime.utcnow().isoformat()

        print(f"\nTRAINING FAILED: {e}")
        traceback.print_exc()


def train_with_status_updates(trainer, status_dict):
    """
    Train model with real-time status updates.

    This wraps the trainer's train() method to provide epoch-by-epoch updates.
    """
    import torch
    import torch.nn.functional as F
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import (
        roc_auc_score, precision_recall_fscore_support, average_precision_score
    )
    import numpy as np

    from train_gnn_model import CascadeGCN

    config = trainer.config
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    # Move data to device
    x = trainer.x.to(device)
    edge_index = trainer.edge_index.to(device)
    y = trainer.y.to(device)

    # Train/val/test split
    num_nodes = len(trainer.nodes_df)
    indices = np.arange(num_nodes)

    train_idx, temp_idx = train_test_split(
        indices, test_size=(1 - config.train_split), random_state=42
    )
    val_size = config.val_split / (1 - config.train_split)
    val_idx, test_idx = train_test_split(temp_idx, test_size=(1 - val_size), random_state=42)

    train_mask = torch.zeros(num_nodes, dtype=torch.bool)
    val_mask = torch.zeros(num_nodes, dtype=torch.bool)
    test_mask = torch.zeros(num_nodes, dtype=torch.bool)

    train_mask[train_idx] = True
    val_mask[val_idx] = True
    test_mask[test_idx] = True

    train_mask = train_mask.to(device)
    val_mask = val_mask.to(device)
    test_mask = test_mask.to(device)

    print(f"Split: Train={len(train_idx)}, Val={len(val_idx)}, Test={len(test_idx)}")

    # Initialize model
    model = CascadeGCN(
        num_features=trainer.x.shape[1],
        hidden_dim=config.hidden_dim,
        dropout=config.dropout
    ).to(device)

    trainer.model = model

    print(f"Model on device: {device}")
    print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Optimizer
    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay
    )

    # Training loop with status updates
    best_val_loss = float('inf')
    patience_counter = 0

    for epoch in range(config.epochs):
        # Update status
        status_dict["current_epoch"] = epoch + 1

        # Training step
        model.train()
        optimizer.zero_grad()

        out = model(x, edge_index)
        train_loss = F.binary_cross_entropy(out[train_mask], y[train_mask])

        train_loss.backward()
        optimizer.step()

        # Validation step
        model.eval()
        with torch.no_grad():
            out = model(x, edge_index)
            val_loss = F.binary_cross_entropy(out[val_mask], y[val_mask])

        # Early stopping
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            trainer.best_model_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            patience_counter += 1

        if patience_counter >= config.patience:
            print(f"Early stopping at epoch {epoch+1}")
            break

        if (epoch + 1) % 20 == 0:
            print(f"Epoch {epoch+1:3d}: Train Loss={train_loss:.4f}, Val Loss={val_loss:.4f}")

    # Load best model and evaluate
    model.load_state_dict(trainer.best_model_state)
    model.eval()

    with torch.no_grad():
        predictions = model(x, edge_index)

    # Calculate metrics
    y_test = y[test_mask].cpu().numpy()
    y_pred = predictions[test_mask].cpu().numpy()
    y_pred_binary = (y_pred > 0.5).astype(int)

    auc = roc_auc_score(y_test, y_pred) if len(np.unique(y_test)) > 1 else 0.0
    ap = average_precision_score(y_test, y_pred) if len(np.unique(y_test)) > 1 else 0.0
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, y_pred_binary, average='binary', zero_division=0
    )

    metrics = {
        'auc_roc': float(auc),
        'average_precision': float(ap),
        'precision': float(precision),
        'recall': float(recall),
        'f1_score': float(f1),
        'val_loss_best': float(best_val_loss),
        'epochs_trained': epoch + 1,
        'num_nodes': num_nodes,
        'num_edges': trainer.edge_index.shape[1],
        'num_features': trainer.x.shape[1],
        'device': str(device),
    }

    trainer.metrics = metrics
    return metrics


# ==============================================================================
# Main Entry Point
# ==============================================================================
def main():
    """Start the training service."""
    print("="*70)
    print("PRODUCTION: GNN CASCADE TRAINING SERVICE")
    print("="*70)
    print(f"Started at: {datetime.utcnow().isoformat()}")
    print(f"Warehouse: {SNOWFLAKE_WAREHOUSE}")
    print(f"Database: {SNOWFLAKE_DATABASE}")
    print(f"Schema: {SNOWFLAKE_SCHEMA}")
    print("="*70)

    # Start FastAPI server (training starts via lifespan)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True
    )


if __name__ == "__main__":
    main()
