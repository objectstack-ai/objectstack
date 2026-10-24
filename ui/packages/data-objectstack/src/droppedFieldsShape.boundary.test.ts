/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The write-warning boundary must PARSE a wire entry's `fields` elements and its
 * `object`, not assert them into the spec type on array-shape alone
 * (objectui#6889).
 *
 * Sibling to `droppedFieldsReason.boundary.test.ts`, which pinned the same
 * discipline for `reason` (objectui#4934). That fix left two smaller
 * over-claims behind, and they are independent of each other:
 *
 *  - **`fields` elements.** The gate read `Array.isArray(fields) && length > 0`
 *    and asserted the entry into a type whose `fields` is `string[]`, so
 *    `fields: [42]` reached every subscriber typed as a field name.
 *  - **`object`.** `Omit<DroppedFieldsEvent, 'reason'>` carries the spec's
 *    REQUIRED `object: string`, and nothing in the gate read `object` at all —
 *    so an entry that omitted it arrived claiming a string that was not there.
 *    Required is what MAKES this a gap; an optional `object` would have had
 *    nothing to over-claim.
 *
 * What these tests pin is the DISCRIMINATION, not a population: nothing in
 * these two repos is known to emit either shape, and whether a real server does
 * is unanswerable from here. Each was measured red against the pre-fix boundary
 * (see the PR's ablation), and each keeps a live positive control beside it so a
 * green run cannot be a silently-empty one.
 *
 * The repair is deliberately asymmetric with `reason`'s. A reason from the
 * future is the EXPECTED direction of version skew, so it earns an explicit
 * skew arm carrying the wire value verbatim. `fields` is `z.array(z.string())`
 * in the spec and cannot grow a non-string element without a breaking change,
 * so a non-string element is off-spec input: refused here, fixed at the
 * producer (AGENTS.md #0.1). `object` is neither — the adapter already KNOWS
 * which object it wrote to, so a missing one is healed rather than dropped.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter, UNRECOGNIZED_DROP_REASON } from './index';
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
  return ds;
}

/** Drive one create on `andon` whose response carries `droppedFields`. */
async function emitOnCreate(droppedFields: unknown[]): Promise<WriteWarningEvent[]> {
  const create = vi.fn().mockResolvedValue({ record: { id: 'r1' }, droppedFields });
  const ds = makeDS({ create });
  const events: WriteWarningEvent[] = [];
  ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));
  await ds.create('andon', { title: 'T' });
  return events;
}

/** Drive one two-op batch whose response carries a top-level `droppedFields`. */
async function emitOnBatch(droppedFields: unknown[]): Promise<WriteWarningEvent[]> {
  const batchTransaction = vi.fn().mockResolvedValue({
    results: [{ id: 'acc1' }, { id: 'inv1' }],
    droppedFields,
  });
  const ds = makeDS({ batchTransaction });
  ds.atomicBatchCapability = true;
  const events: WriteWarningEvent[] = [];
  ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));
  await ds.batchTransaction([
    { object: 'account', action: 'create', data: { name: 'Acme' } },
    { object: 'invoice', action: 'update', id: 'inv1', data: { status: 'paid' } },
  ]);
  return events;
}

describe('dropped-fields `fields` elements are parsed at the boundary (#6889)', () => {
  it('refuses the non-string elements and KEEPS the string ones', async () => {
    const events = await emitOnCreate([
      { object: 'andon', fields: ['type', 42, { name: 'salary' }, null, true], reason: 'readonly' },
    ]);

    expect(events).toHaveLength(1);
    const [notice] = events[0].droppedFields;
    // The lie this card exists to delete: a subscriber's `string[]` must not be
    // handed anything that is not a string.
    expect(notice.fields).toEqual(['type']);
    for (const f of notice.fields) expect(typeof f).toBe('string');
    // The entry itself survives — refusing an element must not silence the
    // warning about the field that WAS named (objectui#3484).
    expect(notice.reason).toBe('readonly');
  });

  it('drops an entry that names no field at all, and keeps one that does', async () => {
    // Nothing in `[42, {}]` is a field name, so there is nothing truthful to
    // tell the user — same disposition the boundary already gave `fields: []`.
    expect(await emitOnCreate([{ object: 'andon', fields: [42, {}], reason: 'readonly' }])).toEqual(
      [],
    );

    // CONTROL on the same instrument: one string element is enough to emit, so
    // the zero above is a reading and not a broken harness.
    const control = await emitOnCreate([
      { object: 'andon', fields: ['type'], reason: 'readonly' },
    ]);
    expect(control).toHaveLength(1);
    expect(control[0].droppedFields[0].fields).toEqual(['type']);
  });

  it('never silences a sibling entry that is well-formed', async () => {
    const events = await emitOnCreate([
      { object: 'andon', fields: [42], reason: 'readonly' },
      { object: 'andon', fields: ['source_method'], reason: 'readonly_when' },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].droppedFields).toHaveLength(1);
    expect(events[0].droppedFields[0]).toEqual({
      object: 'andon',
      fields: ['source_method'],
      reason: 'readonly_when',
    });
  });

  it('applies the same parse on the batch path', async () => {
    const events = await emitOnBatch([
      { object: 'invoice', fields: ['tax_rate', 42], reason: 'readonly_when', index: 1 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].droppedFields[0].fields).toEqual(['tax_rate']);

    // CONTROL: an all-non-string batch entry emits nothing, on the same driver.
    expect(
      await emitOnBatch([{ object: 'invoice', fields: [42], reason: 'readonly_when', index: 1 }]),
    ).toEqual([]);
  });

  it('composes with the `reason` skew arm rather than replacing it (#4934)', async () => {
    const events = await emitOnCreate([
      { object: 'andon', fields: ['type', 42], reason: 'some_future_reason' },
    ]);

    expect(events[0].droppedFields[0]).toEqual({
      object: 'andon',
      fields: ['type'],
      reason: UNRECOGNIZED_DROP_REASON,
      unrecognizedReason: 'some_future_reason',
    });
  });
});

describe('dropped-fields `object` is parsed at the boundary (#6889)', () => {
  it('heals a missing `object` from the resource the write targeted', async () => {
    const events = await emitOnCreate([{ fields: ['type'], reason: 'readonly' }]);

    expect(events).toHaveLength(1);
    const [notice] = events[0].droppedFields;
    // Declared `object: string` on the spec arm — so it must BE a string, and
    // the only truthful one available is the object this create wrote to.
    expect(typeof notice.object).toBe('string');
    expect(notice.object).toBe('andon');
  });

  it('heals a non-string `object` the same way', async () => {
    const events = await emitOnCreate([{ object: 42, fields: ['type'], reason: 'readonly' }]);

    expect(events[0].droppedFields[0].object).toBe('andon');
  });

  it('CONTROL — a string `object` on the wire is passed through, not overwritten', async () => {
    // The write targets `andon`; the wire says the strip is about `andon_line`.
    // Healing must never overrule what the server actually said.
    const events = await emitOnCreate([
      { object: 'andon_line', fields: ['type'], reason: 'readonly' },
    ]);

    expect(events[0].droppedFields[0].object).toBe('andon_line');
  });

  it('heals a missing `object` from the originating op on the batch path', async () => {
    const events = await emitOnBatch([{ fields: ['tax_rate'], reason: 'readonly_when', index: 1 }]);

    expect(events).toHaveLength(1);
    // The notice and the event describing it must name the SAME object — they
    // used to be computed by two separate expressions.
    expect(events[0].droppedFields[0].object).toBe('invoice');
    expect(events[0].resource).toBe('invoice');
  });
});
