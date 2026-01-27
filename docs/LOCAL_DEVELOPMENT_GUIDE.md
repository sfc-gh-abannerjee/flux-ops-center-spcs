# Flux Operations Center - Local Development Guide

## Quick Start

### Project Location
```
/Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs/
```

### Prerequisites
- Python 3.11+
- Node.js 18+
- Snowflake CLI configured with `cpe_demo_CLI` connection
- Personal Access Token (PAT) for Cortex Agent API

---

## Step 1: Start the Backend (FastAPI)

### Terminal 1 - Backend Server

```bash
# Navigate to project
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs

# Activate virtual environment (if using one)
# source venv/bin/activate

# Install dependencies (first time only)
pip install -r backend/requirements.txt

# Start the FastAPI backend server
SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 3001 --reload
```

**Expected Output:**
```
INFO:     Uvicorn running on http://0.0.0.0:3001 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Application startup complete.
```

**Backend Endpoints:**
- http://localhost:3001 - API root
- http://localhost:3001/docs - Swagger UI
- http://localhost:3001/api/cascade/patient-zero-candidates - Cascade analysis
- http://localhost:3001/api/cascade/simulate-realtime - Cascade simulation

---

## Step 2: Start the Frontend (React/Vite)

### Terminal 2 - Frontend Development Server

```bash
# Navigate to project
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs

# Install dependencies (first time only)
npm install

# Start the Vite development server
npm run dev
```

**Expected Output:**
```
  VITE v5.0.8  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

**Frontend URL:** http://localhost:5173

---

## Step 3: Set Up Environment Variables

### Required Environment Variables

Create or update `.env` in the project root:

```bash
# Snowflake Configuration
VITE_SNOWFLAKE_ACCOUNT_URL=https://gzb42423.prod3.us-west-2.aws.snowflakecomputing.com

# Postgres Configuration (for map data caching)
VITE_POSTGRES_HOST=<your_postgres_host>
VITE_POSTGRES_PORT=5432
VITE_POSTGRES_DATABASE=postgres
VITE_POSTGRES_USER=application
VITE_POSTGRES_PASSWORD=<your_password>
```

### For Cortex Agent (Shell Profile)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
# Snowflake PAT for Cortex Agent API
export SNOWFLAKE_PAT='your_personal_access_token_here'
export SNOWFLAKE_HOST='gzb42423.snowflakecomputing.com'
```

Then reload:
```bash
source ~/.zshrc
```

---

## Complete Startup Commands

### Option A: Two Terminal Windows

**Terminal 1 (Backend):**
```bash
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 3001 --reload
```

**Terminal 2 (Frontend):**
```bash
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
npm run dev
```

### Option B: Background Processes (Single Terminal)

```bash
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs

# Start backend in background
SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 3001 &

# Start frontend
npm run dev
```

---

## Verify Everything is Running

### 1. Check Backend Health
```bash
curl http://localhost:3001/
# Should return API info
```

### 2. Check Cascade Analysis Endpoint
```bash
curl "http://localhost:3001/api/cascade/patient-zero-candidates?limit=5"
# Should return JSON with top 5 cascade risk nodes
```

### 3. Check Frontend
Open http://localhost:5173 in your browser

---

## Testing Cascade Analysis

### Test Patient Zero Candidates
```bash
curl "http://localhost:3001/api/cascade/patient-zero-candidates?limit=10&only_centrality_computed=true"
```

### Test Cascade Impact
```bash
curl -X POST "http://localhost:3001/api/cascade/simulate-realtime?patient_zero_id=SUB-HOU-124&scenario_name=Winter%20Storm%20Uri&temperature_c=-10&load_multiplier=1.8&failure_threshold=0.15"
```

### Test Cortex Agent (Python)
```bash
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs
python3 test_cascade_agent.py
```

---

## Directory Structure

```
/Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs/
├── backend/
│   ├── server_fastapi.py      # Main FastAPI server (port 3001)
│   ├── requirements.txt       # Python dependencies
│   ├── scripts/               # ML scripts (centrality, GNN)
│   └── sql/                   # Database setup scripts
├── src/                       # React frontend source
├── package.json               # Node.js dependencies
├── vite.config.ts            # Vite configuration
├── .env                       # Environment variables
├── docs/                      # Documentation
└── test_cascade_*.py          # Test scripts
```

---

## Common Issues & Solutions

### Issue: Backend won't start - "Connection refused"
```bash
# Check if port 3001 is in use
lsof -i :3001

# Kill existing process if needed
kill -9 <PID>
```

### Issue: Frontend can't connect to backend
```bash
# Verify backend is running
curl http://localhost:3001/

# Check CORS settings in backend if needed
```

### Issue: Snowflake connection fails
```bash
# Verify Snowflake CLI connection
snow connection test -c cpe_demo_CLI

# Check connection name matches
echo $SNOWFLAKE_CONNECTION_NAME
```

### Issue: Cortex Agent returns 401/403
```bash
# Verify PAT is set
echo $SNOWFLAKE_PAT

# Create new PAT in Snowsight if expired
# Admin → Users & Roles → Your User → Personal Access Tokens
```

---

## Stopping the Servers

### Frontend
Press `Ctrl+C` in the terminal running `npm run dev`

### Backend
Press `Ctrl+C` in the terminal running uvicorn

Or if running in background:
```bash
# Find process
lsof -i :3001

# Kill it
kill -9 <PID>
```

---

## Quick Reference

| Component | Command | URL |
|-----------|---------|-----|
| Backend | `SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI uvicorn backend.server_fastapi:app --port 3001 --reload` | http://localhost:3001 |
| Frontend | `npm run dev` | http://localhost:5173 |
| API Docs | (backend running) | http://localhost:3001/docs |
| Cascade Test | `python3 test_cascade_agent.py` | - |

---

*Last Updated: January 25, 2026*
