/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30239 — the adapter's half of the Undo on a delete toast
 * (ADR-0148 D2).
 *
 *  - `delete(…, { onRecycleBinEntry })` is told the server's
 *    `recycleBinEntryId`, after the delete's mutation event, and is not called
 *    when the answer carries none.
 *  - `restoreRecycleBinEntry(object, entryId)` is the SDK's
 *    `recycleBin.restore`: never a create, no mutation event, and a refusal
 *    keeps its `code` and `details` (a 409 restore refusal is not an
 *    optimistic-concurrency conflict).
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter, ConcurrentUpdateError } from './index';
import type { DataSourceMutationEvent } from '@object-ui/types';

function makeDS(stub: { data?: Record<string, unknown>; recycleBin?: Record<string, unknown> }) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => new Response('{}', { status: 200 })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = stub;
  return ds;
}

describe('ObjectStackAdapter.delete reports its recycle-bin entry (objectstack#30239)', () => {
  it('tells onRecycleBinEntry the entry id, after the mutation event', async () => {
    const order: string[] = [];
    const del = vi.fn().mockResolvedValue({ object: 'crm_lead', id: 'r1', success: true, recycleBinEntryId: 'rb_1' });
    const ds = makeDS({ data: { delete: del } });
    ds.onMutation((e: DataSourceMutationEvent) => order.push(`event:${e.type}`));

    const ok = await ds.delete('crm_lead', 'r1', { onRecycleBinEntry: (id: string) => order.push(`entry:${id}`) });

    expect(ok).toBe(true);
    expect(order).toEqual(['event:delete', 'entry:rb_1']);
    expect(del).toHaveBeenCalledWith('crm_lead', 'r1', undefined);
  });

  it('control: an answer with no entry id never calls onRecycleBinEntry', async () => {
    const onEntry = vi.fn();
    const ds = makeDS({ data: { delete: vi.fn().mockResolvedValue({ object: 'sys_user', id: 'u1', success: true }) } });

    expect(await ds.delete('sys_user', 'u1', { onRecycleBinEntry: onEntry })).toBe(true);
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('control: a delete the server did not confirm reports no entry', async () => {
    const onEntry = vi.fn();
    const ds = makeDS({
      data: { delete: vi.fn().mockResolvedValue({ object: 'crm_lead', id: 'r1', success: false, recycleBinEntryId: 'rb_1' }) },
    });

    expect(await ds.delete('crm_lead', 'r1', { onRecycleBinEntry: onEntry })).toBe(false);
    expect(onEntry).not.toHaveBeenCalled();
  });
});

describe('ObjectStackAdapter.restoreRecycleBinEntry (objectstack#30239)', () => {
  it('restores through recycleBin.restore, never a create, with no mutation event', async () => {
    const restore = vi.fn().mockResolvedValue({ entryId: 'rb_1', restored: 1 });
    const create = vi.fn();
    const ds = makeDS({ data: { create }, recycleBin: { restore } });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await expect(ds.restoreRecycleBinEntry('crm_lead', 'rb_1')).resolves.toEqual({ entryId: 'rb_1', restored: 1 });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('crm_lead', 'rb_1');
    expect(create).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a 409 refusal keeps its code and details, and is not a concurrency conflict', async () => {
    const refusal = Object.assign(new Error('unique value taken'), {
      code: 'RESTORE_UNIQUE_VALUE_TAKEN',
      httpStatus: 409,
      details: { object: 'crm_lead', recordId: 'r1', field: 'email' },
    });
    const ds = makeDS({ recycleBin: { restore: vi.fn().mockRejectedValue(refusal) } });

    const err = await ds.restoreRecycleBinEntry('crm_lead', 'rb_1').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ConcurrentUpdateError);
    expect(err).toMatchObject({
      code: 'RESTORE_UNIQUE_VALUE_TAKEN',
      details: { object: 'crm_lead', recordId: 'r1', field: 'email' },
    });
  });
});
