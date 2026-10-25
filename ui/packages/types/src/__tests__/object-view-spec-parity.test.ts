/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectView ↔ @objectstack/spec drift guard (#2890 scope B).
 *
 * The sibling of `list-view-spec-parity.test.ts`, for the node that never had
 * one. The 2026-07 audit (`docs/audits/2026-07-objectview-detailview-schema.md`,
 * PR #2934) opened with exactly this gap: *"Add a drift guard modelled on
 * `list-view-spec-parity.test.ts`. Without one, [making the declaration honest]
 * decays immediately — that test is the only reason `ListViewSchema` stayed
 * honest."* This is that guard, and it lands BEFORE any restructuring so the
 * restructure has a baseline to be measured against.
 *
 * ## What this guard does NOT do, and why
 *
 * The audit's step 1 was "make the declaration match the reads (the 28
 * undeclared keys)". That step has since been **ruled the other way**, and this
 * guard must not quietly re-open it. Maintainer, 2026-08-18 on objectui#5097,
 * verbatim 「同意」: the keys the `renderListView` delegation branch reads off
 * the node are HOST-COMPOSITION surface, not authored surface, and are
 * deliberately NOT declared on `ObjectViewSchema`. Their home is
 * `OBJECT_VIEW_HOST_COMPOSITION_KEYS` in `plugin-view/src/ObjectView.tsx`, and
 * `plugin-view/src/__tests__/objectViewHostSurface.test.tsx` already pins them
 * by name from the side that can actually read the source.
 *
 * So the reads half is guarded, and guarded where it belongs. What had no
 * guard at all is the **declared** surface — which is what this file covers:
 *
 *   1. The declaration is internally consistent: the zod shape and the TS
 *      interface describe the same node. The audit measured them apart (zod 13
 *      keys, TS 25), and nothing caught it. The gap is pinned below so it can
 *      shrink but never grow.
 *   2. Every declared key that has a spec counterpart still has a LIVE one —
 *      see the tombstone section, which is the whole reason this file exists in
 *      the shape it does.
 *   3. No declared key sits outside the sanctioned set, forcing a conscious
 *      promote / keep-local / drop decision on every new field — the same
 *      forcing function `list-view-spec-parity.test.ts` applies.
 *
 * When one of these fails, do NOT edit the sets to make it green. Decide
 * whether the field belongs upstream in `@objectstack/spec` (promote it) or is
 * a genuine objectui-only extension (add it with a rationale). See #2890.
 */
import { describe, it, expect } from 'vitest';
import {
  ListViewSchema as SpecListViewSchema,
  UserActionsConfigSchema as SpecUserActionsConfigSchema,
  NavigationConfigSchema as SpecNavigationConfigSchema,
  AddRecordConfigSchema as SpecAddRecordConfigSchema,
  ViewSchema as SpecViewSchema,
} from '@objectstack/spec/ui';
import { ObjectViewSchema as OuiObjectViewSchema } from '../zod/objectql.zod.js';
import { BaseSchema as OuiBaseSchema } from '../zod/base.zod.js';
import type { ObjectViewSchema as ObjectViewInterface } from '../objectql.js';
import type { BaseSchema as BaseInterface } from '../base.js';

// ── zod introspection ────────────────────────────────────────────────────────

type ShapeCarrier = { shape?: unknown; _def?: { shape?: unknown } };

/** Top-level keys of a zod object, INCLUDING ADR-0087 tombstones. */
function shapeKeys(schema: unknown): string[] {
  const carrier = schema as ShapeCarrier | undefined;
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return resolved && typeof resolved === 'object' ? Object.keys(resolved) : [];
}

/**
 * One entry of `.shape`, unwrapped past a single `.optional()` / `.default()`.
 *
 * Deliberately ONE unwrap, not a loop. A loop keeps calling `.unwrap()` while
 * the member has one, and in zod 4 `ZodArray` has one too — so a loop walks
 * `z.array(z.string())` down to `string` and reports an array field as a scalar.
 * A tombstone is never more than one wrapper deep, so one hop is both
 * sufficient and safe.
 */
function shapeMember(schema: unknown, key: string): unknown {
  const carrier = schema as ShapeCarrier | undefined;
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = (typeof shape === 'function' ? (shape as () => object)() : shape) as
    | Record<string, unknown>
    | undefined;
  const member = resolved?.[key] as { unwrap?: () => unknown } | undefined;
  return typeof member?.unwrap === 'function' ? member.unwrap() : member;
}

/** One entry of `.shape`, with NO unwrapping — for identity comparisons. */
function shapeMemberRaw(schema: unknown, key: string): unknown {
  const carrier = schema as ShapeCarrier | undefined;
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = (typeof shape === 'function' ? (shape as () => object)() : shape) as
    | Record<string, unknown>
    | undefined;
  return resolved?.[key];
}

/**
 * Is this key an ADR-0087 D2 tombstone — declared, but typed `never` so every
 * value is rejected with a named migration message?
 *
 * ⛔ THIS IS THE DIFFERENCE BETWEEN A GUARD AND A GUARD-SHAPED NO-OP, and it is
 * the reason this file cannot be a copy of its sibling.
 *
 * A D2 retirement does NOT delete the key from the shape; it REPLACES the
 * member with `z.never()`. So a retired key still answers `Object.keys(shape)`,
 * and any parity check spelled "is this key present in the spec shape" reports
 * a RETIRED key as LIVE and passes. That is not hypothetical and it is not
 * historical: measured on this card (2026-08-11), `RecordDetailsProps.layout`
 * survived the 17.0.0-rc.6 bump undetected with every derived gate green,
 * precisely this way. PR #4245 fixed it for `record:details` by filtering
 * members whose unwrapped type is `never`; this file inherits that filter, and
 * the suite below asserts the filter actually bites on the CURRENT pin rather
 * than trusting that it would.
 */
function isTombstoned(schema: unknown, key: string): boolean {
  const member = shapeMember(schema, key) as
    | { _def?: { type?: string }; def?: { type?: string } }
    | undefined;
  return (member?._def?.type ?? member?.def?.type) === 'never';
}

/** Keys the spec actually ACCEPTS — tombstones removed. */
function specLiveKeys(schema: unknown): string[] {
  return shapeKeys(schema).filter((key) => !isTombstoned(schema, key));
}

/** Does the spec still offer this key as something an author may write? */
function specDeclaresLive(schema: unknown, key: string): boolean {
  return shapeKeys(schema).includes(key) && !isTombstoned(schema, key);
}

// ── the declared surface ─────────────────────────────────────────────────────

const ouiZodKeys = shapeKeys(OuiObjectViewSchema);
const ENVELOPE = new Set(shapeKeys(OuiBaseSchema));

/**
 * Envelope keys this node REDECLARES with a narrower type.
 *
 * Detected by member IDENTITY against `BaseSchema`, not by a hand-written list:
 * `BaseSchema.extend()` copies the envelope's 21 members in, so a key that is
 * still the base's own member is inherited, and one that is a different object
 * was deliberately narrowed on this node (`type: z.literal('object-view')`,
 * `description: z.string()`). They are part of the node's declared surface and
 * must be triaged like any other key — dropping them because their NAME also
 * appears on the envelope is how a redeclaration escapes review.
 */
const redeclaredEnvelopeKeys = ouiZodKeys.filter(
  (k) =>
    ENVELOPE.has(k) &&
    shapeMemberRaw(OuiObjectViewSchema, k) !== shapeMemberRaw(OuiBaseSchema, k),
);

/** The node's own zod surface: non-envelope keys plus the narrowed envelope ones. */
const ouiDeclaredKeys = [
  ...ouiZodKeys.filter((k) => !ENVELOPE.has(k)),
  ...redeclaredEnvelopeKeys,
];

/**
 * The EXPLICITLY DECLARED keys of an interface, with any index signature
 * filtered out.
 *
 * ⛔ The plain `keyof` spelling did not work here, and silently produced a
 * guard-shaped no-op rather than an error, while `BaseSchema` ended with
 * `[key: string]: any` (`packages/types/src/base.ts`) — the escape hatch that
 * let component nodes carry type-specific extensions until objectui#8347
 * removed it. Any interface extending it therefore had `keyof` =
 * `string | number`, so `Exclude<keyof ObjectViewInterface, keyof BaseInterface>`
 * collapsed to `never`, `Record<never, true>` was `{}`, and the exhaustiveness
 * check below accepted literally any object — including one missing half the
 * node's keys.
 *
 * Measured, not reasoned: with the `keyof` spelling, deleting `viewActions`
 * from the record left `pnpm --filter @object-ui/types type-check` green.
 * The key-remapping filter below drops `string`/`number` index members and
 * keeps the declared names, which restores the error.
 *
 * This is also the deeper reason the TS half of this node drifted unnoticed for
 * so long: the same index signature meant the interface never rejected an
 * undeclared key either (until objectui#8347).
 */
type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: unknown;
};

