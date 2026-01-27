/**
 * Cascade Analysis Dashboard - Full-featured cascade failure analysis
 * 
 * Engineering: Dedicated dashboard for cascade failure analysis within Network Topology tab.
 * Provides comprehensive visualization of cascade propagation, risk assessment, and impact analysis.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Stack,
  LinearProgress,
  Tooltip,
  Alert,
  alpha,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Slider,
  Switch,
  FormControlLabel,
  Divider,
  Collapse,
} from '@mui/material';
import {
  Warning,
  PlayArrow,
  Stop,
  Timeline,
  ElectricalServices,
  Groups,
  Speed,
  TrendingUp,
  AccountTree,
  BarChart,
  Refresh,
  Science,
  BubbleChart,
  Layers,
  Tune,
  Map as MapIcon,
  ExpandMore,
  ExpandLess,
  AcUnit,
  Whatshot,
} from '@mui/icons-material';
import type { CascadeScenario, CascadeResult, CascadeNode, CascadeWaveBreakdown } from '../types';

// Regional cascade risk aggregation
interface RegionalCascadeRisk {
  region: string;
  county: string;
  node_count: number;
  high_risk_count: number;
  avg_criticality: number;
  total_downstream_transformers: number;
  estimated_customers_at_risk: number;
}

interface CascadeAnalysisDashboardProps {
  scenarios: CascadeScenario[];
  cascadeResult: CascadeResult | null;
  highRiskNodes: CascadeNode[];
  isSimulating: boolean;
  onSimulate: (scenario: CascadeScenario, patientZeroId?: string) => Promise<void>;
  onClear: () => void;
  onLoadHighRisk: () => Promise<void>;
  onLoadPredictions: () => Promise<void>;
  visible: boolean;
  onToggleVisibility: () => void;
}

// Wave breakdown data extraction
function useWaveBreakdown(cascadeResult: CascadeResult | null) {
  return useMemo<CascadeWaveBreakdown[]>(() => {
    if (!cascadeResult?.cascade_order) return [];
    
    const waves: Map<number, CascadeWaveBreakdown> = new Map();
    
    cascadeResult.cascade_order.forEach((node) => {
      const waveNum = node.wave_depth ?? Math.floor(node.order / 5) + 1;
      const existing = waves.get(waveNum) || {
        wave_number: waveNum,
        nodes_failed: 0,
        capacity_lost_mw: 0,
        customers_affected: 0,
        substations: 0,
        transformers: 0,
      };
      
      existing.nodes_failed++;
      existing.capacity_lost_mw += (node.capacity_kw || 0) / 1000;
      existing.customers_affected += node.downstream_transformers * 50 || 0;
      
      if (node.node_type === 'SUBSTATION') {
        existing.substations++;
      } else {
        existing.transformers++;
      }
      
      waves.set(waveNum, existing);
    });
    
    return Array.from(waves.values()).sort((a, b) => a.wave_number - b.wave_number);
  }, [cascadeResult]);
}

// Sankey-style cascade flow visualization
function CascadeFlowVisualization({ cascadeResult, waveBreakdown }: { cascadeResult: CascadeResult; waveBreakdown: CascadeWaveBreakdown[] }) {
  if (waveBreakdown.length === 0) return null;

  const totalCapacity = waveBreakdown.reduce((sum, w) => sum + w.capacity_lost_mw, 0);
  const maxCapacity = Math.max(...waveBreakdown.map(w => w.capacity_lost_mw));
  const waveColors = ['#FF4500', '#FF6600', '#FF8800', '#FFAA00', '#FFCC00'];

  return (
    <Card sx={{ bgcolor: 'rgba(255, 107, 107, 0.05)', border: '1px solid rgba(255, 107, 107, 0.2)' }}>
      <CardContent>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, color: '#FF6B6B' }}>
          <AccountTree /> Cascade Flow Visualization
        </Typography>
        
        {/* Horizontal flow diagram */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1,
          overflowX: 'auto',
          pb: 2,
          px: 2
        }}>
          {/* Patient Zero Source */}
          <Paper sx={{
            minWidth: 100,
            p: 2,
            bgcolor: alpha('#FF0000', 0.15),
            border: '2px solid #FF0000',
            textAlign: 'center',
            borderRadius: 2
          }}>
            <Typography variant="caption" fontWeight={700} sx={{ color: '#FF0000', display: 'block' }}>
              PATIENT ZERO
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
              {cascadeResult.patient_zero?.node_name || cascadeResult.patient_zero?.node_id || 'Auto-selected'}
            </Typography>
          </Paper>
          
          {/* Flow arrows and wave nodes */}
          {waveBreakdown.slice(0, 5).map((wave, idx) => {
            const widthPercent = maxCapacity > 0 ? (wave.capacity_lost_mw / maxCapacity) * 100 : 50;
            const color = waveColors[Math.min(idx, waveColors.length - 1)];
            
            return (
              <React.Fragment key={wave.wave_number}>
                {/* Arrow */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Box sx={{ 
                    width: Math.max(40, widthPercent * 0.5), 
                    height: 4, 
                    bgcolor: color,
                    borderRadius: 2
                  }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', mt: 0.5 }}>
                    {wave.capacity_lost_mw.toFixed(0)} MW
                  </Typography>
                </Box>
                
                {/* Wave node */}
                <Tooltip
                  title={
                    <Box sx={{ p: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700}>Wave {wave.wave_number}</Typography>
                      <Typography variant="body2">{wave.nodes_failed} nodes failed</Typography>
                      <Typography variant="body2">{wave.substations} substations, {wave.transformers} transformers</Typography>
                      <Typography variant="body2">{wave.capacity_lost_mw.toFixed(1)} MW capacity lost</Typography>
                    </Box>
                  }
                >
                  <Paper sx={{
                    minWidth: 80,
                    p: 1.5,
                    bgcolor: alpha(color, 0.15),
                    border: `2px solid ${color}`,
                    textAlign: 'center',
                    borderRadius: 2,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    '&:hover': {
                      bgcolor: alpha(color, 0.25),
                      transform: 'scale(1.05)'
                    }
                  }}>
                    <Typography variant="h6" sx={{ color, fontWeight: 700 }}>
                      W{wave.wave_number}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                      {wave.nodes_failed} nodes
                    </Typography>
                  </Paper>
                </Tooltip>
              </React.Fragment>
            );
          })}
          
          {/* Final arrow to impact */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{ width: 60, height: 4, bgcolor: '#3B82F6', borderRadius: 2 }} />
          </Box>
          
          {/* Impact Target */}
          <Paper sx={{
            minWidth: 100,
            p: 2,
            bgcolor: alpha('#3B82F6', 0.15),
            border: '2px solid #3B82F6',
            textAlign: 'center',
            borderRadius: 2
          }}>
            <Groups sx={{ color: '#3B82F6', fontSize: 28 }} />
            <Typography variant="h5" fontWeight={700} sx={{ color: '#3B82F6' }}>
              {(cascadeResult.estimated_customers_affected / 1000).toFixed(0)}K
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Customers Impacted
            </Typography>
          </Paper>
        </Box>
        
        {/* Wave legend */}
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          mt: 2,
          pt: 2,
          borderTop: '1px solid',
          borderColor: alpha('#fff', 0.1)
        }}>
          <Typography variant="body2" color="text.secondary">
            Total Propagation: {waveBreakdown.length} waves, {totalCapacity.toFixed(1)} MW capacity lost
          </Typography>
          <Stack direction="row" spacing={0.5}>
            {waveColors.slice(0, Math.min(waveBreakdown.length, 5)).map((color, i) => (
              <Tooltip key={i} title={`Wave ${i + 1}`}>
                <Box sx={{ width: 16, height: 16, borderRadius: 1, bgcolor: color }} />
              </Tooltip>
            ))}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

// Wave breakdown bar chart component
function WaveBreakdownPanel({ waveBreakdown }: { waveBreakdown: CascadeWaveBreakdown[] }) {
  if (waveBreakdown.length === 0) return null;

  const maxTotal = Math.max(...waveBreakdown.map(d => d.nodes_failed));
  const waveColors = ['#FF4500', '#FF6600', '#FF8800', '#FFAA00', '#FFCC00'];

  return (
    <Card sx={{ bgcolor: 'rgba(251, 191, 36, 0.05)', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
      <CardContent>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, color: '#FBBF24' }}>
          <BarChart /> Wave Breakdown by Asset Type
        </Typography>
        
        <Stack spacing={1.5}>
          {waveBreakdown.slice(0, 8).map((wave, idx) => {
            const widthPercent = maxTotal > 0 ? (wave.nodes_failed / maxTotal) * 100 : 0;
            const substationPercent = wave.nodes_failed > 0 ? (wave.substations / wave.nodes_failed) * widthPercent : 0;
            const transformerPercent = widthPercent - substationPercent;
            const color = waveColors[Math.min(idx, waveColors.length - 1)];
            
            return (
              <Box key={wave.wave_number} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" sx={{ minWidth: 60, color, fontWeight: 600 }}>
                  Wave {wave.wave_number}
                </Typography>
                <Box sx={{ flex: 1, height: 24, bgcolor: alpha('#fff', 0.05), borderRadius: 1, overflow: 'hidden', display: 'flex' }}>
                  <Tooltip title={`${wave.substations} substations`}>
                    <Box sx={{ 
                      width: `${substationPercent}%`, 
                      height: '100%', 
                      bgcolor: '#FBBF24',
                      transition: 'width 0.5s ease'
                    }} />
                  </Tooltip>
                  <Tooltip title={`${wave.transformers} transformers`}>
                    <Box sx={{ 
                      width: `${transformerPercent}%`, 
                      height: '100%', 
                      bgcolor: color,
                      transition: 'width 0.5s ease'
                    }} />
                  </Tooltip>
                </Box>
                <Typography variant="body2" sx={{ minWidth: 40, textAlign: 'right', color: 'text.secondary' }}>
                  {wave.nodes_failed}
                </Typography>
              </Box>
            );
          })}
        </Stack>
        
        {/* Legend */}
        <Stack direction="row" spacing={3} sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: alpha('#fff', 0.1) }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 16, height: 16, bgcolor: '#FBBF24', borderRadius: 0.5 }} />
            <Typography variant="body2" color="text.secondary">Substations</Typography>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 16, height: 16, bgcolor: '#FF6B6B', borderRadius: 0.5 }} />
            <Typography variant="body2" color="text.secondary">Transformers</Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

