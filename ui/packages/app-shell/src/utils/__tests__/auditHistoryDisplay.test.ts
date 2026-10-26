/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * auditHistoryDisplay — unit tests for the record History tab's diff
 * pipeline. Mirrors the field mix from the gantt QA report (objectui
 * detail-page history display): datetime fields shown as raw ISO strings,
 * lookup ids shown as raw JSON arrays, and formula helper fields producing
 * a phantom "value → —" line on every update.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAuditValue,
  collectAuditChanges,
  collectLookupIds,
  formatAuditValue,
  type AuditFieldDef,
} from '../auditHistoryDisplay';

// An OBJECT METADATA DOCUMENT's `fields` record — the exact shape
// `RecordDetailView` passes (`objectDef.fields`, from `useMetadata().objects`).
// `predecessors` spelled its target `reference_to` until objectui#6719; that
// spelling is not merely non-canonical here, it is REFUSED BY NAME by
// `ObjectSchema.safeParse` (spec 17.2.0), so the fixture was never a document
// this reader could legally be handed. Re-spelled to `reference`, which the
// same parse ACCEPTS with `multiple: true` alongside it.
const fields = {
  plan_start: { type: 'datetime', label: '计划开始日期' },
  due_date: { type: 'date', label: '截止日期' },
  predecessors: { type: 'lookup', label: '紧前计划', reference: 'gantt_plan', multiple: true },
  deps_rendered: { type: 'formula', label: '紧前依赖(渲染用)' },
  helper: { type: 'text', label: '内部辅助', hidden: true },
  is_locked: { type: 'boolean', label: '锁定' },
  status: {
    type: 'select',
    label: '状态',
    options: [
      { value: 'todo', label: '待开始' },
      { value: 'doing', label: '进行中' },
    ],
  },
} as const;

describe('parseAuditValue', () => {
  it('parses JSON strings and passes objects through', () => {
    expect(parseAuditValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseAuditValue({ a: 1 })).toEqual({ a: 1 });
    expect(parseAuditValue(null)).toBeNull();
    expect(parseAuditValue('not json')).toBeNull();
  });
});

describe('collectAuditChanges', () => {
  it('keeps genuine field changes', () => {
    const changes = collectAuditChanges(
      { plan_start: '2026-07-26T00:00:00.000Z' },
      { plan_start: '2026-08-04T12:00:00.000Z' },
      fields as any,
    );
    expect(changes).toEqual([
      { field: 'plan_start', from: '2026-07-26T00:00:00.000Z', to: '2026-08-04T12:00:00.000Z' },
    ]);
  });

  it('drops formula fields (asymmetric audit snapshots make their diffs phantom)', () => {
    const changes = collectAuditChanges(
      { deps_rendered: ['LnLJIsTwXbv1E2gF'] },
      { deps_rendered: null },
      fields as any,
    );
    expect(changes).toEqual([]);
  });

  it('drops hidden fields', () => {
    expect(collectAuditChanges({ helper: 'a' }, { helper: 'b' }, fields as any)).toEqual([]);
  });

  it('drops empty↔empty no-ops (undefined vs null vs "" vs [])', () => {
    expect(collectAuditChanges({ predecessors: '' }, { predecessors: null }, fields as any)).toEqual([]);
    expect(collectAuditChanges({}, { predecessors: [] }, fields as any)).toEqual([]);
  });

  it('drops system/noise columns and unchanged values', () => {
    const changes = collectAuditChanges(
      { organization_id: 'o1', updated_at: '1', status: 'todo' },
      { organization_id: 'o2', updated_at: '2', status: 'todo' },
      fields as any,
    );
    expect(changes).toEqual([]);
  });

  it('keeps unknown fields (no def) so nothing is silently lost', () => {
    const changes = collectAuditChanges({ custom: 1 }, { custom: 2 }, fields as any);
    expect(changes).toEqual([{ field: 'custom', from: 1, to: 2 }]);
  });
});