/**
 * Every own key of the `ObjectViewSchema` TS interface — the half of the
 * declaration that zod cannot see.
 *
 * The COMPILER owns this list, not the author: `Record<K, true>` over the
 * interface's own keys rejects both a missing entry and a stray one, so it
 * cannot silently rot the way a hand-copied string array would. `Exclude`
 * drops the `BaseSchema` envelope (including the interface's own redundant
 * `className` redeclaration), leaving exactly the node's own surface.
 */
type ObjectViewOwnKey = Exclude<KnownKeys<ObjectViewInterface>, KnownKeys<BaseInterface>>;
const TS_OWN_KEYS: Record<ObjectViewOwnKey, true> = {
  objectName: true,
  title: true,
  layout: true,
  defaultViewType: true,
  listViews: true,
  defaultListView: true,
  navigation: true,
  table: true,
  form: true,
  searchableFields: true,
  filterableFields: true,
  showSearch: true,
  showFilters: true,
  showSort: true,
  showCreate: true,
  showRefresh: true,
  showViewSwitcher: true,
  operations: true,
  onNavigate: true,
  viewTabBar: true,
  allowCreateView: true,
  viewActions: true,
};
const tsOwnKeys = Object.keys(TS_OWN_KEYS);

/**
 * Declared in the TS interface but NOT in the zod shape — the audit's central
 * measurement for this node, pinned so it can only shrink.
 *
 * This is a BACKLOG, not an allowance. Every entry is a key an author can write
 * in TypeScript and have the CLI validator / VS Code extension ignore, because
 * those parse through zod. Closing one means adding it to the zod shape and
 * deleting it from here; a NEW name appearing here means a key was added to the
 * interface only, which is the drift this guard exists to stop.
 */
