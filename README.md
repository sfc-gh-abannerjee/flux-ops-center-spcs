# Flux Operations Center - SPCS + Snowflake Managed Postgres

---

## Architecture

```
Pure SPCS React App (Browser)
  ├── React 18 + TypeScript
  ├── deck.gl 8.9 (multi-layer visualization)
  ├── Material-UI 5 (Flux brand theme)
  ├── CartoDB Dark Matter basemap (free, no API key)
  └── Vite dev server (fast HMR)
      ↓
Snowflake Connector (Backend - TODO)
  ├── REST API (OAuth token-based)
  ├── Query: Postgres for current state (<1ms)
  ├── Query: Hybrid Tables for outages (<10ms)
  └── Query: Snowflake for time-series (sub-5s)
```

---

**Features:**
1. ✅ **Header:** "Flux Operations Center" with Flux blue gradient logo
2. ✅ **Subtitle:** "Grid Operations • Houston TX • Real-time"
3. ✅ **6 Navigation Tabs:** Operations Dashboard (active), AMI Analytics, Outage Management, Asset Health, Field Operations, AI Assistant
4. ✅ **5 KPI Cards:**
   - SAIDI: 152.3 Minutes (blue accent)
   - SAIFI: 1.42 Interruptions/Customer (yellow accent)
   - Active Outages: 8 (Customer Impact: 1.2K) (red accent)
   - Total Load: 2874 MW (82% Capacity) (green accent)
   - Field Crews: 12 (8 En Route) (purple accent)
5. ✅ **Interactive deck.gl Map:**
   - 1,000 poles (color: health score - green/yellow/red)
   - 200 transformers (color: load % - blue/yellow/red, size: load-based)
   - 500 meters (color: purple, size: usage-based)
   - Click interaction showing "Meter 378" details panel
6. ✅ **Dark mode theme** (Grid 360-style control center aesthetics)

---

## Technical Stack

### Frontend
- **React 18.2** (TypeScript)
- **deck.gl 8.9** (WebGL-powered multi-layer maps)
- **Material-UI 5.14** (design system)
- **Vite 5.0** (build tool, fast HMR)

### Visualization
- **ScatterplotLayer** (3 layers: poles, transformers, meters)
- **CartoDB Dark Matter** (basemap, free)
- **Interactive tooltips** (hover to see asset details)
- **Click-to-drill-down** (asset details panel)

### Data (Currently Synthetic)
- **1,700 assets** rendered (1,000 poles + 200 transformers + 500 meters)
- **Houston, TX center** (29.7604°N, -95.3698°W)
- **Real-time KPI updates** (simulated every 5 seconds)

---

## File Structure

```
flux_ops_center_spcs/
├── package.json           # Dependencies (React, deck.gl, MUI)
├── tsconfig.json          # TypeScript config
├── vite.config.ts         # Vite build config (port 8080)
├── index.html             # HTML entry point
├── src/
│   ├── main.tsx          # React entry point
│   ├── App.tsx           # Main application (325 lines)
│   └── snowflake.ts      # Snowflake connector (REST API + SDK)
└── README.md             # This file
```

---

## Current Features (Phase 1 MVP)

