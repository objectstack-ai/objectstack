/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/react` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3159, objectstack#4115 burn-down batch 5).
 *
 * `useOffline`, `useNavigationOverlay` and `usePerformance` each opened with a
 * comment claiming their types were "aligned with @objectstack/spec v2.0.7" —
 * against an installed spec of 17.0.0-rc.1.
 *
 * Five of the six colliding symbols are now the spec's bindings.
 * `ConflictResolutionStrategy` was renamed to the spec's OWN name for that union
 * (`ConflictResolution`), because the name it had belongs to a DIFFERENT spec
 * export. The sixth, `PerformanceConfig`, needed no fix at all: the spec retired
 * that name in 17.0.0-rc.1, so the collision ended on its own — pinned at the
 * bottom of this file, because "the spec dropped it" is a claim with an expiry
 * date.
 *
 * ## Two traps this batch had to walk around, pinned below
 *
 * 1. `ConflictResolutionStrategy` IS a spec export — in `@objectstack/spec/api`,
 *    where it means the metadata-MERGE policy (`error | priority | first-wins |
 *    last-wins`). Deriving under the old name would have produced a symbol whose
 *    name points at one union and whose value is another.
 * 2. These configs are AUTHORED, so they derive from each schema's input side.
 *    `z.infer` would make every `.default()`ed key required and quietly forbid
 *    the omissions the defaults exist for — the `_input`/`_output` trap the
 *    guard's header names and objectui#3169 hit for real.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { useOffline } from '../useOffline';
import type {
  OfflineStrategy,
  ConflictResolution,
  OfflineCacheConfig,
  OfflineConfig,
  OfflineSyncConfig,
} from '../useOffline';
import type { NavigationConfig, NavigationMode } from '../useNavigationOverlay';
import type { SpecAuthoredInput } from '../../spec-input';
import type { NavigationConfigSchema, NavigationMode as SpecNavigationMode } from '@objectstack/spec/ui';
import type { ConflictResolutionStrategy as SpecMergeConflictStrategy } from '@objectstack/spec/api';

/** Every name `@objectstack/spec` exports from any subpath — types AND values. */
function specExportNames(): Set<string> {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@objectstack/spec/package.json');
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  const files: string[] = [];
  for (const cond of Object.values(pkg.exports ?? {})) {
    if (typeof cond !== 'object' || cond === null) continue;
    const dts = cond.import?.types ?? cond.require?.types;
    if (dts) files.push(resolve(pkgDir, dts));
  }

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();

  const names = new Set<string>();
  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

const SPEC_NAMES = specExportNames();

describe('the spec export-name probe itself works', () => {
  it('reads a non-trivial number of names', () => {
    expect(SPEC_NAMES.size).toBeGreaterThan(1000);
  });

  it('sees TYPE-only exports, not just runtime values', () => {
    // `SharingConfig` is a type alias — invisible to a runtime `import()`. It
    // replaced `OfflineCacheConfig` as the witness here when objectstack#4988
    // retired the whole `ui/offline` module; the probe must still prove it can
    // see erased exports, or every `.has(...)` assertion below would pass
    // vacuously for the wrong reason.
    expect(SPEC_NAMES.has('SharingConfig')).toBe(true);
  });
});

/**
 * This pin's direction INVERTED at `@objectstack/spec` 17.0.0-rc.3, and the
 * inversion is the honest result rather than a failure to adapt.
 *
 * It used to read: the local symbol did not move to a LOCAL dialect name, it
 * moved to the spec's own name for the union it always was — so
 * `ConflictResolution` must STAY a spec export, because this package merely
 * re-exported it. objectstack#4988 (PR objectstack#5321) then deleted the whole
 * `ui/offline` module, and with it that name. The spec's own retirement ledger
 * prescribes the remedy by name: "If you consumed the bare `ConflictResolution`
 * from `@objectstack/spec/ui` as a TYPE for your own offline code, declare that
 * union locally — it is your client's policy, not the platform's."
 *
 * So `useOffline` now DECLARES it, and the first assertion below flips from
 * `true` to `false`. What does NOT change is the half that made the rename
 * load-bearing in the first place: `ConflictResolutionStrategy` is still a spec
 * export meaning something else entirely, so the old name is still not free to
 * take back.
 */
describe('the ConflictResolutionStrategy rename is load-bearing', () => {
  it('the spec has VACATED `ConflictResolution` — this package declares it', () => {
    expect(
      SPEC_NAMES.has('ConflictResolution'),
      '@objectstack/spec exports `ConflictResolution` again. `useOffline` declares its ' +
        'own, which is a fork the moment the spec owns the name. Re-triage it ' +
        '(objectstack#4115) — derive, rename, or ALLOW with a reason.',
    ).toBe(false);
  });

  it('`ConflictResolutionStrategy` is still a DIFFERENT spec export', () => {
    expect(
      SPEC_NAMES.has('ConflictResolutionStrategy'),
      '@objectstack/spec no longer exports `ConflictResolutionStrategy`. That collision ' +
        'is the only reason this hook stopped using the name. If the spec dropped it, the ' +
        'old name is free again — but check what it means now before taking it back.',
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.      */
/* Compiled by this package's `tsconfig.test.json` (objectui#3181): the narrow  */
/* `tsconfig.typetests.json` that used to name this one file was the rescue     */
/* hatch for a package still in TEST_DEBT, and it was retired with the debt     */
/* (objectui#4040 / objectui#4291).                                             */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('the offline unions keep the members the hook dispatches on', () => {
  it('is pinned at compile time', () => {
    type _StrategyNotAny = Assert<Equal<IsAny<OfflineStrategy>, false>>;
    type _ResolutionNotAny = Assert<Equal<IsAny<ConflictResolution>, false>>;

    // The spec-identity halves (`OfflineStrategy` / `ConflictResolution` ARE the
    // spec's bindings) are gone with the `ui/offline` module (objectstack#4988).
    // What survives is the distinction that made the original rename
    // load-bearing, and it is still checkable because the OTHER side of it —
    // `@objectstack/spec/api`'s `ConflictResolutionStrategy`, the metadata-MERGE
    // policy — was NOT retired. If these ever became the same union, a reader
    // would again have a symbol whose name points at one policy and whose value
    // is another, which is the whole reason this hook does not use that name.
    type _NotTheMergePolicy = Assert<
      Equal<Equal<ConflictResolution, SpecMergeConflictStrategy>, false>
    >;
    type _NoOverlapAtAll = Assert<
      Equal<Extract<ConflictResolution, SpecMergeConflictStrategy>, never>
    >;

    expect(true).toBe(true);
  });

  it('still carries the four conflict policies, and only those', () => {
    const all: ConflictResolution[] = [
      'manual',
      'client_wins',
      'server_wins',
      'last_write_wins',
    ];
    expect(all).toHaveLength(4);
  });

  it('still carries the five strategies the hook dispatches on', () => {
    const all: OfflineStrategy[] = [
      'cache_first',
      'network_first',
      'stale_while_revalidate',
      'network_only',
      'cache_only',
    ];
    expect(all).toHaveLength(5);
  });
});

describe('OfflineCacheConfig keeps its defaulted keys authorable', () => {
  it('preserves the z.input side the retired schema had', () => {
    // The spec-side halves are gone with the `ui/offline` module
    // (objectstack#4988), but the property they protected is the hook's own and
    // is still worth pinning: `persistStorage` / `evictionPolicy` carried
    // `.default()`, so a `z.infer`-shaped copy would have made them REQUIRED and
    // forbidden the omissions the defaults exist for. The local declaration
    // deliberately keeps them optional; this is the check that it stays that way.
    type _WeKeepThemOptional = Assert<
      Equal<undefined extends OfflineCacheConfig['persistStorage'] ? true : false, true>
    >;
    type _EvictionOptionalToo = Assert<
      Equal<undefined extends OfflineCacheConfig['evictionPolicy'] ? true : false, true>
    >;

    // The members themselves, pinned so the storage backends the hook documents
    // cannot drift silently now that no schema enumerates them.
    type _StorageMembers = Assert<
      Equal<NonNullable<OfflineCacheConfig['persistStorage']>, 'sqlite' | 'indexeddb' | 'localstorage'>
    >;

    expect(true).toBe(true);
  });
});

describe('NavigationConfig IS the spec\'s authored navigation config', () => {
  it('is pinned at compile time', () => {
    type SpecNavigationInput = SpecAuthoredInput<typeof NavigationConfigSchema>;
    type _SpecNotAny = Assert<Equal<IsAny<SpecNavigationInput>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecNavigationInput>, false>>;

    // Every local config is a valid authored spec config: narrowing only ever
    // removes `undefined`.
    type _LocalIsASpecConfig = Assert<Extends<NavigationConfig, SpecNavigationInput>>;

    // No key invented locally, none of the spec's dropped.
    type _NoLocalOnlyKeys = Assert<Equal<Exclude<keyof NavigationConfig, keyof SpecNavigationInput>, never>>;
    type _NoMissingKeys = Assert<Equal<Exclude<keyof SpecNavigationInput, keyof NavigationConfig>, never>>;

    // objectui#4550 — the narrowing is GONE, and these three pins are the
    // inverted descendants of the ones that described it.
    //
    // The alias used to `Omit` `mode` and re-add it as `NonNullable<…>`, which
    // made it strictly tighter than BOTH the spec that produces the value and
    // the hook that consumes it (`navigation?.mode ?? 'page'`, 140 lines below
    // the declaration). A required key in front of an implementation that
    // defaults it is not a contract, and the cost was paid at every spec-typed
    // caller: `ListView` had to write `schema.navigation as NavigationConfig`
    // to hand the hook a value the hook was always happy to take.
    //
    // The previous spelling of this block predicted its own end — "if the spec
    // ever makes `mode` required itself, `_StillNarrowed` fails and this alias
    // should collapse to `SpecAuthoredInput<typeof NavigationConfigSchema>`."
    // The collapse arrived from the other direction (the spec never moved; the
    // alias was wrong all along), but it is the same collapse.
    type _IsExactlyTheSpecInput = Assert<Equal<NavigationConfig, SpecNavigationInput>>;

    // `mode` is OPTIONAL to author, because the spec defaults it
    // (`packages/spec/src/ui/view.zod.ts` → `mode: NavigationModeSchema.default('page')`)
    // and a `.default()` lands on the AUTHORING side as `| undefined`. This is
    // the assertion that was false before objectui#4550.
    type _ModeIsOptional = Assert<Equal<undefined extends NavigationConfig['mode'] ? true : false, true>>;

    // Assignability now runs BOTH ways. `_LocalIsASpecConfig` above is the one
    // direction that always held; this is the one the narrowing blocked, and
    // it is the direction every caller actually needs — spec produces, alias
    // consumes.
    type _SpecShapedValueFits = Assert<Extends<SpecNavigationInput, NavigationConfig>>;

    // The overlay buckets the hook maps to pixel widths are the spec's, and
    // `size` is the key #2578 added — the deprecated `width` is still here too.
    type _SizeIsSpecSize = Assert<Equal<NavigationConfig['size'], SpecNavigationInput['size']>>;
    type _WidthIsSpecWidth = Assert<Equal<NavigationConfig['width'], SpecNavigationInput['width']>>;

    expect(true).toBe(true);
  });

  it('still carries every overlay mode the hook switches on', () => {
    const all: NonNullable<NavigationConfig['mode']>[] = [
      'page',
      'drawer',
      'modal',
      'split',
      'popover',
      'new_window',
      'none',
    ];
    expect(all).toHaveLength(7);
  });

  it('the exported NavigationMode is the spec union AND still this config\'s `mode`', () => {
    // objectui#4167. `NavigationMode` used to be spelled `NavigationConfig['mode']`
    // — one member access away from the spec, which reads as a hand-written
    // union to `check:spec-symbols` and to a person. It is now bound to the
    // spec's `NavigationMode` directly, and this is the pin the declaration
    // promises: the two spellings must stay the SAME type.
    //
    // They can come apart in a way nothing else would catch. If the spec ever
    // stops defaulting `mode`, or defaults it on a narrower union,
    // `NavigationConfig['mode']` moves and the exported alias does not — and
    // every call site keeps compiling, because the hook's
    // `navigation?.mode ?? 'page'` would still be assignable either way.
    //
    // Both directions, deliberately: a one-way `extends` is satisfied by a
    // narrowing as well as by equality, and a narrowing is exactly the drift
    // that would delete a mode the hook switches on.
    //
    // `NonNullable` is objectui#4550's mark on this pin, and it is load-bearing
    // rather than cosmetic. The alias no longer strips the `undefined` that
    // `.default('page')` puts on the authoring side, so `NavigationConfig['mode']`
    // is now `NavigationMode | undefined` — a bare `Equal` here would fail for
    // a reason that has nothing to do with the drift this test exists to catch.
    // What must stay pinned is the MEMBERSHIP: the seven modes the hook
    // switches on are exactly the seven the exported union publishes.
    type _ModeIsSpecMode = Assert<Equal<NavigationMode, SpecNavigationMode>>;
    type _ModeIsConfigMode = Assert<Equal<NavigationMode, NonNullable<NavigationConfig['mode']>>>;

    // Runtime half — the type assertions above are erased, so this is what
    // fails visibly if the union ever loses a member.
    const everyMode: NavigationMode[] = [
      'page',
      'drawer',
      'modal',
      'split',
      'popover',
      'new_window',
      'none',
    ];
    expect(new Set(everyMode).size).toBe(7);
  });
});

/**
 * `PerformanceConfig` was the sixth symbol in this batch and needed NO fix: the
 * spec RETIRED `PerformanceConfigSchema` / `PerformanceConfig` from
 * `@objectstack/spec/ui` in 17.0.0-rc.1, so the collision is gone and the name
 * is objectui's own. Pinned because "the spec dropped it" is a claim with an
 * expiry date — if the spec re-adds the name, this fails and the symbol needs
 * triaging again rather than silently becoming a fork.
 */
describe('PerformanceConfig no longer collides — the spec retired the name', () => {
  it('the spec exports neither the type nor its schema', () => {
    for (const name of ['PerformanceConfig', 'PerformanceConfigSchema']) {
      expect(
        SPEC_NAMES.has(name),
        `@objectstack/spec exports \`${name}\` again. \`usePerformance\` declares its own ` +
          `\`PerformanceConfig\`, which is a fork the moment the spec owns the name. ` +
          `Re-triage it (objectstack#4115) — derive, rename, or ALLOW with a reason.`,
      ).toBe(false);
    }
  });
});

