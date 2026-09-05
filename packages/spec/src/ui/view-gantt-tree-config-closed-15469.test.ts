// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * #15469 — `GanttConfigSchema` and `TreeConfigSchema` are CLOSED against
 * unknown keys.
 *
 * Both blocks used to be `strictObject(…).passthrough()`: the campaign's own
 * helper applied and immediately undone, so a mistyped gantt key (`colourField`)
 * parsed green and rendered an uncoloured bar while the same typo on a calendar
 * or timeline block got a named refusal. Maintainer ruling A (2026-09-05): both
 * windows close, the ten keys objectui's plugin-gantt read through the gantt
 * window are declared at the types the renderer reads, and plugin-tree's read
 * set — measured at objectui pin a472b07 — was already fully declared.
 *
 * Three things are pinned, each in the direction that would go silent again:
 *
 *  1. The card's probe, as measured: the five view config blocks parsed with
 *     their required members plus one undeclared key, with two in-process
 *     controls proving the mechanism works in this zod. The refusal is asserted
 *     on its ENVELOPE — `unrecognized_keys`, the surface named, the key echoed,
 *     the closest declared key suggested — not on `success === false`, which a
 *     different failure would satisfy.
 *  2. Every newly declared gantt key is accepted at its measured type and kept
 *     in the parse output, and refused at a wrong type ON ITS OWN PATH, so a
 *     declaration that quietly reverted to `z.unknown()` would show.
 *  3. The doors: a `ListView` and an `ObjectStackDefinition` carrying a gantt
 *     block with a typo are refused AT `gantt`, naming the key — the closure
 *     must reach an author through the schemas they actually parse with.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  CalendarConfigSchema,
  GanttConfigSchema,
  ListMapConfigSchema,
  ListViewSchema,
  TimelineConfigSchema,
  TreeConfigSchema,
} from './view.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };

/** Refuse `value` through `schema` and return its issues, typed for the envelope assertions below. */
function refuse(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown): Issue[] {
  const r = schema.safeParse(value);
  expect(r.success, `expected REFUSAL, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return ((r.error as { issues?: Issue[] })?.issues ?? []) as Issue[];
}

/** Parse `value` and fail with the issues if it does not succeed. */
function accept<T>(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } }, value: unknown): T {
  const r = schema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')}`).toBe(true);
  return r.data as T;
}

/** The one `unrecognized_keys` issue at `path`, asserted to name the surface and echo every key. */
function unknownKeyIssue(issues: Issue[], path: PropertyKey[], surface: string, keys: string[]): Issue {
  const hit = issues.find((i) => i.code === 'unrecognized_keys' && JSON.stringify(i.path) === JSON.stringify(path));
  expect(hit, `no unrecognized_keys issue at ${JSON.stringify(path)} in ${JSON.stringify(issues)}`).toBeDefined();
  expect(hit!.message).toContain(`Unrecognized key(s) on ${surface}`);
  for (const k of keys) {
    expect(hit!.keys, `the refused key must be echoed in \`keys\``).toContain(k);
    expect(hit!.message).toContain(`\`${k}\``);
  }
  return hit!;
}

const GANTT_REQUIRED = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' };

// ===========================================================================
// 1. The card's probe — five blocks, one undeclared key, two lit controls
// ===========================================================================
describe('the card\'s probe: every view config block refuses `bogus_key_xyz` (#15469)', () => {
  it('CONTROLS — the mechanism works in this zod, in this process', () => {
    // Two spellings of a closed object, so "the sibling schemas refuse" below
    // is measured against a lit instrument rather than assumed.
    expect(z.object({ a: z.string() }).strict().safeParse({ a: 'x', bogus_key_xyz: 1 }).success).toBe(false);
    expect(z.strictObject({ a: z.string() }).safeParse({ a: 'x', bogus_key_xyz: 1 }).success).toBe(false);
  });

  it.each([
    ['gantt', GanttConfigSchema, GANTT_REQUIRED, 'this gantt configuration'],
    ['tree', TreeConfigSchema, {}, 'this tree configuration'],
    ['calendar', CalendarConfigSchema, { startDateField: 'starts_at' }, 'this calendar configuration'],
    ['timeline', TimelineConfigSchema, { startDateField: 'starts_at', titleField: 'name' }, 'this timeline configuration'],
    ['map', ListMapConfigSchema, {}, 'this map configuration'],
  ] as const)('%s refuses an undeclared key on its named surface, echoing the key', (_name, schema, required, surface) => {
    // The required members alone parse — so the refusal below is the KEY, not
    // a missing member (timeline's own `titleField` requirement is the case
    // that would otherwise mask it).
    accept(schema, required);
    const issues = refuse(schema, { ...required, bogus_key_xyz: 1 });
    unknownKeyIssue(issues, [], surface, ['bogus_key_xyz']);
    expect(issues.filter((i) => i.code !== 'unrecognized_keys'), 'the ONLY issue is the unknown key').toHaveLength(0);
  });

  it('gantt — the strictObject error suggests the closest declared key (the #14471 typo)', () => {
    const [issue] = refuse(GanttConfigSchema, { ...GANTT_REQUIRED, colourField: 'status' });
    expect(issue.message).toContain('`colourField`');
    expect(issue.message).toMatch(/Did you mean .*`colourField` → `colorField`/);
  });

  it('tree — the same suggestion on the other closed block', () => {
    const [issue] = refuse(TreeConfigSchema, { labelFeild: 'name' });
    expect(issue.message).toContain('`labelFeild`');
    expect(issue.message).toMatch(/Did you mean .*`labelFeild` → `labelField`/);
  });

  it('tree — the four keys plugin-tree reads all parse; nothing else was ever read, so nothing else is declared', () => {
    const parsed = accept<Record<string, unknown>>(TreeConfigSchema, {
      parentField: 'parent_id', labelField: 'name', fields: ['code', 'owner'], defaultExpandedDepth: 1,
    });
    expect(Object.keys(parsed).sort()).toEqual(['defaultExpandedDepth', 'fields', 'labelField', 'parentField']);
    expect(Object.keys(TreeConfigSchema.shape).sort()).toEqual(['defaultExpandedDepth', 'fields', 'labelField', 'parentField']);
  });
});

