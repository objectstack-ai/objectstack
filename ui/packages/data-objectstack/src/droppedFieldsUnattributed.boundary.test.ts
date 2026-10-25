/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What the batch write-warning says about a strip it CANNOT attribute to an
 * operation (objectui#7160).
 *
 * `notifyBatchDroppedFields` names the object a cross-object strip is about
 * from the wire entry's `object`, else from the operation its `index`
 * addresses. When the wire named none AND the index addresses no operation in
 * the request we sent, there is nothing left to name it with, and the adapter
 * writes its `UNATTRIBUTED_STRIP_OBJECT` placeholder onto both the notice's
 * `object` and the event's `resource`.
 *
 * Third sibling to `droppedFieldsReason.boundary.test.ts` (objectui#4934) and
 * `droppedFieldsShape.boundary.test.ts` (objectui#6889), and deliberately a
 * DIFFERENT disposition from both, because the fact is different:
 *
 *  - `reason` from the future is the producer running AHEAD of us — expected
 *    version skew, so it earns an explicit arm carrying the wire value verbatim.
 *  - a non-string `fields` element is off-spec input that would reach a
 *    consumer typed as a field name — refused here, fixed at the producer.
 *  - an unattributable strip supplies NO producer value at all. There is
 *    nothing to keep or drop; the only question is what we write in its place.
 *
 * So this suite pins the placeholder rather than removing it, and pins the two
 * properties that make it safe:
 *
 *  - the warning is still EMITTED. Refusing it would trade a truthful,
 *    user-visible warning about fields the server really did strip for silence
 *    — objectui#3484's failure. Measured end to end for the PR: the user still
 *    gets the save acknowledgement, the field list and the reason sentence,
 *    with fields named by api key instead of label.
 *  - the placeholder is FALSY. That is load-bearing, not incidental: the sole
 *    consumer (`app-shell`'s `writeWarningToast`) gates label resolution on
 *    `adapter && ev.resource`, so an empty resource skips the schema lookup and
 *    names fields by their api key. A truthful-but-truthy sentinel would send
 *    that consumer to `getObjectSchema('objectui:...')` instead. Nothing pinned
 *    this before, so a "cleanup" replacing `''` could have broken the consumer
 *    with every adapter test still green.
 *
 * REACHABILITY. Only from a response that is off-spec twice over: the spec's
 * `CrossObjectBatchDroppedFieldsSchema` declares BOTH `object: z.string()` and
 * `index: z.number()` required, and documents `results` as index-aligned with
 * the request's `operations`. Nothing in this repo emits that shape, and
 * whether a deployed backend does is not answerable from here. What is pinned
 * is the DISCRIMINATION, not a population — every zero below keeps a live
 * control beside it so a green run cannot be a silently-empty one.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import type { WriteWarningEvent } from './index';

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
  ds.atomicBatchCapability = true;
  return ds;
}

/**
 * One two-op batch — the shape the console's record form saves a master-detail
 * record with. Operation 0 creates an `account`, operation 1 updates an
 * `invoice`, so a resolvable `index` has a distinct object to name.
 */
async function emitOnBatch(droppedFields: unknown[]): Promise<WriteWarningEvent[]> {
  const batchTransaction = vi.fn().mockResolvedValue({
    results: [{ id: 'acc1' }, { id: 'inv1' }],
    droppedFields,
  });
  const ds = makeDS({ batchTransaction });
  const events: WriteWarningEvent[] = [];
  ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));
  await ds.batchTransaction([
    { object: 'account', action: 'create', data: { name: 'Acme' } },
    { object: 'invoice', action: 'update', id: 'inv1', data: { tax_rate: 7 } },
  ]);
  return events;
}

describe('an unattributable batch write-strip (#7160)', () => {
  it('is still emitted — it does not recreate #3484 silence', async () => {
    const events = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 99 },
    ]);

    expect(events).toHaveLength(1);
    // Everything the response DID establish survives: the user is told which
    // fields did not take effect, and why.
    expect(events[0].droppedFields).toHaveLength(1);
    expect(events[0].droppedFields[0].fields).toEqual(['tax_rate']);
    expect(events[0].droppedFields[0].reason).toBe('readonly_when');
  });

  it('names the object with the falsy placeholder on BOTH the notice and the event', async () => {
    const events = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 99 },
    ]);

    // One spelling for both, as objectui#6889 unified them.
    expect(events[0].resource).toBe('');
    expect(events[0].droppedFields[0].object).toBe('');
    // The property the only consumer actually depends on. `writeWarningToast`
    // gates label resolution on `adapter && ev.resource`, so a truthy
    // placeholder would send it to `getObjectSchema(<placeholder>)`.
    expect(events[0].resource).toBeFalsy();
    expect(events[0].droppedFields[0].object).toBeFalsy();
    // Still a string: `DroppedFieldsEvent.object` is `z.string()` in the spec
    // and `WriteWarningEvent.resource` is `string`. The placeholder satisfies
    // the declared type — which is exactly what makes it a placeholder needing
    // a declaration rather than a type change.
    expect(typeof events[0].resource).toBe('string');
    expect(typeof events[0].droppedFields[0].object).toBe('string');
  });

  it('CONTROL — an index that DOES resolve names the object, truthily', async () => {
    // Same driver, same entry but for the index: a live non-zero reading, so
    // the falsy assertions above are a measurement and not a broken harness.
    const events = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 1 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].resource).toBe('invoice');
    expect(events[0].droppedFields[0].object).toBe('invoice');
    expect(events[0].resource).toBeTruthy();
  });

  it('CONTROL — a wire `object` still wins even when the index resolves to nothing', async () => {
    // The placeholder is reached only when BOTH channels fail. A server that
    // honours the spec's required `object` never reaches it, whatever its index
    // says.
    const events = await emitOnBatch([
      { object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when', index: 99 },
    ]);

    expect(events[0].resource).toBe('invoice');
    expect(events[0].droppedFields[0].object).toBe('invoice');
  });

  it('reaches the placeholder for every unresolvable `index`, missing one included', async () => {
    // `operations[i]` is `undefined` for an absent, out-of-range, negative or
    // non-integer index alike; none of them is a spec-conformant value.
    const indices: Array<Record<string, unknown>> = [
      {},
      { index: 99 },
      { index: -1 },
      { index: 1.5 },
      { index: Number.NaN },
    ];
    for (const tag of indices) {
      const events = await emitOnBatch([
        { fields: ['tax_rate'], reason: 'readonly_when', ...tag },
      ]);
      expect(events, JSON.stringify(tag)).toHaveLength(1);
      expect(events[0].resource, JSON.stringify(tag)).toBe('');
    }
  });

  it('omits `id` rather than inventing one — the honest arm of the same trigger', async () => {
    const events = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 99 },
    ]);

    expect('id' in events[0]).toBe(false);

    // CONTROL on the same instrument: a resolvable index carries the op's id.
    const control = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 1 },
    ]);
    expect(control[0].id).toBe('inv1');
  });

  it('RECORDS (does not bless) the `operation: create` claim — objectui#7170', async () => {
    // `operation` is picked as `(op?.action ?? 'create') === 'create' ? ... `,
    // so a strip with no operation to read lands on `create` — a second
    // fabrication under the same trigger, filed separately because there is no
    // correct value to fall back to and `WriteWarningEvent.operation` is a
    // REQUIRED `'create' | 'update'` on a published type. Pinned so whichever
    // disposition triage picks arrives as a visible diff instead of silently.
    const events = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 99 },
    ]);
    expect(events[0].operation).toBe('create');

    // CONTROL: the same instrument reports `update` when the op resolves, so
    // the line above is reading the fabrication and not a constant.
    const control = await emitOnBatch([
      { fields: ['tax_rate'], reason: 'readonly_when', index: 1 },
    ]);
    expect(control[0].operation).toBe('update');
  });

  it('leaves the single-record path alone — its fallback is always a real name', async () => {
    // There is no unattributable case there: `asDroppedFieldsNotice`'s fallback
    // is the resource the caller passed to create/update, so the placeholder is
    // structurally unreachable on that path.
    const create = vi.fn().mockResolvedValue({
      record: { id: 'r1' },
      droppedFields: [{ fields: ['type'], reason: 'readonly' }],
    });
    const ds = makeDS({ create });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));
    await ds.create('andon', { title: 'T' });

    expect(events).toHaveLength(1);
    expect(events[0].resource).toBe('andon');
    expect(events[0].droppedFields[0].object).toBe('andon');
  });
});