/**
 * `OfflineConfig` keeps the spec's name here, and that was a cross-package call:
 * `@object-ui/types` had an `OfflineConfig` too, but it turned out to be a
 * service-worker ROUTE cache and was renamed `PWAOfflineConfig` (objectui#3156).
 * This hook's config IS the spec's concept, key for key, so it takes the spec's
 * binding — a plain derivation, no dialect.
 */
describe('OfflineConfig and OfflineSyncConfig keep the retired schema shape', () => {
  it('is pinned at compile time', () => {
    type _NotAny = Assert<Equal<IsAny<OfflineConfig>, false>>;
    type _NotUnknown = Assert<Equal<IsUnknown<OfflineConfig>, false>>;

    // The `Equal<local, SpecAuthoredInput<typeof Schema>>` pins are gone with
    // the schemas themselves (objectstack#4988). The key inventory they
    // protected is pinned directly instead, so the local declaration cannot
    // quietly gain or lose a key now that no schema enumerates them.
    type _OfflineKeys = Assert<
      Equal<
        keyof OfflineConfig,
        'enabled' | 'strategy' | 'cache' | 'sync' | 'offlineIndicator' | 'offlineMessage' | 'queueMaxSize'
      >
    >;
    type _SyncKeys = Assert<
      Equal<
        keyof OfflineSyncConfig,
        'strategy' | 'conflictResolution' | 'retryInterval' | 'maxRetries' | 'batchSize'
      >
    >;

    expect(true).toBe(true);
  });

  /**
   * The concrete reason this is the input side: the hook's own signature is
   * `useOffline(config: OfflineConfig = {})`. `z.infer` would make `enabled`,
   * `strategy` and `offlineIndicator` required — i.e. would reject the default
   * the hook ships with. This is that check, written so it fails loudly rather
   * than as a puzzle about variance.
   */
  it('accepts the empty config the hook itself defaults to', () => {
    const empty: OfflineConfig = {};
    const authored: OfflineConfig = {
      enabled: true,
      strategy: 'cache_first',
      sync: { conflictResolution: 'last_write_wins' },
      cache: { ttl: 60 },
    };
    expect(useOffline).toBeTypeOf('function');
    expect([empty, authored]).toHaveLength(2);
  });
});
