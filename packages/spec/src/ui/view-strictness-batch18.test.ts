// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4001 批 18 — `ui/view.zod.ts` sub-block strictness.
 *
 * The long tail of this file: the top level, the form/page shapes and the ~28
 * config blocks under them were closed in earlier waves, leaving 20 object
 * sites that still dropped unknown keys silently. 16 were closed in the batch
 * itself; `UserFiltersSchema` followed at **#5073**, once the maintainer
 * adjudicated the protocol question that blocked it (promote `allowAddTab`,
 * then close). The other THREE stay open, each for a measured reason, and those
 * reasons are pinned in this file too — a deliberately-open shape that is only
 * explained in prose is indistinguishable from one nobody has got to yet, which
 * is how the next sweep "finishes the job" and breaks something.
 *
 * ⚠️ A fourth shape, `ViewFilterRuleSchema`, is open on separate evidence and
 * pinned in its OWN file (`view-filter-rule-wire-id.test.ts`, #5114). It is not
 * this batch's to reason about; do not fold the two sets together.
 *
 * This file is the third of the three places each verdict is recorded (the
 * others: the JSDoc on the shape itself, and the `ui/` row in
 * `docs/audits/2026-07-unknown-key-strictness-ledger.md`).
 *
 * What is pinned, and why each needs its own assertion:
 *
 *   1. THE DOOR. `.strict()` is a property of a PARSE — a strict schema nobody
 *      parses gates nothing (#4583). So the doors are asserted directly, not
 *      inferred from the schema's posture.
 *   2. EVERY closed site at its OWN path. Strictness does not recurse (批 13's
 *      `responsive` finding), so a closed parent proves nothing about a nested
 *      block. Each is probed where it lives.
 *   3. The CURATION. Every alias/guidance entry is anchored to a named sibling
 *      contract; these assertions are what stop a later reader deleting one as
 *      redundant. Where the bare edit-distance suggester already answers
 *      correctly, no alias was added — and where it would answer WRONGLY, the
 *      alias overrules it and this file says so.
 *   4. The shapes left open, with the evidence that they are wire/base rather
 *      than unfinished.
 *   5. The real union ERROR BEHAVIOUR (#5014) — pinned honestly, including the
 *      part that does not reach the author today.
 */

import { describe, it, expect } from 'vitest';

import {
  ViewDataSchema,
  UserFilterFieldSchema,
  UserFiltersSchema,
  ObjectUserFiltersSchema,
  GanttQuickFilterSchema,
  GanttConfigSchema,
  ListViewSchema,
  FormViewSchema,
  ViewItemSchema,
  ViewMetadataSchema,
  defineViewItem,
} from './view.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/** Reject `value` through `schema` and return its issues as a searchable string. */
function reject(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return JSON.stringify((r.error as { issues?: unknown })?.issues ?? r.error ?? []);
}

/** Parse `value` and fail loudly (with the issues) if it does not succeed. */
function accept(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } }, value: unknown): unknown {
  const r = schema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')}`).toBe(true);
  return r.data;
}

const LIST_BASE = { columns: ['name'] };
const FORM_BASE = { type: 'simple', sections: [{ fields: ['name'] }] };
/** A form whose one section carries `field` as an object, so nested field blocks are reachable. */
const formWithField = (field: unknown) => ({ type: 'simple', sections: [{ fields: [field] }] });

// ===========================================================================
// 1. The doors — a parse must exist, or none of the rest means anything
// ===========================================================================
describe('#4001 批 18 — the doors these shapes are reachable through', () => {
  it('the `view` metadata type resolves to a registered schema (the save-time 422 door)', () => {
    expect(getMetadataTypeSchema('view')).toBeDefined();
  });

  it('`defineViewItem()` is a real parse door — it throws on a malformed config', () => {
    expect(() =>
      defineViewItem({
        name: 'crm_lead.pipeline',
        object: 'crm_lead',
        viewKind: 'list',
        config: { type: 'grid', columns: 'not-an-array' },
      } as never),
    ).toThrow();
  });

  it('controls parse — these tests fail closed, they do not reject everything', () => {
    accept(ListViewSchema, LIST_BASE);
    accept(FormViewSchema, FORM_BASE);
    accept(ViewDataSchema, { provider: 'object', object: 'crm_lead' });
  });
});

// ===========================================================================
// 2. Every closed site, at its own path
// ===========================================================================
describe('#4001 批 18 — closed sites reject unknown keys where they live', () => {
  describe('ViewDataSchema — all four provider arms', () => {
    it.each([
      ['object', { provider: 'object', object: 'crm_lead' }],
      ['api', { provider: 'api' }],
      ['value', { provider: 'value', items: [] }],
      ['schema', { provider: 'schema', schemaId: 'report' }],
    ])('the `%s` arm rejects an undeclared key', (_arm, base) => {
      accept(ViewDataSchema, base);
      expect(reject(ViewDataSchema, { ...base, notADataKey: 1 })).toContain('notADataKey');
    });

    it('is reached through `ListViewSchema.data` and `FormViewSchema.data`, not only standalone', () => {
      expect(reject(ListViewSchema, { ...LIST_BASE, data: { provider: 'object', object: 'x', notADataKey: 1 } }))
        .toContain('notADataKey');
      expect(reject(FormViewSchema, { ...FORM_BASE, data: { provider: 'object', object: 'x', notADataKey: 1 } }))
        .toContain('notADataKey');
    });
  });

  it('UserFilterFieldSchema.options — the nested option entry, inside an already-strict parent', () => {
    accept(UserFilterFieldSchema, { field: 'stage', options: [{ value: 'won', label: 'Won' }] });
    expect(reject(UserFilterFieldSchema, { field: 'stage', options: [{ value: 'won', label: 'Won', notAnOptionKey: 1 }] }))
      .toContain('notAnOptionKey');
  });

  it('GanttQuickFilterSchema.options — the object arm of the string|object union', () => {
    accept(GanttQuickFilterSchema, { field: 'status', options: ['todo', { value: 'done', label: 'Done' }] });
    expect(reject(GanttQuickFilterSchema, { field: 'status', options: [{ value: 'done', notAnOptionKey: 1 }] }))
      .toContain('notAnOptionKey');
  });

  it('GanttConfigSchema.tooltipFields — a CLOSED entry inside a deliberately OPEN parent', () => {
    const gantt = { startDateField: 's', endDateField: 'e', titleField: 't' };
    // The parent is `.passthrough()` on purpose (renderer-ahead knobs reach
    // plugin-gantt). That openness must NOT leak into the entry.
    const parsed = accept(GanttConfigSchema, { ...gantt, someRendererAheadKnob: true }) as Record<string, unknown>;
    expect(parsed.someRendererAheadKnob, 'the parent stays open — this is the 批 18 non-goal').toBe(true);
    expect(reject(GanttConfigSchema, { ...gantt, tooltipFields: [{ field: 'owner', notATooltipKey: 1 }] }))
      .toContain('notATooltipKey');
  });

  it.each([
    ['conditionalFormatting', { conditionalFormatting: [{ condition: 'true', style: {}, notAFormatKey: 1 }] }],
    ['emptyState', { emptyState: { title: 'None', notAnEmptyStateKey: 1 } }],
  ])('ListViewSchema.%s rejects an undeclared key', (_block, patch) => {
    const bad = Object.values(patch)[0];
    const key = Object.keys(Array.isArray(bad) ? bad[0] : (bad as object)).find((k) => k.startsWith('notA'))!;
    expect(reject(ListViewSchema, { ...LIST_BASE, ...patch })).toContain(key);
  });

  it('FormFieldBaseSchema.keyField — nested inside a shape that was ALREADY strict', () => {
    // The enclosing form field closed under ADR-0089 D3a; this block did not,
    // because strictness is per object and not per subtree.
    accept(FormViewSchema, formWithField({ field: 'entries', keyField: { field: 'name' } }));
    expect(reject(FormViewSchema, formWithField({ field: 'entries', keyField: { field: 'name', notAKeyFieldKey: 1 } })))
      .toContain('notAKeyFieldKey');
  });

  it('FormViewSchema.subforms rejects an undeclared key', () => {
    accept(FormViewSchema, { ...FORM_BASE, subforms: [{ childObject: 'crm_line' }] });
    expect(reject(FormViewSchema, { ...FORM_BASE, subforms: [{ childObject: 'crm_line', notASubformKey: 1 }] }))
      .toContain('notASubformKey');
  });

  it.each([
    ['thank-you', { kind: 'thank-you', title: 'Thanks' }],
    ['redirect', { kind: 'redirect', url: '/done' }],
    ['continue', { kind: 'continue' }],
    ['next-record', { kind: 'next-record' }],
  ])('FormViewSchema.submitBehavior `%s` arm rejects an undeclared key', (_kind, base) => {
    accept(FormViewSchema, { ...FORM_BASE, submitBehavior: base });
    expect(reject(FormViewSchema, { ...FORM_BASE, submitBehavior: { ...base, notASubmitKey: 1 } }))
      .toContain('notASubmitKey');
  });
});

// ===========================================================================
// 3. Curation — the entries that make a rejection fixable
// ===========================================================================
describe('#4001 批 18 — the rejection carries a usable prescription', () => {
  it('`object` → `childObject` on a subform — the word every neighbouring block uses', () => {
    expect(reject(FormViewSchema, { ...FORM_BASE, subforms: [{ childObject: 'x', object: 'crm_line' }] }))
      .toContain('`object` → `childObject`');
  });

  it('`objectName` → `object` on the `object` data source — the query surface spelling', () => {
    expect(reject(ViewDataSchema, { provider: 'object', object: 'x', objectName: 'crm_lead' }))
      .toContain('`objectName` → `object`');
  });

  it('a bare `name` on the `object` data source is NOT aliased — finding 7 discipline', () => {
    // `name` is a real key on the view ITEM, so an author writing it here may
    // have meant the view's name. A confidently wrong prescription is worse
    // than none; the key is still named and rejected, just not redirected.
    const msg = reject(ViewDataSchema, { provider: 'object', object: 'x', name: 'my_view' });
    expect(msg).toContain('name');
    expect(msg).not.toContain('`name` → `object`');
  });

  it('`delay` → `delayMs` on a redirect — the unit lives in the key name', () => {
    expect(reject(FormViewSchema, { ...FORM_BASE, submitBehavior: { kind: 'redirect', url: '/x', delay: 500 } }))
      .toContain('`delay` → `delayMs`');
  });

  it('`visibleWhen` → `condition` on a formatting rule — the ADR-0089 spelling, borrowed', () => {
    expect(reject(ListViewSchema, { ...LIST_BASE, conditionalFormatting: [{ condition: 'true', style: {}, visibleWhen: 'x' }] }))
      .toContain('`visibleWhen` → `condition`');
  });

  it('an option `count` gets a wrong-layer prescription, not a rename', () => {
    // Measured against objectui `plugin-list/src/UserFilters.tsx`: `count` is
    // COMPUTED from a data snapshot every render, so an authored one is
    // overwritten before it is read. Pointing at `showCount` on the FIELD is
    // the capability the author actually wanted.
    const msg = reject(UserFilterFieldSchema, { field: 'stage', options: [{ value: 'won', label: 'Won', count: 3 }] });
    expect(msg).toContain('showCount');
  });

  it('an empty-state `action` is pointed at `addRecord`, a real block on the same view', () => {
    expect(reject(ListViewSchema, { ...LIST_BASE, emptyState: { action: {} } })).toContain('addRecord');
  });

  describe('UserFiltersSchema — closed at #5073, after `allowAddTab` was promoted', () => {
    // 批 18 left this shape open because closing it would have 422'd
    // `allowAddTab`: objectui's renderer reads the key
    // (`plugin-list/src/UserFilters.tsx:182` / `:742`), and `saveMetaItem`
    // persists the ORIGINAL body rather than `parsed.data`, so the stripped key
    // still reached the renderer and the capability WORKED. The maintainer
    // adjudicated promote-then-close (2026-08-04), which is what these pin.

    it('`allowAddTab` is DECLARED, so the promoted capability survives the close', () => {
      // The whole reason the close was blocked. If this ever goes red, the
      // close has silently re-become the capability removal #5073 refused.
      const parsed = accept(UserFiltersSchema, { element: 'tabs', allowAddTab: true }) as Record<string, unknown>;
      expect(parsed.allowAddTab).toBe(true);
      expect(reject(ListViewSchema, { ...LIST_BASE, userFilters: { element: 'tabs', allowAddTab: 'yes' } }))
        .toContain('allowAddTab');
    });

    it('rides in through `ListView.userFilters` — the carrier, not just the shape standalone', () => {
      const parsed = accept(ListViewSchema, { ...LIST_BASE, userFilters: { element: 'tabs', allowAddTab: true } }) as {
        userFilters?: Record<string, unknown>;
      };
      expect(parsed.userFilters?.allowAddTab).toBe(true);
    });

    it('an unknown key is now REJECTED where it lives, not dropped', () => {
      expect(reject(UserFiltersSchema, { element: 'dropdown', notAUserFilterKey: 1 })).toContain('notAUserFilterKey');
      expect(reject(ListViewSchema, { ...LIST_BASE, userFilters: { element: 'dropdown', notAUserFilterKey: 1 } }))
        .toContain('notAUserFilterKey');
    });

    it('the 批 6e strip-reliance flipped from "drops" to "rejects" — the wanted flip', () => {
      // `ObjectUserFiltersSchema` is `.omit()`ed off this base and `.omit()`
      // inherits posture, which is exactly what 批 6e asked about. Before the
      // close these three keys were silently dropped while the CLI lint
      // (`validate-list-view-mode.ts`) warned about them — two doors
      // disagreeing. They now agree.
      for (const pageOnly of [
        { tabs: [{ name: 'mine', label: 'Mine', filter: [] }] },
        { showAllRecords: true },
        { allowAddTab: true },
      ]) {
        expect(reject(ObjectUserFiltersSchema, { element: 'dropdown', ...pageOnly }))
          .toContain(Object.keys(pageOnly)[0]);
      }
    });

    it('…and each rejection carries the `listViews` prescription, not a bare refusal', () => {
      // The keys are page-only, so there IS a right answer on an object view;
      // a bare "unrecognized key" would leave the author to guess it.
      expect(reject(ObjectUserFiltersSchema, { element: 'dropdown', tabs: [] })).toContain('listViews');
      expect(reject(ObjectUserFiltersSchema, { element: 'dropdown', showAllRecords: true })).toContain('listViews');
      expect(reject(ObjectUserFiltersSchema, { element: 'dropdown', allowAddTab: true })).toContain('ViewTabBar');
    });

    it('…and does NOT suggest an omitted key back — the finding-7 hazard the close created', () => {
      // `.omit()` keeps the BASE's error map, whose `knownKeys` were read from
      // the base shape — which still lists `tabs`. Measured before the fix:
      // `tab` was answered with "Did you mean `tab` → `tabs`?", steering the
      // author at the one key this surface refuses. The map is rebuilt over the
      // omitted shape so the suggestion pool cannot contain them.
      const msg = reject(ObjectUserFiltersSchema, { element: 'dropdown', tab: 1 });
      expect(msg).toContain('`tab`');
      expect(msg).not.toContain('→ `tabs`');
      expect(reject(ObjectUserFiltersSchema, { element: 'dropdown', showAllRecord: 1 }))
        .not.toContain('→ `showAllRecords`');
    });

    it('the object variant still DERIVES its shape from the base (#2231), not a transcription', () => {
      // The reason it is `.omit()` + spread rather than a hand-listed shape: a
      // key added to the base must appear here, or the two drift into the fork
      // derive-by-reference exists to prevent.
      const baseKeys = Object.keys((UserFiltersSchema as unknown as { shape: Record<string, unknown> }).shape);
      const objectKeys = Object.keys((ObjectUserFiltersSchema as unknown as { shape: Record<string, unknown> }).shape);
      expect(baseKeys).toEqual(['element', 'fields', 'tabs', 'showAllRecords', 'allowAddTab']);
      expect(objectKeys).toEqual(['element', 'fields']);
    });
  });

  it('`continue` / `next-record` explain they take no options instead of suggesting a key', () => {
    const msg = reject(FormViewSchema, { ...FORM_BASE, submitBehavior: { kind: 'continue', title: 'Thanks' } });
    expect(msg).toContain('thank-you');
  });
});

// ===========================================================================
// 4. Union error behaviour — pinned honestly, including what does NOT arrive
// ===========================================================================
describe('#4001 批 18 — union error behaviour (#5014), pinned as it really is', () => {
  it('submitBehavior discriminates on `kind`, so ONE member reports and the prescription survives', () => {
    // This is why the block is `z.discriminatedUnion` and not `z.union`. With a
    // plain union of four strict members the error is `invalid_union` carrying
    // four sub-errors — and #5014 measured that the renderers flatten those to
    // a bare "Invalid input", so the prescription never reaches the author.
    const r = FormViewSchema.safeParse({ ...FORM_BASE, submitBehavior: { kind: 'redirect', url: '/x', delay: 1 } });
    expect(r.success).toBe(false);
    // The load-bearing assertion is the issue CODE at the top level. A plain
    // `z.union` reports `invalid_union` and buries the prescription in
    // `issue.errors[]`, which #4971/#5014 measured the consumers dropping;
    // discriminating surfaces `unrecognized_keys` directly, at the key's own
    // path, where every renderer already prints it.
    const issues = r.error?.issues ?? [];
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(issues[0]?.path).toEqual(['submitBehavior']);
    expect(JSON.stringify(issues)).toContain('`delay` → `delayMs`');
  });

  it('ViewMetadataSchema is a top-level union — its unknown-key report is still an `invalid_union`', () => {
    // Pinned as a FACT about today, not as an endorsement. The container member
    // is strict, so a container body with a stray key is rejected — but it
    // arrives wrapped in `invalid_union`, which is exactly the shape #5014
    // reports the CLI/renderers flatten. When #5014 lands, this assertion is
    // expected to go red and should be updated to the improved behaviour.
    const r = ViewMetadataSchema.safeParse({ list: { type: 'grid', columns: ['name'] }, notAContainerKey: 1 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues ?? [])).toContain('invalid_union');
  });
});

// ===========================================================================
// 5. The shapes left OPEN — with the evidence, so nobody "finishes" them
// ===========================================================================
describe('#4001 批 18 — deliberately still open (do not close without re-measuring)', () => {
  it('ViewItemSchema stays open: it is the member Studio round-trips `isPinned` through', () => {
    // objectui's pin control PUTs `{ ...storedItem, isPinned }`
    // (`ObjectView.tsx:882` → `data-objectstack/src/index.ts:2801`). A stored
    // ViewItem record carries `viewKind` AND `config`, so the merged body lands
    // on THIS member — the flattened members are excluded by their
    // `config: z.undefined()` guard. Closed, pinning a saved view would 422.
    const record = {
      name: 'crm_lead.pipeline',
      object: 'crm_lead',
      viewKind: 'list' as const,
      config: { type: 'grid', columns: ['name'] },
    };
    expect(ViewItemSchema.safeParse({ ...record, isPinned: true, sortOrder: 3 }).success).toBe(true);
    expect(ViewMetadataSchema.safeParse({ ...record, isPinned: true, sortOrder: 3 }).success).toBe(true);
  });

  it('…and the aux keys really do land on member 1, not on a flattened member', () => {
    // If this ever starts matching a flattened member instead, the reasoning
    // above is stale — the flattened members pin `config` to undefined.
    const withConfig = {
      name: 'crm_lead.pipeline',
      object: 'crm_lead',
      viewKind: 'list' as const,
      config: { type: 'grid', columns: 'not-an-array' },
    };
    expect(
      ViewMetadataSchema.safeParse(withConfig).success,
      'a broken record must NOT be rescued by a lenient flattened member',
    ).toBe(false);
  });

  it('ListViewSchema.sort stays open: the console stamps a UI row `id` into it', () => {
    // Batch 18 CLOSED this (with `direction → order`, the #4721 alias for the
    // identical tuple) and the full suite caught it: `view-metadata-schema.test.ts`
    // pins `sort: [{ id, field, order }]` as the exact body a console column-sort
    // PUT persists, and objectui stamps that `id` per row
    // (`components/src/custom/sort-builder.tsx:68`, `:94` — `crypto.randomUUID()`).
    // `id` was deliberately NOT declared to silence the rejection: it is a React
    // list key, and declaring it would put a UI artifact on the authorable
    // surface and teach an AI author to emit one.
    expect(ListViewSchema.safeParse({ ...LIST_BASE, sort: [{ id: 'uuid', field: 'name', order: 'asc' }] }).success).toBe(true);
  });

  it('…and the mechanism that made it a regression: `.strip()` does NOT recurse', () => {
    // This is the load-bearing fact for every nested block in this file, and it
    // is the opposite of what the union's comment implies. `ViewMetadataSchema`
    // rescues Studio's round-trip keys by making its flattened members
    // `.strip()` — but that re-opens the TOP level only. A nested block closed
    // inside `ListViewSchema` is still reached through that member, so a
    // console-stamped key inside it becomes a 422 no matter what the member does.
    const overlay = { type: 'grid', columns: ['name'], name: 'o.default', viewKind: 'list', object: 'o' };
    // top level: an unknown aux key rides along, because the member strips.
    expect(ViewMetadataSchema.safeParse({ ...overlay, someStudioAuxKey: 1 }).success).toBe(true);
    // nested: a CLOSED sub-block still rejects through that same member.
    expect(ViewMetadataSchema.safeParse({ ...overlay, emptyState: { title: 'x', notAnEmptyStateKey: 1 } }).success).toBe(false);
  });

  it('FormFieldBaseSchema stays a bare z.object: its ONE consumer already `.strict()`s it', () => {
    // The ledger reads this site as `strip` because it counts the base; the
    // base is not a door. `FormFieldSchema` = base.extend({fields}).strict(),
    // and it carries the ADR-0089 `strictVisibilityError` map that a
    // `strictObject` conversion would have to re-express.
    expect(reject(FormViewSchema, formWithField({ field: 'name', notAFieldKey: 1 })))
      .toContain('notAFieldKey');
  });

  it('the ADR-0089 visibility pair still resolves through its own error map', () => {
    // The reason the base was NOT converted — proving the map is still wired.
    const msg = reject(FormViewSchema, formWithField({ field: 'name', visibility: 'x' }));
    expect(msg).toContain('visib');
  });
});