describe('collectLookupIds', () => {
  it('gathers scalar and array ids per reference target', () => {
    const map = collectLookupIds(
      [
        { field: 'predecessors', from: null, to: ['LnLJIsTwXbv1E2gF'] },
        { field: 'predecessors', from: ['a'], to: 'b' },
        { field: 'plan_start', from: '1', to: '2' }, // not a lookup
      ],
      fields as any,
    );
    expect(map.size).toBe(1);
    expect(Array.from(map.get('gantt_plan')!)).toEqual(
      expect.arrayContaining(['LnLJIsTwXbv1E2gF', 'a', 'b']),
    );
  });
});

/**
 * objectui#6719 — the relationship-target read, pinned on the two axes
 * objectui#6528 (SPELLING) and objectui#6648 (CARRIER) already pinned on the
 * two resolvers they covered. This helper was the third reader of the same
 * value and was missed by both.
 *
 * `lookupTarget` is module-private, so both of its readers are asked here:
 * `collectLookupIds` (which target objects get batch-resolved) and
 * `formatAuditValue` (whether a raw id is swapped for a record label).
 *
 * WHY REFUSAL IS THE POINT. `lookupTarget`'s only caller chain is
 * `RecordDetailView`'s History effect, which feeds it `objectDef.fields` from
 * `useMetadata().objects` — the metadata cache for type `'object'`, i.e. OBJECT
 * METADATA DOCUMENTS, never ObjectUI's own view/field contract (that contract
 * is `DetailViewFieldSchema`, keyed `reference_to` until objectui#11070 round 4
 * and `reference` since). So every spelling and carrier below is one
 * `ObjectSchema.safeParse` (spec 17.2.0) refuses on the documents that actually
 * arrive here, and resolving one could only re-hide the producer that emitted
 * it (AGENTS.md #0.1).
 */
describe('relationship target (objectui#6719)', () => {
  const change = { field: 'plan', from: 'rec_1', to: 'rec_2' };
  const targetsOf = (def: unknown): string[] =>
    Array.from(collectLookupIds([change], { plan: def } as any).keys());

  it('reads the spec spelling `reference` — the positive control', () => {
    expect(targetsOf({ type: 'lookup', reference: 'gantt_plan' })).toEqual(['gantt_plan']);
  });

  /**
   * CARRIER axis. `FieldSchema.reference` is `optional -> string`, and
   * `ObjectSchema.safeParse` refuses both carriers below —
   * `reference: ['gantt_plan']` is `invalid_type: expected string, received
   * array`, `reference: { object: 'gantt_plan' }` is `received object` — while
   * accepting the bare name asserted above. A structure-walking,
   * key-position-aware census of both trees found ZERO producers of either
   * carrier at the field-def key position, against 599 bare-string carriers.
   *
   * The array case is the worse of the two: taking element zero would silently
   * discard the rest of a multi-target value, and no such value is declared
   * anywhere — polymorphic lookup is an open, unbuilt spec gap. Deleting the
   * `typeof target === 'string'` narrowing turns these RED.
   */
  it.each([
    { carrier: 'array', reference: ['gantt_plan'] as unknown },
    { carrier: 'multi-element array (the discarded-rest case)', reference: ['gantt_plan', 'gantt_task'] as unknown },
    { carrier: '`{ object }`', reference: { object: 'gantt_plan' } as unknown },
  ])('refuses the $carrier carrier on `reference` — a producer emitting it is the bug', ({ reference }) => {
    expect(targetsOf({ type: 'lookup', reference })).toEqual([]);
  });

  /**
   * The COMPILE-TIME half of the carrier axis, and the only thing that can
   * measure it: `AuditFieldDef` declared `reference?: string | string[]` — the
   * ONLY `string | string[]` declaration of this key in either tree, against 43
   * that declare `string`. A runtime assertion cannot see a type widen, but
   * `@ts-expect-error` is a two-way pin — an unused directive is itself an
   * error (TS2578) — so re-widening the member turns this file RED under
   * `tsconfig.test.json`, which is what the CI `Type Check` job runs.
   */
  it('declares `reference` as `string`, so the array carrier does not typecheck', () => {
    // @ts-expect-error objectui#6719 — `string[]` is a shape nothing declares and nothing emits.
    const widened: AuditFieldDef = { type: 'lookup', reference: ['gantt_plan', 'gantt_task'] };
    expect(targetsOf(widened)).toEqual([]);
  });

  /**
   * SPELLING axis. `reference_to ?? reference` read the LEGACY key first, ahead
   * of the canonical one. `ObjectSchema.safeParse` refuses all three below BY
   * NAME ("Did you mean `reference_to` → `reference`?"); `reference_to` was
   * then live only on ObjectUI's own view/field contract, a different contract
   * this reader is never handed, and objectui#11070 round 4 retired it there
   * too. Restoring the `reference_to` arm turns the
   * first case and the partial-migration case below RED; the other two
   * spellings were never read here and are pinned so the chain cannot grow back
   * a second time.
   */
  it.each(['reference_to', 'referenceTo', 'reference_to_object'])(
    'refuses the legacy spelling `%s` — a producer emitting it is the bug',
    (spelling) => {
      expect(targetsOf({ type: 'lookup', [spelling]: 'gantt_plan' })).toEqual([]);
    },
  );

  it('prefers `reference` on a partially-migrated def carrying both', () => {
    expect(targetsOf({ type: 'lookup', reference: 'gantt_plan', reference_to: 'stale_legacy' })).toEqual([
      'gantt_plan',
    ]);
  });

  /**
   * The second reader of `lookupTarget`. A refused spelling must not reach the
   * label map either — the id stays raw, which is the same visible outcome as a
   * lookup whose label query failed, and never a label read off the wrong
   * target object.
   */
  it('does not resolve a display label through a refused spelling', () => {
    const lookupLabels = new Map([['gantt_plan', new Map([['rec_1', '甘特计划B 装配']])]]);
    expect(formatAuditValue({ type: 'lookup', reference: 'gantt_plan' }, 'rec_1', { lookupLabels })).toBe(
      '甘特计划B 装配',
    );
    expect(formatAuditValue({ type: 'lookup', reference_to: 'gantt_plan' }, 'rec_1', { lookupLabels })).toBe(
      'rec_1',
    );
  });
});

