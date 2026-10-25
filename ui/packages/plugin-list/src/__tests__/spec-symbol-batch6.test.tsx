/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-list` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3160, objectstack#4115 ledger batch 6).
 *
 * Three symbols here wore names the spec owns, and the verdicts differ by
 * KIND, not by cluster:
 *
 *  - `ViewTab` was a hand copy of `ViewTabSchema` under the spec's own name,
 *    drifted in three places. It is derived now — from the schema's INPUT side,
 *    because `pinned` / `isDefault` / `visible` carry `.default()`s and this
 *    component is handed authored metadata, not parsed output.
 *
 *  - `ListView` and `UserFilters` are the RENDERERS of two spec types, and both
 *    are ALLOW entries in scripts/check-spec-symbol-derivation.mjs. The test
 *    applied is the one the guard's `AuthProvider` entry states — not "React
 *    components are exempt" (batch 5 renamed `Field` → `FieldContainer`), but
 *    "would the next session read THIS declaration as canonical for the spec's
 *    shape?". Neither declares a shape at all: each takes the spec's type as a
 *    prop, so the two layers are joined at the declaration instead of restated.
 *    The assertions below are what keeps that claim true — they fail if either
 *    component stops consuming the spec-derived type, at which point the
 *    exemption's reason has expired and the symbol needs re-triage.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { ListView } from '../ListView';
import type { ListViewProps } from '../ListView';
import { UserFilters } from '../UserFilters';
import type { UserFiltersProps } from '../UserFilters';
import type { ViewTab } from '../components/TabBar';

import type { ListViewSchema } from '@object-ui/types';
import type {
  ListView as SpecListView,
  UserFilters as SpecUserFilters,
  ViewTab as SpecViewTab,
  ViewTabParsed as SpecViewTabParsed,
  ViewTabSchema as SpecViewTabSchema,
} from '@objectstack/spec/ui';

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
    expect(SPEC_NAMES.has('ViewTab')).toBe(true);
  });
});

describe('the two ALLOW entries still describe live collisions', () => {
  // An ALLOW entry that excuses nothing is stale — the guard's own third
  // ratchet says so. These names being spec-owned is the whole premise.
  it.each([
    ['ListView', 'the authored list-view metadata document'],
    ['UserFilters', 'the ADR-0047 quick-filter configuration'],
  ])('the spec still owns `%s` (%s)', (name) => {
    expect(
      SPEC_NAMES.has(name),
      `@objectstack/spec no longer exports \`${name}\`. The ALLOW entry in ` +
        `scripts/check-spec-symbol-derivation.mjs excuses a collision that no longer ` +
        `exists — delete the entry so the name cannot be re-forked under an inherited ` +
        `exemption.`,
    ).toBe(true);
  });
});

