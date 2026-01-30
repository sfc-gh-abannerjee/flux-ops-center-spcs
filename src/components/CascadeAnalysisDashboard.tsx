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
  SwapHoriz,
  AttachMoney,
  TrendingDown,
  CheckCircle,
  PriorityHigh,
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

// Cross-region flow data for Sankey visualization
interface CrossRegionFlow {
  source_region: string;
  target_region: string;
  flow_capacity_mw: number;
  connection_count: number;
  vulnerability_score: number;
}

// Investment ROI data per region
interface RegionalInvestment {
  region: string;
  county: string;
  nodes_requiring_upgrade: number;
  estimated_investment_cost: number;
  avoided_damage_potential: number;
  roi_percent: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
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
  isEmbedded?: boolean; // When true, renders without outer container (for embedding in CascadeControlPanel)
  isSideBySide?: boolean; // When true, uses compact responsive layout for side-by-side panels
  // Quick Demo feature - precomputed cascade scenarios
  precomputedScenarios?: Array<{
    scenario_id: string;
    scenario_name: string;
    patient_zero_name: string;
    total_affected: number;
    simulation_timestamp: string;
  }>;
  onLoadPrecomputedCascade?: (scenarioId: string) => Promise<void>;
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

// High-risk nodes table - responsive for side-by-side mode
function HighRiskNodesTable({ highRiskNodes, isSideBySide = false }: { highRiskNodes: CascadeNode[]; isSideBySide?: boolean }) {
  return (
    <Card sx={{ bgcolor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
      <CardContent sx={{ p: isSideBySide ? 1.5 : 2, '&:last-child': { pb: isSideBySide ? 1.5 : 2 } }}>
        <Typography variant={isSideBySide ? 'subtitle2' : 'h6'} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isSideBySide ? 1.5 : 3, color: '#EF4444' }}>
          <Warning sx={{ fontSize: isSideBySide ? 16 : 24 }} /> High-Risk Nodes {!isSideBySide && '(Patient Zero Candidates)'}
        </Typography>
        
        {highRiskNodes.length === 0 ? (
          <Alert severity="info" sx={{ bgcolor: 'rgba(59, 130, 246, 0.1)', '& .MuiAlert-message': { fontSize: isSideBySide ? '0.7rem' : '0.875rem' } }}>
            Click "Load ML Predictions" to identify high-risk nodes.
          </Alert>
        ) : (
          <TableContainer sx={{ maxHeight: isSideBySide ? 200 : 300 }}>
            <Table size="small" stickyHeader sx={{ tableLayout: isSideBySide ? 'auto' : 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600, fontSize: isSideBySide ? '0.65rem' : '0.875rem', py: isSideBySide ? 0.5 : 1, px: isSideBySide ? 0.75 : 2 }}>
                    {isSideBySide ? 'Node' : 'Node ID'}
                  </TableCell>
                  {!isSideBySide && <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600 }}>Name</TableCell>}
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600, fontSize: isSideBySide ? '0.65rem' : '0.875rem', py: isSideBySide ? 0.5 : 1, px: isSideBySide ? 0.75 : 2 }}>Type</TableCell>
                  <TableCell sx={{ bgcolor: '#1E293B', fontWeight: 600, fontSize: isSideBySide ? '0.65rem' : '0.875rem', py: isSideBySide ? 0.5 : 1, px: isSideBySide ? 0.75 : 2 }} align="right">Risk</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {highRiskNodes.slice(0, isSideBySide ? 8 : 15).map((node, idx) => (
                  <TableRow 
                    key={node.node_id}
                    sx={{ 
                      '&:hover': { bgcolor: alpha('#EF4444', 0.1) },
                      bgcolor: idx < 3 ? alpha('#EF4444', 0.05) : 'transparent'
                    }}
                  >
                    <TableCell sx={{ py: isSideBySide ? 0.5 : 1, px: isSideBySide ? 0.75 : 2 }}>
                      {isSideBySide ? (
                        <Box>
                          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, fontSize: '0.7rem' }}>
                            {node.node_name || node.node_id.slice(0, 12)}
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>
                            {node.node_id.slice(0, 10)}...
                          </Typography>
                        </Box>
                      ) : (
                        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {node.node_id.slice(0, 15)}...
                        </Typography>
                      )}
                    </TableCell>
                    {!isSideBySide && <TableCell>{node.node_name || '-'}</TableCell>}
                    <TableCell sx={{ py: isSideBySide ? 0.5 : 1, px: isSideBySide ? 0.75 : 2 }}>
                      <Chip 
                        label={isSideBySide ? (node.node_type === 'SUBSTATION' ? 'SUB' : 'XFMR') : node.node_type} 
                        size="small"
                        sx={{ 
                          bgcolor: node.node_type === 'SUBSTATION' ? alpha('#FBBF24', 0.2) : alpha('#3B82F6', 0.2),
                          color: node.node_type === 'SUBSTATION' ? '#FBBF24' : '#3B82F6',
                          fontSize: isSideBySide ? '0.55rem' : '0.7rem',
                          height: isSideBySide ? 18 : 24,
                          '& .MuiChip-label': { px: isSideBySide ? 0.5 : 1 }
                        }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ py: isSideBySide ? 0.5 : 1, px: isSideBySide ? 0.75 : 2 }}>
                      {isSideBySide ? (
                        <Chip 
                          label={`${(node.criticality_score * 100).toFixed(0)}%`}
                          size="small"
                          sx={{ 
                            height: 18,
                            bgcolor: node.criticality_score > 0.7 ? alpha('#EF4444', 0.2) : 
                                     node.criticality_score > 0.4 ? alpha('#FBBF24', 0.2) : alpha('#22C55E', 0.2),
                            color: node.criticality_score > 0.7 ? '#EF4444' : 
                                   node.criticality_score > 0.4 ? '#FBBF24' : '#22C55E',
                            fontWeight: 600,
                            fontSize: '0.6rem',
                            '& .MuiChip-label': { px: 0.5 }
                          }}
                        />
                      ) : (
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
                      )}
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

// Cross-Region Power Flow Sankey Visualization - P1 Gap Resolution
// UI/UX Refined: Improved flow visualization, gradient effects, better spacing
function CrossRegionSankeyPanel({ highRiskNodes, cascadeResult }: { highRiskNodes: CascadeNode[]; cascadeResult: CascadeResult | null }) {
  const [expanded, setExpanded] = useState(true);
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);
  
