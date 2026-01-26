import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8081,
    host: true,
    proxy: {
      '/api/agent/stream': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            proxyReq.setHeader('Accept', 'text/event-stream');
          });
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
            proxyRes.headers['x-accel-buffering'] = 'no';
            proxyRes.headers['connection'] = 'keep-alive';
            res.flushHeaders();
          });
        }
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: [
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/react',
      '@deck.gl/extensions',
      '@deck.gl/geo-layers',
      '@deck.gl/aggregation-layers',
      'maplibre-gl'
    ]
  },
  build: {
    // Performance: Manual chunk splitting for optimal loading
    // Separates vendor code from application code for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React - rarely changes, cached long-term
          'vendor-react': ['react', 'react-dom'],
          // Mapping libraries - large but stable
          'vendor-maplibre': ['maplibre-gl'],
          // deck.gl ecosystem - core visualization engine
          // NOTE: Do NOT include @loaders.gl here - it has circular deps that break when chunked
          'vendor-deckgl': [
            '@deck.gl/core',
            '@deck.gl/layers',
            '@deck.gl/react',
            '@deck.gl/geo-layers',
            '@deck.gl/aggregation-layers',
            '@deck.gl/mesh-layers',
            '@deck.gl/extensions'
          ],
          // Charting - lazy loaded with ChatDrawer
          'vendor-charts': ['vega', 'vega-lite', 'vega-embed', 'react-vega'],
          // Markdown rendering - lazy loaded with ChatDrawer
          'vendor-markdown': ['react-markdown']
        }
      }
    },
    // Increase warning limit since we're deliberately chunking
    chunkSizeWarningLimit: 800
  }
});
