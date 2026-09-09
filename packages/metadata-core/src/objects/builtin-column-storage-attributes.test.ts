// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15335 — this package's own shipped declarations must not trip the
 * builtin-column diagnostic.
 *
 * `initObjects` emits `id`, `created_at` and `updated_at` itself and skips any
 * declared field colliding with one, so the STORAGE half of such a declaration
 * is discarded. #12015 made that loud instead of silent; #12131 then cleared 45
 * system objects that were declaring `id` as `text`. `sys_metadata_commit`
 * survived both because its residue was an attribute (`maxLength: 64`) rather
 * than a type — measured on `origin/main` at 70f7d6d735, it was one of only two
 * declarations left in the whole repo that still tripped the diagnostic, and it
 * warned on every clean boot about the platform's own table.
 *
 * ⛔ The remedy is NOT to quiet the diagnostic — it is working as designed and is
 * exactly what #12015 was filed for. What this pin holds is the other side: the
 * platform's own declarations stay clean, so a boot that prints one of these
 * warnings is always about code the reader wrote.
 *
 * The authoritative classification of "storage" vs "presentation" keys lives in
 * one table, `FIELD_KEY_STORAGE_CLASS` in `@objectstack/driver-sql`'s
 * `builtin-column-collision.ts`, and is pinned there against `FieldSchema.shape`.
 * ⛔ This file deliberately does not copy that table — metadata-core does not
 * depend on the driver, and a hand-copied second list is how the two halves
 * drift. It pins the one attribute this card removed, over EVERY object the
 * package ships, with a positive control in the same run so a green result is a
 * measurement rather than an empty loop.
 */

import { describe, expect, it } from 'vitest';
import * as objects from './index.js';

/** The three columns `initObjects` emits itself, so a declaration on them loses its storage half. */
const PLATFORM_EMITTED_COLUMNS = ['id', 'created_at', 'updated_at'] as const;

/** `maxLength` on a platform-emitted column: declared, discarded, and warned about on every boot. */
function declaredBoundsOnBuiltins(schema: {
  name?: unknown;
  fields?: Record<string, unknown>;
}): string[] {
  const found: string[] = [];
  for (const column of PLATFORM_EMITTED_COLUMNS) {
    const declaration = schema.fields?.[column] as Record<string, unknown> | undefined;
    if (declaration && declaration.maxLength !== undefined) {
      found.push(`${String(schema.name)}.${column} declares maxLength: ${String(declaration.maxLength)}`);
    }
  }
  return found;
}

const SHIPPED: Array<[string, { name: string; fields: Record<string, unknown> }]> = [];
for (const [exportName, value] of Object.entries(objects as Record<string, unknown>)) {
  const schema = value as { name?: unknown; fields?: unknown };
  if (typeof schema?.name !== 'string') continue;
  if (typeof schema?.fields !== 'object' || schema.fields === null) continue;
  SHIPPED.push([exportName, { name: schema.name, fields: schema.fields as Record<string, unknown> }]);
}

describe('#15335 — metadata-core declares no storage attribute the platform cannot deliver', () => {
  it('ships object schemas at all — the loop below is otherwise vacuous', () => {
    expect(SHIPPED.length).toBeGreaterThan(0);
    expect(SHIPPED.map(([, schema]) => schema.name)).toContain('sys_metadata_commit');
  });

  it('detects the shape it forbids — positive control, same predicate, same run', () => {
    expect(
      declaredBoundsOnBuiltins({ name: 'synthetic', fields: { id: { type: 'text', maxLength: 64 } } }),
    ).toEqual(['synthetic.id declares maxLength: 64']);
    // …and stays silent on the honoured half, so it is a detector and not a blanket.
    expect(
      declaredBoundsOnBuiltins({
        name: 'synthetic',
        fields: { id: { type: 'text', label: 'ID', required: true, readonly: true } },
      }),
    ).toEqual([]);
  });

  for (const [exportName, schema] of SHIPPED) {
    it(`${exportName} (${schema.name}) declares no maxLength on a platform-emitted column`, () => {
      expect(declaredBoundsOnBuiltins(schema)).toEqual([]);
    });
  }
});
