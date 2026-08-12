// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConnector as fromPackageRoot } from '@objectstack/spec';
import { defineConnector as fromNamespace } from '@objectstack/spec/integration';

// This import is the TYPE-axis half of the pin, and it is load-bearing as
// written — see the `tsc` block at the bottom of this file for why a LITERAL
// specifier is the whole point. `@objectstack/spec/conversions` exists in the
// source tree and is deliberately absent from spec's `exports` map, so `tsc`
// can only reach it through the `paths` block in `tsconfig.json`. Delete or
// misspell that block and this line is `TS2307: Cannot find module`.
import type { ConversionNotice } from '@objectstack/spec/conversions';

/** Re-exported so the type-only import above can never read as unused. */
export type ConversionsReachableFromSource = ConversionNotice;

// NOT frozen fixture material (see README) — these cases assert something
// about the HARNESS, not about the consumer contract: that `contract.test.ts`
// renders a verdict about `packages/spec/src`, the spec in this checkout, and
// not about `packages/spec/dist`, a build artifact.
//
// #7991 is why. This package shipped no vitest config, so every
// `@objectstack/spec` import resolved through `exports` to `dist/`. Measured,
// direction predicted before running: with a required field injected into
// `ConnectorSchema` in SOURCE only and no rebuild — a break the frozen
// `DcConnector` fixture cannot parse — the suite still reported **14/14 pass**;
// aliased to source, the identical tree reported **1 failed / 13 passed**,
// naming the injected field. The gate whose entire job is to notice breaking
// spec changes did not notice one, while its green was being consumed as
// evidence of backward compatibility.
//
// `pnpm check:test-source-alias` asserts the same invariant STATICALLY, by
// simulating Vite's resolution over `vitest.config.ts`. These cases assert it
// DYNAMICALLY, on the resolution the suite next to them actually performs. The
// gap between "the config looks right" and "the import landed on source" is the
// entire subject of this card, so it is worth pinning on both sides.
describe('the contract suite reads spec SOURCE, not spec dist (#7991)', () => {
  it('resolves a namespace that the published `exports` map does not publish', async () => {
    // `packages/spec/src/conversions/` exists in the source tree and is
    // deliberately absent from spec's `exports` map, so this specifier can
    // resolve ONLY through the source alias — through `exports` (i.e. dist) it
    // is `ERR_PACKAGE_PATH_NOT_EXPORTED`. That asymmetry is what makes this a
    // real discriminator rather than a check that passes either way.
    //
    // The specifier is held in a const, and #8021 CHANGED WHY. It used to be
    // the only spelling that compiled: `tsc` resolved this package through the
    // same `exports` map that does not publish `conversions`, so a literal was
    // `TS2307`. #8021 put `paths` in `tsconfig.json`, so the literal now
    // resolves — the file-header `import type` above is exactly that literal,
    // deliberately.
    //
    // The const stays because the two axes must be able to fail SEPARATELY. A
    // literal here would make this runtime case depend on `tsconfig.json` as
    // well as on `vitest.config.ts`, so a broken vitest alias could be masked,
    // or reported as a type error, by a config that has nothing to do with the
    // resolution this case is about. `import()` of a non-literal is `any` to
    // tsc and still resolves through Vite's alias at run time — one axis, one
    // case.
    const sourceOnlySubpath = '@objectstack/spec/conversions';
    const conversions = (await import(sourceOnlySubpath)) as { CONVERSION_NOTICE_CODE?: unknown };

    expect(conversions.CONVERSION_NOTICE_CODE).toBeTypeOf('string');
  });

  it('serves the package root and the namespaces from ONE source tree', async () => {
    // The case above pins the SUBPATH rule. This one carries it to the bare
    // entry: `defineConnector` is exported by both `@objectstack/spec` and
    // `@objectstack/spec/integration`, so if one of the two aliases were
    // missing or stopped matching, the two specifiers would land on different
    // trees (src and dist) and these would be different function objects.
    //
    // It is also the standing guard on the hazard #7991 flagged in advance:
    // aliasing a dep to source can surface a DUAL INSTANCE that the `dist`
    // boundary was hiding — two copies of the spec loaded at once, which makes
    // every identity comparison downstream (schema instances, registry
    // lookups) quietly wrong. One tree or red.
    expect(fromPackageRoot).toBe(fromNamespace);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(HERE, '..');
const SPEC_SRC = resolve(PACKAGE_DIR, '..', '..', 'spec', 'src');

/** `tsconfig.json` is JSONC; strip whole-line `//` comments, as the repo's own gates do. */
function readTsconfigPaths(): Record<string, string[]> {
  const raw = readFileSync(join(PACKAGE_DIR, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return (JSON.parse(raw).compilerOptions?.paths ?? {}) as Record<string, string[]>;
}

/**
 * Resolve `specifier` the way tsc resolves `paths`: an EXACT (star-free) key
 * wins outright, otherwise the pattern key with the longest matching prefix
 * wins and the captured text is substituted for the target's star.
 *
 * Returns the absolute target, or null when nothing matched — and null is a
 * real answer here, not an error case: it means tsc falls through to node
 * resolution, i.e. to `dist`.
 */
function resolveThroughPaths(specifier: string, paths: Record<string, string[]>): string | null {
  const exact = paths[specifier];
  if (exact && !specifier.includes('*')) return resolve(PACKAGE_DIR, exact[0]);

  let best: { prefixLength: number; target: string } | null = null;
  for (const [key, targets] of Object.entries(paths)) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    if (best && best.prefixLength >= prefix.length) continue;
    const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
    best = { prefixLength: prefix.length, target: resolve(PACKAGE_DIR, targets[0].replace('*', captured)) };
  }
  return best?.target ?? null;
}

/** Every `@objectstack/spec…` specifier this package imports with a literal, from its own files. */
function literalSpecImports(): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) {
        for (const match of readFileSync(full, 'utf8').matchAll(/from\s+'(@objectstack\/spec(?:\/[^']+)?)'/g)) {
          found.add(match[1]);
        }
      }
    }
  };
  walk(join(PACKAGE_DIR, 'src'));
  walk(join(PACKAGE_DIR, 'test'));
  return [...found].sort();
}

