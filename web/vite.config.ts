import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  // Routes are lazy (see App.tsx), so the editor, markdown and face-detection code are
  // split out naturally and only downloaded by the pages that use them.
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep CodeMirror in its own chunk (only editor pages need it). Match its packages
        // precisely: pulling shared helpers in would make the main bundle preload it.
        // React gets its own chunk first; otherwise Rollup would pull it (a dependency of the
        // CodeMirror wrapper) into the editor chunk and every page would download the editor.
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)\//.test(id)) return 'react';
          // Core editor only; each language grammar stays in its own lazily loaded chunk.
          if (/node_modules\/(@codemirror\/(state|view|commands|language|autocomplete|lint|search|theme-one-dark)|@lezer\/(common|highlight|lr)|@uiw|style-mod|w3c-keyname|crelt)\//.test(id)) return 'codemirror';
          return undefined;
        },
      },
    },
  },
});
