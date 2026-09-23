import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('/node_modules/three/examples/')) return 'three-addons';
          if (id.includes('/node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
