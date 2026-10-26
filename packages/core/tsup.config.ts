import { writeFile } from 'node:fs/promises';

import { defineConfig, type Options } from 'tsup';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

/**
 * `@objectstack/core` ships two entry points:
 * - `index.ts` — full microkernel (Node-only; pulls in plugin sandbox,
 *   filesystem helpers, etc).
 * - `logger.ts` — tiny browser-safe logger reused by `@objectstack/client`
 *   so importing the client SDK in a browser bundle does NOT drag in
 *   Node-only kernel internals (e.g. `process.cpuUsage()`).
 */
const ENTRY_NAMES = ['index', 'logger'] as const;
const emitDts = !process.env.OS_SKIP_DTS;

const shared: Options = {
  entry: ENTRY_NAMES.map((name) => `src/${name}.ts`),
  splitting: false,
  sourcemap: true,
  target: 'es2020',
  esbuildOptions: dropSourcesContent,
};

/**
 * ONE declaration per entry, shared by both formats.
 *
 * tsup's own `dts` emits a declaration per FORMAT — `index.d.ts` beside the ESM
 * build and `index.d.cts` beside the CJS one — and those are two separate
 * declarations of every class. TypeScript compares a class with a `private`
 * member nominally, so `ObjectKernel` (which carries `private plugins` and
 * reaches every plugin through `PluginContext.getKernel()`) becomes two
 * incompatible types for any compilation that reaches core through both
 * resolution modes, the moment the export map serves each format its own
 * declaration. Measured: per-condition `types` over the twin declarations
 * fail `pnpm --filter @objectstack/plugin-dev build` with TS2345 in
 * `src/dev-plugin.ts` (its CommonJS build `await import()`s
 * `@objectstack/objectql`, which reaches core the other way).
 *
 * So the declaration pass runs once, for CJS only, and the ESM `index.d.ts` is
 * a one-line re-export of `index.d.cts`: each condition is still handed a
 * declaration of its own module kind (attw: no `FalseESM`, no `FalseCJS`),
 * but every class in both IS the `.d.cts` one. The re-export runs ESM → CJS on
 * purpose: an ES module may import a CommonJS one under every `module`
 * setting, while the reverse (`.d.cts` re-exporting `.d.ts`) is TS1479 in a
 * consumer's program: measured under `module: node16` on TypeScript 6.0 and
 * 5.6, and under `nodenext` too on 5.6.
 *
 * The JS half's `onSuccess` writes the `.d.ts` files and the declaration half
 * never emits one, so the two halves (which tsup runs concurrently) never
 * write the same file. `clean` lives on the JS half only: tsup's clean keeps
 * declaration files, so it cannot delete what the declaration half writes.
 */
export default defineConfig([
  {
    ...shared,
    clean: true,
    dts: false,
    format: ['esm', 'cjs'],
    onSuccess: emitDts
      ? async () => {
          await Promise.all(
            ENTRY_NAMES.map((name) => writeFile(`dist/${name}.d.ts`, `export * from './${name}.cjs';\n`)),
          );
        }
      : undefined,
  },
  ...(emitDts ? [{ ...shared, clean: false, dts: { only: true }, format: ['cjs'] } satisfies Options] : []),
]);
