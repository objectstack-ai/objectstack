/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `./zod` subpath is built as ONE module, and these are the properties of
 * `packages/types/vite.config.ts` that make that true (objectui#8598).
 *
 * ## Why the config and not the artifact
 *
 * The artifact assertion — "the shipped `dist/zod/index.zod.js` imports no
 * sibling category module" — lives in `zod-subpath-single-module-8598.dist.spec.tsx`,
 * in the `dist` project, because it needs the package BUILT. This file needs
 * nothing built, so it runs in `unit` on every pull request and catches the
 * edits that would break the build face before anyone runs it.
 *
 * ## What each assertion is protecting, in the order the damage gets worse
 *
 *  1. ⛔ `emptyOutDir: false`. `outDir` is inside the project root, so Vite's
 *     DEFAULT is to empty it — and by the time this config runs, `dist/` holds
 *     everything `tsc` just emitted for the whole package. ⚠️ What a flip costs
 *     is stated as measured, because this header used to overstate it
 *     (objectui#8712). On `2596b1b85`, `vite build --emptyOutDir` took `dist/`
 *     from 128 files to 89 — the whole loss inside `dist/zod/` (40 → 1),
 *     carrying the `./zod` typings and every per-category zod module. `outDir`
 *     is a SUBDIRECTORY, so what a flip empties is that directory, not the
 *     published package as a whole. `vite build` reports it as a success; the
 *     build script reds one step later, in `check:dist-completeness`. This
 *     assertion is what fails FIRST, in `unit`, before a build is ever run, and
 *     it is the assertion this file exists for.
 *  2. The entry is `src/zod/index.zod.ts` and the output lands on
 *     `dist/zod/index.zod.js`. Those two together are what makes this an
 *     IN-PLACE overwrite of one `tsc` output rather than a new published file:
 *     `exports['./zod'].import` already names that path, and
 *     `check:dist-completeness` counts it as one of `tsc`'s expected outputs.
 *     Move either and the package publishes a bundle nobody resolves while the
 *     barrel it was meant to replace ships unchanged — green, and inert.
 *  3. Exactly one format, `es`. A second format would write a second file into
 *     `dist/zod/`, which is not in `tsc`'s expected set and not in `exports`.
 *  4. Bare specifiers stay external. `zod` and `@objectstack/spec` are declared
 *     `dependencies`; inlining either would ship a second copy of zod inside a
 *     types package and break the identity `instanceof` checks a shared zod
 *     gives consumers.
 *
 * ⚠️ The config is IMPORTED, not read as text. A `toContain('emptyOutDir: false')`
 * is satisfied by the string appearing in a comment — which is the exact shape of
 * a setting somebody disabled and explained.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * `defineConfig` passes an object literal straight through, so what is imported
 * below is the config itself. Vite's own `BuildOptions` types every field as
 * optional, which would make each assertion read through a `?.` and pass on
 * `undefined` — so the shape is spelled here as what this config MUST declare.
 */
interface ZodBundleBuild {
  outDir: string;
  emptyOutDir: boolean;
  lib: { entry: string; formats: string[]; fileName: (format: string) => string };
  rollupOptions: { external: (id: string) => boolean };
}

/**
 * ⚠️ The specifier is held in a variable, and that is load-bearing rather than
 * stylistic — the same mechanism `page-header-action-ids.dist.spec.tsx` uses,
 * for a second reason on top of its one.
 *
 * A LITERAL specifier puts `vite.config.ts` into this package's type program:
 * `tsconfig.test.json` compiles every `src/**` test (deliberately — see its
 * header), and an import pulls its target in with it. That config imports
 * `scripts/vitest-invocation-guard.mjs`, which ships no typings anywhere in this
 * repo, so `pnpm --filter @object-ui/types type-check` fails with TS7016 —
 * measured, not predicted. No other package hits it because no other package's
 * checked program has ever imported a `vite.config.ts`.
 *
 * ⛔ The alternatives were weighed and rejected: reading the config as TEXT is
 * the `toContain` weakness this file's header exists to refuse; a
 * `@ts-expect-error` suppresses a real diagnostic; and a repo-wide `.d.mts` for
 * the guard is a change to a file 24 vite configs share, for one test's benefit.
 * TypeScript cannot resolve a non-literal specifier, so the config stays out of
 * the type program while the RUNTIME import — and every assertion below — is
 * exactly as strong as before.
 *
 * ⚠️ ⭐ IMPORTING THE CONFIG RUNS ITS GUARD, and that is worth stating because the
 * same gate went on to break CI. `vite.config.ts` opens with
 * `if (process.env.VITEST) { assertCanonicalVitestInvocation(...) }`, and vitest
 * sets `VITEST`, so the import below WOULD execute that guard — judging the
 * WORKER's argv and cwd, never the invocation's. Under a repo-root run those
 * coincide and it passes. Under the package-level `test` script objectui#8590
 * added, they do not: the worker's `process.argv` carries no `--root` and its
 * cwd is `packages/types`, so the guard returns `package-cwd` and its
 * `process.exit(1)` takes this file's five cases out of a run that had already
 * passed 3298 of them. ⛔ This header used to record that refusal as "correct,
 * and loudly" — written when no canonical invocation stood in this directory.
 * objectui#8590 gave it one, and the sentence is retired with this comment.
 *
 * So the import below scrubs `VITEST` for its own duration and restores it. That
 * is the objectui#8598 repair in the same shape and for the same reason: the
 * CALLER is the only place that knows its callee is a config read rather than a
 * test run, so that is where the truth about it belongs. Every assertion below
 * still runs against the real imported config, so no coverage moves.
 * ⛔ Not repaired by loosening the gate in the config: that would diverge 1 of 24
 * identical guard blocks, and `scripts/__tests__/vitest-invocation-guard.test.ts`
 * refuses the divergence mechanically. ⛔ Nor by `OBJECTUI_VITEST_GUARD=off`,
 * which stands the guard down instead of telling it the truth about one call.
 *
 * The harmful face of the same class is objectui#8598's `Test (shard 2/4)`
 * failure: `VITEST` is inherited by CHILD processes too, so a test that spawns
 * `pnpm --filter PKG run build` handed the same guard a cwd of `packages/PKG`
 * and it killed the build before the bundler started. The repair landed at the
 * spawn (`BUILD_ENV` in `packages/cli/src/__tests__/cli-bin.test.ts`) and is
 * kept there by `scripts/__tests__/spawned-build-vitest-env-8598.test.ts`.
 */
const CONFIG_SPECIFIER = '../../vite.config.ts';
const viteConfig = await (async () => {
  const inherited = process.env.VITEST;
  delete process.env.VITEST;
  try {
    return ((await import(CONFIG_SPECIFIER)) as { default?: { build?: Partial<ZodBundleBuild> } })
      .default;
  } finally {
    if (inherited === undefined) delete process.env.VITEST;
    else process.env.VITEST = inherited;
  }
})();

const build = (viteConfig?.build ?? {}) as ZodBundleBuild;

describe('objectui#8598 — the `./zod` subpath build config', () => {
  it('reads a real config — an empty object would satisfy every negative below', () => {
    // Non-vacuity. Every assertion in this file is about `build`, so a config
    // that failed to load and left `{}` behind would pass the `toBe(false)` and
    // `toEqual([...])` cases by having nothing to judge.
    expect(Object.keys(build).length).toBeGreaterThan(0);
    expect(build.lib).toBeTruthy();
  });

  it('⛔ never empties the out dir — `dist/` holds the whole published package by then', () => {
    expect(
      build.emptyOutDir,
      '`outDir` is inside the project root, so Vite empties it by DEFAULT — and `tsc` has ' +
        'already written all of `dist/` when this build runs. A flip deletes everything in ' +
        '`dist/zod/`, the `./zod` typings included, and `vite build` reports that as a ' +
        'success; the build only reds one step later, in `check:dist-completeness`.',
    ).toBe(false);
  });

  it('overwrites `dist/zod/index.zod.js` in place, from `src/zod/index.zod.ts`', () => {
    expect(path.resolve(build.lib.entry)).toBe(
      path.join(PACKAGE_DIR, 'src', 'zod', 'index.zod.ts'),
    );
    expect(path.resolve(build.outDir)).toBe(path.join(PACKAGE_DIR, 'dist', 'zod'));
    expect(build.lib.fileName('es')).toBe('index.zod.js');
  });

  it('emits exactly one format, `es`', () => {
    expect(build.lib.formats).toEqual(['es']);
  });

  it('keeps every bare specifier external', () => {
    const { external } = build.rollupOptions;
    // Declared `dependencies` — resolved by the consumer, never inlined.
    expect(external('zod')).toBe(true);
    expect(external('@objectstack/spec')).toBe(true);
    // ...and the package's own sources are the thing being bundled. Both
    // spellings a module graph produces reach this predicate.
    expect(external('./layout.zod.js')).toBe(false);
    expect(external(path.join(PACKAGE_DIR, 'src/zod/layout.zod.ts'))).toBe(false);
  });
});
