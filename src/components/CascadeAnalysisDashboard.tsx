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
  Layers
} from '@mui/icons-material';
import type { CascadeScenario, CascadeResult, CascadeNode, CascadeWaveBreakdown } from '../types';

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
  
  // Load high-risk nodes on mount
  useEffect(() => {
    if (highRiskNodes.length === 0) {
      onLoadHighRisk();
    }
  }, [highRiskNodes.length, onLoadHighRisk]);

  const handleSimulate = async () => {
    const scenario = scenarios.find(s => s.name === selectedScenario);
    if (scenario) {
      await onSimulate(scenario, selectedPatientZero || undefined);
    }
  };

  const getScenarioIcon = (name: string) => {
    if (name.includes('Winter')) return '❄️';
    if (name.includes('Summer')) return '🌡️';
    if (name.includes('Hurricane')) return '🌀';
    return '⚡';
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
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, color: '#29B5E8' }}>
            <Science /> Simulation Configuration
          </Typography>
          
          <Grid container spacing={3}>
            {/* Scenario Selection */}
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Scenario</InputLabel>
                <Select
                  value={selectedScenario}
                  label="Scenario"
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

          {/* Scenario Description */}
          {selectedScenarioData && (
            <Alert 
              severity="info" 
              sx={{ mt: 2, bgcolor: alpha('#3B82F6', 0.1), '& .MuiAlert-icon': { color: '#3B82F6' } }}
            >
              <Typography variant="body2">{selectedScenarioData.description}</Typography>
              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                <Chip 
                  label={`Load Multiplier: ${selectedScenarioData.parameters.load_multiplier}x`} 
                  size="small" 
                  sx={{ bgcolor: alpha('#3B82F6', 0.2) }}
                />
                <Chip 
                  label={`Failure Threshold: ${(selectedScenarioData.parameters.failure_threshold * 100).toFixed(0)}%`} 
                  size="small" 
                  sx={{ bgcolor: alpha('#3B82F6', 0.2) }}
                />
                <Chip 
                  label={`Temp: ${selectedScenarioData.parameters.temperature_c}°C`} 
                  size="small" 
                  sx={{ bgcolor: alpha('#3B82F6', 0.2) }}
                />
              </Stack>
            </Alert>
          )}

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