const TS_ONLY_BACKLOG = new Set<string>([
  // objectui#7779 (maintainer ruling B, 2026-09-06) closed nine of the ten gaps
  // this set held: `navigation` / `searchableFields` / `filterableFields` are the
  // spec's `ListViewSchema` slots by reference, `allowCreateView` / `viewActions`
  // the sibling `ViewSwitcherSchema` slots by reference, `defaultViewType` /
  // `defaultListView` / `showViewSwitcher` local literals after a reader census,
  // and `viewTabBar` is a tombstone on BOTH faces (declared, refused by name) —
  // so none of the nine is TS-only any more.
  //
  // ⭐ `listViews`, the tenth, LEFT this backlog with objectui#7928. Its value
  // type was the open question (the declaration's `NamedListView` vs the spec's
  // strict `ObjectListViewSchema`); ruling A chose the spec's, and both faces
  // now carry `ViewSchema.listViews` by reference. The set is empty, and a name
  // appearing in it again is a key added to the interface only.
  // ⭐ `onNavigate` LEFT this backlog with objectui#7804's `objectql.ts` slice,
  // and the sentence it used to carry here was the thing that needed correcting
  // — not the entry. It read "a function, so it CANNOT be declared in a JSON
  // protocol schema", and the second half does not follow from the first: a
  // function value cannot be AUTHORED, but the key can absolutely be DECLARED —
  // as a named refusal (`handlerKeyRefusal`, the objectui#6124 shape), which is
  // what the mirror now carries. Leaving it undeclared did not keep the key out
  // of an authored document; `BaseSchema` is `.passthrough()`, so an authored
  // `onNavigate` was ACCEPTED, KEPT, and handed to the four call sites in
  // `plugin-view`'s `ObjectView` that invoke it.
]);

