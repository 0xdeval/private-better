import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const poseidonEntry = fileURLToPath(
  new URL('./node_modules/@railgun-community/poseidon-hash-wasm/index.mjs', import.meta.url),
);
const curve25519Entry = fileURLToPath(
  new URL(
    './node_modules/@railgun-community/curve25519-scalarmult-wasm/pkg-esm/curve25519_scalarmult_wasm.js',
    import.meta.url,
  ),
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
    conditions: ['browser', 'module', 'import', 'default'],
    dedupe: [
      'ethers',
      '@railgun-community/engine',
      '@railgun-community/shared-models',
      '@railgun-community/circomlibjs',
      '@railgun-community/ffjavascript',
    ],
    alias: {
      '@railgun-community/poseidon-hash-wasm': poseidonEntry,
      '@railgun-community/curve25519-scalarmult-wasm': curve25519Entry,
    },
  },
  optimizeDeps: {
    include: [
      'buffer',
      'process',
      'crypto-browserify',
      'stream-browserify',
      'browserify-zlib',
      '@railgun-community/wallet',
      '@railgun-community/engine',
      '@railgun-community/circomlibjs',
      '@railgun-community/circomlibjs/index.js',
      '@railgun-community/ffjavascript',
      '@railgun-community/ffjavascript/index.js',
    ],
    needsInterop: [
      '@railgun-community/circomlibjs',
      '@railgun-community/ffjavascript',
    ],
    exclude: [
      '@railgun-community/poseidon-hash-wasm',
      '@railgun-community/curve25519-scalarmult-wasm',
    ],
  },
  server: {
    port: 3017,
    strictPort: true,
  },
});
