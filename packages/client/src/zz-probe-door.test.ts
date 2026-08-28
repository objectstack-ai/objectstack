// TEMPORARY PROBE — delete before commit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/runtime';
import type { IHttpServer } from '@objectstack/spec/contracts';

describe('probe: real /meta write door', () => {
  let baseUrl: string;
  let kernel: LiteKernel;

  beforeAll(async () => {
    kernel = new LiteKernel();
    kernel.use(new ObjectQLPlugin());
    kernel.use({
      metadata: { name: 'test-auth', version: '1.0.0' },
      async init(ctx: any) {
        ctx.registerService('auth', {
          api: { getSession: async () => ({ user: { id: 'test-user' } }) },
        });
      },
    } as any);
    kernel.use(new HonoServerPlugin({ port: 0 }));
    kernel.use(createRestApiPlugin({ api: { api: { requireAuth: false } as any } }));
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://localhost:${httpServer.getPort!()}`;
    // eslint-disable-next-line no-console
    console.log('PROBE baseUrl', baseUrl);
  }, 60_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('reports what a PUT and DELETE answer', async () => {
    const put = await fetch(`${baseUrl}/api/v1/meta/view/probe_view`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'probe_view', label: 'Probe', object: 'task' }),
    });
    const putBody = (await put.text()).slice(0, 400);
    const del = await fetch(`${baseUrl}/api/v1/meta/view/probe_view`, { method: 'DELETE' });
    const delBody = (await del.text()).slice(0, 400);
    expect({ put: put.status, putBody, del: del.status, delBody }).toEqual('SHOW-ME');
  }, 60_000);
});
