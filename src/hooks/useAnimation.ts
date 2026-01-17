import { useEffect, useRef, useCallback, useState } from 'react';
import { logger } from '../utils/logger';

/**
 * Custom hook for running animation loops with requestAnimationFrame
 * Only runs when conditions are met (e.g., selected asset exists)
 * 
 * @param shouldAnimate - Whether animation should be running
 * @param onFrame - Callback called on each animation frame with current time
 * @returns Current animation frame count (can be used as updateTrigger)
 */
export function useAnimationLoop(
  shouldAnimate: boolean,
  onFrame?: (time: number) => void
): number {
  const [frameCount, setFrameCount] = useState(0);
  const timeRef = useRef(0);

  useEffect(() => {
    if (!shouldAnimate) return;

    let animationFrameId: number;
    
    const animate = () => {
      timeRef.current = Date.now() * 0.002;
      onFrame?.(timeRef.current);
      setFrameCount(prev => prev + 1);
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animationFrameId = requestAnimationFrame(animate);
    
    return () => cancelAnimationFrame(animationFrameId);
  }, [shouldAnimate, onFrame]);

  return frameCount;
}

/**
 * Hook for polling data at regular intervals with automatic cleanup
 * 
 * @param callback - Async function to call on each interval
 * @param intervalMs - Interval in milliseconds
 * @param enabled - Whether polling should be active
 */
export function usePolling(
  callback: () => Promise<void>,
  intervalMs: number,
  enabled: boolean = true
): void {
  const savedCallback = useRef(callback);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    // Run immediately on mount
    savedCallback.current().catch(err => 
      logger.error('Polling callback error:', err)
    );

    // Then run at intervals
    const intervalId = setInterval(() => {
      savedCallback.current().catch(err => 
        logger.error('Polling callback error:', err)
      );
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [intervalMs, enabled]);
}

/**
 * Hook for debouncing rapid value changes
 * 
 * @param value - Value to debounce
 * @param delay - Debounce delay in ms
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for throttling rapid value changes
 * Unlike debounce, this ensures updates happen at most once per interval
 * 
 * @param value - Value to throttle
 * @param interval - Minimum interval between updates
 * @returns Throttled value
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdated = useRef(Date.now());

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdated.current;

    if (timeSinceLastUpdate >= interval) {
      lastUpdated.current = now;
      setThrottledValue(value);
    } else {
      const timeoutId = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, interval - timeSinceLastUpdate);
      
      return () => clearTimeout(timeoutId);
    }
  }, [value, interval]);

  return throttledValue;
}

/**
 * Hook that returns stable callbacks for drag operations with momentum
 * Handles both regular state updates and direct DOM manipulation for performance
 */
export interface DragState {
  isDragging: boolean;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
}

export interface UseDragOptions {
  initialPosition: { x: number; y: number };
  onDragEnd?: (position: { x: number; y: number }) => void;
  friction?: number;
  minVelocity?: number;
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export function useDrag(options: UseDragOptions) {
  const {
    initialPosition,
    onDragEnd,
    friction = 0.92,
    minVelocity = 0.5,
    bounds,
  } = options;

  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastPositionRef = useRef(initialPosition);
  const rafRef = useRef<number>();

  const clampPosition = useCallback((pos: { x: number; y: number }) => {
    if (!bounds) return pos;
    return {
      x: Math.max(bounds.minX, Math.min(pos.x, bounds.maxX)),
      y: Math.max(bounds.minY, Math.min(pos.y, bounds.maxY)),
    };
  }, [bounds]);

  const startDrag = useCallback((clientX: number, clientY: number) => {
    setIsDragging(true);
    lastPositionRef.current = { x: clientX, y: clientY };
    velocityRef.current = { x: 0, y: 0 };
  }, []);

  const updateDrag = useCallback((clientX: number, clientY: number) => {
    if (!isDragging) return;

    const deltaX = clientX - lastPositionRef.current.x;
    const deltaY = clientY - lastPositionRef.current.y;

    velocityRef.current = { x: deltaX, y: deltaY };
    lastPositionRef.current = { x: clientX, y: clientY };

    setPosition(prev => clampPosition({
      x: prev.x + deltaX,
      y: prev.y + deltaY,
    }));
  }, [isDragging, clampPosition]);

  const endDrag = useCallback(() => {
    setIsDragging(false);

    // Start momentum animation
    const animate = () => {
      const vx = velocityRef.current.x;
      const vy = velocityRef.current.y;

      if (Math.abs(vx) < minVelocity && Math.abs(vy) < minVelocity) {
        setPosition(prev => {
          onDragEnd?.(prev);
          return prev;
        });
        return;
      }

      velocityRef.current = {
        x: vx * friction,
        y: vy * friction,
      };

      setPosition(prev => clampPosition({
        x: prev.x + velocityRef.current.x,
        y: prev.y + velocityRef.current.y,
      }));

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [friction, minVelocity, clampPosition, onDragEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return {
    position,
    isDragging,
    startDrag,
    updateDrag,
    endDrag,
    setPosition,
  };
}

/**
 * Hook to detect when user has scrolled to bottom of a container
 * Useful for infinite scroll / pagination
 */
export function useScrollBottom(
  ref: React.RefObject<HTMLElement>,
  callback: () => void,
  threshold: number = 50
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      if (scrollHeight - scrollTop - clientHeight < threshold) {
        callback();
      }
    };

    element.addEventListener('scroll', handleScroll);
    return () => element.removeEventListener('scroll', handleScroll);
  }, [ref, callback, threshold]);
}
