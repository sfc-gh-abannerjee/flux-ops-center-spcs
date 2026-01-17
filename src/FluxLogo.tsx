import React from 'react';
import { Box, keyframes } from '@mui/material';

const spinAnimation = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

interface FluxLogoProps {
  spinning?: boolean;
  size?: number;
}

// Performance: Use size-appropriate logo (10KB vs 1.4MB original)
export default function FluxLogo({ spinning = false, size = 28 }: FluxLogoProps) {
  // Select optimized image based on display size
  // flux-logo-64.png (10KB) for sizes ≤ 64px
  // flux-logo-128.png (32KB) for larger sizes
  const logoSrc = size <= 64 ? '/flux-logo-64.png' : '/flux-logo-128.png';
  
  return (
    <Box
      component="img"
      src={logoSrc}
      alt="Flux Logo"
      sx={{
        width: size,
        height: size,
        animation: spinning ? `${spinAnimation} 1s linear infinite` : 'none',
      }}
    />
  );
}
