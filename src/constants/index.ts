/**
 * Application-wide constants for Flux Operations Center
 * 
 * Centralizes magic numbers and configuration values for easier tuning
 * and documentation of system limits.
 */

// ============================================================================
// Asset & Data Limits
// ============================================================================

export const LIMITS = {
  /** Maximum assets to load in memory (prevents browser crashes) */
  MAX_ASSETS: 120_000,
  
  /** Maximum topology connections to maintain */
  MAX_TOPOLOGY: 100_000,
  
  /** Threshold for backoff behavior (start culling when exceeded) */
  BACKOFF_THRESHOLD: 100_000,
  
  /** Maximum circuits to track */
  MAX_CIRCUITS: 500,
  
  /** Viewport buffer multiplier for culling (2.0 = 2x viewport) */
  VIEWPORT_BUFFER: 2.0,
  
  /** Aggressive cull buffer (1.2 = 20% beyond viewport) */
  AGGRESSIVE_CULL_BUFFER: 1.2,
  
  /** Minimum time between culling operations (ms) */
  CULL_COOLDOWN_MS: 2000,
  
  /** Protection time after selection before culling (ms) */
  SELECTION_PROTECTION_MS: 5000,
};

// ============================================================================
// Zoom Level Thresholds
// ============================================================================

export const ZOOM_LEVELS = {
  /** Show metro overview (clusters/hexagons) */
  METRO_OVERVIEW: 9,
  
  /** Start showing substations */
  SUBSTATIONS: 10,
  
  /** Show feeder topology */
  FEEDERS: 11,
  
  /** Show transformers */
  TRANSFORMERS: 12,
  
  /** Show poles */
  POLES: 13,
  
  /** Show meters (highest detail) */
  METERS: 14,
  
  /** Show 3D buildings */
  BUILDINGS_3D: 14.5,
  
  /** Power lines LOD thresholds */
  POWER_LINES_LOD: {
    LOW: 10,
    MEDIUM: 12,
    HIGH: 14,
  },
};

// ============================================================================
// API Endpoints
// ============================================================================

export const API_ENDPOINTS = {
  INITIAL_LOAD: '/api/initial-load',
  ASSETS: '/api/assets',
  TOPOLOGY: '/api/topology',
  METRO: '/api/topology/metro',
  FEEDERS: '/api/topology/feeders',
  SERVICE_AREAS: '/api/service-areas',
  WEATHER: '/api/weather',
  SUBSTATION_STATUS: '/api/postgres/substations/status',
  SPATIAL_BUILDINGS: '/api/spatial/layers/buildings',
  SPATIAL_POWER_LINES: '/api/spatial/layers/power-lines',
  SPATIAL_VEGETATION: '/api/spatial/layers/vegetation',
};

// ============================================================================
// Cache TTLs (seconds)
// ============================================================================

export const CACHE_TTL = {
  METRO: 300,
  FEEDERS: 300,
  SERVICE_AREAS: 60,
  KPIS: 30,
  WEATHER: 300,
  SPATIAL_LAYERS: 120,
};

// ============================================================================
// Animation & Timing
// ============================================================================

export const ANIMATION = {
  /** Drag momentum friction coefficient */
  MOMENTUM_FRICTION: 0.92,
  
  /** Minimum velocity to continue momentum animation */
  MOMENTUM_MIN_VELOCITY: 0.5,
  
  /** Fly-to animation duration (ms) */
  FLY_TO_DURATION: 1500,
  
  /** Asset fade-in duration (ms) */
  ASSET_FADE_DURATION: 300,
  
  /** Tooltip debounce delay (ms) */
  TOOLTIP_DEBOUNCE: 50,
  
  /** Viewport change debounce (ms) */
  VIEWPORT_DEBOUNCE: 100,
};

// ============================================================================
// Default Map View
// ============================================================================

export const DEFAULT_VIEW_STATE = {
  longitude: -122.085,
  latitude: 37.4220,
  zoom: 10,
  pitch: 0,
  bearing: 0,
};

// ============================================================================
// Card Dimensions
// ============================================================================

export const CARD_DIMENSIONS = {
  ASSET_CARD_WIDTH: 340,
  ASSET_CARD_HEIGHT: 450,
  SPATIAL_CARD_WIDTH: 340,
  SPATIAL_CARD_HEIGHT: 450,
  MARGIN: 20,
};