// ===========================================================================
// 2. The ten declared gantt keys — accepted at type, refused at a wrong one
// ===========================================================================
const FULL_TEN = {
  borderColorField: 'alert_color',
  lockField: 'is_locked',
  objectField: 'row_object',
  summaryExtent: 'self',
  defaultCollapsedDepth: 2,
  dependencyTypes: false,
  timeZone: 'Asia/Shanghai',
  exportFileName: 'Shift plan',
  interactions: { move: true, resize: false, progress: true, link: false },
  timeSegments: {
    dayStart: '08:00',
    bands: [
      { key: 'day', label: 'Day shift', start: '08:00', end: '20:00', color: '#fde68a' },
      { key: 'night', label: 'Night shift', start: '20:00', end: '08:00' },
    ],
    showMidnight: false,
  },
} as const;

describe('the ten keys plugin-gantt read through the window are DECLARED (#15469)', () => {
  it('the shape carries exactly the ten, beside the nineteen it already had', () => {
    const keys = Object.keys(GanttConfigSchema.shape);
    for (const k of Object.keys(FULL_TEN)) expect(keys, `${k} must be a declared member`).toContain(k);
    // objectui's `FLAT_GANTT_CONFIG_KEYS` reads this `.shape` — the count is
    // what its coverage pin compiles against, so it is pinned here as a number.
    expect(keys).toHaveLength(29);
  });

  it.each(Object.entries(FULL_TEN))('accepts `%s` at its measured type and keeps it in the output', (key, value) => {
    const parsed = accept<Record<string, unknown>>(GanttConfigSchema, { ...GANTT_REQUIRED, [key]: value });
    expect(parsed[key]).toEqual(value);
  });

  it('accepts all ten together through the ListView door', () => {
    const parsed = accept<{ gantt: Record<string, unknown> }>(ListViewSchema, {
      type: 'gantt', columns: ['name'], gantt: { ...GANTT_REQUIRED, ...FULL_TEN },
    });
    expect(parsed.gantt).toMatchObject(FULL_TEN);
  });

  it.each([
    ['borderColorField', 1, ['borderColorField']],
    ['lockField', true, ['lockField']],
    ['objectField', ['task'], ['objectField']],
    ['summaryExtent', 'both', ['summaryExtent']],
    ['defaultCollapsedDepth', 'two', ['defaultCollapsedDepth']],
    ['defaultCollapsedDepth', -1, ['defaultCollapsedDepth']],
    ['defaultCollapsedDepth', 1.5, ['defaultCollapsedDepth']],
    ['dependencyTypes', 'yes', ['dependencyTypes']],
    ['timeZone', 8, ['timeZone']],
    ['exportFileName', { base: 'x' }, ['exportFileName']],
    ['interactions', { move: 'no' }, ['interactions', 'move']],
    ['interactions', true, ['interactions']],
    ['timeSegments', { dayStart: '08:00' }, ['timeSegments', 'bands']],
    ['timeSegments', { bands: [{ start: '08:00', end: '20:00' }] }, ['timeSegments', 'bands', 0, 'label']],
    ['timeSegments', { bands: [{ label: 'Day', start: 8, end: '20:00' }] }, ['timeSegments', 'bands', 0, 'start']],
  ] as const)('refuses `%s` = %j at its own path', (key, value, path) => {
    const issues = refuse(GanttConfigSchema, { ...GANTT_REQUIRED, [key]: value });
    expect(issues.map((i) => JSON.stringify(i.path)), `expected an issue at ${JSON.stringify(path)}`)
      .toContain(JSON.stringify(path));
  });

  it('summaryExtent — the wrong value is refused naming both members', () => {
    const [issue] = refuse(GanttConfigSchema, { ...GANTT_REQUIRED, summaryExtent: 'both' });
    expect(issue.code).toBe('invalid_value');
    expect(issue.message).toContain('children');
    expect(issue.message).toContain('self');
  });

  it('the nested blocks are closed too — strictness is per object, and each nested surface is named', () => {
    // A loose `z.object` here would be the second de-facto contract the ruling
    // closes: the sub-object would accept anything again, one level down.
    unknownKeyIssue(
      refuse(GanttConfigSchema, { ...GANTT_REQUIRED, interactions: { move: true, drag: false } }),
      ['interactions'], 'this gantt interactions block', ['drag'],
    );
    unknownKeyIssue(
      refuse(GanttConfigSchema, { ...GANTT_REQUIRED, timeSegments: { bands: [], shifts: [] } }),
      ['timeSegments'], 'this gantt time-segments block', ['shifts'],
    );
    unknownKeyIssue(
      refuse(GanttConfigSchema, { ...GANTT_REQUIRED, timeSegments: { bands: [{ label: 'Day', start: '08:00', end: '20:00', from: '08:00' }] } }),
      ['timeSegments', 'bands', 0], 'this gantt shift band', ['from'],
    );
  });

  it('the curated aliases steer the semantic near-misses at the key the renderer reads', () => {
    const drag = unknownKeyIssue(
      refuse(GanttConfigSchema, { ...GANTT_REQUIRED, interactions: { drag: false } }),
      ['interactions'], 'this gantt interactions block', ['drag'],
    );
    expect(drag.message).toContain('`drag` → `move`');
    const from = unknownKeyIssue(
      refuse(GanttConfigSchema, { ...GANTT_REQUIRED, timeSegments: { bands: [{ label: 'Day', from: '08:00', to: '20:00' }] } }),
      ['timeSegments', 'bands', 0], 'this gantt shift band', ['from', 'to'],
    );
    expect(from.message).toContain('`from` → `start`');
    expect(from.message).toContain('`to` → `end`');
  });
});

