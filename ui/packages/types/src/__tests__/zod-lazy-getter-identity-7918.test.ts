/**
 * objectui#7918 — the `z.lazy` getter-identity ledger for the zod node face.
 *
 * Ten exports of `@object-ui/types/zod` are `z.lazy(() => …)` whose getter builds
 * a NEW schema on every call, so `S._zod.def.getter() !== S._zod.def.getter()`.
 * The card did NOT claim that was wrong — it asked whether the spelling was
 * dodging a temporal-dead-zone error, and made that check the deliverable. This
 * file is the answer, kept executable so it cannot rot. Three things were
 * settled, and two of them contradict the card.
 *
 * ## 1. The TDZ question: yes for eight of the ten
 *
 * Each of the ten was rewritten in place to the obvious memoisation
 * — `const inner = <body>; z.lazy(() => inner)` — the package rebuilt, and the
 * built barrel imported in a fresh process. EIGHT refuse to load:
 *
 *   ActionSchema              ReferenceError: Cannot access 'ActionSchema' before initialization
 *   AppMenuItemSchema         ReferenceError: Cannot access 'MenuItemSchema' before initialization
 *   FilterGroupSchema         ReferenceError: Cannot access 'FilterGroupSchema' before initialization
 *   MenuItemSchema            ReferenceError: Cannot access 'MenuItemSchema' before initialization
 *   NavLinkSchema             ReferenceError: Cannot access 'NavLinkSchema' before initialization
 *   NavigationMenuItemSchema  ReferenceError: Cannot access 'NavigationMenuItemSchema' before initialization
 *   SchemaNodeSchema          ReferenceError: Cannot access 'BaseSchemaCore' before initialization
 *   TreeNodeSchema            ReferenceError: Cannot access 'TreeNodeSchema' before initialization
 *
 * Seven name the very const being declared (`children: z.array(TreeNodeSchema)`
 * sits inside `TreeNodeSchema`'s own initialiser); `SchemaNodeSchema` named
 * `BaseSchemaCore`, which `base.zod.ts` declared BELOW it. For those eight the
 * `z.lazy` was LOAD-BEARING — buying a TDZ dodge, not a style — and they keep
 * the spelling they have. `mechanism` below reproduces the failure.
 *
 * ⚠️ SEVEN, not eight, since objectui#8344. That card redirected the node
 * recursion point at `AnyComponentSchema` and had to build `SchemaNodeSchema`'s
 * union ONCE, at module scope, immediately below `BaseSchemaCore` — because the
 * component arm is a written option slot and there has to be an array to write
 * into. Declaring it below `BaseSchemaCore` is what dissolves the TDZ, so the
 * memoisation this file calls "worth doing where it is free" became free for this
 * one const, and the row moved to {@link MEMOISED}. ⛔ It is a BYPRODUCT, not a
 * goal: nobody memoised it to make `.unwrap()` honest, and ⛔ nothing here licenses
 * moving the remaining seven — each still names the const being declared, and
 * `mechanism` still reproduces their ReferenceError.
 *
 * ⚠️ And SIX since objectui#9306, the same way: that card made
 * `FilterGroupSchema`'s `conditions` flat rows (a nested sub-group is retired
 * and refused by name), so its body stopped naming the const being declared and
 * the memoisation became free. Taken, and its row moved to {@link MEMOISED}.
 *
 * ⇒ the eight-name list above is kept VERBATIM as the objectui#7918 reading it
 * was. It is history, not the current ledger; the arrays below are the ledger.
 *
 * The two that loaded clean were memoised: `FilterBuilderConditionSchema` is not
 * recursive at all, and `NavigationItemSchema` already defers its self-reference
 * through the inner `z.lazy(() => NavigationItemSchema)` on `children`.
 *
 * ## 2. The card's consequence ① is real, but only for the PUBLIC handle
 *
 * `zod@4.4.3` caches a lazy's resolved inner type on the shared def
 * (`$ZodLazy` -> `util.defineLazy(inst._zod, 'innerType', …)`, which fills
 * `def._cachedInner` once). Its own comment says the cache exists to preserve
 * "identity for cycle detection on recursive schemas". So:
 *
 *   S._zod.innerType      STABLE for all ten, even the eight       (internal)
 *   S.unwrap()            fresh object per call for the eight      (PUBLIC)
 *   S._zod.def.getter()   fresh object per call for the eight      (internal)
 *
 * `.unwrap()` is unstable because `ZodLazy` defines it as
 * `() => inst._zod.def.getter()` — it goes around the cache. (`ZodPromise`
 * spells its own as `() => inst._zod.def.innerType`, i.e. a stored field.)
 *
 * ⇒ A walker that wants to recognise the recursion point by reference CAN do it
 * today, for all ten, by reading `_zod.innerType`. The objectui#7581 script's
 * false negative — `ActionSchema` reported "not exported by name" when it plainly
 * is — was the wrong handle, not an unrecognisable schema. Memoising is still
 * worth doing where it is free, because it makes the PUBLIC `.unwrap()` honest.
 *
 * ## 3. The card's consequence ② does not reproduce
 *
 * The card recorded, explicitly unmeasured, that "a document with N nodes
 * reconstructs the whole recursive sub-schema N times". Measured, it does not:
 * the getter runs ONCE per lazy for the lifetime of the process, because of the
 * same `_cachedInner`. `consequence2` below pins it — one call during the first
 * parse of a 13-node document, zero during the second.
 *
 * Wall clock agrees. `NavigationItemSchema` parsing a 73-node document, memoised
 * vs. not, same tree, same process count, medians of nine trials of 200 parses:
 * 149,973 ns vs 140,293 ns per parse — ratio 0.94x, with the two ranges
 * overlapping (143,913–153,846 vs 137,266–149,399). Shared-box seconds, so the
 * absolutes are not idle-machine figures; the ratio is the reading, and the
 * reading is "no difference". ⛔ There is no parse-time win here to claim.
 *
 * ## If you are here to memoise the other eight
 *
 * The naive shape cannot work — that is measured above. A shape that COULD is to
 * hoist each body to a module const and push the self-reference behind an inner
 * `z.lazy(() => X)`, the way `NavigationItemSchema.children` already does. That
 * is deliberately NOT taken here: it trades one identity for another, since
 * `children` is currently `z.array(TreeNodeSchema)` — whose element IS the
 * exported schema — and the rewrite replaces that element with a fresh anonymous
 * wrapper. With consequence ② disproved and `_zod.innerType` already stable,
 * the remaining prize is only public `.unwrap()` identity. Whoever prices the
 * strict face (objectui#7935 / objectstack#5250) should make that trade
 * deliberately. Update this ledger in the same change.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ActionSchema,
  AppMenuItemSchema,
  FilterBuilderConditionSchema,
  FilterGroupSchema,
  MenuItemSchema,
  NavLinkSchema,
  NavigationItemSchema,
  NavigationMenuItemSchema,
  SchemaNodeSchema,
  TreeNodeSchema,
} from '../zod/index.zod.js';
import { MenuItemSchema as AppMenuItemSource } from '../zod/app.zod.js';
import { MenuItemSchema as OverlayMenuItemSource } from '../zod/overlay.zod.js';

type LazyInternals = { _zod: { def: { getter: () => unknown }; innerType: unknown } };
type Unwrappable = { unwrap: () => unknown };

/** `S._zod.def.getter() === S._zod.def.getter()` — the card's one-line probe. */
const getterStable = (S: unknown): boolean => {
  const { getter } = (S as LazyInternals)._zod.def;
  return getter() === getter();
};
/** The PUBLIC accessor. `ZodLazy` spells it `() => inst._zod.def.getter()`. */
const unwrapStable = (S: unknown): boolean => (S as Unwrappable).unwrap() === (S as Unwrappable).unwrap();
/** zod's own cached handle, filled once into `def._cachedInner`. */
const innerTypeStable = (S: unknown): boolean => (S as LazyInternals)._zod.innerType === (S as LazyInternals)._zod.innerType;

