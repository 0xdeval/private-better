import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const libsodiumWrappersCjs = fileURLToPath(
  new URL('./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js', import.meta.url),
);

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: [
        'assert',
        'buffer',
        'crypto',
        'events',
        'http',
        'https',
        'os',
        'path',
        'process',
        'stream',
        'url',
        'util',
        'vm',
        'zlib',
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      'libsodium-wrappers': libsodiumWrappersCjs,
    },
  },
  worker: {
    format: 'es',
    plugins: () => [],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ['bn.js', 'eventemitter3'],
    needsInterop: ['bn.js', 'eventemitter3'],
    esbuildOptions: {
      target: 'ES2022',
    },
  },
  server: {
    port: 3017,
    strictPort: true,
  },
});