  // Generate cross-region flow data based on cascade propagation patterns
  const crossRegionFlows = useMemo<CrossRegionFlow[]>(() => {
    // Define region connections (based on utility service territory topology)
    const regionConnections: CrossRegionFlow[] = [
      { source_region: 'Houston Metro', target_region: 'North', flow_capacity_mw: 2400, connection_count: 12, vulnerability_score: 0.72 },
      { source_region: 'Houston Metro', target_region: 'Southwest', flow_capacity_mw: 1800, connection_count: 8, vulnerability_score: 0.45 },
      { source_region: 'Houston Metro', target_region: 'Coastal', flow_capacity_mw: 2100, connection_count: 15, vulnerability_score: 0.68 },
      { source_region: 'Houston Metro', target_region: 'East', flow_capacity_mw: 950, connection_count: 5, vulnerability_score: 0.35 },
      { source_region: 'Houston Metro', target_region: 'West', flow_capacity_mw: 720, connection_count: 4, vulnerability_score: 0.28 },
      { source_region: 'North', target_region: 'West', flow_capacity_mw: 450, connection_count: 3, vulnerability_score: 0.22 },
      { source_region: 'Southwest', target_region: 'Coastal', flow_capacity_mw: 680, connection_count: 4, vulnerability_score: 0.38 },
      { source_region: 'Coastal', target_region: 'East', flow_capacity_mw: 520, connection_count: 3, vulnerability_score: 0.42 },
    ];
    
    // Adjust vulnerability based on cascade results if available
    if (cascadeResult?.cascade_order) {
      const affectedRegions = new Set<string>();
      cascadeResult.cascade_order.forEach(node => {
        const id = node.node_id.toUpperCase();
        if (id.includes('HOU')) affectedRegions.add('Houston Metro');
        else if (id.includes('GAL') || id.includes('BRA') || id.includes('CHA')) affectedRegions.add('Coastal');
        else if (id.includes('MON')) affectedRegions.add('North');
        else if (id.includes('FBN') || id.includes('FTB')) affectedRegions.add('Southwest');
        else if (id.includes('WAL')) affectedRegions.add('West');
        else if (id.includes('LIB')) affectedRegions.add('East');
      });
      
      return regionConnections.map(conn => ({
        ...conn,
        vulnerability_score: (affectedRegions.has(conn.source_region) || affectedRegions.has(conn.target_region))
          ? Math.min(conn.vulnerability_score * 1.5, 1.0)
          : conn.vulnerability_score
      }));
    }
    
    return regionConnections;
  }, [cascadeResult]);

  const maxCapacity = Math.max(...crossRegionFlows.map(f => f.flow_capacity_mw));
  const totalCapacity = crossRegionFlows.reduce((sum, f) => sum + f.flow_capacity_mw, 0);
  const totalConnections = crossRegionFlows.reduce((sum, f) => sum + f.connection_count, 0);
  const criticalCount = crossRegionFlows.filter(f => f.vulnerability_score > 0.6).length;

  // Region colors for Sankey nodes
  const regionColors: Record<string, string> = {
    'Houston Metro': '#3B82F6',
    'North': '#22C55E',
    'Southwest': '#FBBF24',
    'Coastal': '#06B6D4',
    'East': '#8B5CF6',
    'West': '#F97316',
  };

  // Region short names for compact display
  const regionShortNames: Record<string, string> = {
    'Houston Metro': 'Houston',
    'North': 'North',
    'Southwest': 'SW',
    'Coastal': 'Coastal',
    'East': 'East',
    'West': 'West',
  };

  return (
    <Card sx={{ 
      bgcolor: 'rgba(6, 182, 212, 0.05)', 
      border: '1px solid rgba(6, 182, 212, 0.2)',
      transition: 'all 0.2s ease-in-out',
      '&:hover': { borderColor: 'rgba(6, 182, 212, 0.4)' }
    }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box 
          sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            cursor: 'pointer',
            userSelect: 'none'
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: '#06B6D4' }}>
            <SwapHoriz sx={{ fontSize: 24 }} /> Cross-Region Power Flow
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {criticalCount > 0 && (
              <Chip 
                icon={<Warning sx={{ fontSize: 14 }} />}
                label={`${criticalCount} Critical`}
                size="small"
                sx={{ 
                  bgcolor: alpha('#EF4444', 0.15), 
                  color: '#EF4444',
                  fontWeight: 600,
                  '& .MuiChip-icon': { color: '#EF4444' }
                }}
              />
            )}
            <Chip 
              label={`${(totalCapacity / 1000).toFixed(1)} GW`}
              size="small"
              sx={{ bgcolor: alpha('#06B6D4', 0.2), color: '#06B6D4', fontWeight: 600 }}
            />
            {expanded ? <ExpandLess sx={{ color: '#06B6D4' }} /> : <ExpandMore sx={{ color: '#06B6D4' }} />}
          </Stack>
        </Box>

