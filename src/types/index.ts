/**
 * Shared TypeScript interfaces and types for Flux Operations Center
 * 
 * This file centralizes type definitions used across the application
 * to enable type-safe component extraction and reduce duplication.
 */

// ============================================================================
// Asset Types
// ============================================================================

export interface Asset {
  id: string;
  name: string;
  type: 'pole' | 'transformer' | 'meter' | 'substation' | 'aggregate';
  latitude: number;
  longitude: number;
  health_score?: number;
  load_percent?: number;
  usage_kwh?: number;
  voltage?: string;
  status?: string;
  last_maintenance?: string;
  commissioned_date?: string;
  pole_height_ft?: number;
  circuit_id?: string;
  loadedAt?: number;
  rotation_rad?: number;
  // Transformer-specific
  capacity_kva?: number;
  customer_count?: number;
  avg_usage?: number;
  // Meter-specific
  customer_segment?: string;
  parent_transformer_id?: string;
  // Engineering: Location context for field crews
  city?: string;
  zip_code?: string;
  county?: string;
  service_address?: string;  // For meters - actual customer address
  customer_name?: string;    // For meters - customer served
  // Engineering: Customer impact metrics
  connected_customers?: number;  // Customers affected if this asset fails
  circuits_served?: number;      // For substations - number of circuits fed
  // Substation-specific
  capacity_mva?: number;
  substation_name?: string;
  // Aggregate asset type for clustering
  healthByType?: {
    substations: { critical: number; warning: number; healthy: number };
    transformers: { critical: number; warning: number; healthy: number };
    poles: { critical: number; warning: number; healthy: number };
    meters: { critical: number; warning: number; healthy: number };
  };
}

export interface SubstationStatus {
  substation_id: string;
  status: 'healthy' | 'warning' | 'critical' | null;
  load_percent: number | null;
  health_score: number | null;
  last_updated?: string;
}

// ============================================================================
// Spatial Object Types
// ============================================================================

export interface SpatialBuilding {
  id: string;
  type: 'building';
  building_name?: string;
  building_type?: string;
  height_meters?: number;
  num_floors?: number;
  footprint_area_sqm?: number;
  address?: string;
  centroid?: [number, number];
  // Engineering: Location context
  latitude?: number;
  longitude?: number;
  city?: string;
  zip_code?: string;
  county?: string;
}

export interface SpatialPowerLine {
  id: string;
  type: 'power_line';
  line_name?: string;
  voltage_kv?: number;
  length_km?: number;
  conductor_type?: string;
  installation_year?: number;
  coordinates: number[][];
  class?: string;
  // Connected assets (loaded on demand when selecting power line)
  connected_assets?: ConnectedAsset[];
}

export interface ConnectedAsset {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  health_score?: number;
  load_percent?: number;
  circuit_id?: string;
  distance_m?: number;
}

export interface SpatialVegetation {
  id: string;
  type: 'vegetation';
  species?: string;
  height_m?: number;
  canopy_height?: number;
  canopy_radius_m?: number;
  risk_score?: number;
  risk_level?: 'critical' | 'warning' | 'monitor' | 'safe';
  proximity_risk?: number;
  distance_to_line_m?: number;
  nearest_line_id?: string;
  nearest_line_voltage_kv?: number;
  clearance_deficit_m?: number;
  years_to_encroachment?: number;
  data_source?: string;
  latitude: number;
  longitude: number;
}

export type SpatialObject = SpatialBuilding | SpatialPowerLine | SpatialVegetation;

// ============================================================================
// Topology Types
// ============================================================================

export interface TopologyLink {
  from_asset_id: string;
  to_asset_id: string;
  connection_type: string;
  from_latitude: number;
  from_longitude: number;
  to_latitude: number;
  to_longitude: number;
}

// ============================================================================
// Batch Types (for progressive loading)
// ============================================================================

export interface CircuitBatch {
  batchId: string;
  circuitIds: string[];
  assets: Asset[];
  loadedAt: number;
}

