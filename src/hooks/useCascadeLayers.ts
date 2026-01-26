/**
 * Cascade Analysis Visualization Layers
 * 
 * Engineering: Integrates cascade failure simulation into the existing deck.gl map
 * - Patient Zero marker (red pulsing node)
 * - Cascade propagation waves (orange gradient)
 * - At-risk node highlighting
 * - Propagation path animation
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ScatterplotLayer, ArcLayer, PathLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { 
  CascadeNode, 
  CascadeResult, 
  CascadePropagationPath,
  CascadeScenario,
  TransformerRiskPrediction 
} from '../types';

// Cascade color palette - IMPROVED COLOR SEPARATION (from types/index.ts COLORS.cascade)
const CASCADE_COLORS = {
  patientZero: [255, 0, 0, 255] as [number, number, number, number],
  waveColors: [
    [255, 0, 50, 230],      // Wave 1: Red-Pink (distinct from patient zero)
    [255, 100, 0, 210],     // Wave 2: Orange-Red
    [255, 170, 0, 190],     // Wave 3: Orange-Gold
    [180, 200, 0, 170],     // Wave 4: Yellow-Green (contrast shift)
    [100, 220, 150, 150],   // Wave 5: Teal-Green (clearly different)
  ] as [number, number, number, number][],
  propagationPath: [255, 107, 107, 180] as [number, number, number, number],
  atRisk: [255, 149, 0, 200] as [number, number, number, number],
  safe: [34, 197, 94, 150] as [number, number, number, number],
  highRiskPrediction: [239, 68, 68, 220] as [number, number, number, number],
  elevatedRiskPrediction: [251, 191, 36, 180] as [number, number, number, number],
};

interface CascadeLayerState {
  cascadeResult: CascadeResult | null;
  highRiskNodes: CascadeNode[];
  riskPredictions: TransformerRiskPrediction[];
  isSimulating: boolean;
  isLoadingPredictions: boolean;
  selectedScenario: CascadeScenario | null;
  animationPhase: number;
  focusedWave: number | null;
}

interface UseCascadeLayersProps {
  visible: boolean;
  currentZoom: number;
  onNodeClick?: (node: CascadeNode) => void;
  animationTime: number;
  focusedWave?: number | null;
}

interface CascadeLayerControls {
  simulateCascade: (scenario: CascadeScenario, patientZeroId?: string) => Promise<void>;
  clearCascade: () => void;
  loadHighRiskNodes: () => Promise<void>;
  loadRiskPredictions: () => Promise<void>;
  setFocusedWave: (wave: number | null) => void;
  state: CascadeLayerState;
  scenarios: CascadeScenario[];
}

// Predefined scenarios (matches backend)
const PREDEFINED_SCENARIOS: CascadeScenario[] = [
  {
    name: 'Winter Storm Uri',
    description: 'Extreme cold event (Feb 2021) - cascading failures from demand surge',
    parameters: {
      temperature_c: -18,
      load_multiplier: 2.5,
      failure_threshold: 0.5,
    },
    historical_reference: '2021-02-15'
  },
  {
    name: 'Summer Peak Demand',
    description: 'Triple-digit heat with AC load surge',
    parameters: {
      temperature_c: 42,
      load_multiplier: 1.8,
      failure_threshold: 0.65,
    }
  },
  {
    name: 'Hurricane Event',
    description: 'Gulf hurricane with high winds and flooding',
    parameters: {
      temperature_c: 28,
      load_multiplier: 0.5,  // Reduced load due to evacuations
      failure_threshold: 0.4, // Lower threshold - storm damage
    }
  },
  {
    name: 'Normal Operations',
    description: 'Baseline conditions for comparison',
    parameters: {
      temperature_c: 25,
      load_multiplier: 1.0,
      failure_threshold: 0.8,
    }
  }
];

export function useCascadeLayers({
  visible,
  currentZoom,
  onNodeClick,
  animationTime,
  focusedWave: externalFocusedWave
}: UseCascadeLayersProps): { layers: unknown[]; controls: CascadeLayerControls } {
  
  // State
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null);
  const [highRiskNodes, setHighRiskNodes] = useState<CascadeNode[]>([]);
  const [riskPredictions, setRiskPredictions] = useState<TransformerRiskPrediction[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<CascadeScenario | null>(null);
  const [focusedWave, setFocusedWave] = useState<number | null>(null);
  const animationPhaseRef = useRef(0);
  
  // Use external focused wave if provided, otherwise use internal state
  const activeFocusedWave = externalFocusedWave !== undefined ? externalFocusedWave : focusedWave;
  
  // Animation for pulsing effects
  useEffect(() => {
    animationPhaseRef.current = animationTime;
  }, [animationTime]);

  // Load high-risk nodes from API
  const loadHighRiskNodes = useCallback(async () => {
    try {
      const response = await fetch('/api/cascade/high-risk-nodes?limit=50');
      if (!response.ok) throw new Error('Failed to load high-risk nodes');
      const data = await response.json();
      setHighRiskNodes(data.high_risk_nodes || []);
    } catch (error) {
      console.error('Failed to load high-risk nodes:', error);
    }
  }, []);

  // Load ML risk predictions
  const loadRiskPredictions = useCallback(async () => {
    setIsLoadingPredictions(true);
    try {
      const response = await fetch('/api/cascade/transformer-risk-prediction?limit=100');
      if (!response.ok) throw new Error('Failed to load risk predictions');
      const data = await response.json();
      setRiskPredictions(data.predictions || []);
      console.log(`Loaded ${data.predictions?.length || 0} risk predictions`);
    } catch (error) {
      console.error('Failed to load risk predictions:', error);
    } finally {
      setIsLoadingPredictions(false);
    }
  }, []);

  // Simulate cascade from scenario
  const simulateCascade = useCallback(async (scenario: CascadeScenario, patientZeroId?: string) => {
    setIsSimulating(true);
    setSelectedScenario(scenario);
    
    try {
      const response = await fetch('/api/cascade/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_name: scenario.name,
          initial_failure_node: patientZeroId,
          temperature_c: scenario.parameters.temperature_c,
          load_multiplier: scenario.parameters.load_multiplier,
          failure_threshold: scenario.parameters.failure_threshold,
        }),
      });
      
      if (!response.ok) throw new Error('Cascade simulation failed');
      const result = await response.json();
      setCascadeResult(result);
    } catch (error) {
      console.error('Cascade simulation error:', error);
    } finally {
      setIsSimulating(false);
    }
  }, []);

  // Clear cascade visualization
  const clearCascade = useCallback(() => {
    setCascadeResult(null);
    setSelectedScenario(null);
  }, []);

  // Build layers
  const layers = useMemo(() => {
    if (!visible) return [];
    
    const cascadeLayers: unknown[] = [];
    
    // Pulse animation factor (0-1 oscillating) - use animationTime directly for proper updates
    const pulsePhase = (Math.sin(animationTime * 2) + 1) / 2;
    
    // ===========================================================
    // LAYER 1: High-Risk Nodes (potential Patient Zeros)
    // ===========================================================
    if (highRiskNodes.length > 0 && !cascadeResult) {
      // Show high-risk nodes when no cascade is active
      const validNodes = highRiskNodes.filter(n => n.lat != null && n.lon != null);
      
      cascadeLayers.push(
        new ScatterplotLayer({
          id: 'cascade-high-risk-nodes',
          data: validNodes,
          pickable: true,
          opacity: 0.8,
          stroked: true,
          filled: true,
          radiusScale: 1,
          radiusMinPixels: 8,
          radiusMaxPixels: 30,
          lineWidthMinPixels: 2,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPosition: (d: CascadeNode) => [d.lon!, d.lat!],
          getRadius: (d: CascadeNode) => {
            // Size based on criticality score
            const baseRadius = 200 + (d.criticality_score * 300);
            return baseRadius * (0.9 + pulsePhase * 0.2);
          },
          getFillColor: (d: CascadeNode) => {
            // Color gradient based on criticality
            if (d.criticality_score > 0.8) return CASCADE_COLORS.patientZero;
            if (d.criticality_score > 0.6) return CASCADE_COLORS.atRisk;
            return CASCADE_COLORS.elevatedRiskPrediction;
          },
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 2,
          onClick: (info: { object?: CascadeNode }) => {
            if (info.object && onNodeClick) {
              onNodeClick(info.object);
            }
          },
          updateTriggers: {
            getRadius: [pulsePhase],
          }
        })
      );
    }

    // ===========================================================
    // LAYER 2: ML Risk Predictions (afternoon predictions from morning state)
    // ===========================================================
    if (riskPredictions.length > 0 && currentZoom >= 9) {  // Lowered threshold from 11 to 9
      const validPredictions = riskPredictions.filter(p => p.lat != null && p.lon != null);
      
      cascadeLayers.push(
        new ScatterplotLayer({
          id: 'cascade-risk-predictions',
          data: validPredictions,
          pickable: true,
          opacity: 0.85,
          stroked: true,
          filled: true,
          radiusMinPixels: 6,
          radiusMaxPixels: 20,
          lineWidthMinPixels: 2,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPosition: (d: TransformerRiskPrediction) => [d.lon!, d.lat!],
          getRadius: (d: TransformerRiskPrediction) => {
            // Size based on predicted risk level - larger for visibility
            if (d.risk_level === 'critical') return 200;
            if (d.risk_level === 'warning') return 150;
            return 100;
          },
          getFillColor: (d: TransformerRiskPrediction) => {
            // Purple color scheme to differentiate from cascade (red/orange)
            if (d.risk_level === 'critical') return [139, 92, 246, 220] as [number, number, number, number]; // Purple
            if (d.risk_level === 'warning') return [167, 139, 250, 200] as [number, number, number, number]; // Light purple
            return [196, 181, 253, 180] as [number, number, number, number]; // Lighter purple
          },
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 2,
        })
      );
    }

    // ===========================================================
    // LAYER 3: Active Cascade Simulation Results
    // ===========================================================
    if (cascadeResult) {
      const { patient_zero, cascade_order, propagation_paths } = cascadeResult;
      
      // Patient Zero (red pulsing marker)
      if (patient_zero && patient_zero.lat != null && patient_zero.lon != null) {
        cascadeLayers.push(
          new ScatterplotLayer({
            id: 'cascade-patient-zero',
            data: [patient_zero],
            pickable: true,
            opacity: 1,
            stroked: true,
            filled: true,
            radiusMinPixels: 15,
            radiusMaxPixels: 50,
            lineWidthMinPixels: 3,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            getPosition: (d: CascadeNode) => [d.lon!, d.lat!],
            getRadius: () => 400 * (0.8 + pulsePhase * 0.4),
            getFillColor: () => {
              // Pulsing red
              const alpha = Math.round(180 + pulsePhase * 75);
              return [255, 0, 0, alpha];
            },
            getLineColor: [255, 255, 255, 255],
            getLineWidth: 3,
            updateTriggers: {
              getRadius: [pulsePhase],
              getFillColor: [pulsePhase],
            }
          })
        );
      }
      
      // Cascade wave nodes (colored by failure order with wave depth)
      if (cascade_order && cascade_order.length > 0) {
        const validCascadeNodes = cascade_order.filter(n => n.lat != null && n.lon != null);
        
        cascadeLayers.push(
          new ScatterplotLayer({
            id: 'cascade-wave-nodes',
            data: validCascadeNodes,
            pickable: true,
            opacity: 0.85,
            stroked: true,
            filled: true,
            radiusMinPixels: 6,
            radiusMaxPixels: 25,
            lineWidthMinPixels: 1,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            getPosition: (d: CascadeNode & { order: number; wave_depth?: number }) => [d.lon!, d.lat!],
            getRadius: (d: CascadeNode & { order: number; wave_depth?: number }) => {
              // Earlier failures = larger markers
              // Use wave_depth if available, otherwise calculate from order
              const waveNum = d.wave_depth ?? Math.floor(d.order / 5) + 1;
              const baseRadius = 250 - (waveNum * 30);
              return Math.max(80, baseRadius);
            },
            getFillColor: (d: CascadeNode & { order: number; wave_depth?: number }) => {
              // Wave color gradient by wave depth (more accurate than order)
              const waveNum = d.wave_depth ?? Math.floor(d.order / 5);
              const waveIndex = Math.min(waveNum, CASCADE_COLORS.waveColors.length - 1);
              return CASCADE_COLORS.waveColors[waveIndex];
            },
            getLineColor: [255, 255, 255, 180],
            getLineWidth: 1,
          })
        );
      }
      
      // Propagation paths (animated arcs showing failure spread with TRAVELING PULSE animation)
      // Design: Sequential wave animation that shows failures propagating outward
      // - Wave 1 animates first, then Wave 2, etc.
      // - "Traveling pulse" particles move along arcs to show direction
      // - Completed arcs stay visible but dimmed
      if (propagation_paths && propagation_paths.length > 0) {
        // Need to resolve node positions for paths
        const nodePositions = new Map<string, [number, number]>();
        if (patient_zero && patient_zero.lat != null && patient_zero.lon != null) {
          nodePositions.set(patient_zero.node_id, [patient_zero.lon, patient_zero.lat]);
        }
        cascade_order?.forEach(n => {
          if (n.lat != null && n.lon != null) {
            nodePositions.set(n.node_id, [n.lon, n.lat]);
          }
        });
        
        // Group paths by wave for animation offset
        const pathsWithCoords = propagation_paths
          .filter(p => nodePositions.has(p.from_node) && nodePositions.has(p.to_node))
          .map(p => {
            // Determine wave from the target node
            const targetNode = cascade_order?.find(n => n.node_id === p.to_node);
            const waveDepth = targetNode?.wave_depth ?? Math.floor(p.order / 5);
            return {
              ...p,
              from_coords: nodePositions.get(p.from_node)!,
              to_coords: nodePositions.get(p.to_node)!,
              wave_depth: waveDepth,
            };
          });
        
        if (pathsWithCoords.length > 0) {
          const waveCount = Math.max(...pathsWithCoords.map(p => p.wave_depth), 0) + 1;
          
          // Animation timing: each wave gets 0.9 seconds animation + 0.5 second hold
          const waveDuration = 0.9;
          const waveHold = 0.5;
          const waveTotal = waveDuration + waveHold; // Total time per wave including hold
          const cycleDuration = waveCount * waveTotal; // No gap - seamless restart
          
          // Animation speed multiplier
          const currentCycleTime = activeFocusedWave !== null 
            ? activeFocusedWave * waveTotal + waveDuration * 0.5
            : (animationTime * 0.65) % cycleDuration;
          
          // Layer 1: Base arcs - always visible, dimmed
          cascadeLayers.push(
            new ArcLayer({
              id: 'cascade-propagation-paths-base',
              data: pathsWithCoords,
              pickable: false,
              opacity: 0.5,
              getSourcePosition: (d) => d.from_coords,
              getTargetPosition: (d) => d.to_coords,
              getSourceColor: (d) => {
                const waveIndex = Math.min(d.wave_depth, CASCADE_COLORS.waveColors.length - 1);
                const color = CASCADE_COLORS.waveColors[waveIndex];
                const isFocused = activeFocusedWave === null || d.wave_depth === activeFocusedWave;
                return [color[0], color[1], color[2], isFocused ? 80 : 25] as [number, number, number, number];
              },
              getTargetColor: (d) => {
                const waveIndex = Math.min(d.wave_depth, CASCADE_COLORS.waveColors.length - 1);
                const color = CASCADE_COLORS.waveColors[waveIndex];
                const isFocused = activeFocusedWave === null || d.wave_depth === activeFocusedWave;
                return [color[0], color[1], color[2], isFocused ? 60 : 20] as [number, number, number, number];
              },
              getWidth: 2,
              getHeight: 0.12,
              widthMinPixels: 1,
              widthMaxPixels: 3,
              updateTriggers: {
                getSourceColor: [activeFocusedWave],
                getTargetColor: [activeFocusedWave],
              },
            })
          );
          
          // Layer 2: TRAVELING GLOW - animated gradient that travels along the arc
          // Creates a "pulse of light" effect moving from source to target
          cascadeLayers.push(
            new ArcLayer({
              id: 'cascade-propagation-glow',
              data: pathsWithCoords,
              pickable: true,
              getSourcePosition: (d) => d.from_coords,
              getTargetPosition: (d) => d.to_coords,
              getSourceColor: (d) => {
                const waveStartTime = d.wave_depth * waveTotal;
                const waveEndTime = waveStartTime + waveDuration;
                const waveHoldEnd = waveStartTime + waveTotal;
                
                // Calculate progress (0 to 1) within this wave's animation
                let progress = 0;
                let inHold = false;
                if (activeFocusedWave !== null && d.wave_depth === activeFocusedWave) {
                  progress = (Math.sin(animationTime * 1.5) + 1) / 2; // Oscillate when focused
                } else if (currentCycleTime >= waveStartTime && currentCycleTime < waveEndTime) {
                  progress = (currentCycleTime - waveStartTime) / waveDuration;
                } else if (currentCycleTime >= waveEndTime && currentCycleTime < waveHoldEnd) {
                  progress = 1; // Hold at completed state
                  inHold = true;
                } else if (currentCycleTime < waveStartTime) {
                  progress = 0; // Wave hasn't started yet
                } else {
                  progress = 0; // Wave completed - reset to 0 for seamless loop appearance
                }
                
                const waveIndex = Math.min(d.wave_depth, CASCADE_COLORS.waveColors.length - 1);
                const color = CASCADE_COLORS.waveColors[waveIndex];
                
                // Source is bright when pulse is at start, dims as pulse travels away
                const sourceBrightness = Math.max(0, 1 - progress * 2); // Bright at 0, dim by 0.5
                const alpha = inHold ? 50 : Math.round(50 + sourceBrightness * 205);
                return [color[0], color[1], color[2], alpha] as [number, number, number, number];
              },
              getTargetColor: (d) => {
                const waveStartTime = d.wave_depth * waveTotal;
                const waveEndTime = waveStartTime + waveDuration;
                const waveHoldEnd = waveStartTime + waveTotal;
                
                let progress = 0;
                let inHold = false;
                if (activeFocusedWave !== null && d.wave_depth === activeFocusedWave) {
                  progress = (Math.sin(animationTime * 1.5) + 1) / 2;
                } else if (currentCycleTime >= waveStartTime && currentCycleTime < waveEndTime) {
                  progress = (currentCycleTime - waveStartTime) / waveDuration;
                } else if (currentCycleTime >= waveEndTime && currentCycleTime < waveHoldEnd) {
                  progress = 1; // Hold at completed state
                  inHold = true;
                } else if (currentCycleTime < waveStartTime) {
                  progress = 0;
                } else {
                  progress = 0; // Reset for seamless loop
                }
                
                const waveIndex = Math.min(d.wave_depth, CASCADE_COLORS.waveColors.length - 1);
                const color = CASCADE_COLORS.waveColors[waveIndex];
                
                // Target is dim when pulse is at start, brightens as pulse arrives
                const targetBrightness = Math.max(0, (progress - 0.5) * 2); // Dim until 0.5, bright by 1.0
                const alpha = inHold ? 180 : Math.round(50 + targetBrightness * 205);
                return [color[0], color[1], color[2], alpha] as [number, number, number, number];
              },
              getWidth: (d) => {
                const waveStartTime = d.wave_depth * waveTotal;
                const waveEndTime = waveStartTime + waveDuration;
                const waveHoldEnd = waveStartTime + waveTotal;
                const isActive = (currentCycleTime >= waveStartTime && currentCycleTime < waveHoldEnd) ||
                                 (activeFocusedWave !== null && d.wave_depth === activeFocusedWave);
                
                // Show thin base width when not active (instead of 0)
                if (!isActive) return 1;
                
                // During hold, show steady width
                if (currentCycleTime >= waveEndTime && currentCycleTime < waveHoldEnd) {
                  return 4;
                }
                
                // Pulse width - thicker in the middle of the animation
                let progress = 0;
                if (activeFocusedWave !== null && d.wave_depth === activeFocusedWave) {
                  progress = (Math.sin(animationTime * 1.5) + 1) / 2;
                } else if (currentCycleTime >= waveStartTime && currentCycleTime < waveEndTime) {
                  progress = (currentCycleTime - waveStartTime) / waveDuration;
                } else {
                  progress = 0;
                }
                
                const pulseWidth = Math.sin(progress * Math.PI); // Peaks at 0.5
                return 3 + pulseWidth * 5;
              },
              getHeight: 0.15,
              widthMinPixels: 2,
              widthMaxPixels: 10,
              updateTriggers: {
                getSourceColor: [currentCycleTime, activeFocusedWave, animationTime],
                getTargetColor: [currentCycleTime, activeFocusedWave, animationTime],
                getWidth: [currentCycleTime, activeFocusedWave, animationTime],
              },
            })
          );
          
          // Layer 3: Impact flash at target nodes when pulse reaches them (progress ~0.85-1.0)
          if (activeFocusedWave === null) {
            const impactData = pathsWithCoords.filter(p => {
              const waveStartTime = p.wave_depth * waveTotal;
              const waveEndTime = waveStartTime + waveDuration;
              // Only show flash during the pulse animation phase, not during hold
              if (currentCycleTime < waveStartTime || currentCycleTime >= waveEndTime) return false;
              const progress = (currentCycleTime - waveStartTime) / waveDuration;
              // Flash when pulse reaches target (progress 0.75 to 1.0)
              return progress >= 0.75 && progress <= 1.0;
            }).map(p => {
              const waveStartTime = p.wave_depth * waveTotal;
              const progress = (currentCycleTime - waveStartTime) / waveDuration;
              // Intensity peaks at progress=0.85, fades out by 1.0
              const flashProgress = (progress - 0.75) / 0.25; // 0 to 1 within flash window
              const intensity = flashProgress < 0.4 ? flashProgress / 0.4 : 1 - ((flashProgress - 0.4) / 0.6);
              return {
                position: p.to_coords,
                wave_depth: p.wave_depth,
                intensity: Math.max(0, Math.min(1, intensity)),
              };
            });
            
            if (impactData.length > 0) {
              cascadeLayers.push(
                new ScatterplotLayer({
                  id: 'cascade-impact-flash',
                  data: impactData,
                  pickable: false,
                  opacity: 0.9,
                  stroked: false,
                  filled: true,
                  radiusMinPixels: 8,
                  radiusMaxPixels: 25,
                  coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                  getPosition: (d: { position: [number, number]; wave_depth: number; intensity: number }) => d.position,
                  getRadius: (d: { position: [number, number]; wave_depth: number; intensity: number }) => {
                    return 80 + d.intensity * 120;
                  },
                  getFillColor: (d: { position: [number, number]; wave_depth: number; intensity: number }) => {
                    const waveIndex = Math.min(d.wave_depth, CASCADE_COLORS.waveColors.length - 1);
                    const color = CASCADE_COLORS.waveColors[waveIndex];
                    const alpha = Math.round(d.intensity * 220);
                    return [color[0], color[1], color[2], alpha] as [number, number, number, number];
                  },
                  updateTriggers: {
                    getPosition: [currentCycleTime],
                    getRadius: [currentCycleTime],
                    getFillColor: [currentCycleTime],
                  },
                })
              );
            }
          }
        }
      }
    }
    
    return cascadeLayers;
  }, [visible, currentZoom, highRiskNodes, riskPredictions, cascadeResult, onNodeClick, animationTime, activeFocusedWave]);

  // Return layers and controls
  const controls: CascadeLayerControls = {
    simulateCascade,
    clearCascade,
    loadHighRiskNodes,
    loadRiskPredictions,
    setFocusedWave,
    state: {
      cascadeResult,
      highRiskNodes,
      riskPredictions,
      isSimulating,
      isLoadingPredictions,
      selectedScenario,
      animationPhase: animationPhaseRef.current,
      focusedWave: activeFocusedWave,
    },
    scenarios: PREDEFINED_SCENARIOS,
  };

  return { layers, controls };
}

export default useCascadeLayers;
