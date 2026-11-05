import { defineConfig } from 'vite'

// Builds quicklook/render.ts into one self-contained script for JavaScriptCore.
export default defineConfig({
  // The "worker" condition picks DOM-free builds of dependencies.
  resolve: { conditions: ['worker', 'module', 'import', 'default'] },
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,
  build: {
    lib: {
      entry: new URL('./render.ts', import.meta.url).pathname,
      formats: ['iife'],
      name: 'MDLRender',
      fileName: () => 'render.js',
    },
    outDir: new URL('./build/resources', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'safari15',
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
})
