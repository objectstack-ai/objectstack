/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ListView ↔ @objectstack/spec drift guard (issue #2231).
 *
 * objectui's `ListViewSchema` (packages/types/src/zod/objectql.zod.ts) is DERIVED from
 * the spec's `ListViewSchema` (`@objectstack/spec/ui`): spec-owned fields flow in by
 * reference, and only objectui-only / legacy fields are declared locally. That derivation
 * means new spec fields are picked up automatically — but it can still silently break in
 * three ways, which these tests catch:
 *
 *   1. The spec grows a field objectui never triaged (would flow in unnoticed, or — if the
 *      omit list references it — vanish). We assert every spec field is present in the
 *      objectui shape (or explicitly envelope-owned by BaseSchema).
 *   2. The spec RENAMES/REMOVES a field objectui specifically aliases or relaxes
 *      (`type` → `viewType`, `columns` relaxed, `filter` alongside legacy `filters`). The
 *      alias would then point at nothing. We assert those anchors still exist upstream.
 *   3. Someone adds an objectui-local field that shadows what should have been a spec field
 *      (re-opening the drift the unification closed). We assert every objectui-only key is
 *      in the explicitly-sanctioned local set below, forcing a conscious local-vs-upstream
 *      decision on every new field.
 *
 * When one of these fails, do NOT just edit the sets to make it green — decide whether the
 * field belongs upstream in `@objectstack/spec` (promote it) or is a genuine objectui-only
 * extension (add it to SANCTIONED_LOCAL with a rationale). See #2231.
 */
import { describe, it, expect } from 'vitest';
import {
  ListViewSchema as SpecListViewSchema,
  KanbanConfigSchema as SpecKanbanConfigSchema,
  CalendarConfigSchema as SpecCalendarConfigSchema,
  GanttConfigSchema as SpecGanttConfigSchema,
  GalleryConfigSchema as SpecGalleryConfigSchema,
  TimelineConfigSchema as SpecTimelineConfigSchema,
} from '@objectstack/spec/ui';
import { ListViewSchema as OuiListViewSchema } from '../zod/objectql.zod.js';
import { BaseSchema } from '../zod/base.zod.js';

const specShape = (SpecListViewSchema as unknown as { shape: Record<string, unknown> }).shape;
const ouiShape = (OuiListViewSchema as unknown as { shape: Record<string, unknown> }).shape;
const baseShape = (BaseSchema as unknown as { shape: Record<string, unknown> }).shape;

/** Peel `.optional()` / `.default()` wrappers off a field and return its object shape. */
function unwrapObjectShape(schema: unknown): Record<string, unknown> {
  let cur = schema as { unwrap?: () => unknown; shape?: Record<string, unknown> };
  for (let i = 0; i < 5 && cur && !cur.shape && typeof cur.unwrap === 'function'; i++) {
    cur = cur.unwrap() as typeof cur;
  }
  return cur?.shape ?? {};
}

const specKeys = Object.keys(specShape);
const ouiKeys = new Set(Object.keys(ouiShape));
// Component-envelope keys owned by BaseSchema (id, className, visible, etc.) — derived, so
// this test never needs editing when the envelope changes.
const ENVELOPE = new Set(Object.keys(baseShape));

/**
 * objectui-only ListView fields — sanctioned local extensions on top of the spec base.
 * Each is either legacy vocabulary kept for back-compat (migration to the spec-canonical
 * key is deferred — #2231) or a genuinely objectui-only renderer concern. Adding to this
 * set is a deliberate act: prefer promoting the field into `@objectstack/spec` instead.
 */
const SANCTIONED_LOCAL = new Set<string>([
  // component binding (spec binds via data.provider:'object')
  'objectName',
  // renamed spec `type` (view-kind enum); `type` itself is the component discriminator
  'viewType',
  // legacy aliases for spec `columns` / `filter`. `fields` is INPUT-ONLY since
  // #2890: `normalizeListViewSchema` (@object-ui/core) folds it into `columns`
  // at the ListView boundary and no renderer reads it. It stays declared here
  // so stored metadata keeps validating and so the spec's react-blocks
  // `<ListView fields>` prop keeps a schema anchor.
  'fields',
  // `filters` is likewise INPUT-ONLY since #2890 — folded into `filter`.
  'filters',
  // legacy toolbar visibility flags (spec-canonical: `userActions`)
  'showSearch',
  'showSort',
  'showFilters',
  'showHideFields',
  'showGroup',
  'showColor',
  'showDensity',
  'showDescription',
  'allowExport',
  // legacy density shorthand, INPUT-ONLY since #2890: `normalizeListViewSchema`
  // (@object-ui/core) folds it into the spec's `rowHeight` at the ListView
  // boundary and no renderer reads it.
  'densityMode',
  // legacy row/text coloring shorthand (spec-canonical: `rowColor`)
  'color',
  'fieldTextColor',
  'prefixField',
  // objectui renderer flags with no spec equivalent (yet)
  'wrapHeaders',
  'clickIntoRecordDetails',
  'addRecordViaForm',
  'addDeleteRecordsInline',
  'collapseAllByDefault',
  'operations',
  'options',
]);

/**
 * A THIRD category, and deliberately not a row in `SANCTIONED_LOCAL`: members
 * that are not authorable fields at all (objectui#7804).
 *
 * Each of these is a `handlerKeyRefusal` arm — a key a REGISTERED renderer
 * reads off the authored document, declared here only so that
 * `BaseSchema.passthrough()` stops KEEPING an authored value and the author
 * gets a refusal that names the key. Neither branch the docblock above offers
 * fits one: promoting it into `@objectstack/spec` would ask the protocol to
 * declare a key JSON cannot express, and calling it a "genuine objectui-only
 * extension" would say the arm accepts something. It accepts nothing.
 *
 * ⚠️ Membership here is still a deliberate act — and it is CHECKED. The test
 * below refuses a member that is not actually a refusal arm, so this set
 * cannot be used to park a real authorable field outside the drift guard.
 */
const HANDLER_KEY_REFUSALS = new Set<string>([
  'onAddRecord',
  'onBulkAction',
  'onDensityChange',
  'onNavigate',
  'onPageSizeChange',
]);

/**
 * A FOURTH category (objectui#11070): spec members that belong to the page
 * COMPONENT envelope rather than to the list view it carries.
 *
 * `dataSource` is `@objectstack/spec`'s `PageComponentSchema.dataSource` — the
 * per-element binding every page component may carry — so the spec's
 * `ListViewSchema` (a view config) has no such member, and this arm, being
 * the `list-view` NODE, declares it. Neither branch of the #2231 decision
 * fits: it is not objectui-only, and it cannot be promoted into the spec's
 * view schema because the spec already owns it one level up. It arrives by
 * reference to the spec's `ElementDataSourceSchema`; the test below checks
 * that it behaves as that binding, so this set cannot park a local field.
 */
const PAGE_COMPONENT_ENVELOPE = new Set<string>(['dataSource']);

describe('ListView spec parity (#2231 drift guard)', () => {
  it('covers every @objectstack/spec ListView field (spec cannot grow a field objectui ignores)', () => {
    // Fails when the spec adds a field that objectui neither imports nor envelope-owns —
    // i.e. a field that needs a local-vs-upstream triage decision.
    const missing = specKeys.filter((k) => !ouiKeys.has(k) && !ENVELOPE.has(k));
    expect(missing).toEqual([]);
  });

  it('keeps the spec anchors objectui remaps/relaxes (`type`, `columns`, `filter`)', () => {
    // Fails when the spec renames/removes a field objectui aliases, orphaning the alias.
    expect(specShape).toHaveProperty('type');
    expect(specShape).toHaveProperty('columns');
    expect(specShape).toHaveProperty('filter');
  });

  it('declares no objectui-only field outside the sanctioned-local set', () => {
    // Fails when a new objectui-only field is added without deciding local-vs-upstream.
    const rogue = [...ouiKeys].filter(
      (k) =>
        !specShape[k] &&
        !ENVELOPE.has(k) &&
        !SANCTIONED_LOCAL.has(k) &&
        !HANDLER_KEY_REFUSALS.has(k) &&
        !PAGE_COMPONENT_ENVELOPE.has(k),
    );
    expect(rogue).toEqual([]);
  });

  it('every PAGE_COMPONENT_ENVELOPE member is the spec binding — the set cannot hide a local field (objectui#11070)', () => {
    const node = (extra: Record<string, unknown>) => ({ type: 'list-view', objectName: 'accounts', ...extra });
    for (const key of PAGE_COMPONENT_ENVELOPE) {
      expect(ouiKeys.has(key), `${key} is listed but not declared on the arm`).toBe(true);
      // The spec's binding: a named object with the binding's own keys parses…
      expect(OuiListViewSchema.safeParse(node({ [key]: { object: 'account', view: 'hot', limit: 10 } })).success).toBe(true);
      // …a binding that names no object does not (the spec requires `object`)…
      expect(OuiListViewSchema.safeParse(node({ [key]: { view: 'hot' } })).success).toBe(false);
      // …and neither does an adapter-shaped value, which is not metadata at all.
      expect(OuiListViewSchema.safeParse(node({ [key]: 'objectstack' })).success).toBe(false);
    }
  });

  it('every HANDLER_KEY_REFUSALS member really refuses — the set cannot hide an authorable field', () => {
    const node = (extra: Record<string, unknown>) => ({
      type: 'list-view',
      objectName: 'accounts',
      ...extra,
    });

    // ⭐ CONTROL first: the same probe on a sanctioned-local key that IS
    // authorable must be accepted, or the loop below proves nothing.
    expect(OuiListViewSchema.safeParse(node({ viewType: 'grid' })).success).toBe(true);

    for (const key of HANDLER_KEY_REFUSALS) {
      expect(ouiKeys.has(key), `${key} is listed but not declared on the arm`).toBe(true);
      // Both faces of "accepts nothing": the authored action object this card
      // exists for, and a live function, which is the only value a host could
      // ever have meant.
      expect(
        OuiListViewSchema.safeParse(node({ [key]: { action: 'toast' } })).success,
        `${key} must refuse an authored action object`,
      ).toBe(false);
      expect(
        OuiListViewSchema.safeParse(node({ [key]: () => undefined })).success,
        `${key} must refuse a function value too`,
      ).toBe(false);
    }
  });

  it('preserves the component discriminator + required objectName', () => {
    const bad = OuiListViewSchema.safeParse({ objectName: 'accounts' }); // no type
    expect(bad.success).toBe(false);
    const good = OuiListViewSchema.safeParse({ type: 'list-view', objectName: 'accounts' });
    expect(good.success).toBe(true);
    const noObject = OuiListViewSchema.safeParse({ type: 'list-view' }); // no objectName
    expect(noObject.success).toBe(false);
  });

  it('accepts both legacy (fields/filters/show*) and spec-canonical (columns/filter/userActions) payloads', () => {
    const legacy = OuiListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      viewType: 'kanban',
      fields: ['name', 'stage'],
      filters: [['stage', '=', 'won']],
      showSearch: true,
      showHideFields: true,
      densityMode: 'compact',
    });
    expect(legacy.success).toBe(true);

    const canonical = OuiListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      columns: ['name', 'stage'],
      filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
      userActions: { search: true, filter: true },
      rowHeight: 'compact',
    });
    expect(canonical.success).toBe(true);
  });
});

