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
  type: 'pole' | 'transformer' | 'meter' | 'substation';
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
  risk_score?: number;
  proximity_risk?: number;
  distance_to_line_m?: number;
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
  STATUS?: string;
  HEALTH_SCORE?: number;
  LOAD_PERCENT?: number;
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
};
