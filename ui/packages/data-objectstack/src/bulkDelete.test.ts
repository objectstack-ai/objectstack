/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

function makeDS(stub: { deleteMany?: any; delete?: any }) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => {
      const body = { success: true, data: { capabilities: {}, routes: {} } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: stub };
  return ds;
}

describe('ObjectStackDataSource.bulkDelete', () => {
  it('returns a zero result and skips network when ids is empty', async () => {
    const deleteMany = vi.fn();
    const ds = makeDS({ deleteMany });
    const res = await ds.bulkDelete('sys_notification', []);
    expect(res).toEqual({ succeeded: 0, errors: [] });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('issues a single deleteMany call with the id list', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ succeeded: 3, failed: 0 });
    const ds = makeDS({ deleteMany });
    const res = await ds.bulkDelete('task', ['a', 'b', 'c']);
    expect(res).toEqual({ succeeded: 3, errors: [] });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const [resource, ids, opts] = deleteMany.mock.calls[0];
    expect(resource).toBe('task');
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(opts).toEqual({ continueOnError: true });
  });

  it('reads every id as deleted when deleteMany returns void (older clients)', async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const ds = makeDS({ deleteMany });
    const res = await ds.bulkDelete('task', ['a', 'b']);
    expect(res).toEqual({ succeeded: 2, errors: [] });
  });

  it('falls back to per-id delete loop when deleteMany is missing', async () => {
    const del = vi.fn(async (_: string, id: string) => {
      if (id === 'b') throw new Error('FK violation');
    });
    const ds = makeDS({ delete: del });
    const res = await ds.bulkDelete('task', ['a', 'b', 'c']);
    // continueOnError-emulated: b throws, a + c succeed, b keeps its reason.
    expect(res).toEqual({ succeeded: 2, errors: [{ id: 'b', error: 'FK violation' }] });
    expect(del).toHaveBeenCalledTimes(3);
  });

  it('coerces non-string ids before sending', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ succeeded: 2 });
    const ds = makeDS({ deleteMany });
    await ds.bulkDelete('task', [1, 2]);
    const [, ids] = deleteMany.mock.calls[0];
    expect(ids).toEqual(['1', '2']);
  });
});
