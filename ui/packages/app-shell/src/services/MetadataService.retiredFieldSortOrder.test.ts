/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6045 — `MetadataService` never writes a field-level `sortOrder`.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`). `FieldMetadataPayload` is one
 * of that gate's field-level `wire` shapes: `toFieldPayload` builds it and
 * `saveFields` PUTs `fields.map(toFieldPayload)` to
 * `PUT /api/v1/meta/object/:name`.
 *
 * `sortOrder` is not in `FieldSchema`'s accept set. Measured against the
 * installed `@objectstack/spec` 17.2.0:
 *
 *   FieldSchema.safeParse({ type:'text', label:'L', sortOrder: 3 })
 *     => success = false
 *     => unrecognized_keys ['sortOrder']
 *
 * which the route returns as a hard 422 `INVALID_METADATA`. Because the key is
 * then STORED, every later save of that object fails the same way.
 *
 * ## Why the resolution was deletion, not a rename
 *
 * This is objectui#4687's shape, not objectui#6041's. The spec has no
 * field-level ordering key AT ALL — it models field order by DECLARATION ORDER
 * in the object's `fields` record — so there was no spelling to move to. The
 * near-spelling `sortable` is NOT a rename target and the control below proves
 * it is a different concept: it is a BOOLEAN ("whether field is sortable in
 * list views"), so `sortable: 3` does not even parse.
 *
 * ## What "latent" meant, and which assertion is the load-bearing one
 *
 * Nothing on the tree ever populated a field's `sortOrder`: neither of the two
 * sites that construct a `DesignerFieldDefinition` (`FieldDesigner`'s
 * create/update handlers and `MetadataFieldsPage.toDesignerField`) names the
 * key, so `toFieldPayload` emitted `sortOrder: undefined` and
 * `JSON.stringify` dropped it. That has two consequences for this file:
 *
 *   - The plain "a normal field PUTs no `sortOrder`" case below WOULD STILL
 *     PASS if the copy were restored, exactly as objectui#6223's half-filled
 *     case would. It is here to show the removal did not break the untouched
 *     path — a claim about what did NOT change.
 *   - The SMUGGLED case is the one that reds on a revert, and it is the reason
 *     this file is not a pin on an assertion that cannot fail. Restoring
 *     `sortOrder: field.sortOrder` in `toFieldPayload` puts the key back on the
 *     wire and fails it.
 *
 * Assertions are on the bytes actually PUT — `JSON.parse` of the captured
 * request body — not on the object handed to the client. A property whose value
 * is `undefined` is a key zod's strict object COUNTS but `JSON.stringify`
 * DROPS, so an in-memory assertion and a wire assertion disagree exactly here.
 *
 * ## The two keys that share this spelling and are NOT this card
 *
 * `sortOrder` names three unrelated concepts in this repo, which is why the
 * census for this card was on the SHAPE (a field-metadata payload key
 * `FieldSchema` refuses) rather than on the identifier:
 *
 *   - OBJECT-level `sortOrder` — the Object Manager's display order, refused by
 *     `ObjectSchema`, removed from the object wire shape by objectui#6223 and
 *     deliberately KEPT on the `ObjectDefinition` UI model. Pinned by
 *     `MetadataService.specKeyObjectPayload.test.ts`.
 *   - SAVED-VIEW `sortOrder` — `ObjectView.tsx`'s per-view display order, a
 *     real persisted key on a different document entirely.
 *
 * This file names neither, so reverting either of those cannot red it.
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

const PLAIN_FIELD: DesignerFieldDefinition = {
  id: 'amount',
  name: 'amount',
  label: 'Amount',
  type: 'number',
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

  it('refuses `sortOrder` BY NAME on a document it otherwise accepts', () => {
    // The control that makes this a key-by-key result rather than a schema
    // refusing everything: the same base parses green without the key.
    expect(FieldSchema.safeParse({ type: 'text', label: 'L' }).success).toBe(true);
    expect(unrecognizedKeys(FieldSchema.safeParse({ type: 'text', label: 'L', sortOrder: 3 }))).toEqual([
      'sortOrder',
    ]);
  });

  it('has no field-level ordering key to rename onto — and `sortable` is not one', () => {
    const accept = new Set(Object.keys(FieldSchema.shape as Record<string, unknown>));
    // The near-spelling exists and is a BOOLEAN, so it is a different concept
    // rather than this key's spec name. Asserted, because "do not conflate
    // `sortable`" is prose until something can fail on it.
    expect(accept.has('sortable')).toBe(true);
    expect(FieldSchema.safeParse({ type: 'text', label: 'L', sortable: 3 }).success).toBe(false);
    expect(FieldSchema.safeParse({ type: 'text', label: 'L', sortable: true }).success).toBe(true);
    // And nothing else in the accept set is an ordering index either.
    for (const key of ['sortOrder', 'order', 'position', 'index', 'sequence', 'displayOrder']) {
      expect(accept.has(key), `FieldSchema unexpectedly accepts \`${key}\``).toBe(false);
    }
  });
});

describe('objectui#6045 · saveFields never PUTs a field-level `sortOrder`', () => {
  it('drops a `sortOrder` smuggled onto the field instead of copying it through', async () => {
    // THE load-bearing case — see this file's header. `DesignerFieldDefinition`
    // no longer DECLARES `sortOrder`, so this cast is the point rather than a
    // workaround: it proves `toFieldPayload` is closed at RUNTIME, not merely
    // that the type forbids the key. A stale build, a JS caller, or the
    // drag-to-reorder control this card exists to get ahead of all arrive by
    // exactly this route — as does `FieldDesigner`'s update handler, which
    // spreads the previous field verbatim.
    const { adapter, puts } = makeCapturingAdapter();
    const smuggled = { ...PLAIN_FIELD, sortOrder: 7 } as DesignerFieldDefinition;

    await new MetadataService(adapter).saveFields('invoice', [smuggled]);

    const [def] = savedFields(puts);
    expect('sortOrder' in def).toBe(false);
    // Falsification: the field itself made the trip, so the absence above is a
    // payload builder that stopped copying the key, not an empty PUT.
    expect(def.name).toBe('amount');
    expect(def.type).toBe('number');
  });

  it('and that smuggled body parses through the real FieldSchema', async () => {
    const { adapter, puts } = makeCapturingAdapter();
    const smuggled = { ...PLAIN_FIELD, sortOrder: 7 } as DesignerFieldDefinition;

    await new MetadataService(adapter).saveFields('invoice', [smuggled]);

    const result = FieldSchema.safeParse(savedFields(puts)[0]);
    expect(unrecognizedKeys(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('a field that never carried one PUTs identical bytes, as it always did', async () => {
    // ⚠ This case would still pass on a revert, deliberately — the key was
    // latent precisely because `JSON.stringify` drops the `undefined`. It is
    // here to prove the removal did not newly break the untouched path.
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('invoice', [PLAIN_FIELD]);

    const [def] = savedFields(puts);
    expect(Object.keys(def).sort()).toEqual(['label', 'name', 'type']);
    expect(unrecognizedKeys(FieldSchema.safeParse(def))).toEqual([]);
  });
});