// High-risk nodes table
function HighRiskNodesTable({ highRiskNodes }: { highRiskNodes: CascadeNode[] }) {
  return (
    <Card sx={{ bgcolor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
      <CardContent>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, color: '#EF4444' }}>
          <Warning /> High-Risk Nodes (Patient Zero Candidates)
        </Typography>
        
        {highRiskNodes.length === 0 ? (
          <Alert severity="info" sx={{ bgcolor: 'rgba(59, 130, 246, 0.1)' }}>
            Click "Load ML Predictions" to identify high-risk nodes using graph centrality analysis.
          </Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 300 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600 }}>Node ID</TableCell>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600 }} align="right">Risk Score</TableCell>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600 }} align="right">Cascade Risk</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {highRiskNodes.slice(0, 15).map((node, idx) => (
                  <TableRow 
                    key={node.node_id}
                    sx={{ 
                      '&:hover': { bgcolor: alpha('#EF4444', 0.1) },
                      bgcolor: idx < 3 ? alpha('#EF4444', 0.05) : 'transparent'
                    }}
                  >
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {node.node_id.slice(0, 15)}...
                    </TableCell>
                    <TableCell>{node.node_name || '-'}</TableCell>
                    <TableCell>
                      <Chip 
                        label={node.node_type} 
                        size="small"
                        sx={{ 
                          bgcolor: node.node_type === 'SUBSTATION' ? alpha('#FBBF24', 0.2) : alpha('#3B82F6', 0.2),
                          color: node.node_type === 'SUBSTATION' ? '#FBBF24' : '#3B82F6',
                          fontSize: '0.7rem'
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                        <Box sx={{ 
                          width: 60, 
                          height: 8, 
                          bgcolor: alpha('#EF4444', 0.2),
                          borderRadius: 1,
                          overflow: 'hidden'
                        }}>
                          <Box sx={{ 
                            width: `${node.criticality_score * 100}%`, 
                            height: '100%', 
                            bgcolor: node.criticality_score > 0.7 ? '#EF4444' : node.criticality_score > 0.4 ? '#FBBF24' : '#22C55E'
                          }} />
                        </Box>
                        <Typography variant="body2" sx={{ minWidth: 40 }}>
                          {(node.criticality_score * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {node.cascade_risk?.toFixed(4) || node.criticality_score.toFixed(4)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

// Regional Analysis Panel - Aggregates cascade risk by county/region
function RegionalAnalysisPanel({ highRiskNodes, cascadeResult }: { highRiskNodes: CascadeNode[]; cascadeResult: CascadeResult | null }) {
  const [expanded, setExpanded] = useState(true);
  
  // Aggregate risk by region (derived from node names/IDs)
  const regionalData = useMemo<RegionalCascadeRisk[]>(() => {
    // Build regional aggregation from high-risk nodes and cascade results
    const regionMap = new Map<string, RegionalCascadeRisk>();
    
    // Extract region from node name (e.g., "SUB-HOU-124" -> "HOU" -> "Houston")
    const getRegion = (nodeId: string, nodeName?: string): { region: string; county: string } => {
      const id = nodeId.toUpperCase();
      if (id.includes('HOU') || nodeName?.toLowerCase().includes('houston')) {
        return { region: 'Houston Metro', county: 'Harris' };
      }
      if (id.includes('GAL') || nodeName?.toLowerCase().includes('galveston')) {
        return { region: 'Coastal', county: 'Galveston' };
      }
      if (id.includes('BRA') || nodeName?.toLowerCase().includes('brazoria')) {
        return { region: 'Coastal', county: 'Brazoria' };
      }
      if (id.includes('MON') || nodeName?.toLowerCase().includes('montgomery')) {
        return { region: 'North', county: 'Montgomery' };
      }
      if (id.includes('FBN') || id.includes('FTB') || nodeName?.toLowerCase().includes('fort bend')) {
        return { region: 'Southwest', county: 'Fort Bend' };
      }
      if (id.includes('WAL') || nodeName?.toLowerCase().includes('waller')) {
        return { region: 'West', county: 'Waller' };
      }
      if (id.includes('LIB') || nodeName?.toLowerCase().includes('liberty')) {
        return { region: 'East', county: 'Liberty' };
      }
      if (id.includes('CHA') || nodeName?.toLowerCase().includes('chambers')) {
        return { region: 'Coastal', county: 'Chambers' };
      }
      // Default to Houston Metro if unknown
      return { region: 'Houston Metro', county: 'Harris' };
    };
    
    // Process high-risk nodes
    highRiskNodes.forEach(node => {
      const { region, county } = getRegion(node.node_id, node.node_name || undefined);
      const key = `${region}-${county}`;
      
      if (!regionMap.has(key)) {
        regionMap.set(key, {
          region,
          county,
          node_count: 0,
          high_risk_count: 0,
          avg_criticality: 0,
          total_downstream_transformers: 0,
          estimated_customers_at_risk: 0,
        });
      }
      
      const data = regionMap.get(key)!;
      data.node_count++;
      if (node.criticality_score > 0.6) data.high_risk_count++;
      data.avg_criticality = ((data.avg_criticality * (data.node_count - 1)) + node.criticality_score) / data.node_count;
      data.total_downstream_transformers += node.downstream_transformers || 0;
      data.estimated_customers_at_risk += (node.downstream_transformers || 0) * 50;
    });
    
    // If we have cascade result, augment with affected nodes
    if (cascadeResult?.cascade_order) {
      cascadeResult.cascade_order.forEach(node => {
        const { region, county } = getRegion(node.node_id, node.node_name || undefined);
        const key = `${region}-${county}`;
        
        if (!regionMap.has(key)) {
          regionMap.set(key, {
            region,
            county,
            node_count: 0,
            high_risk_count: 0,
            avg_criticality: 0,
            total_downstream_transformers: 0,
            estimated_customers_at_risk: 0,
          });
        }
        
        const data = regionMap.get(key)!;
        // Mark as affected in cascade
        data.high_risk_count = Math.max(data.high_risk_count, 1);
      });
    }
    
    return Array.from(regionMap.values())
      .sort((a, b) => b.estimated_customers_at_risk - a.estimated_customers_at_risk);
  }, [highRiskNodes, cascadeResult]);

  const maxCustomers = Math.max(...regionalData.map(r => r.estimated_customers_at_risk), 1);
  const totalCustomersAtRisk = regionalData.reduce((sum, r) => sum + r.estimated_customers_at_risk, 0);

  if (regionalData.length === 0) return null;

  return (
    <Card sx={{ bgcolor: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
      <CardContent>
        <Box 
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#22C55E' }}>
            <MapIcon /> Regional Cascade Risk Analysis
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Chip 
              label={`${(totalCustomersAtRisk / 1000).toFixed(0)}K Customers at Risk`}
              size="small"
              sx={{ bgcolor: alpha('#22C55E', 0.2), color: '#22C55E' }}
            />
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </Stack>
        </Box>

        <Collapse in={expanded}>
          <Box sx={{ mt: 3 }}>
            {/* Summary Stats */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={4}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: alpha('#22C55E', 0.1) }}>
                  <Typography variant="h4" sx={{ color: '#22C55E', fontWeight: 700 }}>
                    {regionalData.length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Regions Analyzed</Typography>
                </Paper>
              </Grid>
              <Grid item xs={4}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: alpha('#FBBF24', 0.1) }}>
                  <Typography variant="h4" sx={{ color: '#FBBF24', fontWeight: 700 }}>
                    {regionalData.reduce((sum, r) => sum + r.high_risk_count, 0)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">High-Risk Nodes</Typography>
                </Paper>
              </Grid>
              <Grid item xs={4}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: alpha('#3B82F6', 0.1) }}>
                  <Typography variant="h4" sx={{ color: '#3B82F6', fontWeight: 700 }}>
                    {(totalCustomersAtRisk / 1000).toFixed(0)}K
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Customers at Risk</Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Regional Risk Bars */}
            <Typography variant="subtitle2" sx={{ mb: 2, color: 'text.secondary' }}>
              Risk Distribution by County
            </Typography>
            <Stack spacing={1.5}>
              {regionalData.slice(0, 8).map((region) => {
                const widthPercent = (region.estimated_customers_at_risk / maxCustomers) * 100;
                const riskColor = region.avg_criticality > 0.7 ? '#EF4444' : region.avg_criticality > 0.4 ? '#FBBF24' : '#22C55E';
                
                return (
                  <Box key={`${region.region}-${region.county}`}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {region.county} County
                        <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                          ({region.region})
                        </Typography>
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Tooltip title="High-risk nodes in this region">
                          <Chip 
                            label={`${region.high_risk_count} critical`}
                            size="small"
                            sx={{ 
                              height: 20, 
                              fontSize: '0.65rem',
                              bgcolor: alpha(riskColor, 0.2),
                              color: riskColor
                            }}
                          />
                        </Tooltip>
                        <Typography variant="body2" sx={{ minWidth: 60, textAlign: 'right' }}>
                          {(region.estimated_customers_at_risk / 1000).toFixed(0)}K
                        </Typography>
                      </Stack>
                    </Box>
                    <Box sx={{ height: 8, bgcolor: alpha('#fff', 0.05), borderRadius: 1, overflow: 'hidden' }}>
                      <Tooltip title={`${region.estimated_customers_at_risk.toLocaleString()} customers potentially affected`}>
                        <Box sx={{ 
                          width: `${widthPercent}%`, 
                          height: '100%', 
                          bgcolor: riskColor,
                          transition: 'width 0.5s ease',
                          borderRadius: 1
                        }} />
                      </Tooltip>
                    </Box>
                  </Box>
                );
              })}
            </Stack>

            {/* Risk Legend */}
            <Stack direction="row" spacing={3} sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: alpha('#fff', 0.1) }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 12, height: 12, bgcolor: '#EF4444', borderRadius: 0.5 }} />
                <Typography variant="caption" color="text.secondary">Critical Risk (&gt;70%)</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 12, height: 12, bgcolor: '#FBBF24', borderRadius: 0.5 }} />
                <Typography variant="caption" color="text.secondary">Elevated Risk (40-70%)</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 12, height: 12, bgcolor: '#22C55E', borderRadius: 0.5 }} />
                <Typography variant="caption" color="text.secondary">Normal (&lt;40%)</Typography>
              </Stack>
            </Stack>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

// Main dashboard component
export function CascadeAnalysisDashboard({
  scenarios,
  cascadeResult,
  highRiskNodes,
  isSimulating,
  onSimulate,
  onClear,
  onLoadHighRisk,
  onLoadPredictions,
  visible,
  onToggleVisibility,
}: CascadeAnalysisDashboardProps) {
  const [selectedScenario, setSelectedScenario] = useState<string>(scenarios[0]?.name || '');
  const [selectedPatientZero, setSelectedPatientZero] = useState<string>('');
  const waveBreakdown = useWaveBreakdown(cascadeResult);
  
  // Custom scenario parameters state
  const [customMode, setCustomMode] = useState(false);
  const [customTemperature, setCustomTemperature] = useState(25);
  const [customLoadMultiplier, setCustomLoadMultiplier] = useState(1.0);
  const [customFailureThreshold, setCustomFailureThreshold] = useState(0.65);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  
  // Sync custom parameters when scenario changes
  useEffect(() => {
    if (!customMode) {
      const scenario = scenarios.find(s => s.name === selectedScenario);
      if (scenario) {
        setCustomTemperature(scenario.parameters.temperature_c);
        setCustomLoadMultiplier(scenario.parameters.load_multiplier);
        setCustomFailureThreshold(scenario.parameters.failure_threshold);
      }
    }
  }, [selectedScenario, scenarios, customMode]);
  
  // Load high-risk nodes on mount
  useEffect(() => {
    if (highRiskNodes.length === 0) {
      onLoadHighRisk();
    }
  }, [highRiskNodes.length, onLoadHighRisk]);

  const handleSimulate = async () => {
    // Build scenario with custom parameters if in custom mode
    const baseScenario = scenarios.find(s => s.name === selectedScenario);
    if (!baseScenario && !customMode) return;
    
    const scenarioToRun: CascadeScenario = customMode ? {
      name: 'Custom Scenario',
      description: `Custom parameters: ${customTemperature}°C, ${customLoadMultiplier}x load`,
      parameters: {
        temperature_c: customTemperature,
        load_multiplier: customLoadMultiplier,
        failure_threshold: customFailureThreshold,
      }
    } : {
      ...baseScenario!,
      parameters: {
        temperature_c: customTemperature,
        load_multiplier: customLoadMultiplier,
        failure_threshold: customFailureThreshold,
      }
    };
    
    await onSimulate(scenarioToRun, selectedPatientZero || undefined);
  };

  const getScenarioIcon = (name: string) => {
    if (name.includes('Winter')) return '❄️';
    if (name.includes('Summer')) return '🌡️';
    if (name.includes('Hurricane')) return '🌀';
    return '⚡';
  };
  
  // Temperature color based on value
  const getTempColor = (temp: number) => {
    if (temp < 0) return '#3B82F6'; // Cold blue
    if (temp < 15) return '#22C55E'; // Cool green  
    if (temp < 30) return '#FBBF24'; // Warm yellow
    return '#EF4444'; // Hot red
  };

  const selectedScenarioData = scenarios.find(s => s.name === selectedScenario);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 3, p: 3, overflow: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#FF6B6B', fontWeight: 300, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Timeline sx={{ fontSize: 36 }} />
            Cascade Failure Analysis
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            ML-powered cascade propagation simulation using NetworkX graph centrality analysis
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant={visible ? 'contained' : 'outlined'}
            startIcon={<Layers />}
            onClick={onToggleVisibility}
            sx={{
              bgcolor: visible ? alpha('#FF6B6B', 0.2) : 'transparent',
              borderColor: '#FF6B6B',
              color: '#FF6B6B',
              '&:hover': { bgcolor: alpha('#FF6B6B', 0.3) }
            }}
          >
            {visible ? 'Hide Map Layers' : 'Show Map Layers'}
          </Button>
        </Stack>
      </Box>

      {/* Simulation Controls */}
      <Card sx={{ bgcolor: 'rgba(41, 181, 232, 0.05)', border: '1px solid rgba(41, 181, 232, 0.2)' }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#29B5E8' }}>
              <Science /> Scenario Builder
            </Typography>
            <FormControlLabel
              control={
                <Switch 
                  checked={customMode} 
                  onChange={(e) => setCustomMode(e.target.checked)}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#8B5CF6' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#8B5CF6' },
                  }}
                />
              }
              label={
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Tune sx={{ fontSize: 18, color: customMode ? '#8B5CF6' : 'text.secondary' }} />
                  <Typography variant="body2" sx={{ color: customMode ? '#8B5CF6' : 'text.secondary' }}>
                    Custom Parameters
                  </Typography>
                </Stack>
              }
            />
          </Box>
          
          <Grid container spacing={3}>
            {/* Scenario Selection */}
            <Grid item xs={12} md={4}>
              <FormControl fullWidth disabled={customMode}>
                <InputLabel>Scenario Preset</InputLabel>
                <Select
                  value={selectedScenario}
                  label="Scenario Preset"
                  onChange={(e) => setSelectedScenario(e.target.value)}
                >
                  {scenarios.map((scenario) => (
                    <MenuItem key={scenario.name} value={scenario.name}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <span>{getScenarioIcon(scenario.name)}</span>
                        <span>{scenario.name}</span>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Patient Zero Selection */}
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Patient Zero (Optional)</InputLabel>
                <Select
                  value={selectedPatientZero}
                  label="Patient Zero (Optional)"
                  onChange={(e) => setSelectedPatientZero(e.target.value)}
                >
                  <MenuItem value="">
                    <em>Auto-select (highest risk node)</em>
                  </MenuItem>
                  {highRiskNodes.slice(0, 20).map((node) => (
                    <MenuItem key={node.node_id} value={node.node_id}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                        <Warning sx={{ color: '#FF6B6B', fontSize: 18 }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2">
                            {node.node_name || node.node_id.slice(0, 20)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Risk: {(node.criticality_score * 100).toFixed(0)}%
                          </Typography>
                        </Box>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Action Buttons */}
            <Grid item xs={12} md={4}>
              <Stack direction="row" spacing={2} sx={{ height: '100%' }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleSimulate}
                  disabled={isSimulating || (!selectedScenario && !customMode)}
                  startIcon={isSimulating ? <Speed /> : <PlayArrow />}
                  sx={{
                    bgcolor: '#FF6B6B',
                    height: 56,
                    '&:hover': { bgcolor: '#FF5252' },
                    '&:disabled': { bgcolor: alpha('#FF6B6B', 0.3) }
                  }}
                >
                  {isSimulating ? 'Simulating...' : 'Run Simulation'}
                </Button>
                {cascadeResult && (
                  <Tooltip title="Clear Results">
                    <Button
                      variant="outlined"
                      onClick={onClear}
                      sx={{ borderColor: alpha('#fff', 0.3), minWidth: 56 }}
                    >
                      <Stop />
                    </Button>
                  </Tooltip>
                )}
              </Stack>
            </Grid>
          </Grid>

          {/* Interactive Parameter Sliders */}
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: alpha('#fff', 0.1) }}>
            <Box 
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, cursor: 'pointer' }}
              onClick={() => setShowAdvancedControls(!showAdvancedControls)}
            >
              <Typography variant="subtitle2" sx={{ color: customMode ? '#8B5CF6' : '#29B5E8' }}>
                {customMode ? '🎛️ Custom Scenario Parameters' : '⚙️ Adjust Scenario Parameters'}
              </Typography>
              {showAdvancedControls ? <ExpandLess /> : <ExpandMore />}
            </Box>
            
            <Collapse in={showAdvancedControls || customMode}>
              <Grid container spacing={4} sx={{ mt: 1 }}>
                {/* Temperature Slider */}
                <Grid item xs={12} md={4}>
                  <Box sx={{ px: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {customTemperature < 10 ? (
                          <AcUnit sx={{ color: getTempColor(customTemperature), fontSize: 20 }} />
                        ) : (
                          <Whatshot sx={{ color: getTempColor(customTemperature), fontSize: 20 }} />
                        )}
                        <Typography variant="body2" fontWeight={600}>Temperature</Typography>
                      </Stack>
                      <Chip 
                        label={`${customTemperature}°C`}
                        size="small"
                        sx={{ 
                          bgcolor: alpha(getTempColor(customTemperature), 0.2),
                          color: getTempColor(customTemperature),
                          fontWeight: 700,
                          minWidth: 60
                        }}
                      />
                    </Stack>
                    <Slider
                      value={customTemperature}
                      onChange={(_, value) => setCustomTemperature(value as number)}
                      min={-25}
                      max={50}
                      step={1}
                      marks={[
                        { value: -18, label: '-18°' },
                        { value: 0, label: '0°' },
                        { value: 25, label: '25°' },
                        { value: 42, label: '42°' },
                      ]}
                      sx={{
                        color: getTempColor(customTemperature),
                        '& .MuiSlider-thumb': {
                          '&:hover, &.Mui-focusVisible': {
                            boxShadow: `0 0 0 8px ${alpha(getTempColor(customTemperature), 0.16)}`,
                          },
                        },
                        '& .MuiSlider-markLabel': {
                          fontSize: '0.65rem',
                          color: 'text.secondary',
                        },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {customTemperature < 0 ? 'Extreme cold - high heating demand' : 
                       customTemperature > 35 ? 'Extreme heat - high AC demand' : 'Moderate temperature'}
                    </Typography>
                  </Box>
                </Grid>

                {/* Load Multiplier Slider */}
                <Grid item xs={12} md={4}>
                  <Box sx={{ px: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <ElectricalServices sx={{ color: customLoadMultiplier > 1.5 ? '#EF4444' : '#22C55E', fontSize: 20 }} />
                        <Typography variant="body2" fontWeight={600}>Load Multiplier</Typography>
                      </Stack>
                      <Chip 
                        label={`${customLoadMultiplier.toFixed(1)}x`}
                        size="small"
                        sx={{ 
                          bgcolor: alpha(customLoadMultiplier > 1.5 ? '#EF4444' : customLoadMultiplier > 1.2 ? '#FBBF24' : '#22C55E', 0.2),
                          color: customLoadMultiplier > 1.5 ? '#EF4444' : customLoadMultiplier > 1.2 ? '#FBBF24' : '#22C55E',
                          fontWeight: 700,
                          minWidth: 60
                        }}
                      />
                    </Stack>
                    <Slider
                      value={customLoadMultiplier}
                      onChange={(_, value) => setCustomLoadMultiplier(value as number)}
                      min={0.3}
                      max={3.0}
                      step={0.1}
                      marks={[
                        { value: 0.5, label: '0.5x' },
                        { value: 1.0, label: '1.0x' },
                        { value: 1.8, label: '1.8x' },
                        { value: 2.5, label: '2.5x' },
                      ]}
                      sx={{
                        color: customLoadMultiplier > 1.5 ? '#EF4444' : customLoadMultiplier > 1.2 ? '#FBBF24' : '#22C55E',
                        '& .MuiSlider-markLabel': {
                          fontSize: '0.65rem',
                          color: 'text.secondary',
                        },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {customLoadMultiplier > 2.0 ? 'Crisis-level demand surge' :
                       customLoadMultiplier > 1.5 ? 'High demand - stress conditions' :
                       customLoadMultiplier < 0.8 ? 'Reduced load (evacuations/outages)' : 'Normal load conditions'}
                    </Typography>
                  </Box>
                </Grid>

                {/* Failure Threshold Slider */}
                <Grid item xs={12} md={4}>
                  <Box sx={{ px: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Warning sx={{ color: customFailureThreshold < 0.5 ? '#EF4444' : '#22C55E', fontSize: 20 }} />
                        <Typography variant="body2" fontWeight={600}>Failure Threshold</Typography>
                      </Stack>
                      <Chip 
                        label={`${(customFailureThreshold * 100).toFixed(0)}%`}
                        size="small"
                        sx={{ 
                          bgcolor: alpha(customFailureThreshold < 0.5 ? '#EF4444' : customFailureThreshold < 0.7 ? '#FBBF24' : '#22C55E', 0.2),
                          color: customFailureThreshold < 0.5 ? '#EF4444' : customFailureThreshold < 0.7 ? '#FBBF24' : '#22C55E',
                          fontWeight: 700,
                          minWidth: 60
                        }}
                      />
                    </Stack>
                    <Slider
                      value={customFailureThreshold}
                      onChange={(_, value) => setCustomFailureThreshold(value as number)}
                      min={0.1}
                      max={0.95}
                      step={0.05}
                      marks={[
                        { value: 0.15, label: '15%' },
                        { value: 0.4, label: '40%' },
                        { value: 0.65, label: '65%' },
                        { value: 0.8, label: '80%' },
                      ]}
                      sx={{
                        color: customFailureThreshold < 0.5 ? '#EF4444' : customFailureThreshold < 0.7 ? '#FBBF24' : '#22C55E',
                        '& .MuiSlider-markLabel': {
                          fontSize: '0.65rem',
                          color: 'text.secondary',
                        },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {customFailureThreshold < 0.4 ? 'Fragile grid - failures propagate easily' :
                       customFailureThreshold < 0.6 ? 'Stressed grid - moderate resilience' : 'Resilient grid - high failure resistance'}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </Collapse>
          </Box>

          {/* Current Configuration Summary */}
          <Alert 
            severity={customMode ? 'warning' : 'info'} 
            sx={{ 
              mt: 2, 
              bgcolor: alpha(customMode ? '#8B5CF6' : '#3B82F6', 0.1), 
              '& .MuiAlert-icon': { color: customMode ? '#8B5CF6' : '#3B82F6' } 
            }}
          >
            <Typography variant="body2">
              {customMode 
                ? 'Custom scenario with user-defined parameters'
                : selectedScenarioData?.description || 'Select a scenario to begin'}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip 
                icon={customTemperature < 10 ? <AcUnit sx={{ fontSize: 16 }} /> : <Whatshot sx={{ fontSize: 16 }} />}
                label={`Temp: ${customTemperature}°C`} 
                size="small" 
                sx={{ bgcolor: alpha(getTempColor(customTemperature), 0.2), color: getTempColor(customTemperature) }}
              />
              <Chip 
                icon={<ElectricalServices sx={{ fontSize: 16 }} />}
                label={`Load: ${customLoadMultiplier.toFixed(1)}x`} 
                size="small" 
                sx={{ bgcolor: alpha(customLoadMultiplier > 1.5 ? '#EF4444' : '#22C55E', 0.2) }}
              />
              <Chip 
                icon={<Warning sx={{ fontSize: 16 }} />}
                label={`Threshold: ${(customFailureThreshold * 100).toFixed(0)}%`} 
                size="small" 
                sx={{ bgcolor: alpha(customFailureThreshold < 0.5 ? '#EF4444' : '#22C55E', 0.2) }}
              />
              {customMode && (
                <Chip 
                  label="CUSTOM MODE" 
                  size="small" 
                  sx={{ bgcolor: alpha('#8B5CF6', 0.3), color: '#8B5CF6', fontWeight: 700 }}
                />
              )}
            </Stack>
          </Alert>

          {/* Loading indicator */}
          {isSimulating && (
            <LinearProgress 
              sx={{ 
                mt: 2,
                bgcolor: alpha('#FF6B6B', 0.2),
                '& .MuiLinearProgress-bar': { bgcolor: '#FF6B6B' }
              }} 
            />
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      {cascadeResult && (
        <>
          {/* Key Metrics */}
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              <Card sx={{ bgcolor: alpha('#FF0000', 0.08), border: '1px solid', borderColor: alpha('#FF0000', 0.3) }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Box sx={{ 
                    width: 16, height: 16, borderRadius: '50%', bgcolor: '#FF0000',
                    margin: '0 auto', mb: 1,
                    animation: 'pulse 1.5s infinite'
                  }} />
                  <Typography variant="overline" color="text.secondary">Patient Zero</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>
                    {cascadeResult.patient_zero?.node_name || cascadeResult.patient_zero?.node_id?.slice(0, 12) || 'N/A'}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card sx={{ bgcolor: alpha('#FF6B6B', 0.08), border: '1px solid', borderColor: alpha('#FF6B6B', 0.3) }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <ElectricalServices sx={{ color: '#FF6B6B', fontSize: 28 }} />
                  <Typography variant="overline" color="text.secondary">Nodes Failed</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: '#FF6B6B' }}>
                    {cascadeResult.total_affected_nodes}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card sx={{ bgcolor: alpha('#FBBF24', 0.08), border: '1px solid', borderColor: alpha('#FBBF24', 0.3) }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <TrendingUp sx={{ color: '#FBBF24', fontSize: 28 }} />
                  <Typography variant="overline" color="text.secondary">Capacity Lost</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: '#FBBF24' }}>
                    {(cascadeResult.affected_capacity_mw / 1000).toFixed(1)}
                    <Typography component="span" variant="body2" sx={{ ml: 0.5 }}>GW</Typography>
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card sx={{ bgcolor: alpha('#3B82F6', 0.08), border: '1px solid', borderColor: alpha('#3B82F6', 0.3) }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Groups sx={{ color: '#3B82F6', fontSize: 28 }} />
                  <Typography variant="overline" color="text.secondary">Customers Affected</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: '#3B82F6' }}>
                    {(cascadeResult.estimated_customers_affected / 1000).toFixed(0)}K
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Visualizations */}
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <CascadeFlowVisualization cascadeResult={cascadeResult} waveBreakdown={waveBreakdown} />
            </Grid>
            <Grid item xs={12} md={6}>
              <WaveBreakdownPanel waveBreakdown={waveBreakdown} />
            </Grid>
            <Grid item xs={12} md={6}>
              <HighRiskNodesTable highRiskNodes={highRiskNodes} />
            </Grid>
            {/* Regional Analysis Panel */}
            <Grid item xs={12}>
              <RegionalAnalysisPanel highRiskNodes={highRiskNodes} cascadeResult={cascadeResult} />
            </Grid>
          </Grid>
        </>
      )}

      {/* No Results State */}
      {!cascadeResult && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <HighRiskNodesTable highRiskNodes={highRiskNodes} />
          </Grid>
          <Grid item xs={12} md={6}>
            <Card sx={{ bgcolor: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', height: '100%' }}>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', py: 6 }}>
                <BubbleChart sx={{ fontSize: 64, color: alpha('#3B82F6', 0.3), mb: 2 }} />
                <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                  No Simulation Results
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 400 }}>
                  Select a scenario and run a simulation to see cascade propagation analysis, wave breakdown, and customer impact assessment.
                </Typography>
                <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
                  <Button
                    variant="outlined"
                    startIcon={<Refresh />}
                    onClick={onLoadHighRisk}
                    sx={{ borderColor: '#29B5E8', color: '#29B5E8' }}
                  >
                    Refresh Risk Data
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Science />}
                    onClick={onLoadPredictions}
                    sx={{ borderColor: '#22C55E', color: '#22C55E' }}
                  >
                    Load ML Predictions
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
          {/* Regional Analysis Panel - shown even without simulation results */}
          <Grid item xs={12}>
            <RegionalAnalysisPanel highRiskNodes={highRiskNodes} cascadeResult={null} />
          </Grid>
        </Grid>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
        }
      `}</style>
    </Box>
  );
}

export default CascadeAnalysisDashboard;
