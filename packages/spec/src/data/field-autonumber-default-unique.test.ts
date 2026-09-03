// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13894 — an `autonumber` field is `unique: 'organization'` by default.
 *
 * Maintainer ruling 2026-08-31 (hotcrm#1301): an auto-number is a business
 * identifier, and an identifier that may repeat is not one — so uniqueness is
 * the platform default and opting out is the declaration. Before this card
 * the platform only materialized a unique index where the author had written
 * `unique` by hand: of hotcrm's nine auto-numbered identifiers exactly one
 * (`crm_case.case_number`) carried the tenant-composite index, and the other
 * eight could mint the same number twice (#12394 re-issued `ACC-000009`).
 *
 * Mechanism under test: `unique` is `.optional()` on the shape and the
 * `.overwrite()` tail of `FieldSchema` materializes the default
 * type-conditionally (the #9689 / #9784 `deleteBehavior` precedent), because
 * a key-level `.default()` can neither see `type` nor tell an omitted key from
 * an authored `false` — the one distinction the opt-out rests on — and because
 * every driver reads the parsed `unique` value-only
 * (`isUniqueScopeDeclared(field.unique)`), so the default must be PRESENT on
 * the parsed field for an index to exist at all.
 *
 * These pins assert the substance, each from a different consumer's seat:
 * what the parsed field carries, what the opt-out yields, that no other type
 * moved (value AND key position — built artifacts are compared byte-wise),
 * that re-parsing is stable (the #9689 class: `ObjectSchema.create()` →
 * `defineStack` re-parses on the mainline app-build path), that the object
 * path the driver reads through carries it, and that the driver-facing
 * predicates read it as a declared per-organization scope.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  Field,
  FieldSchema,
  FieldType,
  isUniqueDeclared,
  isGlobalUnique,
  isOrganizationUnique,
} from './field.zod';
import { ObjectSchema } from './object.zod';

/** Minimal valid authored input per field type (relationship types need a target). */
function minimalField(type: string): Record<string, unknown> {
  const input: Record<string, unknown> = { type };
  if (type === 'lookup' || type === 'master_detail' || type === 'tree') input.reference = 'account';
  if (type === 'summary') input.summaryOperations = { object: 'line', field: 'amount', function: 'sum' };
  if (type === 'formula') input.expression = '1 + 1';
  return input;
}

describe('#13894 — autonumber defaults to unique: organization', () => {
  it("materializes 'organization' when the author omits `unique`", () => {
    const parsed = FieldSchema.parse({ type: 'autonumber' });
    expect(parsed.unique).toBe('organization');
    // The value the drivers act on: declared, per-organization, not global.
    expect(isUniqueDeclared(parsed.unique)).toBe(true);
    expect(isOrganizationUnique(parsed.unique)).toBe(true);
    expect(isGlobalUnique(parsed.unique)).toBe(false);
  });

  it('honours an explicit `unique: false` — the opt-out spelling, and the only one', () => {
    const parsed = FieldSchema.parse({ type: 'autonumber', unique: false });
    expect(parsed.unique).toBe(false);
    expect(isUniqueDeclared(parsed.unique)).toBe(false);
  });

  it('returns every authored spelling verbatim on an autonumber field', () => {
    for (const unique of [true, 'organization', 'global'] as const) {
      expect(FieldSchema.parse({ type: 'autonumber', unique }).unique).toBe(unique);
    }
  });

  it('leaves every other field type at `unique: false` when omitted', () => {
    const others = FieldType.options.filter((t) => t !== 'autonumber');
    expect(others.length).toBeGreaterThan(40);
    for (const type of others) {
      const result = FieldSchema.safeParse(minimalField(type));
      expect(result.success, `${type}: ${result.success ? '' : result.error.message}`).toBe(true);
      if (!result.success) continue;
      expect(result.data.unique, type).toBe(false);
    }
  });

  it('keeps `unique` at its shape position on every type (byte-identity of parse output)', () => {
    // Zod emits parse output in shape order; the overwrite re-inserts the
    // materialized key at that position rather than appending it. Assert the
    // parsed key order IS the shape order restricted to the keys present.
    const shapeOrder = Object.keys(FieldSchema.shape);
    for (const input of [{ type: 'text' }, { type: 'autonumber' }, { type: 'lookup', reference: 'account' }]) {
      const parsed = FieldSchema.parse(input) as Record<string, unknown>;
      const keys = Object.keys(parsed);
      expect(keys).toEqual(shapeOrder.filter((k) => k in parsed));
      expect(keys).toContain('unique');
    }
    // And the position did not move relative to the pre-flip output: `unique`
    // sits where the `.default(false)` era put it, right after `multiple`.
    const text = Object.keys(FieldSchema.parse({ type: 'text' }));
    expect(text.indexOf('unique')).toBe(text.indexOf('multiple') + 1);
  });

  it('is idempotent — parse(parse(x)) is byte-identical (the #9689 class)', () => {
    for (const input of [{ type: 'autonumber' }, { type: 'autonumber', unique: false }, { type: 'text' }]) {
      const once = FieldSchema.parse(input);
      const twice = FieldSchema.parse(once);
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    }
  });

  it('applies through ObjectSchema — the path the driver reads through `ObjectSchema.create()` / `defineStack`', () => {
    const obj = ObjectSchema.parse({
      name: 'crm_quote',
      fields: {
        quote_number: { type: 'autonumber', autonumberFormat: 'QUO-{00000}' },
        line_no: { type: 'autonumber', unique: false },
        title: { type: 'text' },
      },
    });
    expect(obj.fields.quote_number.unique).toBe('organization');
    expect(obj.fields.line_no.unique).toBe(false);
    expect(obj.fields.title.unique).toBe(false);
  });

  it('the `Field.autonumber()` builder lands on the default too', () => {
    expect(FieldSchema.parse(Field.autonumber({ label: 'Quote No.' })).unique).toBe('organization');
    expect(FieldSchema.parse(Field.autonumber({ label: 'Line', unique: false })).unique).toBe(false);
  });

  it('the published JSON Schema carries no single `default` for `unique` and states the rule instead', () => {
    // A single JSON-Schema `default` would be wrong for one of the two cases
    // (false on 48 types, 'organization' on autonumber), so the emitter must
    // not advertise one; the description is the machine-readable statement.
    // Same emitter call `scripts/build-schemas.ts` makes: output mode first,
    // input mode when a transform elsewhere on the shape is unrepresentable.
    type Emitted = { properties: Record<string, { default?: unknown; description?: string }> };
    let schema: Emitted;
    try {
      schema = z.toJSONSchema(FieldSchema, { target: 'draft-2020-12' }) as Emitted;
    } catch {
      schema = z.toJSONSchema(FieldSchema, { target: 'draft-2020-12', io: 'input' }) as Emitted;
    }
    expect(schema.properties.unique).toBeDefined();
    expect('default' in schema.properties.unique).toBe(false);
    expect(schema.properties.unique.description).toMatch(/autonumber/);
    expect(schema.properties.unique.description).toMatch(/unique: false/);
  });
});
