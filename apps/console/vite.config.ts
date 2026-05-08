import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const hmrConfig = process.env.VITE_HMR_PORT
  ? { port: parseInt(process.env.VITE_HMR_PORT), clientPort: parseInt(process.env.VITE_HMR_PORT) }
  : undefined;

// Match any file under node_modules belonging to a given @object-ui/* package.
// pnpm flattens packages into paths like:
//   node_modules/.pnpm/@object-ui+core@4.0.3_.../node_modules/@object-ui/core/dist/...
//   node_modules/@object-ui/core/dist/...
const objectUiPkg = (name: string) => (id: string) =>
  id.includes(`/@object-ui/${name}/`) ||
  id.includes(`\\@object-ui\\${name}\\`) ||
  id.includes(`/@object-ui+${name}@`) ||
  id.includes(`\\@object-ui+${name}@`);

export default defineConfig({
  base: process.env.VITE_BASE || '/_console/',
  resolve: {
    dedupe: ['react', 'react-dom', 'lucide-react', 'react-router-dom', 'react-router'],
    alias: {
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, './node_modules/react-router-dom'),
      // Force a single lucide-react copy. @object-ui/app-shell pulls one
      // version while @object-ui/components and the plugins pull another —
      // letting both through produces duplicate icon chunks where one
      // references a stale `createLucideIcon` symbol from the main bundle
      // and crashes at runtime.
      'lucide-react': path.resolve(__dirname, './node_modules/lucide-react'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [react()],
  build: {
    target: 'esnext',
    sourcemap: false,
    cssCodeSplit: true,
    // Don't auto-emit `<link rel="modulepreload">` for every chunk; with
    // Vite-Rolldown's per-icon code splitting that would inject 1700+
    // preload tags into the HTML, defeating lazy loading.
    modulePreload: false,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        // Manual chunking ported from objectui/apps/console — the proven
        // shape that avoids per-leaf TDZ ("X is not a function") crashes
        // triggered by Vite-Rolldown's default dynamic-import splitting
        // against @object-ui's static+dynamic widget imports.
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-radix';
          }
          if (
            id.includes('node_modules/@objectstack/') ||
            id.includes('/@objectstack+') ||
            id.includes('\\@objectstack+')
          ) {
            return 'vendor-objectstack';
          }
          if (
            id.includes('node_modules/lucide-react/dist/lucide-react') ||
            id.includes('node_modules/lucide-react/dist/esm/Icon') ||
            id.includes('node_modules/lucide-react/dist/esm/createLucideIcon') ||
            id.includes('node_modules/lucide-react/dist/esm/defaultAttributes') ||
            id.includes('node_modules/lucide-react/dist/esm/shared')
          ) {
            return 'vendor-icons-core';
          }
          if (
            id.includes('node_modules/class-variance-authority/') ||
            id.includes('node_modules/clsx/') ||
            id.includes('node_modules/tailwind-merge/') ||
            id.includes('node_modules/sonner/')
          ) {
            return 'vendor-ui-utils';
          }
          if (id.includes('node_modules/zod/')) return 'vendor-zod';
          if (
            id.includes('node_modules/recharts/') ||
            id.includes('node_modules/d3-') ||
            id.includes('node_modules/victory-')
          ) {
            return 'vendor-charts';
          }
          if (id.includes('node_modules/@dnd-kit/')) return 'vendor-dndkit';
          if (
            id.includes('node_modules/i18next') ||
            id.includes('node_modules/react-i18next/')
          ) {
            return 'vendor-i18n';
          }
          // @object-ui framework: core + react + types
          if (objectUiPkg('core')(id) || objectUiPkg('react')(id) || objectUiPkg('types')(id)) {
            return 'framework';
          }
          if (objectUiPkg('components')(id) || objectUiPkg('fields')(id)) {
            return 'ui-components';
          }
          if (objectUiPkg('layout')(id)) return 'ui-layout';
          if (objectUiPkg('data-objectstack')(id)) return 'data-adapter';
          if (
            objectUiPkg('auth')(id) ||
            objectUiPkg('permissions')(id) ||
            objectUiPkg('tenant')(id) ||
            objectUiPkg('i18n')(id)
          ) {
            return 'infrastructure';
          }
          if (objectUiPkg('plugin-grid')(id)) return 'plugin-grid';
          if (objectUiPkg('plugin-form')(id)) return 'plugin-form';
          if (objectUiPkg('plugin-view')(id)) return 'plugin-view';
          if (
            objectUiPkg('plugin-detail')(id) ||
            objectUiPkg('plugin-list')(id) ||
            objectUiPkg('plugin-dashboard')(id) ||
            objectUiPkg('plugin-report')(id)
          ) {
            return 'plugins-views';
          }
          if (objectUiPkg('plugin-charts')(id)) return 'plugin-charts';
          if (objectUiPkg('plugin-calendar')(id)) return 'plugin-calendar';
          if (objectUiPkg('plugin-kanban')(id)) return 'plugin-kanban';
          if (objectUiPkg('plugin-chatbot')(id)) return 'plugin-chatbot';
          if (objectUiPkg('app-shell')(id)) return 'app-shell';
        },
      },
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5175'),
    hmr: hmrConfig,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/.well-known': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