describe('formatAuditValue', () => {
  it('renders empty values as empty string', () => {
    expect(formatAuditValue(fields.plan_start as any, null)).toBe('');
    expect(formatAuditValue(fields.predecessors as any, [])).toBe('');
  });

  it('localizes datetime values instead of raw ISO strings', () => {
    const out = formatAuditValue(fields.plan_start as any, '2026-08-04T12:00:00.000Z', {
      locale: 'zh-CN',
    });
    expect(out).not.toContain('T12:00:00.000Z');
    expect(out).toContain('2026');
  });

  it('renders date values without a time component', () => {
    const out = formatAuditValue(fields.due_date as any, '2026-08-06T00:00:00.000Z', {
      locale: 'en-US',
    });
    expect(out).not.toContain(':');
    expect(out).toContain('2026');
  });

  it('maps lookup ids to resolved record labels, joining arrays', () => {
    const lookupLabels = new Map([
      ['gantt_plan', new Map([['LnLJIsTwXbv1E2gF', '甘特计划B 装配']])],
    ]);
    expect(
      formatAuditValue(fields.predecessors as any, ['LnLJIsTwXbv1E2gF'], { lookupLabels }),
    ).toBe('甘特计划B 装配');
    // Unresolved ids fall back to the raw id, not JSON syntax.
    expect(formatAuditValue(fields.predecessors as any, ['x1', 'LnLJIsTwXbv1E2gF'], { lookupLabels })).toBe(
      'x1, 甘特计划B 装配',
    );
  });

  it('maps select values to option labels', () => {
    expect(formatAuditValue(fields.status as any, 'doing')).toBe('进行中');
  });

  it('localizes booleans through t with Yes/No fallback', () => {
    expect(formatAuditValue(fields.is_locked as any, true)).toBe('Yes');
    const t = (key: string) => (key === 'common.yes' ? '是' : '否');
    expect(formatAuditValue(fields.is_locked as any, false, { t })).toBe('否');
  });
});
