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
import { createPortal } from 'react-dom';
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
  Collapse,
  Menu,
  ListItemIcon,
  ListItemText
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
  Waves,
  SwapHoriz,
  AttachMoney,
  PriorityHigh,
  CheckCircle,
  OpenInFull,
  CloseFullscreen,
  ViewSidebar,
  DockOutlined,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  KeyboardArrowUp,
  KeyboardArrowDown,
  DragIndicator,
  Minimize,
  Close,
  // Actionable cascade analysis icons
  Shield,
  RestartAlt,
  LocalFireDepartment,
  Engineering,
  AccessTime,
  MonetizationOn,
} from '@mui/icons-material';
import { LAYOUT } from '../layoutConstants';
import { CascadeAnalysisDashboard } from './CascadeAnalysisDashboard';

// Layout mode type for docking functionality
// Simplified: Only overlay (map panel) and docked-bottom (Gmail-style)
export type CascadeLayoutMode = 'overlay' | 'docked-bottom';
// Size state for docked panels (Gmail/Slack style)
export type DockedPanelSize = 'minimized' | 'compact' | 'expanded' | 'fullscreen';
import type { CascadeScenario, CascadeResult, CascadeNode, CascadeWaveBreakdown, CortexExplanation } from '../types';

// =============================================================================
// ACTIONABLE: Types for new actionable cascade analysis features
// These interfaces match the actual backend API response structures
// =============================================================================

// Economic Impact - matches /api/cascade/economic-impact response
interface EconomicImpactResponse {
  economic_impact: {
    total_estimated_cost: number;
    breakdown: {
      regulatory_penalties: { puct_customer_service: number; ercot_reliability: number; subtotal: number };
      lost_revenue: { unserved_energy_mwh: number; subtotal: number };
      restoration_costs: { crew_hours: number; crew_cost: number; equipment_cost: number; subtotal: number };
    };
    currency: string;
  };
  severity_assessment: {
    tier: 'EMERGENCY' | 'CRITICAL' | 'HIGH' | 'MODERATE';
    description: string;
    customers_affected: number;
    estimated_duration_hours: number;
    thresholds: { media_attention: boolean; regulatory_scrutiny: boolean; emergency_declaration: boolean };
  };
  executive_summary: string;
  query_time_ms: number;
}

// Mitigation Playbook - matches /api/cascade/mitigation-actions response
interface MitigationPlaybookResponse {
  playbook: {
    immediate_actions: Array<{
      priority: number;
      action: string;
      description: string;
      time_target: string;
      prevents: string;
    }>;
    choke_point_interventions: Array<{
      node_id: string;
      downstream_impact: number;
      action: string;
      rationale: string;
    }>;
    load_transfer_options: Array<{
      from_node: string | null;
      action: string;
      capacity_recoverable_mw: number;
    }>;
    crew_dispatch: {
      primary_location: {
        node_id: string;
        node_name: string;
        lat: number;
        lon: number;
        reason: string;
      };
      secondary_locations: Array<{ node_id: string; reason: string }>;
      estimated_crews_needed: number;
      equipment_to_stage: string[];
    };
    containment_probability: {
      with_immediate_action: number;
      with_15min_delay: number;
      with_30min_delay: number;
      interpretation: string;
    };
  };
  summary: string;
  cascade_context: {
    patient_zero: string;
    total_at_risk_nodes: number;
    wave_1_nodes: number;
  };
  query_time_ms: number;
}

// Restoration Sequence - matches /api/cascade/restoration-sequence response
interface RestorationSequenceResponse {
  restoration_sequence: Array<{
    sequence: number;
    node_id: string;
    node_name: string;
    node_type: string;
    customers_restored: number;
    cumulative_customers: number;
    cumulative_hours: number;
    priority_score: number;
    estimated_hours: number;
    depends_on: string | null;
    rationale: string;
  }>;
  milestones: Array<{
    milestone: string;
    after_step: number;
    node: string;
    hours: number;
  }>;
  summary: {
    total_nodes: number;
    total_customers: number;
    estimated_total_hours: number;
    parallel_crews_recommended: number;
  };
  optimization_note: string;
  query_time_ms: number;
}

// Realtime Risk - matches /api/cascade/realtime-risk response
interface RealtimeRiskResponse {
  realtime_risk: {
    score: number;
    level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL';
    color: string;
    recommended_action: string;
  };
  risk_factors: {
    load_stress: { score: number; max: number; detail: string };
    peak_hour: { score: number; max: number; detail: string };
    equipment_stress: { score: number; max: number; detail: string };
    network_vulnerability: { score: number; max: number; detail: string };
  };
  timestamp: string;
  query_time_ms: number;
}

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
  // Gmail-style dock coordination
  isDocked?: boolean;
  dockedSize?: DockedPanelSize;
  onDockedSizeChange?: (size: DockedPanelSize) => void;
  onDockChange?: (docked: boolean) => void;
  // Other panel states for side-by-side coordination
  otherPanelDocked?: boolean;
  otherPanelSize?: DockedPanelSize;
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

