// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D2] `ObjectQLPlugin` hands its engine the `security` service as a
 * SOURCE, read at use and never at init.
 *
 * At this plugin's init the service is not registered yet on any composition
 * that ships it (plugin-security registers it in its own `start()`), so a
 * lookup made at init would decide "no security service" for the whole boot.
 * Here the context throws on a name nothing registered, as the in-repo kernels
 * do: before the service registers, a `ReadableIds` leaf is answered
 * `$in: []` (fail closed); after it registers, the same read is composed.
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadableIds, isComposedReadableIds } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

describe('[ADR-0139 D2] ObjectQLPlugin wires the security service for ReadableIds composition, read at use', () => {
  it('a security service registered after init composes the next read', async () => {
    const seen: any[] = [];
    const driver: any = {
      name: 'recording', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async find(_object: string, ast: any) { seen.push(ast); return []; },
    };
    const ql = new ObjectQL();
    ql.registerDriver(driver, true);
    await ql.init();
    ql.registry.registerObject({ name: 'rid_child', fields: { record_id: { name: 'record_id', type: 'text' } } } as any, 'test');
    ql.registry.registerObject({ name: 'rid_parent', fields: { title: { name: 'title', type: 'text' } } } as any, 'test');

    const services = new Map<string, unknown>();
    const ctx: any = {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn((name: string, svc: unknown) => services.set(name, svc)),
      getService: vi.fn((name: string) => {
        if (!services.has(name)) throw new Error(`Service '${name}' not found`);
        return services.get(name);
      }),
    };
    await (new ObjectQLPlugin({ ql, registerProtocol: false }) as any).init(ctx);
    expect(ctx.getService.mock.calls.filter(([name]: [string]) => name === 'security'), 'not read at init').toEqual([]);

    const where = () => ({ record_id: { $in: ReadableIds.of('rid_parent') } });
    await ql.find('rid_child', { where: where() });
    expect(seen[0].where.record_id.$in, 'no security service yet: fail closed').toEqual([]);

    services.set('security', { canReadObject: async () => true, getReadFilter: async () => undefined, explain: async () => ({ allowed: true }) });
    await ql.find('rid_child', { where: where() });
    expect(isComposedReadableIds(seen[1].where.record_id.$in), 'registered after init, read at use').toBe(true);
  });
});
