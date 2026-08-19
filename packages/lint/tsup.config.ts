import { defineConfig } from 'tsup';

/**
 * Package-local config (#4463): `@objectstack/lint` ships TWO entries, so it
 * cannot use the repo-root `tsup.config.ts` (single `src/index.ts`).
 *
 * - `index` — the full authoring surface, used by the CLI.
 * - `runtime` — the narrowed subset the metadata write path imports. It is a
 *   separate entry so that surface can be PINNED (`authoring-rule-wiring.test.ts`
 *   fails if the kernel gate imports the root barrel instead), not because it is
 *   lighter. `splitting: false` emits each entry self-contained, and measured
 *   `dist/runtime.js` is 93.8% of `dist/index.js` and does name the react/jsx
 *   rules' modules. `src/runtime.ts`'s header carries the measurement.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/runtime.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
});
