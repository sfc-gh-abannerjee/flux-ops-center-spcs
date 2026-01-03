import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, ArcLayer, ColumnLayer, TextLayer } from '@deck.gl/layers';
import { AmbientLight, LightingEffect, _SunLight as SunLight } from '@deck.gl/core';
import { ThemeProvider, createTheme, CssBaseline, Box, AppBar, Toolbar, Typography, Tabs, Tab, Grid, Card, CardContent, Paper } from '@mui/material';
import { ElectricBolt, Assessment, Warning, Engineering, TrendingUp } from '@mui/icons-material';

// Flux brand colors
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#0EA5E9' }, // Flux Blue
    secondary: { main: '#FBBF24' }, // Electric Yellow
    background: {
      default: '#0F172A',
      paper: '#1E293B'
    }
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif'
  }
});

// Enhanced 3D viewport (60 degree pitch for street-view quality)
const INITIAL_VIEW_STATE = {
  longitude: -95.3698,
  latitude: 29.7604,
  zoom: 14,
  pitch: 65,
  bearing: -15,
  maxPitch: 85
};

// Professional lighting for 3D digital twin
const ambientLight = new AmbientLight({
  color: [255, 255, 255],
  intensity: 1.2
});

const sunLight = new SunLight({
  timestamp: Date.UTC(2024, 7, 1, 14),
  color: [255, 255, 255],
  intensity: 2.0,
  _shadow: true
});

const lightingEffect = new LightingEffect({ ambientLight, sunLight });

interface Asset {
  id: string;
  name: string;
  type: 'pole' | 'transformer' | 'meter' | 'substation';
  latitude: number;
  longitude: number;
  health_score?: number;
  load_percent?: number;
  usage_kwh?: number;
}

interface TopologyLink {
  from_asset_id: string;
  from_asset_type: string;
  to_asset_id: string;
  to_asset_type: string;
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
}

