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
 * So the declaration pass runs once, for ESM only, and the CommonJS
 * `index.d.cts` is a one-line re-export of `index.d.ts`: each condition is
 * still handed a declaration of its own module kind (attw: no `FalseESM`), but
 * every class in both IS the `.d.ts` one, and what that declaration imports
 * from `@objectstack/spec` resolves exactly as it did when both conditions
 * read the `.d.ts`. ⛔ Not the other way round: with the declarations in the
 * `.d.cts` and the `.d.ts` re-exporting it, core's own imports of spec resolve
 * through spec's `require` condition, and spec's twin declarations then fail
 * `@objectstack/driver-memory`'s build (TS2345, `ComposedReadableIds` against
 * itself). The `.d.cts` → `.d.ts` re-export is TS1479 inside this package's
 * file for a consumer on `module: node16` (or on TypeScript 5.6 under
 * `nodenext`), which `skipLibCheck` silences; the single `types` entry this
 * replaces raised that same TS1479 at the consumer's own import, where no
 * option silences it.
 *
 * The JS half's `onSuccess` writes the `.d.cts` files and the declaration half
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
            ENTRY_NAMES.map((name) => writeFile(`dist/${name}.d.cts`, `export * from './${name}.js';\n`)),
          );
        }
      : undefined,
  },
  ...(emitDts ? [{ ...shared, clean: false, dts: { only: true }, format: ['esm'] } satisfies Options] : []),
]);