/**
 * Declared `object-view` keys whose concept the spec already models, and where.
 *
 * The audit's promote / align / rename column, made executable. The point is
 * not that objectui uses the spec's spelling today — it mostly does not — but
 * that the counterpart it would be renamed ONTO still exists upstream and is
 * still LIVE. A tombstoned counterpart silently turns the migration plan into a
 * plan to adopt a rejected key, which is precisely the failure the
 * `record:details` mirror hit.
 */
const SPEC_COUNTERPART: Record<string, { schema: unknown; key: string; note: string }> = {
  title: { schema: SpecListViewSchema, key: 'label', note: 'spec types it as I18nLabel; promoting means accepting the i18n envelope' },
  description: { schema: SpecListViewSchema, key: 'description', note: 'same name, same i18n type difference' },
  layout: { schema: SpecNavigationConfigSchema, key: 'mode', note: 'spec is a superset; fold into `navigation`, do not keep a parallel three-value enum' },
  defaultViewType: { schema: SpecListViewSchema, key: 'type', note: 'spec is a superset (adds chart, tree); ListViewSchema already imports this enum by reference' },
  navigation: { schema: SpecListViewSchema, key: 'navigation', note: 'DONE (objectui#7779): the zod mirror is this very slot by reference (`SpecListViewSchema.shape.navigation`); the TS face is the spec\'s `NavigationConfig` (objectui#4588)' },
  searchableFields: { schema: SpecListViewSchema, key: 'searchableFields', note: 'DONE (objectui#7779): the zod mirror is this slot by reference' },
  showSearch: { schema: SpecUserActionsConfigSchema, key: 'search', note: 'scope A step 3, same fold' },
  showFilters: { schema: SpecUserActionsConfigSchema, key: 'filter', note: 'scope A step 3, same fold' },
  showSort: { schema: SpecUserActionsConfigSchema, key: 'sort', note: 'scope A step 3, same fold' },
  showRefresh: { schema: SpecUserActionsConfigSchema, key: 'refresh', note: 'the local field has zero readers; wire the affordance to userActions.refresh rather than resurrecting it' },
  showCreate: { schema: SpecAddRecordConfigSchema, key: 'enabled', note: 'the boolean is a lossy shorthand for the spec config (position/mode/formView)' },
  table: { schema: SpecViewSchema, key: 'list', note: 'container restructure — spec ViewSchema is the ADR-0047 composite' },
  form: { schema: SpecViewSchema, key: 'form', note: 'container restructure — spec ViewSchema is the ADR-0047 composite' },
  listViews: { schema: SpecViewSchema, key: 'listViews', note: 'container restructure; isDefault lives on each view item upstream' },
};

/**
 * Declared keys with no spec counterpart — sanctioned objectui-only surface.
 *
 * Adding to this set is a deliberate act: prefer promoting the field into
 * `@objectstack/spec`. Each entry carries the audit's reason for staying.
 */
