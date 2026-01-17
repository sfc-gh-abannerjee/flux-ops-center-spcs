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
