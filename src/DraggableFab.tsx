import React, { useState } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
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

  const handleDrag = (_e: DraggableEvent, data: DraggableData) => {
    // Real-time position update during drag
    setPosition({ x: data.x, y: data.y });
  };

  const handleStop = (_e: DraggableEvent, data: DraggableData) => {
    // Constrain position to keep FAB + expanded chat within viewport
    const fabSize = 56;
    const chatWidth = 480;
    const chatHeight = 600;
    const chatOffset = 68; // Space between FAB and chat
    
    // Chat appears to the LEFT and ABOVE the FAB
    // Bounds calculation:
    // - minX: Chat must fit to the left (chatWidth + chatOffset from left edge)
    // - maxX: FAB must be visible (fabSize from right edge)
    // - minY: Chat must fit above (chatHeight + chatOffset from top edge)
    // - maxY: FAB must be visible (fabSize from bottom edge)
    const minX = chatWidth + chatOffset;
    const maxX = window.innerWidth - fabSize;
    const minY = chatHeight + chatOffset;
    const maxY = window.innerHeight - fabSize;
    
    const constrainedX = Math.max(minX, Math.min(maxX, data.x));
    const constrainedY = Math.max(minY, Math.min(maxY, data.y));
    
    const finalPos = { x: constrainedX, y: constrainedY };
    setPosition(finalPos);
    onPositionChange(finalPos);
  };

  if (!visible) return null;

  return (
    <Draggable
      position={position}
      onDrag={handleDrag}
      onStop={handleStop}
    >
      <Tooltip title="Grid Intelligence Assistant" placement="left">
        <Fab
          onClick={onClick}
          sx={{
            position: 'fixed',
            bgcolor: '#1E293B',
            border: '2px solid #0EA5E9',
            width: 56,
            height: 56,
            zIndex: 1300,
            color: '#0EA5E9',
            cursor: 'move',
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
    </Draggable>
  );
}
