// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_activity` read gate's branches that a real engine cannot easily be
 * made to take — a failing pre-scan, a failing parent read, the scan bound —
 * plus the shape of what it emits. What the emitted filter SELECTS is pinned
 * against a real driver in `activity-read-visibility.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { installActivityReadVisibility, parseActivityParent } from './activity-read-visibility.js';
import { LEDGER_AUDIT_CAPABILITY } from './audit-log-read-visibility.js';
import type { CommentAccessEngine, CommentReadMiddlewareCtx } from './comment-access-hooks.js';

const DENY = { id: '__activity_parent_denied__' };
const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
type Mw = (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;

function install(opts: {
  scan: (options: any) => Array<Record<string, unknown>>;
  /** parentObject -> readable ids (for any caller), or a thrower. */
  readable?: Record<string, string[] | (() => never)>;
  logger?: ReturnType<typeof silentLogger>;
}) {
  let mw!: Mw;
  const calls = { scans: [] as any[], probes: [] as Array<{ object: string; ids: string[]; context: any }> };
  const engine: CommentAccessEngine = {
    registerHook: () => {},
    registerMiddleware: (fn) => {
      mw = fn as Mw;
    },
    find: async (object: string, options: any) => {
      if (object === 'sys_activity') {
        calls.scans.push(options);
        return opts.scan(options) as any;
      }
      const ids: string[] = (options?.where?.id?.$in ?? []).map(String);
      calls.probes.push({ object, ids, context: options?.context });
      const r = opts.readable?.[object];
      if (typeof r === 'function') r();
      const list = Array.isArray(r) ? r : [];
      return ids.filter((id) => list.includes(id)).map((id) => ({ id })) as any;
    },
    findOne: async () => null,
  };
  installActivityReadVisibility(engine, opts.logger ?? silentLogger());
  return { mw, calls };
}

async function read(mw: Mw, partial: Partial<CommentReadMiddlewareCtx> = {}) {
  const ctx: CommentReadMiddlewareCtx = {
    object: 'sys_activity',
    operation: 'find',
    ast: { object: 'sys_activity', where: undefined },
    context: { userId: 'u1' },
    ...partial,
  };
  let ran = false;
  await mw(ctx, async () => {
    ran = true;
  });
  return { where: ctx.ast?.where, ran };
}

describe('parseActivityParent', () => {
  it('reads the pair, and names no parent for a row the gate cannot authorize', () => {
    expect(parseActivityParent({ object_name: 'crm_case', record_id: 'c1' })).toEqual({ object: 'crm_case', recordId: 'c1' });
    expect(parseActivityParent({ object_name: 'crm_case', record_id: 7 })).toEqual({ object: 'crm_case', recordId: '7' });
    for (const row of [
      { object_name: null, record_id: 'c1' },
      { object_name: 'crm_case', record_id: null },
      { object_name: 'crm_case', record_id: '' },
      { object_name: 'Not A Name', record_id: 'c1' },
      { object_name: 'sys_activity', record_id: 'a1' },
      null,
    ]) {
      expect(parseActivityParent(row as any)).toBeNull();
    }
  });
});

describe('installActivityReadVisibility', () => {
  it('emits one branch per parent object, carrying the record ids as stored', async () => {
    const { mw } = install({
      scan: () => [
        { object_name: 'crm_case', record_id: 'c1' },
        { object_name: 'crm_case', record_id: 'c2' },
        { object_name: 'crm_deal', record_id: 'd1' },
      ],
      readable: { crm_case: ['c1'], crm_deal: ['d1'] },
    });
    const { where, ran } = await read(mw);
    expect(ran).toBe(true);
    expect(where).toEqual({
      $or: [
        { object_name: 'crm_case', record_id: { $in: ['c1'] } },
        { object_name: 'crm_deal', record_id: { $in: ['d1'] } },
      ],
    });
  });

  it('ANDs onto the caller’s where instead of replacing it', async () => {
    const { mw } = install({ scan: () => [{ object_name: 'crm_case', record_id: 'c1' }], readable: { crm_case: ['c1'] } });
    const existing = { type: 'updated' };
    const { where } = await read(mw, { ast: { object: 'sys_activity', where: existing } });
    expect(where).toEqual({ $and: [existing, { object_name: 'crm_case', record_id: { $in: ['c1'] } }] });
  });

  it('denies all when no scanned parent is readable', async () => {
    const { mw } = install({ scan: () => [{ object_name: 'crm_case', record_id: 'c1' }], readable: { crm_case: [] } });
    expect((await read(mw)).where).toEqual(DENY);
  });

  it('denies all when every scanned row names no parent, without probing anything', async () => {
    const { mw, calls } = install({
      scan: () => [
        { object_name: null, record_id: null },
        { object_name: 'sys_activity', record_id: 'a1' },
      ],
    });
    expect((await read(mw)).where).toEqual(DENY);
    expect(calls.probes).toEqual([]);
  });

  it('leaves a read that matches nothing alone', async () => {
    const { mw } = install({ scan: () => [] });
    expect((await read(mw)).where).toBeUndefined();
  });

  it('a parent object whose read throws contributes nothing (fail closed)', async () => {
    const { mw } = install({
      scan: () => [
        { object_name: 'crm_case', record_id: 'c1' },
        { object_name: 'gone_object', record_id: 'g1' },
      ],
      readable: {
        crm_case: ['c1'],
        gone_object: () => {
          throw new Error('unknown object');
        },
      },
    });
    expect((await read(mw)).where).toEqual({ object_name: 'crm_case', record_id: { $in: ['c1'] } });
  });

  it('denies all, and says so, when the pre-scan itself fails', async () => {
    const logger = silentLogger();
    const { mw } = install({
      scan: () => {
        throw new Error('pre-scan exploded');
      },
      logger,
    });
    const { where, ran } = await read(mw);
    expect(where).toEqual(DENY);
    expect(ran).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('denying all'));
  });

  it('scans under SYSTEM context with the caller’s where and order, bounded', async () => {
    const { mw, calls } = install({ scan: () => [] });
    const where = { type: 'created' };
    const orderBy = [{ field: 'timestamp', order: 'desc' }];
    await read(mw, { ast: { object: 'sys_activity', where, orderBy } });
    expect(calls.scans).toEqual([
      { where, fields: ['object_name', 'record_id'], orderBy, limit: 2000, context: { isSystem: true } },
    ]);
  });

  it('warns when the scan hits its bound', async () => {
    const logger = silentLogger();
    const rows = Array.from({ length: 2000 }, (_, i) => ({ object_name: 'crm_case', record_id: `c${i}` }));
    const { mw } = install({ scan: () => rows, readable: { crm_case: ['c1'] }, logger });
    await read(mw);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('2000-row cap'));
  });

  it('narrows count and aggregate, and leaves writes, system and context-less reads alone', async () => {
    const scan = () => [{ object_name: 'crm_case', record_id: 'c1' }];
    for (const operation of ['count', 'aggregate', 'findOne'] as const) {
      const { mw } = install({ scan, readable: { crm_case: [] } });
      expect((await read(mw, { operation })).where).toEqual(DENY);
    }
    const { mw, calls } = install({ scan, readable: { crm_case: [] } });
    expect((await read(mw, { operation: 'insert' })).where).toBeUndefined();
    expect((await read(mw, { context: { isSystem: true } })).where).toBeUndefined();
    expect((await read(mw, { context: undefined })).where).toBeUndefined();
    expect(calls.scans).toEqual([]);
  });

  it('probes the parent with the caller envelope, minus the operation-private keys', async () => {
    const { mw, calls } = install({ scan: () => [{ object_name: 'crm_case', record_id: 'c1' }], readable: { crm_case: ['c1'] } });
    await read(mw, {
      context: { userId: 'u1', principalKind: 'agent', __readScope: 'org', __expandRead: true } as any,
    });
    expect(calls.probes).toHaveLength(1);
    expect(calls.probes[0].context).toMatchObject({ userId: 'u1', principalKind: 'agent' });
    expect(calls.probes[0].context).not.toHaveProperty('__readScope');
    expect(calls.probes[0].context).not.toHaveProperty('__expandRead');
  });

  it('[#21260] a holder of the ledger’s audit capability is narrowed here exactly like any caller', async () => {
    const scan = () => [{ object_name: 'crm_case', record_id: 'c1' }];
    for (const operation of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const { mw, calls } = install({ scan, readable: { crm_case: [] } });
      const holder = { userId: 'u1', systemPermissions: [LEDGER_AUDIT_CAPABILITY] };
      expect((await read(mw, { operation, context: holder })).where).toEqual(DENY);
      expect(calls.scans).toHaveLength(1);
    }
  });

  it('is inert on an engine without the middleware seam', () => {
    const engine: CommentAccessEngine = { registerHook: () => {}, find: async () => [], findOne: async () => null };
    expect(() => installActivityReadVisibility(engine, silentLogger())).not.toThrow();
  });
});
