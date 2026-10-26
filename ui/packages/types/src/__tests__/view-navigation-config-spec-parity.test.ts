// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ViewNavigationConfig` IS the spec's navigation config (objectui#4588).
 *
 * The card behind this file: `@object-ui/types` published **two** types for one
 * spec object, and they disagreed about whether `mode` may be omitted.
 * `index.ts` re-exports the spec's `NavigationConfig` unchanged, while
 * `objectql.ts` hand-declared a `ViewNavigationConfig` covering the same six
 * keys with `mode` REQUIRED — under a doc comment that itself claimed
 * `@default 'page'`. The spec never asked for that: `NavigationConfigSchema`
 * in `@objectstack/spec`'s `ui/view.zod.ts` declares
 * `mode: NavigationModeSchema.default('page')`, and a `.default()` lands on the
 * AUTHORING side as `| undefined`, which is why the spec publishes its own type
 * as `z.input< typeof NavigationConfigSchema >`. So a config that omits `mode`
 * is legal authored metadata that lets the mode default — and it did not
 * type-check against the three schema interfaces that spell
 * `navigation?: ViewNavigationConfig`.
 *
 * ⚠️ THE CARD'S OWN EXAMPLE VALUE IS NOW A TOMBSTONE. The card carried the
 * mode-less config as `{ view: 'summary_view' }`, and `view` has since been
 * RETIRED: objectstack#18619 (director decision batch #126 item 4, ADR-0049
 * enforce-or-remove) replaced `NavigationConfigSchema`'s `view` slot with a
 * `retiredKey()` tombstone in `@objectstack/spec` 17.5.0, because no layer ever
 * resolved a view by that name — the value was passed into the navigation-MODE
 * argument of the console's `onNavigate`. Every case below therefore carries
 * `mode`-lessness on a key the spec still admits (objectui#9667). ⭐ The
 * tombstone KEEPS the key in the shape (`z.never().optional()`, so `z.input`
 * types it `undefined`, which is why an authored name reads as
 * `TS2322: Type 'string' is not assignable to type 'undefined'`) — so
 * `SpecDeclaredKeys` below still lists `view`, and ⛔ removing it from that
 * list would break `_KeysAreExactlyTheSpecSix`, not repair it.
 *
 * This is objectui#4550 / PR objectui#4586 one package over: that one collapsed
 * `@object-ui/react`'s `NavigationConfig` to the spec's authored input. This
 * file pins the same collapse here, so the two published spellings can no
 * longer drift apart again.
 *
 * The assertions are mostly type-level on purpose. They run in
 * `tsc -p tsconfig.test.json` (part of this package's `type-check`), so
 * re-growing a hand copy fails the build rather than waiting for a reviewer to
 * notice — which is the failure mode this card was reported for.
 *
 * ## ⛔ THE TOMBSTONE PIN IS OWED, AND IS NOT WRITABLE FROM HERE YET
 *
 * objectstack#18619's execution item 3 asks the contract twins to gain a
 * tombstone pin — an assertion that `navigation.view` is REFUSED. This
 * repository's convention for that is an `@ts-expect-error` directive over the
 * authored key, the shape `action-callback-retired-7068` uses in this same
 * directory, beside a still-live sibling read with NO directive as its lit
 * control. ⛔ It cannot be
 * written while this package resolves a `@objectstack/spec` that predates the
 * retirement: the key still types `string | undefined` there, the line under
 * the directive compiles, and `tsc` rejects the directive itself as unused
 * (TS2578) — an `@ts-expect-error` is an assertion that something FAILS, so it
 * is red in exactly the world where the tombstone has not arrived.
 *
 * ⇒ the pin is owed, on this file, the day this package's `@objectstack/spec`
 * moves onto a version carrying the retirement. ⛔ It is not written here in a
 * disabled or conditional form: a pin that passes on both sides of the contract
 * it guards is the phantom check this file exists to prevent. The instrument
 * that re-derives whether the pin is writable today is one command —
 * `pnpm --filter @object-ui/types type-check` with the directive added — and
 * ⛔ this comment deliberately records no version number for it to go stale
 * against (objectui#9667).
 */

import { describe, it, expect } from 'vitest';
import type {
  NamedListView,
  NavigationConfig,
  ObjectGridSchema,
  ObjectMapSchema,
  ObjectViewSchema,
  ViewNavigationConfig,
} from '../index';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The collapse itself ─────────────────────────────────────────────────── */

/**
 * The whole point of the card: the two names this package publishes for the
 * spec's navigation config are ONE type. `NavigationConfig` is the spec
 * re-export at `index.ts`; `ViewNavigationConfig` is the name `objectql.ts`
 * publishes. If a future edit re-grows a hand copy — even one that starts out
 * byte-identical — this line goes red on the day it drifts.
 */
type _IsExactlyTheSpecInput = Expect< Equal< ViewNavigationConfig, NavigationConfig > >;

/**
 * The six keys the spec declares (`view.zod.ts` `NavigationConfigSchema`).
 * Adding a key here to make a new local read compile is the defect, not the
 * fix: the key has to exist in the spec first, or the platform refuses metadata
 * that declares it.
 *
 * ⛔ `view` stays on this list even though objectstack#18619 retired it, and
 * this is the one line on the file most likely to be "tidied" wrongly. A
 * `retiredKey()` tombstone is `z.never().optional()`: the key is still IN the
 * object shape, so `keyof` still yields it — only its input type collapses from
 * `string | undefined` to `undefined`. DECLARED and WRITABLE are two different
 * facts, and this alias measures the first one. Dropping `view` here reddens
 * `_KeysAreExactlyTheSpecSix` against both the installed spec and spec@main.
 */
type SpecDeclaredKeys = 'mode' | 'view' | 'preventNavigation' | 'openNewTab' | 'size' | 'width';

type _KeysAreExactlyTheSpecSix = Expect< Equal< keyof ViewNavigationConfig, SpecDeclaredKeys > >;

/* ── `mode` is optional, because the spec defaults it ────────────────────── */

/**
 * The defect this card names. `undefined` is assignable to `mode` because
 * `.default('page')` makes it optional on the authoring side.
 */
type _ModeIsOptional = Expect<
  Equal< undefined extends ViewNavigationConfig['mode'] ? true : false, true >
>;

/**
 * Membership of the seven modes, pinned through `NonNullable`.
 *
 * A BARE `Equal< ViewNavigationConfig['mode'], …the seven… >` would now be
 * `false` — but for the wrong reason: the `| undefined` that the `.default()`
 * puts there on purpose, not a drift in which modes exist. `NonNullable` keeps
 * this assertion pointed at the thing it guards. (Same care PR objectui#4586
 * took with `_ModeIsConfigMode` one package over.)
 */
type _ModeMembershipIsTheSevenSpecModes = Expect<
  Equal<
    NonNullable< ViewNavigationConfig['mode'] >,
    'page' | 'drawer' | 'modal' | 'split' | 'popover' | 'new_window' | 'none'
  >
>;

/* ── The three schema sites use the shared type ──────────────────────────── */

/**
 * `objectql.ts` spells `navigation?: ViewNavigationConfig` in four interfaces
 * (`ObjectMapSchema` joined them with objectui#5018, which declared the keys
 * `ObjectMap` actually reads).
 * Each must be the spec type itself, so one authoring surface cannot outgrow
 * another — the same guard `objectql.exportOptions.test.ts` puts on
 * `exportOptions`.
 */
type _GridUsesTheSharedType = Expect<
  Equal< NonNullable< ObjectGridSchema['navigation'] >, ViewNavigationConfig >
>;
type _ObjectViewUsesTheSharedType = Expect<
  Equal< NonNullable< ObjectViewSchema['navigation'] >, ViewNavigationConfig >
>;
type _NamedViewUsesTheSharedType = Expect<
  Equal< NonNullable< NamedListView['navigation'] >, ViewNavigationConfig >
>;
type _ObjectMapUsesTheSharedType = Expect<
  Equal< NonNullable< ObjectMapSchema['navigation'] >, ViewNavigationConfig >
>;

/* ── Runtime half ────────────────────────────────────────────────────────── */

describe('ViewNavigationConfig is the spec navigation config (objectui#4588)', () => {
  it('accepts the spec-valid config that omits `mode`', () => {
    // The card's case, on a carrier the spec still admits. The card's own value
    // was `{ view: 'summary_view' }`; `view` is a tombstone since
    // objectstack#18619, so `preventNavigation` carries the mode-lessness
    // instead (objectui#9667). What is under test is the ABSENCE of `mode`, and
    // that is unchanged. Before the collapse this line was
    // `TS2741: Property 'mode' is missing`.
    const navigation: ViewNavigationConfig = { preventNavigation: true };

    // Runtime half: the type-level assertions above are erased, so without a
    // value that actually omits `mode`, the requirement could come back and
    // this file would still compile.
    expect(Object.keys(navigation)).toEqual(['preventNavigation']);
    expect(navigation.mode).toBeUndefined();
  });

  it('accepts a mode-less config at each of the three schema sites', () => {
    const grid: Pick< ObjectGridSchema, 'navigation' > = { navigation: { preventNavigation: true } };
    const view: Pick< ObjectViewSchema, 'navigation' > = { navigation: { preventNavigation: true } };
    const named: Pick< NamedListView, 'navigation' > = { navigation: { preventNavigation: true } };

    for (const site of [grid, view, named]) {
      expect(site.navigation?.mode).toBeUndefined();
      expect(site.navigation?.preventNavigation).toBe(true);
    }
  });

  it('still accepts every spec key the tombstone leaves writable, so the collapse did not narrow the surface', () => {
    // ⛔ `view` is deliberately NOT here, and its absence is the point rather
    // than an omission: objectstack#18619 retired it, so on a spec carrying the
    // tombstone its input type is `undefined` and any authored name is
    // `TS2322: Type 'string' is not assignable to type 'undefined'`. It is
    // still a DECLARED key — `_KeysAreExactlyTheSpecSix` above measures that,
    // on this same file, which is the control that keeps this case's shorter
    // list from reading as "the spec lost a key".
    const full: ViewNavigationConfig = {
      mode: 'drawer',
      preventNavigation: false,
      openNewTab: false,
      size: 'lg',
      width: '600px',
    };
    expect(Object.keys(full).sort()).toEqual(
      ['mode', 'openNewTab', 'preventNavigation', 'size', 'width'],
    );
  });

  it('refuses a mode outside the spec enum', () => {
    const bad: ViewNavigationConfig = {
      // @ts-expect-error 'sidebar' is not one of the seven spec navigation modes
      mode: 'sidebar',
    };
    expect(bad).toBeDefined();
  });

  it('refuses a key the spec does not declare', () => {
    const bad: ViewNavigationConfig = {
      mode: 'page',
      // @ts-expect-error `placement` is not a declared navigation key
      placement: 'right',
    };
    expect(bad).toBeDefined();
  });
});
