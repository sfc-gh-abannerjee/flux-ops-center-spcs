import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, ArcLayer, PolygonLayer, BitmapLayer, PathLayer, TextLayer, IconLayer } from '@deck.gl/layers';
import { HeatmapLayer, GridLayer } from '@deck.gl/aggregation-layers';
import { MVTLayer } from '@deck.gl/geo-layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import { FlyToInterpolator, COORDINATE_SYSTEM, WebMercatorViewport } from '@deck.gl/core';
import { Map as MapGL } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { 
  ThemeProvider, createTheme, CssBaseline, Box, AppBar, Toolbar, Typography, 
  Tabs, Tab, Grid, Card, CardContent, Paper, Chip, Stack, IconButton, 
  Switch, FormControlLabel, Divider, Badge, alpha, Fade, Grow, Collapse, Button, LinearProgress, Tooltip
} from '@mui/material';
import { 
  ElectricBolt, Assessment, Warning, Engineering, TrendingUp,
  Speed, Memory, NetworkCheck, FilterList, Close, Refresh, ExpandMore, ExpandLess,
  MyLocation, ZoomIn, GridOn, BarChart, PieChart, PushPin, FavoriteOutlined, ElectricMeter,
  Whatshot, WbSunny, Thermostat, Opacity, SkipPrevious, FastRewind, PlayArrow, Pause, 
  FastForward, SkipNext, Layers, Power, Hub, Park, Business, ElectricalServices
} from '@mui/icons-material';
import ChatDrawer from './ChatDrawer';
import DraggableFab from './DraggableFab';
import { LAYOUT } from './layoutConstants';
import 'maplibre-gl/dist/maplibre-gl.css';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#0EA5E9' },
    secondary: { main: '#FBBF24' },
    background: { default: '#0F172A', paper: '#1E293B' },
    success: { main: '#22C55E' },
    error: { main: '#EF4444' },
    warning: { main: '#F59E0B' },
    info: { main: '#3B82F6' }
  },
  typography: { fontFamily: 'Inter, system-ui, sans-serif' },
  components: {
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
      }
    }
  }
});

const BASEMAP_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// deck.gl v9: Use PolygonLayer instead of ColumnLayer for extruded shapes
// ColumnLayer has rendering issues in v9 (missing faces/sides)
// PolygonLayer with extruded:true renders correctly

// Polygon generators for different shapes (return closed polygon coordinates)
const HOUSTON_LAT = 29.7604;
const METERS_TO_DEG_LON = 1 / 111320 / Math.cos(HOUSTON_LAT * Math.PI / 180);
const METERS_TO_DEG_LAT = 1 / 110540;

// Rotation from backend is computed from nearest power line bearing (PostGIS ST_Azimuth)
// Fallback to 0 (north-aligned) if no rotation data available
function getSquarePolygon(centerLon: number, centerLat: number, sizeMeters: number, rotation: number = 0): number[][] {
  const halfLon = (sizeMeters * METERS_TO_DEG_LON) / 2;
  const halfLat = (sizeMeters * METERS_TO_DEG_LAT) / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  
  const corners = [
    [-halfLon, -halfLat],
    [halfLon, -halfLat],
    [halfLon, halfLat],
    [-halfLon, halfLat]
  ];
  
  return [
    ...corners.map(([dx, dy]) => [
      centerLon + dx * cos - dy * sin,
      centerLat + dx * sin + dy * cos
    ]),
    [centerLon + corners[0][0] * cos - corners[0][1] * sin, 
     centerLat + corners[0][0] * sin + corners[0][1] * cos]
  ];
}

function getPolygonShape(centerLon: number, centerLat: number, sizeMeters: number, sides: number, rotation: number = 0): number[][] {
  const radiusLon = (sizeMeters * METERS_TO_DEG_LON) / 2;
  const radiusLat = (sizeMeters * METERS_TO_DEG_LAT) / 2;
  const vertices: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 / sides) * i + rotation;
    vertices.push([
      centerLon + radiusLon * Math.cos(angle),
      centerLat + radiusLat * Math.sin(angle)
    ]);
  }
  vertices.push(vertices[0]);
  return vertices;
}

function getOctagonPolygon(centerLon: number, centerLat: number, sizeMeters: number, rotation: number = 0): number[][] {
  return getPolygonShape(centerLon, centerLat, sizeMeters, 8, rotation);
}

// PERFORMANCE: Pre-compute common colors to avoid alpha() calls in render
const COLORS = {
  substation: {
    main: '#00C8FF',
    bg: alpha('#00C8FF', 0.05),
    chip: alpha('#00C8FF', 0.15),
    border: alpha('#00C8FF', 0.3)
  },
  transformer: {
    main: '#EC4899',
    bg: alpha('#EC4899', 0.05),
    chip: alpha('#EC4899', 0.15),
    border: alpha('#EC4899', 0.3)
  },
  pole: {
    main: '#8880ff',
    bg: alpha('#8880ff', 0.05),
    chip: alpha('#8880ff', 0.15),
    border: alpha('#8880ff', 0.3)
  },
  meter: {
    main: '#9333EA',
    bg: alpha('#9333EA', 0.05),
    chip: alpha('#9333EA', 0.15),
    border: alpha('#9333EA', 0.3)
  },
  status: {
    critical: { main: '#EF4444', chip: alpha('#EF4444', 0.15) },
    warning: { main: '#FBBF24', chip: alpha('#FBBF24', 0.15) },
    healthy: { main: '#22C55E', chip: alpha('#22C55E', 0.15) }
  }
} as const;

const INITIAL_VIEW_STATE = {
  longitude: -95.3698,
  latitude: 29.7604,
  zoom: 9.5,  // Zoom out to show full Houston metro area (real utility data spans lat 28.94-30.48, lon -96.04 to -94.36)
  pitch: 45,
  bearing: 0,
  minPitch: 0,
  maxPitch: 45,  // deck.gl default is 60°, but 45° prevents basemap desync in 3D views
  minZoom: 8,    // Prevent zooming out too far (was 0)
  maxZoom: 18    // Reasonable max for infrastructure detail (was 24)
};
interface AssetCluster {
  centroid: [number, number];
  assets: Asset[];
  substations: Asset[];
  transformers: Asset[];
  poles: Asset[];
  meters: Asset[];
  districtId?: string; // CNP-style service district ID (e.g., "BA-SD1", "AD-SD2")
}

// ENGINEERING: Substation-based operational clustering
// PROBLEM: Old approach used arbitrary 1km grid squares (unrealistic for utility operations)
// SOLUTION: Cluster assets by substation service areas (natural operational boundaries)
// BENEFIT: Aligns with utility actual grid management structure (competing with Grid 360)

// Helper: Generate CNP-style substation code (e.g., "BAMMEL" → "BA", "ALDINE" → "AD")
function generateSubstationCode(substationName: string): string {
  // Extract first letters of each word, max 3 characters
  const words = substationName.toUpperCase().split(/[\s_-]+/);
  if (words.length === 1) {
    return words[0].substring(0, 3);
  }
  // Take first letter of first 2-3 words
  return words.slice(0, Math.min(3, words.length)).map(w => w[0]).join('');
}

// Geographic subdivision helper - splits oversized clusters into service districts
function subdivideClusterGeographically(cluster: AssetCluster, numDistricts: number): AssetCluster[] {
  if (cluster.assets.length <= 1 || numDistricts <= 1) {
    return [cluster];
  }
  
  // K-means clustering to create geographic service districts within substation territory
  const assets = cluster.assets.filter(a => a.type !== 'substation'); // Exclude parent substation
  const centroids: [number, number][] = [];
  
  // Initialize centroids using k-means++ for better distribution
  centroids.push([assets[0].latitude, assets[0].longitude]);
  
  for (let i = 1; i < numDistricts && i < assets.length; i++) {
    let maxMinDist = -1;
    let bestAsset = assets[i];
    
    for (const asset of assets) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = Math.sqrt(
          Math.pow(asset.latitude - centroid[0], 2) + 
          Math.pow(asset.longitude - centroid[1], 2)
        );
        minDist = Math.min(minDist, dist);
      }
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestAsset = asset;
      }
    }
    centroids.push([bestAsset.latitude, bestAsset.longitude]);
  }
  
  // Assign assets to nearest centroid
  // Generate substation code for service district naming
  const substationCode = cluster.substations.length > 0 
    ? generateSubstationCode(cluster.substations[0].name)
    : 'GC'; // Fallback to "GC" (Grid Cell) if no substation
  
  const districts: AssetCluster[] = centroids.map((centroid, idx) => ({
    centroid: [centroid[1], centroid[0]], // [lon, lat] for deck.gl
    assets: [],
    substations: cluster.substations, // Service districts reference parent substation
    transformers: [],
    poles: [],
    meters: [],
    // CNP-style service district ID: {SUBSTATION_CODE}-SD{NUMBER}
    districtId: `${substationCode}-SD${idx + 1}`
  }));
  
  assets.forEach(asset => {
    let nearestDistrict = 0;
    let minDist = Infinity;
    
    for (let i = 0; i < centroids.length; i++) {
      const dist = Math.sqrt(
        Math.pow(asset.latitude - centroids[i][0], 2) + 
        Math.pow(asset.longitude - centroids[i][1], 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestDistrict = i;
      }
    }
    
    const district = districts[nearestDistrict];
    district.assets.push(asset);
    
    // Categorize by asset type
    if (asset.type === 'transformer') {
      district.transformers.push(asset);
    } else if (asset.type === 'pole') {
      district.poles.push(asset);
    } else if (asset.type === 'meter') {
      district.meters.push(asset);
    }
  });
  
  // Recalculate district centroids based on actual asset positions
  districts.forEach(district => {
    if (district.assets.length > 0) {
      const avgLat = district.assets.reduce((sum, a) => sum + a.latitude, 0) / district.assets.length;
      const avgLon = district.assets.reduce((sum, a) => sum + a.longitude, 0) / district.assets.length;
      district.centroid = [avgLon, avgLat];
    }
  });
  
  // Filter out empty districts
  return districts.filter(d => d.assets.length > 0);
}

function substationBasedClustering(substations: Asset[], transformers: Asset[], poles: Asset[], meters: Asset[]): AssetCluster[] {
  // INSIGHT: Utilities organize operations by substations (not arbitrary geographic grids)
  // Each substation serves ~5,000-10,000 customers and defines a natural operational zone
  
  // Haversine distance calculation for accurate geospatial clustering
  const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };
  
  // PERFORMANCE: Fast squared distance approximation for initial filtering
  // Avoids expensive trig operations for obvious non-matches
  const fastDistanceSquared = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    return dLat * dLat + dLon * dLon;
  };
  
  // Create operational clusters centered on each substation
  const clusters: AssetCluster[] = substations.map(substation => ({
    centroid: [substation.longitude, substation.latitude],
    assets: [substation], // Include the substation itself
    substations: [substation],
    transformers: [],
    poles: [],
    meters: []
  }));
  
  // If no substations exist, fall back to geographic clustering
  if (substations.length === 0) {
    return gridBinAssets([...transformers, ...poles, ...meters], 0.01);
  }
  
  // REALISTIC DISTRIBUTION: CNP-style service area boundaries with distance weighting
  // Edge substations have smaller service areas (sparser), central have larger (denser)
  // Distance penalty prevents edge substations from "vacuuming up" outlying assets
  const MAX_SERVICE_RADIUS_KM = 25; // Extended for outlying areas
  const MAX_RADIUS_SQUARED = 0.25; // ~25km in rough degree² units for fast filtering
  
  // PERFORMANCE: Unified asset assignment function
  const assignAssetsToNearestCluster = (assets: Asset[], targetArray: 'transformers' | 'poles' | 'meters') => {
    assets.forEach(asset => {
      let nearestClusterIdx = -1;
      let minDistanceSquared = Infinity;
      
      // OPTIMIZATION 1: Fast squared distance pre-filter
      for (let i = 0; i < clusters.length; i++) {
        const substation = clusters[i].substations[0];
        const distSq = fastDistanceSquared(
          asset.latitude, asset.longitude,
          substation.latitude, substation.longitude
        );
        
        if (distSq < minDistanceSquared && distSq < MAX_RADIUS_SQUARED) {
          minDistanceSquared = distSq;
          nearestClusterIdx = i;
        }
      }
      
      // OPTIMIZATION 2: Only calculate expensive haversine for nearest candidate
      if (nearestClusterIdx !== -1) {
        const nearestCluster = clusters[nearestClusterIdx];
        const exactDistance = haversineDistance(
          asset.latitude, asset.longitude,
          nearestCluster.substations[0].latitude, nearestCluster.substations[0].longitude
        );
        
        if (exactDistance <= MAX_SERVICE_RADIUS_KM) {
          nearestCluster[targetArray].push(asset);
          nearestCluster.assets.push(asset);
        }
      }
    });
  };
  
  // Assign all asset types using optimized function
  assignAssetsToNearestCluster(transformers, 'transformers');
  assignAssetsToNearestCluster(poles, 'poles');
  assignAssetsToNearestCluster(meters, 'meters');
  
  // SERVICE DISTRICT SUBDIVISION: Split oversized clusters into geographic zones
  // Realistic distribution: Average ~720 assets/substation, max ~1800 (2.5x avg) before subdivision
  const SUBDIVISION_THRESHOLD = 1800;
  const finalClusters: AssetCluster[] = [];
  
  clusters.forEach(cluster => {
    if (cluster.assets.length <= SUBDIVISION_THRESHOLD) {
      // Cluster is reasonably sized - keep as-is
      finalClusters.push(cluster);
    } else {
      // Oversized cluster - subdivide into geographic service districts
      const numDistricts = Math.ceil(cluster.assets.length / 900); // Target ~900 assets per district
      const districts = subdivideClusterGeographically(cluster, numDistricts);
      finalClusters.push(...districts);
    }
  });
  
  // Log operational clustering results with subdivision statistics
  const totalAssigned = finalClusters.reduce((sum, c) => sum + c.assets.length, 0);
  const totalAssets = transformers.length + poles.length + meters.length;
  const subdivisionInfo = finalClusters.length > clusters.length ? 
    ` (${finalClusters.length - clusters.length} service districts created)` : '';
  
  // Disable clustering logs in production for performance
  // To enable: set localStorage.debug = 'flux:clustering' in console
  
  return finalClusters;
}

// LEGACY: Keep old gridBinAssets as fallback for non-substation scenarios
function gridBinAssets(assets: Asset[], cellSize: number = 0.01): AssetCluster[] {
  // cellSize in degrees (~1km at Houston latitude)
  const gridMap = new Map<string, AssetCluster>();

  assets.forEach(asset => {
    // Calculate grid cell coordinates
    const cellX = Math.floor(asset.longitude / cellSize);
    const cellY = Math.floor(asset.latitude / cellSize);
    const cellKey = `${cellX},${cellY}`;

    if (!gridMap.has(cellKey)) {
      // Initialize new grid cell with centroid at cell center
      gridMap.set(cellKey, {
        centroid: [
          (cellX + 0.5) * cellSize,
          (cellY + 0.5) * cellSize
        ],
        assets: [],
        substations: [],
        transformers: [],
        poles: [],
        meters: []
      });
    }

    const cell = gridMap.get(cellKey)!;
    cell.assets.push(asset);
    
    // Case-insensitive type matching
    const assetType = asset.type?.toLowerCase();
    if (assetType === 'substation') cell.substations.push(asset);
    if (assetType === 'transformer') cell.transformers.push(asset);
    if (assetType === 'pole') cell.poles.push(asset);
    if (assetType === 'meter') cell.meters.push(asset);
  });

  return Array.from(gridMap.values());
}

function getJitteredPosition(asset: Asset, jitterDistance: number): [number, number] {
  const hash = asset.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const angleRadians = ((hash % 360) * Math.PI) / 180;
  const lonOffset = jitterDistance * Math.cos(angleRadians);
  const latOffset = jitterDistance * Math.sin(angleRadians);
  return [asset.longitude + lonOffset, asset.latitude + latOffset];
}

// Helper function to generate rectangular prism polygon (for transformers)
function getRectangularPrism(centerLon: number, centerLat: number, widthMeters: number, depthMeters: number): number[][] {
  // Convert meters to approximate degrees (rough approximation at Houston latitude ~30°)
  const metersToDegreesLon = 1 / 111320 / Math.cos(29.7604 * Math.PI / 180);
  const metersToDegreesLat = 1 / 110540;
  
  const halfWidth = (widthMeters * metersToDegreesLon) / 2;
  const halfDepth = (depthMeters * metersToDegreesLat) / 2;
  
  return [
    [centerLon - halfWidth, centerLat - halfDepth],
    [centerLon + halfWidth, centerLat - halfDepth],
    [centerLon + halfWidth, centerLat + halfDepth],
    [centerLon - halfWidth, centerLat + halfDepth],
    [centerLon - halfWidth, centerLat - halfDepth] // Close the polygon
  ];
}

// Helper function to generate cube polygon (square base for extruded cube)
function getCubePolygon(centerLon: number, centerLat: number, sizeMeters: number): number[][] {
  return getRectangularPrism(centerLon, centerLat, sizeMeters, sizeMeters);
}

// Helper function to generate pyramid polygon (triangular base)
function getPyramidPolygon(centerLon: number, centerLat: number, sizeMeters: number): number[][] {
  const metersToDegreesLon = 1 / 111320 / Math.cos(29.7604 * Math.PI / 180);
  const metersToDegreesLat = 1 / 110540;
  
  const halfSize = (sizeMeters * metersToDegreesLon) / 2;
  const height = halfSize * Math.sqrt(3); // Equilateral triangle height
  
  return [
    [centerLon, centerLat + height * 2/3], // Top vertex
    [centerLon - halfSize, centerLat - height * 1/3], // Bottom left
    [centerLon + halfSize, centerLat - height * 1/3], // Bottom right
    [centerLon, centerLat + height * 2/3] // Close the polygon
  ];
}

// Helper function to generate hexagon polygon (for substations and poles)
function getHexagonPolygon(centerLon: number, centerLat: number, sizeMeters: number, rotation: number = 0): number[][] {
  const metersToDegreesLon = 1 / 111320 / Math.cos(29.7604 * Math.PI / 180);
  const metersToDegreesLat = 1 / 110540;
  
  const radiusLon = (sizeMeters * metersToDegreesLon) / 2;
  const radiusLat = (sizeMeters * metersToDegreesLat) / 2;
  
  const vertices: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + rotation; // 60 degrees between vertices + rotation
    vertices.push([
      centerLon + radiusLon * Math.cos(angle),
      centerLat + radiusLat * Math.sin(angle)
    ]);
  }
  vertices.push(vertices[0]); // Close the polygon
  
  return vertices;
}

interface Asset {
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
  circuit_id?: string;  // CIRCUIT_ID from source tables for utility-grade clustering
  loadedAt?: number;  // Timestamp for fade-in animation
  rotation_rad?: number;  // Rotation from nearest power line bearing (computed by PostGIS)
}

interface SubstationStatus {
  substation_id: string;
  status: 'healthy' | 'warning' | 'critical' | null;
  load_percent: number | null;
  health_score: number | null;
  last_updated?: string;
}

interface SpatialBuilding {
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

interface SpatialPowerLine {
  id: string;
  type: 'power_line';
  line_name?: string;
  voltage_kv?: number;
  length_km?: number;
  conductor_type?: string;
  installation_year?: number;
  coordinates: number[][];
}

interface SpatialVegetation {
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

interface TopologyLink {
  from_asset_id: string;
  to_asset_id: string;
  connection_type: string;
  from_latitude: number;
  from_longitude: number;
  to_latitude: number;
  to_longitude: number;
}

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: number;
  sx?: any;
}

function KPICard({ title, value, subtitle, icon, color, trend, sx }: KPICardProps) {
  return (
    <Card sx={{ height: '100%', bgcolor: 'background.paper', borderLeft: `3px solid ${color}`, ...sx }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="overline" sx={{ fontSize: '0.65rem', letterSpacing: 0.5 }} color="text.secondary" fontWeight={600}>{title}</Typography>
          <Box sx={{ color, fontSize: 16 }}>{icon}</Box>
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.75rem', lineHeight: 1.2 }}>{value}</Typography>
        {subtitle && <Typography variant="caption" sx={{ fontSize: '0.7rem' }} color="text.secondary">{subtitle}</Typography>}
        {trend !== undefined && (
          <Chip 
            label={`${trend > 0 ? '+' : ''}${trend}%`} 
            size="small" 
            sx={{ 
              mt: 0.5,
              height: 18,
              fontSize: '0.65rem',
              bgcolor: trend > 0 ? alpha('#22C55E', 0.2) : alpha('#EF4444', 0.2),
              color: trend > 0 ? '#22C55E' : '#EF4444',
              fontWeight: 600
            }} 
          />
        )}
      </CardContent>
    </Card>
  );
}

function App() {
  const [currentTab, setCurrentTab] = useState(0);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [fabPosition, setFabPosition] = useState({ x: window.innerWidth - 100, y: window.innerHeight - 100 });
  const [fabSpinning, setFabSpinning] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSpinning, setIsSpinning] = useState(true);
  const [isSlowingDown, setIsSlowingDown] = useState(false);
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());
  // CHUNKED LAYER ARCHITECTURE: Track circuit batches separately to avoid GPU buffer regeneration
  // Each batch maintains stable data reference - only new batches trigger buffer creation
  type CircuitBatch = {
    batchId: string;           // Unique identifier for this batch
    circuitIds: string[];      // Circuits included in this batch
    assets: Asset[];           // Assets for this batch (stable reference)
    loadedAt: number;          // Timestamp when batch was loaded
  };
  const [circuitBatches, setCircuitBatches] = useState<CircuitBatch[]>([]);
  
  // BATCHED TOPOLOGY: Track topology batches to prevent replacement on new loads
  type TopologyBatch = {
    batchId: string;
    circuitIds: string[];
    connections: TopologyLink[];
    loadedAt: number;
    viewportCenter: { lng: number; lat: number; zoom?: number };  // Track where (and at what zoom) this was loaded from
  };
  const [topologyBatches, setTopologyBatches] = useState<TopologyBatch[]>([]);
  
  // BATCHED RENDERING: Derive asset type arrays directly from circuitBatches
  // This avoids flattening and re-filtering, preserving batch structure for GPU optimization
  const { substationAssets, transformerAssets, poleAssets, meterAssets } = useMemo(() => {
    const filtered = {
      substationAssets: [] as Asset[],
      transformerAssets: [] as Asset[],
      poleAssets: [] as Asset[],
      meterAssets: [] as Asset[]
    };
    
    // Extract by type from each batch (maintains batch association for later filtering)
    circuitBatches.forEach(batch => {
      batch.assets.forEach(a => {
        const type = a.type?.toLowerCase();
        switch (type) {
          case 'substation':
            filtered.substationAssets.push(a);
            break;
          case 'transformer':
            filtered.transformerAssets.push(a);
            break;
          case 'pole':
            filtered.poleAssets.push(a);
            break;
          case 'meter':
            filtered.meterAssets.push(a);
            break;
        }
      });
    });
    
    return filtered;
  }, [circuitBatches]);
  
  // Flatten topology batches into single array for rendering
  // Only recalculates when batches added/removed, not on every viewport change
  const topology = useMemo(() => {
    return topologyBatches.flatMap(batch => batch.connections);
  }, [topologyBatches]);
  
  // For backward compatibility with count displays and other non-rendering logic
  const assets = useMemo(() => {
    return circuitBatches.flatMap(batch => batch.assets);
  }, [circuitBatches]);
  const dataFetchedRef = useRef(false); // Prevent duplicate fetches
  const lastDataHashRef = useRef<string>(''); // Track data changes
  const loadingCircuitsRef = useRef<Set<string>>(new Set()); // Track in-flight requests
  const pendingTopologyCountRef = useRef<number>(0); // Track in-flight topology additions (prevents parallel batch overshoot)
  const pendingAssetCountRef = useRef<number>(0); // Track in-flight asset additions (prevents parallel batch overshoot to 180k)
  const loadedCircuitsRef = useRef<Set<string>>(new Set()); // Track circuits that have been successfully loaded (PERSISTENT across frames)
  const substationsLoadedRef = useRef(false); // Track if substations have been loaded
  const metroFeedersLoadingRef = useRef(false); // Prevent duplicate metro/feeders fetches
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null); // Polling timer for service areas
  const limitsReachedRef = useRef(false); // Track if we've hit asset/circuit limits (prevents retry spam)
  const lastLoadAttemptViewportRef = useRef<{ lng: number; lat: number; zoom: number } | null>(null); // Track last viewport for change detection
  const lastCullTimeRef = useRef<number>(0); // Track last culling operation timestamp (prevents rapid-fire culls)
  const pinnedCircuitsRef = useRef<Set<string>>(new Set()); // Track circuits that should never be culled (selected asset circuits)
  const pinnedAssetIdsRef = useRef<Set<string>>(new Set()); // Track connected asset IDs that must be loaded
  const lastSelectionTimeRef = useRef<number>(0); // Track when asset was last selected (to prevent culling during loading)
  // REMOVED: Old topology state - now derived from topologyBatches (see line 561)
  const [metroTopologyData, setMetroTopologyData] = useState<any[]>([]);
  const [feederTopologyData, setFeederTopologyData] = useState<any[]>([]);
  const [serviceAreas, setServiceAreas] = useState<any[]>([]);
  const [substationStatusMap, setSubstationStatusMap] = useState<Map<string, SubstationStatus>>(new Map());
  const [gridKpis, setGridKpis] = useState<{
    TOTAL_CUSTOMERS?: number;
    ACTIVE_OUTAGES?: number;
    TOTAL_LOAD_MW?: number;
    CREWS_ACTIVE?: number;
    AVG_RESTORATION_MINUTES?: number;
  }>({});
  const [initialLoadMetrics, setInitialLoadMetrics] = useState<{
    loadTime: number;
    cacheHits: number;
    timing?: Record<string, number>;
  } | null>(null);
  const [weather, setWeather] = useState<any[]>([]);
  const [weatherTimelineIndex, setWeatherTimelineIndex] = useState(0);
  const [isWeatherPlaying, setIsWeatherPlaying] = useState(false);
  const [weatherSpeed, setWeatherSpeed] = useState(1);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [selectedAssetPosition, setSelectedAssetPosition] = useState<{ x: number; y: number } | null>(null);
  const [animationFrame, setAnimationFrame] = useState(0);
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [clickPosition, setClickPosition] = useState<{ x: number; y: number } | null>(null);
  const [pinnedAssets, setPinnedAssets] = useState<Array<{asset: Asset, position: {x: number, y: number}, id: string, collapsed: boolean}>>([]);
  
  const [hoveredSpatialObject, setHoveredSpatialObject] = useState<SpatialBuilding | SpatialPowerLine | SpatialVegetation | null>(null);
  const [spatialHoverPosition, setSpatialHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedSpatialObject, setSelectedSpatialObject] = useState<SpatialBuilding | SpatialPowerLine | SpatialVegetation | null>(null);
  const [spatialClickPosition, setSpatialClickPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Clustering cache refs - work for both circuit-based and fallback clustering
  const clusterCacheRef = useRef<AssetCluster[]>([]);
  const cachedSubstationHashRef = useRef<string>('');
  const assetToClusterMapRef = useRef<Map<string, number>>(new Map());
  
  // Circuit-based clustering cache refs (for O(1) performance)
  const circuitMapRef = useRef<Map<string, number>>(new Map());  // CIRCUIT_ID → cluster index
  const cachedServiceAreasHashRef = useRef<string>('');          // Hash of service areas for cache invalidation
  
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{x: number, y: number}>({x: 0, y: 0});
  const [dragVelocity, setDragVelocity] = useState<{x: number, y: number}>({x: 0, y: 0});
  const dragPositionHistory = useRef<Array<{x: number, y: number, time: number}>>([]);
  const momentumAnimationRef = useRef<number | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const pendingDragPosition = useRef<{cardId: string, x: number, y: number} | null>(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const isProgrammaticTransition = useRef(false);
  const viewportUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingViewState = useRef<any>(null);
  const [expandedSections, setExpandedSections] = useState({
    infrastructure: true,
    health: true,
    distribution: false,
    connected: false
  });
  const [expandedAssetCategories, setExpandedAssetCategories] = useState<{
    [cardId: string]: {
      substations: boolean;
      transformers: boolean;
      poles: boolean;
      meters: boolean;
    }
  }>({});
  
  // Pagination for large lists in aggregate cards - show 50 initially
  const [listPageSize, setListPageSize] = useState<{
    [cardId: string]: {
      substations: number;
      transformers: number;
      poles: number;
      meters: number;
      criticalAssets: number;
      warningAssets: number;
      healthyAssets: number;
    }
  }>({});
  
  const [snapEnabled, setSnapEnabled] = useState(true);

  // CACHE RESET: Clear all state and refs on browser refresh/component mount
  // This ensures no stale data persists between sessions
  useEffect(() => {
    console.log('🔄 Browser refresh detected - resetting all caches and state');
    
    // Clear all refs
    dataFetchedRef.current = false;
    lastDataHashRef.current = '';
    loadingCircuitsRef.current = new Set();
    pendingTopologyCountRef.current = 0;
    pendingAssetCountRef.current = 0;
    loadedCircuitsRef.current = new Set();
    substationsLoadedRef.current = false;
    metroFeedersLoadingRef.current = false;
    limitsReachedRef.current = false;
    lastLoadAttemptViewportRef.current = null;
    clusterCacheRef.current = [];
    cachedSubstationHashRef.current = '';
    assetToClusterMapRef.current = new Map();
    circuitMapRef.current = new Map();
    cachedServiceAreasHashRef.current = '';
    
    // Clear all batches and state
    setCircuitBatches([]);
    setTopologyBatches([]);
    setMetroTopologyData([]);
    setFeederTopologyData([]);
    setServiceAreas([]);
    setSubstationStatusMap(new Map());
    setWeather([]);
    setSelectedAsset(null);
    setSelectedAssets(new Set());
    setPinnedAssets([]);
    
    console.log('✅ All caches and state cleared');
  }, []); // Empty dependency array = runs only on mount (browser refresh)

  // Decouple spinner animation from data loading to prevent freeze-induced jank
  useEffect(() => {
    if (isLoadingData) {
      // Start spinning immediately (runs independently of React freeze)
      setIsSpinning(true);
      setIsSlowingDown(false);
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    } else {
      // Trigger slowdown animation, then stop completely
      setIsSlowingDown(true);
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      
      // After slowdown completes (1.5s), stop spinning
      spinTimeoutRef.current = setTimeout(() => {
        setIsSpinning(false);
        setIsSlowingDown(false);
      }, 1500);
    }
    
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    };
  }, [isLoadingData]);

  // Update timestamp display every second for "time ago" calculation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Animation loop - OPTIMIZED: Only run when needed (selected asset exists)
  // Use ref to avoid re-renders, update layers via updateTriggers
  const animationTimeRef = useRef(0);
  
  useEffect(() => {
    // Animate if there's a selected asset (for glow effects) OR if assets are fading in
    const hasRecentAssets = assets.some(a => a.loadedAt && (Date.now() - a.loadedAt < 500));
    if (!selectedAsset && !hasRecentAssets) return;
    
    let animationFrameId: number;
    const animate = () => {
      animationTimeRef.current = Date.now() * 0.002;
      setAnimationFrame(prev => prev + 1); // Minimal state update to trigger layer refresh
      animationFrameId = requestAnimationFrame(animate);
    };
    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [selectedAsset, assets.length]); // Run when selectedAsset changes or assets are added

  // Fetch real-time substation status from Flask API (Postgres backend)
  const fetchSubstationStatus = useCallback(async () => {
    // Retry logic for transient Postgres connection failures (per Snowflake docs)
    // Handles: connection pool exhaustion, checkpoint delays, log rotation
    const maxRetries = 3;
    const baseDelay = 500; // ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch('/api/postgres/substations/status');
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Postgres HTTP ${response.status}: ${errorText || response.statusText}`);
        }
        const substations = await response.json();
        const statusMap = new Map<string, SubstationStatus>(
          substations.map((sub: any) => [sub.substation_id, sub as SubstationStatus])
        );
        setSubstationStatusMap(statusMap);
        console.log(`✅ Postgres: Fetched real-time status for ${substations.length} substations (${substations.filter((s: any) => s.status === 'critical').length} critical, ${substations.filter((s: any) => s.status === 'warning').length} warning)`);
        return; // Success - exit retry loop
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        if (isLastAttempt) {
          console.error('❌ Failed to fetch substation status from Postgres after retries:', error);
        } else {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
          console.warn(`⚠️  Postgres fetch attempt ${attempt} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }, []);

  // Auto-refresh substation status every 10 seconds
  useEffect(() => {
    fetchSubstationStatus(); // Initial fetch
    
    const interval = setInterval(fetchSubstationStatus, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, [fetchSubstationStatus]);

  // ONE-TIME CLEANUP: Clear stuck circuits in loading state on mount
  useEffect(() => {
    const stuckCount = loadingCircuitsRef.current.size;
    if (stuckCount > 0) {
      console.log(`🧹 Cleaning up ${stuckCount} stuck circuits from previous session`);
      loadingCircuitsRef.current.clear();
    }
  }, []); // Empty deps = runs once on mount


  useEffect(() => {
    if (!draggedCardId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 380));
      const newY = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 100));
      
      // Track position history for velocity calculation
      dragPositionHistory.current.push({ x: newX, y: newY, time: Date.now() });
      if (dragPositionHistory.current.length > 5) {
        dragPositionHistory.current.shift();
      }
      
      // Store pending position for RAF-based update (throttles to 60fps max)
      pendingDragPosition.current = { cardId: draggedCardId, x: newX, y: newY };
      
      // Schedule update if not already scheduled
      if (!dragAnimationFrameRef.current) {
        dragAnimationFrameRef.current = requestAnimationFrame(() => {
          const pending = pendingDragPosition.current;
          if (pending) {
            // Batch both updates in single render cycle
            setPinnedAssets(prev => prev.map(p => 
              p.id === pending.cardId ? { ...p, position: { x: pending.x, y: pending.y } } : p
            ));
            
            // Update selected asset position if dragging the selected card
            if (selectedAsset && pending.cardId === selectedAsset.id) {
              setSelectedAssetPosition({ x: pending.x, y: pending.y });
            }
          }
          dragAnimationFrameRef.current = null;
          pendingDragPosition.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      // Flush any pending drag update
      if (dragAnimationFrameRef.current) {
        cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
      
      // Calculate velocity from position history
      if (dragPositionHistory.current.length >= 2) {
        const last = dragPositionHistory.current[dragPositionHistory.current.length - 1];
        const first = dragPositionHistory.current[0];
        const timeDelta = (last.time - first.time) / 1000; // seconds
        
        if (timeDelta > 0) {
          const velocityX = (last.x - first.x) / timeDelta;
          const velocityY = (last.y - first.y) / timeDelta;
          
          // Start momentum animation
          startMomentumAnimation(draggedCardId, velocityX, velocityY);
        }
      }
      
      setDraggedCardId(null);
      dragPositionHistory.current = [];
      pendingDragPosition.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (dragAnimationFrameRef.current) {
        cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
    };
  }, [draggedCardId, dragOffset, selectedAsset]);

  // Momentum animation after drag release - OPTIMIZED: Batched updates, reduced friction calculations
  const startMomentumAnimation = (cardId: string, initialVelocityX: number, initialVelocityY: number) => {
    let velocityX = initialVelocityX;
    let velocityY = initialVelocityY;
    const friction = 0.92; // Reduced friction (was 0.85) - smoother, longer glide
    const minVelocity = 0.5; // Lower threshold (was 1.5) - continues longer before stopping
    let lastTimestamp = performance.now();
    
    const animate = (timestamp: number) => {
      // Calculate actual time delta for smooth 60fps animation
      const deltaTime = Math.min((timestamp - lastTimestamp) / 16.667, 2); // Cap at 2x for safety
      lastTimestamp = timestamp;
      
      // Apply friction with time correction
      const frictionFactor = Math.pow(friction, deltaTime);
      velocityX *= frictionFactor;
      velocityY *= frictionFactor;
      
      // Stop if velocity is too small
      if (Math.abs(velocityX) < minVelocity && Math.abs(velocityY) < minVelocity) {
        momentumAnimationRef.current = null;
        return;
      }
      
      // Update position with time-corrected delta
      const deltaX = (velocityX / 60) * deltaTime;
      const deltaY = (velocityY / 60) * deltaTime;
      
      // OPTIMIZATION: Single batched update for both pinned assets and selected asset
      let newPositionForSelected: {x: number, y: number} | null = null;
      
      setPinnedAssets(prev => prev.map(p => {
        if (p.id === cardId) {
          const newX = Math.max(0, Math.min(p.position.x + deltaX, window.innerWidth - 380));
          const newY = Math.max(0, Math.min(p.position.y + deltaY, window.innerHeight - 100));
          
          // Stop if hitting boundary
          if (newX === 0 || newX === window.innerWidth - 380) velocityX = 0;
          if (newY === 0 || newY === window.innerHeight - 100) velocityY = 0;
          
          // Cache for selected asset update
          if (selectedAsset && cardId === selectedAsset.id) {
            newPositionForSelected = { x: newX, y: newY };
          }
          
          return { ...p, position: { x: newX, y: newY } };
        }
        return p;
      }));
      
      // Update selected asset position in same frame if needed
      if (newPositionForSelected) {
        setSelectedAssetPosition(newPositionForSelected);
      }
      
      // Continue or stop momentum
      if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
        momentumAnimationRef.current = requestAnimationFrame(animate);
      } else {
        momentumAnimationRef.current = null;
      }
    };
    
    momentumAnimationRef.current = requestAnimationFrame(animate);
  };
  
  // Helper: Get paginated items for large lists (performance optimization)
  // CRITICAL: Start with only 20 items for better performance, load more on demand
  const getPaginatedItems = (items: any[] | undefined, cardId: string, category: string, defaultPageSize = 20) => {
    if (!items || items.length === 0) return { visibleItems: [], hasMore: false, totalCount: 0 };
    
    const currentPageSize = listPageSize[cardId]?.[category as keyof typeof listPageSize[typeof cardId]] || defaultPageSize;
    const visibleItems = items.slice(0, currentPageSize);
    const hasMore = items.length > currentPageSize;
    
    return { visibleItems, hasMore, totalCount: items.length };
  };
  
  // Helper: Load more items for a category
  const loadMoreItems = (cardId: string, category: string, increment = 30) => {
    setListPageSize(prev => ({
      ...prev,
      [cardId]: {
        ...(prev[cardId] || {}),
        [category]: (prev[cardId]?.[category as keyof typeof prev[typeof cardId]] || 50) + increment
      }
    }));
  };

  // Cleanup momentum animation on unmount
  useEffect(() => {
    return () => {
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
      }
    };
  }, []);
  const [zoomTimeout, setZoomTimeout] = useState<NodeJS.Timeout | null>(null);
  const [lastZoomVelocity, setLastZoomVelocity] = useState(0);
  const lastZoomTimeRef = useRef(Date.now());
  const lastZoomRef = useRef(INITIAL_VIEW_STATE.zoom);
  const lastIntelligenceLayerRef = useRef<string | null>(null);
  const [isInMagneticZone, setIsInMagneticZone] = useState(false);
  const [targetSnapZoom, setTargetSnapZoom] = useState<number | null>(null);
  const isSnappingRef = useRef(false);
  const velocityHistoryRef = useRef<Array<{velocity: number, time: number}>>([]);
  const isUserScrollingRef = useRef(false);
  const scrollEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [lastClickTime, setLastClickTime] = useState(0);
  const [lastClickCoords, setLastClickCoords] = useState<[number, number] | null>(null);
  const [layersVisible, setLayersVisible] = useState({
    poles: true,
    transformers: true,
    meters: true,
    substations: true,
    connections: true,
    heatmap: false,
    weather: false,
    enable3D: true,
    buildingFootprints: false,
    powerLines: false,
    vegetation: false
  });
  const [layersPanelExpanded, setLayersPanelExpanded] = useState(true);
  const [spatialPanelExpanded, setSpatialPanelExpanded] = useState(true);
  
  const [spatialData, setSpatialData] = useState<{
    powerLines: any[];
    vegetation: any[];
  }>({ powerLines: [], vegetation: [] });
  const [spatialLoading, setSpatialLoading] = useState({ powerLines: false, vegetation: false });

  // Track last loaded zoom level for power lines LOD
  const [powerLinesLoadedZoom, setPowerLinesLoadedZoom] = useState<number | null>(null);
  
  const loadSpatialLayer = useCallback(async (layerType: 'powerLines' | 'vegetation', zoom?: number) => {
    if (spatialLoading[layerType]) return;
    setSpatialLoading(prev => ({ ...prev, [layerType]: true }));
    
    try {
      // Engineering: Pass zoom level for LOD-based power line queries
      const endpoints: Record<string, string> = {
        powerLines: `/api/spatial/layers/power-lines?zoom=${Math.floor(zoom || 12)}`,
        vegetation: '/api/spatial/layers/vegetation'
      };
      
      const response = await fetch(endpoints[layerType]);
      if (!response.ok) throw new Error(`Failed to load ${layerType}`);
      const data = await response.json();
      
      setSpatialData(prev => ({ ...prev, [layerType]: data.features || data }));
      
      // Track loaded zoom for power lines LOD
      if (layerType === 'powerLines' && zoom) {
        setPowerLinesLoadedZoom(zoom);
      }
      
      const lodInfo = data.lod_level ? ` (LOD: ${data.lod_level}, ${data.total_vertices?.toLocaleString() || '?'} vertices)` : '';
      console.log(`✅ Loaded ${layerType}: ${(data.features || data).length} features${lodInfo} in ${data.query_time_ms}ms`);
      
      // Engineering: Debug power lines data for visualization troubleshooting
      if (layerType === 'powerLines') {
        const features = data.features || data;
        const classes = features.reduce((acc: Record<string, number>, f: any) => {
          const cls = f.class || 'unknown';
          acc[cls] = (acc[cls] || 0) + 1;
          return acc;
        }, {});
        console.log(`   📊 Power line classes: ${Object.entries(classes).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        // Verify path data structure
        const sample = features[0];
        if (sample) {
          const path = sample.coordinates || sample.path;
          console.log(`   📍 Sample path format: ${Array.isArray(path) ? `Array[${path.length}], first coord: [${path[0]}]` : typeof path}`);
        }
      }
    } catch (error) {
      console.error(`Failed to load ${layerType}:`, error);
    } finally {
      setSpatialLoading(prev => ({ ...prev, [layerType]: false }));
    }
  }, [spatialLoading]);

  // Engineering: Load power lines with zoom-based LOD
  useEffect(() => {
    if (layersVisible.powerLines && spatialData.powerLines.length === 0 && !spatialLoading.powerLines) {
      loadSpatialLayer('powerLines', viewState.zoom);
    }
  }, [layersVisible.powerLines, spatialData.powerLines.length, spatialLoading.powerLines, loadSpatialLayer, viewState.zoom]);

  // Engineering: Reload power lines when zoom crosses LOD thresholds
  useEffect(() => {
    if (!layersVisible.powerLines || spatialLoading.powerLines || powerLinesLoadedZoom === null) return;
    
    // Determine current and loaded LOD levels
    const getCurrentLod = (z: number) => z < 12 ? 'overview' : z < 15 ? 'mid' : 'full';
    const currentLod = getCurrentLod(viewState.zoom);
    const loadedLod = getCurrentLod(powerLinesLoadedZoom);
    
    // Reload if LOD level changed
    if (currentLod !== loadedLod) {
      console.log(`🔄 Power lines LOD change: ${loadedLod} → ${currentLod} (zoom ${powerLinesLoadedZoom.toFixed(1)} → ${viewState.zoom.toFixed(1)})`);
      setSpatialData(prev => ({ ...prev, powerLines: [] }));
      loadSpatialLayer('powerLines', viewState.zoom);
    }
  }, [viewState.zoom, powerLinesLoadedZoom, layersVisible.powerLines, spatialLoading.powerLines, loadSpatialLayer]);

  useEffect(() => {
    if (layersVisible.vegetation && spatialData.vegetation.length === 0 && !spatialLoading.vegetation) {
      loadSpatialLayer('vegetation');
    }
  }, [layersVisible.vegetation, spatialData.vegetation.length, spatialLoading.vegetation, loadSpatialLayer]);

  // Helper: Format time ago (depends on currentTime to trigger re-calculation)
  const getTimeAgo = useCallback((date: Date) => {
    const seconds = Math.floor((currentTime.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }, [currentTime]);

  // Auto-disable expensive heatmap when weather overlay is enabled (GPU optimization)
  useEffect(() => {
    if (layersVisible.weather && layersVisible.heatmap) {
      setLayersVisible(prev => ({ ...prev, heatmap: false }));
      // console.log('⚡ GPU Optimization: Disabled usage heatmap (conflicts with weather overlay)');
    }
  }, [layersVisible.weather, layersVisible.heatmap]);

  // Weather timeline animation loop
  useEffect(() => {
    if (!isWeatherPlaying || weather.length === 0) return;

    const interval = setInterval(() => {
      setWeatherTimelineIndex(prev => {
        // Loop back to start when reaching the end
        if (prev >= weather.length - 1) return 0;
        return prev + 1;
      });
    }, 1000 / weatherSpeed); // Speed controls how many hours per second

    return () => clearInterval(interval);
  }, [isWeatherPlaying, weather.length, weatherSpeed]);

  // Extract currentZoom early for use in callbacks
  const currentZoom = viewState.zoom;
  const ZOOM_THRESHOLD = 11.5;
  const useClusteredView = currentZoom < ZOOM_THRESHOLD;
  
  // Track starting position for distance calculation
  const startPosition = useMemo(() => ({
    longitude: INITIAL_VIEW_STATE.longitude,
    latitude: INITIAL_VIEW_STATE.latitude
  }), []);
  
  // Calculate distance from starting position (in km) using Haversine formula
  const distanceFromStart = useMemo(() => {
    const R = 6371; // Earth's radius in km
    const dLat = (viewState.latitude - startPosition.latitude) * Math.PI / 180;
    const dLon = (viewState.longitude - startPosition.longitude) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(startPosition.latitude * Math.PI / 180) * Math.cos(viewState.latitude * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance;
  }, [viewState.latitude, viewState.longitude, startPosition]);


  // PRODUCTION LOD: Lazy load detailed assets based on zoom level
  useEffect(() => {
    const loadDetailedData = async () => {
      const zoom = currentZoom;
      
      // Zoom 9+: Load metro + feeders (distribution network view) + substations
      // Load once and keep for all higher zoom levels
      if (zoom >= 9 && metroTopologyData.length === 0 && !metroFeedersLoadingRef.current) {
        metroFeedersLoadingRef.current = true; // Prevent duplicate fetches
        console.log(`📊 Zoom ${zoom.toFixed(1)}: Loading metro topology + feeders + substations...`);
        try {
          const [metroData, feedersData] = await Promise.all([
            fetch('/api/topology/metro').then(async r => {
              if (!r.ok) throw new Error(`Metro HTTP ${r.status}: ${r.statusText}`);
              return r.json();
            }),
            fetch('/api/topology/feeders').then(async r => {
              if (!r.ok) throw new Error(`Feeders HTTP ${r.status}: ${r.statusText}`);
              return r.json();
            })
          ]);
          setMetroTopologyData(metroData);
          setFeederTopologyData(feedersData);
          console.log(`✅ Loaded ${metroData.length} metro substations, ${feedersData.length} feeders`);
          
          // Load substations immediately from metro data
          if (!substationsLoadedRef.current && metroData.length > 0) {
            substationsLoadedRef.current = true;
            console.log(`   📍 Adding ${metroData.length} substations...`);
            const substations: Asset[] = metroData.map((row: any) => {
              const status = substationStatusMap.get(row.SUBSTATION_ID);
              return {
                id: row.SUBSTATION_ID,
                name: row.SUBSTATION_NAME || row.SUBSTATION_ID,
                type: 'substation',
                latitude: row.LATITUDE,
                longitude: row.LONGITUDE,
                load_percent: status?.load_percent ?? null,
                voltage: row.VOLTAGE_KV ? `${row.VOLTAGE_KV} kV` : null,
                status: status?.status ?? null,
                commissioned_date: null,
                health_score: status?.health_score ?? null,
                usage_kwh: null,
                pole_height_ft: null,
                circuit_id: null,
                loadedAt: Date.now()
              };
            });
            
            // Add substations as first batch (batch-0)
            setCircuitBatches(prev => [...prev, {
              batchId: 'batch-substations',
              circuitIds: [], // Substations don't have circuit IDs
              assets: substations,
              loadedAt: Date.now()
            }]);
            console.log(`   ✅ Added ${substations.length} substations instantly (batch-substations)`);
          }
        } catch (error) {
          console.error('Failed to load metro/feeders:', error);
          metroFeedersLoadingRef.current = false; // Reset on error to allow retry
        }
      }
      
      // Zoom 10+: Load topology connections (one-time load with reasonable limit)
      // REMOVED: Old topology loading without circuit filtering
      // Progressive loading (separate effect below) now handles topology with circuit filtering for Postgres cache
      // This old pattern hit Snowflake fallback and loaded 200K random connections
      if (false && zoom >= 10 && topology.length === 0 && serviceAreas.length > 0) {
        console.log(`📊 Zoom ${zoom.toFixed(1)}: Loading topology connections (limited for performance)...`);
        try {
          // Load topology data with 200k limit for reasonable performance
          // Full 1.26M connections would take minutes - 200k gives better coverage
          const topologyData = await fetch('/api/topology?limit=200000').then(async r => {
            if (!r.ok) throw new Error(`Topology HTTP ${r.status}: ${r.statusText}`);
            return r.json();
          });
          
          const mappedTopology = topologyData.map((row: any) => ({
            from_asset_id: row.FROM_ASSET_ID, to_asset_id: row.TO_ASSET_ID,
            connection_type: 'Distribution',
            from_latitude: row.FROM_LAT, from_longitude: row.FROM_LON,
            to_latitude: row.TO_LAT, to_longitude: row.TO_LON
          }));
          
          setTopology(mappedTopology);
          console.log(`   ✅ Loaded ${mappedTopology.length.toLocaleString()} topology connections`);
          
          // Immediately check how many are in viewport for debugging
          const degPerPixel = 360 / (256 * Math.pow(2, zoom));
          const viewWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) * degPerPixel;
          const viewHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) * degPerPixel;
          const buffer = 1.2;
          const minLng = viewState.longitude - (viewWidth / 2) * buffer;
          const maxLng = viewState.longitude + (viewWidth / 2) * buffer;
          const minLat = viewState.latitude - (viewHeight / 2) * buffer;
          const maxLat = viewState.latitude + (viewHeight / 2) * buffer;
          
          const inViewport = mappedTopology.filter((link: any) =>
            (link.from_longitude >= minLng && link.from_longitude <= maxLng &&
             link.from_latitude >= minLat && link.from_latitude <= maxLat) ||
            (link.to_longitude >= minLng && link.to_longitude <= maxLng &&
             link.to_latitude >= minLat && link.to_latitude <= maxLat)
          );
          
          console.log(`   🎯 ${inViewport.length.toLocaleString()} connections in current viewport`);
        } catch (error) {
          console.error('Failed to load topology:', error);
        }
      }
      
      // Substations are now loaded immediately at zoom 9 (above) alongside metro/feeders
      
      // OLD FALLBACK: DISABLED - Progressive loading (separate effect) handles all viewport-based loading now
      // This fallback could cause mass loading of assets if triggered
      // Keeping code for reference but never executing
      if (false && zoom >= 10 && assets.length === 0 && serviceAreas.length === 0) {
        console.log(`📊 Zoom ${zoom.toFixed(1)}: Loading viewport-filtered assets (circuit-based)...`);
        try {
          // Get visible circuits from service areas (already loaded)
          // Sort by distance from viewport center for predictable loading
          const visibleCircuits = serviceAreas
            .filter(sa => {
              const lat = sa.CENTROID_LAT;
              const lon = sa.CENTROID_LON;
              if (!lat || !lon) return false;
              
              // Calculate viewport bounds with 100% buffer (2x viewport) for smoother loading
              const degPerPixel = 360 / (256 * Math.pow(2, zoom));
              const viewWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) * degPerPixel;
              const viewHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) * degPerPixel;
              const buffer = 2.0;
              
              const minLng = viewState.longitude - (viewWidth / 2) * buffer;
              const maxLng = viewState.longitude + (viewWidth / 2) * buffer;
              const minLat = viewState.latitude - (viewHeight / 2) * buffer;
              const maxLat = viewState.latitude + (viewHeight / 2) * buffer;
              
              return lon >= minLng && lon <= maxLng && lat >= minLat && lat <= maxLat;
            })
            .map(sa => ({
              circuit_id: sa.CIRCUIT_ID,
              distance: Math.sqrt(
                Math.pow(sa.CENTROID_LAT - viewState.latitude, 2) +
                Math.pow(sa.CENTROID_LON - viewState.longitude, 2)
              )
            }))
            .sort((a, b) => a.distance - b.distance) // Closest first
            .map(item => item.circuit_id);
          
          // Load up to 25 circuits for initial load (reduces pop-in)
          const circuitsToLoad = visibleCircuits.slice(0, 25);
          
          console.log(`   📍 Visible circuits: ${visibleCircuits.length}, Loading first ${circuitsToLoad.length} circuits`);
          
          if (circuitsToLoad.length === 0) {
            // ⚠️ CRITICAL FIX: Respect hard caps even for sample data
            const currentTotal = circuitBatches.flatMap(b => b.assets).length;
            const currentZoom = throttledZoom;
            const maxAssetsAllowed = currentZoom < 11 ? 12000 : currentZoom < 12 ? 25000 : 50000;
            const spaceAvailable = Math.max(0, maxAssetsAllowed - currentTotal - pendingAssetCountRef.current);
            
            console.log(`📦 SAMPLE: ${currentTotal.toLocaleString()}/${maxAssetsAllowed.toLocaleString()} current | ${spaceAvailable.toLocaleString()} space | ${spaceAvailable > 0 ? '✅ ALLOW' : '❌ REJECT'}`);
            
            if (spaceAvailable === 0) {
              limitsReachedRef.current = true;
              return;
            }
            
            // Fallback: load limited assets if no circuits in viewport (RESPECT CAP)
            const limitToFetch = Math.min(spaceAvailable, maxAssetsAllowed);
            const assetsData = await fetch(`/api/assets?limit=${limitToFetch}`).then(async r => {
              if (!r.ok) throw new Error(`Assets HTTP ${r.status}: ${r.statusText}`);
              return r.json();
            });
            
            const mappedAssets: Asset[] = assetsData.map((row: any) => ({
              id: row.ASSET_ID, name: row.ASSET_NAME, type: row.ASSET_TYPE,
              latitude: row.LATITUDE, longitude: row.LONGITUDE,
              load_percent: row.LOAD_PERCENT, voltage: row.VOLTAGE, status: row.STATUS,
              commissioned_date: row.COMMISSIONED_DATE, health_score: row.HEALTH_SCORE,
              usage_kwh: row.USAGE_KWH, pole_height_ft: row.POLE_HEIGHT_FT,
              circuit_id: row.CIRCUIT_ID,
              rotation_rad: row.ROTATION_RAD
            }));
            
            // Substations are loaded separately in the dedicated block above (line 965)
            // Don't add them here to prevent duplicates
            
            // Update pending counter immediately
            pendingAssetCountRef.current += mappedAssets.length;
            
            setCircuitBatches(prev => [...prev, {
              batchId: 'batch-sample-assets',
              circuitIds: [],
              assets: mappedAssets,
              loadedAt: Date.now()
            }]);
            console.log(`   ✅ Sample: ${mappedAssets.length.toLocaleString()} assets loaded`);
            return;
          }
          
          // Load assets AND topology for visible circuits (Postgres cache)
          const circuitParam = circuitsToLoad.join(',');
          const [assetsData, topologyData] = await Promise.all([
            fetch(`/api/assets?circuits=${encodeURIComponent(circuitParam)}`).then(async r => {
              if (!r.ok) throw new Error(`Assets HTTP ${r.status}: ${r.statusText}`);
              return r.json();
            }),
            fetch(`/api/topology?circuits=${encodeURIComponent(circuitParam)}`).then(async r => {
              if (!r.ok) throw new Error(`Topology HTTP ${r.status}: ${r.statusText}`);
              return r.json();
            })
          ]);
          
          const mappedAssets: Asset[] = assetsData.map((row: any) => ({
            id: row.ASSET_ID, name: row.ASSET_NAME, type: row.ASSET_TYPE,
            latitude: row.LATITUDE, longitude: row.LONGITUDE,
            load_percent: row.LOAD_PERCENT, voltage: row.VOLTAGE, status: row.STATUS,
            commissioned_date: row.COMMISSIONED_DATE, health_score: row.HEALTH_SCORE,
            usage_kwh: row.USAGE_KWH, pole_height_ft: row.POLE_HEIGHT_FT,
            circuit_id: row.CIRCUIT_ID,
            rotation_rad: row.ROTATION_RAD
          }));
          
          // Substations are loaded separately in the dedicated block above (line 965)
          // Don't add them here to prevent duplicates
          
          const mappedTopology = topologyData.map((row: any) => ({
            from_asset_id: row.FROM_ASSET_ID, to_asset_id: row.TO_ASSET_ID,
            connection_type: 'Distribution',
            from_latitude: row.FROM_LAT, from_longitude: row.FROM_LON,
            to_latitude: row.TO_LAT, to_longitude: row.TO_LON
          }));
          
          // Deduplicate with existing assets before adding as batch
          // Use loadedCircuitsRef to avoid circular dependency with assets array
          setCircuitBatches(prev => {
            // Check if any of these circuits are already loaded
            const newCircuitsOnly = circuitsToLoad.filter(cid => !loadedCircuitsRef.current.has(cid));
            if (newCircuitsOnly.length === 0) return prev; // All circuits already loaded
            
            // Deduplicate assets by ID (in case of duplicate data from API)
            const existingAssetIds = new Set<string>();
            prev.forEach(batch => batch.assets.forEach(a => existingAssetIds.add(a.id)));
            const uniqueNew = mappedAssets.filter(a => !existingAssetIds.has(a.id));
            
            if (uniqueNew.length === 0) return prev;
            
            // ⚠️ CRITICAL FIX: HARD CAP ENFORCEMENT (was missing from initial load path)
            // This path was bypassing all limits, causing 200k+ asset buildup
            const currentTotal = prev.flatMap(b => b.assets).length;
            const currentZoom = throttledZoom;
            const maxAssetsAllowed = currentZoom < 11 ? 12000 : currentZoom < 12 ? 25000 : 50000;
            const spaceAvailable = Math.max(0, maxAssetsAllowed - currentTotal - pendingAssetCountRef.current);
            
            console.log(`💾 LOAD: ${uniqueNew.length.toLocaleString()} new | ${currentTotal.toLocaleString()}/${maxAssetsAllowed.toLocaleString()} current | ${spaceAvailable.toLocaleString()} space | ${spaceAvailable > 0 ? '✅ ALLOW' : '❌ REJECT'}`);
            
            if (spaceAvailable === 0) {
              limitsReachedRef.current = true;
              return prev;
            }
            
            // Only add assets up to the space available
            const assetsToAdd = uniqueNew.slice(0, spaceAvailable);
            
            // Update pending counter immediately
            pendingAssetCountRef.current += assetsToAdd.length;
            
            // Mark these circuits as loaded
            newCircuitsOnly.forEach(cid => loadedCircuitsRef.current.add(cid));
            
            return [...prev, {
              batchId: `batch-viewport-${Date.now()}`,
              circuitIds: circuitsToLoad,
              assets: assetsToAdd,
              loadedAt: Date.now()
            }];
          });
          
          // BATCHED TOPOLOGY: Append to topology batches instead of replacing
          // Store viewport center for distance-based priority calculation
          setTopologyBatches(prev => {
            // Deduplicate connections by from-to pair
            const existingConnections = new Set<string>();
            prev.forEach(batch => 
              batch.connections.forEach(c => 
                existingConnections.add(`${c.from_asset_id}-${c.to_asset_id}`)
              )
            );
            const uniqueTopology = mappedTopology.filter(c => 
              !existingConnections.has(`${c.from_asset_id}-${c.to_asset_id}`)
            );
            
            if (uniqueTopology.length === 0) return prev;
            
            return [...prev, {
              batchId: `topology-batch-${Date.now()}`,
              circuitIds: circuitsToLoad,
              connections: uniqueTopology,
              loadedAt: Date.now(),
              viewportCenter: { lng: viewState.longitude, lat: viewState.latitude }
            }];
          });
          
          console.log(`   ✅ Viewport assets loaded: ${mappedAssets.length.toLocaleString()} assets, ${mappedTopology.length.toLocaleString()} connections`);
          console.log(`   🎯 Loaded ${circuitsToLoad.length} circuits: ${circuitsToLoad.slice(0, 3).join(', ')}${circuitsToLoad.length > 3 ? '...' : ''}`);
        } catch (error) {
          console.error('Failed to load assets/topology:', error);
        }
      }
    };
    
    loadDetailedData();
  }, [currentZoom, metroTopologyData.length, topology.length, serviceAreas.length]);

  // PERFORMANCE: Throttle zoom for expensive calculations - only update on significant changes
  // SMOOTHNESS: Use finer granularity (0.1 instead of 0.5) for smoother height transitions
  const throttledZoom = useMemo(() => {
    return Math.round(currentZoom * 10) / 10;
  }, [currentZoom]);

  // PERFORMANCE: Throttle viewport position to reduce filtering frequency during pan
  const throttledViewport = useMemo(() => {
    // Round to ~50m precision for very responsive loading (was 100m)
    const precision = 0.0005;
    return {
      longitude: Math.round(viewState.longitude / precision) * precision,
      latitude: Math.round(viewState.latitude / precision) * precision
    };
  }, [viewState.longitude, viewState.latitude]);

  // SELECTED ASSET PINNING: Pin circuits for selected asset and its connections
  useEffect(() => {
    const previousPinned = new Set(pinnedCircuitsRef.current);
    
    if (!selectedAsset) {
      // When deselecting, immediately cull previously pinned circuits if they're outside viewport
      if (previousPinned.size > 0) {
        console.log(`🗑️ Deselected asset - checking ${previousPinned.size} previously pinned circuits for cleanup`);
        
        // Remove pinned circuits that are no longer needed
        // The next viewport/culling cycle will handle the actual asset removal
        previousPinned.forEach(cid => {
          loadedCircuitsRef.current.delete(cid);
        });
        
        // Trigger immediate cull by removing their batches
        setCircuitBatches(prev => {
          const filtered = prev.filter(batch => {
            // Keep substations
            if (batch.batchId === 'batch-substations') return true;
            
            // Remove connected assets batch when deselecting
            if (batch.batchId === 'batch-connected-assets') {
              console.log(`   🗑️ Removing connected assets batch`);
              return false;
            }
            
            // Remove batches that only contain previously pinned circuits
            const allCircuitsPinned = batch.circuitIds.every(cid => previousPinned.has(cid));
            if (allCircuitsPinned) {
              console.log(`   🗑️ Removing batch for deselected circuits: ${batch.circuitIds.join(', ')}`);
              return false;
            }
            return true;
          });
          return filtered;
        });
        
        // Also remove their topology
        setTopologyBatches(prev => {
          const remainingAssetIds = new Set(
            circuitBatches.flatMap(b => b.assets).map(a => a.id)
          );
          
          return prev.map(batch => ({
            ...batch,
            connections: batch.connections.filter(t => 
              remainingAssetIds.has(t.from_asset_id) && remainingAssetIds.has(t.to_asset_id)
            )
          })).filter(batch => batch.connections.length > 0);
        });
      }
      
      // Clear pinned circuits when nothing selected
      pinnedCircuitsRef.current.clear();
      pinnedAssetIdsRef.current.clear();
      return;
    }

    const pinnedCircuits = new Set<string>();
    
    // Pin the selected asset's circuit (if not a substation)
    if (selectedAsset.circuit_id) {
      pinnedCircuits.add(selectedAsset.circuit_id);
    }
    
    // For substations: Find circuits from service areas that belong to this substation
    if (selectedAsset.type === 'substation') {
      console.log(`🔍 Checking serviceAreas for ${selectedAsset.id}: ${serviceAreas.length} total areas loaded`);
      
      serviceAreas.forEach(sa => {
        if (sa.SUBSTATION_ID === selectedAsset.id && sa.CIRCUIT_ID) {
          pinnedCircuits.add(sa.CIRCUIT_ID);
        }
      });
      
      // DEBUG: Show first matching service area
      const matching = serviceAreas.filter(sa => sa.SUBSTATION_ID === selectedAsset.id);
      if (matching.length > 0) {
        console.log(`   ✅ Found ${matching.length} matching service areas, first one:`, matching[0]);
      } else {
        console.log(`   ❌ No matching service areas found. Sample IDs:`, serviceAreas.slice(0, 3).map(sa => sa.SUBSTATION_ID));
      }
      
      console.log(`📌 Substation ${selectedAsset.id}: Found ${pinnedCircuits.size} circuits to pin and load`);
    }
    
    // Find all connected assets via topology and pin their circuits too
    const connectedAssetIds = new Set<string>();
    
    // For substations: Find connections to assets in the pinned circuits
    if (selectedAsset.type === 'substation' && pinnedCircuits.size > 0) {
      // Get all assets that belong to the pinned circuits
      const circuitAssets = assets.filter(a => 
        a.circuit_id && pinnedCircuits.has(a.circuit_id)
      );
      
      console.log(`🔍 Checking topology for ${circuitAssets.length} assets in ${pinnedCircuits.size} pinned circuits`);
      
      // Find all topology connections to/from these circuit assets
      topology.forEach(link => {
        circuitAssets.forEach(asset => {
          if (link.from_asset_id === asset.id) {
            connectedAssetIds.add(link.to_asset_id);
          }
          if (link.to_asset_id === asset.id) {
            connectedAssetIds.add(link.from_asset_id);
          }
        });
      });
    } else {
      // For regular assets: Direct topology lookup
      topology.forEach(link => {
        if (link.from_asset_id === selectedAsset.id) {
          connectedAssetIds.add(link.to_asset_id);
        }
        if (link.to_asset_id === selectedAsset.id) {
          connectedAssetIds.add(link.from_asset_id);
        }
      });
    }
    
    // Store connected asset IDs for explicit loading
    pinnedAssetIdsRef.current = connectedAssetIds;
    
    console.log(`🔗 Found ${connectedAssetIds.size} connected assets for ${selectedAsset.type} ${selectedAsset.id}`);
    
    // Map connected asset IDs to their circuit IDs
    connectedAssetIds.forEach(assetId => {
      // Try to find in loaded assets first
      const connectedAsset = assets.find(a => a.id === assetId);
      if (connectedAsset?.circuit_id) {
        pinnedCircuits.add(connectedAsset.circuit_id);
      } else {
        // If not loaded, try to find circuit from service areas
        serviceAreas.forEach(sa => {
          // Check if this circuit might contain the asset (fuzzy match by ID pattern)
          if (assetId.startsWith(sa.CIRCUIT_ID) && sa.CIRCUIT_ID) {
            pinnedCircuits.add(sa.CIRCUIT_ID);
          }
        });
      }
    });
    
    pinnedCircuitsRef.current = pinnedCircuits;
    
    if (pinnedCircuits.size > 0) {
      console.log(`📌 Pinned ${pinnedCircuits.size} circuits for selected ${selectedAsset.type} ${selectedAsset.id}`);
    }
  }, [selectedAsset, topology, assets, circuitBatches]);

  // CONNECTED ASSETS LOADING: Fetch assets at the other end of topology connections
  // For substations: This effect won't do much since substations don't appear in topology
  // Assets will be loaded via the pinned circuits in the main loading effect
  useEffect(() => {
    if (!selectedAsset) return;
    
    // For substations, skip this - assets will come from pinned circuits
    if (selectedAsset.type === 'substation') {
      console.log(`   ℹ️ Substation selected - assets will load via ${pinnedCircuitsRef.current.size} pinned circuits`);
      return;
    }
    
    // For non-substations, check for connected assets in topology
    if (pinnedAssetIdsRef.current.size === 0) return;
    
    const fetchConnectedAssets = async () => {
      const connectedIds = Array.from(pinnedAssetIdsRef.current);
      
      // Filter out already loaded assets
      const loadedAssetIds = new Set(assets.map(a => a.id));
      const missingAssetIds = connectedIds.filter(id => !loadedAssetIds.has(id));
      
      if (missingAssetIds.length === 0) {
        console.log(`✅ All ${connectedIds.length} connected assets already loaded`);
        return;
      }
      
      console.log(`🔗 Fetching ${missingAssetIds.length} missing connected assets for ${selectedAsset.type} ${selectedAsset.id}`);
      
      try {
        // Fetch specific assets by ID
        const assetIdsParam = missingAssetIds.join(',');
        const response = await fetch(`/api/assets?asset_ids=${encodeURIComponent(assetIdsParam)}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch connected assets: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Transform to Asset format
        const newAssets: Asset[] = data.map((row: any) => ({
          id: row.ASSET_ID,
          name: row.ASSET_NAME || row.ASSET_ID,
          type: row.ASSET_TYPE,
          latitude: row.LATITUDE,
          longitude: row.LONGITUDE,
          health_score: row.HEALTH_SCORE,
          load_percent: row.LOAD_PERCENT,
          usage_kwh: row.USAGE_KWH,
          status: row.STATUS,
          voltage: row.VOLTAGE,
          circuit_id: row.CIRCUIT_ID
        }));
        
        if (newAssets.length === 0) {
          console.log(`   ⚠️ No connected assets found in database`);
          return;
        }
        
        console.log(`   ✅ Fetched ${newAssets.length} connected assets`);
        
        // Add to circuit batches (create special batch for connected assets)
        setCircuitBatches(prev => {
          // Check if we already have a connected-assets batch
          const existingBatch = prev.find(b => b.batchId === 'batch-connected-assets');
          
          if (existingBatch) {
            // Update existing batch
            const existingIds = new Set(existingBatch.assets.map(a => a.id));
            const uniqueNew = newAssets.filter(a => !existingIds.has(a.id));
            
            if (uniqueNew.length === 0) return prev;
            
            return prev.map(b => 
              b.batchId === 'batch-connected-assets' 
                ? { ...b, assets: [...b.assets, ...uniqueNew] }
                : b
            );
          } else {
            // Create new batch
            return [...prev, {
              batchId: 'batch-connected-assets',
              circuitIds: [],
              assets: newAssets,
              loadedAt: Date.now()
            }];
          }
        });
        
      } catch (error) {
        console.error(`❌ Failed to fetch connected assets:`, error);
      }
    };
    
    fetchConnectedAssets();
  }, [selectedAsset, assets.length]); // Removed pinnedAssetIdsRef.current.size to prevent re-runs

  // PROGRESSIVE LOADING: Aggressive parallel loading with zero debounce
  // CULLING: Remove assets far outside viewport to optimize memory
  useEffect(() => {
    if (currentZoom < 10) return;
    
    // ZERO DEBOUNCE - load immediately on viewport change
    // No blocking guard - deduplication handled by loadingCircuitsRef
    const loadAssets = async () => {
      try {
        // ACCURATE VIEWPORT: Use WebMercatorViewport for precise bounds calculation
        const viewport = new WebMercatorViewport({
          width: typeof window !== 'undefined' ? window.innerWidth : 1920,
          height: typeof window !== 'undefined' ? window.innerHeight : 1080,
          longitude: throttledViewport.longitude,
          latitude: throttledViewport.latitude,
          zoom: currentZoom,
          pitch: viewState.pitch || 0,
          bearing: viewState.bearing || 0
        });
        
        // Get accurate bounds accounting for pitch/bearing/latitude distortion
        // getBounds returns [minLng, minLat, maxLng, maxLat] as a flat array
        const bounds = viewport.getBounds();
        const west = bounds[0];
        const south = bounds[1];
        const east = bounds[2];
        const north = bounds[3];
        
        // BUFFER STRATEGY (OPTIMIZED):
        // - Load buffer: 1.2x (load just around viewport)
        // - Cull buffer: 2.0x (cull much sooner to prevent 200K+ buildup - TIGHTENED from 2.5x)
        // - This ensures: cull buffer > load buffer (no thrashing)
        const loadBuffer = 1.2;
        const cullBuffer = 2.0;  // REDUCED from 2.5 for aggressive memory management
        
        // Calculate load bounds with buffer
        const loadLngRange = (east - west) * (loadBuffer - 1) / 2;
        const loadLatRange = (north - south) * (loadBuffer - 1) / 2;
        const loadMinLng = west - loadLngRange;
        const loadMaxLng = east + loadLngRange;
        const loadMinLat = south - loadLatRange;
        const loadMaxLat = north + loadLatRange;
        
        // Calculate cull bounds with larger buffer
        const cullLngRange = (east - west) * (cullBuffer - 1) / 2;
        const cullLatRange = (north - south) * (cullBuffer - 1) / 2;
        const cullMinLng = west - cullLngRange;
        const cullMaxLng = east + cullLngRange;
        const cullMinLat = south - cullLatRange;
        const cullMaxLat = north + cullLatRange;
        
        // Use throttledViewport for center calculations
        const centerLng = throttledViewport.longitude;
        const centerLat = throttledViewport.latitude;
        
        // 🗺️ GEOGRAPHIC DISTRIBUTION: Grid-based circuit sampling to prevent Houston center clustering
        // Problem: Dense areas (Houston center) have more circuits → random sampling biases toward center
        // Solution: Divide viewport into grid cells, sample circuits proportionally from EACH cell
        // This ensures even distribution across visible Houston metro area (not just downtown)
        
        // Get all circuits in viewport with their positions
        const circuitsInViewport = serviceAreas
          .filter(sa => {
            const lat = sa.CENTROID_LAT;
            const lon = sa.CENTROID_LON;
            if (!lat || !lon) return false;
            
            return lon >= loadMinLng && lon <= loadMaxLng && lat >= loadMinLat && lat <= loadMaxLat;
          })
          .map(sa => ({
            circuit_id: sa.CIRCUIT_ID,
            substation_id: sa.SUBSTATION_ID,
            lat: sa.CENTROID_LAT,
            lon: sa.CENTROID_LON,
            distance: Math.sqrt(
              Math.pow(sa.CENTROID_LAT - centerLat, 2) +
              Math.pow(sa.CENTROID_LON - centerLng, 2)
            )
          }));
        
        // 🎯 STRATEGY #8: DUAL-MODE: Substation-Based + Grid-Based Sampling
        // Load ALL circuits for each substation in viewport (ensures 275 substations always populate)
        // PLUS grid-based sampling for geographic distribution
        
        // Calculate minimum circuits per substation based on zoom level
        let minCircuitsPerSubstation: number;
        let minAssetsPerSubstation: number;
        
        if (throttledZoom < 10) {
          minCircuitsPerSubstation = 2;  // Load 2 circuits per substation at low zoom
          minAssetsPerSubstation = 300;
        } else if (throttledZoom < 11.3) {
          minCircuitsPerSubstation = 3;  // Load 3 circuits per substation until zoom 11.3
          minAssetsPerSubstation = 500;  // Target: 500+ assets per substation
        } else if (throttledZoom < 12) {
          minCircuitsPerSubstation = 5;  // More circuits at higher zoom
          minAssetsPerSubstation = 1000;
        } else {
          minCircuitsPerSubstation = 10; // Load most circuits per substation at high zoom
          minAssetsPerSubstation = 2000;
        }
        
        // Group circuits by substation ID
        const substationCircuits = new Map<string, typeof circuitsInViewport>();
        circuitsInViewport.forEach(circuit => {
          // Skip circuits without substation ID
          if (!circuit.substation_id) return;
          
          const substationId = circuit.substation_id;
          if (!substationCircuits.has(substationId)) {
            substationCircuits.set(substationId, []);
          }
          substationCircuits.get(substationId)!.push(circuit);
        });
        
        // SUBSTATION-BASED SAMPLING: Select circuits for each substation
        const sampled: typeof circuitsInViewport = [];
        const substationStats: { substationId: string; circuitsInSubstation: number; circuitsSelected: number; estimatedAssets: number; }[] = [];
        
        substationCircuits.forEach((circuits, substationId) => {
          // Sort by distance within substation (closest first for loading priority)
          circuits.sort((a, b) => a.distance - b.distance);
          
          // Select circuits: Load minCircuitsPerSubstation for each substation
          const selectCount = Math.min(circuits.length, minCircuitsPerSubstation);
          sampled.push(...circuits.slice(0, selectCount));
          
          // Track stats for logging
          substationStats.push({
            substationId,
            circuitsInSubstation: circuits.length,
            circuitsSelected: selectCount,
            estimatedAssets: selectCount * 82  // Avg 82 assets per circuit
          });
        });
        
        // Sort final sampled list by distance (closest first for loading priority)
        sampled.sort((a, b) => a.distance - b.distance);
        let sampledCircuits = sampled.map(c => c.circuit_id);
        
        // PINNED CIRCUITS: Always include circuits for selected asset (prioritize at front)
        if (pinnedCircuitsRef.current.size > 0) {
          const pinnedArray = Array.from(pinnedCircuitsRef.current);
          // Remove pinned from sampled to avoid duplicates, then prepend pinned
          sampledCircuits = sampledCircuits.filter(cid => !pinnedCircuitsRef.current.has(cid));
          sampledCircuits = [...pinnedArray, ...sampledCircuits];
          console.log(`   📌 Prioritized ${pinnedArray.length} pinned circuits for selected asset`);
        }
        
        // HIGH ZOOM ENHANCEMENT: At zoom >= 14, include circuits from ALL visible topology
        // This ensures we load assets for every topology connection we're showing
        if (throttledZoom >= 14 && topology.length > 0) {
          const topologyCircuitIds = new Set<string>();
          
          // Get all assets in viewport from loaded topology
          const viewportTopology = topology.filter(link =>
            (link.from_longitude >= loadMinLng && link.from_longitude <= loadMaxLng &&
             link.from_latitude >= loadMinLat && link.from_latitude <= loadMaxLat) ||
            (link.to_longitude >= loadMinLng && link.to_longitude <= loadMaxLng &&
             link.to_latitude >= loadMinLat && link.to_latitude <= loadMaxLat)
          );
          
          // Find circuit IDs for assets in this topology
          const topologyAssetIds = new Set<string>();
          viewportTopology.forEach(link => {
            topologyAssetIds.add(link.from_asset_id);
            topologyAssetIds.add(link.to_asset_id);
          });
          
          // Map asset IDs to circuit IDs from current assets
          assets.forEach(asset => {
            if (topologyAssetIds.has(asset.id) && asset.circuit_id) {
              topologyCircuitIds.add(asset.circuit_id);
            }
          });
          
          // Also check service areas for circuit mapping
          serviceAreas.forEach(sa => {
            const hasAssetInTopology = topologyAssetIds.has(sa.CIRCUIT_ID);
            if (hasAssetInTopology && sa.CIRCUIT_ID) {
              topologyCircuitIds.add(sa.CIRCUIT_ID);
            }
          });
          
          // Merge with sampled circuits
          const additionalCircuits = Array.from(topologyCircuitIds).filter(cid => !sampledCircuits.includes(cid));
          if (additionalCircuits.length > 0) {
            console.log(`   🔗 High zoom (${throttledZoom.toFixed(1)}): Adding ${additionalCircuits.length} circuits from visible topology`);
            sampledCircuits = [...sampledCircuits, ...additionalCircuits];
          }
        }
        
        // Enhanced logging with substation statistics
        const substationsInViewport = substationCircuits.size;
        const avgCircuitsPerSubstation = substationStats.reduce((sum, s) => sum + s.circuitsInSubstation, 0) / substationStats.length;
        const avgSelectedPerSubstation = substationStats.reduce((sum, s) => sum + s.circuitsSelected, 0) / substationStats.length;
        const avgEstimatedAssetsPerSubstation = substationStats.reduce((sum, s) => sum + s.estimatedAssets, 0) / substationStats.length;
        const totalEstimatedAssets = substationStats.reduce((sum, s) => sum + s.estimatedAssets, 0);
        
        console.log(`   🏭 Substation-based sampling: ${substationsInViewport} substations in viewport | Circuits: ${avgCircuitsPerSubstation.toFixed(1)} avg → ${avgSelectedPerSubstation.toFixed(1)} selected/substation (min ${minCircuitsPerSubstation}) | Est Assets: ${avgEstimatedAssetsPerSubstation.toFixed(0)}/substation (${totalEstimatedAssets.toLocaleString()} total) | Target: ${minAssetsPerSubstation}+ assets/substation @ zoom ${throttledZoom.toFixed(1)}`);
        
        // Find circuits not yet loaded AND not currently loading
        // USE REF (not recalculating from assets) to prevent reload loop when assets are culled
        
        // CIRCUIT CLEANUP: Remove circuits that are BOTH not sampled AND outside cull bounds
        // This prevents holding onto circuits from previous viewport while allowing visible circuits to remain
        const sampledCircuitsSet = new Set(sampledCircuits);
        
        // Build set of circuit IDs that have assets in cull bounds
        const circuitsInCullBounds = new Set<string>();
        circuitBatches.forEach(batch => {
          if (batch.batchId === 'batch-substations') return; // Skip substations
          const hasAssetsInBounds = batch.assets.some(a => 
            a.longitude >= cullMinLng && a.longitude <= cullMaxLng &&
            a.latitude >= cullMinLat && a.latitude <= cullMaxLat
          );
          if (hasAssetsInBounds) {
            batch.circuitIds.forEach(cid => circuitsInCullBounds.add(cid));
          }
        });
        
        const circuitsToRemove: string[] = [];
        loadedCircuitsRef.current.forEach(cid => {
          // Only remove if NOT sampled AND NOT in cull bounds AND NOT pinned
          if (!sampledCircuitsSet.has(cid) && !circuitsInCullBounds.has(cid) && !pinnedCircuitsRef.current.has(cid)) {
            circuitsToRemove.push(cid);
          }
        });
        circuitsToRemove.forEach(cid => loadedCircuitsRef.current.delete(cid));
        if (circuitsToRemove.length > 0) {
          console.log(`   🧹 Removed ${circuitsToRemove.length} circuits outside cull bounds (${loadedCircuitsRef.current.size} remain loaded, ${pinnedCircuitsRef.current.size} pinned)`);
        }
        
        // CRITICAL FIX: Include pinned circuits (from substation selection) in addition to viewport circuits
        // Without this, selecting a substation pins circuits but they never get queued for loading
        const circuitsToConsider = new Set([
          ...sampledCircuits,
          ...Array.from(pinnedCircuitsRef.current)
        ]);
        
        const newCircuits = Array.from(circuitsToConsider).filter(cid => 
          !loadedCircuitsRef.current.has(cid) && !loadingCircuitsRef.current.has(cid)
        );
        
        // Log pinned circuits separately for visibility
        const pinnedNewCircuits = Array.from(pinnedCircuitsRef.current).filter(cid => 
          !loadedCircuitsRef.current.has(cid) && !loadingCircuitsRef.current.has(cid)
        );
        if (pinnedNewCircuits.length > 0) {
          console.log(`   📍 ${pinnedNewCircuits.length} pinned circuits need loading`);
        }
        
        // REDUCED LOGGING: Only log when there are new circuits to load or limits hit
        if (newCircuits.length > 0 || limitsReachedRef.current) {
          console.log(`   📊 Viewport [${centerLng.toFixed(3)}, ${centerLat.toFixed(3)}]: ${circuitsInViewport.length} circuits visible, ${loadedCircuitsRef.current.size} loaded, ${newCircuits.length} new | Assets: ${assets.length.toLocaleString()}`);
        }
        
        // VIEWPORT CHANGE DETECTION: Clear limits flag when user significantly changes viewport
        // This allows reloading in new areas after limits were reached in previous viewport
        // Calculate distance moved from last load attempt
        const lastViewport = lastLoadAttemptViewportRef.current;
        if (lastViewport) {
          const lngDiff = Math.abs(centerLng - lastViewport.lng);
          const latDiff = Math.abs(centerLat - lastViewport.lat);
          const zoomDiff = Math.abs(throttledZoom - lastViewport.zoom);
          
          // If viewport moved significantly (>0.01 degrees ~1km or >0.5 zoom levels), clear limits flag
          // TIGHTENED: Reduced from 0.1 to 0.01 degrees for more responsive unloading
          const viewportChangedSignificantly = lngDiff > 0.01 || latDiff > 0.01 || zoomDiff > 0.5;
          
          if (viewportChangedSignificantly && limitsReachedRef.current) {
            console.log(`   🔄 Viewport changed significantly (lng: ${lngDiff.toFixed(3)}, lat: ${latDiff.toFixed(3)}, zoom: ${zoomDiff.toFixed(3)}) - clearing limits flag to allow loading in new area`);
            limitsReachedRef.current = false;
          }
        }
        
        // ZOOM-LEVEL AGGRESSIVE CULLING: Enforce zoom-based asset limits (MUCH MORE AGGRESSIVE)
        // IMPORTANT: Run BEFORE early exit so culling happens even when limits reached
        // When zooming IN, limits decrease - must cull excess assets
        // TIGHTENED: Reduced limits by 60% to prevent 200K+ buildup
        // DEBOUNCED: Only cull every 500ms to prevent blocking during rapid pan/zoom
        // HIGH ZOOM: Much stricter limits at zoom >= 14 (small viewports)
        let maxAssetsForZoom: number;
        if (throttledZoom < 11) {
          maxAssetsForZoom = 40000;
        } else if (throttledZoom < 12) {
          maxAssetsForZoom = 50000;
        } else if (throttledZoom < 14) {
          maxAssetsForZoom = 80000;
        } else if (throttledZoom < 16) {
          maxAssetsForZoom = 20000;  // Zoom 14-16: Small viewport, limit to 20k
        } else {
          maxAssetsForZoom = 10000;  // Zoom 16+: Tiny viewport, limit to 10k
        }
        
        const needsAggressiveCull = assets.length > maxAssetsForZoom; // Removed blocking condition
        const timeSinceLastCull = Date.now() - lastCullTimeRef.current;
        const timeSinceSelection = Date.now() - lastSelectionTimeRef.current;
        const canCullNow = timeSinceLastCull >= 500 && timeSinceSelection >= 2000; // Wait 2s after selection for pinned circuits to load
        
        // 🔍 SIMPLE DEBUG: One-line status
        const willCull = needsAggressiveCull && canCullNow;
        const blockedBy = !willCull ? (assets.length <= maxAssetsForZoom ? 'under-cap' : timeSinceSelection < 2000 ? 'recent-selection' : loadingCircuitsRef.current.size > 0 ? 'loading-circuits' : !canCullNow ? 'debounce' : 'unknown') : 'none';
        console.log(`🔍 CULL CHECK: ${assets.length.toLocaleString()}/${maxAssetsForZoom.toLocaleString()} assets | zoom ${throttledZoom.toFixed(1)} | loading ${loadingCircuitsRef.current.size} circuits | ${willCull ? '✅ WILL CULL' : '❌ BLOCKED: ' + blockedBy}`);
        
        if (needsAggressiveCull && canCullNow) {
          console.log(`   ⚠️ Aggressive cull triggered: ${assets.length.toLocaleString()} > ${maxAssetsForZoom.toLocaleString()} at zoom ${throttledZoom.toFixed(2)}`);
          lastCullTimeRef.current = Date.now(); // Update last cull time
          
          // Aggressive cull: Keep only viewport assets (1.5x buffer, not 3.5x)
          // Calculate viewport span from bounds
          const lngSpan = (east - west) / 2;
          const latSpan = (north - south) / 2;
          const viewportBuffer = 1.5;  // Increased from 1.0 to 1.5 for smoother panning
          const aggCullMinLng = viewState.longitude - (lngSpan * viewportBuffer);
          const aggCullMaxLng = viewState.longitude + (lngSpan * viewportBuffer);
          const aggCullMinLat = viewState.latitude - (latSpan * viewportBuffer);
          const aggCullMaxLat = viewState.latitude + (latSpan * viewportBuffer);
          
          // OPTIMIZED CULLING: Work with batches directly instead of flattening/filtering 120k asset array
          // This prevents blocking operations on huge arrays during aggressive culls
          const assetsBeforeCull = assets.length;
          let totalRemoved = 0;
          const culledCircuits = new Set<string>();
          
          // BATCH-BASED CULLING: Filter each batch separately (prevents 120k array operations)
          setCircuitBatches(prev => {
            const filtered = prev.map(batch => {
              // Keep substations batch always (return SAME object to preserve batched rendering)
              if (batch.batchId === 'batch-substations') return batch;
              
              // Keep connected assets batch always (for selected asset topology)
              if (batch.batchId === 'batch-connected-assets') return batch;
              
              // Keep pinned circuits (for selected asset) - return SAME object
              const hasPinnedCircuit = batch.circuitIds.some(cid => pinnedCircuitsRef.current.has(cid));
              if (hasPinnedCircuit) return batch;
              
              // Filter assets in this batch to only include those in tight viewport
              const remainingAssets = batch.assets.filter(a => {
                if (a.type === 'substation') return true;
                return a.longitude >= aggCullMinLng && a.longitude <= aggCullMaxLng &&
                       a.latitude >= aggCullMinLat && a.latitude <= aggCullMaxLat;
              });
              
              // Track removed assets from this batch
              const removedFromBatch = batch.assets.length - remainingAssets.length;
              if (removedFromBatch > 0) {
                totalRemoved += removedFromBatch;
                batch.circuitIds.forEach(cid => culledCircuits.add(cid));
                
                // Only create NEW batch object if assets were removed
                if (remainingAssets.length > 0) {
                  return { ...batch, assets: remainingAssets };
                }
                // Return null to filter out empty batches
                return null;
              }
              
              // No assets removed - return SAME object to preserve batched rendering
              return batch;
            }).filter((batch): batch is CircuitBatch => batch !== null);
            
            if (totalRemoved > 0) {
              console.log(`   🗑️ Aggressively culled ${totalRemoved.toLocaleString()} assets from ${culledCircuits.size} circuits (${assetsBeforeCull.toLocaleString()} → ${(assetsBeforeCull - totalRemoved).toLocaleString()})`);
            }
            
            return filtered;
          });
          
          // Mark circuits as unloaded (except pinned ones)
          culledCircuits.forEach(cid => {
            if (loadedCircuitsRef.current.has(cid) && !pinnedCircuitsRef.current.has(cid)) {
              loadedCircuitsRef.current.delete(cid);
            }
          });
          
          // Only proceed with topology culling if we actually removed assets
          if (totalRemoved > 0) {
            limitsReachedRef.current = false;
            
            // Build remaining asset IDs from filtered batches (after state update)
            // Use setTimeout to prevent blocking main thread during large state transitions
            setTimeout(() => {
              const remainingAssetIds = new Set(assets.map(a => a.id));
              const topologyBeforeCull = topology.length;
              
              setTopologyBatches(prev => {
                const filtered = prev.map(batch => {
                  const filteredConnections = batch.connections.filter(t => {
                    if (!remainingAssetIds.has(t.from_asset_id) || !remainingAssetIds.has(t.to_asset_id)) {
                      return false;
                    }
                    const fromInBounds = t.from_longitude >= aggCullMinLng && t.from_longitude <= aggCullMaxLng &&
                                       t.from_latitude >= aggCullMinLat && t.from_latitude <= aggCullMaxLat;
                    const toInBounds = t.to_longitude >= aggCullMinLng && t.to_longitude <= aggCullMaxLng &&
                                     t.to_latitude >= aggCullMinLat && t.to_latitude <= aggCullMaxLat;
                    return fromInBounds || toInBounds;
                  });
                  
                  return { ...batch, connections: filteredConnections };
                }).filter(batch => batch.connections.length > 0); // Remove empty batches
                
                // Calculate from filtered result, not stale state
                const topologyAfterCull = filtered.flatMap(b => b.connections).length;
                if (topologyAfterCull < topologyBeforeCull) {
                  console.log(`   🗑️ Also removed ${(topologyBeforeCull - topologyAfterCull).toLocaleString()} topology connections`);
                }
                
                return filtered;
              });
            }, 0); // Run after current render cycle completes
          }
          
          // IMPORTANT: Don't return after culling - check if viewport needs circuit loading below
        }
        
        // STANDARD CULLING: Remove assets far outside viewport (MORE AGGRESSIVE)
        // IMPORTANT: Cull AFTER checking loaded circuits (don't affect load calculations)
        // TIGHTENED: Start culling much earlier (1000 instead of 2000)
        // Need at least 1000 assets before culling (275 substations + buffer for active circuits)
        if (assets.length > 1000 && loadingCircuitsRef.current.size === 0 && !needsAggressiveCull) { // Only cull when NOT actively loading AND not already aggressively culled
          // OPTIMIZED CULLING: Work with batches directly instead of flattening/filtering entire asset array
          const assetsBeforeCull = assets.length;
          let totalRemoved = 0;
          const culledCircuits = new Set<string>();
          
          // BATCH-BASED CULLING: Filter each batch separately (prevents blocking on large arrays)
          setCircuitBatches(prev => {
            const filtered = prev.map(batch => {
              // Keep substations batch always (return SAME object to preserve batched rendering)
              if (batch.batchId === 'batch-substations') return batch;
              
              // Keep connected assets batch always (for selected asset topology)
              if (batch.batchId === 'batch-connected-assets') return batch;
              
              // Keep pinned circuits (for selected asset) - return SAME object
              const hasPinnedCircuit = batch.circuitIds.some(cid => pinnedCircuitsRef.current.has(cid));
              if (hasPinnedCircuit) return batch;
              
              // Filter assets in this batch to only include those in cull bounds
              const remainingAssets = batch.assets.filter(a => {
                if (a.type === 'substation') return true;
                return a.longitude >= cullMinLng && a.longitude <= cullMaxLng &&
                       a.latitude >= cullMinLat && a.latitude <= cullMaxLat;
              });
              
              // Track removed assets from this batch
              const removedFromBatch = batch.assets.length - remainingAssets.length;
              if (removedFromBatch > 0) {
                totalRemoved += removedFromBatch;
                batch.circuitIds.forEach(cid => culledCircuits.add(cid));
                
                // Only create NEW batch object if assets were removed
                if (remainingAssets.length > 0) {
                  return { ...batch, assets: remainingAssets };
                }
                // Return null to filter out empty batches
                return null;
              }
              
              // No assets removed - return SAME object to preserve batched rendering
              return batch;
            }).filter((batch): batch is CircuitBatch => batch !== null);
            
            if (totalRemoved > 0) {
              console.log(`   🗑️ Culled ${totalRemoved.toLocaleString()} assets from ${culledCircuits.size} circuits outside 2.0x viewport (${assetsBeforeCull.toLocaleString()} → ${(assetsBeforeCull - totalRemoved).toLocaleString()})`);
            }
            
            return filtered;
          });
          
          // Mark circuits as unloaded (except pinned ones)
          culledCircuits.forEach(cid => {
            if (loadedCircuitsRef.current.has(cid) && !pinnedCircuitsRef.current.has(cid)) {
              loadedCircuitsRef.current.delete(cid);
            }
          });
          
          // Only proceed with topology culling if we actually removed assets
          if (totalRemoved > 0) {
            // CLEAR limits flag when culling (since we freed up memory)
            limitsReachedRef.current = false;
            
            // Use setTimeout to prevent blocking main thread during large state transitions
            setTimeout(() => {
              const remainingAssetIds = new Set(assets.map(a => a.id));
              const topologyBeforeCull = topology.length;
              
              setTopologyBatches(prev => {
                const filtered = prev.map(batch => {
                  const filteredConnections = batch.connections.filter(t => {
                    // Must have both endpoints still loaded
                    if (!remainingAssetIds.has(t.from_asset_id) || !remainingAssetIds.has(t.to_asset_id)) {
                      return false;
                    }
                    // AND at least one endpoint must be in viewport cull bounds
                    const fromInBounds = t.from_longitude >= cullMinLng && t.from_longitude <= cullMaxLng &&
                                       t.from_latitude >= cullMinLat && t.from_latitude <= cullMaxLat;
                    const toInBounds = t.to_longitude >= cullMinLng && t.to_longitude <= cullMaxLng &&
                                     t.to_latitude >= cullMinLat && t.to_latitude <= cullMaxLat;
                    return fromInBounds || toInBounds;
                  });
                  
                  return { ...batch, connections: filteredConnections };
                }).filter(batch => batch.connections.length > 0);
                
                // Calculate from filtered result, not stale state
                const topologyAfterCull = filtered.flatMap(b => b.connections).length;
                if (topologyAfterCull < topologyBeforeCull) {
                  console.log(`   🗑️ Culled ${(topologyBeforeCull - topologyAfterCull).toLocaleString()} topology connections (${topologyBeforeCull.toLocaleString()} → ${topologyAfterCull.toLocaleString()})`);
                }
                
                return filtered;
              });
            }, 0); // Run after current render cycle completes
          }
        }
        
        // PERIODIC TOPOLOGY CLEANUP: Remove topology outside viewport (PRIORITY-BASED)
        // Only cleanup when NOT actively loading to prevent state churn
        // PRIORITY SYSTEM: Keep 'active' (current viewport) topology, aggressively remove 'inactive'
        if (topology.length > 2000 && loadingCircuitsRef.current.size === 0) {
          const topologyBeforeCleanup = topology.length;
          
          // DISTANCE-BASED PRIORITY: Use tight bounds for distant batches, wide for nearby
          // Calculate distance from current viewport center to each batch's original load location
          const centerLng = (east + west) / 2;
          const centerLat = (north + south) / 2;
          const tightCleanupBuffer = 1.5;
          const activeCleanupBuffer = 2.5;
          
          const tightLngRange = (east - west) * (tightCleanupBuffer - 1) / 2;
          const tightLatRange = (north - south) * (tightCleanupBuffer - 1) / 2;
          const tightMinLng = west - tightLngRange;
          const tightMaxLng = east + tightLngRange;
          const tightMinLat = south - tightLatRange;
          const tightMaxLat = north + tightLatRange;
          
          const activeLngRange = (east - west) * (activeCleanupBuffer - 1) / 2;
          const activeLatRange = (north - south) * (activeCleanupBuffer - 1) / 2;
          const activeMinLng = west - activeLngRange;
          const activeMaxLng = east + activeLngRange;
          const activeMinLat = south - activeLatRange;
          const activeMaxLat = north + activeLatRange;
          
          setTopologyBatches(prev => {
            const cleaned = prev.map(batch => {
              // Calculate distance from current viewport to batch's load location
              // Use simple lat/lng distance (good enough for priority calculation)
              const latDiff = batch.viewportCenter.lat - centerLat;
              const lngDiff = batch.viewportCenter.lng - centerLng;
              const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
              
              // Threshold: ~0.1 degrees (~10km) - batches closer than this get wide bounds
              const isNearby = distance < 0.1;
              const minLng = isNearby ? activeMinLng : tightMinLng;
              const maxLng = isNearby ? activeMaxLng : tightMaxLng;
              const minLat = isNearby ? activeMinLat : tightMinLat;
              const maxLat = isNearby ? activeMaxLat : tightMaxLat;
              
              const cleanedConnections = batch.connections.filter(t => {
                // Keep if either endpoint is in bounds
                const fromInBounds = t.from_longitude >= minLng && t.from_longitude <= maxLng &&
                                   t.from_latitude >= minLat && t.from_latitude <= maxLat;
                const toInBounds = t.to_longitude >= minLng && t.to_longitude <= maxLng &&
                                 t.to_latitude >= minLat && t.to_latitude <= maxLat;
                return fromInBounds || toInBounds;
              });
              
              return { ...batch, connections: cleanedConnections };
            }).filter(batch => batch.connections.length > 0);
            
            // Calculate from filtered result, not stale state
            const topologyAfterCleanup = cleaned.flatMap(b => b.connections).length;
            if (topologyAfterCleanup < topologyBeforeCleanup) {
              console.log(`   🧹 Periodic topology cleanup: ${(topologyBeforeCleanup - topologyAfterCleanup).toLocaleString()} removed (${topologyBeforeCleanup.toLocaleString()} → ${topologyAfterCleanup.toLocaleString()}) | Batches: ${cleaned.length}`);
            }
            
            return cleaned;
          });
        }
        
        // INTELLIGENT BACKOFF: Prevent struggling at 60k-100k+ assets
        // Prioritize unloading distant batches based on viewport distance and zoom level
        // This keeps the app performant by staying well under 100k assets
        const PERFORMANCE_CEILING = 100000; // Hard performance ceiling
        const BACKOFF_THRESHOLD = 60000;    // Start aggressive unloading here (TIGHTENED from 80k)
        
        if (assets.length > BACKOFF_THRESHOLD && loadingCircuitsRef.current.size === 0) {
          console.log(`   ⚡ BACKOFF TRIGGERED: ${assets.length.toLocaleString()} assets loaded (threshold: ${BACKOFF_THRESHOLD.toLocaleString()})`);
          
          const centerLng = (east + west) / 2;
          const centerLat = (north + south) / 2;
          
          // Calculate distance from viewport center for each batch
          // Priority: Keep batches closest to current viewport, unload furthest first
          type BatchWithDistance = CircuitBatch & { distance: number };
          
          const batchesWithDistance: BatchWithDistance[] = circuitBatches
            .filter(b => b.batchId !== 'batch-substations') // Never unload substations
            .map(batch => {
              // Calculate average position of assets in this batch
              const avgLng = batch.assets.reduce((sum, a) => sum + a.longitude, 0) / batch.assets.length;
              const avgLat = batch.assets.reduce((sum, a) => sum + a.latitude, 0) / batch.assets.length;
              
              // Simple Euclidean distance from viewport center
              const latDiff = avgLat - centerLat;
              const lngDiff = avgLng - centerLng;
              const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
              
              return { ...batch, distance };
            })
            .sort((a, b) => b.distance - a.distance); // Sort furthest first
          
          // Calculate how many assets we need to remove
          const targetAssetCount = Math.floor(BACKOFF_THRESHOLD * 0.75); // Target 75% of threshold (MORE AGGRESSIVE)
          const assetsToRemove = assets.length - targetAssetCount;
          
          if (assetsToRemove > 0) {
            // Unload batches starting from furthest until we hit target
            let removedCount = 0;
            const batchIdsToRemove = new Set<string>();
            const circuitsToUnload = new Set<string>();
            
            for (const batch of batchesWithDistance) {
              if (removedCount >= assetsToRemove) break;
              
              // CRITICAL: Don't unload batches containing pinned circuits (e.g., from selected substations)
              const hasPinnedCircuit = batch.circuitIds.some(cid => pinnedCircuitsRef.current.has(cid));
              if (hasPinnedCircuit) {
                console.log(`   📍 Skipping batch ${batch.batchId} - contains ${batch.circuitIds.filter(cid => pinnedCircuitsRef.current.has(cid)).length} pinned circuits`);
                continue;
              }
              
              batchIdsToRemove.add(batch.batchId);
              batch.circuitIds.forEach(cid => circuitsToUnload.add(cid));
              removedCount += batch.assets.length;
            }
            
            console.log(`   🎯 Unloading ${batchIdsToRemove.size} distant batches (${removedCount.toLocaleString()} assets, ${circuitsToUnload.size} circuits)`);
            console.log(`   📍 Furthest batch distance: ${batchesWithDistance[0]?.distance.toFixed(4)} degrees (~${(batchesWithDistance[0]?.distance * 111).toFixed(1)}km)`);
            
            // Remove batches from state
            setCircuitBatches(prev => 
              prev.filter(b => !batchIdsToRemove.has(b.batchId))
            );
            
            // Remove associated topology
            setTopologyBatches(prev => {
              const filtered = prev.filter(batch => {
                // Keep if none of its circuits are being unloaded
                return !batch.circuitIds.some(cid => circuitsToUnload.has(cid));
              });
              
              const removedTopology = prev.flatMap(b => b.connections).length - 
                                     filtered.flatMap(b => b.connections).length;
              if (removedTopology > 0) {
                console.log(`   🗑️ Also removed ${removedTopology.toLocaleString()} topology connections from distant batches`);
              }
              
              return filtered;
            });
            
            // Mark circuits as unloaded
            circuitsToUnload.forEach(cid => {
              loadedCircuitsRef.current.delete(cid);
              loadingCircuitsRef.current.delete(cid);
            });
            
            // Clear limits flag since we freed up space
            limitsReachedRef.current = false;
            
            console.log(`   ✅ Backoff complete: ${assets.length.toLocaleString()} → ~${(assets.length - removedCount).toLocaleString()} assets - limits flag cleared`);
          }
        }
        
        // EARLY EXIT: If limits were already reached, don't try NEW LOADING until user pans/zooms significantly
        // IMPORTANT: This comes AFTER culling/backoff so those systems can free up space
        if (limitsReachedRef.current && newCircuits.length > 0) {
          console.log(`   ⏸️ Limits reached - waiting for culling/backoff or user to pan to new area (${newCircuits.length} unloadable circuits)`);
          return; // Don't attempt new loading until limits are cleared by culling or viewport change
        }
        
        // Track current viewport ONLY when we're about to attempt loading
        // This ensures we compare against the LAST LOAD ATTEMPT, not the previous frame
        lastLoadAttemptViewportRef.current = { lng: centerLng, lat: centerLat, zoom: throttledZoom };
        
        if (newCircuits.length > 0) {
          // SUBSTATION-BASED LIMITS: Prevent loading too many assets
          // With substation-based sampling, we expect ~118 substations × 3 circuits = ~354 circuits at zoom < 11.3
          // HIGH ZOOM: Much stricter limits at zoom >= 14 (small viewports need fewer assets)
          // CRITICAL: Include pending assets to prevent parallel batch overshoot
          const totalAssets = assets.length + pendingAssetCountRef.current;
          let maxAssetsAllowed: number;
          let maxCircuitsAllowed: number;
          
          if (throttledZoom < 11) {
            maxAssetsAllowed = 40000;
            maxCircuitsAllowed = 200;
          } else if (throttledZoom < 12) {
            maxAssetsAllowed = 60000;
            maxCircuitsAllowed = 400;
          } else if (throttledZoom < 14) {
            maxAssetsAllowed = 100000;
            maxCircuitsAllowed = 600;
          } else if (throttledZoom < 16) {
            maxAssetsAllowed = 20000;  // Zoom 14-16: Small viewport
            maxCircuitsAllowed = 100;
          } else {
            maxAssetsAllowed = 10000;  // Zoom 16+: Tiny viewport
            maxCircuitsAllowed = 50;
          }
          
          // Hard stop at 100% cap (no threshold needed with zoom-aware sampling)
          if (totalAssets >= maxAssetsAllowed) {
            console.log(`   ⚠️ Asset limit reached: ${totalAssets.toLocaleString()}/${maxAssetsAllowed.toLocaleString()} assets (${assets.length.toLocaleString()} loaded + ${pendingAssetCountRef.current.toLocaleString()} pending). Backing off until culling or user pans away.`);
            limitsReachedRef.current = true; // Set flag to prevent retries
            return;
          }
          
          if (loadedCircuitsRef.current.size >= maxCircuitsAllowed) {
            console.log(`   ⚠️ Circuit limit reached: ${loadedCircuitsRef.current.size}/${maxCircuitsAllowed} circuits loaded. Backing off until culling or user pans away.`);
            limitsReachedRef.current = true; // Set flag to prevent retries
            return;
          }
          
          // PRE-CHECK: Also check topology cap BEFORE loading (prevents overshoot)
          const currentTopologyCount = topology.length;
          const maxTopologyAllowed = 50000;
          if (currentTopologyCount >= maxTopologyAllowed) {
            console.log(`   ⚠️ Topology limit reached: ${currentTopologyCount.toLocaleString()}/${maxTopologyAllowed.toLocaleString()} connections loaded. Backing off until culling or user pans away.`);
            limitsReachedRef.current = true; // Set flag to prevent retries
            return;
          }
          
          // Conservative loading: Max 15 circuits per viewport update (reduced from 20 for stability)
          const circuitsToLoad = newCircuits.slice(0, 15);
          
          console.log(`   🔄 Loading ${circuitsToLoad.length}/${newCircuits.length} circuits (${loadedCircuitsRef.current.size} already loaded)...`);
          
          // Mark circuits as loading
          circuitsToLoad.forEach(cid => loadingCircuitsRef.current.add(cid));
          
          // PARALLEL LOADING: Split into 5-circuit batches (reduced from 10 for stability)
          const batchSize = 5; // Smaller batches = less chance of timeout
          const batches: string[][] = [];
          for (let i = 0; i < circuitsToLoad.length; i += batchSize) {
            batches.push(circuitsToLoad.slice(i, i + batchSize));
          }
          
          // Fire all batch requests in parallel - load BOTH assets AND topology for each batch
          const batchPromises = batches.map(async (batch, idx) => {
            const circuitParam = batch.join(',');
            
            // Helper: Add timeout and retry to fetch requests (Engineering: handle network instability)
            const fetchWithRetry = async (url: string, timeout = 45000, maxRetries = 2): Promise<Response> => {
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), timeout);
                  
                  const response = await fetch(url, { signal: controller.signal });
                  clearTimeout(timeoutId);
                  return response;
                } catch (err: any) {
                  if (attempt < maxRetries && (err.name === 'AbortError' || err.message?.includes('timeout'))) {
                    console.log(`   ⚠️ Batch ${idx + 1} attempt ${attempt + 1} failed, retrying...`);
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Backoff: 1s, 2s
                    continue;
                  }
                  throw err;
                }
              }
              throw new Error('Request failed after retries');
            };
            
            // Load assets and topology in parallel for this circuit batch
            const [assetsData, topologyData] = await Promise.all([
              fetchWithRetry(`/api/assets?circuits=${encodeURIComponent(circuitParam)}`).then(async r => {
                if (!r.ok) throw new Error(`Assets HTTP ${r.status}: ${r.statusText}`);
                return r.json();
              }),
              fetchWithRetry(`/api/topology?circuits=${encodeURIComponent(circuitParam)}`).then(async r => {
                if (!r.ok) throw new Error(`Topology HTTP ${r.status}: ${r.statusText}`);
                return r.json();
              })
            ]);
            
            // 🎯 FIX: Backend returns ALL assets for circuits - must filter by viewport on client
            // Calculate expanded viewport bounds (3x buffer for loading, tighter than 1.5x for culling)
            const lngSpan = (east - west) / 2;
            const latSpan = (north - south) / 2;
            const loadBuffer = 3.0; // 3x viewport for loading (covers panning), 1.5x for culling
            const minLng = viewState.longitude - (lngSpan * loadBuffer);
            const maxLng = viewState.longitude + (lngSpan * loadBuffer);
            const minLat = viewState.latitude - (latSpan * loadBuffer);
            const maxLat = viewState.latitude + (latSpan * loadBuffer);
            
            const beforeFilterCount = assetsData.length;
            const newAssets: Asset[] = assetsData
              .filter((row: any) => 
                row.LONGITUDE >= minLng && row.LONGITUDE <= maxLng &&
                row.LATITUDE >= minLat && row.LATITUDE <= maxLat
              )
              .map((row: any) => ({
                id: row.ASSET_ID, name: row.ASSET_NAME, type: row.ASSET_TYPE,
                latitude: row.LATITUDE, longitude: row.LONGITUDE,
                load_percent: row.LOAD_PERCENT, voltage: row.VOLTAGE, status: row.STATUS,
                commissioned_date: row.COMMISSIONED_DATE, health_score: row.HEALTH_SCORE,
                usage_kwh: row.USAGE_KWH, pole_height_ft: row.POLE_HEIGHT_FT,
                circuit_id: row.CIRCUIT_ID,
                loadedAt: Date.now()  // Timestamp for fade-in animation
              }));
            
            // Log filtering results to track viewport filtering effectiveness
            console.log(`   🎯 Batch ${idx + 1}: Backend returned ${beforeFilterCount.toLocaleString()} → filtered to ${newAssets.length.toLocaleString()} viewport assets (${((newAssets.length / beforeFilterCount) * 100).toFixed(1)}%)`);
            
            
            // Filter topology connections to only include links where BOTH endpoints are in viewport
            // This prevents topology lines from assets we filtered out
            // CRITICAL: Include substations in the asset ID set (they're loaded separately via metro topology)
            const assetIds = new Set(newAssets.map(a => a.id));
            substationAssets.forEach(s => assetIds.add(s.id)); // Add substation IDs
            
            const beforeTopologyCount = topologyData.length;
            const newTopology: TopologyLink[] = topologyData
              .filter((row: any) => assetIds.has(row.FROM_ASSET_ID) && assetIds.has(row.TO_ASSET_ID))
              .map((row: any) => ({
                from_asset_id: row.FROM_ASSET_ID,
                to_asset_id: row.TO_ASSET_ID,
                connection_type: 'Distribution',
                from_latitude: row.FROM_LAT,
                from_longitude: row.FROM_LON,
                to_latitude: row.TO_LAT,
                to_longitude: row.TO_LON
              }));
            
            console.log(`   🎯 Batch ${idx + 1}: Backend returned ${beforeTopologyCount.toLocaleString()} → filtered to ${newTopology.length.toLocaleString()} viewport connections (${((newTopology.length / beforeTopologyCount) * 100).toFixed(1)}%)`);
            
            
            return { batchIdx: idx, batch, assets: newAssets, topology: newTopology };
          });
          
          // Process batches as they complete (don't wait for all)
          batchPromises.forEach((promise, idx) => {
            promise.then(({ batchIdx, batch, assets: newAssets, topology: newTopology }) => {
              // Remove circuits from loading set AND mark as loaded (PERSISTENT)
              batch.forEach(cid => {
                loadingCircuitsRef.current.delete(cid);
                loadedCircuitsRef.current.add(cid); // Mark circuit as successfully loaded
              });
              
              // Append assets as NEW BATCH (not flattened) - prevents GPU buffer regeneration for existing batches
              setCircuitBatches(prev => {
                // CRITICAL FIX: Calculate current total from prev batches, not stale assets variable
                const currentTotal = prev.flatMap(b => b.assets).length;
                const existingIds = new Set(prev.flatMap(b => b.assets).map(a => a.id));
                const uniqueNew = newAssets.filter(a => !existingIds.has(a.id));
                
                // HARD CAP: Enforce max assets allowed (prevents overshoot from parallel loading)
                // CRITICAL: Use same limits as main loading path with high zoom restrictions
                // RACE CONDITION FIX: Account for pending additions from parallel batches
                const currentZoom = throttledZoom;
                let maxAssetsAllowed: number;
                if (currentZoom < 11) {
                  maxAssetsAllowed = 40000;
                } else if (currentZoom < 12) {
                  maxAssetsAllowed = 50000;
                } else if (currentZoom < 14) {
                  maxAssetsAllowed = 80000;
                } else if (currentZoom < 16) {
                  maxAssetsAllowed = 20000;
                } else {
                  maxAssetsAllowed = 10000;
                }
                
                const spaceAvailable = Math.max(0, maxAssetsAllowed - currentTotal - pendingAssetCountRef.current);
                
                if (spaceAvailable === 0) {
                  console.log(`   ⚠️ Batch ${batchIdx + 1}/${batches.length} REJECTED: Asset cap reached (${(currentTotal + pendingAssetCountRef.current).toLocaleString()}/${maxAssetsAllowed.toLocaleString()})`);
                  limitsReachedRef.current = true; // Set flag when cap hit during batch processing
                  return prev;
                }
                
                const assetsToAdd = uniqueNew.slice(0, spaceAvailable);
                
                if (assetsToAdd.length > 0) {
                  // Update pending counter IMMEDIATELY (prevents race condition overshoot)
                  pendingAssetCountRef.current += assetsToAdd.length;
                  console.log(`   ✅ Batch ${batchIdx + 1}/${batches.length} added ${assetsToAdd.length.toLocaleString()}/${uniqueNew.length.toLocaleString()} assets (pending: ${pendingAssetCountRef.current.toLocaleString()})`);
                  return [...prev, {
                    batchId: `batch-${batchIdx}-${Date.now()}`,
                    circuitIds: batch,
                    assets: assetsToAdd,
                    loadedAt: Date.now()
                  }];
                }
                
                return prev;
              });
              
              // Append topology connections as NEW BATCH (WITH HARD CAP + RACE CONDITION PROTECTION)
              setTopologyBatches(prev => {
                const existingIds = new Set<string>();
                prev.forEach(b => b.connections.forEach(t => existingIds.add(`${t.from_asset_id}-${t.to_asset_id}`)));
                const uniqueNew = newTopology.filter(t => !existingIds.has(`${t.from_asset_id}-${t.to_asset_id}`));
                
                // HARD CAP: Max 50K topology connections (prevents memory bloat)
                // RACE CONDITION FIX: Account for pending additions from parallel batches
                const maxTopologyAllowed = 50000;
                const currentTotal = prev.flatMap(b => b.connections).length;
                const spaceAvailable = Math.max(0, maxTopologyAllowed - currentTotal - pendingTopologyCountRef.current);
                
                if (spaceAvailable === 0) {
                  console.log(`   ⚠️ Batch ${batchIdx + 1}/${batches.length} topology REJECTED: Cap reached (${(currentTotal + pendingTopologyCountRef.current).toLocaleString()}/${maxTopologyAllowed.toLocaleString()})`);
                  limitsReachedRef.current = true; // Set flag when topology cap hit
                  return prev;
                }
                
                const topologyToAdd = uniqueNew.slice(0, spaceAvailable);
                
                if (topologyToAdd.length > 0) {
                  // Update pending counter (will be decremented when state update completes)
                  pendingTopologyCountRef.current += topologyToAdd.length;
                  
                  return [...prev, {
                    batchId: `topology-batch-${batchIdx}-${Date.now()}`,
                    circuitIds: batch,
                    connections: topologyToAdd,
                    loadedAt: Date.now(),
                    viewportCenter: { lng: viewState.longitude, lat: viewState.latitude, zoom: throttledZoom }
                  }];
                }
                
                return prev;
              });
            }).catch(err => {
              console.error(`❌ Batch ${idx + 1}/${batches.length} failed (${batches[idx]?.length} circuits):`, err.message || err);
              // Remove circuits from loading set on error (prevent permanent blocking)
              batches[idx]?.forEach(cid => {
                loadingCircuitsRef.current.delete(cid);
                console.log(`   🧹 Cleaned up failed circuit: ${cid}`);
              });
            });
          });
          
          // Reset pending counters after all batches settle (prevents drift)
          Promise.allSettled(batchPromises).then(() => {
            pendingTopologyCountRef.current = 0;
            pendingAssetCountRef.current = 0;
          });
        }
      } catch (error) {
        console.error('Progressive loading failed:', error);
      }
    };
    
    loadAssets();
  }, [throttledViewport.longitude, throttledViewport.latitude, currentZoom, serviceAreas.length, selectedAsset]);

  // CONNECTED ASSETS: Compute all assets directly connected to selected assets
  const connectedAssets = useMemo(() => {
    if (selectedAssets.size === 0) return new Set<string>();
    
    const connected = new Set<string>(selectedAssets);
    
    // Add all directly connected assets (1-hop neighbors)
    topology.forEach(link => {
      if (selectedAssets.has(link.from_asset_id)) {
        connected.add(link.to_asset_id);
      }
      if (selectedAssets.has(link.to_asset_id)) {
        connected.add(link.from_asset_id);
      }
    });
    
    return connected;
  }, [topology, selectedAssets]);

  // VIEWPORT-FILTERED TOPOLOGY: Smoothly tracks visible connections with fade transitions
  // Uses throttledZoom and throttledViewport to prevent recalculation on every tiny change
  const visibleTopology = useMemo(() => {
    if (throttledZoom < 10 || topology.length === 0) return [];
    
    // ACCURATE VIEWPORT: Use WebMercatorViewport for precise bounds
    const viewport = new WebMercatorViewport({
      width: typeof window !== 'undefined' ? window.innerWidth : 1920,
      height: typeof window !== 'undefined' ? window.innerHeight : 1080,
      longitude: throttledViewport.longitude,
      latitude: throttledViewport.latitude,
      zoom: throttledZoom,
      pitch: viewState.pitch || 0,
      bearing: viewState.bearing || 0
    });
    
    // Get accurate bounds with 1.2x buffer for visible topology
    // getBounds returns [minLng, minLat, maxLng, maxLat] as a flat array
    const bounds = viewport.getBounds();
    const west = bounds[0];
    const south = bounds[1];
    const east = bounds[2];
    const north = bounds[3];
    const bufferMultiplier = 1.2;
    const lngRange = (east - west) * (bufferMultiplier - 1) / 2;
    const latRange = (north - south) * (bufferMultiplier - 1) / 2;
    
    const minLng = west - lngRange;
    const maxLng = east + lngRange;
    const minLat = south - latRange;
    const maxLat = north + latRange;
    
    const viewportFiltered = topology.filter(link => 
      (link.from_longitude >= minLng && link.from_longitude <= maxLng &&
       link.from_latitude >= minLat && link.from_latitude <= maxLat) ||
      (link.to_longitude >= minLng && link.to_longitude <= maxLng &&
       link.to_latitude >= minLat && link.to_latitude <= maxLat)
    );
    
    console.log(`   🔗 Visible topology: ${viewportFiltered.length.toLocaleString()}/${topology.length.toLocaleString()} connections in viewport`);
    
    if (selectedAssets.size > 0) {
      const selectedConnections = topology.filter(link =>
        selectedAssets.has(link.from_asset_id) || selectedAssets.has(link.to_asset_id)
      );
      
      const viewportIds = new Set(viewportFiltered.map(l => `${l.from_asset_id}-${l.to_asset_id}`));
      const uniqueSelected = selectedConnections.filter(l => 
        !viewportIds.has(`${l.from_asset_id}-${l.to_asset_id}`)
      );
      
      return [...viewportFiltered, ...uniqueSelected].slice(0, 8000);
    }
    
    return viewportFiltered.slice(0, 8000);
  }, [throttledViewport.longitude, throttledViewport.latitude, throttledZoom, topology, selectedAssets]);

  // CONNECTED ASSET COUNTS: Compute meter/pole counts for transformers and substations
  // Used for count badges displayed above assets
  // OPTIMIZED: O(n) instead of O(n²) by using Map lookup
  const assetConnectionCounts = useMemo(() => {
    // INIT OPTIMIZATION: Only compute when topology is visible (zoom >= 10)
    // Connection counts are only used for visual sizing of topology arcs
    // Saves 50-80ms on asset load
    if (throttledZoom < 10 || topology.length === 0) {
      return new Map<string, { meters: number; poles: number; transformers: number; total: number }>();
    }
    
    const counts = new Map<string, { meters: number; poles: number; transformers: number; total: number }>();
    
    // Create fast lookup map: O(n)
    const assetMap = new Map<string, Asset>();
    assets.forEach(a => assetMap.set(a.id, a));
    
    // Count connections: O(topology.length)
    topology.forEach(link => {
      const fromAsset = assetMap.get(link.from_asset_id);
      const toAsset = assetMap.get(link.to_asset_id);
      
      if (!fromAsset || !toAsset) return;
      
      // Initialize counts if not exists
      if (!counts.has(link.from_asset_id)) {
        counts.set(link.from_asset_id, { meters: 0, poles: 0, transformers: 0, total: 0 });
      }
      if (!counts.has(link.to_asset_id)) {
        counts.set(link.to_asset_id, { meters: 0, poles: 0, transformers: 0, total: 0 });
      }
      
      // Count by type
      const fromCount = counts.get(link.from_asset_id)!;
      const toCount = counts.get(link.to_asset_id)!;
      
      const toType = toAsset.type?.toLowerCase();
      const fromType = fromAsset.type?.toLowerCase();
      
      if (toType === 'meter') {
        fromCount.meters++;
        fromCount.total++;
      } else if (toType === 'pole') {
        fromCount.poles++;
        fromCount.total++;
      } else if (toType === 'transformer') {
        fromCount.transformers++;
        fromCount.total++;
      }
      
      if (fromType === 'meter') {
        toCount.meters++;
        toCount.total++;
      } else if (fromType === 'pole') {
        toCount.poles++;
        toCount.total++;
      } else if (fromType === 'transformer') {
        toCount.transformers++;
        toCount.total++;
      }
    });
    
    return counts;
  }, [topology, assets, throttledZoom]);

  // Fly to asset location with buttery smooth animation
  const flyToAsset = (longitude: number, latitude: number, zoom?: number) => {
    isProgrammaticTransition.current = true;
    setViewState({
      longitude,
      latitude,
      zoom: zoom || 13.5,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
      transitionDuration: 2000, // Smooth, cinematic duration
      transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }) // Optimized speed for smoothness
    });
    // Reset flag after transition completes
    setTimeout(() => {
      isProgrammaticTransition.current = false;
    }, 2100);
  };

  // Smooth zoom on double-click
  const handleDoubleClick = (info: any) => {
    // Determine zoom direction based on modifier keys
    // Shift + double-click = zoom out, otherwise zoom in
    const zoomOut = info.srcEvent?.shiftKey;
    const zoomDelta = zoomOut ? -1.5 : 1.5;
    const newZoom = Math.max(5, Math.min(15, currentZoom + zoomDelta));
    
    isProgrammaticTransition.current = true;
    setViewState({
      ...viewState,
      zoom: newZoom,
      longitude: info.coordinate ? info.coordinate[0] : viewState.longitude,
      latitude: info.coordinate ? info.coordinate[1] : viewState.latitude,
      transitionDuration: 1000, // Smooth zoom duration
      transitionInterpolator: new FlyToInterpolator({ speed: 1.5 })
    });
    // Reset flag after transition completes
    setTimeout(() => {
      isProgrammaticTransition.current = false;
    }, 1100);
  };

  // ENGINEERING ENHANCEMENT: Priority-based glow system
  // Communicates operational urgency through color, intensity, pulse speed
  const getGlowProperties = useCallback((asset: any) => {
    const health = asset.health_score ?? asset.AVG_HEALTH_SCORE ?? asset.WORST_CIRCUIT_HEALTH ?? 75;
    
    // CRITICAL FIX: Use worst-case load from Postgres (shows RED if ANY circuit critical)
    // This fixes SUB-HOU-062 showing GREEN at 45.8% avg when one circuit is at 221%
    const load = asset.WORST_CIRCUIT_LOAD ?? asset.load_percent ?? asset.AVG_LOAD_PERCENT ?? 50;
    
    // Intelligence layer zoom adaptation
    const glowScale = currentZoom < 10.8 ? 1.5 :  // Executive view - large regional glow
                      currentZoom < 12.2 ? 1.2 :  // Incident view - medium glow
                      currentZoom < 13.5 ? 1.0 :  // Inspection view - normal glow
                      0.8;                         // Engineering view - tight glow
    
    // CRITICAL: Red glow - poor health or overloaded
    if (health < 50 || load > 85) {
      return {
        baseColor: [239, 68, 68],     // Red
        pulseSpeed: 0.15,              // Fast pulse (urgent)
        pulseAmplitude: 1.2,           // Stronger pulse
        glowScale: glowScale,
        label: 'CRITICAL',
        strokeIntensity: 1.0
      };
    }
    // WARNING: Amber glow - fair health or high load
    else if (health < 70 || load > 70) {
      return {
        baseColor: [251, 191, 36],    // Amber
        pulseSpeed: 0.11,              // Medium pulse
        pulseAmplitude: 1.0,
        glowScale: glowScale,
        label: 'WARNING',
        strokeIntensity: 0.8
      };
    }
    // HEALTHY: Green glow - good status
    else {
      return {
        baseColor: [34, 197, 94],     // Green - matches grid cell colors
        pulseSpeed: 0.08,              // Slow pulse (calm)
        pulseAmplitude: 0.8,
        glowScale: glowScale,
        label: 'HEALTHY',
        strokeIntensity: 0.6
      };
    }
  }, [currentZoom]);

  // REAL-TIME STREAMING: WebSocket with intelligent fallback to polling
  useEffect(() => {
    if (dataFetchedRef.current) return;
    dataFetchedRef.current = true;
    
    const processData = (data: any) => {
      // LOD OPTIMIZATION: Assets may not be loaded initially (lazy loaded by zoom)
      if (data.assets) {
        const mappedAssets: Asset[] = data.assets.map((row: any) => ({
          id: row.ASSET_ID, name: row.ASSET_NAME, type: row.ASSET_TYPE,
          latitude: row.LATITUDE, longitude: row.LONGITUDE,
          load_percent: row.LOAD_PERCENT, voltage: row.VOLTAGE, status: row.STATUS,
          commissioned_date: row.COMMISSIONED_DATE, health_score: row.HEALTH_SCORE,
          usage_kwh: row.USAGE_KWH, pole_height_ft: row.POLE_HEIGHT_FT,
          circuit_id: row.CIRCUIT_ID
        }));
        
        // Add substations from metro topology data if available (deduplicate)
        // Enrich with real-time status data
        const substations: Asset[] = data.metro ? data.metro
          .map((row: any) => {
            const status = substationStatusMap.get(row.SUBSTATION_ID);
            return {
              id: row.SUBSTATION_ID,
              name: row.SUBSTATION_NAME || row.SUBSTATION_ID,
              type: 'substation',
              latitude: row.LATITUDE,
              longitude: row.LONGITUDE,
              load_percent: status?.load_percent ?? null,
              voltage: row.VOLTAGE_KV ? `${row.VOLTAGE_KV} kV` : null,
              status: status?.status ?? null,
              commissioned_date: null,
              health_score: status?.health_score ?? null,
              usage_kwh: null,
              pole_height_ft: null,
              circuit_id: null
            };
          }) : [];
        
        // Deduplicate all assets by ID
        const allAssets = [...mappedAssets, ...substations];
        const deduped = Array.from(new Map(allAssets.map(a => [a.id, a])).values());
        setAssets(deduped);
      }
      
      if (data.weather) setWeather(data.weather);
      if (data.metro) setMetroTopologyData(data.metro);
      if (data.feeders) setFeederTopologyData(data.feeders);
      if (data.serviceAreas) setServiceAreas(data.serviceAreas);
      if (data.topology) {
        setTopology(data.topology.map((row: any) => ({
          from_asset_id: row.FROM_ASSET_ID, to_asset_id: row.TO_ASSET_ID,
          connection_type: 'Distribution',
          from_latitude: row.FROM_LAT, from_longitude: row.FROM_LON,
          to_latitude: row.TO_LAT, to_longitude: row.TO_LON
        })));
      }
    };
    
    const loadInitial = async () => {
      setIsLoadingData(true);
      try {
        console.log('🔄 Loading initial data via batch endpoint...');
        const startTime = performance.now();
        
        // FASTAPI OPTIMIZATION: Use batch endpoint for parallel fetching
        // Reduces 3+ minute load to <10 seconds with cache warming
        const [initialData, weather] = await Promise.all([
          fetch('/api/initial-load').then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
          }),
          fetch('/api/weather').then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
          })
        ]);
        
        const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
        const cacheHits = Object.entries(initialData.cache_hits || {}).filter(([_, hit]) => hit).length;
        
        console.log(`✅ Initial load complete in ${loadTime}s (${cacheHits}/4 cache hits)`);
        console.log(`   📊 Metro: ${initialData.metro?.length || 0} substations (${initialData.timing?.metro?.toFixed(2) || '?'}s)`);
        console.log(`   📊 Feeders: ${initialData.feeders?.length || 0} connections (${initialData.timing?.feeders?.toFixed(2) || '?'}s)`);
        console.log(`   📊 Service Areas: ${initialData.service_areas?.length || 0} circuits (${initialData.timing?.service_areas?.toFixed(2) || '?'}s)`);
        console.log(`   📊 KPIs: ${Object.keys(initialData.kpis || {}).length} metrics (${initialData.timing?.kpis?.toFixed(2) || '?'}s)`);
        
        // Set all data from batch response
        if (initialData.service_areas) setServiceAreas(initialData.service_areas);
        if (initialData.metro) {
          setMetroTopologyData(initialData.metro);
          metroFeedersLoadingRef.current = true; // Mark as loaded
          
          // Load substations from metro data immediately
          if (!substationsLoadedRef.current && initialData.metro.length > 0) {
            substationsLoadedRef.current = true;
            const substations: Asset[] = initialData.metro.map((row: any) => ({
              id: row.SUBSTATION_ID,
              name: row.SUBSTATION_NAME || row.SUBSTATION_ID,
              type: 'substation' as const,
              latitude: row.LATITUDE,
              longitude: row.LONGITUDE,
              load_percent: row.AVG_LOAD_PCT ?? null,
              voltage: null,
              status: null,
              commissioned_date: null,
              health_score: null,
              usage_kwh: null,
              pole_height_ft: null,
              circuit_id: null,
              loadedAt: Date.now()
            }));
            
            setCircuitBatches(prev => [...prev, {
              batchId: 'batch-substations',
              circuitIds: [],
              assets: substations,
              loadedAt: Date.now()
            }]);
            console.log(`   ✅ Added ${substations.length} substations from batch response`);
          }
        }
        if (initialData.feeders) setFeederTopologyData(initialData.feeders);
        setWeather(weather);
        setIsLoadingData(false);
        setLastUpdateTime(new Date());
        
        // Start lightweight service area polling (5 min refresh for aggregate stats)
        startServiceAreaPolling();
      } catch (error) {
        console.error('❌ Initial load failed:', error);
        // Fallback to legacy loading if batch endpoint fails
        console.log('⚠️ Falling back to legacy separate API calls...');
        try {
          const [serviceAreas, weatherData] = await Promise.all([
            fetch('/api/service-areas').then(r => r.json()),
            fetch('/api/weather').then(r => r.json())
          ]);
          setServiceAreas(serviceAreas);
          setWeather(weatherData);
          console.log(`✅ Fallback load: ${serviceAreas.length} service areas`);
        } catch (fallbackError) {
          console.error('❌ Fallback also failed:', fallbackError);
        }
        setIsLoadingData(false);
      }
    };
    
    // OPTIMIZED: Lightweight polling for service areas only (9k circuits vs 500k assets)
    // Postgres handles real-time status updates every 10s (in fetchSubstationStatus)
    const startServiceAreaPolling = () => {
      if (pollingIntervalRef.current) return;
      
      pollingIntervalRef.current = setInterval(async () => {
        try {
          // Only refresh service areas - 9k circuits (NOT 500k assets)
          const serviceAreas = await fetch('/api/service-areas').then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
          });
          setServiceAreas(serviceAreas);
          setLastUpdateTime(new Date());
        } catch (error) {
          console.error('❌ Service area poll failed:', error);
        }
      }, 300000); // 5 minutes (Postgres handles real-time every 10s)
    };
    
    loadInitial();
    
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  // INFORMATION LAYER ARCHITECTURE - Premium snap-to-intelligence
  // Each layer reveals distinct operational intelligence, not arbitrary zoom levels
  const INTELLIGENCE_LAYERS = {
    EXECUTIVE_DASHBOARD: { 
      zoom: 9.5, 
      name: "Executive Dashboard",
      description: "Regional health & aggregate KPIs"
    },
    CRITICAL_INCIDENT_MAP: { 
      zoom: 10.8, 
      name: "Critical Incident Map",
      description: "Priority assets requiring attention"
    },
    ASSET_INSPECTION: { 
      zoom: 12.2, 
      name: "Asset Inspection View",
      description: "Individual asset details"
    },
    ENGINEERING_DETAIL: { 
      zoom: 13.5, 
      name: "Engineering Detail",
      description: "Full topology & connections"
    }
  };
  
  // Apple trackpad velocity tracking with momentum detection
  useEffect(() => {
    const now = Date.now();
    const timeDelta = now - lastZoomTimeRef.current;
    const zoomDelta = currentZoom - lastZoomRef.current;
    
    if (timeDelta > 0 && timeDelta < 100) {
      const velocity = Math.abs(zoomDelta) / timeDelta * 1000;
      setLastZoomVelocity(velocity);
      
      // Track velocity history for momentum detection (trackpad gestures)
      velocityHistoryRef.current.push({ velocity, time: now });
      
      // Keep only last 150ms of history
      velocityHistoryRef.current = velocityHistoryRef.current.filter(
        v => now - v.time < 150
      );
      
      // Detect active scrolling (trackpad gesture in progress)
      if (velocity > 0.5) {
        isUserScrollingRef.current = true;
        
        // Clear existing scroll end timeout
        if (scrollEndTimeoutRef.current) {
          clearTimeout(scrollEndTimeoutRef.current);
        }
        
        // Wait for scrolling to fully stop (trackpad momentum complete)
        scrollEndTimeoutRef.current = setTimeout(() => {
          isUserScrollingRef.current = false;
        }, 80); // Short window for trackpad momentum
      }
    }
    
    lastZoomTimeRef.current = now;
    lastZoomRef.current = currentZoom;
  }, [currentZoom]);
  
  // Animation loop for selection glow effect
  // Reset expanded asset categories when selection changes
  const prevSelectedAssetId = useRef<string | null>(null);
  useEffect(() => {
    const currentId = selectedAsset?.id || null;
    if (currentId !== prevSelectedAssetId.current) {
      prevSelectedAssetId.current = currentId;
      setExpandedAssetCategories({
        substations: false,
        transformers: false,
        poles: false
      });
    }
  }, [selectedAsset]);
  
  // PRODUCTION: Intelligence layer transition detection with loading animation
  // Triggers spinner when crossing between operational views (grid cells -> substations -> transformers -> topology)
  useEffect(() => {
    const LAYER_THRESHOLDS = {
      GRID_CELLS: 9.5,        // Executive Dashboard - Regional clusters
      SUBSTATIONS: 10.8,      // Critical Incident Map - Substation-level
      TRANSFORMERS: 12.2,     // Asset Inspection - Individual assets
      TOPOLOGY: 13.5          // Engineering Detail - Full network connections
    };
    
    // Determine current intelligence layer
    let currentLayer = 'GRID_CELLS';
    if (currentZoom >= LAYER_THRESHOLDS.TOPOLOGY) {
      currentLayer = 'TOPOLOGY';
    } else if (currentZoom >= LAYER_THRESHOLDS.TRANSFORMERS) {
      currentLayer = 'TRANSFORMERS';
    } else if (currentZoom >= LAYER_THRESHOLDS.SUBSTATIONS) {
      currentLayer = 'SUBSTATIONS';
    }
    
    // Trigger loading animation on layer transition
    if (lastIntelligenceLayerRef.current !== null && 
        lastIntelligenceLayerRef.current !== currentLayer) {
      // console.log(`🔄 Intelligence layer transition: ${lastIntelligenceLayerRef.current} → ${currentLayer}`);
      setIsLoadingData(true);
      setTimeout(() => {
        setIsLoadingData(false);
        setLastUpdateTime(new Date());
      }, 2900);
    }
    
    lastIntelligenceLayerRef.current = currentLayer;
  }, [currentZoom]);
  
  // Apple trackpad-optimized magnetic snap system - DISABLED
  useEffect(() => {
    // DISABLED: Snap system was fighting user zoom input
    // Clear any existing timeouts to prevent fighting
    if (zoomTimeout) clearTimeout(zoomTimeout);
    return () => {
      if (zoomTimeout) clearTimeout(zoomTimeout);
    };
  }, []);
  
  // Tower scale animation: grows progressively from 0 to 1 as you zoom out past threshold
  // Creates smooth emergence effect when switching from individual to aggregate view
  // PERFORMANCE: Use throttledZoom to prevent recalculation on every pixel
  const towerScaleAnimation = useMemo(() => {
    if (throttledZoom >= ZOOM_THRESHOLD) return 0;
    
    const transitionRange = 1.5;
    const zoomDelta = ZOOM_THRESHOLD - throttledZoom;
    
    const linearScale = Math.min(1, zoomDelta / transitionRange);
    return linearScale * linearScale * (3 - 2 * linearScale);
  }, [throttledZoom]);

  // Individual asset scale animation: inverse of tower scale
  // Grows from 0 to 1 as you zoom in past threshold
  // PERFORMANCE: Use throttledZoom to prevent recalculation on every pixel
  const assetScaleAnimation = useMemo(() => {
    if (throttledZoom <= ZOOM_THRESHOLD - 1.5) return 0;
    
    const transitionRange = 3.5;
    const zoomDelta = throttledZoom - (ZOOM_THRESHOLD - 1.5);
    
    const linearScale = Math.min(1, zoomDelta / transitionRange);
    return linearScale * linearScale * (3 - 2 * linearScale);
  }, [throttledZoom]);

  // OPERATIONAL TRIAGE PATTERN: Priority-based emergence for operational intelligence
  // Critical assets appear first (0-30%), warnings next (30-70%), healthy last (70-100%)
  // This guides #attention to problems, not just pretty animation
  // Simplified stagger calculation - removed expensive trig ops for performance
  const getStaggerDelay = useCallback((
    longitude: number, 
    latitude: number, 
    baseAnimation: number,
    healthScore?: number,
    loadPercent?: number,
    assetType?: string
  ) => {
    // PERFORMANCE: Return base animation directly - stagger disabled for smooth 60 FPS
    // Previously: 80k assets × complex hash calculations × 60 FPS = stuttering
    return baseAnimation;
    
    /* ARCHIVED STAGGER ANIMATION CODE - Reintroduce after other performance bottlenecks resolved
    // VISUAL ENHANCEMENT: Priority-based staggered emergence with position-based variance
    // Creates wave effect where critical assets appear first, then warnings, then healthy
    if (baseAnimation === 0) return 0;
    if (baseAnimation === 1) return 1;
    
    // TYPE-SPECIFIC SLOWDOWN: Dramatic emergence for key infrastructure
    // Substations, transformers, poles emerge close together (core infrastructure)
    let typeSlowdown = 1.0;
    let animationOffset = 0.0; // Head start for certain asset types
    
    if (assetType === 'substation') typeSlowdown = 0.5; // 2x slower
    if (assetType === 'transformer') typeSlowdown = 0.6; // 1.67x slower
    if (assetType === 'pole') {
      typeSlowdown = 0.80; // Balanced slowdown
      animationOffset = 0.20; // Moderate head start
    }
    
    // Apply offset and type slowdown to base animation
    const adjustedBaseAnimation = Math.min(1, (baseAnimation + animationOffset) * typeSlowdown);
    
    // Determine priority tier based on health and load
    // EXCEPTION: Poles always appear shortly after subs/xfmrs (tier 2)
    let priorityTier = 3; // Default: healthy (70-100% of animation)
    
    if (assetType === 'pole') {
      priorityTier = 2; // Poles always appear in 30-70% window (after tier 1 subs/xfmrs)
    } else if (healthScore !== undefined && loadPercent !== undefined) {
      if (healthScore < 50 || loadPercent > 85) priorityTier = 1; // Critical: 0-30%
      else if (healthScore < 70 || loadPercent > 70) priorityTier = 2; // Warning: 30-70%
    } else if (healthScore !== undefined) {
      if (healthScore < 50) priorityTier = 1;
      else if (healthScore < 70) priorityTier = 2;
    }
    
    // Define tier time windows
    const tierStart = priorityTier === 1 ? 0.0 : priorityTier === 2 ? 0.3 : 0.7;
    const tierEnd = priorityTier === 1 ? 0.3 : priorityTier === 2 ? 0.7 : 1.0;
    
    // Simplified positional hash (no sin/cos for performance)
    const hash = ((longitude * 73856093) ^ (latitude * 19349663)) & 0xFFFF;
    const normalized = (hash / 0xFFFF);
    const tierDuration = tierEnd - tierStart;
    const variance = (normalized - 0.5) * 0.1 * tierDuration;
    
    // Map adjusted animation to this tier's window
    if (adjustedBaseAnimation < tierStart) return 0;
    if (adjustedBaseAnimation > tierEnd) return 1;
    
    const tierProgress = (adjustedBaseAnimation - tierStart) / tierDuration;
    const adjustedProgress = Math.max(0, Math.min(1, tierProgress + variance));
    
    // Smoothstep easing
    return adjustedProgress * adjustedProgress * (3 - 2 * adjustedProgress);
    END ARCHIVED CODE */
  }, []); // No dependencies - pure function based on args
  
  // Dynamic height scaling: taller at low zoom (zoomed out), shorter at high zoom (zoomed in)
  // Use linear scaling to avoid drastic jumps
  // REDUCED: 0.2 → 0.05 to scale down max column heights (user request: Dec 30, 2025)
  // PERFORMANCE: Use throttledZoom to prevent recalculation on every pixel
  const heightScale = 1 + Math.max(0, (12 - throttledZoom)) * 0.05;

  // REMOVED: Duplicate type filtering - now done directly from circuitBatches at line ~517
  // Asset type arrays (substationAssets, transformerAssets, poleAssets, meterAssets) 
  // are now derived from circuitBatches in a single pass, avoiding this redundant filtering

  // PERFORMANCE OPTIMIZATION: Viewport culling for individual assets
  // ACCURATE VIEWPORT BOUNDS: Use deck.gl's WebMercatorViewport for precise bounds
  // This accounts for pitch, bearing, and latitude distortion in Web Mercator projection
  const viewportBounds = useMemo(() => {
    // Create accurate viewport using deck.gl's native WebMercatorViewport
    const viewport = new WebMercatorViewport({
      width: typeof window !== 'undefined' ? window.innerWidth : 1920,
      height: typeof window !== 'undefined' ? window.innerHeight : 1080,
      longitude: throttledViewport.longitude,
      latitude: throttledViewport.latitude,
      zoom: throttledZoom,
      pitch: viewState.pitch || 0,
      bearing: viewState.bearing || 0
    });
    
    // Get accurate bounds from viewport's getBounds() method
    // Returns [minLng, minLat, maxLng, maxLat] as a flat array
    const bounds = viewport.getBounds();
    const west = bounds[0];
    const south = bounds[1];
    const east = bounds[2];
    const north = bounds[3];
    
    // Apply buffer to bounds (2.0x for viewport filtering)
    const bufferMultiplier = 2.0;
    const lngRange = (east - west) * (bufferMultiplier - 1) / 2;
    const latRange = (north - south) * (bufferMultiplier - 1) / 2;
    
    const minLng = west - lngRange;
    const maxLng = east + lngRange;
    const minLat = south - latRange;
    const maxLat = north + latRange;
    
    return {
      minLng,
      maxLng,
      minLat,
      maxLat
    };
  }, [throttledViewport.longitude, throttledViewport.latitude, throttledZoom]);

  // GPU filter range for DataFilterExtension (avoids CPU filtering)
  const gpuFilterRange = useMemo(() => [
    [viewportBounds.minLng, viewportBounds.maxLng],
    [viewportBounds.minLat, viewportBounds.maxLat]
  ], [viewportBounds]);

  // Viewport-filtered assets - PERFORMANCE OPTIMIZED with AGGRESSIVE LIMITS
  // Apply viewport culling + smart limits to prevent GPU overload
  const viewportFilteredAssets = useMemo(() => {
    const { minLng, maxLng, minLat, maxLat } = viewportBounds;
    
    // Filter to viewport with buffer (GPU will do final culling)
    const viewportSubstations = substationAssets.filter(a => 
      a.longitude >= minLng && a.longitude <= maxLng &&
      a.latitude >= minLat && a.latitude <= maxLat
    );
    
    // AGGRESSIVE limits based on zoom to prevent GPU overload
    let maxTransformers = 5000;   // Was 50000 - way too high!
    let maxPoles = 10000;          // Was 100000
    let maxMeters = 15000;         // Was 150000
    
    if (throttledZoom < 11) {
      maxTransformers = 2000;
      maxPoles = 4000;
      maxMeters = 6000;
    } else if (throttledZoom < 12) {
      maxTransformers = 3000;
      maxPoles = 6000;
      maxMeters = 10000;
    } else if (throttledZoom < 13) {
      maxTransformers = 5000;
      maxPoles = 10000;
      maxMeters = 15000;
    } else {
      // Zoom 13+: Allow more detail
      maxTransformers = 10000;
      maxPoles = 20000;
      maxMeters = 30000;
    }
    
    const viewportTransformers = transformerAssets
      .filter(a => 
        a.longitude >= minLng && a.longitude <= maxLng &&
        a.latitude >= minLat && a.latitude <= maxLat
      )
      .slice(0, maxTransformers);
    
    const viewportPoles = poleAssets
      .filter(a => 
        a.longitude >= minLng && a.longitude <= maxLng &&
        a.latitude >= minLat && a.latitude <= maxLat
      )
      .slice(0, maxPoles);
    
    const viewportMeters = meterAssets
      .filter(a => 
        a.longitude >= minLng && a.longitude <= maxLng &&
        a.latitude >= minLat && a.latitude <= maxLat
      )
      .slice(0, maxMeters);
    
    const totalAssets = viewportSubstations.length + viewportTransformers.length + 
                       viewportPoles.length + viewportMeters.length;
    
    if (totalAssets > 50000) {
      console.log(`⚠️ Viewport assets capped: ${totalAssets.toLocaleString()} (S:${viewportSubstations.length} T:${viewportTransformers.length} P:${viewportPoles.length} M:${viewportMeters.length})`);
    }
    
    return { 
      substationAssets: viewportSubstations, 
      transformerAssets: viewportTransformers, 
      poleAssets: viewportPoles, 
      meterAssets: viewportMeters 
    };
  }, [substationAssets, transformerAssets, poleAssets, meterAssets, viewportBounds, throttledZoom]);

  // CRITICAL PERFORMANCE: Memoized viewport-filtered feeders with aggressive LOD
  const viewportFilteredFeeders = useMemo(() => {
    // INIT OPTIMIZATION: Only compute when feeders are actually visible (zoom 9-11.5)
    // Saves 30-50ms on initialization (zoom 9.5 doesn't need this)
    if (throttledZoom < 9 || throttledZoom >= 11.5 || feederTopologyData.length === 0) {
      console.log(`🔌 Feeders skipped: zoom=${throttledZoom.toFixed(1)}, feederData=${feederTopologyData.length}`);
      return [];
    }
    
    console.log(`🔌 Computing feeders: zoom=${throttledZoom.toFixed(1)}, feederData=${feederTopologyData.length}`);
    const { minLng, maxLng, minLat, maxLat } = viewportBounds;
    
    // Zoom-based LOD: limit connections at lower zoom for performance
    let maxConnections: number;
    let maxDistanceKm: number;
    
    if (throttledZoom < 8) {
      maxConnections = 200;
      maxDistanceKm = 15;
    } else if (throttledZoom < 10) {
      maxConnections = 1500;  // Increased from 300 for better coverage at zoom 9-10
      maxDistanceKm = 30;
    } else if (throttledZoom < 12) {
      maxConnections = 3000;  // Increased from 600
      maxDistanceKm = 40;
    } else {
      maxConnections = 5000;  // Increased from 1000
      maxDistanceKm = 50;
    }
    
    const filtered = feederTopologyData.filter((d: any) => {
      const distance = d.DISTANCE_KM || 0;
      const voltage = d.VOLTAGE_LEVEL || '';
      
      // Viewport check with both endpoints
      const inViewport = (
        (d.FROM_LON >= minLng && d.FROM_LON <= maxLng &&
         d.FROM_LAT >= minLat && d.FROM_LAT <= maxLat) ||
        (d.TO_LON >= minLng && d.TO_LON <= maxLng &&
         d.TO_LAT >= minLat && d.TO_LAT <= maxLat)
      );
      
      // Filter out transmission lines (>69kV) and very long connections
      // Distribution feeders are typically 12-34kV and < 50km
      const isDistribution = !voltage.includes('138') && !voltage.includes('230') && !voltage.includes('345');
      const isReasonableDistance = distance <= maxDistanceKm;
      
      // Progressive LOD: show all feeders in viewport (load data often unavailable)
      // Prioritize high-load feeders when sorting, but don't filter them out
      return inViewport && isDistribution && isReasonableDistance;
    });
    
    // Geographic diversity: sample from grid regions instead of pure priority sort
    const regionBuckets = new Map<string, any[]>();
    filtered.forEach(d => {
      const regionKey = `${Math.floor(d.FROM_LON * 20)}_${Math.floor(d.FROM_LAT * 20)}`;
      if (!regionBuckets.has(regionKey)) regionBuckets.set(regionKey, []);
      regionBuckets.get(regionKey)!.push(d);
    });
    
    // Sample proportionally from each region
    const result: any[] = [];
    const regionsArray = Array.from(regionBuckets.values());
    const perRegionLimit = Math.ceil(maxConnections / Math.max(1, regionsArray.length));
    
    regionsArray.forEach(regionData => {
      // Sort by load within region
      const sorted = regionData.sort((a, b) => 
        (b.LOAD_UTILIZATION_PCT || 0) - (a.LOAD_UTILIZATION_PCT || 0)
      );
      result.push(...sorted.slice(0, perRegionLimit));
    });
    
    const finalResult = result.slice(0, maxConnections);
    console.log(`🔌 Feeders result: ${filtered.length} filtered → ${finalResult.length} final (max ${maxConnections})`);
    return finalResult;
  }, [feederTopologyData, viewportBounds, throttledZoom]);

  const unifiedClusters = useMemo(() => {
    // INIT OPTIMIZATION: Skip clustering if NO DATA loaded yet
    // Service areas are sufficient to create towers (assets load later at zoom 10+)
    if (serviceAreas.length === 0) {
      return [];
    }
    
    console.time('⚡ unifiedClusters calculation');
    // CIRCUIT-BASED SERVICE AREAS (Utility-Grade Clustering)
    // Uses pre-computed FLUX_OPS_CENTER_SERVICE_AREAS_CIRCUIT_BASED table
    // Benefits:
    // - Eliminates 1-2s client-side clustering overhead (no distance calculations)
    // - Uses real circuit topology (CIRCUIT_ID) from utility operations
    // - Each circuit originates from ONE substation (97% data integrity after Jan 1, 2026 fix)
    // - O(1) lookup using CIRCUIT_ID instead of O(N²) distance calculations
    // - Cached circuit map for near-instant reassignment on asset updates
    
    if (serviceAreas.length === 0) {
      // Fallback to client-side clustering if service areas not loaded
      const substationHash = substationAssets
        .map(s => `${s.id}:${s.latitude.toFixed(4)}:${s.longitude.toFixed(4)}`)
        .sort()
        .join('|');
      
      if (cachedSubstationHashRef.current === substationHash && 
          clusterCacheRef.current.length > 0 &&
          assetToClusterMapRef.current.size > 0) {
        const updatedClusters: AssetCluster[] = clusterCacheRef.current.map(cluster => ({
          ...cluster,
          assets: [],
          transformers: [],
          poles: [],
          meters: []
        }));
        
        transformerAssets.forEach(asset => {
          const clusterIdx = assetToClusterMapRef.current.get(asset.id);
          if (clusterIdx !== undefined && clusterIdx < updatedClusters.length) {
            updatedClusters[clusterIdx].transformers.push(asset);
            updatedClusters[clusterIdx].assets.push(asset);
          }
        });
        
        poleAssets.forEach(asset => {
          const clusterIdx = assetToClusterMapRef.current.get(asset.id);
          if (clusterIdx !== undefined && clusterIdx < updatedClusters.length) {
            updatedClusters[clusterIdx].poles.push(asset);
            updatedClusters[clusterIdx].assets.push(asset);
          }
        });
        
        meterAssets.forEach(asset => {
          const clusterIdx = assetToClusterMapRef.current.get(asset.id);
          if (clusterIdx !== undefined && clusterIdx < updatedClusters.length) {
            updatedClusters[clusterIdx].meters.push(asset);
            updatedClusters[clusterIdx].assets.push(asset);
          }
        });
        
        updatedClusters.forEach(cluster => {
          cluster.substations.forEach(s => {
            cluster.assets.push(s);
          });
        });
        
        console.timeEnd('⚡ unifiedClusters calculation');
        return updatedClusters;
      }
      
      const result = substationBasedClustering(substationAssets, transformerAssets, poleAssets, meterAssets);
      
      assetToClusterMapRef.current.clear();
      result.forEach((cluster, clusterIdx) => {
        cluster.assets.forEach(asset => {
          assetToClusterMapRef.current.set(asset.id, clusterIdx);
        });
      });
      
      cachedSubstationHashRef.current = substationHash;
      clusterCacheRef.current = result;
      
      console.timeEnd('⚡ unifiedClusters calculation');
      return result;
    }
    
    // CIRCUIT-BASED CLUSTERING WITH CACHING
    // Cache the circuit map and cluster structure - only rebuild when serviceAreas changes
    
    // Create hash of service areas to detect changes
    const serviceAreasHash = serviceAreas
      .map(sa => `${sa.CIRCUIT_ID}:${sa.SUBSTATION_ID}`)
      .sort()
      .join('|');
    
    // Check if service areas structure changed
    const serviceAreasChanged = cachedServiceAreasHashRef.current !== serviceAreasHash;
    
    if (serviceAreasChanged || clusterCacheRef.current.length === 0 || circuitMapRef.current.size === 0) {
      // Service areas changed - rebuild cluster structure and circuit map
      console.log('🔄 Rebuilding circuit-based cluster structure');
      
      const clusters: AssetCluster[] = serviceAreas.map(area => {
        // Find real substation asset from loaded metro topology
        let substation = substationAssets.find(s => s.id === area.SUBSTATION_ID);
        
        // If substation not loaded yet (low zoom), create synthetic from service area
        if (!substation && area.SUBSTATION_ID) {
          substation = {
            id: area.SUBSTATION_ID,
            name: area.SUBSTATION_NAME || area.SUBSTATION_ID,
            type: 'substation',
            latitude: area.CENTROID_LAT,
            longitude: area.CENTROID_LON,
            voltage: null,
            status: null,
            load_percent: null,
            health_score: null,
            commissioned_date: null,
            usage_kwh: null,
            pole_height_ft: null,
            circuit_id: null
          };
        }
        
        const centroid: [number, number] = [
          area.CENTROID_LON || (substation?.longitude ?? 0),
          area.CENTROID_LAT || (substation?.latitude ?? 0)
        ];
        
        const districtId = area.CIRCUIT_ID || `CIRCUIT-${area.SUBSTATION_ID}`;
        
        return {
          centroid,
          districtId,
          assets: substation ? [substation] : [],
          substations: substation ? [substation] : [],
          transformers: [],
          poles: [],
          meters: [],
          avgHealth: area.AVG_HEALTH_SCORE,
          avgLoad: area.AVG_LOAD_PERCENT
        };
      });
      
      // Build O(1) lookup map: CIRCUIT_ID → cluster index
      circuitMapRef.current.clear();
      serviceAreas.forEach((area, idx) => {
        if (area.CIRCUIT_ID) {
          circuitMapRef.current.set(area.CIRCUIT_ID, idx);
        }
      });
      
      // Cache cluster structure
      clusterCacheRef.current = clusters;
      cachedServiceAreasHashRef.current = serviceAreasHash;
      
      // Assign assets using cached circuit map
      const assignAsset = (asset: Asset, targetArray: 'transformers' | 'poles' | 'meters') => {
        if (!asset.circuit_id) return;
        
        const clusterIdx = circuitMapRef.current.get(asset.circuit_id);
        if (clusterIdx !== undefined && clusterIdx < clusters.length) {
          clusters[clusterIdx][targetArray].push(asset);
          clusters[clusterIdx].assets.push(asset);
        }
      };
      
      transformerAssets.forEach(a => assignAsset(a, 'transformers'));
      poleAssets.forEach(a => assignAsset(a, 'poles'));
      meterAssets.forEach(a => assignAsset(a, 'meters'));
      
      console.log(`✅ Circuit-based clustering: ${clusters.length} circuits, ${clusters.reduce((sum, c) => sum + c.assets.length, 0)} assets assigned`);
      
      console.timeEnd('⚡ unifiedClusters calculation');
      return clusters;
    }
    
    // FAST PATH: Service areas unchanged - reuse cached structure and circuit map
    // This makes asset updates nearly instant (just O(N) reassignment with cached lookups)
    console.log('⚡ Fast path: Reusing cached circuit map');
    
    const updatedClusters: AssetCluster[] = clusterCacheRef.current.map(cluster => ({
      ...cluster,
      assets: [...cluster.substations],  // Keep substations
      transformers: [],
      poles: [],
      meters: []
    }));
    
    // O(N) reassignment using cached circuit map
    const assignAsset = (asset: Asset, targetArray: 'transformers' | 'poles' | 'meters') => {
      if (!asset.circuit_id) return;
      
      const clusterIdx = circuitMapRef.current.get(asset.circuit_id);
      if (clusterIdx !== undefined && clusterIdx < updatedClusters.length) {
        updatedClusters[clusterIdx][targetArray].push(asset);
        updatedClusters[clusterIdx].assets.push(asset);
      }
    };
    
    transformerAssets.forEach(a => assignAsset(a, 'transformers'));
    poleAssets.forEach(a => assignAsset(a, 'poles'));
    meterAssets.forEach(a => assignAsset(a, 'meters'));
    
    console.timeEnd('⚡ unifiedClusters calculation');
    return updatedClusters;
  }, [serviceAreas, substationAssets, transformerAssets, poleAssets, meterAssets]);

  const flattenedClusterData = useMemo(() => {
    console.time('🔍 flattenedClusterData calculation');
    const aggregateTowers: any[] = [];
    
    // ALWAYS aggregate circuits by substation - circuits are for O(1) assignment, not visual display
    // Each tower represents ONE substation with all its circuits aggregated
    console.log(`🔍 Creating towers: ${unifiedClusters.length} circuits → aggregating by substation`);
    
    if (serviceAreas.length > 0) {
      // Aggregate circuits by substation
      const substationAggregates = new Map<string, any>();
      
      unifiedClusters.forEach(cell => {
        // Get substation ID from circuit's district ID or first substation
        const substationId = cell.substations[0]?.id;
        if (!substationId) return; // Skip circuits without substation mapping
        
        if (!substationAggregates.has(substationId)) {
          substationAggregates.set(substationId, {
            substation: cell.substations[0],
            circuits: [],
            allAssets: [],
            transformers: [],
            poles: [],
            meters: []
          });
        }
        
        const aggregate = substationAggregates.get(substationId)!;
        aggregate.circuits.push(cell);
        aggregate.allAssets.push(...cell.assets);
        aggregate.transformers.push(...cell.transformers);
        aggregate.poles.push(...cell.poles);
        aggregate.meters.push(...cell.meters);
      });
      
      // Create towers from substation aggregates
      console.log(`✅ AGGREGATING ${substationAggregates.size} substations from ${unifiedClusters.length} circuits`);
      substationAggregates.forEach((aggregate, substationId) => {
        const sub = aggregate.substation;
        const totalAssets = aggregate.allAssets.length;
        const substationCount = 1;
        const transformerCount = aggregate.transformers.length;
        const poleCount = aggregate.poles.length;
        const meterCount = aggregate.meters.length;
        
        // Get worst-case values from Postgres (fixes averaging problem that masked critical circuits)
        const substationStatus = substationStatusMap.get(substationId);
        const avgHealth = substationStatus?.avg_health ?? null;
        const avgLoad = substationStatus?.avg_load ?? 0;
        const worstLoad = substationStatus?.worst_circuit_load ?? avgLoad;
        const worstHealth = substationStatus?.worst_circuit_health ?? avgHealth;
        
        // Debug SUB-HOU-062 specifically
        if (substationId === 'SUB-HOU-062') {
          console.log(`🔍 SUB-HOU-062 DEBUG:`, {
            avgLoad,
            worstLoad,
            pgStatus: substationStatus?.status,
            hasPostgresData: !!substationStatus
          });
        }
        
        let worstStatus: 'critical' | 'warning' | 'good' = 'good';
        let statusColor = [34, 197, 94, 200];
        
        // Calculate health status counts across all aggregated assets
        let criticalCount = 0;
        let warningCount = 0;
        let healthyCount = 0;
        
        const healthByType = {
          substations: { critical: 0, warning: 0, healthy: 0 },
          transformers: { critical: 0, warning: 0, healthy: 0 },
          poles: { critical: 0, warning: 0, healthy: 0 },
          meters: { critical: 0, warning: 0, healthy: 0 }
        };
        
        const assetsByHealth = {
          critical: [] as Asset[],
          warning: [] as Asset[],
          healthy: [] as Asset[]
        };
        
        // Aggregate health status from all assets
        aggregate.allAssets.forEach((asset: Asset) => {
          // Only evaluate assets that have actual health/load data
          const health = asset.health_score;
          const load = asset.load_percent;
          
          let status: 'critical' | 'warning' | 'healthy' = 'healthy';
          if ((health != null && health < 50) || (load != null && load > 85)) {
            status = 'critical';
            criticalCount++;
          } else if ((health != null && health < 70) || (load != null && load > 70)) {
            status = 'warning';
            warningCount++;
          } else {
            healthyCount++;
          }
          
          assetsByHealth[status].push(asset);
          
          const assetType = asset.type === 'substation' ? 'substations' : 
                           asset.type === 'transformer' ? 'transformers' :
                           asset.type === 'pole' ? 'poles' : 'meters';
          healthByType[assetType][status]++;
        });
        
        // Use worst-case logic from Postgres (shows critical if ANY circuit is critical)
        if (substationStatus) {
          if (substationStatus.status === 'critical') {
            worstStatus = 'critical';
            statusColor = [239, 68, 68, 200];
          } else if (substationStatus.status === 'warning') {
            worstStatus = 'warning';
            statusColor = [251, 191, 36, 200];
          }
          // else remains 'good' with green color
        } else {
          // Fallback to worst-case logic if Postgres data not available
          if (worstLoad > 85 || (worstHealth !== null && worstHealth < 50)) {
            worstStatus = 'critical';
            statusColor = [239, 68, 68, 200];
          } else if (worstLoad > 70 || (worstHealth !== null && worstHealth < 70)) {
            worstStatus = 'warning';
            statusColor = [251, 191, 36, 200];
          }
        }
        
        // Debug: log first 3 substations to see what's happening
        if (substationAggregates.size <= 3) {
          console.log(`📊 Substation ${substationId}: avgLoad=${avgLoad}, avgHealth=${avgHealth}, critical=${criticalCount}, warning=${warningCount}, healthy=${healthyCount}, status=${worstStatus}`);
        }
        
        // Calculate radius based on circuit count and asset density
        const towerRadius = Math.max(200, Math.min(1000, 300 + (aggregate.circuits.length * 20)));
        const towerHeight = 1200 + (totalAssets * 0.5);
        const impactScore = (transformerCount * 2) + (poleCount * 1) + (meterCount * 0.5);
        
        aggregateTowers.push({
          position: [sub.longitude, sub.latitude],
          elevation: towerHeight,
          baseZ: 0,
          color: statusColor,
          radius: towerRadius,
          asset: {
            id: substationId,
            name: `Grid Cell: ${totalAssets} assets`,
            type: 'aggregate',
            totalAssets,
            substationCount: 1,
            transformerCount,
            poleCount,
            meterCount,
            avgHealth: avgHealth !== null ? Math.round(avgHealth) : null,
            avgLoad: Math.round(avgLoad),
            worstStatus,
            impactScore,
            latitude: sub.latitude,
            longitude: sub.longitude,
            criticalCount,
            warningCount,
            healthyCount,
            healthByType,
            assetsByHealth,
            substations: [aggregate.substation],
            transformers: aggregate.transformers,
            poles: aggregate.poles,
            meters: aggregate.meters,
            circuitCount: aggregate.circuits.length,
            substationName: sub.name
          }
        });
      });
      
      console.log(`📊 Towers created: ${aggregateTowers.length} substations (from ${unifiedClusters.length} circuits)`);
    }

    console.timeEnd('🔍 flattenedClusterData calculation');
    return { aggregateTowers };
  }, [unifiedClusters, serviceAreas.length, substationStatusMap]);

  // ENGINEERING METRICS: Calculate real-time operational intelligence from grid state
  // Palantir Grid 360 shows LAGGING indicators (outages after they happen)
  // Snowflake Grid Command shows LEADING indicators (stress BEFORE failure)
  const kpis = useMemo(() => {
    // Calculate from actual grid cell aggregates
    const totalCells = flattenedClusterData.aggregateTowers.length;
    
    if (totalCells === 0) {
      // Fallback to placeholder values during initial load
      return {
        saidi: 152.3,
        saifi: 1.42,
        activeOutages: 8,
        totalLoad: 2847,
        crewsActive: 12,
        assetHealth: 87.3,
        networkReliability: 99.7,
        operationalMargin: 0,
        stressAwareReliability: 0
      };
    }

    // Count cells by operational status
    const criticalCells = flattenedClusterData.aggregateTowers.filter((c: any) => c.asset.worstStatus === 'critical').length;
    const warningCells = flattenedClusterData.aggregateTowers.filter((c: any) => c.asset.worstStatus === 'warning').length;
    const healthyCells = totalCells - criticalCells - warningCells;

    // #METRIC 1: Operational Margin - % of grid NOT under stress
    // This answers: "What percentage of my infrastructure has HEALTHY operating margin?"
    const operationalMargin = ((healthyCells / totalCells) * 100);

    // Calculate system-wide averages from grid cells
    const avgHealth = flattenedClusterData.aggregateTowers.reduce((sum: number, c: any) => sum + c.asset.avgHealth, 0) / totalCells;
    const avgLoad = flattenedClusterData.aggregateTowers.reduce((sum: number, c: any) => sum + c.asset.avgLoad, 0) / totalCells;
    const avgLoadHeadroom = 100 - avgLoad;

    // #METRIC 2: Stress-Aware Reliability - Weighted combination acknowledging degradation
    // Traditional reliability only measures binary outages (up/down)
    // This measures: Health (60% weight) + Available Capacity (40% weight)
    const stressAwareReliability = (avgHealth * 0.6) + (avgLoadHeadroom * 0.4);

    // Traditional utility metrics (for comparison with legacy systems)
    const binaryReliability = ((healthyCells + warningCells) / totalCells) * 100; // Only counts complete failures

    return {
      // Traditional Metrics (what Palantir shows)
      saidi: 152.3,  // System Average Interruption Duration Index
      saifi: 1.42,   // System Average Interruption Frequency Index
      activeOutages: criticalCells,  // Count of cells in critical state
      totalLoad: 2847,
      crewsActive: 12,
      assetHealth: avgHealth,  // Now REAL average from grid cells
      networkReliability: binaryReliability,  // Traditional binary reliability
      
      // ENGINEERING METRICS (competitive advantage)
      operationalMargin: operationalMargin,  // NEW: Leading indicator
      stressAwareReliability: stressAwareReliability  // NEW: Degradation-aware reliability
    };
  }, [flattenedClusterData]);

  // Memoize heatmap data for performance
  const heatmapData = useMemo(() => 
    meterAssets
      .filter(a => a.usage_kwh && a.usage_kwh > 0)
      .map(a => ({
        position: [a.longitude, a.latitude],
        weight: Math.log((a.usage_kwh || 1) + 1) / 4
      })),
    [meterAssets]
  );

  // Helper: Calculate fade-in animation progress (0 to 1)
  const getAssetFadeProgress = useCallback((asset: Asset): number => {
    if (!asset.loadedAt) return 1.0; // Old assets or substations - fully visible
    const elapsed = Date.now() - asset.loadedAt;
    const fadeDuration = 400; // 400ms fade-in
    return Math.min(1.0, elapsed / fadeDuration);
  }, []);

  // BATCHED RENDERING HELPER: Derive type-specific batch arrays for GPU optimization
  // NO viewport filtering - prevents GPU buffer regeneration on every pan!
  // Each batch maintains stable data references. deck.gl's built-in culling handles visibility.
  const batchesByType = useMemo(() => {
    return circuitBatches.map(batch => {
      // Filter assets by type in single pass (no viewport check - batches are circuit-scoped and small)
      const substations: Asset[] = [];
      const transformers: Asset[] = [];
      const poles: Asset[] = [];
      const meters: Asset[] = [];
      
      batch.assets.forEach(a => {
        const type = a.type?.toLowerCase();
        switch (type) {
          case 'substation':
            substations.push(a);
            break;
          case 'transformer':
            transformers.push(a);
            break;
          case 'pole':
            poles.push(a);
            break;
          case 'meter':
            meters.push(a);
            break;
        }
      });
      
      return {
        batchId: batch.batchId,
        substations,
        transformers,
        poles,
        meters
      };
    });
  }, [circuitBatches]);  // Only recalculates when batches added/removed, NOT on viewport changes!

  const layers = useMemo(() => [
    // FLUX WEATHER INTELLIGENCE - Broadcast-quality weather visualization
    // Server-rendered smooth gradient image displayed as single texture (GPU-optimized)
    ...(layersVisible.weather && weather.length > 0 ? (() => {
      const currentTemp = weather[weatherTimelineIndex]?.TEMP_F || 75;
      
      // Houston metro bounds for image overlay
      const bounds: [[number, number], [number, number]] = [
        [-96.1, 29.4],  // Southwest corner [lon, lat]
        [-94.9, 30.2]   // Northeast corner [lon, lat]
      ];
      
      // Generate weather image URL with correct aspect ratio for Houston bounds
      // Bounds span 1.2° lon × 0.8° lat = 1.5:1 ratio → use 1536×1024 pixels
      const imageUrl = `/api/weather/image?temp_f=${currentTemp}&width=1536&height=1024&t=${weatherTimelineIndex}`;

      return [
        new BitmapLayer({
          id: 'weather-gradient',
          bounds: bounds,
          image: imageUrl,
          opacity: 0.7,
          pickable: false,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          updateTriggers: {
            image: weatherTimelineIndex  // Regenerate image when timeline changes
          }
        })
      ];
    })() : []),

    // Heatmap layer for meter usage density (GPU-optimized)
    ...(layersVisible.heatmap ? [new HeatmapLayer({
      id: 'usage-heatmap',
      data: heatmapData,
      getPosition: (d: any) => d.position,
      getWeight: (d: any) => d.weight,
      radiusPixels: 25,
      intensity: 1.5,
      threshold: 0.02,
      aggregation: 'SUM',
      colorRange: [
        [255, 255, 178, 25],
        [254, 204, 92, 85],
        [253, 141, 60, 170],
        [240, 59, 32, 255],
        [189, 0, 38, 255]
      ]
    })] : []),

    // ZOOM-ADAPTIVE NETWORK TOPOLOGY: Three-tier hierarchical visualization
    // Metro view (<9): Service area polygons | Neighborhood (9-11.5): Distribution feeders | Street (>11.5): Full network
    ...(layersVisible.connections ? (() => {
      const layers: any[] = [];
      
      // METRO VIEW (Zoom < 9): Grid cell hexagonal tiles matching tower operational status
      if (throttledZoom < 9) {
        // Create hexagon tiles directly under each grid cell tower
        const hexagonTileData = flattenedClusterData.aggregateTowers.map((tower: any) => ({
          position: tower.position,
          operationalStatus: tower.asset.worstStatus,
          avgLoad: tower.asset.avgLoad,
          avgHealth: tower.asset.avgHealth,
          cellId: tower.asset.id
        }));
        
        layers.push(new PolygonLayer({
          id: 'grid-cell-hexagon-tiles',
          data: hexagonTileData,
          pickable: true,
          extruded: false,
          filled: true,
          wireframe: false,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPolygon: (d: any) => {
            const metersToDegreesLon = 1 / 111320 / Math.cos(29.7604 * Math.PI / 180);
            const metersToDegreesLat = 1 / 110540;
            const radiusMeters = 750; // 750m service radius - reduced by 50%
            const radiusLon = radiusMeters * metersToDegreesLon;
            const radiusLat = radiusMeters * metersToDegreesLat;
            
            const vertices: number[][] = [];
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 3) * i;
              vertices.push([
                d.position[0] + radiusLon * Math.cos(angle),
                d.position[1] + radiusLat * Math.sin(angle)
              ]);
            }
            vertices.push(vertices[0]);
            return vertices;
          },
          getFillColor: (d: any) => {
            // Match grid cell operational color logic
            if (d.operationalStatus === 'critical') return [239, 68, 68, 120];   // Red
            if (d.operationalStatus === 'warning') return [251, 191, 36, 120];   // Yellow
            return [34, 197, 94, 120];                                           // Green
          },
          getLineColor: (d: any) => {
            // Darker outline for clarity
            if (d.operationalStatus === 'critical') return [185, 28, 28, 200];
            if (d.operationalStatus === 'warning') return [217, 119, 6, 200];
            return [21, 128, 61, 200];
          },
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          opacity: 0.7,
          updateTriggers: {
            getPolygon: flattenedClusterData,
            getFillColor: flattenedClusterData,
            getLineColor: flattenedClusterData
          },
          onClick: (info: any) => {
            // if (info.object) {
            //   console.log('Grid cell operational status:', {
            //     cellId: info.object.cellId,
            //     status: info.object.operationalStatus,
            //     avgLoad: info.object.avgLoad?.toFixed(1),
            //     avgHealth: info.object.avgHealth?.toFixed(1)
            //   });
            // }
          }
        }));
      }
      
      // NEIGHBORHOOD VIEW (Zoom 9-11.5): Distribution feeders with aggressive performance filtering
      if (throttledZoom >= 9 && throttledZoom < 11.5) {
        layers.push(new ArcLayer({
          id: 'distribution-feeders',
          data: viewportFilteredFeeders,
          pickable: true,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          widthMaxPixels: 5,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getSourcePosition: (d: any) => [d.FROM_LON, d.FROM_LAT],
          getTargetPosition: (d: any) => [d.TO_LON, d.TO_LAT],
          getSourceColor: (d: any) => {
            const load = d.LOAD_UTILIZATION_PCT || 0;
            if (load > 90) return [255, 50, 50, 240];
            if (load > 80) return [255, 100, 0, 220];
            if (load > 70) return [255, 165, 0, 200];
            if (load > 60) return [255, 215, 0, 180];
            return [0, 255, 150, 160];
          },
          getTargetColor: (d: any) => {
            const load = d.LOAD_UTILIZATION_PCT || 0;
            const alpha = 0.5;
            if (load > 90) return [255, 50, 50, 240 * alpha];
            if (load > 80) return [255, 100, 0, 220 * alpha];
            if (load > 70) return [255, 165, 0, 200 * alpha];
            if (load > 60) return [255, 215, 0, 180 * alpha];
            return [0, 255, 150, 160 * alpha];
          },
          getWidth: (d: any) => {
            const load = d.LOAD_UTILIZATION_PCT || 0;
            const kva = d.RATED_KVA || 0;
            if (load > 90 || kva > 750) return 4;
            if (load > 80 || kva > 500) return 3;
            if (load > 70 || kva > 350) return 2.5;
            return 2;
          },
          getHeight: (d: any) => {
            const dx = d.TO_LON - d.FROM_LON;
            const dy = d.TO_LAT - d.FROM_LAT;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const load = d.LOAD_UTILIZATION_PCT || 0;
            const priorityMultiplier = load > 80 ? 0.35 : load > 70 ? 0.3 : 0.25;
            return distance * priorityMultiplier;
          },
          getTilt: 0,
          opacity: 0.9,
          updateTriggers: {
            getSourceColor: [throttledZoom],
            getTargetColor: [throttledZoom],
            getWidth: [throttledZoom],
            getHeight: [throttledZoom]
          },
          onClick: (info: any) => {
            if (info.object) {
              // console.log('Distribution feeder:', info.object);
            }
          }
        }));
      }
      
      // STREET VIEW (Zoom >= 10): Full service hierarchy with smooth reveal animation
      // PERFORMANCE OPTIMIZED: Simplified color calculations, removed per-frame distance fading
      if (throttledZoom >= 10 && visibleTopology.length > 0) {
        layers.push(new ArcLayer({
            id: 'service-connections',
            data: visibleTopology,
            pickable: false,
            getSourcePosition: (d: TopologyLink) => [d.from_longitude, d.from_latitude],
            getTargetPosition: (d: TopologyLink) => [d.to_longitude, d.to_latitude],
            getSourceColor: (d: TopologyLink) => {
              const isSelected = connectedAssets.has(d.from_asset_id) || connectedAssets.has(d.to_asset_id);
              
              if (isSelected) {
                // Simplified pulsing for selected connections
                const pulse = (Math.sin(animationTimeRef.current * 1.5) + 1) * 0.5;
                const alpha = 150 + Math.round(pulse * 100);
                return [0, 255, 200, alpha];
              }
              
              // Status-based colors (no expensive viewport distance calculations)
              const status = (d.connection_type || '').toUpperCase();
              
              if (status.includes('FAULT') || status.includes('OUTAGE') || status.includes('CRITICAL') || status.includes('OFFLINE')) {
                return [255, 60, 60, 110];
              }
              if (status.includes('WARNING') || status.includes('OVERLOAD') || status.includes('HIGH_LOAD') || status.includes('DEGRADED')) {
                return [255, 220, 60, 100];
              }
              return [50, 255, 100, 90];
            },
            getTargetColor: (d: TopologyLink) => {
              const isSelected = connectedAssets.has(d.from_asset_id) || connectedAssets.has(d.to_asset_id);
              
              if (isSelected) {
                const pulse = (Math.sin(animationTimeRef.current * 1.5) + 1) * 0.5;
                const alpha = 120 + Math.round(pulse * 80);
                return [0, 220, 180, alpha];
              }
              
              // Status-based colors (simplified)
              const status = (d.connection_type || '').toUpperCase();
              
              if (status.includes('FAULT') || status.includes('OUTAGE') || status.includes('CRITICAL') || status.includes('OFFLINE')) {
                return [220, 40, 40, 70];
              }
              if (status.includes('WARNING') || status.includes('OVERLOAD') || status.includes('HIGH_LOAD') || status.includes('DEGRADED')) {
                return [230, 190, 40, 65];
              }
              return [40, 220, 80, 60];
            },
            getHeight: 0.05,  // Fixed height for performance (was dynamic calculation)
            getTilt: 0,
            getWidth: (d: TopologyLink) => {
              const isSelected = connectedAssets.has(d.from_asset_id) || connectedAssets.has(d.to_asset_id);
              return isSelected ? 2.0 : 1.0;
            },
            widthUnits: 'pixels',
            widthMinPixels: 0.8,
            widthMaxPixels: 2.5,
            opacity: 0.7,
            updateTriggers: {
              getSourceColor: [connectedAssets.size, animationTimeRef.current],
              getTargetColor: [connectedAssets.size, animationTimeRef.current],
              getWidth: [connectedAssets.size]
            }
          }));
      }
      
    return layers;
  })() : []),

    // AGGREGATE INFRASTRUCTURE TOWERS - Single unified hexagonal tower per grid cell (LOW ZOOM ONLY)
    // Shows engineering-relevant metrics: height = health status priority, color = worst status, width = density
    ...((layersVisible.substations || layersVisible.transformers || layersVisible.poles) ?  // Always render, fade with zoom
      [new PolygonLayer({
        id: 'aggregate-towers',
        data: flattenedClusterData.aggregateTowers,
        pickable: true,
        extruded: true,
        wireframe: true,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPolygon: (d: any) => getHexagonPolygon(d.position[0], d.position[1], d.radius),
        getElevation: (d: any) => {
          const staggeredScale = getStaggerDelay(
            d.position[0], 
            d.position[1], 
            towerScaleAnimation,
            d.asset.avgHealth,
            d.asset.avgLoad
          );
          // Smooth fade-out starting early and extending over wider zoom range
          const zoomFade = throttledZoom >= 10.0
            ? Math.max(0, 1 - ((throttledZoom - 10.0) / 2.5))
            : 1;
          return d.elevation * heightScale * staggeredScale * zoomFade;
        },
        getFillColor: (d: any) => {
          const staggeredScale = getStaggerDelay(
            d.position[0], 
            d.position[1], 
            towerScaleAnimation,
            d.asset.avgHealth,
            d.asset.avgLoad
          );
          // Smooth fade-out starting early and extending over wider zoom range
          const zoomFade = throttledZoom >= 10.0
            ? Math.max(0, 1 - ((throttledZoom - 10.0) / 2.5))
            : 1;
          return [...d.color.slice(0, 3), d.color[3] * staggeredScale * zoomFade];
        },
        getLineColor: (d: any) => {
          const staggeredScale = getStaggerDelay(
            d.position[0], 
            d.position[1], 
            towerScaleAnimation,
            d.asset.avgHealth,
            d.asset.avgLoad
          );
          // Smooth fade-out starting early and extending over wider zoom range
          const zoomFade = throttledZoom >= 10.0
            ? Math.max(0, 1 - ((throttledZoom - 10.0) / 2.5))
            : 1;
          return [255, 255, 255, 120 * staggeredScale * zoomFade];
        },
        elevationScale: 1,
        lineWidthMinPixels: 2,
        transitions: {
          getElevation: {
            duration: 800,
            easing: t => t * (2 - t)
          },
          getFillColor: {
            duration: 600,
            easing: t => t * (2 - t)
          }
        },
        updateTriggers: {
          getPolygon: flattenedClusterData.aggregateTowers,
          getFillColor: [flattenedClusterData.aggregateTowers, towerScaleAnimation, throttledZoom],
          getElevation: [flattenedClusterData.aggregateTowers, towerScaleAnimation, throttledZoom, heightScale],
          getLineColor: [towerScaleAnimation, throttledZoom]
        },
        onClick: (info: any) => {
          if (info.object?.asset) {
            setSelectedAsset(info.object.asset);
            setSelectedAssetPosition(null); // Clear stored position for new selection
            setClickPosition({ x: info.x, y: info.y });
            setHoveredAsset(null); // Clear hover when asset is selected
            setHoverPosition(null);
          }
        }
      })] : []
    ),

    // INDIVIDUAL ASSETS - Full detail view (HIGH ZOOM ONLY)
    // CHUNKED LAYERS: Create one layer per batch to avoid GPU buffer regeneration
    ...(layersVisible.substations && currentZoom >= ZOOM_THRESHOLD - 1.5 ?
      batchesByType.flatMap(batch => 
        batch.substations.length > 0 ? [new PolygonLayer({
          id: `substations-individual-${batch.batchId}`,
          data: batch.substations,
          pickable: true,
          extruded: true,
          wireframe: true,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPolygon: (d: Asset) => getHexagonPolygon(d.longitude, d.latitude, 371),  // 25% area reduction (428.4 * √0.75)
          getElevation: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score);
            return 102 * heightScale * staggeredScale;
          },
          getFillColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score);
            return [0, 200, 255, 200 * staggeredScale];
          },
          getLineColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              undefined,
              'substation'
            );
            return [255, 255, 255, 80 * staggeredScale];
          },
          elevationScale: 1,
          lineWidthMinPixels: 1,
          transitions: {
            getElevation: {
              duration: 800,
              easing: t => t * (2 - t)
            },
            getFillColor: {
              duration: 600,
              easing: t => t * (2 - t)
            }
          },
          updateTriggers: {
            getElevation: [assetScaleAnimation, heightScale],
            getFillColor: assetScaleAnimation,
          getLineColor: assetScaleAnimation
        },
        onClick: (info: any) => {
          if (info.object) {
            if (info.srcEvent?.shiftKey) {
              setSelectedAssets(prev => {
                const newSet = new Set(prev);
                if (newSet.has(info.object.id)) {
                  newSet.delete(info.object.id);
                } else {
                  newSet.add(info.object.id);
                }
                return newSet;
              });
            } else {
              setSelectedAsset(info.object);
              setSelectedAssets(new Set([info.object.id]));
              setSelectedAssetPosition(null);
              setHoveredAsset(null); // Clear hover when asset is selected
              setHoverPosition(null);
              setClickPosition({ x: info.x, y: info.y });
            }
          }
        },
        onHover: (info: any) => {
          if (info.object && info.object.id !== selectedAsset?.id) {
            setHoveredAsset(info.object);
            setHoverPosition({ x: info.x, y: info.y });
          } else {
            setHoveredAsset(null);
            setHoverPosition(null);
          }
        }
      })] : []) : []
    ),

    // Substation connection count badges - IconLayer with custom SVG badges
    // COMMENTED OUT: Substation transformer count badges (floating labels)
    // ...(layersVisible.substations && currentZoom >= ZOOM_THRESHOLD - 1.5 && assetConnectionCounts.size > 0 ? 
    //   viewportFilteredBatches.flatMap(batch => {
    //     const badgeData = batch.substations.filter(s => {
    //       const counts = assetConnectionCounts.get(s.id);
    //       return counts && counts.transformers > 0;
    //     });
    //     
    //     return badgeData.length > 0 ? [new IconLayer({
    //       id: `substation-badge-${batch.batchId}`,
    //       data: badgeData,
    //     pickable: false,
    //     coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    //     getPosition: (d: Asset) => [
    //       d.longitude,
    //       d.latitude,
    //       120 * heightScale
    //     ],
    //     getIcon: (d: Asset) => {
    //       const counts = assetConnectionCounts.get(d.id);
    //       const count = counts?.transformers || 0;
    //       const displayCount = count >= 1000 ? `${Math.floor(count / 1000)}k` : count;
    //       // Material UI Power icon SVG path
    //       const powerIconPath = 'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z';
    //       
    //       const svg = `<svg width="32" height="40" xmlns="http://www.w3.org/2000/svg">
    //         <rect x="2" y="2" width="28" height="36" rx="4" fill="rgb(236, 72, 153)" stroke="white" stroke-width="2"/>
    //         <g transform="translate(8, 6)">
    //           <path d="${powerIconPath}" fill="white"/>
    //         </g>
    //         <text x="16" y="34" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="white" text-anchor="middle">${displayCount}</text>
    //       </svg>`;
    //       
    //       return {
    //         url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    //         width: 32,
    //         height: 40
    //       };
    //     },
    //     getSize: 32,
    //     sizeUnits: 'pixels',
    //     billboard: true,
    //     updateTriggers: {
    //       getPosition: [heightScale],
    //       getIcon: [assetConnectionCounts]
    //     }
    //   })] : [];
    //   }) : []
    // ),

    ...(layersVisible.transformers && currentZoom >= ZOOM_THRESHOLD - 1.5 ?
      batchesByType.flatMap(batch =>
        batch.transformers.length > 0 ? [
        // Transformer base - BATCHED: One layer per circuit batch prevents GPU buffer regeneration
        // deck.gl v9: Using PolygonLayer instead of ColumnLayer (ColumnLayer has missing faces bug)
        new PolygonLayer({
          id: `transformers-individual-${batch.batchId}`,
          data: batch.transformers,
          pickable: true,
          extruded: true,
          wireframe: true,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPolygon: (d: Asset) => getSquarePolygon(d.longitude, d.latitude, 30, d.rotation_rad || 0),
          getElevation: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              d.load_percent,
              'transformer'
            );
            const fadeProgress = getAssetFadeProgress(d);
            return 23.4375 * heightScale * staggeredScale * fadeProgress;
          },
          getFillColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              d.load_percent,
              'transformer'
            );
            const fadeProgress = getAssetFadeProgress(d);
            return [236, 72, 153, 200 * staggeredScale * fadeProgress];
          },
          getLineColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              d.load_percent,
              'transformer'
            );
            const fadeProgress = getAssetFadeProgress(d);
            return [255, 100, 180, 100 * staggeredScale * fadeProgress];
          },
          elevationScale: 1,
          lineWidthMinPixels: 2,
          transitions: {
            getElevation: {
              duration: 400,
              easing: t => t * t * (3 - 2 * t)  // Smooth ease-in-out
            },
            getFillColor: {
              duration: 400,
              easing: t => t * t * (3 - 2 * t)
            }
          },
          updateTriggers: {
            getElevation: [assetScaleAnimation],
            getFillColor: [assetScaleAnimation],
            getLineColor: [assetScaleAnimation]
          },
          onClick: (info: any) => {
            if (info.object) {
              if (info.srcEvent?.shiftKey) {
                setSelectedAssets(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(info.object.id)) {
                    newSet.delete(info.object.id);
                  } else {
                    newSet.add(info.object.id);
                  }
                  return newSet;
                });
              } else {
                setSelectedAsset(info.object);
                setSelectedAssets(new Set([info.object.id]));
                setSelectedAssetPosition(null);
                setClickPosition({ x: info.x, y: info.y });
              }
            }
          },
          onHover: (info: any) => {
            if (info.object && info.object.id !== selectedAsset?.id) {
              setHoveredAsset(info.object);
              setHoverPosition({ x: info.x, y: info.y });
            } else {
              setHoveredAsset(null);
              setHoverPosition(null);
            }
          }
        }),
        // Transformer health cap - BATCHED: Matches base layer batching
        // deck.gl v9: Using PolygonLayer - cap rendered as additional height on top of base
        new PolygonLayer({
          id: `transformers-cap-${batch.batchId}`,
          data: batch.transformers,
          extruded: true,
          wireframe: true,
          pickable: false,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPolygon: (d: Asset) => getSquarePolygon(d.longitude, d.latitude, 16.875, d.rotation_rad || 0),
          getElevation: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              d.load_percent,
              'transformer'
            );
            const fadeProgress = getAssetFadeProgress(d);
            const baseHeight = 23.4375 * heightScale * staggeredScale * fadeProgress;
            const capHeight = 4.6875 * heightScale * staggeredScale * fadeProgress;
            return baseHeight + capHeight;
          },
          getFillColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              d.load_percent,
              'transformer'
            );
            const fadeProgress = getAssetFadeProgress(d);
            
            const health = d.health_score != null ? d.health_score : 100;
            const load = d.load_percent != null ? d.load_percent : 0;
            
            if (load > 85 || health < 50) return [239, 68, 68, 220 * staggeredScale * fadeProgress];
            if (load > 70 || health < 70) return [251, 191, 36, 220 * staggeredScale * fadeProgress];
            return [34, 197, 94, 220 * staggeredScale * fadeProgress];
          },
          getLineColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(
              d.longitude, 
              d.latitude, 
              assetScaleAnimation,
              d.health_score,
              d.load_percent,
              'transformer'
            );
            const fadeProgress = getAssetFadeProgress(d);
            const health = d.health_score != null ? d.health_score : 100;
            const load = d.load_percent != null ? d.load_percent : 0;
            
            if (load > 85 || health < 50) return [185, 28, 28, 180 * staggeredScale * fadeProgress];
            if (load > 70 || health < 70) return [217, 119, 6, 180 * staggeredScale * fadeProgress];
            return [21, 128, 61, 180 * staggeredScale * fadeProgress];
          },
          elevationScale: 1,
          lineWidthMinPixels: 2,
          transitions: {
            getElevation: {
              duration: 800,
              easing: t => t * (2 - t)
            },
            getFillColor: {
              duration: 600,
              easing: t => t * (2 - t)
            }
          },
          updateTriggers: {
            getPosition: [assetScaleAnimation],
            getElevation: [assetScaleAnimation],
            getFillColor: [assetScaleAnimation],
            getLineColor: [assetScaleAnimation]
          }
        })
        ] : []
      ) : []
    ),

    // COMMENTED OUT: Transformer meter count badges (floating labels)
    // ...(layersVisible.transformers && currentZoom >= ZOOM_THRESHOLD && assetConnectionCounts.size > 0 ? [
    //   new IconLayer({
    //     id: 'transformer-badge',
    //     data: viewportFilteredAssets.transformerAssets.filter(t => {
    //       const counts = assetConnectionCounts.get(t.id);
    //       return counts && counts.meters > 0;
    //     }),
    //     pickable: false,
    //     coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    //     getPosition: (d: Asset) => [
    //       d.longitude,
    //       d.latitude,
    //       45 * heightScale
    //     ],
    //     getIcon: (d: Asset) => {
    //       const counts = assetConnectionCounts.get(d.id);
    //       const count = counts?.meters || 0;
    //       const displayCount = count >= 1000 ? `${Math.floor(count / 1000)}k` : count;
    //       // Material UI Power icon SVG path
    //       const powerIconPath = 'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z';
    //       
    //       const svg = `<svg width="28" height="36" xmlns="http://www.w3.org/2000/svg">
    //         <rect x="2" y="2" width="24" height="32" rx="3" fill="rgb(147, 51, 234)" stroke="white" stroke-width="2"/>
    //         <g transform="translate(6, 5) scale(0.67)">
    //           <path d="${powerIconPath}" fill="white"/>
    //         </g>
    //         <text x="14" y="29" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="white" text-anchor="middle">${displayCount}</text>
    //       </svg>`;
    //       
    //       return {
    //         url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    //         width: 28,
    //         height: 36
    //       };
    //     },
    //     getSize: 28,
    //     sizeUnits: 'pixels',
    //     billboard: true,
    //     updateTriggers: {
    //       getPosition: [heightScale],
    //       getIcon: [assetConnectionCounts]
    //     }
    //   })
    // ] : []),

    ...(layersVisible.poles && currentZoom >= ZOOM_THRESHOLD - 2.0 ?
      batchesByType.flatMap(batch =>
        batch.poles.length > 0 ? [
        // Poles base layer - BATCHED: One layer per circuit batch
        // deck.gl v9: Using PolygonLayer instead of ColumnLayer
        new PolygonLayer({
          id: `poles-individual-base-${batch.batchId}`,
          data: batch.poles,
          pickable: true,
          extruded: true,
          wireframe: true,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPolygon: (d: Asset) => getHexagonPolygon(d.longitude, d.latitude, 25, d.rotation_rad || 0),
          getElevation: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score, undefined, 'pole');
            const fadeProgress = getAssetFadeProgress(d);
            return 40 * heightScale * staggeredScale * fadeProgress;
          },
          getFillColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score, undefined, 'pole');
            const fadeProgress = getAssetFadeProgress(d);
            return [136, 128, 255, 200 * staggeredScale * fadeProgress];
          },
          getLineColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score, undefined, 'pole');
            const fadeProgress = getAssetFadeProgress(d);
            return [255, 140, 60, 100 * staggeredScale * fadeProgress];
          },
          elevationScale: 1,
          lineWidthMinPixels: 2,
          transitions: {
            getElevation: {
              duration: 400,
              easing: t => t * t * (3 - 2 * t)
            },
            getFillColor: {
              duration: 400,
              easing: t => t * t * (3 - 2 * t)
            }
          },
          updateTriggers: {
            getElevation: [assetScaleAnimation],
            getFillColor: [assetScaleAnimation],
            getLineColor: [assetScaleAnimation]
          },
          onClick: (info: any) => {
          if (info.object) {
            if (info.srcEvent?.shiftKey) {
              setSelectedAssets(prev => {
                const newSet = new Set(prev);
                if (newSet.has(info.object.id)) {
                  newSet.delete(info.object.id);
                } else {
                  newSet.add(info.object.id);
                }
                return newSet;
              });
            } else {
              setSelectedAsset(info.object);
              setSelectedAssets(new Set([info.object.id]));
              setSelectedAssetPosition(null);
              setHoveredAsset(null);
              setHoverPosition(null);
              setClickPosition({ x: info.x, y: info.y });
            }
          }
        },
        onHover: (info: any) => {
          if (info.object && info.object.id !== selectedAsset?.id) {
            setHoveredAsset(info.object);
            setHoverPosition({ x: info.x, y: info.y });
          } else {
            setHoveredAsset(null);
            setHoverPosition(null);
          }
        }
        }),
        // Poles health cap - BATCHED: Cap on top for health indication
        // deck.gl v9: Using PolygonLayer - cap rendered with total height
        new PolygonLayer({
          id: `poles-individual-cap-${batch.batchId}`,
          data: batch.poles,
          pickable: false,
          extruded: true,
          wireframe: true,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPolygon: (d: Asset) => getHexagonPolygon(d.longitude, d.latitude, 18.75, d.rotation_rad || 0),
          getElevation: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score, undefined, 'pole');
            const fadeProgress = getAssetFadeProgress(d);
            const baseHeight = 40 * heightScale * staggeredScale * fadeProgress;
            const capHeight = 10 * heightScale * staggeredScale * fadeProgress;
            return baseHeight + capHeight;
          },
          getFillColor: (d: Asset) => {
            const health = d.health_score !== undefined ? d.health_score : 75;
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score, undefined, 'pole');
            const fadeProgress = getAssetFadeProgress(d);
            const alpha = 220 * staggeredScale * fadeProgress;
            if (d.status && (d.status.includes('Poor') || d.status.includes('Critical'))) {
              return [239, 68, 68, alpha];
            }
            if (d.status && d.status.includes('Fair')) {
              return [251, 191, 36, alpha];
            }
            if (health < 60) return [239, 68, 68, alpha];
            if (health < 80) return [251, 191, 36, alpha];
            return [34, 197, 94, alpha];
          },
          getLineColor: (d: Asset) => {
            const staggeredScale = getStaggerDelay(d.longitude, d.latitude, assetScaleAnimation, d.health_score, undefined, 'pole');
            const fadeProgress = getAssetFadeProgress(d);
            const health = d.health_score !== undefined ? d.health_score : 75;
            
            if (d.status && (d.status.includes('Poor') || d.status.includes('Critical'))) {
              return [185, 28, 28, 180 * staggeredScale * fadeProgress];
            }
            if (d.status && d.status.includes('Fair')) {
              return [217, 119, 6, 180 * staggeredScale * fadeProgress];
            }
            if (health < 60) return [185, 28, 28, 180 * staggeredScale * fadeProgress];
            if (health < 80) return [217, 119, 6, 180 * staggeredScale * fadeProgress];
            return [21, 128, 61, 180 * staggeredScale * fadeProgress];
          },
          elevationScale: 1,
          lineWidthMinPixels: 2,
          transitions: {
            getElevation: {
              duration: 400,
              easing: t => t * t * (3 - 2 * t)
            },
            getFillColor: {
              duration: 400,
              easing: t => t * t * (3 - 2 * t)
            }
          },
          updateTriggers: {
            getElevation: [assetScaleAnimation],
            getFillColor: [assetScaleAnimation],
            getLineColor: [assetScaleAnimation]
          }
        })
        ] : []
      ) : []
    ),



    // Meters (rectangular columns - emerge LAST at highest zoom)
    // ZOOM-BASED VISIBILITY: Show individual meters only at maximum zoom (field inspection level)
    // SHAPE: deck.gl v9: Using PolygonLayer instead of ColumnLayer for proper rendering
    // EMERGENCE: Meters appear LAST - delayed start + slowest emergence
    ...(layersVisible.meters && viewState.zoom > 13.5 ?
      batchesByType.flatMap(batch =>
        batch.meters.length > 0 ? [
      new PolygonLayer({
        id: `meters-${batch.batchId}`,
        data: batch.meters,
        pickable: true,
        extruded: true,
        wireframe: true,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPolygon: (d: Asset) => getSquarePolygon(d.longitude, d.latitude, 10, d.rotation_rad || 0),
        getElevation: (d: Asset) => {
          const baseHeight = 6;
          const fadeProgress = getAssetFadeProgress(d);
          return baseHeight * heightScale * assetScaleAnimation * fadeProgress;
        },
        getFillColor: (d: Asset) => {
          const fadeProgress = getAssetFadeProgress(d);
          const baseAlpha = 220 * assetScaleAnimation * fadeProgress;
          return [147, 51, 234, baseAlpha];
        },
        getLineColor: (d: Asset) => {
          const fadeProgress = getAssetFadeProgress(d);
          const lineAlpha = 180 * assetScaleAnimation * fadeProgress;
          return [107, 33, 168, lineAlpha];
        },
        elevationScale: 1,
        lineWidthMinPixels: 2,
        material: {
          ambient: 0.4,
          diffuse: 0.6,
          shininess: 32,
          specularColor: [90, 30, 140]
        },
        transitions: {
          getElevation: {
            duration: 400,
            easing: t => t * t * (3 - 2 * t)
          },
          getFillColor: {
            duration: 400,
            easing: t => t * t * (3 - 2 * t)
          }
        },
        updateTriggers: {
          getElevation: [assetScaleAnimation],
          getFillColor: [assetScaleAnimation],
          getLineColor: [assetScaleAnimation]
        },
        onClick: (info: any) => {
          if (info.object) {
            if (info.srcEvent?.shiftKey) {
              setSelectedAssets(prev => {
                const newSet = new Set(prev);
                if (newSet.has(info.object.id)) {
                  newSet.delete(info.object.id);
                } else {
                  newSet.add(info.object.id);
                }
                return newSet;
              });
            } else {
              setSelectedAsset(info.object);
              setSelectedAssets(new Set([info.object.id]));
              setSelectedAssetPosition(null);
              setHoveredAsset(null);
              setHoverPosition(null);
              setClickPosition({ x: info.x, y: info.y });
            }
          }
        },
        onHover: (info: any) => {
          if (info.object && info.object.id !== selectedAsset?.id) {
            setHoveredAsset(info.object);
            setHoverPosition({ x: info.x, y: info.y });
          } else {
            setHoveredAsset(null);
            setHoverPosition(null);
          }
        }
      })
      ] : []
      ) : []),

    // ENGINEERING SELECTION - Impact-aware, category-specific bloom for aggregate towers
    ...(selectedAsset && selectedAsset.type === 'aggregate' ? (() => {
      const glow = getGlowProperties(selectedAsset);
      
      // Calculate impact-based scale multiplier (1.0 to 2.0)
      const maxImpact = 30; // Max expected impact score
      const impactScale = 1.0 + (Math.min(selectedAsset.impactScore || 0, maxImpact) / maxImpact);
      
      // Calculate category-specific health colors
      const getHealthColor = (assets: any[], type: string) => {
        if (!assets || assets.length === 0) return [100, 100, 100]; // Gray for missing
        
        // Filter for valid health scores only
        const withHealth = assets.filter(a => a.health_score != null && a.health_score !== undefined);
        const avgHealth = withHealth.length > 0
          ? withHealth.reduce((sum, a) => sum + a.health_score, 0) / withHealth.length
          : 75; // Default if no health data
        
        const avgLoad = type === 'transformer' 
          ? assets.reduce((sum, a) => sum + (a.load_percent || 50), 0) / assets.length 
          : 0;
        
        // Priority: Load issues > Health issues
        if (type === 'transformer' && avgLoad > 85) return [239, 68, 68]; // Red - overload
        if (avgHealth < 50 || avgLoad > 85) return [239, 68, 68]; // Red - critical
        if (avgHealth < 70 || avgLoad > 70) return [251, 191, 36]; // Amber - warning
        return [34, 197, 94]; // Green - healthy
      };
      
      const substationColor = getHealthColor(selectedAsset.substations, 'substation');
      const transformerColor = getHealthColor(selectedAsset.transformers, 'transformer');
      const poleColor = getHealthColor(selectedAsset.poles, 'pole');
      
      return [
        // Outer ring: Substations (cyan base, health-colored)
        new ScatterplotLayer({
          id: 'aggregate-glow-substations',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 10] }],
          pickable: false,
          stroked: false,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (100 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 18 * glow.pulseAmplitude) * glow.glowScale * impactScale * (selectedAsset.substationCount > 0 ? 1.0 : 0.5),
          radiusMaxPixels: 250,
          getPosition: (d: any) => d.position,
          getFillColor: [...substationColor, 30 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 12 * glow.pulseAmplitude],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame
          }
        }),
        // Middle ring: Transformers (magenta base, health+load colored)
        new ScatterplotLayer({
          id: 'aggregate-glow-transformers',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 15] }],
          pickable: false,
          stroked: false,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (65 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 12 * glow.pulseAmplitude) * glow.glowScale * impactScale * (selectedAsset.transformerCount > 0 ? 1.0 : 0.5),
          radiusMaxPixels: 150,
          getPosition: (d: any) => d.position,
          getFillColor: [...transformerColor, 60 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 25 * glow.pulseAmplitude],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame
          }
        }),
        // Inner ring: Poles (purple base, health colored)
        new ScatterplotLayer({
          id: 'aggregate-glow-poles',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 20] }],
          pickable: false,
          stroked: true,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (35 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.04)) * 8 * glow.pulseAmplitude) * glow.glowScale * impactScale * (selectedAsset.poleCount > 0 ? 1.0 : 0.5),
          radiusMaxPixels: 90,
          lineWidthMinPixels: 2 * glow.strokeIntensity,
          getPosition: (d: any) => d.position,
          getFillColor: [...poleColor, 80 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.04)) * 30 * glow.pulseAmplitude],
          getLineColor: [...poleColor.map(c => Math.min(255, c + 50)), 180 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.04)) * 75 * glow.strokeIntensity],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame,
            getLineColor: animationFrame
          }
        })
      ];
    })() : []),

    // ENGINEERING SELECTION - Priority-based bloom for substations
    ...(selectedAsset && selectedAsset.type === 'substation' ? (() => {
      const glow = getGlowProperties(selectedAsset);
      return [
        // Outer glow
        new ScatterplotLayer({
          id: 'substation-glow-outer',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 10] }],
          pickable: false,
          stroked: false,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (35 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 8 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 90,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor, 30 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 12 * glow.pulseAmplitude],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame
          }
        }),
        // Inner glow
        new ScatterplotLayer({
          id: 'substation-glow-inner',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 15] }],
          pickable: false,
          stroked: true,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (18 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 5 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 50,
          lineWidthMinPixels: 2 * glow.strokeIntensity,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor.map(c => Math.min(255, c + 20)), 80 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 25 * glow.pulseAmplitude],
          getLineColor: [...glow.baseColor.map(c => Math.min(255, c + 35)), 160 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 60 * glow.strokeIntensity],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame,
            getLineColor: animationFrame
          }
        })
      ];
    })() : []),

    // ENGINEERING SELECTION - Priority-based bloom for transformers
    ...(selectedAsset && selectedAsset.type === 'transformer' ? (() => {
      const glow = getGlowProperties(selectedAsset);
      return [
        // Outer glow
        new ScatterplotLayer({
          id: 'transformer-glow-outer',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 10] }],
          pickable: false,
          stroked: false,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (28 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 6 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 70,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor, 35 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 15 * glow.pulseAmplitude],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame
          }
        }),
        // Inner glow
        new ScatterplotLayer({
          id: 'transformer-glow-inner',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 15] }],
          pickable: false,
          stroked: true,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (14 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 4 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 40,
          lineWidthMinPixels: 2 * glow.strokeIntensity,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor.map(c => Math.min(255, c + 20)), 90 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 30 * glow.pulseAmplitude],
          getLineColor: [...glow.baseColor.map(c => Math.min(255, c + 35)), 170 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 65 * glow.strokeIntensity],
        updateTriggers: {
          radiusMinPixels: animationTimeRef.current,
          getFillColor: animationFrame,
          getLineColor: animationTimeRef.current
        }
      })
      ];
    })() : []),

    // ENGINEERING SELECTION - Priority-based bloom for poles
    ...(selectedAsset && selectedAsset.type === 'pole' ? (() => {
      const glow = getGlowProperties(selectedAsset);
      return [
        // Outer glow
        new ScatterplotLayer({
          id: 'pole-glow-outer',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 10] }],
          pickable: false,
          stroked: false,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (22 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 5 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 55,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor, 40 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 18 * glow.pulseAmplitude],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame
          }
        }),
        // Inner glow
        new ScatterplotLayer({
          id: 'pole-glow-inner',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 15] }],
          pickable: false,
          stroked: true,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (10 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 3 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 30,
          lineWidthMinPixels: 2 * glow.strokeIntensity,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor.map(c => Math.min(255, c + 20)), 100 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 35 * glow.pulseAmplitude],
          getLineColor: [...glow.baseColor.map(c => Math.min(255, c + 35)), 180 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 70 * glow.strokeIntensity],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame,
            getLineColor: animationFrame
          }
        })
      ];
    })() : []),

    // ENGINEERING SELECTION - Priority-based bloom for meters
    ...(selectedAsset && selectedAsset.type === 'meter' ? (() => {
      const glow = getGlowProperties(selectedAsset);
      return [
        // Outer glow
        new ScatterplotLayer({
          id: 'meter-glow-outer',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 10] }],
          pickable: false,
          stroked: false,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (18 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 4 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 45,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor, 45 + Math.sin(animationTimeRef.current * glow.pulseSpeed) * 20 * glow.pulseAmplitude],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame
          }
        }),
        // Inner glow
        new ScatterplotLayer({
          id: 'meter-glow-inner',
          data: [{ position: [selectedAsset.longitude, selectedAsset.latitude, 15] }],
          pickable: false,
          stroked: true,
          filled: true,
          radiusScale: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          radiusMinPixels: (8 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 2 * glow.pulseAmplitude) * glow.glowScale,
          radiusMaxPixels: 25,
          lineWidthMinPixels: 2 * glow.strokeIntensity,
          getPosition: (d: any) => d.position,
          getFillColor: [...glow.baseColor.map(c => Math.min(255, c + 20)), 110 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 40 * glow.pulseAmplitude],
          getLineColor: [...glow.baseColor.map(c => Math.min(255, c + 35)), 190 + Math.sin(animationTimeRef.current * (glow.pulseSpeed + 0.02)) * 65 * glow.strokeIntensity],
          updateTriggers: {
            radiusMinPixels: animationFrame,
            getFillColor: animationFrame,
            getLineColor: animationFrame
          }
        })
      ];
    })() : []),

    // Engineering: Building Footprints via PostGIS Vector Tiles (MVT)
    // 2.7M building polygons rendered instantly via spatial-indexed tile generation
    ...(layersVisible.buildingFootprints ? [
      new MVTLayer({
        id: 'building-footprints-mvt',
        data: '/api/spatial/tiles/buildings/{z}/{x}/{y}.mvt',
        minZoom: 0,
        maxZoom: 24,
        getFillColor: (f: any) => {
          const type = f.properties?.building_type;
          if (type === 'commercial') return [70, 130, 180, 180];
          if (type === 'industrial') return [180, 120, 60, 180];
          if (type === 'residential') return [100, 160, 100, 160];
          return [140, 140, 150, 160];
        },
        getLineColor: [60, 60, 60, 200],
        lineWidthMinPixels: 1,
        stroked: true,
        filled: true,
        extruded: layersVisible.enable3D,
        wireframe: false,
        // Fix: Realistic building heights - use height_meters directly without floor multiplication
        // Most buildings have reasonable height_meters values (avg 5.3m, max 305m for skyscrapers)
        getElevation: (f: any) => {
          const height = f.properties?.height_meters || 5;
          // Cap very tall buildings at reasonable rendering height for visual clarity
          return Math.min(height, 350);
        },
        // Fix: Reduced elevation scale - buildings were appearing too tall
        // Scale of 1 at all zooms for accurate real-world proportions
        elevationScale: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 200, 0, 200],
        onClick: (info: any) => {
          if (info.object) {
            const building: SpatialBuilding = {
              id: info.object.properties?.building_id || `bldg-${info.index}`,
              type: 'building',
              building_name: info.object.properties?.building_name,
              building_type: info.object.properties?.building_type,
              height_meters: info.object.properties?.height_meters,
              num_floors: info.object.properties?.num_floors,
              footprint_area_sqm: info.object.properties?.footprint_area_sqm,
              address: info.object.properties?.address
            };
            setSelectedSpatialObject(building);
            setSpatialClickPosition({ x: info.x, y: info.y });
            setSelectedAsset(null);
          }
        },
        onHover: (info: any) => {
          if (info.object) {
            const building: SpatialBuilding = {
              id: info.object.properties?.building_id || `bldg-${info.index}`,
              type: 'building',
              building_name: info.object.properties?.building_name,
              building_type: info.object.properties?.building_type,
              height_meters: info.object.properties?.height_meters,
              num_floors: info.object.properties?.num_floors,
              footprint_area_sqm: info.object.properties?.footprint_area_sqm
            };
            setHoveredSpatialObject(building);
            setSpatialHoverPosition({ x: info.x, y: info.y });
          } else {
            setHoveredSpatialObject(null);
            setSpatialHoverPosition(null);
          }
        }
      })
    ] : []),

    // Engineering: Power Lines from PostGIS with LOD + class-based styling
    // Major lines (power_line): Orange with warm glow - high voltage transmission
    // Minor lines (minor_line): Cyan with electric glow - distribution feeders
    // NOTE: Green connections on map are TOPOLOGY LINKS (ArcLayer), not power lines
    ...(layersVisible.powerLines && spatialData.powerLines.length > 0 ? [
      // Outer glow layer - creates electric halo effect
      new PathLayer({
        id: 'power-lines-outer-glow',
        data: spatialData.powerLines,
        getPath: (d: any) => d.coordinates || d.path,
        getColor: (d: any) => d.class === 'power_line' 
          ? [255, 180, 60, 40]    // Warm orange outer glow for transmission
          : [80, 180, 255, 35],   // Electric blue outer glow for distribution
        getWidth: (d: any) => d.class === 'power_line' ? 18 : 12,
        widthUnits: 'pixels',
        widthMinPixels: 8,
        widthMaxPixels: 30,
        capRounded: true,
        jointRounded: true,
        billboard: true
      }),
      // Inner glow layer - intensified glow near line
      new PathLayer({
        id: 'power-lines-inner-glow',
        data: spatialData.powerLines,
        getPath: (d: any) => d.coordinates || d.path,
        getColor: (d: any) => d.class === 'power_line' 
          ? [255, 160, 40, 90]    // Orange inner glow
          : [100, 200, 255, 80],  // Cyan inner glow
        getWidth: (d: any) => d.class === 'power_line' ? 10 : 7,
        widthUnits: 'pixels',
        widthMinPixels: 4,
        widthMaxPixels: 16,
        capRounded: true,
        jointRounded: true,
        billboard: true
      }),
      // Core line - solid visible line
      new PathLayer({
        id: 'power-lines-core',
        data: spatialData.powerLines,
        getPath: (d: any) => d.coordinates || d.path,
        getColor: (d: any) => d.class === 'power_line'
          ? [255, 140, 0, 255]    // Deep orange for major (transmission)
          : [80, 200, 255, 255],  // Cyan for minor (distribution)
        getWidth: (d: any) => d.class === 'power_line' ? 3 : 2,
        widthUnits: 'pixels',
        widthMinPixels: 1.5,
        widthMaxPixels: 6,
        capRounded: true,
        jointRounded: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 100, 255],
        onClick: (info: any) => {
          if (info.object) {
            const powerLine: SpatialPowerLine = {
              id: info.object.id || `line-${info.index}`,
              type: 'power_line',
              line_name: info.object.class === 'power_line' ? 'Transmission Line' : 'Distribution Line',
              voltage_kv: info.object.class === 'power_line' ? 138 : 12.5,  // Typical voltages
              length_km: info.object.length_m ? info.object.length_m / 1000 : undefined,
              conductor_type: info.object.conductor_type,
              installation_year: info.object.installation_year,
              coordinates: info.object.coordinates || info.object.path
            };
            setSelectedSpatialObject(powerLine);
            setSpatialClickPosition({ x: info.x, y: info.y });
            setSelectedAsset(null);
          }
        },
        onHover: (info: any) => {
          if (info.object) {
            const powerLine: SpatialPowerLine = {
              id: info.object.id || `line-${info.index}`,
              type: 'power_line',
              line_name: info.object.class === 'power_line' ? 'Transmission Line' : 'Distribution Line',
              voltage_kv: info.object.class === 'power_line' ? 138 : 12.5,
              length_km: info.object.length_m ? info.object.length_m / 1000 : undefined,
              coordinates: info.object.coordinates || info.object.path
            };
            setHoveredSpatialObject(powerLine);
            setSpatialHoverPosition({ x: info.x, y: info.y });
          } else {
            setHoveredSpatialObject(null);
            setSpatialHoverPosition(null);
          }
        }
      })
    ] : []),

    // Engineering: Vegetation Risk from PostGIS (3D tree columns)
    // deck.gl v9: Using PolygonLayer instead of ColumnLayer
    ...(layersVisible.vegetation && spatialData.vegetation.length > 0 ? [
      new PolygonLayer({
        id: 'vegetation-risk-3d',
        data: spatialData.vegetation,
        extruded: layersVisible.enable3D,
        wireframe: true,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPolygon: (d: any) => {
          const radius = currentZoom > 15 ? 8 : currentZoom > 13 ? 12 : 16;
          return getOctagonPolygon(d.longitude || d.lon, d.latitude || d.lat, radius);
        },
        getFillColor: (d: any) => {
          const risk = d.risk_score || d.proximity_risk || 0.5;
          if (risk > 0.7) return [220, 38, 38, 200];
          if (risk > 0.4) return [234, 179, 8, 200];
          return [34, 197, 94, 180];
        },
        getElevation: (d: any) => (d.height_m || d.canopy_height || 12) * (currentZoom > 15 ? 1 : currentZoom > 13 ? 1.5 : 2),
        elevationScale: currentZoom > 15 ? 1 : currentZoom > 13 ? 1.5 : 2.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 100, 255],
        onClick: (info: any) => {
          if (info.object) {
            const vegetation: SpatialVegetation = {
              id: info.object.id || `tree-${info.index}`,
              type: 'vegetation',
              species: info.object.species,
              height_m: info.object.height_m,
              canopy_height: info.object.canopy_height,
              risk_score: info.object.risk_score,
              proximity_risk: info.object.proximity_risk,
              distance_to_line_m: info.object.distance_to_line_m,
              latitude: info.object.latitude || info.object.lat,
              longitude: info.object.longitude || info.object.lon
            };
            setSelectedSpatialObject(vegetation);
            setSpatialClickPosition({ x: info.x, y: info.y });
            setSelectedAsset(null);
          }
        },
        onHover: (info: any) => {
          if (info.object) {
            const vegetation: SpatialVegetation = {
              id: info.object.id || `tree-${info.index}`,
              type: 'vegetation',
              species: info.object.species,
              height_m: info.object.height_m,
              risk_score: info.object.risk_score,
              proximity_risk: info.object.proximity_risk,
              latitude: info.object.latitude || info.object.lat,
              longitude: info.object.longitude || info.object.lon
            };
            setHoveredSpatialObject(vegetation);
            setSpatialHoverPosition({ x: info.x, y: info.y });
          } else {
            setHoveredSpatialObject(null);
            setSpatialHoverPosition(null);
          }
        }
      })
    ] : [])
  ].filter(Boolean), [
    layersVisible,
    useClusteredView,
    weather,
    weatherTimelineIndex,
    meterAssets,
    visibleTopology,
    flattenedClusterData,
    viewportFilteredAssets,
    viewportFilteredFeeders,
    selectedAsset,
    selectedAssets,
    animationFrame,
    throttledZoom,
    assetScaleAnimation,
    towerScaleAnimation,
    currentZoom,
    heightScale,
    heatmapData,
    connectedAssets,
    assetConnectionCounts,
    spatialData
  ]);

  // Removed expensive console.log for performance

  const assetCounts = useMemo(() => ({
    total: assets.length,
    substations: substationAssets.length,
    transformers: transformerAssets.length,
    poles: poleAssets.length,
    meters: meterAssets.length
  }), [assets.length, substationAssets.length, transformerAssets.length, poleAssets.length, meterAssets.length]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Header */}
        <AppBar position="static" sx={{ bgcolor: '#000000', borderBottom: 'none' }}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <img 
                src="/flux-logo.png" 
                alt="Flux" 
                className={`flux-logo ${isSlowingDown ? 'slowing-down' : isSpinning ? 'loading' : ''}`}
              />
              <Box>
                <Typography 
                  variant="h5" 
                  className="flux-gradient-text"
                  sx={{ 
                    fontWeight: 100, 
                    fontFamily: '"Quantico", sans-serif',
                    letterSpacing: '0.166em',
                    fontSize: '32px'
                  }}
                >
                  FLUX OPERATIONS CENTER
                </Typography>
                <Typography 
                  variant="caption" 
                  sx={{ 
                    fontFamily: '"Space Mono", monospace',
                    fontWeight: 400,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    display: 'block',
                    mt: -1
                  }}
                >
                  <Box component="span" sx={{ color: '#0098D6' }}>Grid Operations</Box>
                  <Box component="span" sx={{ color: '#6b7280', mx: 1 }}>•</Box>
                  <Box component="span" sx={{ color: '#74522F' }}>Houston TX</Box>
                  <Box component="span" sx={{ color: '#6b7280', mx: 1 }}>•</Box>
                  <Box component="span" sx={{ color: '#ffffff' }}>Grid Intelligence</Box>
                </Typography>
              </Box>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              {/* Asset Count */}
              <Chip 
                icon={<Speed sx={{ fontSize: 16 }} />} 
                label={`Showing ${assetCounts.total.toLocaleString()} Assets`} 
                size="small" 
                sx={{ 
                  fontWeight: 600,
                  bgcolor: 'rgba(41, 181, 232, 0.08)',
                  color: '#29B5E8',
                  border: '1px solid rgba(41, 181, 232, 0.3)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    transform: 'translateY(-2px)', 
                    boxShadow: '0 6px 16px rgba(41, 181, 232, 0.3), 0 2px 4px rgba(41, 181, 232, 0.2)',
                    borderColor: '#29B5E8',
                    bgcolor: 'rgba(41, 181, 232, 0.12)'
                  }
                }}
              />
              
              {/* Service Territory */}
              <Chip 
                label="12,847 sq mi"
                size="small" 
                sx={{ 
                  fontWeight: 600,
                  bgcolor: 'rgba(6, 182, 212, 0.08)',
                  color: '#06B6D4',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    transform: 'translateY(-2px)', 
                    boxShadow: '0 6px 16px rgba(6, 182, 212, 0.3), 0 2px 4px rgba(6, 182, 212, 0.2)',
                    borderColor: '#06B6D4',
                    bgcolor: 'rgba(6, 182, 212, 0.12)'
                  }
                }}
              />
              
              {/* Last Update - Dynamic */}
              <Chip 
                label={isLoadingData ? 'Fetching Data' : `Refreshed ${getTimeAgo(lastUpdateTime)}`}
                size="small" 
                sx={{ 
                  fontWeight: 600,
                  bgcolor: isLoadingData 
                    ? 'rgba(251, 191, 36, 0.12)' 
                    : 'rgba(34, 197, 94, 0.08)',
                  color: isLoadingData 
                    ? '#FBBF24' 
                    : '#22C55E',
                  border: isLoadingData 
                    ? '1px solid rgba(251, 191, 36, 0.4)' 
                    : '1px solid rgba(34, 197, 94, 0.3)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  animation: isLoadingData ? 'orangeGlow 1.5s ease-in-out infinite' : 'none',
                  willChange: isLoadingData ? 'filter' : 'auto',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    transform: 'translateY(-2px)', 
                    boxShadow: isLoadingData 
                      ? '0 0 20px rgba(251, 191, 36, 0.6), 0 4px 16px rgba(251, 191, 36, 0.3)'
                      : '0 6px 16px rgba(34, 197, 94, 0.3), 0 2px 4px rgba(34, 197, 94, 0.2)',
                    borderColor: isLoadingData ? '#FBBF24' : '#22C55E',
                    bgcolor: isLoadingData 
                      ? 'rgba(251, 191, 36, 0.18)' 
                      : 'rgba(34, 197, 94, 0.12)'
                  },
                  '& .MuiChip-label': {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    '&::before': {
                      content: isLoadingData 
                        ? '"\u21BB"' 
                        : '"\u25CF"',
                      fontSize: '10px',
                      animation: isLoadingData 
                        ? 'fluxSpin 1s linear infinite' 
                        : 'pulse 2s ease-in-out infinite'
                    }
                  }
                }}
              />
              
              <Box sx={{ width: 1, height: 24, bgcolor: 'rgba(107, 114, 128, 0.3)', mx: 0.5 }} />
              
              {/* Snowflake Badge */}
              <Chip 
                label="Powered by Snowflake Cortex"
                size="small" 
                sx={{ 
                  fontWeight: 600,
                  bgcolor: 'rgba(41, 181, 232, 0.12)',
                  color: '#29B5E8',
                  border: '2px solid rgba(41, 181, 232, 0.4)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(41, 181, 232, 0.2)',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    transform: 'translateY(-2px)', 
                    boxShadow: '0 8px 20px rgba(41, 181, 232, 0.4), 0 2px 4px rgba(41, 181, 232, 0.3)',
                    bgcolor: 'rgba(41, 181, 232, 0.18)',
                    borderColor: '#29B5E8'
                  }
                }}
              />
            </Stack>
          </Toolbar>
          <Tabs 
            value={currentTab} 
            onChange={(_, v) => setCurrentTab(v)} 
            sx={{ 
              bgcolor: '#1a1f2e',
              borderTop: '1px solid rgba(59, 130, 246, 0.2)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.02)',
              '& .MuiTab-root': {
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: 'translateX(-50%) scaleX(0)',
                  width: '80%',
                  height: '2px',
                  background: 'linear-gradient(90deg, #FBBF24 0%, #F59E0B 100%)',
                  boxShadow: '0 0 8px rgba(251, 191, 36, 0.6)',
                  transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  borderRadius: '2px 2px 0 0'
                },
                '&:hover': {
                  transform: 'translateY(-2px)',
                  bgcolor: 'rgba(251, 191, 36, 0.05)',
                  '&::before': {
                    transform: 'translateX(-50%) scaleX(0.5)'
                  }
                },
                '&.Mui-selected': {
                  color: '#FBBF24',
                  bgcolor: 'rgba(251, 191, 36, 0.08)',
                  '&::before': {
                    transform: 'translateX(-50%) scaleX(1)'
                  }
                }
              },
              '& .MuiTabs-indicator': {
                display: 'none'
              }
            }}
          >
            <Tab label="Operations Dashboard" />
            <Tab label="Network Topology" />
            <Tab label="Asset Health" />
            <Tab label="AMI Analytics" />
            <Tab label="Outage Management" />
          </Tabs>
        </AppBar>

        {/* Main Content */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab 0: Operations Dashboard - Always mounted, hidden when not active */}
          <Box sx={{ display: currentTab === 0 ? 'flex' : 'none', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
            <>
              {/* Map with Floating KPI Overlays */}
              <Box 
                sx={{ flexGrow: 1, position: 'relative', bgcolor: 'background.paper', overflow: 'hidden' }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Floating KPI Cards - Translucent Overlay */}
                <Box sx={{ 
                  position: 'absolute', 
                  top: LAYOUT.KPI_TOP, 
                  left: LAYOUT.KPI_TOP, 
                  right: LAYOUT.KPI_TOP, 
                  zIndex: 10,
                  display: 'flex',
                  gap: 1,
                  flexWrap: 'wrap',
                  pointerEvents: 'none'
                }}>
                  <Box sx={{ flex: '1 1 auto', minWidth: 120, maxWidth: 160, pointerEvents: 'auto' }}>
                    <KPICard 
                      title="SAIDI" 
                      value={kpis.saidi.toFixed(1)} 
                      subtitle="Minutes" 
                      icon={<Assessment />} 
                      color="#0EA5E9" 
                      trend={-5.2}
                      sx={{ bgcolor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 auto', minWidth: 120, maxWidth: 160, pointerEvents: 'auto' }}>
                    <KPICard 
                      title="SAIFI" 
                      value={kpis.saifi.toFixed(2)} 
                      subtitle="Interruptions" 
                      icon={<TrendingUp />} 
                      color="#FBBF24" 
                      trend={-2.1}
                      sx={{ bgcolor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 auto', minWidth: 120, maxWidth: 160, pointerEvents: 'auto' }}>
                    <KPICard 
                      title="Active Outages" 
                      value={kpis.activeOutages} 
                      subtitle="Critical Cells" 
                      icon={<Warning />} 
                      color="#EF4444"
                      sx={{ bgcolor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 auto', minWidth: 120, maxWidth: 160, pointerEvents: 'auto' }}>
                    <KPICard 
                      title="Asset Health" 
                      value={`${kpis.assetHealth.toFixed(1)}%`} 
                      subtitle="Avg Score" 
                      icon={<Memory />} 
                      color="#10B981"
                      sx={{ bgcolor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 auto', minWidth: 140, maxWidth: 180, pointerEvents: 'auto' }}>
                    <KPICard 
                      title="Operational Margin" 
                      value={`${kpis.operationalMargin.toFixed(1)}%`} 
                      subtitle="Healthy Capacity" 
                      icon={<NetworkCheck />} 
                      color={kpis.operationalMargin > 70 ? '#22C55E' : kpis.operationalMargin > 50 ? '#FBBF24' : '#EF4444'}
                      sx={{ bgcolor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 auto', minWidth: 140, maxWidth: 180, pointerEvents: 'auto' }}>
                    <KPICard 
                      title="Stress-Aware Reliability" 
                      value={`${kpis.stressAwareReliability.toFixed(1)}%`} 
                      subtitle="Health + Headroom" 
                      icon={<Assessment />} 
                      color={kpis.stressAwareReliability > 75 ? '#06B6D4' : kpis.stressAwareReliability > 60 ? '#FBBF24' : '#EF4444'}
                      sx={{ bgcolor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </Box>
                </Box>

                {/* Layer Toggle Buttons - Top Right */}
                <Box sx={{ 
                  position: 'absolute', 
                  top: LAYOUT.LAYERS_TOP, 
                  right: LAYOUT.LAYERS_TOP, 
                  zIndex: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  pointerEvents: 'auto'
                }}>
                  <Paper sx={{ 
                    bgcolor: 'rgba(15, 23, 42, 0.35)', 
                    backdropFilter: 'blur(16px)', 
                    border: '1px solid rgba(255,255,255,0.08)',
                    p: 1.5,
                    minWidth: 160,
                    maxHeight: '80vh',
                    overflowY: 'auto'
                  }}>
                    <Stack spacing={0.5}>
                      {/* Expandable Header */}
                      <Box 
                        sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          px: 0.5,
                          py: 0.25,
                          borderRadius: 1,
                          '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }
                        }}
                        onClick={() => setLayersPanelExpanded(!layersPanelExpanded)}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Layers sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                            LAYERS
                          </Typography>
                        </Box>
                        <IconButton size="small" sx={{ p: 0 }}>
                          {layersPanelExpanded ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                        </IconButton>
                      </Box>
                      
                      <Collapse in={layersPanelExpanded}>
                        <Stack spacing={0.5}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, substations: !layersVisible.substations})}
                          sx={{ 
                            color: layersVisible.substations ? '#00C8FF' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(0, 200, 255, 0.1)' }
                          }}
                        >
                          <ElectricBolt sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="caption" sx={{ color: layersVisible.substations ? '#00C8FF' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                            Substations
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                            {assetCounts.substations.toLocaleString()} assets
                          </Typography>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, transformers: !layersVisible.transformers})}
                          sx={{ 
                            color: layersVisible.transformers ? '#EC4899' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(236, 72, 153, 0.1)' }
                          }}
                        >
                          <Power sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="caption" sx={{ color: layersVisible.transformers ? '#EC4899' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                            Transformers
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                            {assetCounts.transformers.toLocaleString()} assets
                          </Typography>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, poles: !layersVisible.poles})}
                          sx={{ 
                            color: layersVisible.poles ? '#8880ff' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(136, 128, 255, 0.1)' }
                          }}
                        >
                          <Engineering sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="caption" sx={{ color: layersVisible.poles ? '#8880ff' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                            Poles
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                            {assetCounts.poles.toLocaleString()} assets
                          </Typography>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, meters: !layersVisible.meters})}
                          sx={{ 
                            color: layersVisible.meters ? '#9333EA' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(147, 51, 234, 0.1)' }
                          }}
                        >
                          <Speed sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="caption" sx={{ color: layersVisible.meters ? '#9333EA' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                            Meters
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                            {assetCounts.meters.toLocaleString()} assets
                          </Typography>
                        </Box>
                      </Box>

                      <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.08)' }} />

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, connections: !layersVisible.connections})}
                          sx={{ 
                            color: layersVisible.connections ? '#10B981' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.1)' }
                          }}
                        >
                          <NetworkCheck sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Typography variant="caption" sx={{ color: layersVisible.connections ? '#10B981' : 'rgba(255,255,255,0.5)', minWidth: 80 }}>
                          Connections
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, heatmap: !layersVisible.heatmap})}
                          sx={{ 
                            color: layersVisible.heatmap ? '#F59E0B' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(245, 158, 11, 0.1)' }
                          }}
                        >
                          <Whatshot sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Typography variant="caption" sx={{ color: layersVisible.heatmap ? '#F59E0B' : 'rgba(255,255,255,0.5)', minWidth: 80 }}>
                          Heatmap
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton 
                          size="small"
                          onClick={() => setLayersVisible({...layersVisible, weather: !layersVisible.weather})}
                          sx={{ 
                            color: layersVisible.weather ? '#10B981' : 'rgba(255,255,255,0.3)',
                            '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.1)' }
                          }}
                        >
                          <WbSunny sx={{ fontSize: 18 }} />
                        </IconButton>
                        <Typography variant="caption" sx={{ color: layersVisible.weather ? '#10B981' : 'rgba(255,255,255,0.5)', minWidth: 80 }}>
                          Weather
                        </Typography>
                      </Box>
                      
                      {/* Weather Timeline Controls */}
                      {layersVisible.weather && weather.length > 0 && (
                        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                          <Stack spacing={1}>
                            {/* Current Date/Time Display */}
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: 9 }}>
                              {weather[weatherTimelineIndex]?.TIMESTAMP || 'Loading...'}
                            </Typography>
                            
                            {/* Temperature & Humidity Display */}
                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Thermostat sx={{ fontSize: 14, color: '#FBBF24' }} />
                                <Typography variant="caption" sx={{ color: '#FBBF24', fontSize: 10 }}>
                                  {weather[weatherTimelineIndex]?.TEMP_F?.toFixed(1) || '--'}°F
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Opacity sx={{ fontSize: 14, color: '#3B82F6' }} />
                                <Typography variant="caption" sx={{ color: '#3B82F6', fontSize: 10 }}>
                                  {weather[weatherTimelineIndex]?.HUMIDITY_PCT?.toFixed(0) || '--'}%
                                </Typography>
                              </Box>
                            </Box>

                            {/* Timeline Scrubber */}
                            <Box>
                              <input
                                type="range"
                                min="0"
                                max={weather.length - 1}
                                value={weatherTimelineIndex}
                                onChange={(e) => {
                                  setWeatherTimelineIndex(parseInt(e.target.value));
                                  setIsWeatherPlaying(false);
                                }}
                                style={{
                                  width: '100%',
                                  height: '4px',
                                  accentColor: '#10B981',
                                  cursor: 'pointer'
                                }}
                              />
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
                                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 8 }}>
                                  Jul 1
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 8 }}>
                                  {weatherTimelineIndex + 1}/{weather.length}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 8 }}>
                                  Aug 31
                                </Typography>
                              </Box>
                            </Box>

                            {/* Playback Controls */}
                            <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'center', alignItems: 'center' }}>
                              <IconButton 
                                size="small" 
                                onClick={() => setWeatherTimelineIndex(Math.max(0, weatherTimelineIndex - 24))}
                                sx={{ color: '#10B981', p: 0.5 }}
                              >
                                <SkipPrevious sx={{ fontSize: 16 }} />
                              </IconButton>
                              
                              <IconButton 
                                size="small" 
                                onClick={() => setWeatherTimelineIndex(Math.max(0, weatherTimelineIndex - 1))}
                                sx={{ color: '#10B981', p: 0.5 }}
                              >
                                <FastRewind sx={{ fontSize: 16 }} />
                              </IconButton>
                              
                              <IconButton 
                                size="small"
                                onClick={() => setIsWeatherPlaying(!isWeatherPlaying)}
                                sx={{ color: '#10B981', bgcolor: 'rgba(16, 185, 129, 0.1)', p: 0.5 }}
                              >
                                {isWeatherPlaying ? <Pause sx={{ fontSize: 16 }} /> : <PlayArrow sx={{ fontSize: 16 }} />}
                              </IconButton>
                              
                              <IconButton 
                                size="small" 
                                onClick={() => setWeatherTimelineIndex(Math.min(weather.length - 1, weatherTimelineIndex + 1))}
                                sx={{ color: '#10B981', p: 0.5 }}
                              >
                                <FastForward sx={{ fontSize: 16 }} />
                              </IconButton>
                              
                              <IconButton 
                                size="small" 
                                onClick={() => setWeatherTimelineIndex(Math.min(weather.length - 1, weatherTimelineIndex + 24))}
                                sx={{ color: '#10B981', p: 0.5 }}
                              >
                                <SkipNext sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Box>

                            {/* Speed Control */}
                            <Box>
                              <Typography variant="caption" sx={{ display: 'block', mb: 0.25, color: 'text.secondary', fontSize: 9 }}>
                                Speed: {weatherSpeed}x hr/sec
                              </Typography>
                              <input
                                type="range"
                                min="1"
                                max="24"
                                value={weatherSpeed}
                                onChange={(e) => setWeatherSpeed(parseInt(e.target.value))}
                                style={{
                                  width: '100%',
                                  height: '4px',
                                  accentColor: '#10B981',
                                  cursor: 'pointer'
                                }}
                              />
                            </Box>
                          </Stack>
                        </Box>
                      )}
                        </Stack>
                      </Collapse>
                    </Stack>
                  </Paper>

                  {/* PostGIS Spatial Layers Panel */}
                  <Paper 
                    sx={{ 
                      bgcolor: 'rgba(15, 23, 42, 0.92)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(249, 115, 22, 0.3)',
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                      borderRadius: 1.5,
                      p: 1.5,
                      mt: 1
                    }}
                  >
                    <Stack spacing={1}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Hub sx={{ fontSize: 16, color: '#F97316' }} />
                          <Typography variant="caption" sx={{ fontWeight: 600, color: '#F97316' }}>
                            POSTGIS LAYERS
                          </Typography>
                        </Box>
                        <IconButton 
                          size="small" 
                          onClick={() => setSpatialPanelExpanded(!spatialPanelExpanded)}
                          sx={{ p: 0.25, color: 'text.secondary' }}
                        >
                          {spatialPanelExpanded ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                        </IconButton>
                      </Box>
                      
                      <Collapse in={spatialPanelExpanded}>
                        <Stack spacing={0.5}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                            <IconButton 
                              size="small"
                              onClick={() => setLayersVisible({...layersVisible, buildingFootprints: !layersVisible.buildingFootprints})}
                              sx={{ 
                                color: layersVisible.buildingFootprints ? '#F97316' : 'rgba(255,255,255,0.3)',
                                '&:hover': { bgcolor: 'rgba(249, 115, 22, 0.1)' }
                              }}
                            >
                              <Business sx={{ fontSize: 18 }} />
                            </IconButton>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="caption" sx={{ color: layersVisible.buildingFootprints ? '#F97316' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                                Buildings (MVT)
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                                2.67M footprints
                              </Typography>
                            </Box>
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                            <IconButton 
                              size="small"
                              onClick={() => setLayersVisible({...layersVisible, powerLines: !layersVisible.powerLines})}
                              disabled={spatialLoading.powerLines}
                              sx={{ 
                                color: layersVisible.powerLines ? '#FBBF24' : 'rgba(255,255,255,0.3)',
                                '&:hover': { bgcolor: 'rgba(251, 191, 36, 0.1)' }
                              }}
                            >
                              <ElectricalServices sx={{ fontSize: 18 }} />
                            </IconButton>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="caption" sx={{ color: layersVisible.powerLines ? '#FBBF24' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                                Power Lines
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                                {spatialLoading.powerLines ? 'Loading...' : `${spatialData.powerLines.length.toLocaleString()} segments`}
                              </Typography>
                            </Box>
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                            <IconButton 
                              size="small"
                              onClick={() => setLayersVisible({...layersVisible, vegetation: !layersVisible.vegetation})}
                              disabled={spatialLoading.vegetation}
                              sx={{ 
                                color: layersVisible.vegetation ? '#22C55E' : 'rgba(255,255,255,0.3)',
                                '&:hover': { bgcolor: 'rgba(34, 197, 94, 0.1)' }
                              }}
                            >
                              <Park sx={{ fontSize: 18 }} />
                            </IconButton>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="caption" sx={{ color: layersVisible.vegetation ? '#22C55E' : 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1.2 }}>
                                Vegetation Risk
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block', mt: 0.25 }}>
                                {spatialLoading.vegetation ? 'Loading...' : `${spatialData.vegetation.length.toLocaleString()} risk points`}
                              </Typography>
                            </Box>
                          </Box>
                        </Stack>
                      </Collapse>
                    </Stack>
                  </Paper>
                </Box>
                
                {/* Distance & Zoom Indicators - Bottom Left */}
                <Box sx={{ position: 'absolute', bottom: LAYOUT.ZOOM_BOTTOM, left: LAYOUT.ZOOM_LEFT, zIndex: 1000 }}>
                  <Stack spacing={0.5}>
                    {/* Zoom Level Indicator */}
                    <Paper 
                      sx={{ 
                        bgcolor: 'rgba(15, 23, 42, 0.92)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(41, 181, 232, 0.3)',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                        borderRadius: 1.5,
                        px: 1.5,
                        py: 1
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <ZoomIn sx={{ fontSize: 18, color: '#29B5E8' }} />
                        <Box>
                          <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', display: 'block', lineHeight: 1 }}>
                            Zoom Level
                          </Typography>
                          <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700, color: '#29B5E8', lineHeight: 1.2 }}>
                            {viewState.zoom.toFixed(1)}
                          </Typography>
                        </Box>
                      </Stack>
                    </Paper>
                    
                    {/* Distance from Start Indicator */}
                    <Paper 
                      sx={{ 
                        bgcolor: 'rgba(15, 23, 42, 0.92)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(251, 191, 36, 0.3)',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                        borderRadius: 1.5,
                        px: 1.5,
                        py: 1
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <MyLocation sx={{ fontSize: 18, color: '#FBBF24' }} />
                        <Box>
                          <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', display: 'block', lineHeight: 1 }}>
                            Distance
                          </Typography>
                          <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700, color: '#FBBF24', lineHeight: 1.2 }}>
                            {distanceFromStart < 1 
                              ? `${(distanceFromStart * 1000).toFixed(0)}m`
                              : `${distanceFromStart.toFixed(1)}km`
                            }
                          </Typography>
                        </Box>
                      </Stack>
                    </Paper>
                  </Stack>
                </Box>
                
                <DeckGL
                  initialViewState={viewState}
                  controller={{
                    dragPan: true,
                    dragRotate: true,
                    scrollZoom: true,
                    touchZoom: true,
                    touchRotate: true,
                    keyboard: true,
                    doubleClickZoom: false,
                    inertia: 1200,
                    dragPanSpeed: 0.8,
                    scrollZoomSpeed: 0.01,
                    touchZoomSpeed: 0.01
                  }}
                  onViewStateChange={({viewState}: {viewState: any}) => {
                    // Normalize longitude to prevent wrapping issues
                    let normalizedLongitude = viewState.longitude;
                    if (normalizedLongitude !== undefined) {
                      while (normalizedLongitude > 180) normalizedLongitude -= 360;
                      while (normalizedLongitude < -180) normalizedLongitude += 360;
                    }
                    
                    const normalizedViewState = {
                      ...viewState,
                      longitude: normalizedLongitude
                    };
                    
                    // Throttle viewport updates to avoid performance violations
                    // Use queueMicrotask to defer setState outside of DeckGL's render cycle
                    // This prevents "Cannot update a component while rendering another component" warning
                    pendingViewState.current = normalizedViewState;
                    
                    if (!viewportUpdateTimer.current) {
                      // Defer state update to next microtask to avoid React render warning
                      queueMicrotask(() => {
                        setViewState(normalizedViewState);
                      });
                      
                      // Throttle subsequent updates during continuous interaction
                      viewportUpdateTimer.current = setTimeout(() => {
                        if (pendingViewState.current) {
                          setViewState(pendingViewState.current);
                        }
                        viewportUpdateTimer.current = null;
                      }, 16); // ~60fps throttle
                    }
                  }}
                  onClick={(info) => {
                    const now = Date.now();
                    const timeSinceLastClick = now - lastClickTime;
                    const clickCoords: [number, number] = info.coordinate ? [info.coordinate[0], info.coordinate[1]] : [0, 0];
                    
                    // Check if this is a double-click (within 300ms and close proximity)
                    const isDoubleClick = timeSinceLastClick < 300 && 
                      lastClickCoords && 
                      Math.abs(lastClickCoords[0] - clickCoords[0]) < 0.01 &&
                      Math.abs(lastClickCoords[1] - clickCoords[1]) < 0.01;
                    
                    if (isDoubleClick) {
                      // Handle double-click zoom
                      handleDoubleClick(info);
                      // Reset click tracking
                      setLastClickTime(0);
                      setLastClickCoords(null);
                    } else {
                      // Single click - handle selection
                      if (!info.object) {
                        // Click on empty space (no asset clicked) clears selection
                        setSelectedAsset(null);
                        setSelectedAssetPosition(null);
                      }
                      // Update click tracking
                      setLastClickTime(now);
                      setLastClickCoords(clickCoords);
                    }
                  }}
                  onHover={(info) => {
                    // Optional: Could add hover effects here
                  }}
                  layers={layers}
                  glOptions={{
                    preserveDrawingBuffer: false,
                    antialias: true,
                    depth: true
                  }}
                  useDevicePixels={typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 2 : 1}
                  getTooltip={() => null}
                >
                  <MapGL
                    {...viewState}
                    mapLib={maplibregl}
                    mapStyle={BASEMAP_URL}
                    reuseMaps
                    renderWorldCopies={false}
                    attributionControl={false}
                    interactive={false}
                  />
                </DeckGL>

                {/* Pinned Asset Cards - OPTIMIZED: translate3d GPU acceleration, pointer-events optimization */}
                {pinnedAssets.map((pinned) => {
                  const handleMouseDown = (e: React.MouseEvent) => {
                    if ((e.target as HTMLElement).closest('.drag-handle')) {
                      e.preventDefault();
                      setDraggedCardId(pinned.id);
                      setDragOffset({
                        x: e.clientX - pinned.position.x,
                        y: e.clientY - pinned.position.y
                      });
                    }
                  };

                  const isDragging = draggedCardId === pinned.id;
                  
                  // Pre-compute values to avoid inline calculations (performance optimization)
                  const borderColor = pinned.asset.type === 'aggregate' ? (
                    pinned.asset.worstStatus === 'critical' ? '#EF4444' :
                    pinned.asset.worstStatus === 'warning' ? '#FBBF24' :
                    '#22C55E'
                  ) :
                  pinned.asset.type === 'substation' ? '#00C8FF' :
                  pinned.asset.type === 'transformer' ? '#A855F7' :
                  pinned.asset.type === 'pole' ? '#8880ff' : '#9333EA';
                  
                  const transformX = Math.min(pinned.position.x, window.innerWidth - 420);
                  const zIndex = isDragging ? 1002 : 1001;

                  return (
                    <Fade key={pinned.id} in={true}>
                      <Paper 
                        onMouseDown={handleMouseDown}
                        sx={{ 
                          position: 'absolute', 
                          left: 0,
                          top: 0,
                          transform: `translate3d(${transformX}px, ${pinned.position.y}px, 0)`,
                          willChange: isDragging ? 'transform' : undefined,
                          pointerEvents: isDragging ? 'auto' : 'auto',
                          p: 3, 
                          width: 360,
                          maxHeight: 'calc(100vh - 40px)',
                          overflowY: 'auto',
                          overflowX: 'hidden',
                          bgcolor: alpha('#1E293B', 0.80),
                          backdropFilter: 'blur(12px)',
                          zIndex,
                          borderLeft: `4px solid ${borderColor}`,
                          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                          cursor: isDragging ? 'grabbing' : 'default',
                          userSelect: 'text',
                          wordWrap: 'break-word',
                          // CRITICAL OPTIMIZATIONS for drag performance
                          contain: 'layout style paint',  // CSS containment - isolates rendering
                          '&::-webkit-scrollbar': {
                            width: '8px',
                          },
                          '&::-webkit-scrollbar-track': {
                            bgcolor: alpha('#000', 0.2),
                          },
                          '&::-webkit-scrollbar-thumb': {
                            bgcolor: alpha('#fff', 0.3),
                            borderRadius: '4px',
                            '&:hover': {
                              bgcolor: alpha('#fff', 0.4),
                            },
                          },
                        }}
                      >
                        <Box className="drag-handle" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, cursor: 'grab', '&:active': { cursor: 'grabbing' } }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            {pinned.asset.type === 'aggregate' && <Assessment sx={{ 
                              color: pinned.asset.worstStatus === 'critical' ? '#EF4444' :
                                     pinned.asset.worstStatus === 'warning' ? '#FBBF24' : '#22C55E',
                              fontSize: 28 
                            }} />}
                            {pinned.asset.type === 'substation' && <ElectricBolt sx={{ color: '#00C8FF', fontSize: 28 }} />}
                            {pinned.asset.type === 'transformer' && <Assessment sx={{ color: '#EC4899', fontSize: 28 }} />}
                            {pinned.asset.type === 'pole' && <Engineering sx={{ color: '#8880ff', fontSize: 28 }} />}
                            {pinned.asset.type === 'meter' && <Speed sx={{ color: '#9333EA', fontSize: 28 }} />}
                            <Box>
                              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{pinned.asset.name}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>
                                {pinned.asset.id}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Tooltip title={pinned.collapsed ? "Expand card" : "Collapse card"}>
                              <IconButton 
                                size="small" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPinnedAssets(prev => prev.map(p => 
                                    p.id === pinned.id ? { ...p, collapsed: !p.collapsed } : p
                                  ));
                                }}
                              >
                                {pinned.collapsed ? <ExpandMore sx={{ fontSize: 18 }} /> : <ExpandLess sx={{ fontSize: 18 }} />}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Pinned - Click to unpin">
                              <IconButton 
                                size="small" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPinnedAssets(prev => prev.filter(p => p.id !== pinned.id));
                                }}
                                sx={{ color: '#FBBF24' }}
                              >
                                <PushPin sx={{ fontSize: 18 }} />
                              </IconButton>
                            </Tooltip>
                            <IconButton 
                              size="small" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setPinnedAssets(prev => prev.filter(p => p.id !== pinned.id));
                              }}
                            >
                              <Close sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Box>
                        </Box>

                        <Chip 
                          label={pinned.asset.type.toUpperCase()} 
                          size="small" 
                          sx={{ mb: 2, fontWeight: 700, letterSpacing: 0.5 }} 
                        />

                        <Collapse in={!pinned.collapsed}>
                        <Stack spacing={2} divider={<Divider />}>
                          {pinned.asset.type === 'aggregate' && (
                            <>
                              <Stack direction="row" spacing={1}>
                                <Tooltip title="Center map on this cell">
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<MyLocation />}
                                    onClick={() => flyToAsset(pinned.asset.longitude, pinned.asset.latitude, 12)}
                                    sx={{ flex: 1, fontSize: 11 }}
                                  >
                                    Center
                                  </Button>
                                </Tooltip>
                                <Tooltip title="Zoom to see individual assets">
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<ZoomIn />}
                                    onClick={() => flyToAsset(pinned.asset.longitude, pinned.asset.latitude, 13)}
                                    sx={{ flex: 1, fontSize: 11 }}
                                  >
                                    Zoom In
                                  </Button>
                                </Tooltip>
                              </Stack>

                              {pinned.asset.worstStatus === 'critical' && (
                                <Paper sx={{ 
                                  p: 1.5, 
                                  bgcolor: alpha('#EF4444', 0.1), 
                                  border: '1px solid',
                                  borderColor: alpha('#EF4444', 0.3)
                                }}>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Warning sx={{ color: '#EF4444', fontSize: 20 }} />
                                    <Box>
                                      <Typography variant="caption" fontWeight={700} color="#EF4444">
                                        CRITICAL AREA
                                      </Typography>
                                      <Typography variant="caption" display="block" color="text.secondary">
                                        Requires immediate attention
                                      </Typography>
                                    </Box>
                                  </Stack>
                                </Paper>
                              )}

                              <Box>
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                  <GridOn sx={{ fontSize: 16, color: 'text.secondary' }} />
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    INFRASTRUCTURE SUMMARY
                                  </Typography>
                                </Stack>
                                <Stack spacing={1}>
                                  {/* Substations - Expandable */}
                                  <Box>
                                    <Box 
                                      sx={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        cursor: pinned.asset.substations?.length > 0 ? 'pointer' : 'default',
                                        '&:hover': pinned.asset.substations?.length > 0 ? { bgcolor: alpha('#fff', 0.03) } : {},
                                        p: 0.5,
                                        borderRadius: 1,
                                        transition: 'background-color 0.2s'
                                      }}
                                      onClick={() => {
                                        if (pinned.asset.substations?.length > 0) {
                                          setExpandedAssetCategories(prev => ({
                                            ...prev,
                                            [pinned.id]: {
                                              ...(prev[pinned.id] || {}),
                                              substations: !prev[pinned.id]?.substations,
                                              transformers: prev[pinned.id]?.transformers || false,
                                              poles: prev[pinned.id]?.poles || false,
                                              meters: prev[pinned.id]?.meters || false
                                            }
                                          }));
                                        }
                                      }}
                                    >
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="body2" color="text.secondary">Substations</Typography>
                                        {pinned.asset.substations?.length > 0 && (
                                          <IconButton size="small" sx={{ p: 0 }}>
                                            {expandedAssetCategories[pinned.id]?.substations ? 
                                              <ExpandLess sx={{ fontSize: 16 }} /> : 
                                              <ExpandMore sx={{ fontSize: 16 }} />
                                            }
                                          </IconButton>
                                        )}
                                      </Box>
                                      <Chip label={pinned.asset.substationCount || 0} size="small" sx={{ bgcolor: COLORS.substation.chip, color: '#00C8FF' }} />
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories[pinned.id]?.substations}>
                                      {expandedAssetCategories[pinned.id]?.substations && (
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 200, overflowY: 'auto' }}>
                                          {(() => {
                                            const { visibleItems, hasMore, totalCount } = getPaginatedItems(
                                              pinned.asset.substations, 
                                              pinned.id, 
                                              'substations'
                                            );
                                            return (
                                              <>
                                                {visibleItems.map((substation: Asset) => (
                                                  <Box 
                                                  key={substation.id} 
                                                  onClick={() => {
                                                    setSelectedAsset({
                                                      ...substation,
                                                      type: 'substation',
                                                      name: substation.name || substation.id,
                                                      latitude: substation.latitude || substation.coords?.[1],
                                                      longitude: substation.longitude || substation.coords?.[0]
                                                    });
                                                    flyToAsset(
                                                      substation.longitude || substation.coords?.[0],
                                                      substation.latitude || substation.coords?.[1],
                                                      15
                                                    );
                                                  }}
                                                  sx={{ 
                                                    p: 1, 
                                                    bgcolor: alpha('#00C8FF', 0.05), 
                                                    borderLeft: `2px solid ${alpha('#00C8FF', 0.3)}`,
                                                    borderRadius: 1,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    contentVisibility: 'auto',
                                                    containIntrinsicSize: 'auto 60px',
                                                    '&:hover': {
                                                      bgcolor: COLORS.substation.chip,
                                                      transform: 'translateX(4px)'
                                                    }
                                                  }}
                                                >
                                                  <Typography variant="caption" fontWeight={600} color="#00C8FF" display="block">
                                                    {substation.name || substation.id}
                                                  </Typography>
                                                  <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'text.secondary' }}>
                                                    ID: {substation.id}
                                                  </Typography>
                                                  {substation.health_score !== undefined && (
                                                    <Typography variant="caption" display="block" sx={{ fontSize: 9 }}>
                                                      Health: {substation.health_score}%
                                                    </Typography>
                                                  )}
                                                </Box>
                                              ))}
                                              {hasMore && (
                                                <Button 
                                                  size="small" 
                                                  onClick={() => loadMoreItems(pinned.id, 'substations')}
                                                  sx={{ 
                                                    mt: 0.5, 
                                                    fontSize: 10,
                                                    bgcolor: alpha('#00C8FF', 0.1),
                                                    '&:hover': { bgcolor: alpha('#00C8FF', 0.2) }
                                                  }}
                                                >
                                                  Load More ({visibleItems.length} of {totalCount})
                                                </Button>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </Stack>
                                      )}
                                    </Collapse>
                                  </Box>

                                  {/* Transformers - Expandable */}
                                  <Box>
                                    <Box 
                                      sx={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        cursor: pinned.asset.transformers?.length > 0 ? 'pointer' : 'default',
                                        '&:hover': pinned.asset.transformers?.length > 0 ? { bgcolor: alpha('#fff', 0.03) } : {},
                                        p: 0.5,
                                        borderRadius: 1,
                                        transition: 'background-color 0.2s'
                                      }}
                                      onClick={() => {
                                        if (pinned.asset.transformers?.length > 0) {
                                          setExpandedAssetCategories(prev => ({
                                            ...prev,
                                            [pinned.id]: {
                                              ...(prev[pinned.id] || {}),
                                              substations: prev[pinned.id]?.substations || false,
                                              transformers: !prev[pinned.id]?.transformers,
                                              poles: prev[pinned.id]?.poles || false,
                                              meters: prev[pinned.id]?.meters || false
                                            }
                                          }));
                                        }
                                      }}
                                    >
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="body2" color="text.secondary">Transformers</Typography>
                                        {pinned.asset.transformers?.length > 0 && (
                                          <IconButton size="small" sx={{ p: 0 }}>
                                            {expandedAssetCategories[pinned.id]?.transformers ? 
                                              <ExpandLess sx={{ fontSize: 16 }} /> : 
                                              <ExpandMore sx={{ fontSize: 16 }} />
                                            }
                                          </IconButton>
                                        )}
                                      </Box>
                                      <Chip label={pinned.asset.transformerCount || 0} size="small" sx={{ bgcolor: COLORS.transformer.chip, color: '#EC4899' }} />
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories[pinned.id]?.transformers}>
                                      {expandedAssetCategories[pinned.id]?.transformers && (
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 200, overflowY: 'auto' }}>
                                          {(() => {
                                          const { visibleItems, hasMore, totalCount } = getPaginatedItems(
                                            pinned.asset.transformers, 
                                            pinned.id, 
                                            'transformers'
                                          );
                                          return (
                                            <>
                                              {visibleItems.map((transformer: Asset) => (
                                                <Box 
                                                  key={transformer.id}
                                                  onClick={() => {
                                                    setSelectedAsset({
                                                      ...transformer,
                                                      type: 'transformer',
                                                      name: transformer.name || transformer.id,
                                                      latitude: transformer.latitude || transformer.coords?.[1],
                                                      longitude: transformer.longitude || transformer.coords?.[0]
                                                    });
                                                    flyToAsset(
                                                      transformer.longitude || transformer.coords?.[0],
                                                      transformer.latitude || transformer.coords?.[1],
                                                      15
                                                    );
                                                  }}
                                                  sx={{ 
                                                    p: 1, 
                                                    bgcolor: alpha('#EC4899', 0.05), 
                                                    borderLeft: `2px solid ${alpha('#EC4899', 0.3)}`,
                                                    borderRadius: 1,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    contentVisibility: 'auto',
                                                    containIntrinsicSize: 'auto 60px',
                                                    '&:hover': {
                                                      bgcolor: COLORS.transformer.chip,
                                                      transform: 'translateX(4px)'
                                                    }
                                                  }}
                                                >
                                                  <Typography variant="caption" fontWeight={600} color="#EC4899" display="block">
                                                    {transformer.name || transformer.id}
                                                  </Typography>
                                                  <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'text.secondary' }}>
                                                    ID: {transformer.id}
                                                  </Typography>
                                                  {transformer.health_score !== undefined && (
                                                    <Typography variant="caption" display="block" sx={{ fontSize: 9 }}>
                                                      Health: {transformer.health_score}%
                                                    </Typography>
                                                  )}
                                                  {transformer.load_percent !== undefined && (
                                                    <Typography variant="caption" display="block" sx={{ fontSize: 9 }}>
                                                      Load: {transformer.load_percent}%
                                                    </Typography>
                                                  )}
                                                </Box>
                                              ))}
                                              {hasMore && (
                                                <Button 
                                                  size="small" 
                                                  onClick={() => loadMoreItems(pinned.id, 'transformers')}
                                                  sx={{ 
                                                    mt: 0.5, 
                                                    fontSize: 10,
                                                    bgcolor: alpha('#EC4899', 0.1),
                                                    '&:hover': { bgcolor: alpha('#EC4899', 0.2) }
                                                  }}
                                                >
                                                  Load More ({visibleItems.length} of {totalCount})
                                                </Button>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </Stack>
                                      )}
                                    </Collapse>
                                  </Box>

                                  {/* Poles - Expandable */}
                                  <Box>
                                    <Box 
                                      sx={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center',
                                        cursor: pinned.asset.poles?.length > 0 ? 'pointer' : 'default',
                                        '&:hover': pinned.asset.poles?.length > 0 ? { bgcolor: alpha('#fff', 0.03) } : {},
                                        p: 0.5,
                                        borderRadius: 1,
                                        transition: 'background-color 0.2s'
                                      }}
                                      onClick={() => {
                                        if (pinned.asset.poles?.length > 0) {
                                          setExpandedAssetCategories(prev => ({
                                            ...prev,
                                            [pinned.id]: {
                                              ...(prev[pinned.id] || {}),
                                              substations: prev[pinned.id]?.substations || false,
                                              transformers: prev[pinned.id]?.transformers || false,
                                              poles: !prev[pinned.id]?.poles,
                                              meters: prev[pinned.id]?.meters || false
                                            }
                                          }));
                                        }
                                      }}
                                    >
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="body2" color="text.secondary">Poles</Typography>
                                        {pinned.asset.poles?.length > 0 && (
                                          <IconButton size="small" sx={{ p: 0 }}>
                                            {expandedAssetCategories[pinned.id]?.poles ? 
                                              <ExpandLess sx={{ fontSize: 16 }} /> : 
                                              <ExpandMore sx={{ fontSize: 16 }} />
                                            }
                                          </IconButton>
                                        )}
                                      </Box>
                                      <Chip label={pinned.asset.poleCount || 0} size="small" sx={{ bgcolor: COLORS.pole.chip, color: '#8880ff' }} />
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories[pinned.id]?.poles}>
                                      {expandedAssetCategories[pinned.id]?.poles && (
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 200, overflowY: 'auto' }}>
                                          {(() => {
                                          const { visibleItems, hasMore, totalCount } = getPaginatedItems(
                                            pinned.asset.poles, 
                                            pinned.id, 
                                            'poles'
                                          );
                                          return (
                                            <>
                                              {visibleItems.map((pole: Asset) => (
                                                <Box 
                                                  key={pole.id}
                                                  onClick={() => {
                                                    setSelectedAsset({
                                                      ...pole,
                                                      type: 'pole',
                                                      name: pole.name || pole.id,
                                                      latitude: pole.latitude || pole.coords?.[1],
                                                      longitude: pole.longitude || pole.coords?.[0]
                                                    });
                                                    flyToAsset(
                                                      pole.longitude || pole.coords?.[0],
                                                      pole.latitude || pole.coords?.[1],
                                                      15
                                                    );
                                                  }}
                                                  sx={{ 
                                                    p: 1, 
                                                    bgcolor: alpha('#8880ff', 0.05), 
                                                    borderLeft: `2px solid ${alpha('#8880ff', 0.3)}`,
                                                    borderRadius: 1,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    contentVisibility: 'auto',
                                                    containIntrinsicSize: 'auto 60px',
                                                    '&:hover': {
                                                      bgcolor: COLORS.pole.chip,
                                                      transform: 'translateX(4px)'
                                                    }
                                                  }}
                                                >
                                                  <Typography variant="caption" fontWeight={600} color="#8880ff" display="block">
                                                    {pole.name || pole.id}
                                                  </Typography>
                                                  <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'text.secondary' }}>
                                                    ID: {pole.id}
                                                  </Typography>
                                                  {pole.health_score !== undefined && (
                                                    <Typography variant="caption" display="block" sx={{ fontSize: 9 }}>
                                                      Health: {pole.health_score}%
                                                    </Typography>
                                                  )}
                                                </Box>
                                              ))}
                                              {hasMore && (
                                                <Button 
                                                  size="small" 
                                                  onClick={() => loadMoreItems(pinned.id, 'poles')}
                                                  sx={{ 
                                                    mt: 0.5, 
                                                    fontSize: 10,
                                                    bgcolor: alpha('#8880ff', 0.1),
                                                    '&:hover': { bgcolor: alpha('#8880ff', 0.2) }
                                                  }}
                                                >
                                                  Load More ({visibleItems.length} of {totalCount})
                                                </Button>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </Stack>
                                      )}
                                    </Collapse>
                                  </Box>

                                  {/* Meters - Expandable */}
                                  <Box>
                                    <Box 
                                      sx={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center', 
                                        p: 0.5,
                                        cursor: pinned.asset.meters?.length > 0 ? 'pointer' : 'default',
                                        '&:hover': pinned.asset.meters?.length > 0 ? {
                                          bgcolor: alpha('#9333EA', 0.05)
                                        } : {},
                                        borderRadius: 1,
                                        transition: 'background-color 0.2s'
                                      }}
                                      onClick={() => {
                                        if (pinned.asset.meters?.length > 0) {
                                          setExpandedAssetCategories(prev => ({
                                            ...prev,
                                            [pinned.id]: {
                                              ...(prev[pinned.id] || {}),
                                              substations: prev[pinned.id]?.substations || false,
                                              transformers: prev[pinned.id]?.transformers || false,
                                              poles: prev[pinned.id]?.poles || false,
                                              meters: !prev[pinned.id]?.meters
                                            }
                                          }));
                                        }
                                      }}
                                    >
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="body2" color="text.secondary">Meters</Typography>
                                        {pinned.asset.meters?.length > 0 && (
                                          <IconButton size="small" sx={{ p: 0 }}>
                                            {expandedAssetCategories[pinned.id]?.meters ? 
                                              <ExpandLess sx={{ fontSize: 16 }} /> : 
                                              <ExpandMore sx={{ fontSize: 16 }} />
                                            }
                                          </IconButton>
                                        )}
                                      </Box>
                                      <Chip label={pinned.asset.meterCount || 0} size="small" sx={{ bgcolor: COLORS.meter.chip, color: '#9333EA' }} />
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories[pinned.id]?.meters}>
                                      {expandedAssetCategories[pinned.id]?.meters && (
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 200, overflowY: 'auto' }}>
                                          {(() => {
                                          const { visibleItems, hasMore, totalCount } = getPaginatedItems(
                                            pinned.asset.meters, 
                                            pinned.id, 
                                            'meters'
                                          );
                                          return (
                                            <>
                                              {visibleItems.map((meter: Asset) => (
                                                <Box 
                                                  key={meter.id}
                                                  onClick={() => {
                                                    setSelectedAsset({
                                                      ...meter,
                                                      type: 'meter',
                                                      name: meter.name || meter.id,
                                                      latitude: meter.latitude || meter.coords?.[1],
                                                      longitude: meter.longitude || meter.coords?.[0]
                                                    });
                                                    flyToAsset(
                                                      meter.longitude || meter.coords?.[0],
                                                      meter.latitude || meter.coords?.[1],
                                                      15
                                                    );
                                                  }}
                                                  sx={{ 
                                                    p: 1, 
                                                    bgcolor: alpha('#9333EA', 0.05), 
                                                    borderLeft: `2px solid ${alpha('#9333EA', 0.3)}`,
                                                    borderRadius: 1,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    contentVisibility: 'auto',
                                                    containIntrinsicSize: 'auto 60px',
                                                    '&:hover': {
                                                      bgcolor: COLORS.meter.chip,
                                                      transform: 'translateX(4px)'
                                                    }
                                                  }}
                                                >
                                                  <Typography variant="caption" fontWeight={600} color="#9333EA" display="block">
                                                    {meter.name || meter.id}
                                                  </Typography>
                                                  <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'text.secondary' }}>
                                                    ID: {meter.id}
                                                  </Typography>
                                                  {meter.usage_kwh !== undefined && (
                                                    <Typography variant="caption" display="block" sx={{ fontSize: 9 }}>
                                                      Usage: {meter.usage_kwh} kWh
                                                    </Typography>
                                                  )}
                                                </Box>
                                              ))}
                                              {hasMore && (
                                                <Button 
                                                  size="small" 
                                                  onClick={() => loadMoreItems(pinned.id, 'meters')}
                                                  sx={{ 
                                                    mt: 0.5, 
                                                    fontSize: 10,
                                                    bgcolor: alpha('#9333EA', 0.1),
                                                    '&:hover': { bgcolor: alpha('#9333EA', 0.2) }
                                                  }}
                                                >
                                                  Load More ({visibleItems.length} of {totalCount})
                                                </Button>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </Stack>
                                      )}
                                    </Collapse>
                                  </Box>
                                </Stack>
                              </Box>

                              <Box>
                                <Box
                                  sx={{ cursor: 'pointer', mb: 1 }}
                                  onClick={() => setExpandedSections(prev => ({ ...prev, healthStatus: !prev.healthStatus }))}
                                >
                                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                    <Stack direction="row" spacing={1} alignItems="center">
                                      <FavoriteOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
                                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                        HEALTH STATUS
                                      </Typography>
                                    </Stack>
                                    <IconButton size="small">
                                      {expandedSections.healthStatus ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                                    </IconButton>
                                  </Stack>
                                </Box>
                                
                                <Collapse in={expandedSections.healthStatus}>
                                  <Stack spacing={1}>
                                    {/* Critical Assets - Expandable */}
                                    <Box>
                                      <Box 
                                        sx={{ 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          alignItems: 'center',
                                          cursor: pinned.asset.assetsByHealth?.critical?.length > 0 ? 'pointer' : 'default',
                                          p: 0.5,
                                          borderRadius: 1,
                                          '&:hover': pinned.asset.assetsByHealth?.critical?.length > 0 ? {
                                            bgcolor: alpha('#EF4444', 0.05)
                                          } : {}
                                        }}
                                        onClick={() => {
                                          if (pinned.asset.assetsByHealth?.critical?.length > 0) {
                                            setExpandedAssetCategories(prev => ({
                                              ...prev,
                                              [pinned.id]: {
                                                ...(prev[pinned.id] || {}),
                                                criticalAssets: !prev[pinned.id]?.criticalAssets
                                              }
                                            }));
                                          }
                                        }}
                                      >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="body2" color="text.secondary">Critical Assets</Typography>
                                          {pinned.asset.assetsByHealth?.critical?.length > 0 && (
                                            <IconButton size="small" sx={{ p: 0 }}>
                                              {expandedAssetCategories[pinned.id]?.criticalAssets ? 
                                                <ExpandLess sx={{ fontSize: 16 }} /> : 
                                                <ExpandMore sx={{ fontSize: 16 }} />
                                              }
                                            </IconButton>
                                          )}
                                        </Box>
                                        <Chip label={pinned.asset.criticalCount || 0} size="small" sx={{ bgcolor: COLORS.status.critical.chip, color: '#EF4444' }} />
                                      </Box>
                                      
                                      <Collapse in={expandedAssetCategories[pinned.id]?.criticalAssets}>
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 150, overflowY: 'auto' }}>
                                          {pinned.asset.assetsByHealth?.critical?.map((asset: Asset) => (
                                            <Box 
                                              key={asset.id}
                                              onClick={() => {
                                                setSelectedAsset(asset);
                                                flyToAsset(asset.longitude, asset.latitude, 15);
                                              }}
                                              sx={{ 
                                                p: 1, 
                                                bgcolor: alpha('#EF4444', 0.05), 
                                                borderLeft: `2px solid ${alpha('#EF4444', 0.5)}`,
                                                borderRadius: 1,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                contentVisibility: 'auto',
                                                containIntrinsicSize: 'auto 60px',
                                                '&:hover': {
                                                  bgcolor: COLORS.status.critical.chip,
                                                  transform: 'translateX(4px)'
                                                }
                                              }}
                                            >
                                              <Typography variant="caption" fontWeight={600} color="#EF4444" display="block">
                                                {asset.name || asset.id} ({asset.type})
                                              </Typography>
                                              {asset.health_score !== undefined && (
                                                <Typography variant="caption" display="block" sx={{ fontSize: 9, color: 'text.secondary' }}>
                                                  Health: {asset.health_score}%
                                                </Typography>
                                              )}
                                            </Box>
                                          ))}
                                        </Stack>
                                      </Collapse>
                                    </Box>

                                    {/* Warning Assets - Expandable */}
                                    <Box>
                                      <Box 
                                        sx={{ 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          alignItems: 'center',
                                          cursor: pinned.asset.assetsByHealth?.warning?.length > 0 ? 'pointer' : 'default',
                                          p: 0.5,
                                          borderRadius: 1,
                                          '&:hover': pinned.asset.assetsByHealth?.warning?.length > 0 ? {
                                            bgcolor: alpha('#FBBF24', 0.05)
                                          } : {}
                                        }}
                                        onClick={() => {
                                          if (pinned.asset.assetsByHealth?.warning?.length > 0) {
                                            setExpandedAssetCategories(prev => ({
                                              ...prev,
                                              [pinned.id]: {
                                                ...(prev[pinned.id] || {}),
                                                warningAssets: !prev[pinned.id]?.warningAssets
                                              }
                                            }));
                                          }
                                        }}
                                      >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="body2" color="text.secondary">Warning Assets</Typography>
                                          {pinned.asset.assetsByHealth?.warning?.length > 0 && (
                                            <IconButton size="small" sx={{ p: 0 }}>
                                              {expandedAssetCategories[pinned.id]?.warningAssets ? 
                                                <ExpandLess sx={{ fontSize: 16 }} /> : 
                                                <ExpandMore sx={{ fontSize: 16 }} />
                                              }
                                            </IconButton>
                                          )}
                                        </Box>
                                        <Chip label={pinned.asset.warningCount || 0} size="small" sx={{ bgcolor: COLORS.status.warning.chip, color: '#FBBF24' }} />
                                      </Box>
                                      
                                      <Collapse in={expandedAssetCategories[pinned.id]?.warningAssets}>
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 150, overflowY: 'auto' }}>
                                          {pinned.asset.assetsByHealth?.warning?.map((asset: Asset) => (
                                            <Box 
                                              key={asset.id}
                                              onClick={() => {
                                                setSelectedAsset(asset);
                                                flyToAsset(asset.longitude, asset.latitude, 15);
                                              }}
                                              sx={{ 
                                                p: 1, 
                                                bgcolor: alpha('#FBBF24', 0.05), 
                                                borderLeft: `2px solid ${alpha('#FBBF24', 0.5)}`,
                                                borderRadius: 1,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                contentVisibility: 'auto',
                                                containIntrinsicSize: 'auto 60px',
                                                '&:hover': {
                                                  bgcolor: COLORS.status.warning.chip,
                                                  transform: 'translateX(4px)'
                                                }
                                              }}
                                            >
                                              <Typography variant="caption" fontWeight={600} color="#FBBF24" display="block">
                                                {asset.name || asset.id} ({asset.type})
                                              </Typography>
                                              {asset.health_score !== undefined && (
                                                <Typography variant="caption" display="block" sx={{ fontSize: 9, color: 'text.secondary' }}>
                                                  Health: {asset.health_score}%
                                                </Typography>
                                              )}
                                            </Box>
                                          ))}
                                        </Stack>
                                      </Collapse>
                                    </Box>

                                    {/* Healthy Assets - Expandable */}
                                    <Box>
                                      <Box 
                                        sx={{ 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          alignItems: 'center',
                                          cursor: pinned.asset.assetsByHealth?.healthy?.length > 0 ? 'pointer' : 'default',
                                          p: 0.5,
                                          borderRadius: 1,
                                          '&:hover': pinned.asset.assetsByHealth?.healthy?.length > 0 ? {
                                            bgcolor: alpha('#22C55E', 0.05)
                                          } : {}
                                        }}
                                        onClick={() => {
                                          if (pinned.asset.assetsByHealth?.healthy?.length > 0) {
                                            setExpandedAssetCategories(prev => ({
                                              ...prev,
                                              [pinned.id]: {
                                                ...(prev[pinned.id] || {}),
                                                healthyAssets: !prev[pinned.id]?.healthyAssets
                                              }
                                            }));
                                          }
                                        }}
                                      >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="body2" color="text.secondary">Healthy Assets</Typography>
                                          {pinned.asset.assetsByHealth?.healthy?.length > 0 && (
                                            <IconButton size="small" sx={{ p: 0 }}>
                                              {expandedAssetCategories[pinned.id]?.healthyAssets ? 
                                                <ExpandLess sx={{ fontSize: 16 }} /> : 
                                                <ExpandMore sx={{ fontSize: 16 }} />
                                              }
                                            </IconButton>
                                          )}
                                        </Box>
                                        <Chip label={pinned.asset.healthyCount || 0} size="small" sx={{ bgcolor: COLORS.status.healthy.chip, color: '#22C55E' }} />
                                      </Box>
                                      
                                      <Collapse in={expandedAssetCategories[pinned.id]?.healthyAssets}>
                                        <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5, maxHeight: 150, overflowY: 'auto' }}>
                                          {pinned.asset.assetsByHealth?.healthy?.map((asset: Asset) => (
                                            <Box 
                                              key={asset.id}
                                              onClick={() => {
                                                setSelectedAsset(asset);
                                                flyToAsset(asset.longitude, asset.latitude, 15);
                                              }}
                                              sx={{ 
                                                p: 1, 
                                                bgcolor: alpha('#22C55E', 0.05), 
                                                borderLeft: `2px solid ${alpha('#22C55E', 0.5)}`,
                                                borderRadius: 1,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                contentVisibility: 'auto',
                                                containIntrinsicSize: 'auto 60px',
                                                '&:hover': {
                                                  bgcolor: COLORS.status.healthy.chip,
                                                  transform: 'translateX(4px)'
                                                }
                                              }}
                                            >
                                              <Typography variant="caption" fontWeight={600} color="#22C55E" display="block">
                                                {asset.name || asset.id} ({asset.type})
                                              </Typography>
                                              {asset.health_score !== undefined && (
                                                <Typography variant="caption" display="block" sx={{ fontSize: 9, color: 'text.secondary' }}>
                                                  Health: {asset.health_score}%
                                                </Typography>
                                              )}
                                            </Box>
                                          ))}
                                        </Stack>
                                      </Collapse>
                                    </Box>
                                  </Stack>
                                </Collapse>
                              </Box>
                            </>
                          )}

                          {pinned.asset.type !== 'aggregate' && (
                            <>
                              <Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Operational Status</Typography>
                                <Chip 
                                  label={pinned.asset.status?.toUpperCase() || 'OPERATIONAL'} 
                                  size="small" 
                                  sx={{ 
                                    mt: 0.5,
                                    bgcolor: COLORS.status.healthy.chip, 
                                    color: '#22C55E',
                                    fontWeight: 700 
                                  }} 
                                />
                              </Box>
                              {pinned.asset.capacity && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary">Capacity</Typography>
                                  <Typography variant="body2">{pinned.asset.capacity}</Typography>
                                </Box>
                              )}
                              {pinned.asset.voltage && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary">Voltage</Typography>
                                  <Typography variant="body2">{pinned.asset.voltage}</Typography>
                                </Box>
                              )}
                              {pinned.asset.type === 'pole' && pinned.asset.pole_height_ft && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary">Pole Height</Typography>
                                  <Typography variant="body2" sx={{ color: '#8880ff', fontWeight: 600 }}>
                                    {pinned.asset.pole_height_ft} ft
                                  </Typography>
                                </Box>
                              )}
                            </>
                          )}

                          <Box>
                            <Typography variant="caption" color="text.secondary">Coordinates</Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {pinned.asset.latitude.toFixed(6)}, {pinned.asset.longitude.toFixed(6)}
                            </Typography>
                          </Box>
                        </Stack>
                        </Collapse>
                      </Paper>
                    </Fade>
                  );
                })}

                {/* Selected Asset Panel (Active/Unpinned) */}
                {selectedAsset && clickPosition && !pinnedAssets.some(p => p.asset.id === selectedAsset.id) && (() => {
                  // Engineering: Intelligent positioning to ensure full info card visibility
                  const CARD_WIDTH = 380;
                  const CARD_HEIGHT = 700; // Increased estimate for scrollability
                  const MARGIN = 20;
                  const EDGE_THRESHOLD = 60; // Increased threshold for better edge detection
                  
                  // Detect proximity to screen edges with viewport awareness
                  const viewportWidth = window.innerWidth;
                  const viewportHeight = window.innerHeight;
                  const nearRight = clickPosition.x + CARD_WIDTH + EDGE_THRESHOLD > viewportWidth;
                  const nearBottom = clickPosition.y + CARD_HEIGHT + EDGE_THRESHOLD > viewportHeight;
                  const nearLeft = clickPosition.x < EDGE_THRESHOLD;
                  const nearTop = clickPosition.y < EDGE_THRESHOLD;
                  
                  // Smart positioning with corner case handling
                  let cardLeft: number;
                  let cardTop: number;
                  
                  // Horizontal positioning
                  if (nearRight && !nearLeft) {
                    cardLeft = Math.max(10, clickPosition.x - CARD_WIDTH - MARGIN);
                  } else if (nearLeft) {
                    cardLeft = Math.min(clickPosition.x + MARGIN, viewportWidth - CARD_WIDTH - 10);
                  } else {
                    cardLeft = Math.min(clickPosition.x + MARGIN, viewportWidth - CARD_WIDTH - 10);
                  }
                  
                  // Vertical positioning
                  if (nearBottom && !nearTop) {
                    cardTop = Math.max(10, clickPosition.y - CARD_HEIGHT - MARGIN);
                  } else if (nearTop) {
                    cardTop = Math.min(clickPosition.y + MARGIN, viewportHeight - CARD_HEIGHT - 10);
                  } else {
                    cardTop = Math.min(clickPosition.y + MARGIN, viewportHeight - CARD_HEIGHT - 10);
                  }
                  
                  // Ensure card stays within bounds
                  cardLeft = Math.max(10, Math.min(cardLeft, viewportWidth - CARD_WIDTH - 10));
                  cardTop = Math.max(10, Math.min(cardTop, viewportHeight - 200)); // Ensure at least 200px visible
                  
                  // Use stored position if being dragged, otherwise use calculated position
                  if (selectedAssetPosition) {
                    cardLeft = selectedAssetPosition.x;
                    cardTop = selectedAssetPosition.y;
                  }
                  
                  const isPinned = pinnedAssets.some(p => p.asset.id === selectedAsset.id);

                  const handlePinToggle = () => {
                    if (isPinned) {
                      setPinnedAssets(prev => prev.filter(p => p.asset.id !== selectedAsset.id));
                    } else {
                      setPinnedAssets(prev => [...prev, {
                        id: selectedAsset.id,
                        asset: selectedAsset,
                        position: { x: cardLeft, y: cardTop },
                        collapsed: false
                      }]);
                      setSelectedAsset(null);
                      setClickPosition(null);
                    }
                  };

                  const handleMouseDown = (e: React.MouseEvent) => {
                    if ((e.target as HTMLElement).closest('.drag-handle')) {
                      e.preventDefault();
                      setDraggedCardId(selectedAsset.id);
                      setDragOffset({
                        x: e.clientX - cardLeft,
                        y: e.clientY - cardTop
                      });
                    }
                  };
                  
                  // Pre-compute values to avoid inline calculations (performance optimization)
                  const isDraggingSelected = draggedCardId === selectedAsset.id;
                  const borderColorSelected = selectedAsset.type === 'aggregate' ? (
                    selectedAsset.worstStatus === 'critical' ? '#EF4444' :
                    selectedAsset.worstStatus === 'warning' ? '#FBBF24' :
                    '#22C55E'
                  ) :
                  selectedAsset.type === 'substation' ? '#00C8FF' :
                  selectedAsset.type === 'transformer' ? '#EC4899' :
                  selectedAsset.type === 'pole' ? '#8880ff' : '#9333EA';
                  
                  return (
                    <Fade in={true}>
                      <Paper 
                        onMouseDown={handleMouseDown}
                        sx={{ 
                        position: 'absolute', 
                        left: 0,
                        top: 0,
                        transform: `translate3d(${cardLeft}px, ${cardTop}px, 0)`,
                        willChange: isDraggingSelected ? 'transform' : undefined,
                        p: 3, 
                        minWidth: 320,
                        maxWidth: 380,
                        maxHeight: 'calc(100vh - 40px)',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        bgcolor: alpha('#1E293B', 0.80),
                        backdropFilter: 'blur(12px)',
                        zIndex: 1000,
                        borderLeft: `4px solid ${borderColorSelected}`,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        cursor: isDraggingSelected ? 'grabbing' : 'default',
                        userSelect: 'text',
                        // CRITICAL OPTIMIZATIONS for drag performance
                        contain: 'layout style paint',  // CSS containment - isolates rendering
                        '&::-webkit-scrollbar': {
                          width: '8px',
                        },
                        '&::-webkit-scrollbar-track': {
                          bgcolor: alpha('#000', 0.2),
                        },
                        '&::-webkit-scrollbar-thumb': {
                          bgcolor: alpha('#fff', 0.3),
                          borderRadius: '4px',
                          '&:hover': {
                            bgcolor: alpha('#fff', 0.4),
                          },
                        },
                      }}>
                      <Box className="drag-handle" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, cursor: 'grab', '&:active': { cursor: 'grabbing' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          {selectedAsset.type === 'aggregate' && <Assessment sx={{ 
                            color: selectedAsset.worstStatus === 'critical' ? '#EF4444' :
                                   selectedAsset.worstStatus === 'warning' ? '#FBBF24' : '#22C55E',
                            fontSize: 28 
                          }} />}
                          {selectedAsset.type === 'substation' && <ElectricBolt sx={{ color: '#00C8FF', fontSize: 28 }} />}
                          {selectedAsset.type === 'transformer' && <Assessment sx={{ color: '#EC4899', fontSize: 28 }} />}
                          {selectedAsset.type === 'pole' && <Engineering sx={{ color: '#8880ff', fontSize: 28 }} />}
                          {selectedAsset.type === 'meter' && <Speed sx={{ color: '#9333EA', fontSize: 28 }} />}
                          <Box>
                            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{selectedAsset.name}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ 
                              fontFamily: 'monospace', 
                              letterSpacing: 0.5,
                              maxWidth: 280,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {selectedAsset.id}
                            </Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Tooltip title={isPinned ? "Unpin card" : "Pin card for comparison"}>
                            <IconButton 
                              size="small" 
                              onClick={handlePinToggle}
                              sx={{ color: isPinned ? '#FBBF24' : 'inherit' }}
                            >
                              <PushPin sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                          <IconButton size="small" onClick={() => {
                            setSelectedAsset(null);
                            setSelectedAssetPosition(null);
                          }}>
                            <Close sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Box>
                      </Box>

                      <Chip 
                        label={selectedAsset.type.toUpperCase()} 
                        size="small" 
                        sx={{ mb: 2, fontWeight: 700, letterSpacing: 0.5 }} 
                      />

                      <Stack spacing={2} divider={<Divider />}>
                        {/* Aggregate Cell Metrics - Enhanced with Interactivity */}
                        {selectedAsset.type === 'aggregate' && (
                          <>
                            {/* Action Buttons */}
                            <Stack direction="row" spacing={1}>
                              <Tooltip title="Center map on this cell">
                                <Button 
                                  size="small" 
                                  variant="outlined" 
                                  startIcon={<MyLocation />}
                                  onClick={() => flyToAsset(selectedAsset.longitude, selectedAsset.latitude, 12)}
                                  sx={{ flex: 1, fontSize: 11 }}
                                >
                                  Center
                                </Button>
                              </Tooltip>
                              <Tooltip title="Zoom to see individual assets">
                                <Button 
                                  size="small" 
                                  variant="outlined" 
                                  startIcon={<ZoomIn />}
                                  onClick={() => flyToAsset(selectedAsset.longitude, selectedAsset.latitude, 13)}
                                  sx={{ flex: 1, fontSize: 11 }}
                                >
                                  Zoom In
                                </Button>
                              </Tooltip>
                            </Stack>

                            {/* Critical Status Alert */}
                            {selectedAsset.worstStatus === 'critical' && (
                              <Paper sx={{ 
                                p: 1.5, 
                                bgcolor: alpha('#EF4444', 0.1), 
                                border: '1px solid',
                                borderColor: alpha('#EF4444', 0.3)
                              }}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Warning sx={{ color: '#EF4444', fontSize: 20 }} />
                                  <Box>
                                    <Typography variant="caption" fontWeight={700} color="#EF4444">
                                      CRITICAL AREA
                                    </Typography>
                                    <Typography variant="caption" display="block" color="text.secondary">
                                      Requires immediate attention
                                    </Typography>
                                  </Box>
                                </Stack>
                              </Paper>
                            )}

                            {/* Infrastructure Summary - Expandable */}
                            <Box>
                              <Box 
                                display="flex" 
                                justifyContent="space-between" 
                                alignItems="center"
                                sx={{ cursor: 'pointer' }}
                                onClick={() => setExpandedSections(prev => ({ ...prev, infrastructure: !prev.infrastructure }))}
                              >
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <GridOn sx={{ fontSize: 16, color: 'text.secondary' }} />
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    INFRASTRUCTURE SUMMARY
                                  </Typography>
                                </Stack>
                                <IconButton size="small">
                                  {expandedSections.infrastructure ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </Box>
                              
                              <Collapse in={expandedSections.infrastructure}>
                                <Stack spacing={1} mt={1.5}>
                                  <Box display="flex" justifyContent="space-between" alignItems="center">
                                    <Typography variant="body2" color="text.secondary">Total Assets:</Typography>
                                    <Chip 
                                      label={selectedAsset.totalAssets} 
                                      size="small" 
                                      sx={{ fontWeight: 700, minWidth: 50 }}
                                    />
                                  </Box>
                                  
                                  <Paper sx={{ p: 1.5, bgcolor: alpha('#00C8FF', 0.05) }}>
                                    <Box 
                                      sx={{ cursor: 'pointer' }}
                                      onClick={() => {
                                        const activeCardId = 'active_card';
                                        setExpandedAssetCategories(prev => ({
                                          ...prev,
                                          [activeCardId]: {
                                            ...(prev[activeCardId] || {}),
                                            substations: !prev[activeCardId]?.substations,
                                            transformers: prev[activeCardId]?.transformers || false,
                                            poles: prev[activeCardId]?.poles || false,
                                            meters: prev[activeCardId]?.meters || false
                                          }
                                        }));
                                      }}
                                    >
                                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#00C8FF' }} />
                                          <Typography variant="body2" color="text.secondary">Substations</Typography>
                                        </Stack>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Typography variant="h6" fontWeight={700} color="#00C8FF">
                                            {selectedAsset.substationCount}
                                          </Typography>
                                          <IconButton size="small">
                                            {expandedAssetCategories['active_card']?.substations ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
                                          </IconButton>
                                        </Stack>
                                      </Stack>
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories['active_card']?.substations}>
                                      <Stack spacing={0.5} mt={1} sx={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {selectedAsset.substations?.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 1, 
                                              bgcolor: alpha('#00C8FF', 0.08),
                                              cursor: 'pointer',
                                              contentVisibility: 'auto',
                                              containIntrinsicSize: 'auto 60px',
                                              '&:hover': {
                                                bgcolor: COLORS.substation.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 13.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Box>
                                                <Typography variant="caption" fontWeight={600} color="#00C8FF">
                                                  {asset.name || asset.id}
                                                </Typography>
                                                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 9 }}>
                                                  Health: {asset.health_score ?? 'N/A'}%
                                                </Typography>
                                              </Box>
                                              <MyLocation sx={{ fontSize: 12, color: alpha('#00C8FF', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Collapse>
                                  </Paper>
                                  
                                  <Paper sx={{ p: 1.5, bgcolor: alpha('#EC4899', 0.05) }}>
                                    <Box 
                                      sx={{ cursor: 'pointer' }}
                                      onClick={() => {
                                        const activeCardId = 'active_card';
                                        setExpandedAssetCategories(prev => ({
                                          ...prev,
                                          [activeCardId]: {
                                            ...(prev[activeCardId] || {}),
                                            substations: prev[activeCardId]?.substations || false,
                                            transformers: !prev[activeCardId]?.transformers,
                                            poles: prev[activeCardId]?.poles || false,
                                            meters: prev[activeCardId]?.meters || false
                                          }
                                        }));
                                      }}
                                    >
                                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#EC4899' }} />
                                          <Typography variant="body2" color="text.secondary">Transformers</Typography>
                                        </Stack>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Typography variant="h6" fontWeight={700} color="#EC4899">
                                            {selectedAsset.transformerCount}
                                          </Typography>
                                          <IconButton size="small">
                                            {expandedAssetCategories['active_card']?.transformers ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
                                          </IconButton>
                                        </Stack>
                                      </Stack>
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories['active_card']?.transformers}>
                                      <Stack spacing={0.5} mt={1} sx={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {selectedAsset.transformers?.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 1, 
                                              bgcolor: alpha('#EC4899', 0.08),
                                              cursor: 'pointer',
                                              contentVisibility: 'auto',
                                              containIntrinsicSize: 'auto 60px',
                                              '&:hover': {
                                                bgcolor: COLORS.transformer.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 13.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Box>
                                                <Typography variant="caption" fontWeight={600} color="#EC4899">
                                                  {asset.name || asset.id}
                                                </Typography>
                                                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 9 }}>
                                                  Load: {asset.load_percent ?? 'N/A'}% • Health: {asset.health_score ?? 'N/A'}%
                                                </Typography>
                                              </Box>
                                              <MyLocation sx={{ fontSize: 12, color: alpha('#EC4899', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Collapse>
                                  </Paper>
                                  
                                  <Paper sx={{ p: 1.5, bgcolor: alpha('#8880ff', 0.05) }}>
                                    <Box 
                                      sx={{ cursor: 'pointer' }}
                                      onClick={() => {
                                        const activeCardId = 'active_card';
                                        setExpandedAssetCategories(prev => ({
                                          ...prev,
                                          [activeCardId]: {
                                            ...(prev[activeCardId] || {}),
                                            substations: prev[activeCardId]?.substations || false,
                                            transformers: prev[activeCardId]?.transformers || false,
                                            poles: !prev[activeCardId]?.poles,
                                            meters: prev[activeCardId]?.meters || false
                                          }
                                        }));
                                      }}
                                    >
                                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#8880ff' }} />
                                          <Typography variant="body2" color="text.secondary">Poles</Typography>
                                        </Stack>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Typography variant="h6" fontWeight={700} color="#8880ff">
                                            {selectedAsset.poleCount}
                                          </Typography>
                                          <IconButton size="small">
                                            {expandedAssetCategories['active_card']?.poles ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
                                          </IconButton>
                                        </Stack>
                                      </Stack>
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories['active_card']?.poles}>
                                      <Stack spacing={0.5} mt={1} sx={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {selectedAsset.poles?.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 1, 
                                              bgcolor: alpha('#8880ff', 0.08),
                                              cursor: 'pointer',
                                              contentVisibility: 'auto',
                                              containIntrinsicSize: 'auto 60px',
                                              '&:hover': {
                                                bgcolor: COLORS.pole.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 13.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Box>
                                                <Typography variant="caption" fontWeight={600} color="#8880ff">
                                                  {asset.name || asset.id}
                                                </Typography>
                                                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 9 }}>
                                                  Health: {asset.health_score ?? 'N/A'}%
                                                </Typography>
                                              </Box>
                                              <MyLocation sx={{ fontSize: 12, color: alpha('#8880ff', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Collapse>
                                  </Paper>
                                  
                                  <Paper sx={{ p: 1.5, bgcolor: alpha('#9333EA', 0.05) }}>
                                    <Box 
                                      sx={{ cursor: 'pointer' }}
                                      onClick={() => {
                                        const activeCardId = 'active_card';
                                        setExpandedAssetCategories(prev => ({
                                          ...prev,
                                          [activeCardId]: {
                                            ...(prev[activeCardId] || {}),
                                            substations: prev[activeCardId]?.substations || false,
                                            transformers: prev[activeCardId]?.transformers || false,
                                            poles: prev[activeCardId]?.poles || false,
                                            meters: !prev[activeCardId]?.meters
                                          }
                                        }));
                                      }}
                                    >
                                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#9333EA' }} />
                                          <Typography variant="body2" color="text.secondary">Meters</Typography>
                                        </Stack>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <Typography variant="h6" fontWeight={700} color="#9333EA">
                                            {selectedAsset.meterCount}
                                          </Typography>
                                          <IconButton size="small">
                                            {expandedAssetCategories['active_card']?.meters ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
                                          </IconButton>
                                        </Stack>
                                      </Stack>
                                    </Box>
                                    
                                    <Collapse in={expandedAssetCategories['active_card']?.meters}>
                                      <Stack spacing={0.5} mt={1} sx={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {selectedAsset.meters?.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 1, 
                                              bgcolor: alpha('#9333EA', 0.08),
                                              cursor: 'pointer',
                                              contentVisibility: 'auto',
                                              containIntrinsicSize: 'auto 60px',
                                              '&:hover': {
                                                bgcolor: COLORS.meter.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 13.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Box>
                                                <Typography variant="caption" fontWeight={600} color="#9333EA">
                                                  {asset.name || asset.id}
                                                </Typography>
                                                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 9 }}>
                                                  Usage: {asset.current_load ?? 'N/A'} kW
                                                </Typography>
                                              </Box>
                                              <MyLocation sx={{ fontSize: 12, color: alpha('#9333EA', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Collapse>
                                  </Paper>
                                </Stack>
                              </Collapse>
                            </Box>

                            {/* Health & Load Metrics - Expandable */}
                            <Box>
                              <Box 
                                display="flex" 
                                justifyContent="space-between" 
                                alignItems="center"
                                sx={{ cursor: 'pointer' }}
                                onClick={() => setExpandedSections(prev => ({ ...prev, health: !prev.health }))}
                              >
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Assessment sx={{ fontSize: 16, color: 'text.secondary' }} />
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    PERFORMANCE METRICS
                                  </Typography>
                                </Stack>
                                <IconButton size="small">
                                  {expandedSections.health ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </Box>
                              
                              <Collapse in={expandedSections.health}>
                                <Stack spacing={2} mt={1.5}>
                                  {/* Average Health */}
                                  <Box>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                        AVERAGE HEALTH
                                      </Typography>
                                      <Typography variant="h5" sx={{ 
                                        fontWeight: 800, 
                                        color: selectedAsset.avgHealth === null ? '#9CA3AF' : selectedAsset.avgHealth > 70 ? '#22C55E' : selectedAsset.avgHealth > 50 ? '#FBBF24' : '#EF4444' 
                                      }}>
                                        {selectedAsset.avgHealth === null ? 'N/A' : `${selectedAsset.avgHealth}%`}
                                      </Typography>
                                    </Stack>
                                    {selectedAsset.avgHealth !== null && (
                                      <LinearProgress 
                                        variant="determinate" 
                                        value={selectedAsset.avgHealth} 
                                        sx={{ 
                                          height: 8, 
                                          borderRadius: 1,
                                          bgcolor: alpha('#fff', 0.1),
                                          '& .MuiLinearProgress-bar': {
                                            bgcolor: selectedAsset.avgHealth > 70 ? '#22C55E' : selectedAsset.avgHealth > 50 ? '#FBBF24' : '#EF4444'
                                          }
                                        }} 
                                      />
                                    )}
                                    {selectedAsset.avgHealth === null && (
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                                        No health sensors in this cell
                                      </Typography>
                                    )}
                                  </Box>

                                  {/* Average Load */}
                                  <Box>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                        AVERAGE LOAD (TRANSFORMERS)
                                      </Typography>
                                      <Typography variant="h5" sx={{ 
                                        fontWeight: 800, 
                                        color: selectedAsset.avgLoad > 85 ? '#EF4444' : selectedAsset.avgLoad > 70 ? '#FBBF24' : '#22C55E'
                                      }}>
                                        {selectedAsset.avgLoad}%
                                      </Typography>
                                    </Stack>
                                    <LinearProgress 
                                      variant="determinate" 
                                      value={selectedAsset.avgLoad} 
                                      sx={{ 
                                        height: 8, 
                                        borderRadius: 1,
                                        bgcolor: alpha('#fff', 0.1),
                                        '& .MuiLinearProgress-bar': {
                                          bgcolor: selectedAsset.avgLoad > 85 ? '#EF4444' : selectedAsset.avgLoad > 70 ? '#FBBF24' : '#22C55E'
                                        }
                                      }} 
                                    />
                                  </Box>

                                  {/* Status Badge */}
                                  <Box>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={0.5}>
                                      OPERATIONAL STATUS
                                    </Typography>
                                    <Chip 
                                      icon={selectedAsset.worstStatus === 'critical' ? <Warning /> : undefined}
                                      label={selectedAsset.worstStatus.toUpperCase()} 
                                      sx={{ 
                                        width: '100%',
                                        bgcolor: selectedAsset.worstStatus === 'critical' ? alpha('#EF4444', 0.2) :
                                                 selectedAsset.worstStatus === 'warning' ? alpha('#FBBF24', 0.2) :
                                                 alpha('#22C55E', 0.2),
                                        color: selectedAsset.worstStatus === 'critical' ? '#EF4444' :
                                               selectedAsset.worstStatus === 'warning' ? '#FBBF24' :
                                               '#22C55E',
                                        fontWeight: 700,
                                        fontSize: 12,
                                        height: 32
                                      }} 
                                    />
                                  </Box>
                                </Stack>
                              </Collapse>
                            </Box>

                            {/* Health Status Breakdown - Expandable */}
                            <Box>
                              <Box
                                display="flex"
                                justifyContent="space-between"
                                alignItems="center"
                                sx={{ cursor: 'pointer' }}
                                onClick={() => setExpandedSections(prev => ({ ...prev, healthStatus: !prev.healthStatus }))}
                              >
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <FavoriteOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    HEALTH STATUS
                                  </Typography>
                                </Stack>
                                <IconButton size="small">
                                  {expandedSections.healthStatus ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </Box>
                              
                              <Collapse in={expandedSections.healthStatus}>
                                <Stack spacing={2} mt={1.5}>
                                  {/* Overall Counts */}
                                  <Stack spacing={1}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <Typography variant="body2" color="text.secondary">Critical Assets</Typography>
                                      <Chip label={selectedAsset.criticalCount || 0} size="small" sx={{ bgcolor: COLORS.status.critical.chip, color: '#EF4444' }} />
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <Typography variant="body2" color="text.secondary">Warning Assets</Typography>
                                      <Chip label={selectedAsset.warningCount || 0} size="small" sx={{ bgcolor: COLORS.status.warning.chip, color: '#FBBF24' }} />
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <Typography variant="body2" color="text.secondary">Healthy Assets</Typography>
                                      <Chip label={selectedAsset.healthyCount || 0} size="small" sx={{ bgcolor: COLORS.status.healthy.chip, color: '#22C55E' }} />
                                    </Box>
                                  </Stack>

                                  {/* Breakdown by Asset Type */}
                                  {selectedAsset.healthByType && (
                                    <Stack spacing={1.5} sx={{ pl: 1 }}>
                                      {/* Substations */}
                                      {(selectedAsset.healthByType.substations.critical > 0 || 
                                        selectedAsset.healthByType.substations.warning > 0 || 
                                        selectedAsset.healthByType.substations.healthy > 0) && (
                                        <Box>
                                          <Typography variant="caption" fontWeight={600} sx={{ color: '#00C8FF', mb: 0.5, display: 'block' }}>
                                            Substations
                                          </Typography>
                                          <Stack spacing={0.5} sx={{ pl: 1 }}>
                                            {selectedAsset.healthByType.substations.critical > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Critical</Typography>
                                                <Chip label={selectedAsset.healthByType.substations.critical} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.critical.chip, color: '#EF4444' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.substations.warning > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Warning</Typography>
                                                <Chip label={selectedAsset.healthByType.substations.warning} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.warning.chip, color: '#FBBF24' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.substations.healthy > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Healthy</Typography>
                                                <Chip label={selectedAsset.healthByType.substations.healthy} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.healthy.chip, color: '#22C55E' }} />
                                              </Box>
                                            )}
                                          </Stack>
                                        </Box>
                                      )}
                                      
                                      {/* Transformers */}
                                      {(selectedAsset.healthByType.transformers.critical > 0 || 
                                        selectedAsset.healthByType.transformers.warning > 0 || 
                                        selectedAsset.healthByType.transformers.healthy > 0) && (
                                        <Box>
                                          <Typography variant="caption" fontWeight={600} sx={{ color: '#EC4899', mb: 0.5, display: 'block' }}>
                                            Transformers
                                          </Typography>
                                          <Stack spacing={0.5} sx={{ pl: 1 }}>
                                            {selectedAsset.healthByType.transformers.critical > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Critical</Typography>
                                                <Chip label={selectedAsset.healthByType.transformers.critical} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.critical.chip, color: '#EF4444' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.transformers.warning > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Warning</Typography>
                                                <Chip label={selectedAsset.healthByType.transformers.warning} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.warning.chip, color: '#FBBF24' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.transformers.healthy > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Healthy</Typography>
                                                <Chip label={selectedAsset.healthByType.transformers.healthy} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.healthy.chip, color: '#22C55E' }} />
                                              </Box>
                                            )}
                                          </Stack>
                                        </Box>
                                      )}
                                      
                                      {/* Poles */}
                                      {(selectedAsset.healthByType.poles.critical > 0 || 
                                        selectedAsset.healthByType.poles.warning > 0 || 
                                        selectedAsset.healthByType.poles.healthy > 0) && (
                                        <Box>
                                          <Typography variant="caption" fontWeight={600} sx={{ color: '#8880ff', mb: 0.5, display: 'block' }}>
                                            Poles
                                          </Typography>
                                          <Stack spacing={0.5} sx={{ pl: 1 }}>
                                            {selectedAsset.healthByType.poles.critical > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Critical</Typography>
                                                <Chip label={selectedAsset.healthByType.poles.critical} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.critical.chip, color: '#EF4444' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.poles.warning > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Warning</Typography>
                                                <Chip label={selectedAsset.healthByType.poles.warning} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.warning.chip, color: '#FBBF24' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.poles.healthy > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Healthy</Typography>
                                                <Chip label={selectedAsset.healthByType.poles.healthy} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.healthy.chip, color: '#22C55E' }} />
                                              </Box>
                                            )}
                                          </Stack>
                                        </Box>
                                      )}
                                      
                                      {/* Meters */}
                                      {(selectedAsset.healthByType.meters.critical > 0 || 
                                        selectedAsset.healthByType.meters.warning > 0 || 
                                        selectedAsset.healthByType.meters.healthy > 0) && (
                                        <Box>
                                          <Typography variant="caption" fontWeight={600} sx={{ color: '#9333EA', mb: 0.5, display: 'block' }}>
                                            Meters
                                          </Typography>
                                          <Stack spacing={0.5} sx={{ pl: 1 }}>
                                            {selectedAsset.healthByType.meters.critical > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Critical</Typography>
                                                <Chip label={selectedAsset.healthByType.meters.critical} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.critical.chip, color: '#EF4444' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.meters.warning > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Warning</Typography>
                                                <Chip label={selectedAsset.healthByType.meters.warning} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.warning.chip, color: '#FBBF24' }} />
                                              </Box>
                                            )}
                                            {selectedAsset.healthByType.meters.healthy > 0 && (
                                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">Healthy</Typography>
                                                <Chip label={selectedAsset.healthByType.meters.healthy} size="small" sx={{ height: 18, fontSize: 10, bgcolor: COLORS.status.healthy.chip, color: '#22C55E' }} />
                                              </Box>
                                            )}
                                          </Stack>
                                        </Box>
                                      )}
                                    </Stack>
                                  )}
                                </Stack>
                              </Collapse>
                            </Box>

                            {/* Cell Center Coordinates */}
                            <Box>
                              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={0.5}>
                                CELL CENTER
                              </Typography>
                              <Paper sx={{ p: 1, bgcolor: alpha('#0EA5E9', 0.05) }}>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, color: '#0EA5E9' }}>
                                  {selectedAsset.latitude.toFixed(6)}, {selectedAsset.longitude.toFixed(6)}
                                </Typography>
                              </Paper>
                            </Box>
                          </>
                        )}

                        {/* Individual Asset Metrics */}
                        {selectedAsset.health_score !== undefined && selectedAsset.health_score !== null && (
                          <Box>
                            <Typography variant="caption" color="text.secondary" fontWeight={600}>HEALTH SCORE</Typography>
                            <Typography variant="h4" sx={{ 
                              fontWeight: 800, 
                              color: selectedAsset.health_score > 80 ? '#22C55E' : selectedAsset.health_score > 50 ? '#FBBF24' : '#EF4444' 
                            }}>
                              {selectedAsset.health_score.toFixed(0)}%
                            </Typography>
                          </Box>
                        )}

                        {selectedAsset.load_percent !== undefined && selectedAsset.load_percent !== null && (
                          <Box>
                            <Typography variant="caption" color="text.secondary" fontWeight={600}>LOAD CAPACITY</Typography>
                            <Typography variant="h4" sx={{ 
                              fontWeight: 800, 
                              color: selectedAsset.load_percent > 85 ? '#EF4444' : 
                                     selectedAsset.load_percent > 70 ? '#FBBF24' : 
                                     '#22C55E'
                            }}>
                              {selectedAsset.load_percent.toFixed(0)}%
                            </Typography>
                            <LinearProgress 
                              variant="determinate" 
                              value={selectedAsset.load_percent} 
                              sx={{ 
                                height: 6, 
                                borderRadius: 1,
                                mt: 1,
                                bgcolor: alpha('#fff', 0.1),
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: selectedAsset.load_percent > 85 ? '#EF4444' : 
                                           selectedAsset.load_percent > 70 ? '#FBBF24' : 
                                           '#22C55E'
                                }
                              }} 
                            />
                          </Box>
                        )}

                        {selectedAsset.usage_kwh !== undefined && selectedAsset.usage_kwh !== null && (
                          <Box>
                            <Typography variant="caption" color="text.secondary" fontWeight={600}>POWER USAGE</Typography>
                            <Typography variant="h4" sx={{ fontWeight: 800, color: '#9333EA' }}>
                              {selectedAsset.usage_kwh.toFixed(1)} kWh
                            </Typography>
                          </Box>
                        )}

                        {selectedAsset.voltage && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Voltage Class</Typography>
                            <Typography variant="body1" fontWeight={600}>{selectedAsset.voltage}</Typography>
                          </Box>
                        )}

                        {selectedAsset.status && (
                          <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Operational Status</Typography>
                            <Chip 
                              label={(() => {
                                // Derive status from load capacity for transformers
                                if (selectedAsset.type === 'transformer' && selectedAsset.load_percent !== undefined) {
                                  if (selectedAsset.load_percent > 85) return 'Critical Load';
                                  if (selectedAsset.load_percent > 70) return 'High Load';
                                  return 'Operational';
                                }
                                // Substations: map Postgres status to display labels
                                if (selectedAsset.type === 'substation' && selectedAsset.status) {
                                  const statusLower = selectedAsset.status.toLowerCase();
                                  if (statusLower === 'critical') return 'Critical';
                                  if (statusLower === 'warning') return 'Warning';
                                  if (statusLower === 'good') return 'Operational';
                                }
                                // Derive status from health score for other assets
                                if (selectedAsset.health_score !== undefined && selectedAsset.health_score !== null) {
                                  if (selectedAsset.health_score < 60) return 'Critical';
                                  if (selectedAsset.health_score < 80) return 'Fair';
                                  return 'Excellent';
                                }
                                return selectedAsset.status;
                              })()} 
                              size="small" 
                              sx={{ 
                                mt: 0.5,
                                bgcolor: (() => {
                                  // Status color based on load capacity for transformers
                                  if (selectedAsset.type === 'transformer' && selectedAsset.load_percent !== undefined) {
                                    if (selectedAsset.load_percent > 85) return alpha('#EF4444', 0.2);
                                    if (selectedAsset.load_percent > 70) return alpha('#FBBF24', 0.2);
                                    return alpha('#22C55E', 0.2);
                                  }
                                  // Substations: map Postgres status to colors
                                  if (selectedAsset.type === 'substation' && selectedAsset.status) {
                                    const statusLower = selectedAsset.status.toLowerCase();
                                    if (statusLower === 'critical') return alpha('#EF4444', 0.2);
                                    if (statusLower === 'warning') return alpha('#FBBF24', 0.2);
                                    if (statusLower === 'good') return alpha('#22C55E', 0.2);
                                  }
                                  // Status color based on health score for other assets
                                  if (selectedAsset.health_score !== undefined && selectedAsset.health_score !== null) {
                                    if (selectedAsset.health_score < 60) return alpha('#EF4444', 0.2);
                                    if (selectedAsset.health_score < 80) return alpha('#FBBF24', 0.2);
                                    return alpha('#22C55E', 0.2);
                                  }
                                  // Fallback: status string-based coloring
                                  return selectedAsset.status.includes('Operational') || selectedAsset.status.includes('Active') || 
                                         selectedAsset.status.includes('Connected') || selectedAsset.status.includes('Healthy') ||
                                         selectedAsset.status.includes('Good') || selectedAsset.status.includes('Excellent')
                                    ? alpha('#22C55E', 0.2) 
                                    : alpha('#F59E0B', 0.2);
                                })(),
                                color: (() => {
                                  // Status color based on load capacity for transformers
                                  if (selectedAsset.type === 'transformer' && selectedAsset.load_percent !== undefined) {
                                    if (selectedAsset.load_percent > 85) return '#EF4444';
                                    if (selectedAsset.load_percent > 70) return '#FBBF24';
                                    return '#22C55E';
                                  }
                                  // Substations: map Postgres status to colors
                                  if (selectedAsset.type === 'substation' && selectedAsset.status) {
                                    const statusLower = selectedAsset.status.toLowerCase();
                                    if (statusLower === 'critical') return '#EF4444';
                                    if (statusLower === 'warning') return '#FBBF24';
                                    if (statusLower === 'good') return '#22C55E';
                                  }
                                  // Status color based on health score for other assets
                                  if (selectedAsset.health_score !== undefined && selectedAsset.health_score !== null) {
                                    if (selectedAsset.health_score < 60) return '#EF4444';
                                    if (selectedAsset.health_score < 80) return '#FBBF24';
                                    return '#22C55E';
                                  }
                                  // Fallback: status string-based coloring
                                  return selectedAsset.status.includes('Operational') || selectedAsset.status.includes('Active') || 
                                         selectedAsset.status.includes('Connected') || selectedAsset.status.includes('Healthy') ||
                                         selectedAsset.status.includes('Good') || selectedAsset.status.includes('Excellent')
                                    ? '#22C55E' 
                                    : '#F59E0B';
                                })(),
                                fontWeight: 700
                              }} 
                            />
                          </Box>
                        )}

                        {selectedAsset.last_maintenance && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Last Maintenance</Typography>
                            <Typography variant="body2">{selectedAsset.last_maintenance}</Typography>
                          </Box>
                        )}

                        {selectedAsset.commissioned_date && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Commissioned</Typography>
                            <Typography variant="body2">
                              {selectedAsset.commissioned_date}
                              {(() => {
                                try {
                                  const commissionedYear = new Date(selectedAsset.commissioned_date).getFullYear();
                                  const currentYear = new Date().getFullYear();
                                  const age = currentYear - commissionedYear;
                                  return age > 0 ? ` (${age} years old)` : '';
                                } catch {
                                  return '';
                                }
                              })()}
                            </Typography>
                          </Box>
                        )}

                        {selectedAsset.type === 'pole' && selectedAsset.pole_height_ft && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Pole Height</Typography>
                            <Typography variant="body2" sx={{ color: '#8880ff', fontWeight: 600 }}>
                              {selectedAsset.pole_height_ft} ft
                            </Typography>
                          </Box>
                        )}

                        {selectedAsset.type !== 'aggregate' && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Coordinates</Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {selectedAsset.latitude.toFixed(6)}, {selectedAsset.longitude.toFixed(6)}
                            </Typography>
                          </Box>
                        )}

                        {/* Connected Assets Section - Show connected grid infrastructure */}
                        {selectedAsset.type !== 'aggregate' && (() => {
                          // Find all connected assets via topology
                          const connectedAssetIds = new Set<string>();
                          topology.forEach(link => {
                            if (link.from_asset_id === selectedAsset.id) {
                              connectedAssetIds.add(link.to_asset_id);
                            }
                            if (link.to_asset_id === selectedAsset.id) {
                              connectedAssetIds.add(link.from_asset_id);
                            }
                          });
                          
                          // Retrieve full asset objects
                          const connectedAssets = assets.filter(a => connectedAssetIds.has(a.id));
                          
                          // Group by asset type
                          const groupedAssets = {
                            substation: connectedAssets.filter(a => a.type?.toLowerCase() === 'substation'),
                            transformer: connectedAssets.filter(a => a.type?.toLowerCase() === 'transformer'),
                            pole: connectedAssets.filter(a => a.type?.toLowerCase() === 'pole'),
                            meter: connectedAssets.filter(a => a.type?.toLowerCase() === 'meter')
                          };

                          const totalConnected = connectedAssets.length;
                          if (totalConnected === 0) return null;

                          return (
                            <Box>
                              <Box 
                                display="flex" 
                                justifyContent="space-between" 
                                alignItems="center"
                                sx={{ cursor: 'pointer', mb: 1 }}
                                onClick={() => setExpandedSections(prev => ({ ...prev, connected: !prev.connected }))}
                              >
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Hub sx={{ fontSize: 16, color: 'text.secondary' }} />
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    CONNECTED ASSETS
                                  </Typography>
                                </Stack>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Chip label={totalConnected} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 700 }} />
                                  <IconButton size="small">
                                    {expandedSections.connected ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                                  </IconButton>
                                </Stack>
                              </Box>

                              <Collapse in={expandedSections.connected}>
                                <Stack spacing={1} mt={1}>
                                  {/* Substations */}
                                  {groupedAssets.substation.length > 0 && (
                                    <Paper sx={{ p: 1, bgcolor: alpha('#00C8FF', 0.05) }}>
                                      <Typography variant="caption" fontWeight={600} sx={{ color: '#00C8FF', mb: 0.5, display: 'block' }}>
                                        Substations ({groupedAssets.substation.length})
                                      </Typography>
                                      <Stack spacing={0.5} sx={{ maxHeight: 120, overflowY: 'auto' }}>
                                        {groupedAssets.substation.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 0.75, 
                                              bgcolor: alpha('#00C8FF', 0.08),
                                              cursor: 'pointer',
                                              '&:hover': {
                                                bgcolor: COLORS.substation.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 13.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Typography variant="caption" fontWeight={600} color="#00C8FF" sx={{ fontSize: 10 }}>
                                                {asset.name || asset.id}
                                              </Typography>
                                              <MyLocation sx={{ fontSize: 10, color: alpha('#00C8FF', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Paper>
                                  )}

                                  {/* Transformers */}
                                  {groupedAssets.transformer.length > 0 && (
                                    <Paper sx={{ p: 1, bgcolor: alpha('#EC4899', 0.05) }}>
                                      <Typography variant="caption" fontWeight={600} sx={{ color: '#EC4899', mb: 0.5, display: 'block' }}>
                                        Transformers ({groupedAssets.transformer.length})
                                      </Typography>
                                      <Stack spacing={0.5} sx={{ maxHeight: 120, overflowY: 'auto' }}>
                                        {groupedAssets.transformer.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 0.75, 
                                              bgcolor: alpha('#EC4899', 0.08),
                                              cursor: 'pointer',
                                              '&:hover': {
                                                bgcolor: COLORS.transformer.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 13.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Typography variant="caption" fontWeight={600} color="#EC4899" sx={{ fontSize: 10 }}>
                                                {asset.name || asset.id}
                                              </Typography>
                                              <MyLocation sx={{ fontSize: 10, color: alpha('#EC4899', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Paper>
                                  )}

                                  {/* Poles */}
                                  {groupedAssets.pole.length > 0 && (
                                    <Paper sx={{ p: 1, bgcolor: alpha('#8880ff', 0.05) }}>
                                      <Typography variant="caption" fontWeight={600} sx={{ color: '#8880ff', mb: 0.5, display: 'block' }}>
                                        Poles ({groupedAssets.pole.length})
                                      </Typography>
                                      <Stack spacing={0.5} sx={{ maxHeight: 120, overflowY: 'auto' }}>
                                        {groupedAssets.pole.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 0.75, 
                                              bgcolor: alpha('#8880ff', 0.08),
                                              cursor: 'pointer',
                                              '&:hover': {
                                                bgcolor: COLORS.pole.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 14);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Typography variant="caption" fontWeight={600} color="#8880ff" sx={{ fontSize: 10 }}>
                                                {asset.name || asset.id}
                                              </Typography>
                                              <MyLocation sx={{ fontSize: 10, color: alpha('#8880ff', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Paper>
                                  )}

                                  {/* Meters */}
                                  {groupedAssets.meter.length > 0 && (
                                    <Paper sx={{ p: 1, bgcolor: alpha('#9333EA', 0.05) }}>
                                      <Typography variant="caption" fontWeight={600} sx={{ color: '#9333EA', mb: 0.5, display: 'block' }}>
                                        Meters ({groupedAssets.meter.length})
                                      </Typography>
                                      <Stack spacing={0.5} sx={{ maxHeight: 120, overflowY: 'auto' }}>
                                        {groupedAssets.meter.map((asset: any) => (
                                          <Paper 
                                            key={asset.id}
                                            sx={{ 
                                              p: 0.75, 
                                              bgcolor: alpha('#9333EA', 0.08),
                                              cursor: 'pointer',
                                              '&:hover': {
                                                bgcolor: COLORS.meter.chip,
                                                transform: 'translateX(4px)',
                                                transition: 'all 0.2s'
                                              }
                                            }}
                                            onClick={() => {
                                              flyToAsset(asset.longitude, asset.latitude, 14.5);
                                              setSelectedAsset(asset);
                                            }}
                                          >
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                              <Box sx={{ flex: 1 }}>
                                                <Typography variant="caption" fontWeight={600} color="#9333EA" sx={{ fontSize: 10 }}>
                                                  {asset.name || asset.id}
                                                </Typography>
                                                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 8 }}>
                                                  {asset.customer_segment || 'N/A'}
                                                </Typography>
                                              </Box>
                                              <MyLocation sx={{ fontSize: 10, color: alpha('#9333EA', 0.5) }} />
                                            </Stack>
                                          </Paper>
                                        ))}
                                      </Stack>
                                    </Paper>
                                  )}
                                </Stack>
                              </Collapse>
                            </Box>
                          );
                        })()}
                      </Stack>
                      </Paper>
                    </Fade>
                  );
                })()}

                {/* Selected Spatial Object Info Card - Buildings, Power Lines, Vegetation */}
                {selectedSpatialObject && spatialClickPosition && (() => {
                  const CARD_WIDTH = 340;
                  const CARD_HEIGHT = 450;
                  const MARGIN = 20;
                  
                  const viewportWidth = window.innerWidth;
                  const viewportHeight = window.innerHeight;
                  const nearRight = spatialClickPosition.x + CARD_WIDTH + MARGIN > viewportWidth;
                  const nearBottom = spatialClickPosition.y + CARD_HEIGHT + MARGIN > viewportHeight;
                  
                  let cardLeft = nearRight ? Math.max(10, spatialClickPosition.x - CARD_WIDTH - MARGIN) : spatialClickPosition.x + MARGIN;
                  let cardTop = nearBottom ? Math.max(10, spatialClickPosition.y - CARD_HEIGHT - MARGIN) : spatialClickPosition.y + MARGIN;
                  
                  cardLeft = Math.max(10, Math.min(cardLeft, viewportWidth - CARD_WIDTH - 10));
                  cardTop = Math.max(10, Math.min(cardTop, viewportHeight - 150));
                  
                  const borderColor = selectedSpatialObject.type === 'building' ? '#F97316' :
                                     selectedSpatialObject.type === 'power_line' ? '#FBBF24' : '#22C55E';
                  
                  return (
                    <Fade in timeout={300}>
                      <Paper
                        elevation={16}
                        sx={{
                          position: 'absolute',
                          left: cardLeft,
                          top: cardTop,
                          width: CARD_WIDTH,
                          maxHeight: CARD_HEIGHT,
                          overflow: 'auto',
                          bgcolor: 'rgba(15, 23, 42, 0.95)',
                          backdropFilter: 'blur(20px)',
                          border: `2px solid ${borderColor}`,
                          borderRadius: 2.5,
                          zIndex: 9999,
                          boxShadow: `0 12px 48px ${borderColor}40, inset 0 1px 0 rgba(255,255,255,0.05)`
                        }}
                      >
                        {/* Header */}
                        <Box sx={{ 
                          p: 2, 
                          borderBottom: '1px solid rgba(255,255,255,0.1)',
                          background: `linear-gradient(135deg, ${borderColor}15 0%, transparent 100%)`
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              {selectedSpatialObject.type === 'building' && <Business sx={{ color: borderColor, fontSize: 28 }} />}
                              {selectedSpatialObject.type === 'power_line' && <ElectricalServices sx={{ color: borderColor, fontSize: 28 }} />}
                              {selectedSpatialObject.type === 'vegetation' && <Park sx={{ color: borderColor, fontSize: 28 }} />}
                              <Box>
                                <Typography variant="h6" sx={{ 
                                  fontWeight: 700, 
                                  fontSize: 16, 
                                  color: borderColor,
                                  lineHeight: 1.2
                                }}>
                                  {selectedSpatialObject.type === 'building' ? 'Building Footprint' :
                                   selectedSpatialObject.type === 'power_line' ? 'Power Line' : 'Vegetation Risk'}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>
                                  PostGIS Spatial Layer
                                </Typography>
                              </Box>
                            </Box>
                            <IconButton 
                              size="small" 
                              onClick={() => {
                                setSelectedSpatialObject(null);
                                setSpatialClickPosition(null);
                              }}
                              sx={{ color: 'rgba(255,255,255,0.5)', '&:hover': { color: 'white' } }}
                            >
                              <Close sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Box>
                          <Chip 
                            label={selectedSpatialObject.type.toUpperCase().replace('_', ' ')}
                            size="small"
                            sx={{ 
                              bgcolor: `${borderColor}20`,
                              color: borderColor,
                              fontWeight: 700,
                              fontSize: 10,
                              height: 22
                            }}
                          />
                        </Box>
                        
                        {/* Content */}
                        <Stack spacing={2} sx={{ p: 2 }}>
                          {/* Building Info Card */}
                          {selectedSpatialObject.type === 'building' && (() => {
                            const bldg = selectedSpatialObject as SpatialBuilding;
                            // Check if building has a real name (not generic)
                            const hasRealName = bldg.building_name && 
                              !['Unnamed', 'unnamed', 'Unknown', 'unknown', 'Yes', 'yes', ''].includes(bldg.building_name);
                            return (
                              <>
                                {hasRealName && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Name</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 15, color: '#F97316' }}>
                                      {bldg.building_name}
                                    </Typography>
                                  </Box>
                                )}
                                <Box>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>ID</Typography>
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                    {bldg.id}
                                  </Typography>
                                </Box>
                                {bldg.building_type && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Building Type</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>
                                      {bldg.building_type}
                                    </Typography>
                                  </Box>
                                )}
                                <Box sx={{ display: 'flex', gap: 3 }}>
                                  {bldg.height_meters && (
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Height</Typography>
                                      <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
                                        {bldg.height_meters}m
                                      </Typography>
                                    </Box>
                                  )}
                                  {bldg.num_floors && (
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Floors</Typography>
                                      <Typography variant="h6" sx={{ color: '#8b5cf6', fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
                                        {bldg.num_floors}
                                      </Typography>
                                    </Box>
                                  )}
                                </Box>
                                {bldg.footprint_area_sqm && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Footprint Area</Typography>
                                    <Typography variant="body2" sx={{ fontSize: 13 }}>
                                      {bldg.footprint_area_sqm.toLocaleString()} m²
                                    </Typography>
                                  </Box>
                                )}
                                {bldg.address && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Address</Typography>
                                    <Typography variant="body2" sx={{ fontSize: 12 }}>
                                      {bldg.address}
                                    </Typography>
                                  </Box>
                                )}
                              </>
                            );
                          })()}

                          {/* Power Line Info Card */}
                          {selectedSpatialObject.type === 'power_line' && (() => {
                            const line = selectedSpatialObject as SpatialPowerLine;
                            return (
                              <>
                                <Box>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>ID</Typography>
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                    {line.id}
                                  </Typography>
                                </Box>
                                {line.line_name && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Line Name</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                                      {line.line_name}
                                    </Typography>
                                  </Box>
                                )}
                                <Box sx={{ display: 'flex', gap: 3 }}>
                                  {line.voltage_kv && (
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Voltage</Typography>
                                      <Typography variant="h6" sx={{ color: '#FBBF24', fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
                                        {line.voltage_kv} kV
                                      </Typography>
                                    </Box>
                                  )}
                                  {line.length_km && (
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Length</Typography>
                                      <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
                                        {line.length_km.toFixed(2)} km
                                      </Typography>
                                    </Box>
                                  )}
                                </Box>
                                {line.conductor_type && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Conductor Type</Typography>
                                    <Typography variant="body2" sx={{ fontSize: 13 }}>
                                      {line.conductor_type}
                                    </Typography>
                                  </Box>
                                )}
                                {line.installation_year && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Installation Year</Typography>
                                    <Typography variant="body2" sx={{ fontSize: 13 }}>
                                      {line.installation_year}
                                    </Typography>
                                  </Box>
                                )}
                                {line.coordinates && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Vertices</Typography>
                                    <Typography variant="body2" sx={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                                      {line.coordinates.length} points
                                    </Typography>
                                  </Box>
                                )}
                              </>
                            );
                          })()}

                          {/* Vegetation Info Card */}
                          {selectedSpatialObject.type === 'vegetation' && (() => {
                            const veg = selectedSpatialObject as SpatialVegetation;
                            const risk = veg.risk_score || veg.proximity_risk || 0;
                            return (
                              <>
                                <Box>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>ID</Typography>
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                    {veg.id}
                                  </Typography>
                                </Box>
                                <Box sx={{ 
                                  p: 2, 
                                  bgcolor: risk > 0.7 ? 'rgba(239, 68, 68, 0.15)' : risk > 0.4 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                                  borderRadius: 2,
                                  border: `1px solid ${risk > 0.7 ? 'rgba(239, 68, 68, 0.3)' : risk > 0.4 ? 'rgba(251, 191, 36, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`
                                }}>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Risk Assessment</Typography>
                                  <Typography variant="h4" sx={{ 
                                    color: risk > 0.7 ? '#EF4444' : risk > 0.4 ? '#FBBF24' : '#22C55E', 
                                    fontWeight: 800,
                                    fontSize: 32,
                                    lineHeight: 1
                                  }}>
                                    {(risk * 100).toFixed(0)}%
                                  </Typography>
                                  <Typography variant="caption" sx={{ 
                                    color: risk > 0.7 ? '#EF4444' : risk > 0.4 ? '#FBBF24' : '#22C55E',
                                    fontWeight: 600
                                  }}>
                                    {risk > 0.7 ? 'HIGH RISK' : risk > 0.4 ? 'MODERATE RISK' : 'LOW RISK'}
                                  </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', gap: 3 }}>
                                  {(veg.height_m || veg.canopy_height) && (
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Tree Height</Typography>
                                      <Typography variant="h6" sx={{ color: '#22C55E', fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
                                        {veg.height_m || veg.canopy_height}m
                                      </Typography>
                                    </Box>
                                  )}
                                  {veg.distance_to_line_m && (
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Distance to Line</Typography>
                                      <Typography variant="h6" sx={{ color: '#FBBF24', fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
                                        {veg.distance_to_line_m.toFixed(1)}m
                                      </Typography>
                                    </Box>
                                  )}
                                </Box>
                                {veg.species && (
                                  <Box>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Species</Typography>
                                    <Typography variant="body2" sx={{ fontSize: 13, textTransform: 'capitalize' }}>
                                      {veg.species}
                                    </Typography>
                                  </Box>
                                )}
                                <Box>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Coordinates</Typography>
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
                                    {veg.latitude?.toFixed(6)}, {veg.longitude?.toFixed(6)}
                                  </Typography>
                                </Box>
                              </>
                            );
                          })()}
                        </Stack>
                      </Paper>
                    </Fade>
                  );
                })()}

                {hoveredAsset && hoverPosition && (
                  <Fade in timeout={150}>
                    <Paper
                      elevation={12}
                      sx={{
                        position: 'absolute',
                        left: hoverPosition.x + 15,
                        top: hoverPosition.y + 15,
                        pointerEvents: 'none',
                        bgcolor: 'rgba(15, 23, 42, 0.6)',
                        backdropFilter: 'blur(20px)',
                        border: `2px solid ${
                          hoveredAsset.type === 'substation' ? 'rgba(0, 200, 255, 0.6)' :
                          hoveredAsset.type === 'transformer' ? 'rgba(236, 72, 153, 0.6)' :
                          hoveredAsset.type === 'pole' ? 'rgba(136, 128, 255, 0.6)' :
                          'rgba(147, 51, 234, 0.6)'
                        }`,
                        borderRadius: 2,
                        p: 1.5,
                        minWidth: 220,
                        maxWidth: 280,
                        zIndex: 10000,
                        boxShadow: `0 8px 32px ${
                          hoveredAsset.type === 'substation' ? 'rgba(0, 200, 255, 0.2)' :
                          hoveredAsset.type === 'transformer' ? 'rgba(236, 72, 153, 0.2)' :
                          hoveredAsset.type === 'pole' ? 'rgba(136, 128, 255, 0.2)' :
                          'rgba(147, 51, 234, 0.2)'
                        }`
                      }}
                    >
                      {/* Status Badge - Top Right */}
                      {hoveredAsset.status && (
                        <Chip 
                          label={hoveredAsset.status}
                          size="small"
                          sx={{ 
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            height: 20,
                            fontSize: 10,
                            fontWeight: 700,
                            bgcolor: hoveredAsset.status.includes('Operational') || hoveredAsset.status.includes('Active') || 
                                     hoveredAsset.status.includes('Connected') || hoveredAsset.status.includes('Healthy') ||
                                     hoveredAsset.status.includes('Good') || hoveredAsset.status.includes('Excellent')
                              ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                            color: hoveredAsset.status.includes('Operational') || hoveredAsset.status.includes('Active') || 
                                   hoveredAsset.status.includes('Connected') || hoveredAsset.status.includes('Healthy') ||
                                   hoveredAsset.status.includes('Good') || hoveredAsset.status.includes('Excellent')
                              ? '#22C55E' : '#F59E0B',
                            textTransform: 'capitalize',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                          }}
                        />
                      )}
                      <Stack spacing={0.75} divider={<Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />}>
                        {hoveredAsset.type === 'substation' && (
                          <>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset Type</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, textTransform: 'capitalize', color: '#00C8FF' }}>
                                {hoveredAsset.type}
                              </Typography>
                            </Box>
                            {hoveredAsset.name && hoveredAsset.name !== hoveredAsset.id && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Name</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                                  {hoveredAsset.name}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset ID</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                {hoveredAsset.id}
                              </Typography>
                            </Box>
                            {hoveredAsset.voltage && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Voltage</Typography>
                                <Typography variant="body2" sx={{ color: '#3b82f6', fontWeight: 700, fontSize: 13 }}>
                                  {hoveredAsset.voltage}
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.commissioned_date && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Commissioned</Typography>
                                <Typography variant="body2" sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                                  {hoveredAsset.commissioned_date}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Coordinates</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
                                {hoveredAsset.latitude.toFixed(6)}, {hoveredAsset.longitude.toFixed(6)}
                              </Typography>
                            </Box>
                          </>
                        )}
                        
                        {hoveredAsset.type === 'transformer' && (
                          <>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset Type</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, textTransform: 'capitalize', color: '#EC4899' }}>
                                {hoveredAsset.type}
                              </Typography>
                            </Box>
                            {hoveredAsset.name && hoveredAsset.name !== hoveredAsset.id && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Name</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                                  {hoveredAsset.name}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset ID</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                {hoveredAsset.id}
                              </Typography>
                            </Box>
                            {hoveredAsset.load_percent !== undefined && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Load Capacity</Typography>
                                <Typography variant="h6" sx={{ 
                                  color: hoveredAsset.load_percent > 85 ? '#EF4444' : hoveredAsset.load_percent > 70 ? '#FBBF24' : '#22C55E',
                                  fontWeight: 800,
                                  fontSize: 18,
                                  lineHeight: 1
                                }}>
                                  {hoveredAsset.load_percent}%
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.commissioned_date && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Commissioned</Typography>
                                <Typography variant="body2" sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                                  {hoveredAsset.commissioned_date}
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.voltage && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Voltage</Typography>
                                <Typography variant="body2" sx={{ color: '#3b82f6', fontSize: 11 }}>
                                  {hoveredAsset.voltage}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Coordinates</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
                                {hoveredAsset.latitude.toFixed(6)}, {hoveredAsset.longitude.toFixed(6)}
                              </Typography>
                            </Box>
                          </>
                        )}
                        
                        {hoveredAsset.type === 'meter' && (
                          <>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset Type</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, textTransform: 'capitalize', color: '#9333EA' }}>
                                {hoveredAsset.type}
                              </Typography>
                            </Box>
                            {hoveredAsset.name && hoveredAsset.name !== hoveredAsset.id && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Name</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                                  {hoveredAsset.name}
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.usage_kwh !== undefined && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Usage</Typography>
                                <Typography variant="h6" sx={{ color: '#10b981', fontWeight: 800, fontSize: 16, lineHeight: 1 }}>
                                  {hoveredAsset.usage_kwh} kWh
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset ID</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                {hoveredAsset.id}
                              </Typography>
                            </Box>
                            {hoveredAsset.last_maintenance && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Last Maintenance</Typography>
                                <Typography variant="body2" sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                                  {hoveredAsset.last_maintenance}
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.commissioned_date && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Commissioned</Typography>
                                <Typography variant="body2" sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                                  {hoveredAsset.commissioned_date}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Coordinates</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
                                {hoveredAsset.latitude.toFixed(6)}, {hoveredAsset.longitude.toFixed(6)}
                              </Typography>
                            </Box>
                          </>
                        )}
                        
                        {hoveredAsset.type === 'pole' && (
                          <>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset Type</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, textTransform: 'capitalize', color: '#8880FF' }}>
                                {hoveredAsset.type}
                              </Typography>
                            </Box>
                            {hoveredAsset.name && hoveredAsset.name !== hoveredAsset.id && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Name</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                                  {hoveredAsset.name}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Asset ID</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                                {hoveredAsset.id}
                              </Typography>
                            </Box>
                            {hoveredAsset.health_score !== undefined && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Health Score</Typography>
                                <Typography variant="h6" sx={{ 
                                  color: hoveredAsset.health_score > 80 ? '#22C55E' : hoveredAsset.health_score > 50 ? '#FBBF24' : '#EF4444', 
                                  fontWeight: 800,
                                  fontSize: 18,
                                  lineHeight: 1
                                }}>
                                  {hoveredAsset.health_score}%
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.pole_height_ft !== undefined && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Height</Typography>
                                <Typography variant="body2" sx={{ color: '#3b82f6', fontSize: 11 }}>
                                  {hoveredAsset.pole_height_ft} ft
                                </Typography>
                              </Box>
                            )}
                            {hoveredAsset.commissioned_date && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Commissioned</Typography>
                                <Typography variant="body2" sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                                  {hoveredAsset.commissioned_date}
                                </Typography>
                              </Box>
                            )}
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Coordinates</Typography>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
                                {hoveredAsset.latitude.toFixed(6)}, {hoveredAsset.longitude.toFixed(6)}
                              </Typography>
                            </Box>
                          </>
                        )}
                      </Stack>
                    </Paper>
                  </Fade>
                )}

                {/* Spatial Object Hover Tooltip - Buildings, Power Lines, Vegetation */}
                {hoveredSpatialObject && spatialHoverPosition && (
                  <Fade in timeout={150}>
                    <Paper
                      elevation={12}
                      sx={{
                        position: 'absolute',
                        left: spatialHoverPosition.x + 15,
                        top: spatialHoverPosition.y + 15,
                        pointerEvents: 'none',
                        bgcolor: 'rgba(15, 23, 42, 0.6)',
                        backdropFilter: 'blur(20px)',
                        border: `2px solid ${
                          hoveredSpatialObject.type === 'building' ? 'rgba(249, 115, 22, 0.6)' :
                          hoveredSpatialObject.type === 'power_line' ? 'rgba(251, 191, 36, 0.6)' :
                          'rgba(34, 197, 94, 0.6)'
                        }`,
                        borderRadius: 2,
                        p: 1.5,
                        minWidth: 200,
                        maxWidth: 260,
                        zIndex: 10000,
                        boxShadow: `0 8px 32px ${
                          hoveredSpatialObject.type === 'building' ? 'rgba(249, 115, 22, 0.2)' :
                          hoveredSpatialObject.type === 'power_line' ? 'rgba(251, 191, 36, 0.2)' :
                          'rgba(34, 197, 94, 0.2)'
                        }`
                      }}
                    >
                      <Stack spacing={0.75} divider={<Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />}>
                        {hoveredSpatialObject.type === 'building' && (
                          <>
                            {/* Show building name prominently if available */}
                            {(() => {
                              const bldg = hoveredSpatialObject as SpatialBuilding;
                              const hasRealName = bldg.building_name && 
                                !['Unnamed', 'unnamed', 'Unknown', 'unknown', 'Yes', 'yes', ''].includes(bldg.building_name);
                              return hasRealName ? (
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, color: '#F97316' }}>
                                    {bldg.building_name}
                                  </Typography>
                                </Box>
                              ) : (
                                <Box>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Layer Type</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, textTransform: 'capitalize', color: '#F97316' }}>
                                    Building Footprint
                                  </Typography>
                                </Box>
                              );
                            })()}
                            {(hoveredSpatialObject as SpatialBuilding).building_type && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Building Type</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12, textTransform: 'capitalize' }}>
                                  {(hoveredSpatialObject as SpatialBuilding).building_type}
                                </Typography>
                              </Box>
                            )}
                            {(hoveredSpatialObject as SpatialBuilding).height_meters && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Height</Typography>
                                <Typography variant="body2" sx={{ color: '#3b82f6', fontSize: 11 }}>
                                  {(hoveredSpatialObject as SpatialBuilding).height_meters}m
                                  {(hoveredSpatialObject as SpatialBuilding).num_floors && ` (${(hoveredSpatialObject as SpatialBuilding).num_floors} floors)`}
                                </Typography>
                              </Box>
                            )}
                            {(hoveredSpatialObject as SpatialBuilding).footprint_area_sqm && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Footprint Area</Typography>
                                <Typography variant="body2" sx={{ fontSize: 11 }}>
                                  {(hoveredSpatialObject as SpatialBuilding).footprint_area_sqm?.toLocaleString()} m²
                                </Typography>
                              </Box>
                            )}
                          </>
                        )}

                        {hoveredSpatialObject.type === 'power_line' && (
                          <>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Layer Type</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, color: '#FBBF24' }}>
                                Power Line
                              </Typography>
                            </Box>
                            {(hoveredSpatialObject as SpatialPowerLine).line_name && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Line Name</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>
                                  {(hoveredSpatialObject as SpatialPowerLine).line_name}
                                </Typography>
                              </Box>
                            )}
                            {(hoveredSpatialObject as SpatialPowerLine).voltage_kv && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Voltage</Typography>
                                <Typography variant="body2" sx={{ color: '#3b82f6', fontWeight: 700, fontSize: 13 }}>
                                  {(hoveredSpatialObject as SpatialPowerLine).voltage_kv} kV
                                </Typography>
                              </Box>
                            )}
                            {(hoveredSpatialObject as SpatialPowerLine).length_km && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Length</Typography>
                                <Typography variant="body2" sx={{ fontSize: 11 }}>
                                  {(hoveredSpatialObject as SpatialPowerLine).length_km?.toFixed(2)} km
                                </Typography>
                              </Box>
                            )}
                          </>
                        )}

                        {hoveredSpatialObject.type === 'vegetation' && (
                          <>
                            <Box>
                              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Layer Type</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, color: '#22C55E' }}>
                                Vegetation Risk
                              </Typography>
                            </Box>
                            {(() => {
                              const veg = hoveredSpatialObject as SpatialVegetation;
                              const risk = veg.risk_score || veg.proximity_risk || 0;
                              return (
                                <Box>
                                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Risk Score</Typography>
                                  <Typography variant="h6" sx={{ 
                                    color: risk > 0.7 ? '#EF4444' : risk > 0.4 ? '#FBBF24' : '#22C55E', 
                                    fontWeight: 800,
                                    fontSize: 18,
                                    lineHeight: 1
                                  }}>
                                    {(risk * 100).toFixed(0)}%
                                  </Typography>
                                </Box>
                              );
                            })()}
                            {(hoveredSpatialObject as SpatialVegetation).height_m && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Tree Height</Typography>
                                <Typography variant="body2" sx={{ fontSize: 11 }}>
                                  {(hoveredSpatialObject as SpatialVegetation).height_m}m
                                </Typography>
                              </Box>
                            )}
                            {(hoveredSpatialObject as SpatialVegetation).species && (
                              <Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Species</Typography>
                                <Typography variant="body2" sx={{ fontSize: 11, textTransform: 'capitalize' }}>
                                  {(hoveredSpatialObject as SpatialVegetation).species}
                                </Typography>
                              </Box>
                            )}
                          </>
                        )}
                      </Stack>
                    </Paper>
                  </Fade>
                )}

              </Box>
            </>
          </Box>

          {/* Other Tabs - Tab-specific skeleton loaders */}
          {currentTab > 0 && (
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 4, gap: 3, overflow: 'auto' }}>
              <Typography variant="h4" sx={{ color: '#29B5E8', fontWeight: 300, mb: 1 }}>
                {['Network Topology', 'Asset Health', 'AMI Analytics', 'Outage Management'][currentTab - 1]}
              </Typography>
              
              {/* Tab-specific layouts */}
              {currentTab === 1 && (
                // Network Topology - Graph visualization skeleton
                <Box sx={{ display: 'flex', gap: 3, height: '100%' }}>
                  <Card sx={{ flex: 2, bgcolor: 'rgba(41, 181, 232, 0.03)', border: '1px solid rgba(41, 181, 232, 0.1)' }}>
                    <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <Box sx={{ height: 32, width: 120, bgcolor: 'rgba(41, 181, 232, 0.15)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite' }} />
                        <Box sx={{ height: 32, width: 100, bgcolor: 'rgba(41, 181, 232, 0.15)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: '0.2s' }} />
                      </Box>
                      <Box sx={{ flexGrow: 1, bgcolor: 'rgba(41, 181, 232, 0.08)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
                        <Box sx={{ position: 'absolute', top: '30%', left: '20%', width: 60, height: 60, bgcolor: 'rgba(41, 181, 232, 0.3)', borderRadius: '50%', animation: 'pulse 2s ease-in-out infinite' }} />
                        <Box sx={{ position: 'absolute', top: '50%', right: '25%', width: 50, height: 50, bgcolor: 'rgba(6, 182, 212, 0.3)', borderRadius: '50%', animation: 'pulse 2s ease-in-out infinite', animationDelay: '0.3s' }} />
                        <Box sx={{ position: 'absolute', bottom: '25%', left: '40%', width: 55, height: 55, bgcolor: 'rgba(14, 165, 233, 0.3)', borderRadius: '50%', animation: 'pulse 2s ease-in-out infinite', animationDelay: '0.6s' }} />
                      </Box>
                    </CardContent>
                  </Card>
                  <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {[0, 1, 2].map((i) => (
                      <Card key={i} sx={{ bgcolor: 'rgba(6, 182, 212, 0.03)', border: '1px solid rgba(6, 182, 212, 0.1)' }}>
                        <CardContent>
                          <Box sx={{ height: 16, width: '70%', bgcolor: 'rgba(6, 182, 212, 0.2)', borderRadius: 1, mb: 2, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                          <Box sx={{ height: 40, width: '100%', bgcolor: 'rgba(6, 182, 212, 0.1)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.2 + 0.1}s` }} />
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                </Box>
              )}
              
              {currentTab === 2 && (
                // Asset Health - Card grid skeleton
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 3 }}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Card key={i} sx={{ bgcolor: 'rgba(34, 197, 94, 0.03)', border: '1px solid rgba(34, 197, 94, 0.1)' }}>
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                          <Box sx={{ height: 20, width: '60%', bgcolor: 'rgba(34, 197, 94, 0.2)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
                          <Box sx={{ height: 20, width: 50, bgcolor: 'rgba(34, 197, 94, 0.3)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.1}s` }} />
                        </Box>
                        <Box sx={{ height: 80, width: '100%', bgcolor: 'rgba(34, 197, 94, 0.1)', borderRadius: 1, mb: 2, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.2}s` }} />
                        <Box sx={{ height: 16, width: '40%', bgcolor: 'rgba(34, 197, 94, 0.15)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.3}s` }} />
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              )}
              
              {currentTab === 3 && (
                // AMI Analytics - Table skeleton
                <Card sx={{ bgcolor: 'rgba(251, 191, 36, 0.03)', border: '1px solid rgba(251, 191, 36, 0.1)' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                      <Box sx={{ height: 32, width: 150, bgcolor: 'rgba(251, 191, 36, 0.2)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite' }} />
                      <Box sx={{ height: 32, width: 120, bgcolor: 'rgba(251, 191, 36, 0.15)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: '0.2s' }} />
                    </Box>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
                        <Box sx={{ height: 40, flex: 1, bgcolor: 'rgba(251, 191, 36, 0.1)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
                        <Box sx={{ height: 40, flex: 1, bgcolor: 'rgba(251, 191, 36, 0.08)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.1}s` }} />
                        <Box sx={{ height: 40, flex: 1, bgcolor: 'rgba(251, 191, 36, 0.12)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.2}s` }} />
                      </Box>
                    ))}
                  </CardContent>
                </Card>
              )}
              
              {currentTab === 4 && (
                // Outage Management - Map + list skeleton
                <Box sx={{ display: 'flex', gap: 3, height: '100%' }}>
                  <Card sx={{ flex: 3, bgcolor: 'rgba(239, 68, 68, 0.03)', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                    <CardContent sx={{ height: '100%' }}>
                      <Box sx={{ height: '100%', bgcolor: 'rgba(239, 68, 68, 0.08)', borderRadius: 2, position: 'relative' }}>
                        {[0, 1, 2, 3].map((i) => (
                          <Box key={i} sx={{ 
                            position: 'absolute', 
                            top: `${20 + i * 20}%`, 
                            left: `${15 + i * 20}%`, 
                            width: 40, 
                            height: 40, 
                            bgcolor: 'rgba(239, 68, 68, 0.4)', 
                            borderRadius: '50%', 
                            animation: 'pulse 2s ease-in-out infinite',
                            animationDelay: `${i * 0.3}s`
                          }} />
                        ))}
                      </Box>
                    </CardContent>
                  </Card>
                  <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Card key={i} sx={{ bgcolor: 'rgba(239, 68, 68, 0.03)', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                        <CardContent sx={{ py: 1.5 }}>
                          <Box sx={{ height: 16, width: '80%', bgcolor: 'rgba(239, 68, 68, 0.2)', borderRadius: 1, mb: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />
                          <Box sx={{ height: 12, width: '50%', bgcolor: 'rgba(239, 68, 68, 0.15)', borderRadius: 1, animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.15 + 0.1}s` }} />
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                </Box>
              )}
              
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, fontStyle: 'italic' }}>
                Coming Soon - Feature
              </Typography>
            </Box>
          )}
        </Box>

        {/* Draggable FAB - Grid Intelligence Assistant */}
        <DraggableFab
          visible={!chatDrawerOpen}
          spinning={fabSpinning}
          onPositionChange={setFabPosition}
          onClick={() => {
            setFabSpinning(true);
            setChatDrawerOpen(true);
            setTimeout(() => setFabSpinning(false), 1000);
          }}
        />

        {/* Chat Drawer */}
        <ChatDrawer
          open={chatDrawerOpen}
          onClose={() => {
            setFabSpinning(true);
            setChatDrawerOpen(false);
            setTimeout(() => setFabSpinning(false), 1000);
          }}
          fabPosition={fabPosition}
        />

      </Box>
    </ThemeProvider>
  );
}

export default App;