function KPICard({ title, value, subtitle, icon, color }: KPICardProps) {
  return (
    <Card sx={{ height: '100%', bgcolor: 'background.paper', borderLeft: `4px solid ${color}` }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="overline" color="text.secondary">{title}</Typography>
          <Box sx={{ color }}>{icon}</Box>
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>{value}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </CardContent>
    </Card>
  );
}

function App() {
  const [currentTab, setCurrentTab] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [topology, setTopology] = useState<TopologyLink[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [kpis, setKPIs] = useState({
    saidi: 152.3,
    saifi: 1.42,
    activeOutages: 8,
    totalLoad: 2847,
    crewsActive: 12
  });

  useEffect(() => {
    // Generate production-quality synthetic data for visualization
    const syntheticAssets: Asset[] = [];
    const centerLat = 29.7604;
    const centerLon = -95.3698;
    const spread = 0.15;
    
    // Generate 48 substations (matching real data)
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * 2 * Math.PI;
      const radius = 0.08 + Math.random() * 0.06;
      syntheticAssets.push({
        id: `SUB-${String(i).padStart(4, '0')}`,
        name: `Substation ${i}`,
        type: 'substation',
        latitude: centerLat + Math.cos(angle) * radius,
        longitude: centerLon + Math.sin(angle) * radius,
        load_percent: 60 + Math.random() * 35
      });
    }

    // Generate 500 poles
    for (let i = 0; i < 500; i++) {
      syntheticAssets.push({
        id: `POLE-${String(i).padStart(6, '0')}`,
        name: `Pole ${i}`,
        type: 'pole',
        latitude: centerLat + (Math.random() - 0.5) * spread,
        longitude: centerLon + (Math.random() - 0.5) * spread,
        health_score: 50 + Math.random() * 50
      });
    }

    // Generate 300 transformers
    for (let i = 0; i < 300; i++) {
      syntheticAssets.push({
        id: `XFMR-${String(i).padStart(6, '0')}`,
        name: `Transformer ${i}`,
        type: 'transformer',
        latitude: centerLat + (Math.random() - 0.5) * spread,
        longitude: centerLon + (Math.random() - 0.5) * spread,
        load_percent: 40 + Math.random() * 55
      });
    }

    // Generate 1500 meters
    for (let i = 0; i < 1500; i++) {
      syntheticAssets.push({
        id: `MTR-${String(i).padStart(6, '0')}`,
        name: `Meter ${i}`,
        type: 'meter',
        latitude: centerLat + (Math.random() - 0.5) * spread,
        longitude: centerLon + (Math.random() - 0.5) * spread,
        usage_kwh: 10 + Math.random() * 40
      });
    }
    
    setAssets(syntheticAssets);
    console.log(`Loaded ${syntheticAssets.length} synthetic assets for 3D visualization`);

    // Generate sample topology connections
    const syntheticTopology: TopologyLink[] = [];
    const substations = syntheticAssets.filter(a => a.type === 'substation');
    const transformers = syntheticAssets.filter(a => a.type === 'transformer');
    const poles = syntheticAssets.filter(a => a.type === 'pole');
    
    // Connect transformers to nearest substation
    transformers.forEach(transformer => {
      const nearest = substations.reduce((prev, curr) => {
        const prevDist = Math.hypot(prev.latitude - transformer.latitude, prev.longitude - transformer.longitude);
        const currDist = Math.hypot(curr.latitude - transformer.latitude, curr.longitude - transformer.longitude);
        return currDist < prevDist ? curr : prev;
      });
      
      syntheticTopology.push({
        from_asset_id: transformer.id,
        from_asset_type: 'transformer',
        to_asset_id: nearest.id,
        to_asset_type: 'substation',
        connection_type: 'feeds_to',
        from_latitude: transformer.latitude,
        from_longitude: transformer.longitude,
        to_latitude: nearest.latitude,
        to_longitude: nearest.longitude
      });
    });

    // Connect some poles to transformers
    poles.slice(0, 200).forEach(pole => {
      if (transformers.length > 0) {
        const randomTransformer = transformers[Math.floor(Math.random() * transformers.length)];
        syntheticTopology.push({
          from_asset_id: pole.id,
          from_asset_type: 'pole',
          to_asset_id: randomTransformer.id,
          to_asset_type: 'transformer',
          connection_type: 'supports',
          from_latitude: pole.latitude,
          from_longitude: pole.longitude,
          to_latitude: randomTransformer.latitude,
          to_longitude: randomTransformer.longitude
        });
      }
    });

    setTopology(syntheticTopology);
    console.log(`Generated ${syntheticTopology.length} network connections`);
  }, []);

  // Create 3D layers (NO BASEMAP - pure 3D visualization)
  const layers = [
    // Network connections - 3D arcs
    new ArcLayer({
      id: 'topology-arcs',
      data: topology,
      pickable: false,
      getSourcePosition: (d: TopologyLink) => [d.from_longitude, d.from_latitude],
      getTargetPosition: (d: TopologyLink) => [d.to_longitude, d.to_latitude],
      getSourceColor: (d: TopologyLink) => {
        if (d.connection_type === 'feeds_to') return [14, 165, 233, 180];
        return [251, 191, 36, 150];
      },
      getTargetColor: (d: TopologyLink) => {
        if (d.connection_type === 'feeds_to') return [14, 165, 233, 40];
        return [251, 191, 36, 40];
      },
      getWidth: 4,
      getHeight: 0.15,
      widthMinPixels: 2
    }),

    // Poles - 3D columns (green/yellow/red)
    new ColumnLayer({
      id: 'poles-3d',
      data: assets.filter(a => a.type === 'pole'),
      pickable: true,
      extruded: true,
      diskResolution: 8,
      radius: 8,
      elevationScale: 1,
      getPosition: (d: Asset) => [d.longitude, d.latitude],
      getElevation: (d: Asset) => {
        const health = d.health_score || 75;
        return 15 + (health / 100) * 10; // 15-25m
      },
      getFillColor: (d: Asset) => {
        const health = d.health_score || 75;
        if (health > 75) return [34, 197, 94, 255]; // Green
        if (health > 50) return [251, 191, 36, 255]; // Yellow
        return [239, 68, 68, 255]; // Red
      },
      material: {
        ambient: 0.8,
        diffuse: 0.5,
        shininess: 32,
        specularColor: [255, 255, 255]
      },
      onClick: (info) => info.object && setSelectedAsset(info.object)
    }),

    // Transformers - 3D cubes (blue/yellow/red)
    new ColumnLayer({
      id: 'transformers-3d',
      data: assets.filter(a => a.type === 'transformer'),
      pickable: true,
      extruded: true,
      diskResolution: 4,
      radius: 10,
      elevationScale: 1,
      getPosition: (d: Asset) => [d.longitude, d.latitude],
      getElevation: (d: Asset) => {
        const load = d.load_percent || 65;
        return 10 + (load / 100) * 15; // 10-25m
      },
      getFillColor: (d: Asset) => {
        const load = d.load_percent || 65;
        if (load > 85) return [239, 68, 68, 255];
        if (load > 70) return [251, 191, 36, 255];
        return [14, 165, 233, 255];
      },
      material: {
        ambient: 0.8,
        diffuse: 0.5,
        shininess: 32,
        specularColor: [255, 255, 255]
      },
      onClick: (info) => info.object && setSelectedAsset(info.object)
    }),

    // Meters - purple glowing dots
    new ScatterplotLayer({
      id: 'meters',
      data: assets.filter(a => a.type === 'meter'),
      pickable: true,
      opacity: 0.9,
      stroked: true,
      filled: true,
      radiusScale: 6,
      radiusMinPixels: 4,
      radiusMaxPixels: 15,
      lineWidthMinPixels: 1,
      getPosition: (d: Asset) => [d.longitude, d.latitude],
      getRadius: (d: Asset) => 5 + ((d.usage_kwh || 25) / 50) * 5,
      getFillColor: [147, 51, 234, 240],
      getLineColor: [196, 181, 253, 180],
      onClick: (info) => info.object && setSelectedAsset(info.object)
    }),

    // Substations - tall yellow cylinders (critical infrastructure)
    new ColumnLayer({
      id: 'substations-3d',
      data: assets.filter(a => a.type === 'substation'),
      pickable: true,
      extruded: true,
      diskResolution: 20,
      radius: 18,
      elevationScale: 1,
      getPosition: (d: Asset) => [d.longitude, d.latitude],
      getElevation: 50, // Very tall 50m structures
      getFillColor: [251, 191, 36, 255],
      getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 2,
      material: {
        ambient: 0.9,
        diffuse: 0.6,
        shininess: 64,
        specularColor: [255, 255, 200]
      },
      onClick: (info) => info.object && setSelectedAsset(info.object)
    }),

    // Substation labels
    new TextLayer({
      id: 'substation-labels',
      data: assets.filter(a => a.type === 'substation'),
      pickable: false,
      getPosition: (d: Asset) => [d.longitude, d.latitude, 55],
      getText: (d: Asset) => `SUB-${d.id.split('-')[1]}`,
      getSize: 18,
      getColor: [251, 191, 36, 255],
      getAngle: 0,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      fontFamily: 'Inter, -apple-system, sans-serif',
      fontWeight: 700,
      outlineWidth: 4,
      outlineColor: [15, 23, 42, 255],
      backgroundColor: [15, 23, 42, 220],
      backgroundPadding: [6, 3]
    })
  ];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Header */}
        <AppBar position="static" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ElectricBolt sx={{ color: 'primary.main', fontSize: 32 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #0EA5E9 0%, #FBBF24 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Flux Operations Center
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Grid Operations • 3D Digital Twin • Real-time
            </Typography>
          </Toolbar>
          <Tabs value={currentTab} onChange={(_, v) => setCurrentTab(v)} sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Tab label="3D Operations View" />
            <Tab label="Network Topology" />
            <Tab label="Asset Health" />
          </Tabs>
        </AppBar>

        {/* Main Content */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', p: 2, gap: 2 }}>
          {currentTab === 0 && (
            <>
              {/* KPI Cards */}
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={2.4}>
                  <KPICard title="SAIDI" value={kpis.saidi.toFixed(1)} subtitle="Minutes" icon={<Assessment />} color="#0EA5E9" />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                  <KPICard title="SAIFI" value={kpis.saifi.toFixed(2)} subtitle="Interruptions" icon={<TrendingUp />} color="#FBBF24" />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                  <KPICard title="Active Outages" value={kpis.activeOutages} subtitle="1.2K Affected" icon={<Warning />} color="#EF4444" />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                  <KPICard title="Total Load" value={`${kpis.totalLoad} MW`} subtitle="82% Capacity" icon={<ElectricBolt />} color="#22C55E" />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                  <KPICard title="Field Crews" value={kpis.crewsActive} subtitle="8 En Route" icon={<Engineering />} color="#A855F7" />
                </Grid>
              </Grid>

              {/* 3D Map Container */}
              <Box sx={{ flexGrow: 1, position: 'relative', bgcolor: '#0A0E1A', borderRadius: 1, overflow: 'hidden' }}>
                <DeckGL
                  initialViewState={INITIAL_VIEW_STATE}
                  controller={true}
                  layers={layers}
                  effects={[lightingEffect]}
                  parameters={{
                    clearColor: [10, 14, 26, 1],
                    depthTest: true
                  }}
                  getTooltip={({ object }: { object?: Asset }) => object && {
                    html: `
                      <div style="font-family: Inter, sans-serif; padding: 8px 12px; background: rgba(30, 41, 59, 0.98); border-radius: 4px; color: white;">
                        <strong>${object.name}</strong><br/>
                        <span style="color: #94A3B8;">Type: ${object.type}</span><br/>
                        ${object.health_score ? `Health: ${object.health_score.toFixed(0)}%` : ''}
                        ${object.load_percent ? `Load: ${object.load_percent.toFixed(0)}%` : ''}
                        ${object.usage_kwh ? `Usage: ${object.usage_kwh.toFixed(1)} kWh` : ''}
                      </div>
                    `,
                    style: { backgroundColor: 'transparent', border: 'none' }
                  }}
                />

                {/* Selected Asset Details */}
                {selectedAsset && (
                  <Paper sx={{ 
                    position: 'absolute', 
                    top: 16, 
                    right: 16, 
                    p: 2.5, 
                    minWidth: 280,
                    bgcolor: 'rgba(30, 41, 59, 0.95)',
                    backdropFilter: 'blur(8px)',
                    borderLeft: `4px solid ${
                      selectedAsset.type === 'substation' ? '#FBBF24' :
                      selectedAsset.type === 'transformer' ? '#0EA5E9' :
                      selectedAsset.type === 'pole' ? '#22C55E' : '#9333EA'
                    }`
                  }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>{selectedAsset.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, fontFamily: 'monospace' }}>
                      {selectedAsset.id} • {selectedAsset.type.toUpperCase()}
                    </Typography>
                    {selectedAsset.health_score && (
                      <Box sx={{ mb: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">Health Score</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 700, color: selectedAsset.health_score > 75 ? '#22C55E' : selectedAsset.health_score > 50 ? '#FBBF24' : '#EF4444' }}>
                          {selectedAsset.health_score.toFixed(0)}%
                        </Typography>
                      </Box>
                    )}
                    {selectedAsset.load_percent && (
                      <Box sx={{ mb: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">Load Capacity</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 700, color: '#0EA5E9' }}>
                          {selectedAsset.load_percent.toFixed(0)}%
                        </Typography>
                      </Box>
                    )}
                    {selectedAsset.usage_kwh && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Power Usage</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 700, color: '#9333EA' }}>
                          {selectedAsset.usage_kwh.toFixed(1)} kWh
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                )}
              </Box>
            </>
          )}

          {currentTab > 0 && (
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="h6" color="text.secondary">
                {['Network Topology', 'Asset Health'][currentTab - 1]} - Coming Soon
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
