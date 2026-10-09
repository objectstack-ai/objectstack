import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

/**
 * Package-local config (#4463): `@objectstack/lint` ships THREE entries, so it
 * cannot use the repo-root `tsup.config.ts` (single `src/index.ts`).
 *
 * - `index` — the full authoring surface, used by the CLI.
 * - `runtime` — the narrowed subset the metadata write path imports. It is a
 *   separate entry so that surface can be PINNED (`authoring-rule-wiring.test.ts`
 *   fails if the kernel gate imports the root barrel instead), not because it is
 *   lighter. `splitting: false` emits each entry self-contained, and measured
 *   `dist/runtime.js` is 93.8% of `dist/index.js` and does name the react/jsx
 *   rules' modules. `src/runtime.ts`'s header carries the measurement.
 * - `rule-explanations` — the long-form rule explanations alone (#22161),
 *   which the CLI's finding printer reads on every command that prints a
 *   finding. That printer is no rule-engine import, and this entry is what
 *   keeps it one: the module imports nothing (its header says why).
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/runtime.ts', 'src/rule-explanations.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  esbuildOptions: dropSourcesContent,
});
