/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6043 — `MetadataService` never writes `formula`, and does not rename
 * it to `expression` either.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`). `FieldMetadataPayload` is one
 * of that gate's two `wire` shapes: `toFieldPayload` builds it and `saveFields`
 * PUTs `fields.map(toFieldPayload)` to `PUT /api/v1/meta/object/:name`.
 *
 * `formula` is not in `FieldSchema`'s accept set. Measured against the installed
 * `@objectstack/spec` 17.2.0:
 *
 *   FieldSchema.safeParse({ type:'formula', label:'Total', formula:'price * quantity' })
 *     => success = false
 *     => unrecognized_keys ['formula']
 *        "Did you mean `formula` -> `expression`?"
 *
 * which the route returns as a hard 422 `INVALID_METADATA`. Because the key is
 * then STORED, every later save of that object fails the same way.
 *
 * ## The rename this file proves was NOT taken
 *
 * The obvious repair — emit `expression` instead — was refused, and the control
 * below is what keeps that decision legible. `FieldSchema` judges the KEY, never
 * the expression LANGUAGE: it accepts `expression: '!!!not cel at all!!!'`.
 * Spec `expression` is CEL rooted at `record`, whereas the designer control this
 * card retired taught `price * quantity` — bare field refs that evaluate to null
 * silently under the scope formulas bind. Renaming would therefore have replaced
 * a loud 422 with a formula that saves clean and computes nothing.
 *
 * Assertions are on the bytes actually PUT — `JSON.parse` of the captured
 * request body — not on the object handed to the client. A property whose value
 * is `undefined` is a key zod's strict object COUNTS but `JSON.stringify` DROPS,
 * so an in-memory assertion and a wire assertion disagree exactly here.
 *
 * This file names no `reference`/`referenceTo` key, so reverting objectui#6041
 * cannot red it, and vice versa.
 */

import { describe, expect, it, vi } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { MetadataService } from './MetadataService';

/** The bodies of every PUT the SDK issued, exactly as they went over the wire. */
function makeCapturingAdapter() {
  const puts: Array<Record<string, unknown>> = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { adapter, puts };
}

/**
 * The field defs of the last PUT, in wire order.
 *
 * `fields` is a name-keyed MAP on the wire (objectui#6240 — `ObjectSchema`
 * refuses an array at the value level), and this file's subject is what is
 * INSIDE one field def, so it reads the map's values in insertion order, which
 * is the only field order the spec has. The CONTAINER shape is pinned by
 * `MetadataService.objectPayloadFieldsMap.test.ts`, deliberately not here.
 */
function savedFields(puts: Array<Record<string, unknown>>): Record<string, unknown>[] {
  const fields = puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
  return Object.values(fields);
}

const unrecognizedKeys = (result: ReturnType<typeof FieldSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

const FORMULA_FIELD: DesignerFieldDefinition = {
  id: 'total',
  name: 'total',
  label: 'Total',
  type: 'formula',
};

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    // objectstack#4001 closed the silent-drop shape. Every parity assertion
    // below depends on it: a stripping schema would make them all trivially
    // green while the 422 still happened server-side.
    const result = FieldSchema.safeParse({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('refuses `formula` by name while accepting the field TYPE `formula`', () => {
    expect(
      unrecognizedKeys(FieldSchema.safeParse({ type: 'formula', label: 'Total', formula: 'price * quantity' })),
    ).toEqual(['formula']);
    // Only the expression key was ever the defect. The type stays authorable.
    expect(FieldSchema.safeParse({ type: 'formula', label: 'Total' }).success).toBe(true);
  });

  it('accepts `expression` without parsing the CEL in it — why the rename was refused', () => {
    expect(FieldSchema.safeParse({ type: 'formula', label: 'T', expression: '!!!not cel at all!!!' }).success).toBe(
      true,
    );
  });
});

describe('objectui#6043 · saveFields never PUTs a formula expression', () => {
  it('emits neither `formula` nor `expression` for a formula field', async () => {
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('invoice', [FORMULA_FIELD]);

    const [def] = savedFields(puts);
    expect('formula' in def).toBe(false);
    // Not renamed. `toFieldPayload` has no expression source to write and must
    // not invent one — see this file's header for why that is the fix.
    expect('expression' in def).toBe(false);
    // Falsification: the field itself made the trip, so the two absences above
    // are a payload builder that stopped copying the key, not an empty PUT.
    expect(def.type).toBe('formula');
    expect(def.label).toBe('Total');
  });

  it('drops a `formula` smuggled onto the field instead of copying it through', async () => {
    // `DesignerFieldDefinition` no longer DECLARES `formula`, so this cast is
    // the point rather than a workaround: it proves `toFieldPayload` is closed
    // at RUNTIME, not merely that the type forbids the key. A stale build, a JS
    // caller, or a re-added designer control all arrive by exactly this route.
    const { adapter, puts } = makeCapturingAdapter();
    const smuggled = { ...FORMULA_FIELD, formula: 'price * quantity' } as DesignerFieldDefinition;

    await new MetadataService(adapter).saveFields('invoice', [smuggled]);

    const [def] = savedFields(puts);
    expect('formula' in def).toBe(false);
    expect('expression' in def).toBe(false);
  });

  it('the PUT body parses through the real FieldSchema', async () => {
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('invoice', [FORMULA_FIELD]);

    const [def] = savedFields(puts);
    const result = FieldSchema.safeParse(def);
    expect(unrecognizedKeys(result)).toEqual([]);
    expect(result.success).toBe(true);
  });
});
