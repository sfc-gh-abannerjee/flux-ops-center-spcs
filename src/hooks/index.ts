/**
 * Custom React hooks for Flux Operations Center
 * 
 * These hooks encapsulate common patterns and reduce boilerplate in components.
 */

export {
  useAnimationLoop,
  usePolling,
  useDebounce,
  useThrottle,
  useDrag,
  useScrollBottom,
} from './useAnimation';

export type { DragState, UseDragOptions } from './useAnimation';

export {
  useFetch,
  useConditionalFetch,
  useParallelFetch,
  usePost,
  clearFetchCache,
} from './useFetch';

export type { FetchState, UseFetchOptions } from './useFetch';

export {
  useWeatherLayers,
  useHeatmapLayers,
  usePowerLineGlowLayers,
} from './useLayers';

export type { WeatherLayerProps, HeatmapLayerProps, PowerLineGlowProps } from './useLayers';

export { useCascadeLayers } from './useCascadeLayers';
