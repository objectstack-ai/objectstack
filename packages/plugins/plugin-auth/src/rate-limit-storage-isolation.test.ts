// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6040 — the `./rate-limit-storage` subpath entry must stay free of the
 * better-auth family at RUNTIME.
 *
 * `rate-limit-storage.ts` is the repo's one fixed-window counter (ADR-0069 D2,
 * #4790). Three packages outside auth count through it — `@objectstack/runtime`
 * (`security/inbound-rate-limit.ts`, `endpoint-policy.ts`,
 * `dispatcher-plugin.ts`) and `@objectstack/service-sms` (`sms-plugin.ts`,
 * `sms-daily-quota.ts`) — and until #6040 they could only reach it through the
 * package root, whose `export *` chain takes **value** imports on
 * `better-auth/adapters` and `@better-auth/core/db`. Importing 90 lines of
 * counting therefore eagerly evaluated `better-auth` +
 * `@better-auth/{core,oauth-provider,scim,sso}` + `jose` + `@noble/hashes` +
 * `@objectstack/rest` + `@objectstack/platform-objects`.
 *
 * That is now a packaging invariant, and an invariant nobody checks is a
 * comment. The regression it guards is silent: someone adds one convenient
 * import to this module — `@objectstack/rest` for an error type, a better-auth
 * helper, anything — every existing test still passes, the counter still
 * counts, and the whole family quietly comes back into `service-sms`'s load
 * graph. Nothing in the build, the type-check or the unit suites can see it.
 *
 * So this walks the real import graph from `src/rate-limit-storage.ts` and
 * pins the external surface it is allowed to reach.
 *
 * Deliberately a SOURCE-level scan rather than a probe of `dist/`. A gate that
 * reads build output passes or fails by local build state, which is exactly the
 * boundary `scripts/check-published-files.mjs` states for itself ("it does not
 * exist in a fresh checkout … a gate that passes or fails by accident is worse
 * than one with a stated boundary"). The dist-level reading is real but
 * one-shot, and it is recorded in the PR: after `pnpm --filter
 * @objectstack/plugin-auth build`, `dist/rate-limit-storage.mjs` is 3.71 KB
 * against `dist/index.mjs`'s 330.28 KB, and a `node -e "import(…)"` subprocess
 * loads zero better-auth modules.
 *
 * Same shape as `packages/types/src/node-isolation.test.ts` (#4700), which pins
 * the identical class of invariant for the `./node` subpath.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Seeded from `__dirname`, not from a `findUp` walk of `process.cwd()`, and not
 * from `dirname(fileURLToPath(import.meta.url))`. Both halves of that choice are
 * load-bearing — the same pair `managed-extension-fields.test.ts` and
 * `platform-objects/src/managed-api-method-affordance-sweep.test.ts` state for
 * their sibling repo-wide walks:
 *
 *  - `import.meta` is a TS1470 here. This package is CJS-typed (no
 *    `"type": "module"` — it publishes `dist/index.js` as CommonJS), so under
 *    `module: NodeNext` the meta-property is an error however well it runs under
 *    vitest, and this package's test layer IS in front of tsc through the
 *    `@objectstack/plugin-auth` TEST_DEBT entry in `check-type-check-coverage.mjs`.
 *    `__dirname` type-checks under the package's own config and is defined at
 *    runtime by vitest's transform.
 *  - `check:cross-package-test-inputs` detects an escaping read STATICALLY, by
 *    resolving the seed expression. A `findUp` walk from `process.cwd()` is not a
 *    spelling it resolves — `process.cwd()` appears nowhere in that detector — so
 *    the two cross-package directory reads at the bottom of this file yielded no
 *    flag and therefore no declaration, SILENTLY. Measured before this change:
 *    `--list-escapes` named only `managed-extension-fields.test.ts` for
 *    plugin-auth, and `@objectstack/plugin-auth#test`'s turbo input hash
 *    (`1bf3935543ab055b`) did not move when `packages/runtime/src` changed — so a
 *    runtime-only diff that reinstated the package-root import replayed a cached
 *    green over the very scan that catches it (#7802's shape, #10029).
 *
 * Deriving the roots any other way puts this file back in that blind spot.
 */
const HERE = __dirname;
/** …/packages/plugins/plugin-auth/src → the package root, then the repo root. */
const PKG = resolve(HERE, '..');
const REPO = resolve(HERE, '../../../..');

const SRC = HERE;

/**
 * The two consumer packages the root-import scan at the bottom of this file
 * walks. Bound here, by name, so the gate can ROSTER them: these two paths are
 * `@objectstack/plugin-auth`'s declared cross-package radius in
 * `scripts/check-cross-package-test-inputs.mjs`, and the matching
 * `$TURBO_ROOT$` entries under `@objectstack/plugin-auth#test` in `turbo.json`
 * are what make this task's cache hash move when either directory changes.
 */
const RUNTIME_SRC = resolve(REPO, 'packages/runtime/src');
const SERVICE_SMS_SRC = resolve(REPO, 'packages/services/service-sms/src');

/**
 * Strip comments before scanning. The distinction this file turns on — a
 * `import type` versus a value `import` of the same specifier — is invisible to
 * a raw-text regex the moment a doc comment quotes an import line, and this
 * module's own header quotes several. Handles `//`, block comments and the
 * three string forms so a `'http://…'` literal is not mistaken for a comment.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += src[i]! + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

interface Ref {
  spec: string;
  /** `import type … from` / `export type … from` — erased at build, costs nothing at runtime. */
  typeOnly: boolean;
}

/** `import|export … from 'x'`, bare `import 'x'`, and `await import('x')`. */
const FROM = /(?:^|[\n;}])\s*(?:import|export)\b([^'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT = /(?:^|[\n;}])\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function refsOf(file: string): Ref[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const out: Ref[] = [];
  for (const m of src.matchAll(FROM)) {
    out.push({ spec: m[2]!, typeOnly: /^\s*type\b/.test(m[1]!) });
  }
  // A side-effect import and a dynamic import are always value loads.
  for (const m of src.matchAll(SIDE_EFFECT)) out.push({ spec: m[1]!, typeOnly: false });
  for (const m of src.matchAll(DYNAMIC)) out.push({ spec: m[1]!, typeOnly: false });
  return out;
}

/** Resolve a relative TS import (`./x.js` → `src/x.ts`). */
function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = join(dirname(fromFile), spec);
  for (const cand of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

/**
 * Every source file reachable from an entry, following relative imports —
 * type-only relative hops included, because a `.ts` file reached only by a type
 * import can still carry value imports of its own.
 */
function reachableFrom(entry: string): Map<string, Ref[]> {
  const seen = new Map<string, Ref[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const refs = refsOf(file);
    seen.set(file, refs);
    for (const ref of refs) {
      if (!ref.spec.startsWith('.')) continue;
      const next = resolveRelative(file, ref.spec);
      if (next) queue.push(next);
    }
  }
  return seen;
}

const isBetterAuth = (spec: string): boolean =>
  spec === 'better-auth' ||
  spec.startsWith('better-auth/') ||
  spec === '@better-auth/core' ||
  spec.startsWith('@better-auth/');

/**
 * The complete set of packages `./rate-limit-storage` may reach, and how.
 *
 * An allowlist rather than a better-auth denylist on purpose: the expensive
 * import is not necessarily spelled `better-auth`. `@objectstack/rest` and
 * `@objectstack/platform-objects` both drag the family in transitively, and a
 * denylist would wave either through. Anything new here is a deliberate
 * decision that has to be written down — including its runtime cost.
 */
const ALLOWED_EXTERNAL: ReadonlyArray<{ spec: string; typeOnly: boolean }> = [
  // Type-only: `BetterAuthRateLimitStorage` is the shape
  // `createLazyCacheRateLimitStorage` returns for better-auth's
  // `rateLimit.customStorage`. `import type` is erased at build, so it costs a
  // consumer nothing at runtime — which is the whole reason this entry can be
  // split out while still typing better-auth's seam.
  { spec: '@better-auth/core', typeOnly: true },
];

describe('@objectstack/plugin-auth — ./rate-limit-storage stays free of better-auth (#6040)', () => {
  it('nothing reachable from the subpath entry VALUE-imports better-auth', () => {
    const graph = reachableFrom(join(SRC, 'rate-limit-storage.ts'));
    const offenders: string[] = [];
    for (const [file, refs] of graph) {
      for (const ref of refs) {
        if (isBetterAuth(ref.spec) && !ref.typeOnly) {
          offenders.push(`${relative(PKG, file)} -> ${ref.spec}`);
        }
      }
    }
    expect(
      offenders,
      'The ./rate-limit-storage entry exists so @objectstack/runtime and ' +
        '@objectstack/service-sms can use the ~90-line fixed-window counter without ' +
        'eagerly loading better-auth + @better-auth/* + jose + @noble/hashes. A value ' +
        'import (anything but `import type`) re-couples them. Keep better-auth types ' +
        'type-only, and put anything that needs the runtime in a root-only module.',
    ).toEqual([]);
  });

  it('the subpath entry reaches exactly the external packages it declares', () => {
    const graph = reachableFrom(join(SRC, 'rate-limit-storage.ts'));
    const actual = new Map<string, boolean>();
    for (const refs of graph.values()) {
      for (const ref of refs) {
        if (ref.spec.startsWith('.') || ref.spec.startsWith('node:')) continue;
        // A specifier imported both ways is a value import.
        actual.set(ref.spec, (actual.get(ref.spec) ?? true) && ref.typeOnly);
      }
    }
    const sort = (a: { spec: string }, b: { spec: string }): number => a.spec.localeCompare(b.spec);
    expect(
      [...actual].map(([spec, typeOnly]) => ({ spec, typeOnly })).sort(sort),
      'A new external import on this entry is a new runtime dependency for every ' +
        'consumer of the subpath — including the transitive better-auth pull that ' +
        '@objectstack/rest and @objectstack/platform-objects carry. Add it to ' +
        'ALLOWED_EXTERNAL only with its cost written down.',
    ).toEqual([...ALLOWED_EXTERNAL].sort(sort));
  });

  it('the ROOT entry really does value-import better-auth — otherwise this suite proves nothing', () => {
    // Guards against the vacuous pass: if the root ever stopped pulling
    // better-auth eagerly, the two cases above would go green for the wrong
    // reason and the subpath split would look justified when it no longer was.
    const graph = reachableFrom(join(SRC, 'index.ts'));
    const rootValueImports = new Set<string>();
    for (const refs of graph.values()) {
      for (const ref of refs) if (isBetterAuth(ref.spec) && !ref.typeOnly) rootValueImports.add(ref.spec);
    }
    expect(
      [...rootValueImports].sort(),
      'The root no longer eagerly loads better-auth. That is good news, but it means ' +
        'the ./rate-limit-storage split may have stopped buying anything — re-measure ' +
        'before trusting the cases above.',
    ).toContain('better-auth/adapters');
  });

  it('package.json publishes the ./rate-limit-storage subpath', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>;
      files?: string[];
    };
    expect(Object.keys(pkg.exports)).toContain('./rate-limit-storage');
    expect(pkg.exports['./rate-limit-storage']).toEqual({
      // `types` first: conditions are first-match-wins, so a `types` key behind
      // `import`/`require` is only ever read by accident. 84 of the 85 exports
      // conditions on main are written this way.
      types: './dist/rate-limit-storage.d.ts',
      import: './dist/rate-limit-storage.mjs',
      require: './dist/rate-limit-storage.js',
    });
    // `check:published-files` SUFFICIENT covers this too; pinned here so the
    // entry cannot be declared and then left out of the published whitelist.
    expect(pkg.files).toContain('dist');
  });

  it('no cross-package consumer reaches the counter through the package ROOT', () => {
    // The other half of the invariant. Switching an import back to
    // `@objectstack/plugin-auth` costs nothing visible — it type-checks, it
    // tests green, it just silently reinstates the whole better-auth load for
    // that package. Scanned by directory rather than by filename so moving a
    // consumer file does not quietly retire the check.
    const COUNTER_SYMBOLS = /\b(incrementFixedWindow|createLazyCounterStore|InProcessCounterStore|CounterStore|FixedWindowCount|LazyCounterStoreOptions)\b/;
    // Each root is bound by NAME above and handed to `readdirSync` by that name,
    // rather than looped over as `join(REPO, root)` with `root` an array element.
    // That is not a style preference: `check:cross-package-test-inputs` learns a
    // DIRECTORY input only when a directory-read consumes an expression it can
    // resolve, and its own header lists "a directory read whose path is only a
    // loop variable" among the shapes that yield no name. Written as a loop the
    // two globs below would be declared but UNHELD — nothing would fail if a
    // later edit deleted them, which is the #9763 failure mode (prose holding a
    // radius) one level up. Written this way the gate rosters both directories
    // and fails if the declaration stops covering them.
    expect(
      existsSync(RUNTIME_SRC),
      'packages/runtime/src — consumer directory moved; re-point this check',
    ).toBe(true);
    expect(
      existsSync(SERVICE_SMS_SRC),
      'packages/services/service-sms/src — consumer directory moved; re-point this check',
    ).toBe(true);
    const offenders: string[] = [];
    const trees = [
      readdirSync(RUNTIME_SRC, { recursive: true, withFileTypes: true }),
      readdirSync(SERVICE_SMS_SRC, { recursive: true, withFileTypes: true }),
    ];
    for (const entries of trees) {
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const file = join(entry.parentPath, entry.name);
        for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(FROM)) {
          if (m[2] !== '@objectstack/plugin-auth') continue;
          if (COUNTER_SYMBOLS.test(m[1]!)) {
            offenders.push(`${relative(REPO, file)} -> ${m[1]!.trim()} from the package root`);
          }
        }
      }
    }
    expect(
      offenders,
      'Import the counter from "@objectstack/plugin-auth/rate-limit-storage". Reaching ' +
        'it through the package root pulls better-auth + @better-auth/* + jose + ' +
        '@noble/hashes into this package for ~90 lines of counting (#6040).',
    ).toEqual([]);
  });
});
