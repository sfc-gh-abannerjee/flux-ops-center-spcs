import snowflake from 'snowflake-sdk';

interface SnowflakeConfig {
  account: string;
  username: string;
  password?: string;
  authenticator?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
}

export class SnowflakeConnector {
  private connection: snowflake.Connection | null = null;
  private config: SnowflakeConfig;

  constructor(config: SnowflakeConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = snowflake.createConnection(this.config);
      this.connection.connect((err, conn) => {
        if (err) {
          console.error('Failed to connect to Snowflake:', err);
          reject(err);
        } else {
          console.log('Successfully connected to Snowflake');
          resolve();
        }
      });
    });
  }

  async executeQuery<T = any>(sqlText: string): Promise<T[]> {
    if (!this.connection) {
      throw new Error('Not connected to Snowflake. Call connect() first.');
    }

    return new Promise((resolve, reject) => {
      this.connection!.execute({
        sqlText,
        complete: (err, stmt, rows) => {
          if (err) {
            console.error('Failed to execute query:', err);
            reject(err);
          } else {
            resolve(rows as T[]);
          }
        }
      });
    });
  }

  async getAssets(): Promise<any[]> {
    const query = `
      SELECT 
        asset_id,
        asset_name,
        asset_type,
        latitude,
        longitude,
        health_score,
        load_percent,
        usage_kwh
      FROM GRID_COMMAND_PLATFORM.CORE.ASSETS
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
      LIMIT 10000
    `;
    return this.executeQuery(query);
  }

  async getKPIs(): Promise<any> {
    const query = `
      SELECT 
        MAX(CASE WHEN metric_name = 'SAIDI' THEN metric_value END) as saidi,
        MAX(CASE WHEN metric_name = 'SAIFI' THEN metric_value END) as saifi,
        MAX(CASE WHEN metric_name = 'ACTIVE_OUTAGES' THEN metric_value END) as active_outages,
        MAX(CASE WHEN metric_name = 'TOTAL_LOAD_MW' THEN metric_value END) as total_load,
        MAX(CASE WHEN metric_name = 'CREWS_ACTIVE' THEN metric_value END) as crews_active
      FROM GRID_COMMAND_PLATFORM.APPS.KPI_METRICS
      WHERE metric_date = CURRENT_DATE()
    `;
    const results = await this.executeQuery(query);
    return results[0] || {};
  }

  async getOutages(): Promise<any[]> {
    const query = `
      SELECT 
        outage_id,
        latitude,
        longitude,
        customers_affected,
        start_time,
        estimated_restoration
      FROM GRID_COMMAND_PLATFORM.CDC.OUTAGES_LIVE
      WHERE status = 'ACTIVE'
      ORDER BY customers_affected DESC
    `;
    return this.executeQuery(query);
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      return new Promise((resolve, reject) => {
        this.connection!.destroy((err) => {
          if (err) {
            console.error('Failed to disconnect:', err);
            reject(err);
          } else {
            console.log('Disconnected from Snowflake');
            this.connection = null;
            resolve();
          }
        });
      });
    }
  }
}

// For browser-based apps, use REST API instead of direct SDK
export class SnowflakeRESTConnector {
  private baseUrl: string;
  private token: string;

  constructor(accountUrl: string, token: string) {
    this.baseUrl = accountUrl;
    this.token = token;
  }

  async executeQuery<T = any>(sqlText: string, warehouse?: string): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/api/v2/statements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        'X-Snowflake-Authorization-Token-Type': 'OAUTH'
      },
      body: JSON.stringify({
        statement: sqlText,
        timeout: 60,
        warehouse: warehouse || 'GRID_COMMAND_REALTIME_WH'
      })
    });

    if (!response.ok) {
      throw new Error(`Snowflake API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data || [];
  }

  async getAssets(): Promise<any[]> {
    const query = `
      SELECT 
        asset_id,
        asset_name,
        asset_type,
        latitude,
        longitude,
        health_score,
        load_percent,
        usage_kwh
      FROM GRID_COMMAND_PLATFORM.CORE.ASSETS
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
      LIMIT 10000
    `;
    return this.executeQuery(query);
  }

  async getKPIs(): Promise<any> {
    const query = `
      SELECT 
        MAX(CASE WHEN metric_name = 'SAIDI' THEN metric_value END) as saidi,
        MAX(CASE WHEN metric_name = 'SAIFI' THEN metric_value END) as saifi,
        MAX(CASE WHEN metric_name = 'ACTIVE_OUTAGES' THEN metric_value END) as active_outages,
        MAX(CASE WHEN metric_name = 'TOTAL_LOAD_MW' THEN metric_value END) as total_load,
        MAX(CASE WHEN metric_name = 'CREWS_ACTIVE' THEN metric_value END) as crews_active
      FROM GRID_COMMAND_PLATFORM.APPS.KPI_METRICS
      WHERE metric_date = CURRENT_DATE()
    `;
    const results = await this.executeQuery(query);
    return results[0] || {};
  }

  async getOutages(): Promise<any[]> {
    const query = `
      SELECT 
        outage_id,
        latitude,
        longitude,
        customers_affected,
        start_time,
        estimated_restoration
      FROM GRID_COMMAND_PLATFORM.CDC.OUTAGES_LIVE
      WHERE status = 'ACTIVE'
      ORDER BY customers_affected DESC
    `;
    return this.executeQuery(query);
  }
}
