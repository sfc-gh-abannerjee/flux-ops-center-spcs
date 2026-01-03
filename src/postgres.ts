import { Pool, PoolConfig, PoolClient, QueryResult } from 'pg';

interface SnowflakePostgresConfig {
  host: string;
  port?: number;
  database?: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  connectionTimeoutMillis?: number;
  max?: number;
}

export class SnowflakePostgresConnector {
  private pool: Pool;
  private isConnected: boolean = false;

  constructor(config: SnowflakePostgresConfig) {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port || 5432,
      database: config.database || 'postgres',
      user: config.user,
      password: config.password,
      ssl: config.ssl !== false ? { rejectUnauthorized: false } : false,
      max: config.max || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,
    };

    this.pool = new Pool(poolConfig);

    this.pool.on('connect', () => {
      this.isConnected = true;
      console.log('Postgres client connected to Snowflake Postgres');
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected Postgres pool error:', err);
      this.isConnected = false;
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.executeQuery('SELECT 1 as test');
      return result.length > 0 && this.isConnected;
    } catch (error) {
      console.error('Postgres connection test failed:', error);
      return false;
    }
  }

  async executeQuery<T = any>(sqlText: string, params?: any[]): Promise<T[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      const result: QueryResult = await client.query(sqlText, params);
      return result.rows as T[];
    } catch (error) {
      console.error('Postgres query error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get real-time substation status with WORST-CASE aggregation
   * Fixes averaging problem - shows critical if ANY circuit is critical
   * Expected query time: 5-20ms (242 substations)
   */
  async getSubstationStatus(): Promise<SubstationStatus[]> {
    const query = `
      SELECT 
        substation_id,
        substation_name,
        COUNT(*) as circuit_count,
        ROUND(AVG(avg_load_percent)::numeric, 2) as avg_load,
        ROUND(AVG(avg_health_score)::numeric, 2) as avg_health,
        -- WORST-CASE LOGIC: Shows critical if ANY circuit is critical
        ROUND(MAX(avg_load_percent)::numeric, 2) as worst_circuit_load,
        ROUND(MIN(avg_health_score)::numeric, 2) as worst_circuit_health,
        COUNT(*) FILTER (WHERE avg_load_percent > 85) as critical_circuits,
        COUNT(*) FILTER (WHERE avg_load_percent > 70 AND avg_load_percent <= 85) as warning_circuits,
        -- Status determination based on worst circuit
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
    
    return this.executeQuery<SubstationStatus>(query);
  }

  /**
   * Get only critical/warning substations for map highlighting
   * Expected query time: 3-8ms (~10-20 substations)
   */
  async getCriticalSubstations(): Promise<CriticalSubstation[]> {
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
    
    return this.executeQuery<CriticalSubstation>(query);
  }

  /**
   * Get circuit details for drill-down (when user clicks substation)
   * Expected query time: 2-5ms (~9 circuits per substation avg)
   */
  async getSubstationCircuits(substationId: string): Promise<CircuitDetail[]> {
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
    
    return this.executeQuery<CircuitDetail>(query, [substationId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
    this.isConnected = false;
    console.log('Postgres connection pool closed');
  }

  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isConnected: this.isConnected
    };
  }
}

// TypeScript interfaces for type safety
export interface SubstationStatus {
  substation_id: string;
  substation_name: string;
  circuit_count: number;
  avg_load: number;
  avg_health: number;
  worst_circuit_load: number;    // KEY: Use this for status determination
  worst_circuit_health: number;  // KEY: Use this for status determination
  critical_circuits: number;
  warning_circuits: number;
  status: 'critical' | 'warning' | 'good';
  last_updated: Date;
}

export interface CriticalSubstation {
  substation_id: string;
  substation_name: string;
  worst_load: number;
  worst_health: number;
  critical_circuits: number;
  last_updated: Date;
}

export interface CircuitDetail {
  circuit_id: string;
  substation_id: string;
  substation_name: string;
  avg_load_percent: number;
  avg_health_score: number;
  centroid_lat: number;
  centroid_lon: number;
  last_updated: Date;
  status: 'critical' | 'warning' | 'good';
}
