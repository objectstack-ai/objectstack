/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11692 — `MetadataService`'s three object writes, and a field that
 * names a shared picklist.
 *
 * The runtime serves a picklist-bound field with `picklist` AND the options it
 * resolved from the list; the authoring door refuses the two together for the
 * whole object (`422 INVALID_METADATA` at `fields.FIELD.options`). The card's
 * "Done when" asks each writer for one of two answers, and this file pins which
 * one each method gives:
 *
 *   - `saveFields` SEEDS from a served read (its GET, and the per-field
 *     carry-over that brings the binding back out), so it drops the served
 *     `options` on every bound field before its PUT.
 *   - `saveObject` and `saveMetadataItem` read NOTHING: every key they send is
 *     the caller's, so they cannot tell a served copy from an authored pair and
 *     must not strip — the authored pair stays the server's loud refusal, which
 *     is the authoring check objectui#10202 relies on. Pinned as "no read" plus
 *     "the pair still reaches the door and is refused".
 *
 * A real `ObjectStackAdapter` and SDK over a fetch double that serves the
 * object and refuses a PUT body the way the authoring door does, so every
 * claim is read off the WIRE.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition, ObjectDefinition } from '@object-ui/types';
import { MetadataService, type FieldMetadataPayload } from './MetadataService';

type Row = Record<string, unknown>;

const TIER_OPTIONS = [
  { label: 'Gold', value: 'gold' },
  { label: 'Platinum', value: 'platinum' },
];
const STATUS_OPTIONS = [
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
];

/** The object as the runtime SERVES it. */
const SERVED: Row = {
  name: 'acme_account',
  label: 'Account',
  fields: {
    tier: { type: 'select', label: 'Tier', picklist: 'acme_tier', options: TIER_OPTIONS },
    status: { type: 'select', label: 'Status', options: STATUS_OPTIONS },
  },
};

/** The authoring door's refusal for a field carrying both keys. */
function doorRefusal(body: Row): string[] {
  return Object.entries((body.fields ?? {}) as Record<string, Row>)
    .filter(([, def]) => def && def.picklist !== undefined && def.options !== undefined)
    .map(([name]) => `fields.${name}.options`);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A real adapter whose transport serves {@link SERVED} and refuses the pair. */
function makeAdapter() {
  const puts: Array<{ body: Row; status: number }> = [];
  let gets = 0;
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Row;
        const refused = doorRefusal(body);
        const status = refused.length > 0 ? 422 : 200;
        puts.push({ body, status });
        return status === 422
          ? json(
              {
                error: 'failed spec validation',
                code: 'INVALID_METADATA',
                issues: refused.map((path) => ({
                  path,
                  code: 'custom',
                  message: '`picklist` and `options` cannot both be declared. Keep `picklist` and delete `options`.',
                })),
              },
              422,
            )
          : json({ success: true });
      }
      gets += 1;
      return json({ item: SERVED });
    }) as unknown as typeof fetch,
  });
  return { adapter, puts, getCount: () => gets };
}

describe('MetadataService — a picklist-bound field and the three object writes (objectui#11692)', () => {
  it('saveFields seeds from a served read, so a field list built from that read and left untouched goes out accepted, the bound field without `options`', async () => {
    const { adapter, puts, getCount } = makeAdapter();
    // What a field designer holds after loading the served object: both fields,
    // the bound one with the resolved options the read handed it.
    const designerFields: DesignerFieldDefinition[] = [
      { id: 'tier', name: 'tier', label: 'Tier', type: 'select', options: TIER_OPTIONS },
      { id: 'status', name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    ];

    await new MetadataService(adapter).saveFields('acme_account', designerFields);

    expect(getCount(), 'the served read this writer seeds from').toBeGreaterThan(0);
    expect(puts).toHaveLength(1);
    const [put] = puts;
    expect(put!.status, `refused at ${doorRefusal(put!.body).join(', ')}`).toBe(200);
    const fields = put!.body.fields as Record<string, Row>;
    // The binding the carry-over brought back stays; its served options do not.
    expect(fields.tier).toMatchObject({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(fields.tier).not.toHaveProperty('options');
    // A field that names no picklist keeps its options exactly.
    expect(fields.status!.options).toEqual(STATUS_OPTIONS);
  });

  it('saveObject reads nothing, so it strips nothing: an authored pair reaches the door and comes back refused', async () => {
    const { adapter, puts, getCount } = makeAdapter();
    const obj: ObjectDefinition = { id: 'acme_account', name: 'acme_account', label: 'Account', isSystem: false, fieldCount: 1 };
    // The binding is not a declared `FieldMetadataPayload` member, which is the
    // point: only a caller holding a wider value can hand one in.
    const authored = { name: 'tier', type: 'select', label: 'Tier', picklist: 'acme_tier', options: TIER_OPTIONS };

    await expect(
      new MetadataService(adapter).saveObject(obj, [authored as FieldMetadataPayload]),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA', httpStatus: 422 });

    expect(getCount(), 'saveObject issues no read').toBe(0);
    expect(puts).toHaveLength(1);
    expect((puts[0]!.body.fields as Record<string, Row>).tier).toMatchObject({ picklist: 'acme_tier', options: TIER_OPTIONS });
  });

  it('saveMetadataItem reads nothing, so it strips nothing: the pair it is handed reaches the door and comes back refused', async () => {
    const { adapter, puts, getCount } = makeAdapter();

    await expect(
      new MetadataService(adapter).saveMetadataItem('object', 'acme_account', SERVED),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA', httpStatus: 422 });

    expect(getCount(), 'saveMetadataItem issues no read').toBe(0);
    expect(puts).toHaveLength(1);
    expect((puts[0]!.body.fields as Record<string, Row>).tier).toMatchObject({ picklist: 'acme_tier', options: TIER_OPTIONS });
  });
});
