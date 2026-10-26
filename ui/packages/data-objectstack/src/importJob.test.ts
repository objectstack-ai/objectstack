/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/**
 * Adapter over a mock client `data` namespace. The async import-job methods are
 * thin pass-throughs to the client SDK, so we assert delegation + argument
 * shaping, plus graceful degradation when the client lacks the job API.
 */
function makeDS(stub: Record<string, any>) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: stub };
  return ds;
}

describe('ObjectStackAdapter async import jobs', () => {
  it('createImportJob delegates to client.data.createImportJob', async () => {
    const createImportJob = vi.fn().mockResolvedValue({ jobId: 'imp_1', object: 'task', status: 'pending', total: 2 });
    const ds = makeDS({ createImportJob });
    const req = { format: 'json' as const, rows: [{ a: 1 }, { a: 2 }], writeMode: 'upsert' as const, matchFields: ['a'] };
    const res = await ds.createImportJob('task', req);
    expect(createImportJob).toHaveBeenCalledTimes(1);
    expect(createImportJob.mock.calls[0]).toEqual(['task', req]);
    expect(res).toMatchObject({ jobId: 'imp_1', status: 'pending', total: 2 });
  });

  it('getImportJobProgress / getImportJobResults / cancelImportJob delegate by jobId', async () => {
    const getImportJobProgress = vi.fn().mockResolvedValue({ jobId: 'imp_1', status: 'running', percentComplete: 50 });
    const getImportJobResults = vi.fn().mockResolvedValue({ jobId: 'imp_1', status: 'succeeded', results: [], resultsTruncated: false });
    const cancelImportJob = vi.fn().mockResolvedValue({ success: true });
    const ds = makeDS({ createImportJob: vi.fn(), getImportJobProgress, getImportJobResults, cancelImportJob });

    expect((await ds.getImportJobProgress('imp_1')).percentComplete).toBe(50);
    expect(getImportJobProgress).toHaveBeenCalledWith('imp_1');

    expect((await ds.getImportJobResults('imp_1')).resultsTruncated).toBe(false);
    expect(getImportJobResults).toHaveBeenCalledWith('imp_1');

    await ds.cancelImportJob('imp_1');
    expect(cancelImportJob).toHaveBeenCalledWith('imp_1');
  });

  it('listImportJobs forwards filters and returns the jobs array', async () => {
    const listImportJobs = vi.fn().mockResolvedValue([{ jobId: 'imp_1', object: 'task', status: 'succeeded' }]);
    const ds = makeDS({ createImportJob: vi.fn(), listImportJobs });
    const jobs = await ds.listImportJobs({ object: 'task', status: 'succeeded', limit: 10 });
    expect(listImportJobs).toHaveBeenCalledWith({ object: 'task', status: 'succeeded', limit: 10 });
    expect(jobs).toHaveLength(1);
  });

  it('throws UNSUPPORTED_OPERATION when the client lacks the job API', async () => {
    const ds = makeDS({ import: vi.fn() }); // sync import only, no createImportJob
    await expect(ds.createImportJob('task', { format: 'json', rows: [] })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    await expect(ds.getImportJobProgress('imp_1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
  });
});
