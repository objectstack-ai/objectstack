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
import { dirname, join, relative } from 'node:path';

/**
 * This package is CJS-typed (no `"type": "module"` — it publishes
 * `dist/index.js` as CommonJS), so `module: NodeNext` forbids `import.meta`
 * here. Walk up from the CWD instead, which works wherever vitest is invoked
 * from.
 */
function findUp(predicate: (dir: string) => boolean, what: string): string {
  let dir = process.cwd();
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${what}`);
    dir = parent;
  }
}

const PKG = findUp((dir) => {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  return name === '@objectstack/plugin-auth';
}, 'the @objectstack/plugin-auth package root');

const REPO = findUp(
  (dir) => existsSync(join(dir, 'pnpm-workspace.yaml')),
  'the workspace root (pnpm-workspace.yaml)',
);

const SRC = join(PKG, 'src');

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
    const roots = ['packages/runtime/src', 'packages/services/service-sms/src'];
    const offenders: string[] = [];
    for (const root of roots) {
      const abs = join(REPO, root);
      expect(existsSync(abs), `${root} — consumer directory moved; re-point this check`).toBe(true);
      for (const entry of readdirSync(abs, { recursive: true, withFileTypes: true })) {
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