### ✅ Completed
1. **Flux Branding**
   - Flux blue (#0EA5E9) + Electric yellow (#FBBF24) gradient logo
   - Dark mode theme (#0F172A background, #1E293B panels)
   - Inter font family
   - "Flux Operations Center" header

2. **KPI Dashboard**
   - 5 real-time KPI cards (Material-UI Card components)
   - Icons (Assessment, TrendingUp, Warning, ElectricBolt, Engineering)
   - Color-coded accents (blue, yellow, red, green, purple)
   - Auto-updates every 5 seconds

3. **Multi-Layer Map**
   - **Poles Layer:** 1,000 assets, color = health score (green/yellow/red)
   - **Transformers Layer:** 200 assets, color = load %, size = load-based
   - **Meters Layer:** 500 assets, color = purple, size = usage-based
   - CartoDB Dark Matter basemap (dark theme consistency)
   - 3D view (pitch: 45°, bearing: 0°)

4. **Interactions**
   - Click asset → details panel (top-right overlay)
   - Hover asset → tooltip (name, type, metrics)
   - Zoom/pan/rotate (DeckGL controller)
   - Responsive layout (mobile-friendly grid)

5. **Navigation**
   - 6 tabs (Operations Dashboard active, others "Coming Soon")
   - AppBar with Flux logo + utility subtitle

### 🔄 In Progress (Phase 2)
6. **Snowflake Connector**
   - REST API implementation (OAuth token-based)
   - Replace synthetic data with real Snowflake queries
   - Connect to Postgres (assets), Hybrid Tables (outages), Snowflake (time-series)

### ⏳ Pending (Phase 3-5)
7. **AMI Analytics Tab** (time-series charts, forecasting)
8. **Outage Management Tab** (real-time outage map, crew dispatch)
9. **Asset Health Tab** (predictive maintenance, risk heatmaps)
10. **Field Operations Tab** (work orders, crew tracking)
11. **AI Assistant Tab** (preserve existing Cortex Agent chat)
12. **Docker + SPCS Deployment**

---

## Running Locally

```bash
cd /Users/abannerjee/Documents/cpe_poc/flux_ops_center_spcs

# Install dependencies (if not done)
npm install

# Start dev server
npm run dev

# App will be available at:
# http://localhost:8080 (or 8081 if 8080 in use)
```

---

## Next Steps (Phase 2: Snowflake Integration)

### 1. Implement Snowflake REST API Connector
```typescript
// src/snowflake.ts already created with:
- SnowflakeRESTConnector class
- getAssets() method
- getKPIs() method
- getOutages() method
```

### 2. Connect to Real Data
```typescript
// In App.tsx, replace synthetic data generation with:
const connector = new SnowflakeRESTConnector(
  'https://GZB42423.snowflakecomputing.com',
  process.env.SNOWFLAKE_TOKEN
);

useEffect(() => {
  const fetchData = async () => {
    const realAssets = await connector.getAssets();
    setAssets(realAssets);
    
    const realKPIs = await connector.getKPIs();
    setKPIs(realKPIs);
  };
  fetchData();
}, []);
```

### 3. Set Up Authentication
- Option A: OAuth token (recommended for SPCS)
- Option B: Service account credentials (for backend)
- Option C: Snowflake external OAuth (for production)

### 4. Query Real Snowflake Tables
```sql
-- Create test tables (if not exists)
CREATE OR REPLACE TABLE GRID_COMMAND_PLATFORM.CORE.ASSETS AS
SELECT 
  asset_id,
  asset_name,
  asset_type,
  latitude,
  longitude,
  health_score,
  load_percent,
  usage_kwh
FROM SI_DEMOS.APPLICATIONS.METER_INFRASTRUCTURE
LIMIT 10000;

-- Create KPI metrics table
CREATE OR REPLACE TABLE GRID_COMMAND_PLATFORM.APPS.KPI_METRICS AS
SELECT 
  CURRENT_DATE() as metric_date,
  'SAIDI' as metric_name,
  152.3 as metric_value
UNION ALL
SELECT CURRENT_DATE(), 'SAIFI', 1.42
UNION ALL
SELECT CURRENT_DATE(), 'ACTIVE_OUTAGES', 8
UNION ALL
SELECT CURRENT_DATE(), 'TOTAL_LOAD_MW', 2874
UNION ALL
SELECT CURRENT_DATE(), 'CREWS_ACTIVE', 12;
```

---

## Docker + SPCS Deployment (Phase 3)

### 1. Create Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Build production bundle
RUN npm run build

# Expose port
EXPOSE 8080

# Start app
CMD ["npm", "run", "preview"]
```

### 2. Build and Push Image
```bash
# Build Docker image
docker build -t flux-ops-center:latest .

# Tag for Snowflake registry
docker tag flux-ops-center:latest \
  GZB42423.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center:latest

# Push to Snowflake
docker push GZB42423.registry.snowflakecomputing.com/si_demos/applications/flux_ops_center:latest
```

### 3. Create SPCS Service
```sql
CREATE SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER
  IN COMPUTE POOL FLUX_INTERACTIVE_POOL
  FROM SPECIFICATION $$
    spec:
      containers:
      - name: frontend
        image: /SI_DEMOS/APPLICATIONS/flux_ops_center:latest
        env:
          SNOWFLAKE_ACCOUNT: GZB42423
          SNOWFLAKE_DATABASE: GRID_COMMAND_PLATFORM
          SNOWFLAKE_SCHEMA: CORE
          SNOWFLAKE_WAREHOUSE: GRID_COMMAND_REALTIME_WH
        resources:
          requests:
            memory: 2Gi
            cpu: 1
          limits:
            memory: 4Gi
            cpu: 2
      endpoints:
      - name: web
        port: 8080
        public: true
  $$
  MIN_INSTANCES = 1
  MAX_INSTANCES = 3
  AUTO_SUSPEND_SECS = 600;

-- Get public endpoint
SHOW ENDPOINTS IN SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER;
```