// Official Snowflake Logo Icon (inline SVG) - generic snowflake
const SnowflakeIcon = ({ size = 12, color = '#29B5E8' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 256 255" fill={color} style={{ display: 'block' }}>
    <path d="M100.211702,161.190001 C108.361987,161.768743 114.819378,168.444268 114.987899,176.631939 L114.991274,176.960242 L114.991274,239.05522 C114.991274,247.806283 107.825253,254.896935 99.0263033,254.896935 C90.2913434,254.896935 83.2133764,247.976113 83.0440909,239.370791 L83.0409894,239.05522 L83.0409894,204.320372 L52.633017,221.703374 C45.0083699,226.099982 35.2570326,223.497571 30.8298183,215.939585 C26.4801783,208.459856 28.963909,198.900148 36.3712482,194.444964 L36.6661961,194.271769 L90.9411815,163.257269 C93.8556716,161.574865 97.0956384,160.926095 100.211702,161.190001 Z M164.664258,163.043676 L165.046166,163.257269 L219.310056,194.271769 C226.956895,198.648217 229.551457,208.361439 225.155681,215.939585 C220.807865,223.399415 211.240891,226.031551 203.652816,221.871133 L203.354331,221.703374 L172.966701,204.320372 L172.966701,239.05522 C172.966701,247.806283 165.822871,254.896935 156.981387,254.896935 C148.246427,254.896935 141.18651,247.976113 141.01766,239.370791 L141.014566,239.05522 L141.014566,176.960242 C141.014566,168.623365 147.516691,161.77646 155.794139,161.190001 C158.765877,160.937569 161.850978,161.520176 164.664258,163.043676 Z M23.6714423,82.5093782 L23.9707798,82.6760126 L78.2050804,113.710673 C82.0183286,115.889734 84.5629599,119.346174 85.6374007,123.214969 C85.9943147,124.461194 86.157053,125.705586 86.2199292,126.951811 C86.2606135,128.6727 86.0349995,130.415582 85.4931558,132.107149 C84.3865987,135.660966 82.0289233,138.838025 78.5671295,140.931444 L78.2050804,141.144111 L23.9707798,172.198931 C16.3146948,176.566215 6.55411109,173.982131 2.16018402,166.425978 C-2.21027119,158.926896 0.27477397,149.413214 7.70459069,144.951419 L7.99656187,144.780154 L38.302823,127.457631 L7.99656187,110.087458 C0.340476864,105.709177 -2.27627683,96.0472707 2.16018402,88.4819536 C6.49704711,81.0040344 16.0620783,78.3770205 23.6714423,82.5093782 Z M253.847506,88.4819536 C258.272871,96.0472707 255.656117,105.709177 248.001882,110.087458 L217.693712,127.457631 L248.001882,144.780154 C255.656117,149.188668 258.272871,158.838342 253.847506,166.425978 C249.500538,173.903898 239.936397,176.53048 232.328211,172.370731 L232.027134,172.198931 L177.79698,141.144111 C173.983732,138.965051 171.43997,135.508611 170.36553,131.639816 C170.008616,130.393591 169.845876,129.149199 169.783,127.902974 C169.742316,126.182086 169.967913,124.439186 170.509774,122.747637 C171.616331,119.193819 173.973939,116.01676 177.435733,113.923341 L177.79698,113.710673 L232.027134,82.6760126 C239.682247,78.2994279 249.421679,80.902007 253.847506,88.4819536 Z M128.015985,83.1109162 C152.410613,83.1109162 172.195048,102.800698 172.195048,127.076856 C172.195048,151.353014 152.410613,171.042796 128.015985,171.042796 C103.621357,171.042796 83.8369227,151.353014 83.8369227,127.076856 C83.8369227,102.800698 103.621357,83.1109162 128.015985,83.1109162 Z M156.981387,0 C165.730971,0 172.966701,7.08785582 172.966701,15.8417254 L172.966701,50.5859033 L203.354331,33.2029008 C210.979979,28.806293 220.730316,31.4087037 225.155681,38.9668341 C229.505296,46.4465533 227.021566,56.0062613 219.614227,60.4614453 L219.310056,60.6346359 L165.046166,91.6486266 C162.131676,93.3310306 158.891709,93.9797999 155.775645,93.7158943 C147.625361,93.1371518 141.167969,86.4616269 140.999449,78.2739553 L140.996073,77.9456529 L140.996073,15.8417254 C140.996073,7.08785582 148.18439,0 156.981387,0 Z M99.0263033,0 C107.775887,0 114.991274,7.08785582 114.991274,15.8417254 L114.991274,77.9456529 C114.991274,86.2825301 108.489149,93.1294351 100.211702,93.7158943 C97.2399632,93.9683263 94.1548616,93.3857192 91.3415816,91.8622195 L90.9595725,91.6486266 L36.6661961,60.6346359 C29.0100358,56.2667889 26.3937734,46.5448672 30.8298183,38.9668341 C35.1776281,31.5070641 44.7445152,28.8748487 52.3532128,33.0351525 L52.6518699,33.2029008 L83.0227023,50.5859033 L83.0227023,15.8417254 C83.0227023,7.08785582 90.2273187,0 99.0263033,0 Z"/>
  </svg>
);

// Service-specific icon components using official Snowflake icons
const SnowparkIcon = ({ size = 14 }: { size?: number }) => (
  <img src="/icons/Snowflake_ICON_Snowpark.svg" alt="Snowpark" width={size} height={size} style={{ display: 'block' }} />
);

const CortexCompleteIcon = ({ size = 14 }: { size?: number }) => (
  <img src="/icons/Snowflake_ICON_LLM.svg" alt="Cortex Complete" width={size} height={size} style={{ display: 'block' }} />
);

// Snowflake ML Provenance Badge - shows where ML is being used
function SnowflakeMLBadge({ 
  feature, 
  tooltip,
  compact = false  // Icon-only mode for floating panels
}: { 
  feature: 'cortex-complete' | 'snowpark' | 'ml-model' | 'feature-store';
  tooltip: string;
  compact?: boolean;
}) {
  const configs = {
    'cortex-complete': { label: 'Cortex Complete', color: '#29B5E8' },
    'snowpark': { label: 'Snowpark', color: '#29B5E8' },
    'ml-model': { label: 'ML Model', color: '#29B5E8' },
    'feature-store': { label: 'Feature Store', color: '#29B5E8' },
  };
  const config = configs[feature];
  
  // Render service-specific icon
  const renderIcon = () => {
    switch (feature) {
      case 'cortex-complete':
        return <CortexCompleteIcon size={12} />;
      case 'snowpark':
        return <SnowparkIcon size={12} />;
      default:
        return <SnowflakeIcon size={12} color={config.color} />;
    }
  };
  
  return (
    <Tooltip title={compact ? config.label : tooltip} arrow placement="top">
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 0 : 0.5,
          height: 20,
          width: compact ? 24 : 'auto',  // Fixed width for icon-only
          px: compact ? 0 : 0.75,
          py: 0.25,
          borderRadius: compact ? '50%' : '10px',  // Circle for icon-only
          fontSize: '0.6rem',
          fontWeight: 600,
          bgcolor: alpha(config.color, 0.12),
          color: config.color,
          border: `1px solid ${alpha(config.color, 0.25)}`,
          whiteSpace: 'nowrap',
          cursor: 'default',
          transition: 'all 0.15s ease',
          '&:hover': {
            bgcolor: alpha(config.color, 0.18),
            borderColor: alpha(config.color, 0.4),
          },
        }}
      >
        {renderIcon()}
        {!compact && <span>{config.label}</span>}
      </Box>
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
          <SnowflakeMLBadge feature="cortex-complete" tooltip="Powered by Snowflake Cortex Complete (Claude 4.5 Sonnet)" />
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

// Cross-Region Flow data interface
interface CrossRegionFlow {
  source_region: string;
  target_region: string;
  flow_capacity_mw: number;
  connection_count: number;
  vulnerability_score: number;
}

// Engineering: Compact Cross-Region Flow Panel for drawer integration
// Shows inter-regional power flows without requiring full-page context switch
function CrossRegionFlowCompact({ highRiskNodes, cascadeResult }: { highRiskNodes: CascadeNode[]; cascadeResult: CascadeResult | null }) {
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);
  
  // Generate cross-region flow data based on cascade propagation patterns
  const crossRegionFlows = useMemo<CrossRegionFlow[]>(() => {
    const regionConnections: CrossRegionFlow[] = [
      { source_region: 'Houston Metro', target_region: 'North', flow_capacity_mw: 2400, connection_count: 12, vulnerability_score: 0.72 },
      { source_region: 'Houston Metro', target_region: 'Southwest', flow_capacity_mw: 1800, connection_count: 8, vulnerability_score: 0.45 },
      { source_region: 'Houston Metro', target_region: 'Coastal', flow_capacity_mw: 2100, connection_count: 15, vulnerability_score: 0.68 },
      { source_region: 'Houston Metro', target_region: 'East', flow_capacity_mw: 950, connection_count: 5, vulnerability_score: 0.35 },
      { source_region: 'North', target_region: 'West', flow_capacity_mw: 450, connection_count: 3, vulnerability_score: 0.22 },
      { source_region: 'Southwest', target_region: 'Coastal', flow_capacity_mw: 680, connection_count: 4, vulnerability_score: 0.38 },
    ];
    
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
  const criticalCount = crossRegionFlows.filter(f => f.vulnerability_score > 0.6).length;

  const regionShortNames: Record<string, string> = {
    'Houston Metro': 'HOU',
    'North': 'N',
    'Southwest': 'SW',
    'Coastal': 'CST',
    'East': 'E',
    'West': 'W',
  };

  return (
    <Box sx={{ height: 280, overflow: 'auto' }}>
      {/* Summary Header */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#06B6D4', 0.1), borderRadius: 1, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#06B6D4', fontWeight: 700, fontSize: '1rem' }}>
            {crossRegionFlows.length}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>Corridors</Typography>
        </Box>
        <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#22C55E', 0.1), borderRadius: 1, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#22C55E', fontWeight: 700, fontSize: '1rem' }}>
            {(totalCapacity / 1000).toFixed(1)}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>GW Total</Typography>
        </Box>
        <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#EF4444', 0.1), borderRadius: 1, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#EF4444', fontWeight: 700, fontSize: '1rem' }}>
            {criticalCount}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>Critical</Typography>
        </Box>
      </Stack>

      {/* Flow List - Compact */}
      <Stack spacing={0.75}>
        {crossRegionFlows.map((flow, idx) => {
          const widthPercent = (flow.flow_capacity_mw / maxCapacity) * 100;
          const vulnerabilityColor = flow.vulnerability_score > 0.6 ? '#EF4444' : 
                                    flow.vulnerability_score > 0.35 ? '#FBBF24' : '#22C55E';
          const isHovered = hoveredFlow === idx;
          
          return (
            <Tooltip
              key={idx}
              title={
                <Box sx={{ p: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                    {flow.source_region} → {flow.target_region}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {flow.flow_capacity_mw.toLocaleString()} MW • {flow.connection_count} lines
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: vulnerabilityColor }}>
                    Vulnerability: {(flow.vulnerability_score * 100).toFixed(0)}%
                  </Typography>
                </Box>
              }
              arrow
              placement="left"
            >
              <Box 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1,
                  p: 0.75,
                  bgcolor: isHovered ? alpha('#06B6D4', 0.1) : alpha('#0A1929', 0.5),
                  borderRadius: 1,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                }}
                onMouseEnter={() => setHoveredFlow(idx)}
                onMouseLeave={() => setHoveredFlow(null)}
              >
                {/* Source */}
                <Typography variant="caption" sx={{ 
                  width: 32, 
                  fontWeight: 600, 
                  color: '#06B6D4',
                  fontSize: '0.65rem'
                }}>
                  {regionShortNames[flow.source_region]}
                </Typography>
                
                {/* Flow Bar */}
                <Box sx={{ flex: 1, position: 'relative' }}>
                  <Box sx={{ 
                    height: 8, 
                    bgcolor: alpha('#fff', 0.1), 
                    borderRadius: 1, 
                    overflow: 'hidden' 
                  }}>
                    <Box sx={{ 
                      height: '100%',
                      width: `${widthPercent}%`,
                      background: `linear-gradient(90deg, ${alpha('#06B6D4', 0.6)}, ${alpha(vulnerabilityColor, 0.6)})`,
                      borderRadius: 1,
                    }} />
                  </Box>
                </Box>
                
                {/* Target */}
                <Typography variant="caption" sx={{ 
                  width: 32, 
                  fontWeight: 600, 
                  color: '#06B6D4',
                  fontSize: '0.65rem',
                  textAlign: 'right'
                }}>
                  {regionShortNames[flow.target_region]}
                </Typography>
                
                {/* Vulnerability Chip */}
                <Chip 
                  label={`${(flow.vulnerability_score * 100).toFixed(0)}%`}
                  size="small"
                  sx={{ 
                    height: 18,
                    minWidth: 38,
                    bgcolor: alpha(vulnerabilityColor, 0.2),
                    color: vulnerabilityColor,
                    fontWeight: 700,
                    fontSize: '0.6rem',
                    '& .MuiChip-label': { px: 0.5 }
                  }}
                />
              </Box>
            </Tooltip>
          );
        })}
      </Stack>

      {/* Critical Alert */}
      {criticalCount > 0 && (
        <Alert 
          severity="warning" 
          icon={<Warning sx={{ fontSize: 16 }} />}
          sx={{ 
            mt: 1.5, 
            py: 0.5,
            bgcolor: alpha('#FBBF24', 0.08),
            '& .MuiAlert-icon': { color: '#FBBF24' },
            '& .MuiAlert-message': { fontSize: '0.65rem' }
          }}
        >
          {criticalCount} critical corridor{criticalCount > 1 ? 's' : ''} could accelerate cascade spread
        </Alert>
      )}
    </Box>
  );
}

// Investment ROI data interface
interface RegionalInvestment {
  region: string;
  county: string;
  nodes_requiring_upgrade: number;
  estimated_investment_cost: number;
  avoided_damage_potential: number;
  roi_percent: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

// Engineering: Compact Investment ROI Panel for drawer integration
// Shows ROI calculations without requiring full-page context switch
function InvestmentROICompact({ 
  highRiskNodes, 
  cascadeResult,
  isSideBySide = false 
}: { 
  highRiskNodes: CascadeNode[]; 
  cascadeResult: CascadeResult | null;
  isSideBySide?: boolean;
}) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  // Calculate investment recommendations per region
  const investmentData = useMemo<RegionalInvestment[]>(() => {
    const UPGRADE_COST_SUBSTATION = 5000000;
    const UPGRADE_COST_TRANSFORMER = 500000;
    const DAMAGE_MULTIPLIER = 2.5;
    const CUSTOMER_DAMAGE_COST = 150;
    
    const regionMap = new Map<string, { 
      region: string; county: string; 
      substations: number; transformers: number;
      highRiskSubstations: number; highRiskTransformers: number;
      totalCustomersAtRisk: number; avgCriticality: number;
    }>();
    
    const getRegionData = (nodeId: string): { region: string; county: string } => {
      const id = nodeId.toUpperCase();
      if (id.includes('HOU')) return { region: 'Houston Metro', county: 'Harris' };
      if (id.includes('GAL')) return { region: 'Coastal', county: 'Galveston' };
      if (id.includes('BRA')) return { region: 'Coastal', county: 'Brazoria' };
      if (id.includes('MON')) return { region: 'North', county: 'Montgomery' };
      if (id.includes('FBN') || id.includes('FTB')) return { region: 'Southwest', county: 'Fort Bend' };
      if (id.includes('WAL')) return { region: 'West', county: 'Waller' };
      if (id.includes('LIB')) return { region: 'East', county: 'Liberty' };
      return { region: 'Houston Metro', county: 'Harris' };
    };
    
    highRiskNodes.forEach(node => {
      const { region, county } = getRegionData(node.node_id);
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

  if (investmentData.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <AttachMoney sx={{ fontSize: 32, color: alpha('#8B5CF6', 0.3), mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          Load high-risk nodes to see investment recommendations
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: 280, overflow: 'auto' }}>
      {/* Summary Header */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#3B82F6', 0.1), borderRadius: 1, textAlign: 'center' }}>
          <AttachMoney sx={{ color: '#3B82F6', fontSize: 16 }} />
          <Typography variant="h6" sx={{ color: '#3B82F6', fontWeight: 700, fontSize: '0.9rem' }}>
            ${(totalInvestment / 1000000).toFixed(1)}M
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.5rem' }}>Investment</Typography>
        </Box>
        <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#22C55E', 0.1), borderRadius: 1, textAlign: 'center' }}>
          <TrendingUp sx={{ color: '#22C55E', fontSize: 16 }} />
          <Typography variant="h6" sx={{ color: '#22C55E', fontWeight: 700, fontSize: '0.9rem' }}>
            ${(totalBenefit / 1000000).toFixed(1)}M
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.5rem' }}>Benefit</Typography>
        </Box>
        <Box sx={{ flex: 1, p: 1, bgcolor: alpha(overallROI > 100 ? '#22C55E' : '#FBBF24', 0.1), borderRadius: 1, textAlign: 'center' }}>
          <CheckCircle sx={{ color: overallROI > 100 ? '#22C55E' : '#FBBF24', fontSize: 16 }} />
          <Typography variant="h6" sx={{ color: overallROI > 100 ? '#22C55E' : '#FBBF24', fontWeight: 700, fontSize: '0.9rem' }}>
            {overallROI.toFixed(0)}%
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.5rem' }}>ROI</Typography>
        </Box>
      </Stack>

      {/* Investment Table - Responsive for side-by-side mode */}
      <TableContainer sx={{ bgcolor: alpha('#0A1929', 0.5), borderRadius: 1 }}>
        <Table size="small" sx={{ tableLayout: isSideBySide ? 'auto' : 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: isSideBySide ? '0.55rem' : '0.6rem', py: 0.5, color: 'text.secondary', fontWeight: 600, px: isSideBySide ? 0.5 : 1 }}>County</TableCell>
              <TableCell align="center" sx={{ fontSize: isSideBySide ? '0.55rem' : '0.6rem', py: 0.5, color: 'text.secondary', fontWeight: 600, px: isSideBySide ? 0.5 : 1 }}>Priority</TableCell>
              <TableCell align="right" sx={{ fontSize: isSideBySide ? '0.55rem' : '0.6rem', py: 0.5, color: 'text.secondary', fontWeight: 600, px: isSideBySide ? 0.5 : 1 }}>Cost</TableCell>
              <TableCell align="right" sx={{ fontSize: isSideBySide ? '0.55rem' : '0.6rem', py: 0.5, color: 'text.secondary', fontWeight: 600, px: isSideBySide ? 0.5 : 1, width: isSideBySide ? 'auto' : 80 }}>ROI</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {investmentData.slice(0, 5).map((inv, idx) => {
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
                    '&:last-child td': { borderBottom: 0 }
                  }}
                >
                  <TableCell sx={{ py: 0.5, fontSize: isSideBySide ? '0.6rem' : '0.7rem', px: isSideBySide ? 0.5 : 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {isTop && <Box sx={{ width: 2, height: 16, bgcolor: '#8B5CF6', borderRadius: 0.5 }} />}
                      <Box>
                        <Typography variant="caption" sx={{ fontWeight: isTop ? 700 : 500, fontSize: isSideBySide ? '0.6rem' : '0.7rem', display: 'block', whiteSpace: 'nowrap' }}>
                          {inv.county}
                        </Typography>
                        {!isSideBySide && (
                          <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.secondary' }}>
                            {inv.nodes_requiring_upgrade} upgrades
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="center" sx={{ py: 0.5, px: isSideBySide ? 0.5 : 1 }}>
                    <Chip 
                      label={isSideBySide ? inv.priority.slice(0, 3) : inv.priority.slice(0, 4)}
                      size="small"
                      sx={{ 
                        bgcolor: alpha(priorityColors[inv.priority], 0.15),
                        color: priorityColors[inv.priority],
                        fontWeight: 700,
                        fontSize: isSideBySide ? '0.5rem' : '0.55rem',
                        height: isSideBySide ? 16 : 18,
                        '& .MuiChip-label': { px: isSideBySide ? 0.25 : 0.5 }
                      }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ py: 0.5, px: isSideBySide ? 0.5 : 1 }}>
                    <Typography variant="caption" sx={{ color: '#3B82F6', fontWeight: 600, fontSize: isSideBySide ? '0.55rem' : '0.65rem', whiteSpace: 'nowrap' }}>
                      ${(inv.estimated_investment_cost / 1000000).toFixed(1)}M
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ py: 0.5, px: isSideBySide ? 0.5 : 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
                      {!isSideBySide && (
                        <Box sx={{ flex: 1, height: 4, bgcolor: alpha('#fff', 0.08), borderRadius: 0.5, maxWidth: 40 }}>
                          <Box sx={{ 
                            height: '100%',
                            width: `${roiBarWidth}%`,
                            bgcolor: inv.roi_percent > 100 ? '#22C55E' : '#FBBF24',
                            borderRadius: 0.5
                          }} />
                        </Box>
                      )}
                      <Typography variant="caption" sx={{ 
                        color: inv.roi_percent > 100 ? '#22C55E' : '#FBBF24', 
                        fontWeight: 700,
                        fontSize: isSideBySide ? '0.55rem' : '0.65rem',
                        minWidth: isSideBySide ? 24 : 32
                      }}>
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

      {/* Top Recommendation Callout */}
      {investmentData[0] && (
        <Box sx={{ 
          mt: 1.5, 
          p: 1, 
          bgcolor: alpha('#8B5CF6', 0.1), 
          borderRadius: 1,
          borderLeft: '3px solid #8B5CF6'
        }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#8B5CF6', fontSize: '0.65rem' }}>
            TOP RECOMMENDATION
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.6rem', mt: 0.25 }}>
            {investmentData[0].county} County: ${(investmentData[0].estimated_investment_cost / 1000000).toFixed(1)}M investment 
            yields {investmentData[0].roi_percent.toFixed(0)}% ROI
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// =====================================================
// ACTIONABLE CASCADE ANALYSIS COMPACT COMPONENTS
// =====================================================

/**
 * MitigationActionsCompact - Operator decision support for immediate response
 * Shows prioritized actions, crew dispatch, and containment probability
 * Updated to match actual backend API response structure
 */
function MitigationActionsCompact({ 
  playbookResponse, 
  economicResponse,
  loading 
}: { 
  playbookResponse: MitigationPlaybookResponse | null; 
  economicResponse: EconomicImpactResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} sx={{ color: '#F97316' }} />
      </Box>
    );
  }

  // Access nested playbook from response
  const playbook = playbookResponse?.playbook;
  
  if (!playbook) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Shield sx={{ fontSize: 32, color: alpha('#fff', 0.3), mb: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Run cascade simulation to see mitigation actions
        </Typography>
      </Box>
    );
  }

  const severityColors: Record<string, string> = {
    'EMERGENCY': '#EF4444',
    'CRITICAL': '#F97316',
    'HIGH': '#FBBF24',
    'MODERATE': '#22C55E'
  };

  // Access nested economic_impact from response
  const economicImpact = economicResponse?.economic_impact;
  const severity = economicResponse?.severity_assessment?.tier || 'MODERATE';
  const severityColor = severityColors[severity] || '#22C55E';

  return (
    <Box>
      {/* Economic Impact Summary */}
      {economicImpact && (
        <Box sx={{ 
          mb: 1.5, 
          p: 1.25, 
          bgcolor: alpha(severityColor, 0.1), 
          borderRadius: 1,
          border: '1px solid',
          borderColor: alpha(severityColor, 0.3)
        }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.75}>
            <Chip 
              label={severity}
              size="small"
              sx={{ 
                bgcolor: alpha(severityColor, 0.2),
                color: severityColor,
                fontWeight: 700,
                fontSize: '0.6rem',
                height: 20
              }}
            />
            <Typography variant="h6" sx={{ fontWeight: 700, color: severityColor }}>
              ${((economicImpact.total_estimated_cost || 0) / 1000000).toFixed(1)}M
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block' }}>
            {economicResponse?.executive_summary?.substring(0, 100)}...
          </Typography>
          <Stack direction="row" spacing={1} mt={1}>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#EF4444', fontSize: '0.55rem' }}>
                ${((economicImpact.breakdown?.regulatory_penalties?.subtotal || 0) / 1000).toFixed(0)}K
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.5rem' }}>
                Penalties
              </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#FBBF24', fontSize: '0.55rem' }}>
                ${((economicImpact.breakdown?.lost_revenue?.subtotal || 0) / 1000).toFixed(0)}K
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.5rem' }}>
                Lost Rev
              </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#3B82F6', fontSize: '0.55rem' }}>
                ${((economicImpact.breakdown?.restoration_costs?.subtotal || 0) / 1000).toFixed(0)}K
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.5rem' }}>
                Restore
              </Typography>
            </Box>
          </Stack>
        </Box>
      )}

      {/* Containment Probability Gauge - using correct field names from backend */}
      {playbook.containment_probability && (
        <Box sx={{ mb: 1.5, p: 1, bgcolor: alpha('#0A1929', 0.5), borderRadius: 1 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.5}>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem' }}>
              Containment Probability
            </Typography>
            <Typography 
              variant="caption" 
              sx={{ 
                fontWeight: 700, 
                color: (playbook.containment_probability.with_immediate_action * 100) > 70 ? '#22C55E' : '#FBBF24',
                fontSize: '0.7rem'
              }}
            >
              {Math.round(playbook.containment_probability.with_immediate_action * 100)}%
            </Typography>
          </Stack>
          <LinearProgress 
            variant="determinate" 
            value={playbook.containment_probability.with_immediate_action * 100}
            sx={{ 
              height: 6, 
              borderRadius: 1,
              bgcolor: alpha('#fff', 0.1),
              '& .MuiLinearProgress-bar': {
                bgcolor: (playbook.containment_probability.with_immediate_action * 100) > 70 ? '#22C55E' : '#FBBF24'
              }
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.5rem', mt: 0.5, display: 'block' }}>
            Drops to {Math.round(playbook.containment_probability.with_30min_delay * 100)}% in 30 min
          </Typography>
        </Box>
      )}

      {/* Immediate Actions */}
      <Typography variant="caption" sx={{ fontWeight: 700, color: '#F97316', mb: 0.75, display: 'block', fontSize: '0.65rem' }}>
        IMMEDIATE ACTIONS
      </Typography>
      <Stack spacing={0.75}>
        {playbook.immediate_actions?.slice(0, 4).map((action, idx) => (
          <Box 
            key={idx}
            sx={{ 
              p: 0.75, 
              bgcolor: alpha('#F97316', idx === 0 ? 0.15 : 0.05), 
              borderRadius: 1,
              borderLeft: '3px solid',
              borderColor: idx === 0 ? '#F97316' : alpha('#F97316', 0.3)
            }}
          >
            <Stack direction="row" alignItems="flex-start" spacing={0.75}>
              <Chip 
                label={`P${action.priority}`}
                size="small"
                sx={{ 
                  height: 16,
                  minWidth: 24,
                  bgcolor: idx === 0 ? '#F97316' : alpha('#F97316', 0.3),
                  color: idx === 0 ? '#fff' : '#F97316',
                  fontWeight: 700,
                  fontSize: '0.5rem',
                  '& .MuiChip-label': { px: 0.5 }
                }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.6rem', display: 'block' }}>
                  {action.action}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.5rem' }}>
                  {action.time_target} • {action.prevents}
                </Typography>
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>

      {/* Crew Dispatch Summary - using correct field names from backend */}
      {playbook.crew_dispatch && (
        <Box sx={{ mt: 1.5, p: 1, bgcolor: alpha('#3B82F6', 0.1), borderRadius: 1 }}>
          <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
            <Engineering sx={{ fontSize: 14, color: '#3B82F6' }} />
            <Typography variant="caption" sx={{ fontWeight: 600, color: '#3B82F6', fontSize: '0.6rem' }}>
              CREW DISPATCH
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#3B82F6' }}>
                {playbook.crew_dispatch.estimated_crews_needed}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: '0.5rem', color: 'text.secondary' }}>
                Crews
              </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#22C55E', fontSize: '0.6rem' }}>
                {playbook.crew_dispatch.primary_location?.node_name || 'TBD'}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.5rem', color: 'text.secondary' }}>
                Primary
              </Typography>
            </Box>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

/**
 * RestorationSequenceCompact - Optimal restoration order with dependency awareness
 * Shows milestones and progress tracking for recovery
 * Updated to match actual backend API response structure
 */
function RestorationSequenceCompact({ 
  sequenceResponse, 
  loading 
}: { 
  sequenceResponse: RestorationSequenceResponse | null; 
  loading: boolean;
}) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} sx={{ color: '#22C55E' }} />
      </Box>
    );
  }

  if (!sequenceResponse) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <RestartAlt sx={{ fontSize: 32, color: alpha('#fff', 0.3), mb: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Run cascade simulation to see restoration plan
        </Typography>
      </Box>
    );
  }

  const restorationSteps = sequenceResponse.restoration_sequence || [];
  const totalSteps = restorationSteps.length;
  const summary = sequenceResponse.summary;
  const milestones = sequenceResponse.milestones || [];

  return (
    <Box>
      {/* Summary Header */}
      <Box sx={{ 
        mb: 1.5, 
        p: 1.25, 
        bgcolor: alpha('#22C55E', 0.1), 
        borderRadius: 1,
        border: '1px solid',
        borderColor: alpha('#22C55E', 0.3)
      }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.6rem', color: 'text.secondary' }}>
              ESTIMATED FULL RESTORATION
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#22C55E' }}>
              {summary?.estimated_total_hours ? `${summary.estimated_total_hours} hrs` : 'N/A'}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.55rem', color: 'text.secondary' }}>
              STEPS
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#fff' }}>
              {totalSteps}
            </Typography>
          </Box>
        </Stack>
      </Box>

      {/* Milestones */}
      {milestones.length > 0 && (
        <>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#06B6D4', mb: 0.75, display: 'block', fontSize: '0.65rem' }}>
            KEY MILESTONES
          </Typography>
          <Stack spacing={0.75} sx={{ mb: 1.5 }}>
            {milestones.slice(0, 3).map((milestone, idx) => (
              <Box 
                key={idx}
                sx={{ 
                  p: 0.75, 
                  bgcolor: alpha('#06B6D4', 0.1), 
                  borderRadius: 1,
                  borderLeft: '3px solid #06B6D4'
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.6rem' }}>
                      {milestone.milestone}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.5rem' }}>
                      After step {milestone.after_step}: {milestone.node}
                    </Typography>
                  </Box>
                  <Chip 
                    label={`${milestone.hours}h`}
                    size="small"
                    sx={{ 
                      bgcolor: alpha('#06B6D4', 0.2),
                      color: '#06B6D4',
                      fontWeight: 600,
                      fontSize: '0.55rem',
                      height: 18
                    }}
                  />
                </Stack>
              </Box>
            ))}
          </Stack>
        </>
      )}

      {/* Restoration Steps */}
      <Typography variant="caption" sx={{ fontWeight: 700, color: '#FBBF24', mb: 0.75, display: 'block', fontSize: '0.65rem' }}>
        RESTORATION SEQUENCE ({totalSteps} steps)
      </Typography>
      <Box sx={{ position: 'relative' }}>
        {/* Timeline line */}
        <Box sx={{ 
          position: 'absolute', 
          left: 8, 
          top: 12, 
          bottom: 12, 
          width: 2, 
          bgcolor: alpha('#FBBF24', 0.3),
          borderRadius: 1
        }} />
        
        <Stack spacing={0.5}>
          {restorationSteps.slice(0, 5).map((step, idx) => {
            const isHighPriority = (step.priority_score || 0) > 1000;
            return (
              <Box 
                key={idx}
                sx={{ 
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1,
                  pl: 2.5,
                  position: 'relative'
                }}
              >
                {/* Timeline dot */}
                <Box sx={{ 
                  position: 'absolute',
                  left: 4,
                  top: 6,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: isHighPriority ? '#FBBF24' : alpha('#fff', 0.3),
                  border: '2px solid',
                  borderColor: isHighPriority ? '#FBBF24' : alpha('#fff', 0.2)
                }} />
                
                <Box sx={{ 
                  flex: 1, 
                  p: 0.75, 
                  bgcolor: alpha(isHighPriority ? '#FBBF24' : '#fff', 0.05), 
                  borderRadius: 1 
                }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" sx={{ 
                        fontWeight: 600, 
                        fontSize: '0.6rem',
                        color: isHighPriority ? '#FBBF24' : 'text.primary'
                      }}>
                        {step.sequence}. {step.node_name || step.node_id}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.5rem' }}>
                        {step.rationale?.substring(0, 50) || step.node_type} • {step.estimated_hours || '?'}h
                      </Typography>
                      {step.depends_on && (
                        <Typography variant="caption" sx={{ 
                          fontSize: '0.45rem', 
                          color: alpha('#fff', 0.4),
                          display: 'block'
                        }}>
                          Requires: {step.depends_on}
                        </Typography>
                      )}
                    </Box>
                    <Chip 
                      label={`${step.customers_restored?.toLocaleString() || '?'}`}
                      size="small"
                      sx={{ 
                        height: 14,
                        bgcolor: alpha('#22C55E', 0.2),
                        color: '#22C55E',
                        fontWeight: 600,
                        fontSize: '0.45rem',
                        '& .MuiChip-label': { px: 0.5 }
                      }}
                    />
                  </Stack>
                </Box>
              </Box>
            );
          })}
        </Stack>
      </Box>

      {/* Summary stats */}
      {summary && (
        <Box sx={{ mt: 1.5, p: 1, bgcolor: alpha('#22C55E', 0.05), borderRadius: 1 }}>
          <Stack direction="row" spacing={2} justifyContent="center">
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#22C55E' }}>
                {summary.total_customers?.toLocaleString() || '?'}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.5rem', color: 'text.secondary' }}>
                Customers
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#3B82F6' }}>
                {summary.parallel_crews_recommended || '?'}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.5rem', color: 'text.secondary' }}>
                Crews
              </Typography>
            </Box>
          </Stack>
        </Box>
      )}

      {/* Note about dependency ordering */}
      <Alert 
        severity="info" 
        icon={<Info sx={{ fontSize: 14 }} />}
        sx={{ 
          mt: 1.5, 
          py: 0.5,
          '& .MuiAlert-message': { fontSize: '0.55rem' }
        }}
      >
        {sequenceResponse.optimization_note || 'Sequence optimized for customer-hours'}
      </Alert>
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
  isDocked = false,
  dockedSize = 'compact',
  onDockedSizeChange,
  onDockChange,
  otherPanelDocked = false,
  otherPanelSize = 'minimized',
}: CascadeControlPanelProps) {
  // visible prop now controls expanded state - toggle is in LAYERS panel
  const expanded = visible;
  const [selectedScenario, setSelectedScenario] = useState<string>(scenarios[0]?.name || '');
  const [selectedPatientZero, setSelectedPatientZero] = useState<string>('');
  const [activeTab, setActiveTab] = useState(0);
  const waveBreakdown = useWaveBreakdown(cascadeResult);
  
  // Helper functions for dock size management
  const setDockSize = (size: DockedPanelSize) => {
    onDockedSizeChange?.(size);
  };
  
  const toggleDock = () => {
    onDockChange?.(!isDocked);
    if (!isDocked) {
      // When docking, start at compact size
      setDockSize('compact');
    }
  };
  
  // Derived state for fullscreen handling
  const isFullscreen = isDocked && dockedSize === 'fullscreen';
  const isMinimized = isDocked && dockedSize === 'minimized';
  
  // Dock menu state
  const [dockMenuAnchor, setDockMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Explanation section state (for expanded view)
  const [showExplanation, setShowExplanation] = useState(true);
  
  // === ACTIONABLE CASCADE ANALYSIS STATE ===
  const [economicImpact, setEconomicImpact] = useState<EconomicImpactResponse | null>(null);
  const [mitigationPlaybook, setMitigationPlaybook] = useState<MitigationPlaybookResponse | null>(null);
  const [restorationSequence, setRestorationSequence] = useState<RestorationSequenceResponse | null>(null);
  const [realtimeRisk, setRealtimeRisk] = useState<RealtimeRiskResponse | null>(null);
  const [actionableError, setActionableError] = useState<string | null>(null);
  const [actionableLoading, setActionableLoading] = useState({
    economic: false,
    mitigation: false,
    restoration: false,
    risk: false
  });
  
  // Dragging refs and state (for undocked mode)
  const paperRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const originPosition = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const currentPosition = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const velocityHistory = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const momentumAnimationRef = useRef<number | null>(null);
  
  // Load high-risk nodes when panel expands
  useEffect(() => {
    if (visible && highRiskNodes.length === 0) {
      onLoadHighRisk();
    }
  }, [visible, highRiskNodes.length, onLoadHighRisk]);

  // === ACTIONABLE CASCADE ANALYSIS FETCH FUNCTIONS ===
  
  // Fetch economic impact when cascade result changes
  const fetchEconomicImpact = async () => {
    if (!cascadeResult) return;
    setActionableLoading(prev => ({ ...prev, economic: true }));
    try {
      const response = await fetch('/api/cascade/economic-impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cascadeResult)
      });
      if (response.ok) {
        const data = await response.json();
        setEconomicImpact(data);
      }
    } catch (error) {
      console.error('Failed to fetch economic impact:', error);
    } finally {
      setActionableLoading(prev => ({ ...prev, economic: false }));
    }
  };

  // Fetch mitigation playbook
  const fetchMitigationPlaybook = async () => {
    if (!cascadeResult) return;
    setActionableLoading(prev => ({ ...prev, mitigation: true }));
    try {
      const response = await fetch('/api/cascade/mitigation-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cascadeResult)
      });
      if (response.ok) {
        const data = await response.json();
        setMitigationPlaybook(data);
      }
    } catch (error) {
      console.error('Failed to fetch mitigation playbook:', error);
    } finally {
      setActionableLoading(prev => ({ ...prev, mitigation: false }));
    }
  };

  // Fetch restoration sequence
  const fetchRestorationSequence = async () => {
    if (!cascadeResult) return;
    setActionableLoading(prev => ({ ...prev, restoration: true }));
    try {
      const response = await fetch('/api/cascade/restoration-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cascadeResult)
      });
      if (response.ok) {
        const data = await response.json();
        setRestorationSequence(data);
      }
    } catch (error) {
      console.error('Failed to fetch restoration sequence:', error);
    } finally {
      setActionableLoading(prev => ({ ...prev, restoration: false }));
    }
  };

  // Fetch real-time risk score
  const fetchRealtimeRisk = async () => {
    setActionableLoading(prev => ({ ...prev, risk: true }));
    try {
      const response = await fetch('/api/cascade/realtime-risk');
      if (response.ok) {
        const data = await response.json();
        setRealtimeRisk(data);
      }
    } catch (error) {
      console.error('Failed to fetch realtime risk:', error);
    } finally {
      setActionableLoading(prev => ({ ...prev, risk: false }));
    }
  };

  // Auto-fetch actionable data when cascade result changes
  useEffect(() => {
    if (cascadeResult && visible) {
      fetchEconomicImpact();
      fetchMitigationPlaybook();
      fetchRestorationSequence();
    }
  }, [cascadeResult, visible]);

  // Fetch real-time risk periodically when panel is visible
  useEffect(() => {
    if (visible) {
      fetchRealtimeRisk();
      const interval = setInterval(fetchRealtimeRisk, 30000); // Every 30 seconds
      return () => clearInterval(interval);
    }
  }, [visible]);

  // Panel dimensions for dragging constraints (undocked mode)
  const panelWidth = 420;
  const panelHeight = 500;
  const constrainedRight = 24;
  const constrainedBottom = 24;

  // Helper to calculate drag position
  const calculatePosition = () => {
    const deltaX = currentPosition.current.x - startPosition.current.x;
    const deltaY = currentPosition.current.y - startPosition.current.y;
    return {
      x: originPosition.current.x + deltaX,
      y: originPosition.current.y + deltaY
    };
  };

  // Request animation frame update for smooth dragging
  const requestUpdate = () => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      if (paperRef.current) {
        const pos = calculatePosition();
        paperRef.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      }
    });
  };

  // Dragging functionality for undocked mode
  useEffect(() => {
    if (isDocked) return; // Only enable dragging when undocked
    
    const header = headerRef.current;
    if (!header || !visible) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || isDraggingRef.current) return;
      
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('[role="button"]')) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
        momentumAnimationRef.current = null;
      }
      
      isDraggingRef.current = true;
      velocityHistory.current = [];
      
      if (paperRef.current) {
        paperRef.current.style.willChange = 'transform';
        paperRef.current.style.backdropFilter = 'none';
        paperRef.current.style.webkitBackdropFilter = 'none';
      }
      
      startPosition.current = { x: e.clientX, y: e.clientY };
      currentPosition.current = { x: e.clientX, y: e.clientY };
      
      header.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', handlePointerMove, { passive: true });
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary || !isDraggingRef.current) return;
      
      currentPosition.current = { x: e.clientX, y: e.clientY };
      
      const pos = calculatePosition();
      
      const minX = -(window.innerWidth - panelWidth - constrainedRight);
      const maxX = constrainedRight;
      const minY = -(window.innerHeight - panelHeight - constrainedBottom);
      const maxY = constrainedBottom;
      
      const clampedX = Math.max(minX, Math.min(maxX, pos.x));
      const clampedY = Math.max(minY, Math.min(maxY, pos.y));
      
      originPosition.current = { x: clampedX, y: clampedY };
      startPosition.current = currentPosition.current;
      
      velocityHistory.current.push({
        x: clampedX,
        y: clampedY,
        time: Date.now()
      });
      
      if (velocityHistory.current.length > 5) {
        velocityHistory.current.shift();
      }
      
      requestUpdate();
    };

    const cleanup = (e: PointerEvent) => {
      if (!e.isPrimary || !isDraggingRef.current) return;
      
      isDraggingRef.current = false;
      
      if (paperRef.current) {
        paperRef.current.style.willChange = 'auto';
        paperRef.current.style.backdropFilter = 'blur(20px) saturate(180%)';
        paperRef.current.style.webkitBackdropFilter = 'blur(20px) saturate(180%)';
      }
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      
      const finalPos = calculatePosition();
      originPosition.current = finalPos;
      
      let velocityX = 0;
      let velocityY = 0;
      
      if (velocityHistory.current.length >= 2) {
        const recent = velocityHistory.current[velocityHistory.current.length - 1];
        const previous = velocityHistory.current[0];
        const timeDelta = recent.time - previous.time;
        
        if (timeDelta > 0) {
          velocityX = (recent.x - previous.x) / timeDelta * 16;
          velocityY = (recent.y - previous.y) / timeDelta * 16;
        }
      }
      
      const friction = 0.94;
      const minVelocity = 0.3;
      let lastTimestamp = performance.now();
      
      const applyMomentum = (timestamp: number) => {
        const deltaTime = Math.min((timestamp - lastTimestamp) / 16.667, 2);
        lastTimestamp = timestamp;
        
        const frictionFactor = Math.pow(friction, deltaTime);
        velocityX *= frictionFactor;
        velocityY *= frictionFactor;
        
        if (Math.abs(velocityX) < minVelocity && Math.abs(velocityY) < minVelocity) {
          momentumAnimationRef.current = null;
          return;
        }
        
        const deltaX = (velocityX / 60) * deltaTime;
        const deltaY = (velocityY / 60) * deltaTime;
        
        let newX = originPosition.current.x + deltaX;
        let newY = originPosition.current.y + deltaY;
        
        const minX = -(window.innerWidth - panelWidth - constrainedRight);
        const maxX = constrainedRight;
        const minY = -(window.innerHeight - panelHeight - constrainedBottom);
        const maxY = constrainedBottom;
        
        if (newX < minX || newX > maxX) {
          newX = Math.max(minX, Math.min(maxX, newX));
          velocityX = 0;
        }
        
        if (newY < minY || newY > maxY) {
          newY = Math.max(minY, Math.min(maxY, newY));
          velocityY = 0;
        }
        
        originPosition.current = { x: newX, y: newY };
        
        if (paperRef.current) {
          paperRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
        
        if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
          momentumAnimationRef.current = requestAnimationFrame(applyMomentum);
        } else {
          momentumAnimationRef.current = null;
        }
      };
      
      if (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5) {
        momentumAnimationRef.current = requestAnimationFrame(applyMomentum);
      }
      
      document.removeEventListener('pointermove', handlePointerMove);
    };

    const releasePointer = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      header.releasePointerCapture(e.pointerId);
    };

    header.addEventListener('pointerdown', handlePointerDown);
    header.addEventListener('pointerup', releasePointer);
    header.addEventListener('pointercancel', releasePointer);
    header.addEventListener('lostpointercapture', cleanup);

    return () => {
      header.removeEventListener('pointerdown', handlePointerDown);
      header.removeEventListener('pointerup', releasePointer);
      header.removeEventListener('pointercancel', releasePointer);
      header.removeEventListener('lostpointercapture', cleanup);
      document.removeEventListener('pointermove', handlePointerMove);
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
      }
    };
  }, [isDocked, visible]);

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

  // Tab positioning constants - must match ChatDrawer's tab width
  const CHAT_TAB_WIDTH = 180; // Width of Grid Intelligence tab
  const CASCADE_TAB_WIDTH = 180; // Width of Cascade Analysis tab (same as Chat tab for consistency)
  const TAB_GAP = 8; // Gap between tabs
  const TAB_MARGIN = 16; // Right margin from edge

  // Constants for Gmail-style dock layout (same as ChatDrawer for consistency)
  const DOCK = {
    gap: 16,
    margin: 16,
    compact: { width: 380, height: 350 }, // Small panel with content visible
    // Dynamic expanded width - calculated based on other panel state
    expanded: { height: 'calc(40vh)' }, // Height stays the same
    fullscreen: { width: '50vw' as const, height: '100vh' as const },
  };

  // Calculate dynamic expanded width based on other panel state
  // IMPORTANT: Must account for minimized tabs to avoid overlap
  const getExpandedWidth = (): string => {
    if (otherPanelDocked && otherPanelSize !== 'minimized') {
      if (otherPanelSize === 'expanded') {
        // Both expanded: split 50/50
        return 'calc(50vw - 24px)';
      } else {
        // Other is compact (380px): take remaining space
        // Full width - compact panel width - margins - gap
        return `calc(100vw - ${DOCK.compact.width}px - ${DOCK.margin * 2}px - ${DOCK.gap}px)`;
      }
    }
    // Other panel is minimized: leave room for its tab
    // Tab is at right: 16, width: 180, so leave 16 + 180 + 8 = 204 pixels on right
    const tabReservedSpace = TAB_MARGIN + CHAT_TAB_WIDTH + TAB_GAP;
    return `calc(100vw - ${DOCK.margin}px - ${tabReservedSpace}px)`;
  };

  // Layout dimensions based on dock state
  // Gmail-style side-by-side positioning with ChatDrawer
  const getLayoutStyles = (): React.CSSProperties => {
    // Fullscreen mode - special handling
    if (isFullscreen) {
      const otherIsFullscreen = otherPanelDocked && otherPanelSize === 'fullscreen';
      
      if (otherIsFullscreen) {
        // Split-pane mode: CascadePanel takes left half
        return {
          position: 'fixed',
          top: 0,
          left: 0,
          right: '50%',
          bottom: 0,
          width: '50vw',
          height: '100vh',
          borderRadius: 0,
          maxHeight: 'none',
          borderRight: '1px solid rgba(51, 65, 85, 0.8)',
        };
      } else {
        // Solo fullscreen: take entire viewport
        return {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 'auto',
          height: 'auto',
          borderRadius: 0,
          maxHeight: 'none',
        };
      }
    }
    
    // Docked modes (compact, expanded, minimized)
    if (isDocked) {
      // For minimized, we hide the panel but keep it in DOM
      if (dockedSize === 'minimized') {
        return {
          position: 'fixed',
          right: 0,
          bottom: -500, // Off-screen
          width: 360,
          height: 350,
          borderRadius: '12px 12px 0 0',
          maxHeight: 'none',
          transition: 'all 0.3s ease',
        };
      }
      
      // Calculate dimensions based on size - now with dynamic expanded width
      const isExpanded = dockedSize === 'expanded';
      const width = isExpanded ? getExpandedWidth() : DOCK.compact.width;
      const height = isExpanded ? DOCK.expanded.height : DOCK.compact.height;
      
      // Cascade panel is always positioned from the LEFT when expanded, from RIGHT when compact
      if (isExpanded) {
        // Expanded mode: position from left for cleaner layout
        return {
          position: 'fixed',
          left: DOCK.margin,
          bottom: 0,
          width: width,
          height: height,
          borderRadius: '12px 12px 0 0',
          borderTop: '1px solid rgba(51, 65, 85, 0.8)',
          borderLeft: '1px solid rgba(51, 65, 85, 0.8)',
          borderRight: '1px solid rgba(51, 65, 85, 0.8)',
          maxHeight: 'none',
          transition: 'all 0.3s ease',
        };
      }
      
      // Compact mode: position relative to ChatDrawer
      // IMPORTANT: Must leave room for minimized tabs
      let rightPosition: number | string = DOCK.margin;
      
      if (otherPanelDocked && otherPanelSize !== 'minimized') {
        if (otherPanelSize === 'expanded') {
          // Other panel expanded - this compact panel sits at its left edge
          // Other panel takes calc(100vw - 380px - 48px), so position this at that width + gap from right
          rightPosition = `calc(100vw - ${DOCK.compact.width}px - ${DOCK.margin}px)`;
        } else {
          // Both compact - position to left of ChatDrawer
          rightPosition = DOCK.margin + DOCK.compact.width + DOCK.gap;
        }
      } else if (!otherPanelDocked || otherPanelSize === 'minimized') {
        // Other panel not docked OR minimized: leave room for the minimized tab on the right
        // Grid Intelligence tab: right: 16, width: 180 → need to start at 16 + 180 + 8 = 204
        rightPosition = TAB_MARGIN + CHAT_TAB_WIDTH + TAB_GAP;
      }
      
      return {
        position: 'fixed',
        right: rightPosition,
        bottom: 0,
        width: width,
        height: height,
        borderRadius: '12px 12px 0 0',
        borderTop: '1px solid rgba(51, 65, 85, 0.8)',
        borderLeft: '1px solid rgba(51, 65, 85, 0.8)',
        borderRight: '1px solid rgba(51, 65, 85, 0.8)',
        maxHeight: 'none',
        transition: 'all 0.3s ease',
      };
    }
    
    // Floating mode (default) - centered floating window like Grid Intelligence
    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-70%, -50%)', // Offset left to avoid center of screen
      width: 420,
      height: 500,
      borderRadius: '16px',
      maxHeight: 'calc(100vh - 100px)',
    };
  };

  // Dock toggle button for minimized state (Gmail-style tab at bottom)
  // Uses tab positioning constants defined above for coordination
  const renderDockToggle = () => {
    if (isDocked && dockedSize === 'minimized') {
      // If Grid Intelligence is fullscreen OR expanded, hide this tab
      // (When expanded, Grid Intelligence takes most of the viewport, leaving no room for tab on RIGHT)
      if (otherPanelDocked && (otherPanelSize === 'fullscreen' || otherPanelSize === 'expanded')) {
        return null;
      }
      
      // Calculate position based on Grid Intelligence state
      // Cascade tab is ALWAYS on the RIGHT side, positioned to avoid overlapping
      // with Grid Intelligence panel or tab
      let rightPosition: number;
      
      if (!otherPanelDocked) {
        // Grid Intelligence not docked - Cascade tab at right edge
        rightPosition = TAB_MARGIN;
      } else if (otherPanelSize === 'minimized') {
        // Both minimized: Cascade tab to the LEFT of Grid Intelligence tab
        // Grid Intelligence tab: right: 16, width: 180 → occupies 16-196 from right
        // Cascade tab should start at: 16 + 180 + 8 = 204 from right
        rightPosition = TAB_MARGIN + CHAT_TAB_WIDTH + TAB_GAP;
      } else {
        // Grid Intelligence compact (380px panel from right)
        // Position Cascade tab to the left of the compact panel
        rightPosition = TAB_MARGIN + DOCK.compact.width + TAB_GAP;
      }
      
      return createPortal(
        <Box
          onClick={() => setDockSize('compact')}
          sx={{
            position: 'fixed',
            bottom: 0,
            right: rightPosition,
            width: CASCADE_TAB_WIDTH,
            bgcolor: 'rgba(15, 23, 42, 0.95)', // Dark background - distinct from Grid Intelligence's blue
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            px: 2,
            py: 0.75,
            cursor: 'pointer',
            zIndex: 1300,
            border: '1px solid',
            borderColor: '#F59E0B', // Amber accent border
            borderBottom: 'none',
            '&:hover': { bgcolor: 'rgba(30, 41, 59, 1)' },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            boxShadow: '0 -4px 12px rgba(245, 158, 11, 0.2)', // Amber glow
            transition: 'all 0.2s ease',
          }}
        >
          <Warning sx={{ color: '#F59E0B', fontSize: 16 }} />
          <Typography variant="caption" sx={{ color: '#F59E0B', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Cascade Analysis
          </Typography>
          <KeyboardArrowUp sx={{ color: '#F59E0B', fontSize: 16 }} />
        </Box>,
        document.body
      );
    }
    return null;
  };

  // Panel is always docked - when minimized, just show the tab
  // When not minimized, show the full panel
  if (isDocked && dockedSize === 'minimized') {
    return renderDockToggle();
  }

  const layoutStyles = getLayoutStyles();

  // Determine if we're in a docked mode
  const isDockedMode = isDocked;
  const isFullWidth = isDocked && (dockedSize === 'fullscreen' || dockedSize === 'expanded');

  // Accent color for Cascade panel - amber/orange for warning theme but in matching design language
  const accentColor = '#F59E0B'; // Amber - warning but not aggressive

  // Wrap in portal for docked modes (to escape parent positioning context)
  const panelContent = (
    <>
      {renderDockToggle()}
      {/* Main Panel */}
      <Paper
        ref={paperRef}
        sx={{
          ...layoutStyles,
          bgcolor: 'rgba(15, 23, 42, 0.95)', // Match Grid Intelligence
          backdropFilter: 'blur(20px) saturate(180%)', // Match Grid Intelligence
          WebkitBackdropFilter: 'blur(20px) saturate(180%)', // Safari support
          overflow: 'hidden',
          zIndex: isFullscreen ? 1400 : (isDocked ? 1299 : 1300),
          display: 'flex',
          flexDirection: 'column',
          boxShadow: !isDocked 
            ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(245, 158, 11, 0.2), 0 0 40px rgba(245, 158, 11, 0.1)'
            : '0 0 20px rgba(0, 0, 0, 0.5)', // Match Grid Intelligence docked shadow
          border: !isDocked ? '1px solid rgba(51, 65, 85, 0.5)' : 'none', // Match Grid Intelligence
          cursor: 'default',
        }}
      >
        {/* Header with dock controls - matching ChatDrawer style */}
        <Box 
          ref={headerRef}
          sx={{ 
            p: isDocked ? 1.5 : 2, 
            borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
            bgcolor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            cursor: !isDocked ? 'grab' : 'default',
            '&:active': !isDocked ? { cursor: 'grabbing' } : {},
            touchAction: 'none',
          }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Warning sx={{ color: accentColor, fontSize: isFullscreen ? 24 : (isDocked && dockedSize === 'compact' ? 18 : 20) }} />
            <Typography 
              variant="h6" 
              sx={{ 
                color: accentColor, 
                fontWeight: 600,
                fontSize: isDocked && dockedSize === 'compact' ? '15px' : '18px',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Cascade{isDocked && dockedSize !== 'compact' ? ' Failure' : ''} Analysis
            </Typography>
            {/* Current Risk Badge - using correct nested paths from RealtimeRiskResponse */}
            {realtimeRisk?.realtime_risk && (
              <Tooltip 
                title={
                  <Box sx={{ p: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                      Real-time Grid Risk
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.65rem' }}>
                      Score: {realtimeRisk.realtime_risk.score}/100
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.6rem', color: 'text.secondary' }}>
                      {realtimeRisk.realtime_risk.recommended_action}
                    </Typography>
                  </Box>
                }
                arrow
              >
                <Chip
                  size="small"
                  icon={realtimeRisk.realtime_risk.level === 'CRITICAL' || realtimeRisk.realtime_risk.level === 'HIGH' 
                    ? <LocalFireDepartment sx={{ fontSize: 12 }} /> 
                    : <Speed sx={{ fontSize: 12 }} />}
                  label={realtimeRisk.realtime_risk.level}
                  sx={{
                    height: 20,
                    ml: 0.5,
                    bgcolor: alpha(
                      realtimeRisk.realtime_risk.level === 'CRITICAL' ? '#EF4444' :
                      realtimeRisk.realtime_risk.level === 'HIGH' ? '#F97316' :
                      realtimeRisk.realtime_risk.level === 'ELEVATED' ? '#FBBF24' : '#22C55E',
                      0.2
                    ),
                    color: realtimeRisk.realtime_risk.level === 'CRITICAL' ? '#EF4444' :
                           realtimeRisk.realtime_risk.level === 'HIGH' ? '#F97316' :
                           realtimeRisk.realtime_risk.level === 'ELEVATED' ? '#FBBF24' : '#22C55E',
                    fontWeight: 700,
                    fontSize: '0.55rem',
                    animation: (realtimeRisk.realtime_risk.level === 'CRITICAL' || realtimeRisk.realtime_risk.level === 'HIGH') 
                      ? 'pulse 2s infinite' : 'none',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.6 }
                    },
                    '& .MuiChip-icon': { 
                      color: 'inherit',
                      ml: 0.5
                    },
                    '& .MuiChip-label': { px: 0.75 }
                  }}
                />
              </Tooltip>
            )}
          </Box>
          
          {/* Header controls: Size controls + Dock + Close */}
          <Box sx={{ 
            display: 'flex', 
            gap: 0.5, 
            flexDirection: 'row',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            {/* Service badges - always visible except compact mode, icon-only when floating */}
            {(!isDocked || dockedSize !== 'compact') && (
              <>
                <SnowflakeMLBadge 
                  feature="snowpark" 
                  tooltip="Graph analysis via Snowpark Python UDFs"
                  compact={!isDocked}  // Icon-only when floating
                />
                <SnowflakeMLBadge 
                  feature="cortex-complete" 
                  tooltip="AI explanations via Cortex Complete"
                  compact={!isDocked}  // Icon-only when floating
                />
                <Box sx={{ width: '1px', height: 16, bgcolor: 'rgba(51, 65, 85, 0.5)', mx: 0.5 }} />
              </>
            )}
            
            {/* Size controls for docked mode */}
            {isDocked && (
              <>
                {/* Compact/Expanded toggle */}
                <Tooltip title={dockedSize === 'expanded' ? 'Compact view' : 'Expand panel'}>
                  <IconButton
                    size="small"
                    onClick={() => setDockSize(dockedSize === 'expanded' ? 'compact' : 'expanded')}
                    sx={{ 
                      color: dockedSize === 'expanded' ? accentColor : '#64748b',
                      '&:hover': { color: accentColor }
                    }}
                  >
                    {dockedSize === 'expanded' ? <KeyboardArrowDown sx={{ fontSize: 18 }} /> : <KeyboardArrowUp sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
                
                {/* Fullscreen toggle */}
                <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  <IconButton
                    size="small"
                    onClick={() => setDockSize(isFullscreen ? 'expanded' : 'fullscreen')}
                    sx={{ 
                      color: isFullscreen ? accentColor : '#64748b',
                      '&:hover': { color: accentColor }
                    }}
                  >
                    {isFullscreen ? <CloseFullscreen sx={{ fontSize: 18 }} /> : <OpenInFull sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
              </>
            )}
            
            {/* Fullscreen button for overlay mode */}
            {!isDocked && (
              <Tooltip title="Fullscreen">
                <IconButton
                  size="small"
                  onClick={() => {
                    toggleDock();
                    setTimeout(() => setDockSize('fullscreen'), 50);
                  }}
                  sx={{ 
                    color: '#64748b',
                    '&:hover': { color: accentColor }
                  }}
                >
                  <OpenInFull sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {/* Dock/Undock toggle */}
            <Tooltip title={isDocked ? 'Undock to overlay' : 'Dock to bottom'}>
              <IconButton
                size="small"
                onClick={toggleDock}
                sx={{ 
                  color: isDocked ? accentColor : '#64748b',
                  '&:hover': { color: accentColor }
                }}
              >
                <DockOutlined 
                  sx={{ 
                    fontSize: 18, 
                    transform: 'rotate(-90deg)' // Bottom dock orientation
                  }} 
                />
              </IconButton>
            </Tooltip>
            
            {/* Minimize button - works from both docked and floating modes */}
            {!isFullscreen && (
              <Tooltip title="Minimize to tab">
                <IconButton
                  size="small"
                  onClick={() => {
                    if (!isDocked) {
                      // If floating, dock first then minimize
                      toggleDock();
                      setTimeout(() => setDockSize('minimized'), 50);
                    } else {
                      setDockSize('minimized');
                    }
                  }}
                  sx={{ 
                    color: '#64748b',
                    '&:hover': { color: accentColor }
                  }}
                >
                  <Minimize sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Scrollable Content - Hide only when minimized, show for compact/expanded/fullscreen/overlay */}
        {(dockedSize !== 'minimized' || !isDocked) && (
          <Box sx={{ flex: 1, overflow: 'auto', p: isFullWidth ? 0 : 2 }}>
            
            {/* FULL DASHBOARD VIEW - when docked with expanded/fullscreen size */}
            {isFullWidth && (
              <Box sx={{ height: '100%', overflow: 'auto' }}>
                {/* HOW THIS ANALYSIS WORKS - Collapsible Section */}
                <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      cursor: 'pointer',
                      '&:hover': { opacity: 0.8 }
                    }}
                    onClick={() => setShowExplanation(!showExplanation)}
                  >
                    <Typography variant="caption" sx={{ 
                      fontWeight: 700, 
                      color: 'text.secondary', 
                      textTransform: 'uppercase',
                      letterSpacing: 1
                    }}>
                      How This Analysis Works
                    </Typography>
                    <IconButton size="small" sx={{ color: 'text.secondary' }}>
                      {showExplanation ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </Box>
                  
                  <Collapse in={showExplanation}>
                    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                      {/* SECTION A: Graph ML (Purple) */}
                      <Box sx={{ 
                        p: 1.5, 
                        bgcolor: alpha('#8B5CF6', 0.1), 
                        borderRadius: 2,
                        border: '2px solid',
                        borderColor: '#8B5CF6'
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
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
                        
                        <Stack direction="row" spacing={2} flexWrap="wrap">
                          <Box sx={{ flex: '1 1 200px' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <Storage sx={{ color: '#8B5CF6', fontSize: 14 }} />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: '#8B5CF6', fontSize: '0.65rem' }}>
                                1. Graph Construction
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }}>
                              1,873 nodes with capacity, load factor, customer count
                            </Typography>
                          </Box>
                          <Box sx={{ flex: '1 1 200px' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <FiberManualRecord sx={{ color: '#8B5CF6', fontSize: 14 }} />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: '#8B5CF6', fontSize: '0.65rem' }}>
                                2. Centrality Scoring
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }}>
                              Betweenness (60%) + Degree (40%) centrality
                            </Typography>
                          </Box>
                          <Box sx={{ flex: '1 1 200px' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <Waves sx={{ color: '#8B5CF6', fontSize: 14 }} />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: '#8B5CF6', fontSize: '0.65rem' }}>
                                3. BFS Propagation
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }}>
                              Wave-by-wave failure spread simulation
                            </Typography>
                          </Box>
                          <Box sx={{ flex: '1 1 200px' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <Calculate sx={{ color: '#8B5CF6', fontSize: 14 }} />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: '#8B5CF6', fontSize: '0.65rem' }}>
                                4. Impact Calculation
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }}>
                              Capacity lost, affected nodes, customers impacted
                            </Typography>
                          </Box>
                        </Stack>
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled', fontSize: '0.55rem' }}>
                          Executes as Snowpark Python UDF • Source: NODE_CENTRALITY_FEATURES_V2
                        </Typography>
                      </Box>
                      
                      {/* SECTION B: Gen AI (Cyan) */}
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
                        
                        <Stack direction="row" spacing={2}>
                          <Box sx={{ flex: 1, p: 1, bgcolor: alpha('#29B5E8', 0.1), borderRadius: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <Description sx={{ color: '#29B5E8', fontSize: 14 }} />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: '#29B5E8', fontSize: '0.65rem' }}>
                                Summary
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>
                              Translates graph metrics into plain English
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
                              Actionable mitigation steps from results
                            </Typography>
                          </Box>
                        </Stack>
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled', fontSize: '0.55rem' }}>
                          Powered by Snowflake Cortex Complete (Claude 4.5 Sonnet)
                        </Typography>
                      </Box>
                    </Stack>
                  </Collapse>
                </Box>
                
                <CascadeAnalysisDashboard
                  scenarios={scenarios}
                  cascadeResult={cascadeResult}
                  highRiskNodes={highRiskNodes}
                  isSimulating={isSimulating}
                  onSimulate={onSimulate}
                  onClear={onClear}
                  onLoadHighRisk={onLoadHighRisk}
                  onLoadPredictions={onLoadPredictions}
                  visible={true}
                  onToggleVisibility={() => {}}
                  isEmbedded={true}
                  isSideBySide={isDocked && dockedSize === 'expanded' && otherPanelDocked && otherPanelSize === 'expanded'}
                />
              </Box>
            )}
            
            {/* COMPACT VIEW - for overlay mode OR docked compact size */}
            {!isFullWidth && (
            <>
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
                variant="scrollable"
                scrollButtons="auto"
                sx={{ 
                  minHeight: 32,
                  mb: 1,
                  '& .MuiTab-root': { minHeight: 32, py: 0.5, fontSize: '0.6rem', minWidth: 'auto', px: 0.75 },
                  '& .MuiTabs-scrollButtons': { width: 24 }
                }}
              >
                <Tab label="Flow" icon={<AccountTree sx={{ fontSize: 12 }} />} iconPosition="start" />
                <Tab label="Waves" icon={<BarChart sx={{ fontSize: 12 }} />} iconPosition="start" />
                <Tab label="Nodes" icon={<ElectricalServices sx={{ fontSize: 12 }} />} iconPosition="start" />
                <Tab label="Risk" icon={<Warning sx={{ fontSize: 12 }} />} iconPosition="start" />
                <Tab label="Regions" icon={<SwapHoriz sx={{ fontSize: 12 }} />} iconPosition="start" sx={{ color: '#06B6D4' }} />
                <Tab label="ROI" icon={<AttachMoney sx={{ fontSize: 12 }} />} iconPosition="start" sx={{ color: '#8B5CF6' }} />
                <Tab label="Actions" icon={<Shield sx={{ fontSize: 12 }} />} iconPosition="start" sx={{ color: '#F97316' }} />
                <Tab label="Restore" icon={<RestartAlt sx={{ fontSize: 12 }} />} iconPosition="start" sx={{ color: '#22C55E' }} />
              </Tabs>

              {activeTab === 0 && <CompactFlowDiagram cascadeResult={cascadeResult} waveBreakdown={waveBreakdown} focusedWave={focusedWave} onFocusWave={onFocusWave} />}
              {activeTab === 1 && <WaveBreakdownMini waveBreakdown={waveBreakdown} />}
              {activeTab === 2 && <CascadeChildNodes cascadeResult={cascadeResult} />}
              {activeTab === 3 && <HighRiskNodesCompact nodes={highRiskNodes} onSelect={setSelectedPatientZero} />}
              {activeTab === 4 && <CrossRegionFlowCompact highRiskNodes={highRiskNodes} cascadeResult={cascadeResult} />}
              {activeTab === 5 && <InvestmentROICompact highRiskNodes={highRiskNodes} cascadeResult={cascadeResult} isSideBySide={isDocked && dockedSize === 'expanded' && otherPanelDocked && otherPanelSize === 'expanded'} />}
              {activeTab === 6 && <MitigationActionsCompact playbookResponse={mitigationPlaybook} economicResponse={economicImpact} loading={actionableLoading.mitigation || actionableLoading.economic} />}
              {activeTab === 7 && <RestorationSequenceCompact sequenceResponse={restorationSequence} loading={actionableLoading.restoration} />}
              
              {/* Cortex AI Insights - available after simulation */}
              <CortexExplanationPanel cascadeResult={cascadeResult} visible={true} />
            </>
          )}

          {/* No results - show high risk nodes */}
          {!cascadeResult && (
            <HighRiskNodesCompact nodes={highRiskNodes} onSelect={setSelectedPatientZero} />
          )}
          </>
          )}
        </Box>
        )}

        {/* Footer Actions - only show in overlay mode (not docked) */}
        {!isDocked && !isFullWidth && (
          <Box sx={{ 
            p: 1.5, 
            borderTop: '1px solid', 
            borderColor: alpha('#fff', 0.1),
            bgcolor: alpha('#000', 0.2),
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
        )}
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

  // Always use portal so the panel can appear as a floating window or docked panel
  // This ensures it escapes the map's positioning context
  return createPortal(panelContent, document.body);
}

export default CascadeControlPanel;
