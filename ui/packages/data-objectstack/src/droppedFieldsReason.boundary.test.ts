/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The write-warning boundary must PARSE `reason` against the spec enum, not
 * assert it into the union on shape alone (objectui#4934).
 *
 * `notifyDroppedFields` used to filter the wire entries on shape only — an
 * `Array.isArray(fields)` predicate hand-written as `e is DroppedFieldsEvent` —
 * so a `reason` the bundle's `@objectstack/spec` pin has never heard of reached
 * every subscriber typed as if it were inside
 * `'readonly' | 'readonly_when' | 'primary_key'`. A server running AHEAD of a
 * deployed client's pin is the normal skew direction, so that type was a lie the
 * repo had no gate for.
 *
 * The population is empty today (nothing emits an off-union reason), so a green
 * suite proves nothing by itself. What these tests pin is the DISCRIMINATION:
 * an off-union reason lands on the named skew arm carrying the wire value
 * verbatim, and an in-union one still arrives on the canonical spec arm
 * untouched. The skew case was measured red against the pre-fix boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import { DroppedFieldsEventSchema } from '@objectstack/spec/data';
import { ObjectStackAdapter, UNRECOGNIZED_DROP_REASON } from './index';
import type {
  DroppedFieldsEvent,
  DroppedFieldsNotice,
  WriteWarningEvent,
} from './index';

function makeDS(stub: Record<string, any>) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: stub };
  return ds;
}

/** Drive one create whose response carries `droppedFields`, return the events. */
async function emitOnCreate(droppedFields: unknown[]): Promise<WriteWarningEvent[]> {
  const create = vi.fn().mockResolvedValue({ record: { id: 'r1' }, droppedFields });
  const ds = makeDS({ create });
  const events: WriteWarningEvent[] = [];
  ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));
  await ds.create('andon', { type: 'x', title: 'T' });
  return events;
}

describe('dropped-fields `reason` is parsed at the boundary (#4934)', () => {
  it('routes a reason ahead of the spec pin to the skew arm, verbatim', async () => {
    const events = await emitOnCreate([
      { object: 'andon', fields: ['type'], reason: 'some_future_reason' },
    ]);

    expect(events).toHaveLength(1);
    const [notice] = events[0].droppedFields;
    // The lie this card exists to delete: the value must NOT arrive typed and
    // spelled as though it were a member of the spec union.
    expect(notice.reason).not.toBe('some_future_reason');
    expect(notice).toEqual({
      object: 'andon',
      fields: ['type'],
      reason: UNRECOGNIZED_DROP_REASON,
      unrecognizedReason: 'some_future_reason',
    });
  });

  it('KEEPS the entry — an unparsable reason never silences the warning (#3484)', async () => {
    const events = await emitOnCreate([
      { object: 'andon', fields: ['type'], reason: 'some_future_reason' },
      { object: 'andon', fields: ['source_method'], reason: 'readonly' },
    ]);

    // Both entries survive, in wire order: dropping the skew one would recreate
    // exactly the silence objectui#3484 removed.
    expect(events[0].droppedFields).toHaveLength(2);
    expect(events[0].droppedFields[0].fields).toEqual(['type']);
    expect(events[0].droppedFields[1].fields).toEqual(['source_method']);
  });

  it('CONTROL — every reason the installed spec declares still arrives untouched', async () => {
    const declared = DroppedFieldsEventSchema.shape.reason.options;
    expect(declared).toContain('primary_key');

    for (const reason of declared) {
      const events = await emitOnCreate([{ object: 'andon', fields: ['type'], reason }]);
      expect(events).toHaveLength(1);
      // Canonical arm: byte-identical to the wire entry, no skew bookkeeping.
      expect(events[0].droppedFields[0]).toEqual({
        object: 'andon',
        fields: ['type'],
        reason,
      });
      expect(events[0].droppedFields[0]).not.toHaveProperty('unrecognizedReason');
    }
  });

  /**
   * The TYPE-level half of the fix, and the half the runtime assertions above
   * cannot see: the skew arm must not be assignable to the spec type. That is
   * what turns "a server ahead of our pin" from a per-consumer discipline into
   * a `tsc` error at every consumer that branches on `reason` — the gate the
   * card recorded as missing. Test files are inside this package's `type-check`
   * program (its tsconfig includes every file under `src`), so these two lines
   * are enforced, not decoration.
   */
  it('the skew arm is NOT assignable to the spec type (compile-time pin)', () => {
    const skew: DroppedFieldsNotice = {
      object: 'andon',
      fields: ['type'],
      reason: UNRECOGNIZED_DROP_REASON,
      unrecognizedReason: 'some_future_reason',
    };
    // @ts-expect-error — if this ever compiles, the boundary type is lying again.
    const asSpecEvent: DroppedFieldsEvent = skew;

    const canonical: DroppedFieldsNotice = { object: 'andon', fields: ['type'], reason: 'readonly' };
    // The canonical arm still IS the spec type (objectui#3160) — no widening.
    const stillTheSpecType: DroppedFieldsEvent = canonical as DroppedFieldsEvent;

    expect(asSpecEvent.fields).toEqual(['type']);
    expect(stillTheSpecType.reason).toBe('readonly');
  });

  it('the skew sentinel is not — and must never become — a spec arm', () => {
    const declared: readonly string[] = DroppedFieldsEventSchema.shape.reason.options;
    expect(declared).not.toContain(UNRECOGNIZED_DROP_REASON);
  });

  it('a non-string or missing reason is skew too, kept verbatim', async () => {
    const events = await emitOnCreate([
      { object: 'andon', fields: ['type'], reason: 42 },
      { object: 'andon', fields: ['source_method'] },
    ]);

    expect(events[0].droppedFields[0]).toEqual({
      object: 'andon',
      fields: ['type'],
      reason: UNRECOGNIZED_DROP_REASON,
      unrecognizedReason: 42,
    });
    expect(events[0].droppedFields[1]).toEqual({
      object: 'andon',
      fields: ['source_method'],
      reason: UNRECOGNIZED_DROP_REASON,
      unrecognizedReason: undefined,
    });
  });

  it('the cross-object batch path parses the same way (#3794)', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({
      results: [{ id: 'inv1' }],
      droppedFields: [
        { object: 'invoice', fields: ['tax_rate'], reason: 'some_future_reason', index: 0 },
      ],
    });
    const ds = makeDS({ batchTransaction });
    ds.atomicBatchCapability = true;
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.batchTransaction([
      { object: 'invoice', action: 'update', id: 'inv1', data: { tax_rate: 9 } },
    ]);

    expect(events).toEqual([
      {
        operation: 'update',
        resource: 'invoice',
        id: 'inv1',
        droppedFields: [
          {
            object: 'invoice',
            fields: ['tax_rate'],
            reason: UNRECOGNIZED_DROP_REASON,
            unrecognizedReason: 'some_future_reason',
          },
        ],
      },
    ]);
  });
});
