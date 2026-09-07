import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

/**
 * `@objectstack/core` ships two entry points:
 * - `index.ts` — full microkernel (Node-only; pulls in plugin sandbox,
 *   filesystem helpers, etc).
 * - `logger.ts` — tiny browser-safe logger reused by `@objectstack/client`
 *   so importing the client SDK in a browser bundle does NOT drag in
 *   Node-only kernel internals (e.g. `process.cpuUsage()`).
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/logger.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  esbuildOptions: dropSourcesContent,
});
