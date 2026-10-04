// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464, the S-objectui-held stage] The objectui-held contracts this stage
 * could write down and type: `object-gantt` `markers`, `object-timeline`
 * `mapping`, and the top-level `fields` of `object-form` and
 * `object-master-detail-form`. Each element contract was objectui's alone; the
 * spec now declares it — objectui's own authoring declaration, taken as it
 * stands — and the row takes it. The stage's other members (the drill-down's
 * `report`, the form's `customFields` and both forms' `sections`, the
 * timeline's `items`, the action containers' members) are forks the stage
 * reported, held in the enumeration pin's ledger with the shapes each could
 * take.
 *
 * ## The defect this file closes
 *
 * Each member is read with one shape (measured at the `.objectui-sha` pin
 * `ab1879721595`, unchanged at objectui `main` `94985a92ba`; the read points
 * are in the schemas' docblocks), and the rows declared them `z.unknown()`. So
 * a marker with no `date`, a numeric `date`, a misspelled marker member, a
 * `mapping` written as a bare field name or keyed `titleField`, and a form
 * `fields` entry written `{ name }` or `{ field }` all passed the
 * component-props gate, and the renderer drew no line, bound the default field
 * or dropped the entry's label, type and required — with, at most, a console
 * warning.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE DECLARED SHAPES PARSE: every shape a measured writer authors parses
 *   byte-identical — none of the three carries a default, so the parsed value
 *   IS the authored one. A refusal pin with no lit control passes just as well
 *   when the door refuses everything.
 * - §2 THE REFUSALS: an off-shape value of each member is refused with the
 *   code AND the path, so a refusal for the wrong reason reds; the form's two
 *   object entries carry their prescriptions.
 * - §3 ONE DECLARATION: each element shape declares exactly the members
 *   objectui's declaration names, and the two forms' `fields` are one schema.
 * - §4 THE REGISTRATION: the ADR-0087 D3 entries step 18 carries.
 *
 * The enumeration pin (`component-props-unknown-members.pin.test.ts`) holds the
 * other half: these four left its ledger, so a member reverted to
 * `z.unknown()` reds there.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import {
  ComponentPropsMap,
  ObjectFormPropsSchema,
  ObjectGanttPropsSchema,
  ObjectMasterDetailFormPropsSchema,
  ObjectTimelinePropsSchema,
} from './component.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

type Row = 'object-gantt' | 'object-timeline' | 'object-form' | 'object-master-detail-form';
const BASE: Record<Row, Record<string, unknown>> = {
  'object-gantt': { objectName: 'task' },
  'object-timeline': { objectName: 'event' },
  'object-form': { objectName: 'account' },
  'object-master-detail-form': { objectName: 'invoice' },
};
const parse = (row: Row, props: Record<string, unknown>) =>
  ComponentPropsMap[row].safeParse({ ...BASE[row], ...props });

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}
const firstMessage = (result: z.ZodSafeParseResult<unknown>): string =>
  (result.success ? '' : result.error.issues[0]!.message);

