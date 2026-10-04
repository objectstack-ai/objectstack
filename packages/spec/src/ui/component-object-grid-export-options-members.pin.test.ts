// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21229] `ComponentPropsMap['object-grid'].exportOptions` is the list view's
 * export options OBJECT, by identity — and judged like it.
 *
 * ## What this pin replaced
 *
 * Until #21229 the key was `z.unknown()`, and this file (#17166) held its
 * `.describe()` to naming every member `ListViewExportOptionsSchema` declares,
 * because the prose was then the whole account of the shape. Its last test
 * asserted the key was still unvalidated, so that giving it a real shape would
 * red here and be decided deliberately. #21229 is that decision (triage ruling,
 * not overturned): the row takes the five-member strict object by identity, so
 * the members are no longer prose to keep in step — they are the schema.
 *
 * ## Why identity, and why not the union
 *
 * `ListViewSchema.exportOptions` is a two-arm union: the legacy bare format
 * array, which LIFTS to `{ formats }` at parse, and the object. objectui's
 * `ObjectGrid` reads `exportOptions.formats` and lifts nothing, so on this row a
 * bare array was dropped for the csv/json default. A legacy spelling does not
 * spread to a new surface: the row takes the object arm, the same instance the
 * union holds, and a bare array is refused with the object form named.
 *
 * The expected instance is READ from the union rather than imported by name, so
 * the pin holds the row to whatever object the list view actually declares — a
 * second declaration of the five members on either side reds here.
 */

import { describe, it, expect } from 'vitest';
import { ComponentPropsMap } from './component.zod';
import { ListViewSchema } from './view.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };
type Parsed = { success: boolean; data?: Record<string, unknown>; error?: { issues: Issue[] } };
type Schema = { safeParse(v: unknown): Parsed; unwrap?: () => unknown; options?: unknown[]; shape?: unknown };

const gridProps = ComponentPropsMap['object-grid'] as unknown as Schema & { shape: Record<string, Schema> };

/** The list view's own object arm: the one union member with a `shape`. */
function listViewObjectArm(): unknown {
  const optional = (ListViewSchema as unknown as { shape: Record<string, Schema> }).shape.exportOptions;
  const union = optional.unwrap!() as Schema;
  return (union.options as Schema[]).find((o) => o.shape !== undefined);
}

const grid = (exportOptions: unknown): Parsed => gridProps.safeParse({ objectName: 'account', exportOptions });
const listView = (exportOptions: unknown): Parsed =>
  (ListViewSchema as unknown as Schema).safeParse({ type: 'grid', columns: ['name'], exportOptions });

describe('object-grid `exportOptions` — the list view\'s export options object, by identity (#21229)', () => {
  it('is the very instance the list view\'s union holds as its object arm — not the union', () => {
    const arm = listViewObjectArm();
    // Non-vacuity: an identity check against `undefined` would pass for the
    // worst reason if the union ever lost its object arm.
    expect(arm).toBeDefined();
    const inner = gridProps.shape.exportOptions.unwrap!() as Schema;
    expect(inner).toBe(arm);
    // Not the union: a union carries `options`, the object does not.
    expect(inner.options).toBeUndefined();
  });

  it('refuses a bare format array at `exportOptions`, naming the object form', () => {
    const r = grid(['csv']);
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['exportOptions']);
    expect(issue.message).toContain("{ formats: ['csv', 'xlsx'] }");
    // The control: the same array on the list view is still the legacy spelling
    // and still lifts, so the refusal belongs to this row, not to the block.
    const lifted = listView(['csv']);
    expect(lifted.success).toBe(true);
    expect(lifted.data!.exportOptions).toStrictEqual({ formats: ['csv'] });
  });

  it('accepts the object form, every member, unchanged', () => {
    const all = { formats: ['csv', 'xlsx', 'json'], maxRecords: 500, includeHeaders: false, fileNamePrefix: 'accounts', streaming: false };
    const r = grid(all);
    expect(r.success).toBe(true);
    expect(r.data!.exportOptions).toStrictEqual(all);
    expect(grid({}).success).toBe(true);
    expect(gridProps.safeParse({ objectName: 'account' }).success).toBe(true);
  });

  it('refuses a format outside the enum at its own index, and `pdf` with its retirement text', () => {
    const r = grid({ formats: ['csv', 'xml'] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.code).toBe('invalid_value');
    expect(r.error!.issues[0]!.path).toEqual(['exportOptions', 'formats', 1]);
    expect(r.error!.issues[0]!.message).not.toMatch(/was removed/);

    const pdf = grid({ formats: ['pdf'] });
    expect(pdf.success).toBe(false);
    expect(pdf.error!.issues[0]!.path).toEqual(['exportOptions', 'formats', 0]);
    expect(pdf.error!.issues[0]!.message).toMatch(/'pdf' was removed from `view\.exportOptions` formats/);
  });

  it('refuses a key the block does not declare, with the block\'s own surface and rename', () => {
    const r = grid({ formats: ['csv'], maxRecord: 10 });
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['exportOptions']);
    expect(issue.keys).toEqual(['maxRecord']);
    expect(issue.message).toMatch(/this export options block/);
    expect(issue.message).toMatch(/maxRecords/);
  });
});