const SANCTIONED_LOCAL = new Set<string>([
  // Component discriminator, load-bearing for the ObjectQLComponentSchema
  // union. Spec's `ListViewSchema.type` is the view KIND — a different axis,
  // the same collision `viewType` documents on the list-view node.
  'type',
  // objectui-only object binding (spec binds via data.provider:'object').
  // ⛔ Blocked UPSTREAM, not here: the spec's react-blocks.ts declares
  // `objectName` a sanctioned React-tier prop and packages/lint enforces it.
  'objectName',
  // A function. Non-serializable; cannot live in a JSON protocol.
  'onNavigate',
  // CRUD affordance at the view layer. The audit flags it as arguably a drop
  // candidate too (resolveCrudAffordances is the runtime authority), but it IS
  // read, and removing it needs its own permission-semantics review.
  'operations',
  // View-management chrome. No spec counterpart —
  // `UserActionsConfigSchema.buttons` is a string[] of action ids, a different
  // shape. `allowCreateView` / `viewActions` are READ (forwarded verbatim into
  // the `view-switcher` node) and mirrored by reference to that sibling's slots
  // (objectui#7779); `viewTabBar` is RETIRED by the same card — a `?: never` /
  // `retirementTombstone()` twin, still DECLARED on both faces so an authored
  // value is refused by name, which is why it stays in this set: the spec models
  // no such key, and the tombstone is objectui-only surface.
  'allowCreateView',
  'viewActions',
  'viewTabBar',
  // Derivable — `appearance.allowedVisualizations.length > 1` is how
  // ObjectDataPage and InterfaceListPage already compute it. Keep local only
  // until those two are the single source; then drop.
  'showViewSwitcher',
  // Points at objectui's own named-view record, not a spec key.
  'defaultListView',
  // The two content channels, redeclared ONLY as named refusals (objectui#9256,
  // the E3 residual): `ObjectView` reads neither, so both are `?: never` /
  // `neitherContentChannel()` twins — declared so an authored child list is
  // refused by name instead of rendering nothing. The spec's view models no child
  // list on this node, so the refusal is objectui-only surface, as `viewTabBar`'s is.
  'body',
  'children',
  // RE-TRIAGED at the pin move to `@objectstack/spec` 18.0.0 (objectui#13261),
  // out of SPEC_COUNTERPART, as that entry's note said it would be: the spec
  // retired the list view's `filterableFields` (objectstack#24640, ruling C: no
  // per-view Filter-panel whitelist replaces it), so its counterpart is a
  // tombstone and there is nothing to rename onto. Both faces still DECLARE the
  // key — the zod mirror and the TS face are the spec's slot by reference, which
  // is now the spec's `never` — so an authored value is refused by name with the
  // spec's own prescription, the footing `viewTabBar` stands on. Read by
  // nothing since objectui#13118.
  'filterableFields',
]);

// ── the suite ────────────────────────────────────────────────────────────────

describe('the ADR-0087 tombstone filter this guard is built on (#2890)', () => {
  // The spec pin objectui currently resolves carries live tombstones. That is
  // what makes the filter testable here rather than merely asserted.
  const declared = shapeKeys(SpecListViewSchema);
  const live = specLiveKeys(SpecListViewSchema);

  it('the naive spelling and the tombstone-aware spelling DISAGREE on the current pin', () => {
    // If this ever equalises, the filter stops being exercised by real data and
    // the pins below become the only thing holding it — say so loudly rather
    // than letting the guard quietly lose its teeth.
    expect(live.length).toBeLessThan(declared.length);
  });

  it('reports retired ListView keys as DECLARED but not LIVE', () => {
    // objectstack#7176 retired all five (maintainer-ruled 2026-08-10). They flow
    // into objectui's ListViewSchema by reference on purpose, tombstones and
    // all, so an author writing one gets a named rejection instead of silence.
    for (const retired of ['striped', 'bordered', 'virtualScroll', 'responsive', 'performance']) {
      expect(declared, `${retired} should still be declared`).toContain(retired);
      expect(isTombstoned(SpecListViewSchema, retired), `${retired} should read as a tombstone`).toBe(true);
      expect(live, `${retired} must not read as live`).not.toContain(retired);
    }
  });

  it('does not mistake a live key for a tombstone', () => {
    // The control. Without it "everything is a tombstone" would pass the above.
    for (const alive of ['columns', 'filter', 'userActions', 'navigation', 'searchableFields']) {
      expect(isTombstoned(SpecListViewSchema, alive), `${alive} is live`).toBe(false);
      expect(live).toContain(alive);
    }
  });

  it('unwraps exactly one level, so an array field is not read as its element', () => {
    // Regression pin on the helper itself: a loop-unwrap walks
    // `z.array(z.string())` down to `string`. Measured while writing this file.
    expect(shapeKeys(SpecListViewSchema)).toContain('searchableFields');
    expect(isTombstoned(SpecListViewSchema, 'searchableFields')).toBe(false);
  });
});

