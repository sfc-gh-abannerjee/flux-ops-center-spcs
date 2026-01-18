/**
 * Performance Optimization: Layer Group Memoization
 * 
 * Extracts non-interactive display layers into independent useMemo hooks.
 * Each hook only recalculates when its specific dependencies change,
 * preventing unnecessary recreation of ALL layers on every state change.
 * 
 * Impact: Weather slider, heatmap toggle, and glow effects no longer
 * trigger full layer array regeneration.
 */

import { useMemo } from 'react';
import { BitmapLayer, PathLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';

// Use flexible types for API data that may have variant field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WeatherDataRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PowerLineData = Record<string, any>;

// ============================================================================
// WEATHER LAYERS - Only recalculates on weather data or timeline change
// Previously: Recalculated on ANY of 19 dependencies
// ============================================================================
interface WeatherLayerProps {
  weather: WeatherDataRow[];
  weatherTimelineIndex: number;
  visible: boolean;
}

export function useWeatherLayers({ weather, weatherTimelineIndex, visible }: WeatherLayerProps) {
  return useMemo(() => {
    if (!visible || weather.length === 0) return [];
    
    const currentTemp = weather[weatherTimelineIndex]?.TEMP_F || weather[weatherTimelineIndex]?.temperature || 75;
    const bounds: [[number, number], [number, number]] = [
      [-96.1, 29.4],
      [-94.9, 30.2]
    ];
    const imageUrl = `/api/weather/image?temp_f=${currentTemp}&width=1536&height=1024&t=${weatherTimelineIndex}`;

    return [
      new BitmapLayer({
        id: 'weather-gradient',
        bounds: bounds as [[number, number], [number, number]],
        image: imageUrl,
        opacity: 0.7,
        pickable: false,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        updateTriggers: {
          image: weatherTimelineIndex
        }
      })
    ];
  }, [weather, weatherTimelineIndex, visible]);
}

// ============================================================================
// HEATMAP LAYERS - Only recalculates on heatmap data or visibility change
// Previously: Recalculated on ANY of 19 dependencies
// ============================================================================
interface HeatmapLayerProps {
  heatmapData: Array<{ position: [number, number]; weight: number }>;
  visible: boolean;
}

export function useHeatmapLayers({ heatmapData, visible }: HeatmapLayerProps) {
  return useMemo(() => {
    if (!visible || heatmapData.length === 0) return [];
    
    return [
      new HeatmapLayer({
        id: 'usage-heatmap',
        data: heatmapData,
        getPosition: (d: { position: [number, number] }) => d.position,
        getWeight: (d: { weight: number }) => d.weight,
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
      })
    ];
  }, [heatmapData, visible]);
}

// ============================================================================
// POWER LINE GLOW LAYERS - Non-interactive decoration layers
// Only recalculates on power line data or zoom change
// Previously: Recalculated on ANY of 19 dependencies
// ============================================================================
interface PowerLineGlowProps {
  powerLines: PowerLineData[];
  currentZoom: number;
  visible: boolean;
}

export function usePowerLineGlowLayers({ powerLines, currentZoom, visible }: PowerLineGlowProps) {
  return useMemo(() => {
    if (!visible || powerLines.length === 0) return [];
    
    // Scale factor: 0.4 at zoom 9, 1.0 at zoom 14+
    const zoomScale = Math.min(1, Math.max(0.4, (currentZoom - 9) / 5));
    
    return [
      // Outer glow layer - creates electric halo effect
      new PathLayer({
        id: 'power-lines-outer-glow',
        data: powerLines,
        getPath: (d: PowerLineData) => d.coordinates || d.path,
        getColor: (d: PowerLineData) => d.class === 'power_line' 
          ? [255, 180, 60, 45]    // Warm orange outer glow for transmission
          : [80, 180, 255, 40],   // Electric blue outer glow for distribution
        getWidth: (d: PowerLineData) => (d.class === 'power_line' ? 18 : 12) * zoomScale,
        widthUnits: 'pixels',
        widthMinPixels: 4,
        widthMaxPixels: 24,
        capRounded: true,
        jointRounded: true,
        billboard: true,
        pickable: false,  // Non-interactive glow
        updateTriggers: { getWidth: currentZoom }
      }),
      // Inner glow layer - intensified glow near line
      new PathLayer({
        id: 'power-lines-inner-glow',
        data: powerLines,
        getPath: (d: PowerLineData) => d.coordinates || d.path,
        getColor: (d: PowerLineData) => d.class === 'power_line' 
          ? [255, 160, 40, 100]   // Orange inner glow
          : [100, 200, 255, 90],  // Cyan inner glow
        getWidth: (d: PowerLineData) => (d.class === 'power_line' ? 10 : 6) * zoomScale,
        widthUnits: 'pixels',
        widthMinPixels: 2,
        widthMaxPixels: 14,
        capRounded: true,
        jointRounded: true,
        billboard: true,
        pickable: false,  // Non-interactive glow
        updateTriggers: { getWidth: currentZoom }
      })
    ];
  }, [powerLines, currentZoom, visible]);
}

// Export types
export type { WeatherLayerProps, HeatmapLayerProps, PowerLineGlowProps };
