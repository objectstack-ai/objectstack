/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectStackAdapter must surface the framework's write-observability channel
 * (#3431/#3455): when a create/update response carries `droppedFields` — fields
 * the backend LEGALLY stripped (read-only / locked-by-state) — the adapter emits
 * a WriteWarningEvent so the app shell can toast the user instead of letting the
 * dropped value vanish silently. The write itself still succeeded.
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
  return ds;
}

const ONE_DROP = [{ object: 'approval_case', fields: ['approval_status'], reason: 'readonly' }];

describe('ObjectStackAdapter.onWriteWarning', () => {
  it('emits a create write-warning carrying the dropped fields and the new id', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'r1', title: 'A' }, droppedFields: ONE_DROP });
    const ds = makeDS({ create });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    const rec = await ds.create('approval_case', { title: 'A', approval_status: 'approved' });

    // The write still returns the plain record (unchanged behaviour).
    expect(rec).toEqual({ id: 'r1', title: 'A' });
    expect(events).toEqual([
      { operation: 'create', resource: 'approval_case', id: 'r1', droppedFields: ONE_DROP },
    ]);
  });

  it('emits an update write-warning carrying the target id', async () => {
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' }, droppedFields: ONE_DROP });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.update('approval_case', 'r1', { approval_status: 'approved' });

    expect(events).toEqual([
      { operation: 'update', resource: 'approval_case', id: 'r1', droppedFields: ONE_DROP },
    ]);
  });

  it('does NOT emit when the response carries no droppedFields (the common case)', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'r1', title: 'A' } });
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' } });
    const ds = makeDS({ create, update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.create('approval_case', { title: 'A' });
    await ds.update('approval_case', 'r1', { title: 'B' });

    expect(events).toEqual([]);
  });

  it('does NOT emit for an empty or malformed droppedFields payload', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ record: { id: 'r1' }, droppedFields: [] })
      .mockResolvedValueOnce({ record: { id: 'r2' }, droppedFields: 'nope' })
      .mockResolvedValueOnce({ record: { id: 'r3' }, droppedFields: [{ object: 'x', fields: [] }] });
    const ds = makeDS({ create });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.create('x', {});
    await ds.create('x', {});
    await ds.create('x', {}); // event present but its fields[] is empty → filtered out

    expect(events).toEqual([]);
  });

  // ── cross-object batch (framework #3794) ─────────────────────────────────
  //
  // `batchTransaction` is the console record form's save path for a
  // master-detail record, so this is where a `readonlyWhen` strip actually
  // reaches a user editing a form. Its response tags each event with the index
  // of the operation that produced it.

  it('emits a write-warning per event on a cross-object batch, resolving the op', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({
      results: [{ id: 'acc1' }, { id: 'inv1' }],
      droppedFields: [
        { object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when', index: 1 },
      ],
    });
    const ds = makeDS({ batchTransaction });
    ds.atomicBatchCapability = true;
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.batchTransaction([
      { object: 'account', action: 'create', data: { name: 'Acme' } },
      { object: 'invoice', action: 'update', id: 'inv1', data: { status: 'paid', tax_rate: 9 } },
    ]);

    expect(events).toEqual([
      {
        operation: 'update',
        resource: 'invoice',
        id: 'inv1',
        droppedFields: [{ object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when' }],
      },
    ]);
  });

  it('does NOT emit for a clean batch or a malformed droppedFields list', async () => {
    const batchTransaction = vi
      .fn()
      .mockResolvedValueOnce({ results: [{ id: 'a' }] })
      .mockResolvedValueOnce({ results: [{ id: 'a' }], droppedFields: [{ object: 'x', fields: [], index: 0 }] });
    const ds = makeDS({ batchTransaction });
    ds.atomicBatchCapability = true;
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.batchTransaction([{ object: 'x', action: 'create', data: {} }]);
    await ds.batchTransaction([{ object: 'x', action: 'create', data: {} }]);

    expect(events).toEqual([]);
  });

  it('stops delivering after unsubscribe', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'r1' }, droppedFields: ONE_DROP });
    const ds = makeDS({ create });
    const events: WriteWarningEvent[] = [];
    const unsub = ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.create('approval_case', {});
    unsub();
    await ds.create('approval_case', {});

    expect(events).toHaveLength(1);
  });

  // ── no-op strips are not news (objectui#3484) ─────────────────────────────
  //
  // The server is right to report a strip — the client DID send the key. But
  // "was not saved" is only worth a toast when something was LOST. The console
  // edit form used to round-trip the whole record, so every save of a
  // state-locked record warned about fields the user never touched whose values
  // never changed. When the echoed record proves the stripped value equals what
  // was sent, stay quiet.

  it('suppresses the warning when every stripped value equals what the record already holds', async () => {
    const update = vi.fn().mockResolvedValue({
      record: { id: 'r1', type: 'quality_abnormal', source_method: 'qc_judgment', title: 'B' },
      droppedFields: [
        { object: 'andon', fields: ['type', 'source_method'], reason: 'readonly_when' },
      ],
    });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.update('andon', 'r1', {
      title: 'B',
      type: 'quality_abnormal',
      source_method: 'qc_judgment',
    });

    expect(events).toEqual([]);
  });

  it('still warns about the fields that really did change, and only those', async () => {
    const update = vi.fn().mockResolvedValue({
      record: { id: 'r1', type: 'quality_abnormal', source_method: 'qc_judgment' },
      droppedFields: [
        { object: 'andon', fields: ['type', 'source_method'], reason: 'readonly_when' },
      ],
    });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    // The user really did try to change `type`; `source_method` round-tripped.
    await ds.update('andon', 'r1', { type: 'equipment_fault', source_method: 'qc_judgment' });

    expect(events).toEqual([
      {
        operation: 'update',
        resource: 'andon',
        id: 'r1',
        droppedFields: [{ object: 'andon', fields: ['type'], reason: 'readonly_when' }],
      },
    ]);
  });

  it('keeps the warning when the no-op cannot be PROVEN (record echo lacks the key)', async () => {
    const update = vi.fn().mockResolvedValue({
      record: { id: 'r1' },
      droppedFields: [{ object: 'andon', fields: ['type'], reason: 'readonly_when' }],
    });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.update('andon', 'r1', { type: 'quality_abnormal' });

    expect(events).toHaveLength(1);
  });

  it('does not treat a type change as a no-op (1 is not "1")', async () => {
    const update = vi.fn().mockResolvedValue({
      record: { id: 'r1', tax_rate: '9' },
      droppedFields: [{ object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when' }],
    });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.update('invoice', 'r1', { tax_rate: 9 });

    expect(events).toHaveLength(1);
  });

  it('suppresses a no-op strip on the cross-object batch path too', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({
      results: [{ id: 'acc1' }, { id: 'inv1', tax_rate: 9 }],
      droppedFields: [
        { object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when', index: 1 },
      ],
    });
    const ds = makeDS({ batchTransaction });
    ds.atomicBatchCapability = true;
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.batchTransaction([
      { object: 'account', action: 'create', data: { name: 'Acme' } },
      { object: 'invoice', action: 'update', id: 'inv1', data: { status: 'paid', tax_rate: 9 } },
    ]);

    expect(events).toEqual([]);
  });

  it('isolates a throwing listener so the write still resolves and other listeners fire', async () => {
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' }, droppedFields: ONE_DROP });
    const ds = makeDS({ update });
    const good = vi.fn();
    ds.onWriteWarning(() => { throw new Error('boom'); });
    ds.onWriteWarning(good);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(ds.update('approval_case', 'r1', { approval_status: 'x' })).resolves.toBeTruthy();
    expect(good).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ── a write answer's `warnings` (objectui#12107) ───────────────────────────
//
// The spec declares `warnings` (advisory validation-rule hits, element
// `ValidateDataIssueSchema`) on the single-record create/update answers. It
// rides THIS event: emitted when either list is non-empty, `droppedFields`
// stays required (empty when the event exists only for warnings), and an
// answer without the key changes nothing.

const ONE_WARNING = [
  {
    field: 'discount',
    code: 'validation_rule',
    message: 'Discounts above 30% need a manager note',
    rule: 'discount_cap',
    severity: 'warning' as const,
  },
];

describe('ObjectStackAdapter.onWriteWarning — write answer warnings (objectui#12107)', () => {
  it('emits a create write-warning carrying the answer warnings, with no dropped fields', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'r1', discount: 40 }, warnings: ONE_WARNING });
    const ds = makeDS({ create });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    const rec = await ds.create('quote', { discount: 40 });

    expect(rec).toEqual({ id: 'r1', discount: 40 });
    expect(events).toEqual([
      { operation: 'create', resource: 'quote', id: 'r1', droppedFields: [], warnings: ONE_WARNING },
    ]);
  });

  it('emits an update write-warning carrying the answer warnings', async () => {
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' }, warnings: ONE_WARNING });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.update('quote', 'r1', { discount: 40 });

    expect(events).toEqual([
      { operation: 'update', resource: 'quote', id: 'r1', droppedFields: [], warnings: ONE_WARNING },
    ]);
  });

  it('CONTROL: an answer without the key, or with an empty list, emits nothing', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ record: { id: 'r1' } })
      .mockResolvedValueOnce({ record: { id: 'r2' }, warnings: [] });
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' } });
    const ds = makeDS({ create, update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.create('quote', {});
    await ds.create('quote', {});
    await ds.update('quote', 'r1', {});

    expect(events).toEqual([]);
  });

  it('CONTROL: droppedFields is unchanged when both lists are present; warnings ride beside it', async () => {
    const update = vi
      .fn()
      .mockResolvedValue({ record: { id: 'r1' }, droppedFields: ONE_DROP, warnings: ONE_WARNING });
    const ds = makeDS({ update });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.update('approval_case', 'r1', { approval_status: 'approved' });

    expect(events).toEqual([
      {
        operation: 'update',
        resource: 'approval_case',
        id: 'r1',
        droppedFields: ONE_DROP,
        warnings: ONE_WARNING,
      },
    ]);
  });

  it('parses each entry through the spec schema: an entry it refuses is not carried', async () => {
    const create = vi.fn().mockResolvedValue({
      record: { id: 'r1' },
      warnings: [{ field: 'discount' }, 'nope', ONE_WARNING[0]],
    });
    const ds = makeDS({ create });
    const events: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => events.push(e));

    await ds.create('quote', {});

    expect(events).toEqual([
      { operation: 'create', resource: 'quote', id: 'r1', droppedFields: [], warnings: ONE_WARNING },
    ]);
  });
});