describe('ObjectViewSchema declared-surface consistency (#2890 scope B)', () => {
  it('declares nothing in zod that the TS interface does not also declare', () => {
    // Direction that must stay empty: zod is the narrower of the two today, and
    // a zod-only key would mean the CLI validator accepts what the TS type
    // rejects. The redeclared envelope keys are excluded because the interface
    // redeclares them too, under names the envelope also owns.
    const zodOnly = ouiDeclaredKeys.filter(
      (k) => !tsOwnKeys.includes(k) && !redeclaredEnvelopeKeys.includes(k),
    );
    expect(zodOnly).toEqual([]);
  });

  it('narrows exactly the four envelope keys the node means to narrow', () => {
    // Mechanically derived, so a FIFTH redeclaration — the usual way a node
    // quietly re-types `data` or `name` out from under the envelope — fails here.
    // `body` / `children` joined `description` / `type` with objectui#9256 (the E3
    // residual): both are redeclared ONLY as named refusals, because the renderer
    // reads neither content channel.
    expect([...redeclaredEnvelopeKeys].sort()).toEqual(['body', 'children', 'description', 'type']);
  });

  it('has exactly the known TS-only backlog — it may shrink, never grow', () => {
    const tsOnly = tsOwnKeys.filter((k) => !ouiZodKeys.includes(k)).sort();
    expect(
      tsOnly,
      'A key was added to the ObjectViewSchema TS interface without adding it to the zod\n'
        + 'shape (or an existing gap was closed). The zod shape is what the CLI validator and\n'
        + 'the VS Code extension parse, so a TS-only key is a key authors can write and no\n'
        + 'tool checks. Close the gap in `zod/objectql.zod.ts`, or — if you closed one —\n'
        + 'delete the name from TS_ONLY_BACKLOG in the same change.',
    ).toEqual([...TS_ONLY_BACKLOG].sort());
  });

  it('reproduces the 2026-07 audit\'s declared-surface figures, moved by objectui#7779', () => {
    // Kept executable so "we closed the gap" is a test edit, not a claim.
    //
    // The audit reported "declared in zod: 13" — reproduced then as 11
    // non-envelope keys plus the 2 narrowed envelope keys above. objectui#7779
    // added NINE members to the zod shape (eight mirrored keys plus the
    // `viewTabBar` tombstone, which is a shape member so it can refuse by name):
    // 11 + 9 = 20 non-envelope keys, 20 + 2 = 22 declared. The TS figure below
    // did not move — every one of the nine was already declared there.
    //
    // objectui#7804's `objectql.ts` slice added the TWENTY-FIRST: `onNavigate`,
    // a shape member that refuses by name, the same way `viewTabBar` is one. So
    // 21 non-envelope keys, 21 + 2 = 23 declared — and the TS figure below again
    // does not move, because the key was already declared there. That is the
    // whole shape of this slice: it closes gaps on the ZOD side only.
    //
    // objectui#7928 added the TWENTY-SECOND: `listViews`, the spec's record by
    // reference — the last TS-only key closed on the zod side. So 22
    // non-envelope keys, 22 + 2 = 24 declared, and the TS figure again does not
    // move.
    //
    // objectui#9256 (the E3 residual) redeclared two ENVELOPE keys, `body` and
    // `children`, as named refusals: 22 non-envelope keys still, 22 + 4 = 26
    // declared. The TS figure below does not move either — both keys are
    // `BaseSchema`'s, so the compiler attributes them to the envelope.
    expect(ouiZodKeys.filter((k) => !ENVELOPE.has(k))).toHaveLength(22);
    expect(ouiDeclaredKeys).toHaveLength(26);
    // The interface's own surface beyond the envelope. The audit counted 25
    // declared fields including the 3 whose names the envelope also owns
    // (`type`, `description`, `className`); 22 is that figure with those three
    // attributed to the envelope, which is where the compiler puts them.
    expect(tsOwnKeys).toHaveLength(22);
  });
});

