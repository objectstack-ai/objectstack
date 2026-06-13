// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createQueryDataHandler, type QueryDataToolContext, type QueryPlan } from './query-data.tool.js';

/**
 * P4 AI safety net (ADR-0015 §5.4): a federated (external) object hits a
 * remote production DB, so the `query_data` tool must bound the wait. These
 * tests exercise the timeout wrapper around `dataEngine.find` for external
 * objects, and confirm managed objects are never wrapped.
 */

/** Build a tool context with a single retrievable object + controllable find. */
function makeCtx(opts: {
  object: Record<string, unknown>;
  datasource?: Record<string, unknown>;
  find: () => Promise<unknown[]>;
  externalQueryTimeoutMs?: number;
}): { ctx: QueryDataToolContext; getCalls: string[] } {
  const getCalls: string[] = [];
  const ctx: QueryDataToolContext = {
    ai: {
      generateObject: async () => {
        const plan: QueryPlan = {
          objectName: opts.object.name as string,
          whereJson: null,
          fields: null,
          orderBy: null,
          limit: null,
        };
        return { object: plan } as never;
      },
    } as never,
    metadata: {
      listObjects: async () => [opts.object],
      get: async (type: string, name: string) => {
        getCalls.push(`${type}/${name}`);
        return type === 'datasource' ? opts.datasource : undefined;
      },
    } as never,
    dataEngine: {
      find: async () => opts.find(),
    } as never,
    ...(opts.externalQueryTimeoutMs !== undefined
      ? { externalQueryTimeoutMs: opts.externalQueryTimeoutMs }
      : {}),
  };
  return { ctx, getCalls };
}

const externalObject = {
  name: 'orders',
  label: 'Orders',
  datasource: 'warehouse',
  external: { writable: false, remoteName: 'fact_orders' },
  fields: { id: { type: 'text' }, amount: { type: 'number' } },
};

describe('query_data — federated query timeout (P4)', () => {
  it("times out a federated query using the datasource's queryTimeoutMs", async () => {
    const { ctx, getCalls } = makeCtx({
      object: externalObject,
      datasource: { name: 'warehouse', external: { queryTimeoutMs: 10 } },
      find: () => new Promise<unknown[]>(() => {}), // never resolves
    });
    const handler = createQueryDataHandler(ctx);
    const out = JSON.parse((await handler({ request: 'show me orders' })) as string);
    expect(out.error).toMatch(/exceeded the 10ms timeout/);
    // The external branch resolved the datasource's declared timeout.
    expect(getCalls).toContain('datasource/warehouse');
  });

  it('falls back to externalQueryTimeoutMs when the datasource declares none', async () => {
    const { ctx } = makeCtx({
      object: externalObject,
      datasource: { name: 'warehouse' }, // no external.queryTimeoutMs
      find: () => new Promise<unknown[]>(() => {}),
      externalQueryTimeoutMs: 15,
    });
    const handler = createQueryDataHandler(ctx);
    const out = JSON.parse((await handler({ request: 'show me orders' })) as string);
    expect(out.error).toMatch(/exceeded the 15ms timeout/);
  });

  it('returns records when the federated query resolves before the timeout', async () => {
    const { ctx } = makeCtx({
      object: externalObject,
      datasource: { name: 'warehouse', external: { queryTimeoutMs: 1000 } },
      find: async () => [{ id: 'o1', amount: 42 }],
    });
    const handler = createQueryDataHandler(ctx);
    const out = JSON.parse((await handler({ request: 'show me orders' })) as string);
    expect(out.error).toBeUndefined();
    expect(out.count).toBe(1);
    expect(out.records[0].id).toBe('o1');
  });

  it('falls back to the current object when keyword retrieval finds nothing', async () => {
    const currentObject = {
      name: 'showcase_task',
      label: 'Task',
      fields: { id: { type: 'text' }, subject: { type: 'text' } },
    };
    let findObject: string | undefined;
    const ctx: QueryDataToolContext = {
      ai: {
        generateObject: async () => ({
          object: {
            objectName: 'showcase_task',
            whereJson: null,
            fields: null,
            orderBy: null,
            limit: null,
          } satisfies QueryPlan,
        }),
      } as never,
      metadata: {
        // Catalogue is non-empty, but a Chinese request tokenises to terms
        // that don't match the English name/label → zero keyword hits.
        listObjects: async () => [currentObject],
        getObject: async (name: string) => (name === 'showcase_task' ? currentObject : undefined),
      } as never,
      dataEngine: {
        find: async (objectName: string) => {
          findObject = objectName;
          return [{ id: 't1', subject: 'Build the thing' }];
        },
      } as never,
    };
    const handler = createQueryDataHandler(ctx);
    const out = JSON.parse(
      (await handler({ request: '分析这个对象的数据' }, { currentObjectName: 'showcase_task' } as never)) as string,
    );
    expect(out.error).toBeUndefined();
    expect(findObject).toBe('showcase_task');
    expect(out.count).toBe(1);
  });

  it('still errors when retrieval is empty and no current object is supplied', async () => {
    const ctx: QueryDataToolContext = {
      ai: { generateObject: async () => ({ object: {} as QueryPlan }) } as never,
      metadata: {
        listObjects: async () => [{ name: 'account', label: 'Account', fields: {} }],
        getObject: async () => undefined,
      } as never,
      dataEngine: { find: async () => [] } as never,
    };
    const handler = createQueryDataHandler(ctx);
    const out = JSON.parse((await handler({ request: '分析这个对象' })) as string);
    expect(out.error).toMatch(/No matching objects in metadata/);
  });

  it('does not wrap managed (non-external) objects in a timeout', async () => {
    const managedObject = {
      name: 'task',
      label: 'Task',
      fields: { id: { type: 'text' }, title: { type: 'text' } },
    };
    const { ctx, getCalls } = makeCtx({
      object: managedObject,
      // A managed find that takes longer than any external fallback would —
      // it must still succeed because the managed path is never timed out.
      find: () => new Promise<unknown[]>((resolve) => setTimeout(() => resolve([{ id: 't1' }]), 40)),
      externalQueryTimeoutMs: 5,
    });
    const handler = createQueryDataHandler(ctx);
    const out = JSON.parse((await handler({ request: 'show me task' })) as string);
    expect(out.error).toBeUndefined();
    expect(out.count).toBe(1);
    // Never consulted the datasource timeout — the external branch wasn't taken.
    expect(getCalls.some((c) => c.startsWith('datasource/'))).toBe(false);
  });
});