export interface TopologyBatch {
  batchId: string;
  circuitIds: string[];
  connections: TopologyLink[];
  loadedAt: number;
  viewportCenter: { lng: number; lat: number; zoom?: number };
}

// ============================================================================
// Clustering Types
// ============================================================================

export interface AssetCluster {
  id: string;
  center: { lng: number; lat: number };
  assets: Asset[];
  count: number;
  avgHealth: number;
  avgLoad: number;
  substationIds: Set<string>;
  worstStatus: 'healthy' | 'warning' | 'critical';
  byType: {
    substation: number;
    transformer: number;
    pole: number;
    meter: number;
  };
}

// ============================================================================
// UI Types
// ============================================================================

export interface PinnedAsset {
  asset: Asset;
  position: { x: number; y: number };
  id: string;
  collapsed: boolean;
}

export interface PinnedSpatialObject {
  object: SpatialObject;
  position: { x: number; y: number };
  id: string;
  collapsed: boolean;
}

// ============================================================================
// API Response Types (for mapping raw data to typed objects)
// ============================================================================

/** Raw asset row from API response */
export interface AssetRow {
  ASSET_ID: string;
  ASSET_NAME: string;
  ASSET_TYPE: string;
  LATITUDE: number;
  LONGITUDE: number;
  HEALTH_SCORE?: number;
  LOAD_PERCENT?: number;
  USAGE_KWH?: number;
  VOLTAGE?: string;
  STATUS?: string;
  LAST_MAINTENANCE?: string;
  COMMISSIONED_DATE?: string;
  POLE_HEIGHT_FT?: number;
  CIRCUIT_ID?: string;
  CAPACITY_KVA?: number;
  CUSTOMER_COUNT?: number;
  AVG_USAGE?: number;
  CUSTOMER_SEGMENT?: string;
  PARENT_TRANSFORMER_ID?: string;
  ROTATION_RAD?: number;
  // Engineering: Location context
  CITY?: string;
  ZIP_CODE?: string;
  COUNTY?: string;
  SERVICE_ADDRESS?: string;
  CUSTOMER_NAME?: string;
  // Engineering: Customer impact metrics
  CONNECTED_CUSTOMERS?: number;
  CIRCUITS_SERVED?: number;
  // Substation-specific
  CAPACITY_MVA?: number;
  SUBSTATION_NAME?: string;
}

/** Raw topology row from API response */
export interface TopologyRow {
  FROM_ASSET_ID: string;
  TO_ASSET_ID: string;
  CONNECTION_TYPE: string;
  FROM_LAT: number;
  FROM_LON: number;
  TO_LAT: number;
  TO_LON: number;
}

/** Raw substation row from metro API */
export interface MetroSubstationRow {
  SUBSTATION_ID: string;
  SUBSTATION_NAME: string;
  LATITUDE: number;
  LONGITUDE: number;
  CAPACITY_MW?: number;
  VOLTAGE_KV?: number;
  STATUS?: string;
  HEALTH_SCORE?: number;
  LOAD_PERCENT?: number;
  AVG_LOAD_PCT?: number;
}

// ============================================================================
// Weather & Service Area Types
// ============================================================================

export interface WeatherData {
  hour: number;
  timestamp?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  precipitation?: number;
  conditions?: string;
  latitude?: number;
  longitude?: number;
}

export interface ServiceArea {
  CIRCUIT_ID: string;
  SUBSTATION_ID: string;
  CIRCUIT_NAME?: string;
  SUBSTATION_NAME?: string;
  CUSTOMER_COUNT?: number;
  TOTAL_LOAD_KW?: number;
  STATUS?: string;
  CENTROID_LAT?: number;
  CENTROID_LON?: number;
}

// ============================================================================
// Feeder Topology Types
// ============================================================================

export interface FeederConnection {
  FROM_SUBSTATION_ID: string;
  TO_SUBSTATION_ID: string;
  FROM_LAT: number;
  FROM_LON: number;
  TO_LAT: number;
  TO_LON: number;
  FEEDER_TYPE?: string;
  CAPACITY_MW?: number;
  LOAD_UTILIZATION_PCT?: number;
  RATED_KVA?: number;
  DISTANCE_KM?: number;
  VOLTAGE_LEVEL?: string;
}