// The type axis of the same invariant (#8021). The README gives `typecheck` a
// job the runtime suite cannot do — "a removed or NARROWED export fails here" —
// and it was answering from `dist/*.d.ts` for the same reason the runtime half
// was: no resolution config at all. Measured, one variable moved, identical
// checkout and identical stale `dist`, with `label: z.string()` narrowed to
// `z.number()` in `spec/src/integration/connector.zod.ts` and NO rebuild:
// without `paths`, `tsc --noEmit` exited 0; with `paths`, it reported
// `src/additional-domains.fixtures.ts(35,3): error TS2322: Type 'string' is not
// assignable to type 'number'` — the frozen fixture's `label: 'DC HubSpot'`.
//
// The `import type { ConversionNotice }` at the top of this file is the direct
// half of the pin: it compiles only through the subpath rule. These cases are
// the half that a type-only import CANNOT express — the bare-entry rule has no
// type-level discriminator at all. Measured: with the subpath rule kept and
// only the bare rule deleted, tsc stayed CLEAN while `src/stack.ts`'s
// `defineStack` types came from `dist`. The obvious candidate for a direct
// assertion — an `Equal<>` identity check between `typeof defineConnector`
// reached through both entries, the type-level twin of the `toBe` case above —
// was tried and rejected on measurement: with the two entries on different
// trees tsc had not finished comparing spec's zod-derived types after nine
// minutes. So the bare rule is pinned the way `check:test-source-alias` pins
// the Vite side: simulate the resolution and assert where it lands.
describe('the contract TYPES read spec SOURCE, not spec dist (#8021)', () => {
  it('maps every spec specifier this package imports onto a real file under spec/src', () => {
    const paths = readTsconfigPaths();
    const specifiers = literalSpecImports();

    // Guards the guard: if the scan ever stops finding the fixtures' imports,
    // the loop below would pass vacuously.
    expect(specifiers).toContain('@objectstack/spec');
    expect(specifiers.length).toBeGreaterThan(5);

    for (const specifier of specifiers) {
      const target = resolveThroughPaths(specifier, paths);
      expect(target, `${specifier} falls through 'paths' to node resolution, i.e. to dist`).not.toBeNull();
      expect(relative(SPEC_SRC, target as string).startsWith('..'), `${specifier} resolves outside spec/src`).toBe(
        false,
      );
      expect(existsSync(target as string), `${specifier} resolves to a nonexistent ${target}`).toBe(true);
    }
  });

  it('covers namespaces the fixtures have not reached yet, with one rule rather than a list', () => {
    // An enumeration would be green today and stale the first time a fixture
    // reaches a new namespace — silently, because the failure mode of a missing
    // rule is a PASSING typecheck. Every namespace spec publishes must already
    // resolve to source, whether or not a fixture imports it today.
    const paths = readTsconfigPaths();
    const published = Object.keys(
      JSON.parse(readFileSync(resolve(SPEC_SRC, '..', 'package.json'), 'utf8')).exports as Record<string, unknown>,
    )
      .filter((key) => key.startsWith('./') && !key.includes('.json'))
      .map((key) => `@objectstack/spec/${key.slice(2)}`);

    expect(published.length).toBeGreaterThan(10);
    for (const specifier of published) {
      const target = resolveThroughPaths(specifier, paths);
      expect(target, `${specifier} is published but falls through to dist`).not.toBeNull();
      expect(existsSync(target as string), `${specifier} maps to a nonexistent ${target}`).toBe(true);
    }
  });

  it('refuses the prefix-star spelling that folds every namespace onto one module', () => {
    // The tsconfig twin of the Vite object-form trap `vitest.config.ts`
    // records. A key spelled `@objectstack/spec*` — star NOT preceded by a
    // slash — matches every namespace. It is worse than the Vite version,
    // which crashes with ENOTDIR: `spec/src/index.ts` re-exports most of the
    // namespace surface, so this one type-checks the fixtures against the
    // wrong module and stays GREEN.
    for (const key of Object.keys(readTsconfigPaths())) {
      expect(/^@objectstack\/spec[^/]*\*/.test(key), `paths key '${key}' matches namespaces by prefix`).toBe(false);
    }
  });

  it('keeps the targets inside the source tree, never inside dist', () => {
    for (const targets of Object.values(readTsconfigPaths())) {
      for (const target of targets) {
        expect(target.split('/').includes('dist'), `paths target '${target}' points into a build artifact`).toBe(false);
        expect(target.includes(`spec${sep}src`) || target.includes('spec/src')).toBe(true);
      }
    }
  });
});
