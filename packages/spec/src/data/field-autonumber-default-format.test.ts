// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6555 — a format-less `autonumber` field has ONE declared rendering, and it
 * lives in the contract rather than in each generator's fallback.
 *
 * The defect: `autonumberFormat` is optional, and the two sides that mint
 * record numbers answered "no format declared" differently. `driver-sql`
 * substituted `'{0000}'` (`0001`, `0002`, …); the engine's in-memory fallback
 * path — taken whenever a driver does not advertise `supports.autonumber` —
 * parsed the empty string and fell through {@link renderAutonumber}'s no-slot
 * branch to a bare counter (`1`, `2`, …). Both sides agreed on the counter
 * VALUE (#6468 pinned that); they disagreed on its shape, so a suite asserting
 * `'1'` against the memory driver did not hold in production on SQL, and the
 * same object's historical numbers changed shape at a driver switch.
 *
 * The maintainer ruling of 2026-08-08 picks `{0000}` and route 3 — put the
 * default in the contract, then delete both fallbacks. These cases pin the
 * contract half: what `FieldSchema` DECLARES about the omitted key, and — just
 * as load-bearing — what it does NOT do to parse output while declaring it.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FieldSchema } from './field.zod';
import { DEFAULT_AUTONUMBER_FORMAT, resolveAutonumberFormat } from './autonumber-format';

describe('FieldSchema.autonumberFormat — the declared contract default (#6555)', () => {
  it('declares `{0000}` as the JSON-Schema default for the key', () => {
    const js = z.toJSONSchema(FieldSchema as unknown as z.ZodType, {
      unrepresentable: 'any',
      io: 'input',
    }) as any;
    const prop = js.properties?.autonumberFormat;
    expect(prop).toBeDefined();
    // The machine-readable half of "declared": a schema consumer or an AI
    // metadata author reads the default off the contract instead of guessing
    // per-driver behaviour.
    expect(prop.default).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(prop.default).toBe('{0000}');
    expect(prop.description).toContain('{0000}');
  });

  it('keeps the key OPTIONAL — declaring the default must not make it required', () => {
    const js = z.toJSONSchema(FieldSchema as unknown as z.ZodType, {
      unrepresentable: 'any',
      io: 'input',
    }) as any;
    expect(js.required ?? []).not.toContain('autonumberFormat');
  });

  it('does not materialize the default into parse output — on any field type', () => {
    // The reason this is an annotation and not a Zod `.default()`:
    // `autonumberFormat` is FLAT on FieldSchema, shared by every field type, so
    // a parse-time default would stamp a counter format onto every `text`,
    // `number` and `lookup` field in the system. Parse output is observed by
    // metadata loaders, the metadata API and the drivers' `initObjects`, so
    // that shift would be visible far outside autonumber.
    for (const type of ['text', 'number', 'lookup', 'boolean'] as const) {
      const parsed = FieldSchema.parse({ type, label: 'X' }) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('autonumberFormat');
    }
    const auto = FieldSchema.parse({ type: 'autonumber', label: 'No.' }) as Record<string, unknown>;
    expect(auto).not.toHaveProperty('autonumberFormat');
  });

  it('resolves a parsed format-less autonumber field to `{0000}` semantics', () => {
    // The declared contract, exercised the way a generator will: parse the
    // author's document, then ask the contract what it renders with. The key
    // is absent from the parse output above, and the answer is still `{0000}`.
    const parsed = FieldSchema.parse({ type: 'autonumber', label: 'Record No.' });
    expect(resolveAutonumberFormat(parsed as never)).toBe('{0000}');

    // An explicitly declared format survives the round trip untouched.
    const declared = FieldSchema.parse({
      type: 'autonumber',
      label: 'Invoice No.',
      autonumberFormat: 'INV-{YYYY}-{0000}',
    });
    expect(resolveAutonumberFormat(declared as never)).toBe('INV-{YYYY}-{0000}');
  });
});