// ============================================================================
// deck.gl Layer Data Types
// ============================================================================

/** Data for hexagon/cluster visualization */
export interface HexagonTileData {
  position: [number, number];
  radius: number;
  operationalStatus?: 'healthy' | 'warning' | 'critical';
  avgLoad?: number;
  asset: {
    id: string;
    avgHealth: number;
    avgLoad: number;
    worstStatus: 'healthy' | 'warning' | 'critical';
    count: number;
    byType: {
      substation: number;
      transformer: number;
      pole: number;
      meter: number;
    };
  };
}

/** Data for heatmap points */
export interface HeatmapPoint {
  position: [number, number];
  weight: number;
}

/** Aggregate tower data for clustering visualization */
export interface AggregateTower {
  position: [number, number];
  radius: number;
  asset: {
    id: string;
    avgHealth: number;
    avgLoad: number;
    worstStatus: 'healthy' | 'warning' | 'critical';
    count: number;
    byType: {
      substation: number;
      transformer: number;
      pole: number;
      meter: number;
    };
  };
}

// ============================================================================
// deck.gl Event Types
// ============================================================================

/** Pick info from deck.gl layer interaction */
export interface DeckPickInfo<T = unknown> {
  object?: T;
  x: number;
  y: number;
  coordinate?: [number, number];
  layer?: { id: string };
  index?: number;
}

// ============================================================================
// View State Types
// ============================================================================

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  minPitch?: number;
  maxPitch?: number;
  minZoom?: number;
  maxZoom?: number;
  transitionDuration?: number;
  transitionInterpolator?: unknown;
}

// ============================================================================
// Substation Aggregation Types (for clustering)
// ============================================================================

export interface SubstationAggregate {
  substation: Asset;
  circuits: AssetCluster[];
  allAssets: Asset[];
  transformers: Asset[];
  poles: Asset[];
  meters: Asset[];
}

// ============================================================================
// API Data Response Types
// ============================================================================

export interface InitialDataResponse {
  assets?: AssetRow[];
  topology?: TopologyRow[];
  metro?: MetroSubstationRow[];
  service_areas?: ServiceArea[];
  feeders?: FeederConnection[];
  weather?: WeatherData[];
  kpis?: {
    TOTAL_CUSTOMERS?: number;
    ACTIVE_OUTAGES?: number;
    TOTAL_LOAD_MW?: number;
    CREWS_ACTIVE?: number;
    AVG_RESTORATION_MINUTES?: number;
  };
  timing?: Record<string, number>;
  cache_hits?: number;
}

// ============================================================================
// GeoJSON Types
// ============================================================================

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties?: {
    building_type?: string;
    height_meters?: number;
    [key: string]: unknown;
  };
}

// ============================================================================
// Spatial Data State
// ============================================================================

export interface SpatialDataState {
  buildings: SpatialBuilding[];
  powerLines: SpatialPowerLine[];
  vegetation: SpatialVegetation[];
}

// ============================================================================
// Color Constants
// ============================================================================

export const COLORS = {
  substation: { main: '#FBBF24', text: '#FBBF24', chip: 'rgba(251,191,36,0.12)' },
  transformer: { main: '#22C55E', text: '#22C55E', chip: 'rgba(34,197,94,0.12)' },
  pole: { main: '#8880ff', text: '#8880ff', chip: 'rgba(136,128,255,0.12)' },
  meter: { main: '#9333EA', text: '#9333EA', chip: 'rgba(147,51,234,0.12)' },
  powerLine: { main: '#FFD93D', secondary: '#FF8C42' },
  building: { main: '#64748B' },
  vegetation: { main: '#22C55E' },
  // Cascade analysis colors
  cascade: {
    patientZero: '#FF0000',       // Red for initial failure point
    waveColors: ['#FF4500', '#FF6600', '#FF8800', '#FFAA00', '#FFCC00'],  // Orange gradient for cascade waves
    propagationPath: '#FF6B6B',   // Coral for cascade paths
    atRisk: '#FF9500',            // Orange for at-risk nodes
    safe: '#22C55E',              // Green for safe nodes
  }
};