        <Collapse in={expanded}>
          <Box sx={{ mt: 2.5 }}>
            {/* Compact Summary Stats */}
            <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
              <Grid item xs={4}>
                <Paper sx={{ 
                  p: 1.5, 
                  textAlign: 'center', 
                  bgcolor: alpha('#06B6D4', 0.08),
                  border: '1px solid',
                  borderColor: alpha('#06B6D4', 0.15)
                }}>
                  <Typography variant="h5" sx={{ color: '#06B6D4', fontWeight: 700, lineHeight: 1.2 }}>
                    {crossRegionFlows.length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    Corridors
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={4}>
                <Paper sx={{ 
                  p: 1.5, 
                  textAlign: 'center', 
                  bgcolor: alpha('#22C55E', 0.08),
                  border: '1px solid',
                  borderColor: alpha('#22C55E', 0.15)
                }}>
                  <Typography variant="h5" sx={{ color: '#22C55E', fontWeight: 700, lineHeight: 1.2 }}>
                    {totalConnections}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    Lines
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={4}>
                <Paper sx={{ 
                  p: 1.5, 
                  textAlign: 'center', 
                  bgcolor: alpha('#FBBF24', 0.08),
                  border: '1px solid',
                  borderColor: alpha('#FBBF24', 0.15)
                }}>
                  <Typography variant="h5" sx={{ color: '#FBBF24', fontWeight: 700, lineHeight: 1.2 }}>
                    {(totalCapacity / 1000).toFixed(1)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    GW Total
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Flow Visualization - Refined Sankey-style */}
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 1,
              p: 2,
              bgcolor: alpha('#0A1929', 0.5),
              borderRadius: 2,
              border: '1px solid',
              borderColor: alpha('#06B6D4', 0.15)
            }}>
              {crossRegionFlows.map((flow, idx) => {
                const widthPercent = (flow.flow_capacity_mw / maxCapacity) * 100;
                const heightPx = Math.max(12, Math.min(28, widthPercent * 0.28));
                const vulnerabilityColor = flow.vulnerability_score > 0.6 ? '#EF4444' : 
                                          flow.vulnerability_score > 0.35 ? '#FBBF24' : '#22C55E';
                const isHovered = hoveredFlow === idx;
                const sourceColor = regionColors[flow.source_region] || '#666';
                const targetColor = regionColors[flow.target_region] || '#666';
                
                return (
                  <Box 
                    key={idx} 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1,
                      py: 0.5,
                      transition: 'all 0.15s ease-in-out',
                      opacity: hoveredFlow !== null && !isHovered ? 0.4 : 1,
                      transform: isHovered ? 'scale(1.01)' : 'scale(1)',
                    }}
                    onMouseEnter={() => setHoveredFlow(idx)}
                    onMouseLeave={() => setHoveredFlow(null)}
                  >
                    {/* Source Region Node */}
                    <Paper sx={{ 
                      width: 72, 
                      minWidth: 72,
                      py: 0.75, 
                      px: 1,
                      textAlign: 'center',
                      bgcolor: alpha(sourceColor, isHovered ? 0.25 : 0.15),
                      border: '2px solid',
                      borderColor: sourceColor,
                      borderRadius: 1,
                      transition: 'all 0.15s ease-in-out',
                    }}>
                      <Typography variant="caption" sx={{ 
                        color: sourceColor, 
                        fontWeight: 700,
                        fontSize: '0.68rem',
                        display: 'block',
                        lineHeight: 1.2
                      }}>
                        {regionShortNames[flow.source_region]}
                      </Typography>
                    </Paper>
                    
                    {/* Flow Bar with Gradient */}
                    <Tooltip 
                      title={
                        <Box sx={{ p: 0.5 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                            {flow.source_region} → {flow.target_region}
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            Capacity: {flow.flow_capacity_mw.toLocaleString()} MW
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block' }}>
                            Lines: {flow.connection_count} interconnections
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', color: vulnerabilityColor }}>
                            Vulnerability: {(flow.vulnerability_score * 100).toFixed(0)}%
                          </Typography>
                        </Box>
                      }
                      arrow
                      placement="top"
                    >
                      <Box sx={{ 
                        flex: 1, 
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}>
                        {/* Flow gradient bar */}
                        <Box sx={{ 
                          height: heightPx,
                          width: '100%',
                          background: `linear-gradient(90deg, ${alpha(sourceColor, 0.6)} 0%, ${alpha(vulnerabilityColor, isHovered ? 0.7 : 0.45)} 50%, ${alpha(targetColor, 0.6)} 100%)`,
                          borderRadius: 1,
                          position: 'relative',
                          overflow: 'visible',
                          transition: 'all 0.15s ease-in-out',
                          boxShadow: isHovered ? `0 0 12px ${alpha(vulnerabilityColor, 0.4)}` : 'none',
                        }}>
                          {/* Animated flow indicator */}
                          <Box sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: `repeating-linear-gradient(90deg, transparent, transparent 20px, ${alpha('#fff', 0.08)} 20px, ${alpha('#fff', 0.08)} 40px)`,
                            animation: isHovered ? 'flowAnimation 1s linear infinite' : 'none',
                            '@keyframes flowAnimation': {
                              '0%': { backgroundPosition: '0 0' },
                              '100%': { backgroundPosition: '40px 0' },
                            },
                            borderRadius: 1,
                          }} />
                          {/* Arrow head */}
                          <Box sx={{
                            position: 'absolute',
                            right: -6,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 0,
                            height: 0,
                            borderTop: `${heightPx / 2 + 2}px solid transparent`,
                            borderBottom: `${heightPx / 2 + 2}px solid transparent`,
                            borderLeft: `8px solid ${targetColor}`,
                          }} />
                        </Box>
                        {/* Capacity label - positioned below bar */}
                        <Typography sx={{ 
                          position: 'absolute',
                          bottom: -14,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          fontSize: '0.6rem',
                          color: 'text.secondary',
                          whiteSpace: 'nowrap',
                          fontWeight: 500,
                          opacity: 0.8
                        }}>
                          {flow.flow_capacity_mw >= 1000 
                            ? `${(flow.flow_capacity_mw / 1000).toFixed(1)} GW` 
                            : `${flow.flow_capacity_mw} MW`}
                        </Typography>
                      </Box>
                    </Tooltip>
                    
                    {/* Target Region Node */}
                    <Paper sx={{ 
                      width: 72, 
                      minWidth: 72,
                      py: 0.75, 
                      px: 1,
                      textAlign: 'center',
                      bgcolor: alpha(targetColor, isHovered ? 0.25 : 0.15),
                      border: '2px solid',
                      borderColor: targetColor,
                      borderRadius: 1,
                      transition: 'all 0.15s ease-in-out',
                    }}>
                      <Typography variant="caption" sx={{ 
                        color: targetColor, 
                        fontWeight: 700,
                        fontSize: '0.68rem',
                        display: 'block',
                        lineHeight: 1.2
                      }}>
                        {regionShortNames[flow.target_region]}
                      </Typography>
                    </Paper>
                    
                    {/* Vulnerability Badge - Compact */}
                    <Chip 
                      label={`${(flow.vulnerability_score * 100).toFixed(0)}%`}
                      size="small"
                      sx={{ 
                        minWidth: 44,
                        height: 22,
                        bgcolor: alpha(vulnerabilityColor, isHovered ? 0.3 : 0.2),
                        color: vulnerabilityColor,
                        fontWeight: 700,
                        fontSize: '0.65rem',
                        transition: 'all 0.15s ease-in-out',
                        '& .MuiChip-label': { px: 1 }
                      }}
                    />
                  </Box>
                );
              })}
            </Box>

            {/* Critical Corridor Alert */}
            {criticalCount > 0 && (
              <Alert 
                severity="warning" 
                icon={<Warning />}
                sx={{ 
                  mt: 2, 
                  bgcolor: alpha('#FBBF24', 0.08), 
                  border: '1px solid',
                  borderColor: alpha('#FBBF24', 0.2),
                  '& .MuiAlert-icon': { color: '#FBBF24' },
                  py: 1
                }}
              >
                <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                  <strong>{criticalCount} critical corridor{criticalCount > 1 ? 's' : ''}</strong> with vulnerability above 60%. 
                  Failure could isolate regions and accelerate cascade propagation.
                </Typography>
              </Alert>
            )}

            {/* Compact Legend */}
            <Stack 
              direction="row" 
              spacing={2} 
              sx={{ 
                mt: 2, 
                pt: 1.5, 
                borderTop: '1px solid', 
                borderColor: alpha('#fff', 0.08),
                justifyContent: 'center'
              }}
            >
              {[
                { color: '#EF4444', label: 'High (>60%)' },
                { color: '#FBBF24', label: 'Moderate' },
                { color: '#22C55E', label: 'Low (<35%)' },
              ].map(item => (
                <Stack key={item.label} direction="row" alignItems="center" spacing={0.75}>
                  <Box sx={{ width: 10, height: 10, bgcolor: item.color, borderRadius: 0.5 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {item.label}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

// Investment ROI Panel - P1 Gap Resolution
// UI/UX Refined: Better data visualization, improved table styling, clearer hierarchy
function InvestmentROIPanel({ highRiskNodes, cascadeResult }: { highRiskNodes: CascadeNode[]; cascadeResult: CascadeResult | null }) {
  const [expanded, setExpanded] = useState(true);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  // Calculate investment recommendations per region
  const investmentData = useMemo<RegionalInvestment[]>(() => {
    // Cost assumptions (per node upgrade)
    const UPGRADE_COST_SUBSTATION = 5000000; // $5M per substation upgrade
    const UPGRADE_COST_TRANSFORMER = 500000; // $500K per transformer upgrade
    const DAMAGE_MULTIPLIER = 2.5; // Expected avoided damage = 2.5x investment
    const CUSTOMER_DAMAGE_COST = 150; // $150 per customer affected per event
    
    // Group nodes by region
    const regionMap = new Map<string, { 
      region: string; 
      county: string; 
      substations: number; 
      transformers: number;
      highRiskSubstations: number;
      highRiskTransformers: number;
      totalCustomersAtRisk: number;
      avgCriticality: number;
    }>();
    
    const getRegionData = (nodeId: string, nodeName?: string): { region: string; county: string } => {
      const id = nodeId.toUpperCase();
      if (id.includes('HOU')) return { region: 'Houston Metro', county: 'Harris' };
      if (id.includes('GAL')) return { region: 'Coastal', county: 'Galveston' };
      if (id.includes('BRA')) return { region: 'Coastal', county: 'Brazoria' };
      if (id.includes('MON')) return { region: 'North', county: 'Montgomery' };
      if (id.includes('FBN') || id.includes('FTB')) return { region: 'Southwest', county: 'Fort Bend' };
      if (id.includes('WAL')) return { region: 'West', county: 'Waller' };
      if (id.includes('LIB')) return { region: 'East', county: 'Liberty' };
      if (id.includes('CHA')) return { region: 'Coastal', county: 'Chambers' };
      return { region: 'Houston Metro', county: 'Harris' };
    };
    
    // Process high-risk nodes
    highRiskNodes.forEach(node => {
      const { region, county } = getRegionData(node.node_id, node.node_name || undefined);
      const key = `${region}-${county}`;
      
      if (!regionMap.has(key)) {
        regionMap.set(key, {
          region, county,
          substations: 0, transformers: 0,
          highRiskSubstations: 0, highRiskTransformers: 0,
          totalCustomersAtRisk: 0, avgCriticality: 0
        });
      }
      
      const data = regionMap.get(key)!;
      const isSubstation = node.node_type === 'SUBSTATION';
      const isHighRisk = node.criticality_score > 0.6;
      
      if (isSubstation) {
        data.substations++;
        if (isHighRisk) data.highRiskSubstations++;
      } else {
        data.transformers++;
        if (isHighRisk) data.highRiskTransformers++;
      }
      
      data.totalCustomersAtRisk += (node.downstream_transformers || 0) * 50;
      const totalNodes = data.substations + data.transformers;
      data.avgCriticality = ((data.avgCriticality * (totalNodes - 1)) + node.criticality_score) / totalNodes;
    });
    
    // Calculate investment metrics
    return Array.from(regionMap.values()).map(data => {
      const nodesNeedingUpgrade = data.highRiskSubstations + data.highRiskTransformers;
      const investmentCost = (data.highRiskSubstations * UPGRADE_COST_SUBSTATION) + 
                            (data.highRiskTransformers * UPGRADE_COST_TRANSFORMER);
      const avoidedDamage = (data.totalCustomersAtRisk * CUSTOMER_DAMAGE_COST * data.avgCriticality) + 
                           (investmentCost * DAMAGE_MULTIPLIER * data.avgCriticality);
      const roi = investmentCost > 0 ? ((avoidedDamage - investmentCost) / investmentCost) * 100 : 0;
      
      let priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      if (data.avgCriticality > 0.7 || nodesNeedingUpgrade > 5) priority = 'CRITICAL';
      else if (data.avgCriticality > 0.5 || nodesNeedingUpgrade > 3) priority = 'HIGH';
      else if (data.avgCriticality > 0.3 || nodesNeedingUpgrade > 1) priority = 'MEDIUM';
      else priority = 'LOW';
      
      return {
        region: data.region,
        county: data.county,
        nodes_requiring_upgrade: nodesNeedingUpgrade,
        estimated_investment_cost: investmentCost,
        avoided_damage_potential: avoidedDamage,
        roi_percent: roi,
        priority
      };
    }).filter(inv => inv.nodes_requiring_upgrade > 0)
      .sort((a, b) => b.roi_percent - a.roi_percent);
  }, [highRiskNodes]);

  const totalInvestment = investmentData.reduce((sum, d) => sum + d.estimated_investment_cost, 0);
  const totalBenefit = investmentData.reduce((sum, d) => sum + d.avoided_damage_potential, 0);
  const overallROI = totalInvestment > 0 ? ((totalBenefit - totalInvestment) / totalInvestment) * 100 : 0;
  const maxROI = Math.max(...investmentData.map(d => d.roi_percent), 1);
  const criticalCount = investmentData.filter(d => d.priority === 'CRITICAL').length;

  const priorityColors = {
    'CRITICAL': '#EF4444',
    'HIGH': '#F97316',
    'MEDIUM': '#FBBF24',
    'LOW': '#22C55E'
  };

  const priorityIcons = {
    'CRITICAL': <PriorityHigh sx={{ fontSize: 12 }} />,
    'HIGH': null,
    'MEDIUM': null,
    'LOW': <CheckCircle sx={{ fontSize: 12 }} />
  };

  if (investmentData.length === 0) return null;

  return (
    <Card sx={{ 
      bgcolor: 'rgba(139, 92, 246, 0.05)', 
      border: '1px solid rgba(139, 92, 246, 0.2)',
      transition: 'all 0.2s ease-in-out',
      '&:hover': { borderColor: 'rgba(139, 92, 246, 0.4)' }
    }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box 
          sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            cursor: 'pointer',
            userSelect: 'none'
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: '#8B5CF6' }}>
            <AttachMoney sx={{ fontSize: 24 }} /> Investment ROI Analysis
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {criticalCount > 0 && (
              <Chip 
                icon={<PriorityHigh sx={{ fontSize: 14 }} />}
                label={`${criticalCount} Critical`}
                size="small"
                sx={{ 
                  bgcolor: alpha('#EF4444', 0.15), 
                  color: '#EF4444',
                  fontWeight: 600,
                  '& .MuiChip-icon': { color: '#EF4444' }
                }}
              />
            )}
            <Chip 
              label={`${overallROI.toFixed(0)}% ROI`}
              size="small"
              sx={{ 
                bgcolor: alpha(overallROI > 100 ? '#22C55E' : '#FBBF24', 0.2), 
                color: overallROI > 100 ? '#22C55E' : '#FBBF24',
                fontWeight: 700
              }}
            />
            {expanded ? <ExpandLess sx={{ color: '#8B5CF6' }} /> : <ExpandMore sx={{ color: '#8B5CF6' }} />}
          </Stack>
        </Box>

        <Collapse in={expanded}>
          <Box sx={{ mt: 2.5 }}>
            {/* Compact Investment Summary Cards */}
            <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
              <Grid item xs={4}>
                <Paper sx={{ 
                  p: 1.5, 
                  textAlign: 'center', 
                  bgcolor: alpha('#3B82F6', 0.08),
                  border: '1px solid',
                  borderColor: alpha('#3B82F6', 0.15)
                }}>
                  <AttachMoney sx={{ color: '#3B82F6', fontSize: 22, mb: 0.5 }} />
                  <Typography variant="h5" sx={{ color: '#3B82F6', fontWeight: 700, lineHeight: 1.2 }}>
                    ${(totalInvestment / 1000000).toFixed(1)}M
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    Investment Needed
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={4}>
                <Paper sx={{ 
                  p: 1.5, 
                  textAlign: 'center', 
                  bgcolor: alpha('#22C55E', 0.08),
                  border: '1px solid',
                  borderColor: alpha('#22C55E', 0.15)
                }}>
                  <TrendingUp sx={{ color: '#22C55E', fontSize: 22, mb: 0.5 }} />
                  <Typography variant="h5" sx={{ color: '#22C55E', fontWeight: 700, lineHeight: 1.2 }}>
                    ${(totalBenefit / 1000000).toFixed(1)}M
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    Expected Benefit
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={4}>
                <Paper sx={{ 
                  p: 1.5, 
                  textAlign: 'center', 
                  bgcolor: alpha(overallROI > 100 ? '#22C55E' : '#FBBF24', 0.08),
                  border: '1px solid',
                  borderColor: alpha(overallROI > 100 ? '#22C55E' : '#FBBF24', 0.15)
                }}>
                  <CheckCircle sx={{ color: overallROI > 100 ? '#22C55E' : '#FBBF24', fontSize: 22, mb: 0.5 }} />
                  <Typography variant="h5" sx={{ color: overallROI > 100 ? '#22C55E' : '#FBBF24', fontWeight: 700, lineHeight: 1.2 }}>
                    {overallROI.toFixed(0)}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    Overall ROI
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Per-Region Investment Table - Enhanced */}
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              mb: 1.5
            }}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                Investment Recommendations by Region
              </Typography>
              <Chip
                label="Sorted by ROI"
                size="small"
                sx={{ 
                  height: 18,
                  bgcolor: alpha('#8B5CF6', 0.1),
                  color: '#8B5CF6',
                  fontSize: '0.6rem',
                  '& .MuiChip-label': { px: 1 }
                }}
              />
            </Box>
            
            <TableContainer sx={{ 
              bgcolor: alpha('#0A1929', 0.5),
              borderRadius: 2,
              border: '1px solid',
              borderColor: alpha('#8B5CF6', 0.15)
            }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ 
                      color: 'text.secondary', 
                      fontWeight: 600, 
                      fontSize: '0.7rem',
                      borderBottom: `1px solid ${alpha('#8B5CF6', 0.2)}`,
                      py: 1.25
                    }}>
                      Region
                    </TableCell>
                    <TableCell align="center" sx={{ 
                      color: 'text.secondary', 
                      fontWeight: 600, 
                      fontSize: '0.7rem',
                      borderBottom: `1px solid ${alpha('#8B5CF6', 0.2)}`,
                      py: 1.25
                    }}>
                      Priority
                    </TableCell>
                    <TableCell align="right" sx={{ 
                      color: 'text.secondary', 
                      fontWeight: 600, 
                      fontSize: '0.7rem',
                      borderBottom: `1px solid ${alpha('#8B5CF6', 0.2)}`,
                      py: 1.25
                    }}>
                      Cost
                    </TableCell>
                    <TableCell align="right" sx={{ 
                      color: 'text.secondary', 
                      fontWeight: 600, 
                      fontSize: '0.7rem',
                      borderBottom: `1px solid ${alpha('#8B5CF6', 0.2)}`,
                      py: 1.25,
                      width: 160
                    }}>
                      ROI
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {investmentData.slice(0, 6).map((inv, idx) => {
                    const isHovered = hoveredRow === idx;
                    const isTop = idx === 0;
                    const roiBarWidth = (inv.roi_percent / maxROI) * 100;
                    
                    return (
                      <TableRow 
                        key={`${inv.region}-${inv.county}`} 
                        onMouseEnter={() => setHoveredRow(idx)}
                        onMouseLeave={() => setHoveredRow(null)}
                        sx={{ 
                          bgcolor: isTop ? alpha('#8B5CF6', 0.12) : isHovered ? alpha('#8B5CF6', 0.06) : 'transparent',
                          transition: 'background-color 0.15s ease-in-out',
                          '&:last-child td': { borderBottom: 0 }
                        }}
                      >
                        <TableCell sx={{ 
                          py: 1.25,
                          borderBottom: `1px solid ${alpha('#fff', 0.05)}`
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {isTop && (
                              <Box sx={{ 
                                width: 4, 
                                height: 28, 
                                bgcolor: '#8B5CF6', 
                                borderRadius: 1 
                              }} />
                            )}
                            <Box>
                              <Typography variant="body2" sx={{ 
                                fontWeight: isTop ? 700 : 500,
                                fontSize: '0.8rem',
                                lineHeight: 1.3
                              }}>
                                {inv.county}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                {inv.region} · {inv.nodes_requiring_upgrade} upgrade{inv.nodes_requiring_upgrade > 1 ? 's' : ''}
                              </Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell align="center" sx={{ 
                          py: 1.25,
                          borderBottom: `1px solid ${alpha('#fff', 0.05)}`
                        }}>
                          <Chip 
                            icon={priorityIcons[inv.priority] || undefined}
                            label={inv.priority.slice(0, 4)}
                            size="small"
                            sx={{ 
                              bgcolor: alpha(priorityColors[inv.priority], 0.15),
                              color: priorityColors[inv.priority],
                              fontWeight: 700,
                              fontSize: '0.6rem',
                              height: 20,
                              '& .MuiChip-icon': { 
                                color: priorityColors[inv.priority],
                                ml: 0.5
                              },
                              '& .MuiChip-label': { px: 0.75 }
                            }}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ 
                          py: 1.25,
                          borderBottom: `1px solid ${alpha('#fff', 0.05)}`
                        }}>
                          <Typography variant="body2" sx={{ color: '#3B82F6', fontWeight: 600, fontSize: '0.75rem' }}>
                            ${(inv.estimated_investment_cost / 1000000).toFixed(1)}M
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ 
                          py: 1.25,
                          borderBottom: `1px solid ${alpha('#fff', 0.05)}`
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
                            {/* ROI Bar Visualization */}
                            <Box sx={{ 
                              flex: 1,
                              height: 6,
                              bgcolor: alpha('#fff', 0.08),
                              borderRadius: 1,
                              overflow: 'hidden',
                              maxWidth: 80
                            }}>
                              <Box sx={{ 
                                height: '100%',
                                width: `${roiBarWidth}%`,
                                bgcolor: inv.roi_percent > 100 ? '#22C55E' : '#FBBF24',
                                borderRadius: 1,
                                transition: 'width 0.3s ease-in-out'
                              }} />
                            </Box>
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                color: inv.roi_percent > 100 ? '#22C55E' : '#FBBF24',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                minWidth: 45,
                                textAlign: 'right'
                              }}
                            >
                              {inv.roi_percent.toFixed(0)}%
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Top Recommendation - More Prominent */}
            {investmentData.length > 0 && (
              <Box sx={{ 
                mt: 2,
                p: 2,
                bgcolor: alpha('#8B5CF6', 0.08),
                border: '1px solid',
                borderColor: alpha('#8B5CF6', 0.25),
                borderRadius: 2,
                borderLeft: '4px solid #8B5CF6'
              }}>
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <TrendingUp sx={{ color: '#8B5CF6', fontSize: 20, mt: 0.25 }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#8B5CF6', mb: 0.5, fontSize: '0.8rem' }}>
                      Top Investment Recommendation
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.75rem', lineHeight: 1.5 }}>
                      Prioritize <strong>{investmentData[0].county} County</strong> ({investmentData[0].region}) - 
                      <Box component="span" sx={{ color: '#3B82F6', fontWeight: 600 }}> ${(investmentData[0].estimated_investment_cost / 1000000).toFixed(1)}M </Box>
                      investment yields 
                      <Box component="span" sx={{ color: '#22C55E', fontWeight: 700 }}> ${(investmentData[0].avoided_damage_potential / 1000000).toFixed(1)}M </Box>
                      benefit ({investmentData[0].roi_percent.toFixed(0)}% ROI)
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            )}

            {/* Compact Legend */}
            <Stack 
              direction="row" 
              spacing={2} 
              sx={{ 
                mt: 2, 
                pt: 1.5, 
                borderTop: '1px solid', 
                borderColor: alpha('#fff', 0.08),
                justifyContent: 'center'
              }}
            >
              {[
                { color: '#EF4444', label: 'Critical' },
                { color: '#F97316', label: 'High' },
                { color: '#FBBF24', label: 'Medium' },
                { color: '#22C55E', label: 'Low' },
              ].map(item => (
                <Stack key={item.label} direction="row" alignItems="center" spacing={0.75}>
                  <Box sx={{ width: 10, height: 10, bgcolor: item.color, borderRadius: 0.5 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                    {item.label}
                  </Typography>
                </Stack>
              ))}
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
  isEmbedded = false,
  isSideBySide = false,
  precomputedScenarios = [],
  onLoadPrecomputedCascade,
}: CascadeAnalysisDashboardProps) {
  const [selectedScenario, setSelectedScenario] = useState<string>(scenarios[0]?.name || '');
  const [selectedPatientZero, setSelectedPatientZero] = useState<string>('');
  const waveBreakdown = useWaveBreakdown(cascadeResult);
  
  // Custom scenario parameters state
  const [customMode] = useState(false);  // Keep for backward compatibility in useEffect
  const [customTemperature, setCustomTemperature] = useState(25);
  const [customLoadMultiplier, setCustomLoadMultiplier] = useState(1.0);
  const [customFailureThreshold, setCustomFailureThreshold] = useState(0.65);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  
  // Update selectedScenario when scenarios are loaded from API
  // This handles the case where API scenario names differ from initial defaults
  useEffect(() => {
    if (scenarios.length > 0) {
      // Check if current selection exists in scenarios list
      const scenarioExists = scenarios.some(s => s.name === selectedScenario);
      if (!scenarioExists || !selectedScenario) {
        setSelectedScenario(scenarios[0].name);
      }
    }
  }, [scenarios]); // Only depend on scenarios to avoid loops
  
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
    // Build scenario with current parameters (from sliders)
    const baseScenario = scenarios.find(s => s.name === selectedScenario);
    if (!baseScenario) return;
    
    // Always use selected scenario but with current slider values
    const scenarioToRun: CascadeScenario = {
      ...baseScenario,
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
    <Box sx={{ 
      height: isEmbedded ? 'auto' : '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: isEmbedded ? 2 : 3, 
      p: isEmbedded ? 2 : 3, 
      overflow: isEmbedded ? 'visible' : 'auto',
      bgcolor: isEmbedded ? 'transparent' : undefined,
    }}>
      {/* Header - simpler when embedded */}
      {!isEmbedded && (
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
      )}

      {/* Section Header for Embedded Mode */}
      {isEmbedded && (
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1,
          pb: 1,
          borderBottom: '1px solid rgba(41, 181, 232, 0.3)',
          mb: 1
        }}>
          <Science sx={{ color: '#29B5E8', fontSize: 20 }} />
          <Typography variant="subtitle1" sx={{ color: '#29B5E8', fontWeight: 600 }}>
            Run Cascade Simulation
          </Typography>
        </Box>
      )}

      {/* Simulation Controls - ALWAYS VISIBLE */}
      <Card sx={{ 
        bgcolor: 'rgba(41, 181, 232, 0.05)', 
        border: '2px solid rgba(41, 181, 232, 0.4)',
        boxShadow: isEmbedded ? '0 0 20px rgba(41, 181, 232, 0.2)' : undefined,
      }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#29B5E8' }}>
              <Science /> Scenario Builder
            </Typography>
          </Box>
          
          <Grid container spacing={3}>
            {/* Scenario Selection */}
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Scenario Preset</InputLabel>
                <Select
                  value={selectedScenario}
                  label="Scenario Preset"
                  onChange={(e) => setSelectedScenario(e.target.value)}
                  MenuProps={{
                    sx: { zIndex: 9999 },
                    PaperProps: { sx: { maxHeight: 300 } }
                  }}
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
                  MenuProps={{
                    sx: { zIndex: 9999 },
                    PaperProps: { sx: { maxHeight: 400 } }
                  }}
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
                  disabled={isSimulating || !selectedScenario}
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

          {/* Quick Demo - Pre-computed Cascades (instant load alternative) */}
          {precomputedScenarios.length > 0 && !cascadeResult && onLoadPrecomputedCascade && (
            <Box sx={{ mt: 3, pt: 2, borderTop: `1px dashed ${alpha('#22C55E', 0.3)}` }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <Chip 
                  label="OR" 
                  size="small" 
                  sx={{ 
                    fontSize: '0.7rem', 
                    height: 22, 
                    bgcolor: alpha('#22C55E', 0.1), 
                    color: '#22C55E',
                    fontWeight: 700,
                  }} 
                />
                <Typography variant="body2" sx={{ color: '#22C55E', fontWeight: 500 }}>
                  Load pre-computed demo (instant)
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {precomputedScenarios.slice(0, 4).map((precomp) => (
                  <Chip
                    key={precomp.scenario_id}
                    label={precomp.scenario_name.replace(/_/g, ' ')}
                    size="medium"
                    onClick={() => onLoadPrecomputedCascade(precomp.scenario_id)}
                    disabled={isSimulating}
                    icon={<Speed sx={{ fontSize: 16 }} />}
                    sx={{
                      fontSize: '0.85rem',
                      height: 32,
                      bgcolor: alpha('#22C55E', 0.12),
                      color: '#22C55E',
                      border: `1px solid ${alpha('#22C55E', 0.3)}`,
                      '&:hover': { 
                        bgcolor: alpha('#22C55E', 0.25),
                        transform: 'translateY(-2px)',
                        boxShadow: `0 4px 12px ${alpha('#22C55E', 0.3)}`,
                      },
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '& .MuiChip-icon': { color: '#22C55E' },
                    }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {/* Interactive Parameter Sliders */}
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: alpha('#fff', 0.1) }}>
            <Box 
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, cursor: 'pointer' }}
              onClick={() => setShowAdvancedControls(!showAdvancedControls)}
            >
              <Stack direction="row" alignItems="center" spacing={1}>
                <Tune sx={{ fontSize: 18, color: '#29B5E8' }} />
                <Typography variant="subtitle2" sx={{ color: '#29B5E8' }}>
                  Adjust Scenario Parameters
                </Typography>
              </Stack>
              {showAdvancedControls ? <ExpandLess /> : <ExpandMore />}
            </Box>
            
            <Collapse in={showAdvancedControls}>
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
            severity="info" 
            sx={{ 
              mt: 2, 
              bgcolor: alpha('#3B82F6', 0.1), 
              '& .MuiAlert-icon': { color: '#3B82F6' } 
            }}
          >
            <Typography variant="body2">
              {selectedScenarioData?.description || 'Select a scenario to begin'}
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
<HighRiskNodesTable highRiskNodes={highRiskNodes} isSideBySide={isSideBySide} />
            </Grid>
            {/* Regional Analysis Panel */}
            <Grid item xs={12}>
              <RegionalAnalysisPanel highRiskNodes={highRiskNodes} cascadeResult={cascadeResult} />
            </Grid>
            {/* Cross-Region Power Flow - P1 Gap Resolution */}
            <Grid item xs={12}>
              <CrossRegionSankeyPanel highRiskNodes={highRiskNodes} cascadeResult={cascadeResult} />
            </Grid>
            {/* Investment ROI Analysis - P1 Gap Resolution */}
            <Grid item xs={12}>
              <InvestmentROIPanel highRiskNodes={highRiskNodes} cascadeResult={cascadeResult} />
            </Grid>
          </Grid>
        </>
      )}

      {/* No Results State */}
      {!cascadeResult && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <HighRiskNodesTable highRiskNodes={highRiskNodes} isSideBySide={isSideBySide} />
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
          {/* Cross-Region Power Flow - P1 Gap Resolution (always visible) */}
          <Grid item xs={12}>
            <CrossRegionSankeyPanel highRiskNodes={highRiskNodes} cascadeResult={null} />
          </Grid>
          {/* Investment ROI Analysis - P1 Gap Resolution (always visible) */}
          <Grid item xs={12}>
            <InvestmentROIPanel highRiskNodes={highRiskNodes} cascadeResult={null} />
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
