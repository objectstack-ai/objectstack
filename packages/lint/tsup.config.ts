import { defineConfig } from 'tsup';

/**
 * Package-local config (#4463): `@objectstack/lint` ships TWO entries, so it
 * cannot use the repo-root `tsup.config.ts` (single `src/index.ts`).
 *
 * - `index` — the full authoring surface, used by the CLI.
 * - `runtime` — the kernel-safe subset the metadata write path imports. Kept a
 *   separate entry so a consumer on the boot path never even names the module
 *   graph that reaches the react/jsx source parsers.
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