const MEMOISED: ReadonlyArray<readonly [string, unknown]> = [
  ['FilterBuilderConditionSchema', FilterBuilderConditionSchema],
  ['NavigationItemSchema', NavigationItemSchema],
  // objectui#8344 — see the header. Its getter returns the ONE node union that
  // `base.zod.ts` builds below `BaseSchemaCore`, so there is no TDZ left to dodge.
  ['SchemaNodeSchema', SchemaNodeSchema],
  // objectui#9306 — see the header. Its `conditions` became flat rows, so the
  // body no longer names `FilterGroupSchema` and there is no TDZ left to dodge.
  ['FilterGroupSchema', FilterGroupSchema],
];
/** ⛔ Do not "fix" these — each one's `z.lazy` dodges a real ReferenceError. */
const TDZ_BOUND: ReadonlyArray<readonly [string, unknown]> = [
  ['ActionSchema', ActionSchema],
  ['AppMenuItemSchema', AppMenuItemSchema],
  ['MenuItemSchema', MenuItemSchema],
  ['NavLinkSchema', NavLinkSchema],
  ['NavigationMenuItemSchema', NavigationMenuItemSchema],
  ['TreeNodeSchema', TreeNodeSchema],
];

describe('objectui#7918 · z.lazy getter identity', () => {
  // ── Controls ───────────────────────────────────────────────────────────
  // A `false` below is only a reading if a positive control that MUST hit does
  // hit. Without this pair, "everything answers false" is equally consistent
  // with the probe being broken.
  describe('controls', () => {
    it('POSITIVE: a z.lazy whose getter returns a module-level constant is stable', () => {
      const moduleLevelConst = z.object({ a: z.string() });
      expect(getterStable(z.lazy(() => moduleLevelConst))).toBe(true);
    });

    it('NEGATIVE: a z.lazy whose getter builds fresh is not stable', () => {
      expect(getterStable(z.lazy(() => z.object({ a: z.string() })))).toBe(false);
    });
  });

  // ── The mechanism the eight are dodging ────────────────────────────────
  describe('mechanism', () => {
    it('the naive memoisation throws when the body names the const being declared', () => {
      const naiveMemoisation = (): z.ZodType<unknown> => {
        // `const inner = <body>; z.lazy(() => inner)` with a self-referencing
        // body — the exact shape all ten would take. The body is built EAGERLY,
        // so it reads `Recursive` while `Recursive` is still in its temporal
        // dead zone.
        const inner: z.ZodType<unknown> = z.object({
          // @ts-expect-error TS2448 — used before declaration, which is the point.
          children: z.array(Recursive).optional(),
        });
        const Recursive: z.ZodType<unknown> = z.lazy(() => inner);
        return Recursive;
      };
      expect(naiveMemoisation).toThrow(ReferenceError);
    });
  });

  // ── The ledger ─────────────────────────────────────────────────────────
  describe('ledger', () => {
    it.each(MEMOISED)('%s is memoised — public unwrap() compares by identity', (_name, S) => {
      expect(getterStable(S)).toBe(true);
      expect(unwrapStable(S)).toBe(true);
    });

    it.each(TDZ_BOUND)('%s stays lazy-per-call — memoising it is a module-load ReferenceError', (_name, S) => {
      expect(getterStable(S)).toBe(false);
      expect(unwrapStable(S)).toBe(false);
    });
  });

  // ── Consequence ①, corrected ───────────────────────────────────────────
  describe('the recursion point IS identity-comparable today, via _zod.innerType', () => {
    it.each([...MEMOISED, ...TDZ_BOUND])(
      '%s has a stable _zod.innerType even when its getter is not stable',
      (_name, S) => { expect(innerTypeStable(S)).toBe(true); },
    );

    it('the cached identity survives a .describe() clone, which is what zod caches it for', () => {
      const clone = TreeNodeSchema.describe('a clone');
      expect((clone as unknown as LazyInternals)._zod.innerType)
        .toBe((TreeNodeSchema as unknown as LazyInternals)._zod.innerType);
    });
  });

  // ── Consequence ②, disproved ───────────────────────────────────────────
  describe('the schema is NOT rebuilt per parse', () => {
    it('the getter runs once per lazy for the life of the process, not once per node', () => {
      let calls = 0;
      const Recursive: z.ZodType<unknown> = z.lazy(() => {
        calls += 1;
        return z.object({ id: z.string(), children: z.array(Recursive).optional() });
      });
      // 13 nodes: 1 root + 3 children + 9 grandchildren.
      const doc = {
        id: 'r',
        children: Array.from({ length: 3 }, (_, i) => ({
          id: `c${i}`,
          children: Array.from({ length: 3 }, (_, j) => ({ id: `g${i}${j}` })),
        })),
      };
      expect(calls).toBe(0);
      expect(Recursive.safeParse(doc).success).toBe(true);
      expect(calls).toBe(1); // not 13, and not 4
      expect(Recursive.safeParse(doc).success).toBe(true);
      expect(calls).toBe(1); // still 1 — `def._cachedInner` holds it
    });
  });

  // ── What `AppMenuItemSchema` is ────────────────────────────────────────
  // The card lists both `AppMenuItemSchema` and `MenuItemSchema`. Triage could
  // not find a declaration named `AppMenuItemSchema` and refused to conclude it
  // does not exist. It exists: it is the BARREL ALIAS of `app.zod.ts`'s
  // `MenuItemSchema` (`index.zod.ts`: `MenuItemSchema as AppMenuItemSchema`),
  // while the barrel's own `MenuItemSchema` comes from `overlay.zod.ts`. Two
  // different schemas, so the card's list really is ten entries, not nine.
  describe('AppMenuItemSchema is a barrel alias, not a missing declaration', () => {
    it('resolves to app.zod.ts MenuItemSchema', () => {
      expect(AppMenuItemSchema).toBe(AppMenuItemSource);
    });

    it('is a different schema from the barrel MenuItemSchema, which is overlay.zod.ts', () => {
      expect(MenuItemSchema).toBe(OverlayMenuItemSource);
      expect(AppMenuItemSchema).not.toBe(MenuItemSchema);
    });
  });

  // ── The two changed schemas still parse what they parsed ───────────────
  describe('memoisation moved no accept/reject behaviour', () => {
    it('NavigationItemSchema still accepts a nested navigation tree', () => {
      const doc = {
        id: 'root', type: 'group', label: 'Root',
        children: [
          { id: 'crm', type: 'group', label: 'CRM',
            children: [{ id: 'acct', type: 'object', label: 'Accounts', objectName: 'account' }] },
          { type: 'separator' },
        ],
      };
      expect(NavigationItemSchema.safeParse(doc).success).toBe(true);
    });

    it('NavigationItemSchema still runs its superRefine on nested children', () => {
      // `id` missing on a non-separator child — the refinement, not the
      // field declarations, is what refuses this. (The trigger was a missing
      // `label` until objectui#9868 made `label` optional to match the spec;
      // `id` is the requirement the refinement still re-imposes.)
      const bad = {
        id: 'root', type: 'group', label: 'Root',
        children: [{ type: 'object', label: 'Accounts', objectName: 'account' }],
      };
      expect(NavigationItemSchema.safeParse(bad).success).toBe(false);
      // Control: the same child WITH its id is accepted, so the refusal above
      // is the id rule and not something else about the fixture.
      const good = {
        id: 'root', type: 'group', label: 'Root',
        children: [{ id: 'acct', type: 'object', label: 'Accounts', objectName: 'account' }],
      };
      expect(NavigationItemSchema.safeParse(good).success).toBe(true);
    });

    it('FilterBuilderConditionSchema still accepts a condition and refuses a bad operator', () => {
      // ⚠️ Both fixtures carry `id` since objectui#8415 declared it REQUIRED on
      // the condition. The NEGATIVE one carries it for a reason that is not
      // cosmetic: without it the row would be refused for the MISSING KEY, and
      // this assertion — whose subject is `FilterOperatorSchema` — would stay
      // green with the operator vocabulary deleted outright. Carrying `id`
      // isolates the operator as the only thing left to refuse it.
      expect(FilterBuilderConditionSchema.safeParse(
        { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 },
      ).success).toBe(true);
      expect(FilterBuilderConditionSchema.safeParse(
        { id: 'c1', field: 'amount', operator: 'not_a_real_operator' },
      ).success).toBe(false);
    });

    it('FilterGroupSchema still accepts flat condition rows through the memoised arm', () => {
      // The CONDITION rows carry `id` (required since objectui#8415); the
      // GROUP's `id` stays what it always was — declared but optional. This
      // test used to parse a nested sub-group as well: objectui#9306 retired
      // nesting and the group now REFUSES a sub-group by name, so that arm is
      // pinned in `filter-builder-nested-group-retired-9306.test.ts` rather than
      // kept here as an accept it no longer is.
      const group = {
        id: 'g1', logic: 'and',
        conditions: [
          { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 },
          { id: 'c2', field: 'stage', operator: 'equals', value: 'won' },
        ],
      };
      expect(FilterGroupSchema.safeParse(group).success).toBe(true);
      expect(FilterGroupSchema.safeParse({ logic: 'and', conditions: [{ id: 'c1', field: 'amount', operator: 'not_a_real_operator' }] }).success)
        .toBe(false);
    });
  });
});
