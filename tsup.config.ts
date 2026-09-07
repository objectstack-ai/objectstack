import { defineConfig } from 'tsup';

import { dropSourcesContent } from './scripts/tsup-drop-sources-content.mjs';

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  esbuildOptions: dropSourcesContent,
});
