/**
 * Cascade Analysis Control Panel - Map-Integrated Drawer
 * 
 * Engineering: This panel MUST stay on the Operations Dashboard map view.
 * Utility operators need geographic context while analyzing cascade risk.
 * 
 * Design principles:
 * - Always visible on the map (collapsed or expanded)
 * - Results animate ON the map, not in a separate view
 * - High-risk nodes highlight geographically
 * - Never force a context-switch away from the map
 * - Clear Snowflake ML provenance and Cortex explainability
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Stack,
  LinearProgress,
  IconButton,
  Divider,
  Tooltip,
  Alert,
  alpha,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Collapse
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
  ChevronLeft,
  ChevronRight,
  Refresh,
  Science,
  AutoAwesome,
  Hub,
  Psychology,
  ExpandMore,
  ExpandLess,
  Info,
  FiberManualRecord,
  Insights,
  Assessment,
  Lightbulb,
  Description,
  Storage,
  Calculate,
  Waves
} from '@mui/icons-material';
import type { CascadeScenario, CascadeResult, CascadeNode, CascadeWaveBreakdown, CortexExplanation } from '../types';

interface CascadeControlPanelProps {
  scenarios: CascadeScenario[];
  cascadeResult: CascadeResult | null;
  highRiskNodes: CascadeNode[];
  riskPredictions: { transformer_id: string; risk_level: string }[];
  isSimulating: boolean;
  isLoadingPredictions: boolean;
  onSimulate: (scenario: CascadeScenario, patientZeroId?: string) => Promise<void>;
  onClear: () => void;
  onLoadHighRisk: () => Promise<void>;
  onLoadPredictions: () => Promise<void>;
  visible: boolean;
  onToggleVisibility: () => void;
  onOpenFullDashboard?: () => void;
  focusedWave: number | null;
  onFocusWave: (wave: number | null) => void;
}

// Wave breakdown calculation hook
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
      existing.customers_affected += (node.downstream_transformers || 1) * 50;
      
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

// Format customer count smartly (don't show "0K" for small numbers)
function formatCustomerCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
  return count.toLocaleString();
}

// Snowflake ML Provenance Badge - shows where ML is being used
function SnowflakeMLBadge({ 
  feature, 
  tooltip 
}: { 
  feature: 'cortex' | 'snowpark' | 'ml-model' | 'feature-store';
  tooltip: string;
}) {
  const configs = {
    'cortex': { icon: <AutoAwesome sx={{ fontSize: 10 }} />, label: 'Cortex LLM', color: '#29B5E8' },
    'snowpark': { icon: <Hub sx={{ fontSize: 10 }} />, label: 'Snowpark', color: '#29B5E8' },
    'ml-model': { icon: <Psychology sx={{ fontSize: 10 }} />, label: 'ML Model', color: '#29B5E8' },
    'feature-store': { icon: <Science sx={{ fontSize: 10 }} />, label: 'Feature Store', color: '#29B5E8' },
  };
  const config = configs[feature];
  
  return (
    <Tooltip title={tooltip} arrow placement="top">
      <Chip
        icon={config.icon}
        label={config.label}
        size="small"
        sx={{
          height: 18,
          fontSize: '0.6rem',
          bgcolor: alpha(config.color, 0.15),
          color: config.color,
          border: `1px solid ${alpha(config.color, 0.3)}`,
          '& .MuiChip-icon': { color: config.color, ml: 0.5 },
          '& .MuiChip-label': { px: 0.75 },
        }}
      />
    </Tooltip>
  );
}

// Cortex Explanation Component - fetches and displays LLM explanations with CACHING
function CortexExplanationPanel({ 
  cascadeResult,
  visible 
}: { 
  cascadeResult: CascadeResult | null;
  visible: boolean;
}) {
  const [explanation, setExplanation] = useState<CortexExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [explanationType, setExplanationType] = useState<'summary' | 'recommendations'>('summary');
  
  // Cache AI insights by cascade result ID + explanation type
  // Key: `${patient_zero_id}_${total_affected}_${type}` 
  const cacheRef = useRef<Map<string, CortexExplanation>>(new Map());
  
  // Generate cache key from cascade result
  const getCacheKey = useCallback((type: string) => {
    if (!cascadeResult) return '';
    return `${cascadeResult.patient_zero?.node_id || 'unknown'}_${cascadeResult.total_affected_nodes}_${type}`;
  }, [cascadeResult]);
  
  const fetchExplanation = useCallback(async (type: 'summary' | 'patient_zero' | 'wave_analysis' | 'recommendations') => {
    if (!cascadeResult) return;
    
    // Check cache first
    const cacheKey = getCacheKey(type);
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      console.log(`[CortexExplanation] Cache hit for ${cacheKey}`);
      setExplanation(cached);
      setExpanded(true);
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(`/api/cascade/explain?explanation_type=${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cascadeResult),
      });
      
      if (response.ok) {
        const data = await response.json();
        // Cache the result
        cacheRef.current.set(cacheKey, data);
        console.log(`[CortexExplanation] Cached ${cacheKey}`);
        setExplanation(data);
        setExpanded(true);
      }
    } catch (error) {
      console.error('Failed to fetch Cortex explanation:', error);
    } finally {
      setLoading(false);
    }
  }, [cascadeResult, getCacheKey]);
  
  // When cascade result changes, check if we have cached data for current type
  useEffect(() => {
    if (cascadeResult && expanded) {
      const cacheKey = getCacheKey(explanationType);
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setExplanation(cached);
      } else {
        // Clear stale explanation from different cascade
        setExplanation(null);
      }
    }
  }, [cascadeResult, expanded, explanationType, getCacheKey]);
  
  if (!visible || !cascadeResult) return null;
  
  return (
    <Box sx={{ 
      mt: 2, 
      p: 1.5, 
      bgcolor: alpha('#29B5E8', 0.08), 
      borderRadius: 2,
      border: '1px solid',
      borderColor: alpha('#29B5E8', 0.2)
    }}>
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesome sx={{ color: '#29B5E8', fontSize: 18 }} />
          <Typography variant="subtitle2" sx={{ color: '#29B5E8', fontWeight: 600 }}>
            AI Insights
          </Typography>
          <SnowflakeMLBadge feature="cortex" tooltip="Powered by Snowflake Cortex Complete (Claude 4.5 Sonnet)" />
        </Box>
        <IconButton size="small" sx={{ p: 0.25 }}>
          {expanded ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>
      
      <Collapse in={expanded}>
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={0.5} sx={{ mb: 1.5 }}>
            <Button
              size="small"
              variant={explanationType === 'summary' ? 'contained' : 'outlined'}
              onClick={() => { setExplanationType('summary'); fetchExplanation('summary'); }}
              disabled={loading}
              sx={{ 
                fontSize: '0.65rem', 
                py: 0.25, 
                px: 1,
                bgcolor: explanationType === 'summary' ? '#29B5E8' : 'transparent',
                borderColor: alpha('#29B5E8', 0.5),
                color: explanationType === 'summary' ? 'white' : '#29B5E8',
                '&:hover': { bgcolor: explanationType === 'summary' ? '#1A9FD1' : alpha('#29B5E8', 0.1) }
              }}
            >
              Summary
            </Button>
            <Button
              size="small"
              variant={explanationType === 'recommendations' ? 'contained' : 'outlined'}
              onClick={() => { setExplanationType('recommendations'); fetchExplanation('recommendations'); }}
              disabled={loading}
              sx={{ 
                fontSize: '0.65rem', 
                py: 0.25, 
                px: 1,
                bgcolor: explanationType === 'recommendations' ? '#29B5E8' : 'transparent',
                borderColor: alpha('#29B5E8', 0.5),
                color: explanationType === 'recommendations' ? 'white' : '#29B5E8',
                '&:hover': { bgcolor: explanationType === 'recommendations' ? '#1A9FD1' : alpha('#29B5E8', 0.1) }
              }}
            >
              Recommendations
            </Button>
          </Stack>
          
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
              <CircularProgress size={16} sx={{ color: '#29B5E8' }} />
              <Typography variant="caption" color="text.secondary">
                Generating AI insights...
              </Typography>
            </Box>
          ) : explanation ? (
            <Box>
              <Typography 
                variant="caption" 
                sx={{ 
                  display: 'block', 
                  color: 'text.primary', 
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap'
                }}
              >
                {explanation.explanation}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled', fontSize: '0.6rem' }}>
                Generated by {explanation.model} in {explanation.query_time_ms}ms
              </Typography>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Click a button above to generate AI-powered insights about this cascade simulation.
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

// Compact flow diagram for drawer
function CompactFlowDiagram({ 
  cascadeResult, 
  waveBreakdown, 
  focusedWave, 
  onFocusWave 
}: { 
  cascadeResult: CascadeResult; 
  waveBreakdown: CascadeWaveBreakdown[];
  focusedWave: number | null;
  onFocusWave: (wave: number | null) => void;
}) {
  if (waveBreakdown.length === 0) return null;
  
  // Wave colors with BETTER SEPARATION (matches useCascadeLayers.ts)
  const waveColors = ['#FF0032', '#FF6400', '#FFAA00', '#B4C800', '#64DC96'];
  
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>
          <AccountTree sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
          CASCADE PROPAGATION
        </Typography>
        {focusedWave !== null && (
          <Chip
            label="Clear Focus"
            size="small"
            onDelete={() => onFocusWave(null)}
            sx={{ 
              height: 18, 
              fontSize: '0.6rem',
              '& .MuiChip-deleteIcon': { fontSize: 14 }
            }}
          />
        )}
      </Box>
      
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {/* Patient Zero */}
        <Tooltip title={`${cascadeResult.patient_zero?.node_name || 'Patient Zero'} - Click to focus`}>
          <Box 
            onClick={() => onFocusWave(0)}
            sx={{
              px: 1, py: 0.5,
              bgcolor: focusedWave === 0 ? alpha('#FF0000', 0.4) : alpha('#FF0000', 0.2),
              borderRadius: 1,
              border: '1px solid #FF0000',
              cursor: 'pointer',
              transition: 'all 0.2s',
              transform: focusedWave === 0 ? 'scale(1.1)' : 'scale(1)',
              boxShadow: focusedWave === 0 ? '0 0 8px #FF0000' : 'none',
              '&:hover': { bgcolor: alpha('#FF0000', 0.35), transform: 'scale(1.05)' }
            }}
          >
            <Typography variant="caption" fontWeight={700} sx={{ color: '#FF0000' }}>P0</Typography>
          </Box>
        </Tooltip>
        
        <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>→</Typography>
        
        {/* Waves */}
        {waveBreakdown.slice(0, 5).map((wave, idx) => (
          <React.Fragment key={wave.wave_number}>
            <Tooltip title={`Wave ${wave.wave_number}: ${wave.nodes_failed} nodes, ${wave.capacity_lost_mw.toFixed(0)} MW - Click to focus`}>
              <Box 
                onClick={() => onFocusWave(focusedWave === wave.wave_number ? null : wave.wave_number)}
                sx={{
                  px: 1, py: 0.5,
                  bgcolor: focusedWave === wave.wave_number ? alpha(waveColors[idx], 0.5) : alpha(waveColors[idx], 0.2),
                  borderRadius: 1,
                  border: `1px solid ${waveColors[idx]}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  transform: focusedWave === wave.wave_number ? 'scale(1.15)' : 'scale(1)',
                  boxShadow: focusedWave === wave.wave_number ? `0 0 10px ${waveColors[idx]}` : 'none',
                  '&:hover': { bgcolor: alpha(waveColors[idx], 0.4), transform: 'scale(1.08)' }
                }}
              >
                <Typography variant="caption" fontWeight={600} sx={{ color: waveColors[idx] }}>
                  W{wave.wave_number}
                </Typography>
              </Box>
            </Tooltip>
            {idx < Math.min(waveBreakdown.length - 1, 4) && (
              <Typography sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>→</Typography>
            )}
          </React.Fragment>
        ))}
        
        <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>→</Typography>
        
        {/* Impact */}
        <Box sx={{
          px: 1, py: 0.5,
          bgcolor: alpha('#3B82F6', 0.2),
          borderRadius: 1,
          border: '1px solid #3B82F6',
        }}>
          <Typography variant="caption" fontWeight={700} sx={{ color: '#3B82F6' }}>
            {formatCustomerCount(cascadeResult.estimated_customers_affected)}
          </Typography>
        </Box>
      </Box>
      
      {focusedWave !== null && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary', fontStyle: 'italic' }}>
          Focused on {focusedWave === 0 ? 'Patient Zero' : `Wave ${focusedWave}`}. Click again or "Clear Focus" to resume animation.
        </Typography>
      )}
    </Box>
  );
}

// Wave breakdown mini-chart
function WaveBreakdownMini({ waveBreakdown }: { waveBreakdown: CascadeWaveBreakdown[] }) {
  if (waveBreakdown.length === 0) return null;

  const maxTotal = Math.max(...waveBreakdown.map(d => d.nodes_failed));
  // Wave colors with BETTER SEPARATION (matches useCascadeLayers.ts)
  const waveColors = ['#FF0032', '#FF6400', '#FFAA00', '#B4C800', '#64DC96'];

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 1.5, color: 'text.secondary' }}>
        <BarChart sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
        WAVE BREAKDOWN
      </Typography>
      
      <Stack spacing={0.5}>
        {waveBreakdown.slice(0, 5).map((wave, idx) => {
          const widthPercent = maxTotal > 0 ? (wave.nodes_failed / maxTotal) * 100 : 0;
          const color = waveColors[Math.min(idx, waveColors.length - 1)];
          
          return (
            <Box key={wave.wave_number} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ minWidth: 28, color, fontWeight: 600 }}>
                W{wave.wave_number}
              </Typography>
              <Box sx={{ flex: 1, height: 12, bgcolor: alpha('#fff', 0.05), borderRadius: 0.5, overflow: 'hidden' }}>
                <Box sx={{ 
                  width: `${widthPercent}%`, 
                  height: '100%', 
                  bgcolor: color,
                  transition: 'width 0.3s'
                }} />
              </Box>
              <Typography variant="caption" sx={{ minWidth: 20, textAlign: 'right', color: 'text.secondary' }}>
                {wave.nodes_failed}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

// High-risk nodes compact table
function HighRiskNodesCompact({ nodes, onSelect }: { nodes: CascadeNode[]; onSelect: (id: string) => void }) {
  if (nodes.length === 0) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>
          <Warning sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle', color: '#EF4444' }} />
          HIGH-RISK NODES (Patient Zero Candidates)
        </Typography>
        <Tooltip title="Ranked by NetworkX betweenness + degree centrality" arrow placement="top">
          <Chip
            label="NetworkX"
            size="small"
            sx={{
              height: 16,
              fontSize: '0.55rem',
              bgcolor: alpha('#8B5CF6', 0.2),
              color: '#8B5CF6',
              cursor: 'help'
            }}
          />
        </Tooltip>
      </Box>
      
      <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.disabled', fontSize: '0.6rem' }}>
        Criticality = betweenness_centrality × 0.6 + degree_centrality × 0.4
      </Typography>
      
      <TableContainer sx={{ maxHeight: 200 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ py: 0.5, fontSize: '0.7rem', fontWeight: 600 }}>Node</TableCell>
              <TableCell sx={{ py: 0.5, fontSize: '0.7rem', fontWeight: 600 }} align="right">Centrality</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {nodes.slice(0, 10).map((node, idx) => (
              <TableRow 
                key={node.node_id}
                onClick={() => onSelect(node.node_id)}
                sx={{ 
                  cursor: 'pointer',
                  '&:hover': { bgcolor: alpha('#FF6B6B', 0.1) },
                  bgcolor: idx < 3 ? alpha('#EF4444', 0.05) : 'transparent'
                }}
              >
                <TableCell sx={{ py: 0.5 }}>
                  <Typography variant="caption" sx={{ display: 'block', fontWeight: idx < 3 ? 600 : 400 }}>
                    {node.node_name || node.node_id.slice(0, 12)}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                    {node.node_type}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ py: 0.5 }}>
                  <Chip 
                    label={`${(node.criticality_score * 100).toFixed(0)}%`}
                    size="small"
                    sx={{ 
                      height: 18,
                      fontSize: '0.65rem',
                      bgcolor: node.criticality_score > 0.7 ? alpha('#EF4444', 0.2) : 
                               node.criticality_score > 0.4 ? alpha('#FBBF24', 0.2) : alpha('#22C55E', 0.2),
                      color: node.criticality_score > 0.7 ? '#EF4444' : 
                             node.criticality_score > 0.4 ? '#FBBF24' : '#22C55E'
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// Cascade child nodes display - shows affected nodes from patient zero
function CascadeChildNodes({ cascadeResult }: { cascadeResult: CascadeResult }) {
  // Wave colors with BETTER SEPARATION (matches useCascadeLayers.ts)
  const waveColors = ['#FF0032', '#FF6400', '#FFAA00', '#B4C800', '#64DC96'];
  
  if (!cascadeResult.cascade_order || cascadeResult.cascade_order.length === 0) {
    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          No cascade propagation detected for this scenario.
        </Typography>
      </Box>
    );
  }

  // Group nodes by wave
  const nodesByWave = cascadeResult.cascade_order.reduce((acc, node) => {
    const wave = node.wave_depth ?? Math.floor(node.order / 5) + 1;
    if (!acc[wave]) acc[wave] = [];
    acc[wave].push(node);
    return acc;
  }, {} as Record<number, Array<CascadeNode & { order: number; wave_depth?: number }>>);

  const waves = Object.keys(nodesByWave).map(Number).sort((a, b) => a - b);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 1.5, color: 'text.secondary' }}>
        <AccountTree sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
        AFFECTED CHILD NODES ({cascadeResult.cascade_order.length} total)
      </Typography>
      
      <Box sx={{ maxHeight: 250, overflowY: 'auto' }}>
        {/* Patient Zero */}
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ 
              width: 8, height: 8, borderRadius: '50%', 
              bgcolor: '#FF0000',
              boxShadow: '0 0 6px #FF0000'
            }} />
            <Typography variant="caption" fontWeight={700} sx={{ color: '#FF0000' }}>
              PATIENT ZERO
            </Typography>
          </Box>
          <Box sx={{ 
            ml: 2, pl: 1.5, 
            borderLeft: '2px solid',
            borderColor: alpha('#FF0000', 0.3)
          }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
              {cascadeResult.patient_zero?.node_name || cascadeResult.patient_zero?.node_id?.slice(0, 15)}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
              {cascadeResult.patient_zero?.node_type} • {((cascadeResult.patient_zero?.capacity_kw || 0) / 1000).toFixed(1)} MW
            </Typography>
          </Box>
        </Box>

        {/* Waves with child nodes */}
        {waves.map((waveNum, waveIdx) => {
          const waveNodes = nodesByWave[waveNum];
          const waveColor = waveColors[Math.min(waveIdx, waveColors.length - 1)];
          
          return (
            <Box key={waveNum} sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box sx={{ 
                  width: 8, height: 8, borderRadius: '50%', 
                  bgcolor: waveColor,
                  boxShadow: `0 0 4px ${waveColor}`
                }} />
                <Typography variant="caption" fontWeight={600} sx={{ color: waveColor }}>
                  WAVE {waveNum} ({waveNodes.length} nodes)
                </Typography>
              </Box>
              <Box sx={{ 
                ml: 2, pl: 1.5, 
                borderLeft: '2px solid',
                borderColor: alpha(waveColor, 0.3)
              }}>
                <Stack spacing={0.5}>
                  {waveNodes.slice(0, 5).map((node) => (
                    <Box key={node.node_id}>
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 500 }}>
                        {node.node_name || node.node_id.slice(0, 15)}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>
                        {node.node_type} • {((node.capacity_kw || 0) / 1000).toFixed(1)} MW • ~{formatCustomerCount((node.downstream_transformers || 1) * 50)} customers
                      </Typography>
                    </Box>
                  ))}
                  {waveNodes.length > 5 && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                      +{waveNodes.length - 5} more nodes...
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function CascadeControlPanel({
  scenarios,
  cascadeResult,
  highRiskNodes,
  riskPredictions,
  isSimulating,
  isLoadingPredictions,
  onSimulate,
  onClear,
  onLoadHighRisk,
  onLoadPredictions,
  visible,
  onToggleVisibility,
  focusedWave,
  onFocusWave,
}: CascadeControlPanelProps) {
  // visible prop now controls expanded state - toggle is in LAYERS panel
  const expanded = visible;
  const [selectedScenario, setSelectedScenario] = useState<string>(scenarios[0]?.name || '');
  const [selectedPatientZero, setSelectedPatientZero] = useState<string>('');
  const [activeTab, setActiveTab] = useState(0);
  const waveBreakdown = useWaveBreakdown(cascadeResult);
  
  // Load high-risk nodes when panel expands
  useEffect(() => {
    if (visible && highRiskNodes.length === 0) {
      onLoadHighRisk();
    }
  }, [visible, highRiskNodes.length, onLoadHighRisk]);

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

  const drawerWidth = 380;

  // Don't render anything if not visible
  if (!visible) return null;

  return (
    <>
      {/* Slide-out Drawer - controlled by LAYERS panel toggle */}
      <Paper
        sx={{
          position: 'absolute',
          top: 12,
          right: 0,
          width: drawerWidth,
          maxHeight: 'calc(100vh - 180px)',
          bgcolor: alpha('#1E293B', 0.97),
          backdropFilter: 'blur(12px)',
          borderRadius: '12px 0 0 12px',
          border: '1px solid',
          borderRight: 'none',
          borderColor: alpha('#FF6B6B', 0.3),
          overflow: 'hidden',
          zIndex: 14, // Above map
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideIn 0.3s ease-out',
          '@keyframes slideIn': {
            from: { transform: 'translateX(100%)' },
            to: { transform: 'translateX(0)' }
          }
        }}
      >
        {/* Header with close button */}
        <Box sx={{ 
          p: 2, 
          borderBottom: '1px solid', 
          borderColor: alpha('#fff', 0.1),
          bgcolor: alpha('#FF6B6B', 0.05),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="h6" sx={{ color: '#FF6B6B', fontWeight: 600 }}>
                Cascade Failure Analysis
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Powered by
              </Typography>
              <SnowflakeMLBadge feature="snowpark" tooltip="Graph analysis via Snowpark Python UDFs" />
              <SnowflakeMLBadge feature="cortex" tooltip="AI explanations via Cortex Complete" />
            </Box>
          </Box>
          <IconButton 
            size="small" 
            onClick={onToggleVisibility}
            sx={{ color: 'text.secondary', '&:hover': { color: '#FF6B6B' } }}
          >
            <ChevronRight />
          </IconButton>
        </Box>

        {/* Scrollable Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          
          {/* ML vs Gen AI EXPLAINER - Clear separation */}
          <Box sx={{ mb: 2 }}>
            {/* Section Header */}
            <Typography variant="caption" sx={{ 
              fontWeight: 700, 
              color: 'text.secondary', 
              display: 'block', 
              mb: 1.5,
              textTransform: 'uppercase',
              letterSpacing: 1
            }}>
              How This Analysis Works
            </Typography>
            
            {/* TWO DISTINCT SECTIONS: ML vs Gen AI */}
            <Stack spacing={1.5}>
              
              {/* SECTION A: Graph ML (Purple) - DETAILED */}
              <Box sx={{ 
                p: 1.5, 
                bgcolor: alpha('#8B5CF6', 0.1), 
                borderRadius: 2,
                border: '2px solid',
                borderColor: '#8B5CF6'
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <Hub sx={{ color: '#8B5CF6', fontSize: 20 }} />
                  <Typography variant="subtitle2" sx={{ color: '#8B5CF6', fontWeight: 700 }}>
                    Graph ML Analysis
                  </Typography>
                  <Chip 
                    label="NetworkX + Snowpark" 
                    size="small" 
                    sx={{ 
                      height: 18, 
                      fontSize: '0.6rem', 
                      bgcolor: alpha('#8B5CF6', 0.2), 
                      color: '#8B5CF6',
                      ml: 'auto'
                    }} 
                  />
                </Box>
                
                {/* Step 1: Graph Construction */}
                <Box sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <Storage sx={{ color: '#8B5CF6', fontSize: 16 }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#8B5CF6', fontSize: '0.7rem' }}>
                      1. Graph Construction
                    </Typography>
                  </Box>
                  <Box sx={{ ml: 3, pl: 1, borderLeft: '2px solid', borderColor: alpha('#8B5CF6', 0.3) }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block', lineHeight: 1.5 }}>
                      Load 1,873 substations & transformers as nodes with edges representing electrical connections. 
                      Each node has capacity (kW), load factor, and downstream customer count.
                    </Typography>
                  </Box>
                </Box>
                
                {/* Step 2: Centrality Scoring */}
                <Box sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <FiberManualRecord sx={{ color: '#8B5CF6', fontSize: 16 }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#8B5CF6', fontSize: '0.7rem' }}>
                      2. Centrality Scoring
                    </Typography>
                  </Box>
                  <Box sx={{ ml: 3, pl: 1, borderLeft: '2px solid', borderColor: alpha('#8B5CF6', 0.3) }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block', lineHeight: 1.5 }}>
                      <strong>Betweenness centrality</strong> (60% weight): How many shortest paths pass through this node?
                      <br />
                      <strong>Degree centrality</strong> (40% weight): How many direct connections does this node have?
                      <br />
                      Higher scores = more critical infrastructure, worse cascade impact if failed.
                    </Typography>
                  </Box>
                </Box>
                
                {/* Step 3: BFS Propagation */}
                <Box sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <Waves sx={{ color: '#8B5CF6', fontSize: 16 }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#8B5CF6', fontSize: '0.7rem' }}>
                      3. BFS Failure Propagation
                    </Typography>
                  </Box>
                  <Box sx={{ ml: 3, pl: 1, borderLeft: '2px solid', borderColor: alpha('#8B5CF6', 0.3) }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block', lineHeight: 1.5 }}>
                      Starting from "Patient Zero", simulate wave-by-wave failure spread using breadth-first search.
                      Adjacent nodes fail if: <code style={{ background: 'rgba(139,92,246,0.2)', padding: '1px 4px', borderRadius: 2 }}>load_factor × stress_multiplier &gt; threshold</code>
                    </Typography>
                  </Box>
                </Box>
                
                {/* Step 4: Impact Calculation */}
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <Calculate sx={{ color: '#8B5CF6', fontSize: 16 }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#8B5CF6', fontSize: '0.7rem' }}>
                      4. Impact Calculation
                    </Typography>
                  </Box>
                  <Box sx={{ ml: 3, pl: 1, borderLeft: '2px solid', borderColor: alpha('#8B5CF6', 0.3) }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block', lineHeight: 1.5 }}>
                      Sum capacity lost (MW), count affected nodes per wave, estimate customers affected 
                      (downstream_transformers × 50 avg customers each).
                    </Typography>
                  </Box>
                </Box>
                
                <Typography variant="caption" sx={{ display: 'block', mt: 1.5, pt: 1, borderTop: '1px solid', borderColor: alpha('#8B5CF6', 0.2), color: 'text.disabled', fontSize: '0.55rem' }}>
                  Executes as Snowpark Python UDF • Source: NODE_CENTRALITY_FEATURES_V2
                </Typography>
              </Box>
              
              {/* SECTION B: Gen AI (Cyan/Teal) */}
              <Box sx={{ 
                p: 1.5, 
                bgcolor: alpha('#29B5E8', 0.1), 
                borderRadius: 2,
                border: '2px solid',
                borderColor: '#29B5E8'
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <AutoAwesome sx={{ color: '#29B5E8', fontSize: 20 }} />
                  <Typography variant="subtitle2" sx={{ color: '#29B5E8', fontWeight: 700 }}>
                    Generative AI Insights
                  </Typography>
                  <Chip 
                    label="Cortex LLM" 
                    size="small" 
                    sx={{ 
                      height: 18, 
                      fontSize: '0.6rem', 
                      bgcolor: alpha('#29B5E8', 0.2), 
                      color: '#29B5E8',
                      ml: 'auto'
                    }} 
                  />
                </Box>
                
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#29B5E8', 0.1), borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Description sx={{ color: '#29B5E8', fontSize: 14 }} />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: '#29B5E8', fontSize: '0.65rem' }}>
                        Summary
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>
                      Translates graph metrics into plain English explanation of cascade severity
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#29B5E8', 0.1), borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Lightbulb sx={{ color: '#29B5E8', fontSize: 14 }} />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: '#29B5E8', fontSize: '0.65rem' }}>
                        Recommendations
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>
                      Generates actionable mitigation steps based on simulation results
                    </Typography>
                  </Box>
                </Box>
                
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled', fontSize: '0.55rem' }}>
                  Powered by Snowflake Cortex Complete (Claude 4.5 Sonnet)
                </Typography>
              </Box>
            </Stack>
          </Box>

          {/* SECTION: Cascade Simulation Controls */}
          <Box sx={{ 
            mb: 2.5, 
            p: 1.5, 
            bgcolor: alpha('#FF6B6B', 0.08), 
            borderRadius: 2,
            border: '1px solid',
            borderColor: alpha('#FF6B6B', 0.2)
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AccountTree sx={{ color: '#FF6B6B', fontSize: 18 }} />
                <Typography variant="subtitle2" sx={{ color: '#FF6B6B', fontWeight: 600 }}>
                  Run Simulation
                </Typography>
              </Box>
            </Box>

            {/* Scenario Selection */}
            <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
              <InputLabel sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>Scenario</InputLabel>
              <Select
                value={selectedScenario}
                label="Scenario"
                onChange={(e) => setSelectedScenario(e.target.value)}
                sx={{ 
                  fontSize: '0.85rem',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#FF6B6B', 0.3) } 
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

            {/* Scenario Info */}
            {selectedScenario && (
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1.5, fontStyle: 'italic' }}>
                {scenarios.find(s => s.name === selectedScenario)?.description}
              </Typography>
            )}

            {/* Patient Zero Selection */}
            <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
              <InputLabel sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>Starting Point (Patient Zero)</InputLabel>
              <Select
                value={selectedPatientZero}
                label="Starting Point (Patient Zero)"
                onChange={(e) => setSelectedPatientZero(e.target.value)}
                sx={{ 
                  fontSize: '0.85rem',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#FF6B6B', 0.3) } 
                }}
              >
                <MenuItem value="">
                  <em>Auto-select highest risk node</em>
                </MenuItem>
                {highRiskNodes.slice(0, 15).map((node) => (
                  <MenuItem key={node.node_id} value={node.node_id}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                      <Warning sx={{ color: '#FF6B6B', fontSize: 16 }} />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" sx={{ display: 'block' }}>
                          {node.node_name || node.node_id.slice(0, 15)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                          Centrality: {(node.criticality_score * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Simulation Button */}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                fullWidth
                onClick={handleSimulate}
                disabled={isSimulating || !selectedScenario}
                startIcon={isSimulating ? <Speed /> : <PlayArrow />}
                sx={{
                  bgcolor: '#FF6B6B',
                  fontSize: '0.8rem',
                  py: 0.75,
                  '&:hover': { bgcolor: '#FF5252' },
                  '&:disabled': { bgcolor: alpha('#FF6B6B', 0.3) },
                }}
              >
                {isSimulating ? 'Simulating...' : 'Run Cascade Simulation'}
              </Button>
              {cascadeResult && (
                <Tooltip title="Clear results">
                  <Button
                    variant="outlined"
                    onClick={() => { onClear(); onFocusWave(null); }}
                    sx={{ borderColor: alpha('#FF6B6B', 0.5), minWidth: 44, color: '#FF6B6B' }}
                  >
                    <Stop />
                  </Button>
                </Tooltip>
              )}
            </Stack>

            {isSimulating && (
              <LinearProgress 
                sx={{ mt: 1.5, bgcolor: alpha('#FF6B6B', 0.2), '& .MuiLinearProgress-bar': { bgcolor: '#FF6B6B' } }} 
              />
            )}
          </Box>

          {/* SECTION 2: ML Risk Prediction */}
          <Box sx={{ 
            mb: 2.5, 
            p: 1.5, 
            bgcolor: alpha('#8B5CF6', 0.08), 
            borderRadius: 2,
            border: '1px solid',
            borderColor: alpha('#8B5CF6', 0.2)
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Science sx={{ color: '#8B5CF6', fontSize: 18 }} />
                <Typography variant="subtitle2" sx={{ color: '#8B5CF6', fontWeight: 600 }}>
                  ML Risk Prediction
                </Typography>
              </Box>
              <SnowflakeMLBadge 
                feature="ml-model" 
                tooltip="Temporal ML model: predicts 4 PM risk from 8 AM state using Snowflake ML" 
              />
            </Box>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1.5, lineHeight: 1.4 }}>
              <strong>Predictive maintenance:</strong> Temporal model predicts which transformers will be 
              high-risk by afternoon based on morning load, age, and historical stress patterns.
            </Typography>
            
            <Button
              variant={riskPredictions.length > 0 ? 'contained' : 'outlined'}
              fullWidth
              onClick={onLoadPredictions}
              disabled={isLoadingPredictions}
              startIcon={isLoadingPredictions ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <Science sx={{ fontSize: 16 }} />}
              sx={{
                borderColor: alpha('#8B5CF6', 0.5),
                bgcolor: riskPredictions.length > 0 ? '#8B5CF6' : 'transparent',
                color: riskPredictions.length > 0 ? 'white' : '#8B5CF6',
                fontSize: '0.8rem',
                py: 0.75,
                '&:hover': { bgcolor: riskPredictions.length > 0 ? '#7C3AED' : alpha('#8B5CF6', 0.1), borderColor: '#8B5CF6' },
              }}
            >
              {isLoadingPredictions ? 'Loading...' : riskPredictions.length > 0 ? `${riskPredictions.length} Predictions Loaded` : 'Load Transformer Risk Predictions'}
            </Button>
            
            {/* Prediction Results Summary */}
            {riskPredictions.length > 0 && (
              <Box sx={{ mt: 1.5, p: 1, bgcolor: alpha('#8B5CF6', 0.1), borderRadius: 1, border: '1px solid', borderColor: alpha('#8B5CF6', 0.3) }}>
                <Stack direction="row" spacing={1} justifyContent="space-around">
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" sx={{ color: '#EF4444', fontWeight: 700, fontSize: '1rem' }}>
                      {riskPredictions.filter(p => p.risk_level === 'critical').length}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>Critical</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" sx={{ color: '#F59E0B', fontWeight: 700, fontSize: '1rem' }}>
                      {riskPredictions.filter(p => p.risk_level === 'warning').length}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>Warning</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" sx={{ color: '#8B5CF6', fontWeight: 700, fontSize: '1rem' }}>
                      {riskPredictions.filter(p => p.risk_level === 'elevated').length}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>Elevated</Typography>
                  </Box>
                </Stack>
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary', fontSize: '0.6rem', textAlign: 'center' }}>
                  Showing on map as purple markers (zoom in if needed)
                </Typography>
              </Box>
            )}
            
            {/* ML Model Details - only show when no predictions loaded */}
            {riskPredictions.length === 0 && !isLoadingPredictions && (
              <Box sx={{ mt: 1.5, p: 1, bgcolor: alpha('#8B5CF6', 0.05), borderRadius: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block', mb: 0.5 }}>
                  <strong>Model Features:</strong> morning_load_pct, transformer_age, historical_avg_load, stress_vs_historical
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }}>
                  <strong>Target Accuracy:</strong> 78-85% • <strong>Data:</strong> SI_DEMOS.ML_DEMO.T_TRANSFORMER_TEMPORAL_TRAINING
                </Typography>
              </Box>
            )}
          </Box>

          {/* Results Section */}
          {cascadeResult && (
            <>
              <Divider sx={{ my: 2, borderColor: alpha('#fff', 0.1) }} />
              
              {/* Impact Metrics with ML provenance */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>
                  SIMULATION RESULTS
                </Typography>
                <Tooltip title="Computed via Snowpark Python UDF with NetworkX BFS traversal" arrow placement="top">
                  <Chip
                    icon={<Science sx={{ fontSize: 12 }} />}
                    label="Snowpark + NetworkX"
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: '0.55rem',
                      bgcolor: alpha('#29B5E8', 0.15),
                      color: '#29B5E8',
                      '& .MuiChip-icon': { color: '#29B5E8' }
                    }}
                  />
                </Tooltip>
              </Box>
              
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Box sx={{ 
                  flex: 1, p: 1.5, bgcolor: alpha('#FF6B6B', 0.1), borderRadius: 1, textAlign: 'center',
                  border: '1px solid', borderColor: alpha('#FF6B6B', 0.3)
                }}>
                  <ElectricalServices sx={{ color: '#FF6B6B', fontSize: 20 }} />
                  <Typography variant="h6" fontWeight={700}>{cascadeResult.total_affected_nodes}</Typography>
                  <Typography variant="caption" color="text.secondary">Nodes</Typography>
                </Box>
                
                <Box sx={{ 
                  flex: 1, p: 1.5, bgcolor: alpha('#FBBF24', 0.1), borderRadius: 1, textAlign: 'center',
                  border: '1px solid', borderColor: alpha('#FBBF24', 0.3)
                }}>
                  <TrendingUp sx={{ color: '#FBBF24', fontSize: 20 }} />
                  <Typography variant="h6" fontWeight={700}>{(cascadeResult.affected_capacity_mw / 1000).toFixed(1)}</Typography>
                  <Typography variant="caption" color="text.secondary">GW Lost</Typography>
                </Box>
                
                <Box sx={{ 
                  flex: 1, p: 1.5, bgcolor: alpha('#3B82F6', 0.1), borderRadius: 1, textAlign: 'center',
                  border: '1px solid', borderColor: alpha('#3B82F6', 0.3)
                }}>
                  <Groups sx={{ color: '#3B82F6', fontSize: 20 }} />
                  <Typography variant="h6" fontWeight={700}>{formatCustomerCount(cascadeResult.estimated_customers_affected)}</Typography>
                  <Typography variant="caption" color="text.secondary">Customers</Typography>
                </Box>
              </Stack>

              {/* Tabs for detailed views */}
              <Tabs 
                value={activeTab} 
                onChange={(_, v) => setActiveTab(v)}
                sx={{ 
                  minHeight: 32,
                  mb: 1,
                  '& .MuiTab-root': { minHeight: 32, py: 0.5, fontSize: '0.65rem', minWidth: 'auto', px: 1 }
                }}
              >
                <Tab label="Flow" icon={<AccountTree sx={{ fontSize: 14 }} />} iconPosition="start" />
                <Tab label="Waves" icon={<BarChart sx={{ fontSize: 14 }} />} iconPosition="start" />
                <Tab label="Children" icon={<ElectricalServices sx={{ fontSize: 14 }} />} iconPosition="start" />
                <Tab label="At Risk" icon={<Warning sx={{ fontSize: 14 }} />} iconPosition="start" />
              </Tabs>

              {activeTab === 0 && <CompactFlowDiagram cascadeResult={cascadeResult} waveBreakdown={waveBreakdown} focusedWave={focusedWave} onFocusWave={onFocusWave} />}
              {activeTab === 1 && <WaveBreakdownMini waveBreakdown={waveBreakdown} />}
              {activeTab === 2 && <CascadeChildNodes cascadeResult={cascadeResult} />}
              {activeTab === 3 && <HighRiskNodesCompact nodes={highRiskNodes} onSelect={setSelectedPatientZero} />}
              
              {/* Cortex AI Insights - available after simulation */}
              <CortexExplanationPanel cascadeResult={cascadeResult} visible={true} />
            </>
          )}

          {/* No results - show high risk nodes */}
          {!cascadeResult && (
            <HighRiskNodesCompact nodes={highRiskNodes} onSelect={setSelectedPatientZero} />
          )}
        </Box>

        {/* Footer Actions - simplified */}
        <Box sx={{ 
          p: 1.5, 
          borderTop: '1px solid', 
          borderColor: alpha('#fff', 0.1),
          bgcolor: alpha('#000', 0.2)
        }}>
          <Tooltip title="Refresh high-risk node rankings (graph centrality scores)">
            <Button
              variant="text"
              size="small"
              fullWidth
              onClick={onLoadHighRisk}
              startIcon={<Refresh sx={{ fontSize: 14 }} />}
              sx={{ fontSize: '0.7rem', color: 'text.secondary' }}
            >
              Refresh Node Rankings
            </Button>
          </Tooltip>
        </Box>
      </Paper>
      
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
        }
      `}</style>
    </>
  );
}

export default CascadeControlPanel;