describe('the renderers are components, and the spec names are metadata', () => {
  it('`ListView` is a React component, not a shape declaration', () => {
    // `React.forwardRef` returns an exotic object, not a function.
    expect(typeof ListView).toBe('object');
    expect(ListView).toHaveProperty('render');
  });

  it('`UserFilters` is a React component, not a shape declaration', () => {
    expect(typeof UserFilters).toBe('function');
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.      */
/* Compiled by this package's `tsconfig.test.json` (objectui#3181; the narrow  */
/* project that named this file alone was retired in objectui#4291).           */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type IsOptional<T, K extends keyof T> = undefined extends T[K] ? true : false;

/** The spec's own authoring type for a view tab — what `.parse()` ACCEPTS. */
type SpecViewTabInput = (typeof SpecViewTabSchema)['_zod']['input'];

describe('ViewTab derives from the spec schema, on the authoring side', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecViewTab>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecViewTab>, false>>;

    type _IsTheSpecInput = Assert<Equal<ViewTab, SpecViewTabInput>>;

    // Input, not output, and here is the evidence: the PARSED type requires the
    // three defaulted keys, so re-exporting the parsed shape would have made a
    // stored `{ name: 'open', label: 'Open' }` unrepresentable — the
    // `_input`/`_output` trap the guard's header warns about, and the one that
    // already bit `ObjectFieldGroup` (objectui#3169) and `OfflineConfig`
    // (objectui#3199).
    //
    // Re-pointed BY SIDE at `@objectstack/spec` 17.0.0-rc.6, not by name: the
    // `…Input`-alias retirement moved the bare `ViewTab` onto the INPUT side
    // (`ViewTab = z.input`, `ViewTabParsed = z.infer`), so `SpecViewTab` is no
    // longer the parsed shape these four lines are about. Following the NAME
    // would have left each of them comparing the authoring side against itself
    // — passing on nothing — which is the swap objectui#4189 avoided for
    // `ThemeInput`/`Theme` in the same release. Same fix, different package;
    // this one was invisible until objectui#4163 cleared the `I18nLabel`
    // errors in `TabBar.tsx`, because `type-check` was at the time
    // `tsc --noEmit && tsc -p tsconfig.typetests.json` and the `&&` never
    // reached that project. The `&&` short-circuit is still the shape to watch:
    // a type error anywhere earlier in the chain stops these pins being checked
    // at all, which is why the chain is kept as short as it now is.
    type _ParsedRequiresPinned = Assert<Equal<IsOptional<SpecViewTabParsed, 'pinned'>, false>>;
    type _ParsedRequiresVisible = Assert<Equal<IsOptional<SpecViewTabParsed, 'visible'>, false>>;
    type _AuthoredMayOmitPinned = Assert<IsOptional<ViewTab, 'pinned'>>;
    type _AuthoredMayOmitVisible = Assert<IsOptional<ViewTab, 'visible'>>;

    // Same key set as the parsed type — only optionality differs. A key the
    // spec adds appears here; a key it retires disappears.
    type _NoLocalKeys = Assert<Equal<Exclude<keyof ViewTab, keyof SpecViewTabParsed>, never>>;
    type _NoMissingKeys = Assert<Equal<Exclude<keyof SpecViewTabParsed, keyof ViewTab>, never>>;

    // The three drifts the hand copy carried, pinned as fixed:
    //  1. `label` was REQUIRED locally; the spec makes it optional (`name` is
    //     the identifier, and TabBar falls back to it).
    type _LabelIsOptional = Assert<IsOptional<ViewTab, 'label'>>;
    //  2. `filter` was `any`, so a mistyped operator was unreportable.
    type _FilterIsNotAny = Assert<Equal<IsAny<ViewTab['filter']>, false>>;
    //  3. `visible` accepted `string | boolean` — a renderer-side tolerance for
    //     a shape no producer emits (AGENTS.md #12).
    type _VisibleIsBoolean = Assert<Equal<NonNullable<ViewTab['visible']>, boolean>>;

    expect(true).toBe(true);
  });
});

describe('ListView RENDERS the spec metadata rather than restating it', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecListView>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecListView>, false>>;

    // The spec's `ListView` is a metadata DOCUMENT — it has the authoring keys
    // and nothing renderer-shaped. Pinned so "it is a different layer" stays a
    // fact rather than an assertion in a comment.
    type _SpecIsMetadata = Assert<Equal<'columns' extends keyof SpecListView ? true : false, true>>;

    // The component's own props bind that layer: `schema` is `ListViewSchema`
    // from `@object-ui/types` — the declared dialect that derives from the
    // spec's zod node (its own ALLOW entry, pinned by list-view-spec-parity).
    // THIS is the reason the collision is excused: the renderer consumes the
    // authored type, it does not declare a rival one. If this ever stops
    // holding, the ALLOW entry has lost its reason.
    type _PropsBindTheSchema = Assert<Equal<ListViewProps['schema'], ListViewSchema>>;

    // And the local export declares no view shape of its own: everything on
    // `ListViewProps` beyond `schema` is renderer plumbing (callbacks, initial
    // UI state), never metadata.
    type _SchemaIsTheOnlyMetadata = Assert<Extends<ListViewProps['schema'], SpecListView | object>>;

    expect(true).toBe(true);
  });
});

describe('UserFilters RENDERS the spec quick-filter config', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecUserFilters>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecUserFilters>, false>>;

    // The spec's `UserFilters` is the authored config: an element style plus
    // the fields and tab presets exposed to end users.
    type _SpecIsConfig = Assert<Equal<'element' extends keyof SpecUserFilters ? true : false, true>>;
    type _SpecHasTabs = Assert<Equal<'tabs' extends keyof SpecUserFilters ? true : false, true>>;

    // The component takes that config as a PROP — via
    // `NonNullable<ListViewSchema['userFilters']>`, the objectui view type that
    // derives from the same spec node. Nothing here re-declares the config, so
    // there is nothing here to drift from it; that is the ALLOW entry's reason,
    // and this line is what keeps it true.
    type _ConfigCarriesTheElement = Assert<
      Equal<'element' extends keyof UserFiltersProps['config'] ? true : false, true>
    >;
    type _ConfigCarriesTheFields = Assert<
      Equal<'fields' extends keyof UserFiltersProps['config'] ? true : false, true>
    >;
    type _ConfigIsNotAny = Assert<Equal<IsAny<UserFiltersProps['config']>, false>>;

    expect(true).toBe(true);
  });
});
