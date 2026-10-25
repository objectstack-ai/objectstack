/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3846 — the plugin trust tier is the SPEC's closed enum, here too.
 *
 * ## What was loose
 *
 * `MarketplacePackageVersion.runtime` was declared `string` while the producer
 * validates it against `PluginRuntimeSchema` — `z.enum(['node','sandbox',
 * 'worker'])`, ADR-0025 §3.6. Consumer looser than the contract, and the
 * looseness propagated: `RUNTIME_FALLBACK` was a `Record< string, string >` (a
 * missing tier could not be a compile error), the badge fell back to
 * `?? version.runtime` (raw wire value rendered as UI copy — on the panel where
 * a user grants a package the right to execute code), and the `t()` key carried
 * an `as any`.
 *
 * ## Why the spec and not a repo-local union
 *
 * The card left the route open: bind the spec's type (B) or restate the three
 * members locally (A). The dependency turned out to need nothing — `app-shell`
 * already depends on `@objectstack/spec`, and this very interface already binds
 * the spec's `PluginPermissions` one field over, with a header explaining that a
 * member-for-member local copy is what rots the day the spec adds a member
 * (objectstack#4115). So B costs zero dependencies and follows the file's own
 * precedent.
 *
 * ## Which gate each half fails at
 *
 * Both pins here are compile-time-or-value, and neither is a rendering change:
 * the labels a user sees for the three legal tiers are byte-identical before and
 * after. A render test would therefore be green both ways and prove nothing —
 * what actually changed is that a fourth tier, or a `string`, stops compiling.
 * The `Assert` block is erased before vitest runs and is checked by app-shell's
 * `tsc -p tsconfig.test.json`; the key-set case below is the one runtime
 * assertion, and it reads the producer's enum directly so a spec release that
 * adds `worker`'s successor turns it red here rather than in production.
 *
 * #3546 slice five pins the same three members from the i18n side (pack keys ===
 * the label map's keys). That suite cannot import the spec — `@object-ui/i18n`
 * does not depend on it — so it reads the component's source; this file is the
 * half that compares against `PluginRuntimeSchema` itself, and slice five now
 * points here for that comparison.
 */

import { describe, it, expect } from 'vitest';
import { PluginRuntimeSchema, type PluginRuntime as SpecPluginRuntime } from '@objectstack/spec/kernel';
import { RUNTIME_FALLBACK } from '../PluginDisclosure';
import type { MarketplacePackageVersion, PluginRuntime } from '../marketplaceApi';

describe('objectui#3846 — the trust-tier label map answers to the spec enum', () => {
  it('covers exactly the tiers PluginRuntimeSchema declares', () => {
    // The producer's own list, read from the schema rather than retyped.
    const declared = [...PluginRuntimeSchema.options].sort();
    expect(declared).toEqual(['node', 'sandbox', 'worker']);
    expect(Object.keys(RUNTIME_FALLBACK).sort()).toEqual(declared);
  });

  it('labels every tier with human copy — no tier falls through to a raw value', () => {
    // The `?? version.runtime` arm existed because this map could be partial.
    // Totality is now a compile-time property; this is the runtime half of it,
    // and it also catches an entry blanked to '' (which would render an empty
    // badge on the trust panel).
    for (const tier of PluginRuntimeSchema.options) {
      const label = RUNTIME_FALLBACK[tier];
      expect(typeof label, tier).toBe('string');
      expect(label.trim().length, tier).toBeGreaterThan(0);
      // A label must not be the wire value dressed up as copy — that is the
      // exact thing the removed fallback did.
      expect(label, tier).not.toBe(tier);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.     */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('objectui#3846 — the narrowing itself (checked by tsc, erased before vitest)', () => {
  it('is pinned at compile time', () => {
    // Guard against the probe lying: an `any` on either side makes every
    // assertion below vacuous (objectstack#4171).
    type _SpecTierNotAny = Assert<Equal<IsAny<SpecPluginRuntime>, false>>;
    type _OursNotAny = Assert<Equal<IsAny<PluginRuntime>, false>>;

    // The binding: what this module re-exports IS the spec's type, not a
    // same-shaped local union that would drift on the next spec release.
    type _TierIsSpecs = Assert<Equal<PluginRuntime, SpecPluginRuntime>>;

    // The field carries it, optional as it is on the wire — and is NOT `string`,
    // which is the assertion that goes red if the looseness is restored.
    type _FieldIsTier = Assert<Equal<MarketplacePackageVersion['runtime'], PluginRuntime | undefined>>;
    type _FieldIsNotString = Assert<
      Equal<Equal<MarketplacePackageVersion['runtime'], string | undefined>, false>
    >;

    // The label map is keyed by the union, so it is total by construction: a
    // partial map (the state that needed `?? version.runtime`) cannot type-check.
    type _MapIsTotal = Assert<Equal<keyof typeof RUNTIME_FALLBACK, PluginRuntime>>;

    expect(true).toBe(true);
  });

  it('refuses a tier the spec does not declare', () => {
    // The `@ts-expect-error` IS the assertion: widen `runtime` back to `string`
    // and this line stops erroring, which makes the directive unused — a tsc
    // error in its own right.
    // @ts-expect-error — 'quickjs' is not one of the spec's three tiers
    const version: Pick<MarketplacePackageVersion, 'runtime'> = { runtime: 'quickjs' };
    expect(version.runtime).toBe('quickjs');
  });
});
