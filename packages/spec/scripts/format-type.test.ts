// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for how the reference-docs renderer prints an OPEN object — one that
 * declares keys AND accepts more (`.passthrough()` / `.catchall()`) — #4912.
 *
 * The renderer used to test `additionalProperties` BEFORE `properties`, and the
 * two are not alternatives: JSON Schema spells a passthrough object as both at
 * once. Every such node therefore collapsed to `Record<string, any>`, erasing
 * the declared keys from the author-facing page. `BulkActionParam.options` is
 * the specimen the issue was filed from — its `label`/`value` are *required*
 * (zero tolerance, pinned by the schema's own tests), yet the page showed
 * `Record<string, any>[]`, i.e. "no shape at all".
 *
 * This is a live-and-growing class, not a one-off: the #4001 strictness
 * campaign keeps producing "declared keys + deliberate passthrough" sites
 * (`DashboardWidget.config`, `BulkActionParam` itself, the `data/` mixed
 * verdicts still to land), and each one erased its own keys on the day it
 * landed. PR #4909 compensated by hand, in that key's `.describe()` prose —
 * per-site compensation, not a fix.
 *
 * MEASURED (reverse verification): restoring the old branch order — testing
 * `additionalProperties` before `properties` — turns the four `open object`
 * cases below red with `Record<string, any>` in place of every declared shape.
 * The direction is the ordinary one (restore the defect → new pins go red)
 * because these assert a POSITIVE shape the fix produces, not the absence of a
 * finding. The `closed`/`pure record` cases stay green either way, which is
 * exactly why the bug survived: the renderer was correct on both of the shapes
 * anyone thought to look at.
 */

import { describe, expect, it } from 'vitest';

import { formatType, type TypeContext } from './lib/format-type';

const ctx = (defs: Record<string, any> = {}): TypeContext => ({
  defs,
  currentSchema: 'Probe',
  schemaHref: () => null,
});

/** The real `BulkActionParam.options` node, as `gen:schema` emits it. */
const BULK_ACTION_OPTIONS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    },
    required: ['label', 'value'],
    additionalProperties: {},
  },
};

describe('formatType — open objects keep their declared shape (#4912)', () => {
  it('renders an array of passthrough objects with BOTH the declared keys and the openness marker', () => {
    const rendered = formatType(BULK_ACTION_OPTIONS, ctx());

    // The regression itself: the declared pair must not be erased.
    expect(rendered).toContain('label: string');
    expect(rendered).toContain('value: string | number | boolean');
    // ...and the openness must still be stated, not silently dropped.
    expect(rendered).toContain('Record<string, any>');
    // Parenthesized: `A & B[]` is `A & (B[])` in TypeScript, so the unbracketed
    // spelling would claim `options` is an object intersected with an array.
    expect(rendered).toBe(
      '({ label: string; value: string | number | boolean } & Record<string, any>)[]',
    );
  });

  it('parenthesizes an intersection element before suffixing `[]`, but not a plain one', () => {
    const open = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: {} };
    expect(formatType({ type: 'array', items: open }, ctx()))
      .toBe('({ a?: string } & Record<string, any>)[]');

    // A closed element needs no parens — the existing spelling is preserved.
    expect(formatType({ type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } }, ctx()))
      .toBe('{ a?: string }[]');
    expect(formatType({ type: 'array', items: { type: 'string' } }, ctx())).toBe('string[]');
    expect(formatType({ type: 'array', items: { type: 'object', additionalProperties: {} } }, ctx()))
      .toBe('Record<string, any>[]');
  });

  it('ignores `&`-free nesting when deciding to parenthesize (no stray brackets)', () => {
    // `Enum<'a' | 'b'>` and markdown links carry `<>`/`[]`/`()` that must not
    // confuse the depth scan into either adding or skipping parens.
    expect(formatType({ type: 'array', items: { enum: ['a', 'b'] } }, ctx()))
      .toBe("Enum<'a' | 'b'>[]");
    expect(formatType({ type: 'array', items: { $ref: '#/$defs/Field' } }, {
      defs: {},
      currentSchema: 'Probe',
      schemaHref: () => '/docs/references/data/field#field',
    })).toBe('[Field](/docs/references/data/field#field)[]');
  });

  it('marks required vs optional keys on an open object the same way a closed one does', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { id: { type: 'string' }, color: { type: 'string' } },
        required: ['id'],
        additionalProperties: {},
      },
      ctx(),
    );
    expect(rendered).toBe('{ id: string; color?: string } & Record<string, any>');
  });

  it('keeps the typed catchall in the marker instead of widening it to `any`', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: { type: 'string' },
      },
      ctx(),
    );
    expect(rendered).toBe('{ name: string } & Record<string, string>');
  });

  it('still elides beyond the fourth declared key, and the marker survives the elision', () => {
    const props: Record<string, any> = {};
    for (const k of ['a', 'b', 'c', 'd', 'e']) props[k] = { type: 'string' };
    const rendered = formatType(
      { type: 'object', properties: props, required: ['a', 'b', 'c', 'd', 'e'], additionalProperties: {} },
      ctx(),
    );
    // `…` means "more DECLARED keys"; `& Record` means "more UNDECLARED keys".
    // They are different facts and the cell must carry both.
    expect(rendered).toBe('{ a: string; b: string; c: string; d: string; … } & Record<string, any>');
  });
});

describe('formatType — the shapes that were already right stay right', () => {
  it('renders a pure record (no declared keys) as a bare Record', () => {
    expect(formatType({ type: 'object', additionalProperties: { type: 'number' } }, ctx()))
      .toBe('Record<string, number>');
    expect(formatType({ type: 'object', additionalProperties: {} }, ctx()))
      .toBe('Record<string, any>');
  });

  it('renders a closed object (`additionalProperties: false`) with no openness marker', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      ctx(),
    );
    expect(rendered).toBe('{ id: string }');
    expect(rendered).not.toContain('Record');
  });

  it('renders a shapeless object as `object`', () => {
    expect(formatType({ type: 'object' }, ctx())).toBe('object');
  });

  it('treats an EMPTY declared-key set as no shape at all, not as `{  }`', () => {
    // `z.object({}).passthrough()` declares nothing — intersecting an empty
    // shape onto the record would print `{  } & Record<...>`, which is noise.
    expect(formatType({ type: 'object', properties: {}, additionalProperties: {} }, ctx()))
      .toBe('Record<string, any>');
    // Without a catchall the pre-existing rendering is kept verbatim.
    expect(formatType({ type: 'object', properties: {} }, ctx())).toBe('{  }');
  });

  it('keeps nested objects opaque so a table cell cannot explode', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { inner: { type: 'object', properties: { deep: { type: 'string' } } } },
        additionalProperties: {},
      },
      ctx(),
    );
    expect(rendered).toBe('{ inner?: object } & Record<string, any>');
  });

  it('still links a $ref through the injected resolver', () => {
    const rendered = formatType({ $ref: '#/$defs/Field' }, {
      defs: {},
      currentSchema: 'Probe',
      schemaHref: (n) => `/docs/references/data/field#${n.toLowerCase()}`,
    });
    expect(rendered).toBe('[Field](/docs/references/data/field#field)');
  });
});
