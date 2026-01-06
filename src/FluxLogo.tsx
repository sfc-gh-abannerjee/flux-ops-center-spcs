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

export default function FluxLogo({ spinning = false, size = 28 }: FluxLogoProps) {
  return (
    <Box
      component="img"
      src="/flux-logo.png"
      alt="Flux Logo"
      sx={{
        width: size,
        height: size,
        animation: spinning ? `${spinAnimation} 1s linear infinite` : 'none',
      }}
    />
  );
}