/**
 * Per-view-type configs — derived from the spec, not forked (#2231), and since
 * objectui#6152 round 11 each is the spec's own list-view slot BY REFERENCE.
 *
 * These used to be hand-written objects with their own vocabulary
 * (`groupField`/`cardFields`/`imageField`/`dateField`). They carry the spec's
 * field set; the keys asserted below are the only local ones, and each is a
 * named REFUSAL arm (a pre-#2231 alias, or the list-view `calendar.defaultView`
 * the spec has no member for). Why `.partial()` stays on kanban and timeline
 * is said once, in the note above the blocks in `zod/objectql.zod.ts`.
 * Verdict equality with the slots: `list-view-blocks-by-reference-6152.test.ts`.
 */
describe('per-view-type configs derive from the spec', () => {
  const CONFIGS = {
    // `groupBy` is local and DECLARED, but it is not a writable member: it is
    // the objectui#8365 alias-refusal arm (`aliasKeyRefusal`), declared exactly so
    // the key is refused BY NAME instead of riding this mirror's `.passthrough()`.
    // It belongs on this list because the list asks which keys the mirror
    // declares beyond the spec — declaring a refusal is still declaring.
    kanban: { spec: SpecKanbanConfigSchema, local: ['groupField', 'cardFields', 'groupBy'] },
    // `dateField` / `endField` are the same shape one config over: objectui#8355
    // alias-refusal arms, declared exactly so the two retired spellings are
    // refused BY NAME. `defaultView` became one more by objectui#6152 round 11
    // (the spec has no such member on this block). ⚠️ Their presence here is NOT
    // a widening — `z.input` of each is `undefined`, so no document that parsed
    // green starts parsing green, and the TypeScript face carries `?: never`.
    calendar: { spec: SpecCalendarConfigSchema, local: ['defaultView', 'dateField', 'endField'] },
    gantt: { spec: SpecGanttConfigSchema, local: [] },
    gallery: { spec: SpecGalleryConfigSchema, local: ['imageField'] },
    timeline: { spec: SpecTimelineConfigSchema, local: ['dateField'] },
  } as const;

  it.each(Object.keys(CONFIGS))('%s carries every spec field', (key) => {
    const { spec } = CONFIGS[key as keyof typeof CONFIGS];
    const specKeys = Object.keys((spec as unknown as { shape: Record<string, unknown> }).shape);
    const ouiKeys = new Set(Object.keys(unwrapObjectShape(ouiShape[key])));
    expect(specKeys.filter((k) => !ouiKeys.has(k))).toEqual([]);
  });

  it.each(Object.keys(CONFIGS))('%s declares only the sanctioned local keys', (key) => {
    const { spec, local } = CONFIGS[key as keyof typeof CONFIGS];
    const specKeys = new Set(Object.keys((spec as unknown as { shape: Record<string, unknown> }).shape));
    const localOnly = Object.keys(unwrapObjectShape(ouiShape[key])).filter((k) => !specKeys.has(k));
    expect(localOnly.sort()).toEqual([...local].sort());
  });

  it('accepts spec vocabulary on every config', () => {
    const result = OuiListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      kanban: { groupByField: 'stage', columns: ['name', 'amount'] },
      calendar: { startDateField: 'starts_at', titleField: 'name', colorField: 'stage' },
      gantt: { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name', groupByField: 'owner', resourceView: true },
      gallery: { coverField: 'logo', coverFit: 'contain', cardSize: 'large', visibleFields: ['name'] },
      timeline: { startDateField: 'starts_at', titleField: 'name', scale: 'month', groupByField: 'owner' },
    });
    expect(result.success).toBe(true);
    // Spec fields must survive the parse, not be silently stripped.
    expect(result.success && result.data.gantt).toMatchObject({ groupByField: 'owner', resourceView: true });
    expect(result.success && result.data.timeline).toMatchObject({ scale: 'month' });
  });

  it('refuses the pre-#2231 aliases and the list-view `calendar.defaultView` BY NAME (objectui#6152 round 11)', () => {
    // Until round 11 this row pinned the opposite ("still accepts … so stored
    // views keep validating"). The census on objectui#6152 read no writer of
    // any of these keys on the declared blocks, and the spec slots refuse them,
    // so the door now refuses each at its own path. A stored view that carries
    // one still RENDERS: `normalizeListViewSchema` folds the aliases forward.
    const result = OuiListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      kanban: { groupField: 'stage', cardFields: ['name'] },
      gallery: { imageField: 'logo' },
      timeline: { dateField: 'due_date' },
      calendar: { startDateField: 'starts_at', defaultView: 'week' },
    });
    expect(result.success).toBe(false);
    const refusedAt = result.success ? [] : result.error.issues.map((i) => `${i.code}@${i.path.join('.')}`).sort();
    expect(refusedAt).toEqual([
      'invalid_type@calendar.defaultView',
      'invalid_type@gallery.imageField',
      'invalid_type@kanban.cardFields',
      'invalid_type@kanban.groupField',
      'invalid_type@timeline.dateField',
    ]);
  });

  it('⛔ …and the CALENDAR pair was retired first — objectui#8355 narrowed exactly those two', () => {
    // objectui#8355 refused `calendar.dateField` / `calendar.endField` BY NAME
    // before round 11 closed the rest of the vocabulary; the row is kept so its
    // own ruling stays pinned where it was. The full refusal contract is pinned
    // in `calendar-date-alias-refusal-8355.test.ts`.
    for (const alias of ['dateField', 'endField']) {
      const result = OuiListViewSchema.safeParse({
        type: 'list-view',
        objectName: 'accounts',
        calendar: { startDateField: 'starts_at', [alias]: 'ends_at' },
      });
      expect(result.success, `calendar.${alias} still parses green`).toBe(false);
    }
  });

  it('does not require the spec-required sub-fields the product authors partially', () => {
    // The producer and the reason are named once, in the note above the blocks
    // in `zod/objectql.zod.ts` (app-shell's derived kanban default).
    expect(OuiListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      kanban: { groupByField: 'stage' },
    }).success).toBe(true);
  });
});