describe('ObjectViewSchema spec anchors are still LIVE upstream (#2890 scope B)', () => {
  it.each(Object.keys(SPEC_COUNTERPART))(
    '`%s` still has a live spec counterpart to be renamed onto',
    (key) => {
      const { schema, key: specKey, note } = SPEC_COUNTERPART[key];
      expect(shapeKeys(schema), `spec dropped \`${specKey}\` — ${note}`).toContain(specKey);
      expect(
        isTombstoned(schema, specKey),
        `spec RETIRED \`${specKey}\` (ADR-0087 tombstone) — the migration plan for objectui's\n`
          + `\`${key}\` now points at a key the protocol rejects. Re-triage before renaming.\n`
          + `Audit note: ${note}`,
      ).toBe(false);
    },
  );

  it('covers every declared key: mapped upstream, sanctioned local, or a TS-only gap', () => {
    // The forcing function. A new field on this node lands in none of the three
    // buckets and fails here, making promote / keep-local / drop a conscious
    // decision instead of a default.
    const all = [...new Set([...ouiDeclaredKeys, ...tsOwnKeys])];
    const untriaged = all.filter(
      (k) => !(k in SPEC_COUNTERPART) && !SANCTIONED_LOCAL.has(k),
    );
    expect(
      untriaged,
      'A key on the `object-view` node is declared but not triaged. Decide where it belongs:\n'
        + 'add it to SPEC_COUNTERPART (the spec already models the concept — it should be\n'
        + 'renamed/re-exported onto that key) or to SANCTIONED_LOCAL with a rationale.\n'
        + '⛔ If it is a key the `renderListView` branch reads, it is HOST surface and must NOT\n'
        + 'be declared at all — see the objectui#5097 ruling of 2026-08-18.',
    ).toEqual([]);
  });

  it('keeps SANCTIONED_LOCAL honest — no entry that the spec does model', () => {
    // A local key whose concept the spec grew since is a promotion that never
    // happened. `objectName` is the deliberate exception: the spec DOES declare
    // it, as a React-tier prop, which is exactly why A6 is blocked upstream.
    const shadowing = [...SANCTIONED_LOCAL].filter(
      (k) => k !== 'objectName' && k !== 'type' && specDeclaresLive(SpecListViewSchema, k),
    );
    expect(shadowing).toEqual([]);
  });
});

describe('the passthrough that made this drift invisible (#2890 scope B)', () => {
  it('accepts undeclared keys, because BaseSchema is passthrough', () => {
    // Load-bearing in BOTH directions, which is why it is pinned rather than
    // merely noted. It is WHY the declared surface could drift unnoticed — and
    // it is also what lets the 27 ruled-exempt host-composition keys ride the
    // node at all. Making this schema strict would start rejecting stored
    // app-shell documents; that must be a deliberate, loud change.
    const parsed = OuiObjectViewSchema.safeParse({
      type: 'object-view',
      objectName: 'accounts',
      wrapHeaders: true,        // host-composition surface, deliberately undeclared
      collapseAllByDefault: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data as Record<string, unknown>).wrapHeaders).toBe(true);
  });

  it('still requires the discriminator and the object binding', () => {
    expect(OuiObjectViewSchema.safeParse({ objectName: 'accounts' }).success).toBe(false);
    expect(OuiObjectViewSchema.safeParse({ type: 'object-view' }).success).toBe(false);
    expect(
      OuiObjectViewSchema.safeParse({ type: 'object-view', objectName: 'accounts' }).success,
    ).toBe(true);
  });
});