// ============================================================================
// Cascade Analysis Types (GridGuard Integration)
// ============================================================================

/** Grid node for cascade analysis */
export interface CascadeNode {
  node_id: string;
  node_name: string;
  node_type: 'SUBSTATION' | 'TRANSFORMER';
  lat: number | null;
  lon: number | null;
  region: string | null;
  capacity_kw: number;
  voltage_kv: number;
  criticality_score: number;
  downstream_transformers: number;
  downstream_capacity_kva: number;
  // Cascade simulation fields
  cascade_risk?: number;
  failure_order?: number;
  failure_probability?: number;
  triggered_by?: string;
}

/** Grid edge for cascade topology */
export interface CascadeEdge {
  edge_id: number;
  from_node: string;
  to_node: string;
  edge_type: 'DISTRIBUTION' | 'CIRCUIT_PEER';
  circuit_id: string | null;
  distance_km: number;
  impedance_pu: number;
}

/** Grid topology for cascade visualization */
export interface CascadeTopology {
  nodes: CascadeNode[];
  edges: CascadeEdge[];
}

/** Cascade propagation path for visualization */
export interface CascadePropagationPath {
  from_node: string;
  to_node: string;
  order: number;
  distance_km: number;
}

/** Cascade simulation scenario */
export interface CascadeScenario {
  name: string;
  description: string;
  parameters: {
    temperature_c: number;
    load_multiplier: number;
    failure_threshold: number;
  };
  historical_reference?: string;
}

/** Cascade simulation result */
export interface CascadeResult {
  scenario_name: string;
  patient_zero: CascadeNode;
  cascade_order: Array<CascadeNode & { order: number; wave_depth?: number }>;
  total_affected_nodes: number;
  affected_capacity_mw: number;
  estimated_customers_affected: number;
  simulation_timestamp: string;
  propagation_paths: CascadePropagationPath[];
  // Enhanced metrics for Sankey diagram
  wave_breakdown?: CascadeWaveBreakdown[];
  node_type_breakdown?: CascadeNodeTypeBreakdown[];
  max_cascade_depth?: number;
}

/** Cascade wave breakdown for Sankey diagram */
export interface CascadeWaveBreakdown {
  wave_number: number;
  nodes_failed: number;
  capacity_lost_mw: number;
  customers_affected: number;
  substations: number;
  transformers: number;
}

/** Node type breakdown for Sankey diagram */
export interface CascadeNodeTypeBreakdown {
  source: string;  // 'Patient Zero' | 'Wave 1' | etc.
  target: string;  // 'Substations' | 'Transformers' | 'Customers'
  value: number;   // Count or capacity
}

/** Transformer risk prediction */
export interface TransformerRiskPrediction {
  transformer_id: string;
  lat: number | null;
  lon: number | null;
  substation_id: string;
  morning_load_pct: number;
  morning_category: string;
  age_years: number;
  rated_kva: number;
  historical_avg_load: number;
  stress_vs_historical: number;
  actual_high_risk: number | null;
  predicted_risk: number;
  risk_level: 'critical' | 'warning' | 'elevated';
}

/** Cortex explanation response */
export interface CortexExplanation {
  explanation: string;
  explanation_type: 'summary' | 'patient_zero' | 'wave_analysis' | 'recommendations';
  model: string;
  query_time_ms: number;
  powered_by: string;
}

/** ML metadata for cascade analysis */
export interface CascadeMLMetadata {
  models: {
    graph_centrality: {
      name: string;
      platform: string;
      description: string;
      node_count: number;
      last_updated: string;
    };
    temporal_risk_prediction: {
      name: string;
      platform: string;
      description: string;
      features: string[];
      target_accuracy: string;
    };
    cascade_simulation: {
      name: string;
      platform: string;
      description: string;
    };
    explainability: {
      name: string;
      platform: string;
      model: string;
    };
  };
  snowflake_features_used: string[];
}