// ===========================================================================
// 3. The doors — the closure reaches an author through the schemas they parse with
// ===========================================================================
describe('a gantt typo is refused AT `gantt` through the real doors (#15469)', () => {
  const typoView = { type: 'gantt', columns: ['name'], gantt: { ...GANTT_REQUIRED, colourField: 'status' } };

  it('ListViewSchema — refused at [gantt], naming the key and suggesting colorField', () => {
    const issues = refuse(ListViewSchema, typoView);
    const issue = unknownKeyIssue(issues, ['gantt'], 'this gantt configuration', ['colourField']);
    expect(issue.message).toContain('`colourField` → `colorField`');
    // The positive control: the same view with the key spelled right parses.
    accept(ListViewSchema, { ...typoView, gantt: { ...GANTT_REQUIRED, colorField: 'status' } });
  });

  it('ListViewSchema — a tree typo is refused at [tree] the same way', () => {
    const issues = refuse(ListViewSchema, { type: 'tree', columns: ['name'], tree: { labelFeild: 'name' } });
    const issue = unknownKeyIssue(issues, ['tree'], 'this tree configuration', ['labelFeild']);
    expect(issue.message).toContain('`labelFeild` → `labelField`');
    accept(ListViewSchema, { type: 'tree', columns: ['name'], tree: { labelField: 'name' } });
  });

  it('ObjectStackDefinitionSchema — refused at objects[0].listViews.schedule.gantt through the ADR-0047 door', () => {
    const stack = (gantt: Record<string, unknown>) => ({
      manifest: { id: 'com.test.gantt', name: 'test', version: '1.0.0', type: 'app' },
      objects: [{
        name: 'task',
        fields: {
          name: { type: 'text' },
          start_date: { type: 'date' },
          end_date: { type: 'date' },
          status: { type: 'text' },
        },
        listViews: { schedule: { type: 'gantt', columns: ['name'], gantt } },
      }],
    });
    // Positive control first — a well-formed stack with all ten keys parses,
    // so the refusal below is the typo and not the fixture.
    accept(ObjectStackDefinitionSchema, stack({ ...GANTT_REQUIRED, ...FULL_TEN }));
    const issues = refuse(ObjectStackDefinitionSchema, stack({ ...GANTT_REQUIRED, colourField: 'status' }));
    const issue = unknownKeyIssue(issues, ['objects', 0, 'listViews', 'schedule', 'gantt'], 'this gantt configuration', ['colourField']);
    expect(issue.message).toContain('`colourField` → `colorField`');
  });
});