// ───────────────────────────────────────────────────────────────────────────
// §1 the declared shapes parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each member accepts every shape a measured writer authors', () => {
  const BYTE_IDENTICAL: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>]> = [
    // objectui `plugin-gantt/src/__tests__/objectGanttInputs-11168.test.tsx:181`, `:692`, `:699`.
    ['a full marker', 'object-gantt', { markers: [{ date: '2026-03-05', label: 'Deadline', color: 'red' }] }],
    ['a bare marker', 'object-gantt', { markers: [{ date: '2026-03-05' }] }],
    ['a labelled marker past the range', 'object-gantt', { markers: [{ date: '2031-03-05', label: 'Far' }] }],
    // objectui `types/src/__tests__/gantt-declared-keys.test.ts:121`.
    ['a marker with a hex colour', 'object-gantt', { markers: [{ date: '2024-06-05', label: 'Release', color: '#ef4444' }] }],
    ['a date-time marker', 'object-gantt', { markers: [{ date: '2026-07-01T09:00:00Z', label: 'Go-live' }] }],
    ['no markers', 'object-gantt', { markers: [] }],
    // objectui `plugin-timeline/src/__tests__/objectTimelineInputs-11168.test.tsx:193`, `:418`, `:448`, `:453`.
    ['a full mapping', 'object-timeline', { mapping: { title: 'code', date: 'start', description: 'summary', variant: 'kind' } }],
    ['a title and date mapping', 'object-timeline', { mapping: { title: 'code', date: 'finish' } }],
    ['a description mapping', 'object-timeline', { mapping: { description: 'code' } }],
    ['a variant mapping', 'object-timeline', { mapping: { variant: 'kind' } }],
    // This package's own navigation test (`packages/spec/src/ui/component-element-navigation-17987.test.ts`).
    ['a title and variant mapping', 'object-timeline', { mapping: { title: 'subject', variant: 'status' } }],
    ['an empty mapping', 'object-timeline', { mapping: {} }],
    // objectui's page-builder guide at `main` (`skills/objectui/guides/page-builder.md`).
    ['form field names', 'object-form', { fields: ['name', 'email'] }],
    ['no form fields', 'object-form', { fields: [] }],
    // The showcase's project workspace (`examples/app-showcase/src/ui/pages/project-workspace.page.ts`).
    ['master-detail parent field names', 'object-master-detail-form', {
      fields: ['name', 'account', 'status', 'health', 'budget', 'end_date'],
    }],
  ];
  for (const [label, row, props] of BYTE_IDENTICAL) {
    it(`${row}: ${label} parses byte-identical`, () => {
      const r = parse(row, props);
      expect(issues(r)).toEqual([]);
      for (const key of Object.keys(props)) {
        expect(r.success && (r.data as Record<string, unknown>)[key]).toStrictEqual(props[key]);
      }
    });
  }

  it('an absent member stays absent on every row', () => {
    for (const [row, key] of [
      ['object-gantt', 'markers'],
      ['object-timeline', 'mapping'],
      ['object-form', 'fields'],
      ['object-master-detail-form', 'fields'],
    ] as const) {
      const r = parse(row, {});
      expect(issues(r), row).toEqual([]);
      expect(r.success && r.data, row).not.toHaveProperty(key);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 an off-shape value is refused with the code and the path', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>, code: string, path: string]> = [
    ['a number for markers', 'object-gantt', { markers: 42 }, 'invalid_type', 'markers'],
    ['a bare date string as a marker', 'object-gantt', { markers: ['2026-07-01'] }, 'invalid_type', 'markers.0'],
    ['a marker with no date', 'object-gantt', { markers: [{ label: 'Deadline' }] }, 'invalid_type', 'markers.0.date'],
    // objectui `types/src/__tests__/gantt-declared-keys.test.ts:168`, its own `@ts-expect-error` probe.
    ['a numeric marker date', 'object-gantt', { markers: [{ date: 5 }] }, 'invalid_type', 'markers.0.date'],
    ['a marker `title`', 'object-gantt', { markers: [{ date: '2026-07-01', title: 'Freeze' }] }, 'unrecognized_keys', 'markers.0'],
    ['a marker `colour`', 'object-gantt', { markers: [{ date: '2026-07-01', colour: 'red' }] }, 'unrecognized_keys', 'markers.0'],
    ['a bare field name for mapping', 'object-timeline', { mapping: 'subject' }, 'invalid_type', 'mapping'],
    ['a non-string mapping member', 'object-timeline', { mapping: { title: 5 } }, 'invalid_type', 'mapping.title'],
    ['a `titleField` inside mapping', 'object-timeline', { mapping: { titleField: 'code' } }, 'unrecognized_keys', 'mapping'],
    ['a `color` inside mapping', 'object-timeline', { mapping: { color: 'kind' } }, 'unrecognized_keys', 'mapping'],
    ['a bare string for fields', 'object-form', { fields: 'name' }, 'invalid_type', 'fields'],
    // objectui `plugin-form/src/__tests__/objectFormFieldsMembers-8071.test.tsx:177`, `:182` — the stored-read probe.
    ['a `{ name }` field entry', 'object-form', { fields: [{ name: 'note' }] }, 'invalid_type', 'fields.0'],
    // objectui `plugin-form/src/__tests__/objectFormFieldsMembers-8071.test.tsx:140` — the warn probe.
    ['a `{ field }` field entry', 'object-form', { fields: [{ field: 'note' }] }, 'invalid_type', 'fields.0'],
    ['a numeric field entry', 'object-form', { fields: [5] }, 'invalid_type', 'fields.0'],
    // objectui's page-builder guide at `.objectui-sha` (respelled on objectui `main`).
    ['the guide\'s retired inline field', 'object-form', {
      fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, 'email'],
    }, 'invalid_type', 'fields.0'],
    // objectui `plugin-form/src/__tests__/topLevelFieldsWarnCoverage-8847.test.tsx:258`, `:110`.
    ['a master-detail `{ name }` entry beside a name', 'object-master-detail-form', {
      fields: [{ name: 'note' }, 'status'],
    }, 'invalid_type', 'fields.0'],
    ['a master-detail `{ field }` entry', 'object-master-detail-form', { fields: [{ field: 'note' }] }, 'invalid_type', 'fields.0'],
  ];
  for (const [label, row, props, code, path] of REFUSED) {
    it(`${row}: refuses ${label} — ${code} at ${path}`, () => {
      const r = parse(row, props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code, path }]);
    });
  }

  it('a `{ name }` entry is told to write the bare name, and where an override goes', () => {
    for (const row of ['object-form', 'object-master-detail-form'] as const) {
      const message = firstMessage(parse(row, { fields: [{ name: 'note', label: 'Note' }] }));
      expect(message, row).toMatch(/write `'note'`, not an object/);
      expect(message, row).toMatch(/a per-form override goes on a `sections\[\]\.fields` entry/);
    }
  });

  it('a `{ field }` entry is told it is the section vocabulary', () => {
    for (const row of ['object-form', 'object-master-detail-form'] as const) {
      const message = firstMessage(parse(row, { fields: [{ field: 'note' }] }));
      expect(message, row).toMatch(/`\{ field: 'note' \}` is the `sections\[\]\.fields` vocabulary/);
      expect(message, row).toMatch(/Write `'note'`, or move the entry into a section's `fields`/);
    }
  });

  it('a numeric entry carries no form prescription — only an object entry is told what to write', () => {
    expect(firstMessage(parse('object-form', { fields: [5] }))).not.toMatch(/sections\[\]\.fields/);
  });

  it('a misspelled marker or mapping member is pointed at the declared one', () => {
    expect(firstMessage(parse('object-gantt', { markers: [{ date: '2026-07-01', title: 'Freeze' }] }))).toMatch(/`label`/);
    expect(firstMessage(parse('object-timeline', { mapping: { titleField: 'code' } }))).toMatch(/`title`/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one declaration
// ───────────────────────────────────────────────────────────────────────────

describe('§3 each shape is objectui\'s declaration, and the two forms share one', () => {
  /** The element schema of an optional array member, or the member itself. */
  const objectKeys = (member: z.ZodType): string[] => {
    let s = member as unknown as { unwrap?: () => unknown; element?: unknown; shape?: Record<string, unknown> };
    while (typeof s.unwrap === 'function') s = s.unwrap() as typeof s;
    if (s.element) s = s.element as typeof s;
    while (typeof s.unwrap === 'function') s = s.unwrap() as typeof s;
    return Object.keys(s.shape ?? {}).sort();
  };

  it('a gantt marker declares exactly `date`, `label` and `color` — objectui `ObjectGanttSchema.markers`', () => {
    expect(objectKeys(ObjectGanttPropsSchema.shape.markers)).toEqual(['color', 'date', 'label']);
  });

  it('a timeline mapping declares exactly the four bindings — objectui `TimelineMappingSchema`', () => {
    expect(objectKeys(ObjectTimelinePropsSchema.shape.mapping)).toEqual(['date', 'description', 'title', 'variant']);
  });

  it('`object-master-detail-form` `fields` answers exactly as `object-form` `fields` does', () => {
    const form = ObjectFormPropsSchema.shape.fields;
    const md = ObjectMasterDetailFormPropsSchema.shape.fields;
    for (const value of [['a', 'b'], [{ name: 'a' }], [{ field: 'a' }], [5], 'a', [], [{ name: 'a', label: 'A' }]]) {
      const a = form.safeParse(value);
      const b = md.safeParse(value);
      expect(b.success, JSON.stringify(value)).toBe(a.success);
      expect(b.success ? [] : b.error.issues.map((i) => i.message))
        .toEqual(a.success ? [] : a.error.issues.map((i) => i.message));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§4 each narrowing is registered as the ADR-0087 D3 entry step 18 carries', () => {
  const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
  it.each([
    'ui-object-gantt-markers-typed',
    'ui-object-timeline-mapping-typed',
    'ui-object-form-fields-names-typed',
  ])('%s', (id) => {
    expect(ids).toContain(id);
  });
});
