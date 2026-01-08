import React, { useState, useRef, useEffect } from 'react';
import { Fab, Tooltip } from '@mui/material';
import FluxLogo from './FluxLogo';

interface DraggableFabProps {
  visible: boolean;
  spinning: boolean;
  onPositionChange: (position: { x: number; y: number }) => void;
  onClick: () => void;
}

export default function DraggableFab({ visible, spinning, onPositionChange, onClick }: DraggableFabProps) {
  const [position, setPosition] = useState({ x: window.innerWidth - 100, y: window.innerHeight - 100 });
  const elementRef = useRef<HTMLDivElement>(null);
  
  const isDraggingRef = useRef(false);
  const originPosition = useRef({ x: window.innerWidth - 100, y: window.innerHeight - 100 });
  const startPosition = useRef({ x: 0, y: 0 });
  const currentPosition = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const velocityHistory = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const momentumAnimationRef = useRef<number | null>(null);
  const hasMoved = useRef(false);

  const calculatePosition = () => {
    return {
      x: originPosition.current.x + currentPosition.current.x - startPosition.current.x,
      y: originPosition.current.y + currentPosition.current.y - startPosition.current.y
    };
  };

  const updatePosition = () => {
    const pos = calculatePosition();
    if (elementRef.current) {
      elementRef.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    }
    rafId.current = null;
  };

  const requestUpdate = () => {
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(updatePosition);
    }
  };

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !visible) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || isDraggingRef.current) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
        momentumAnimationRef.current = null;
      }
      
      isDraggingRef.current = true;
      velocityHistory.current = [];
      hasMoved.current = false;
      
      if (element) {
        element.style.willChange = 'transform';
      }
      
      startPosition.current = { x: e.clientX, y: e.clientY };
      currentPosition.current = { x: e.clientX, y: e.clientY };
      
      element.setPointerCapture(e.pointerId);
      element.addEventListener('pointermove', handlePointerMove);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary || !isDraggingRef.current) return;
      
      currentPosition.current = { x: e.clientX, y: e.clientY };
      
      const deltaX = Math.abs(e.clientX - startPosition.current.x);
      const deltaY = Math.abs(e.clientY - startPosition.current.y);
      
      if (deltaX > 3 || deltaY > 3) {
        hasMoved.current = true;
      }
      
      const pos = calculatePosition();
      
      const fabSize = 56;
      const minX = 0;
      const maxX = window.innerWidth - fabSize;
      const minY = 0;
      const maxY = window.innerHeight - fabSize;
      
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
      
      if (element) {
        element.style.willChange = 'auto';
      }
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      
      if (!hasMoved.current) {
        onClick();
        element.removeEventListener('pointermove', handlePointerMove);
        return;
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
      
      const fabSize = 56;
      const chatWidth = 480;
      const chatHeight = 600;
      const chatOffset = 68;
      
      const minX = chatWidth + chatOffset;
      const maxX = window.innerWidth - fabSize;
      const minY = chatHeight + chatOffset;
      const maxY = window.innerHeight - fabSize;
      
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
          const constrainedX = Math.max(minX, Math.min(maxX, originPosition.current.x));
          const constrainedY = Math.max(minY, Math.min(maxY, originPosition.current.y));
          
          originPosition.current = { x: constrainedX, y: constrainedY };
          setPosition({ x: constrainedX, y: constrainedY });
          
          if (elementRef.current) {
            elementRef.current.style.transform = `translate3d(${constrainedX}px, ${constrainedY}px, 0)`;
          }
          
          onPositionChange({ x: constrainedX, y: constrainedY });
          momentumAnimationRef.current = null;
          return;
        }
        
        const deltaX = (velocityX / 60) * deltaTime;
        const deltaY = (velocityY / 60) * deltaTime;
        
        let newX = originPosition.current.x + deltaX;
        let newY = originPosition.current.y + deltaY;
        
        if (newX < minX || newX > maxX) {
          newX = Math.max(minX, Math.min(maxX, newX));
          velocityX = 0;
        }
        
        if (newY < minY || newY > maxY) {
          newY = Math.max(minY, Math.min(maxY, newY));
          velocityY = 0;
        }
        
        originPosition.current = { x: newX, y: newY };
        
        if (elementRef.current) {
          elementRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
        
        if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
          momentumAnimationRef.current = requestAnimationFrame(applyMomentum);
        } else {
          momentumAnimationRef.current = null;
        }
      };
      
      if (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5) {
        momentumAnimationRef.current = requestAnimationFrame(applyMomentum);
      } else {
        const constrainedX = Math.max(minX, Math.min(maxX, finalPos.x));
        const constrainedY = Math.max(minY, Math.min(maxY, finalPos.y));
        
        originPosition.current = { x: constrainedX, y: constrainedY };
        setPosition({ x: constrainedX, y: constrainedY });
        
        if (elementRef.current) {
          elementRef.current.style.transform = `translate3d(${constrainedX}px, ${constrainedY}px, 0)`;
        }
        
        onPositionChange({ x: constrainedX, y: constrainedY });
      }
      
      element.removeEventListener('pointermove', handlePointerMove);
    };

    const releasePointer = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      element.releasePointerCapture(e.pointerId);
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointerup', releasePointer);
    element.addEventListener('pointercancel', releasePointer);
    element.addEventListener('lostpointercapture', cleanup);

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointerup', releasePointer);
      element.removeEventListener('pointercancel', releasePointer);
      element.removeEventListener('lostpointercapture', cleanup);
      element.removeEventListener('pointermove', handlePointerMove);
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
      }
    };
  }, [onPositionChange, visible]);

  if (!visible) return null;

  return (
    <div
      ref={elementRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        zIndex: 1300,
        touchAction: 'none',
        cursor: 'grab',
      }}
    >
      <Tooltip title="Grid Intelligence Assistant" placement="left">
        <Fab
          sx={{
            bgcolor: '#1E293B',
            border: '2px solid #0EA5E9',
            width: 56,
            height: 56,
            color: '#0EA5E9',
            cursor: 'inherit',
            pointerEvents: 'none',
            '&:hover': {
              bgcolor: '#0F172A',
              borderColor: '#0EA5E9',
              transform: 'scale(1.05)',
              boxShadow: '0 8px 24px rgba(14, 165, 233, 0.4)',
            },
            transition: 'all 0.2s ease-in-out',
          }}
        >
          <FluxLogo spinning={spinning} size={32} />
        </Fab>
      </Tooltip>
    </div>
  );
}
