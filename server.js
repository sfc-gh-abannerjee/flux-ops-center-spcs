import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors());
app.use(express.json());

// Postgres connection pool
const pool = new Pool({
  host: process.env.VITE_POSTGRES_HOST || '',
  port: parseInt(process.env.VITE_POSTGRES_PORT || '5432'),
  database: process.env.VITE_POSTGRES_DATABASE || 'postgres',
  user: process.env.VITE_POSTGRES_USER || '',
  password: process.env.VITE_POSTGRES_PASSWORD || '',
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('✅ Postgres client connected');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected Postgres pool error:', err);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get substation status with worst-case aggregation
app.get('/api/substations/status', async (req, res) => {
  try {
    const query = `
      SELECT 
        substation_id,
        substation_name,
        COUNT(*) as circuit_count,
        ROUND(AVG(avg_load_percent)::numeric, 2) as avg_load,
        ROUND(AVG(avg_health_score)::numeric, 2) as avg_health,
        ROUND(MAX(avg_load_percent)::numeric, 2) as worst_circuit_load,
        ROUND(MIN(avg_health_score)::numeric, 2) as worst_circuit_health,
        COUNT(*) FILTER (WHERE avg_load_percent > 85) as critical_circuits,
        COUNT(*) FILTER (WHERE avg_load_percent > 70 AND avg_load_percent <= 85) as warning_circuits,
        CASE 
          WHEN MAX(avg_load_percent) > 85 OR MIN(avg_health_score) < 50 THEN 'critical'
          WHEN MAX(avg_load_percent) > 70 OR MIN(avg_health_score) < 70 THEN 'warning'
          ELSE 'good'
        END as status,
        MAX(last_updated) as last_updated
      FROM circuit_status_realtime
      WHERE last_updated > NOW() - INTERVAL '1 minute'
      GROUP BY substation_id, substation_name
      ORDER BY worst_circuit_load DESC NULLS LAST
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching substation status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get critical substations
app.get('/api/substations/critical', async (req, res) => {
  try {
    const query = `
      SELECT 
        substation_id,
        substation_name,
        ROUND(MAX(avg_load_percent)::numeric, 2) as worst_load,
        ROUND(MIN(avg_health_score)::numeric, 2) as worst_health,
        COUNT(*) FILTER (WHERE avg_load_percent > 85) as critical_circuits,
        MAX(last_updated) as last_updated
      FROM circuit_status_realtime
      WHERE last_updated > NOW() - INTERVAL '1 minute'
      GROUP BY substation_id, substation_name
      HAVING MAX(avg_load_percent) > 70 OR MIN(avg_health_score) < 70
      ORDER BY MAX(avg_load_percent) DESC
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching critical substations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get circuits for a specific substation
app.get('/api/substations/:id/circuits', async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        circuit_id,
        substation_id,
        substation_name,
        ROUND(avg_load_percent::numeric, 2) as avg_load_percent,
        ROUND(avg_health_score::numeric, 2) as avg_health_score,
        centroid_lat,
        centroid_lon,
        last_updated,
        CASE 
          WHEN avg_load_percent > 85 THEN 'critical'
          WHEN avg_load_percent > 70 THEN 'warning'
          ELSE 'good'
        END as status
      FROM circuit_status_realtime
      WHERE substation_id = $1
      ORDER BY avg_load_percent DESC
    `;
    
    const result = await pool.query(query, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching circuits:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Postgres API server running on http://localhost:${PORT}`);
  console.log(`📊 Endpoints:`);
  console.log(`   GET /api/health`);
  console.log(`   GET /api/substations/status`);
  console.log(`   GET /api/substations/critical`);
  console.log(`   GET /api/substations/:id/circuits`);
});
