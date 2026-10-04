// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21175] The `sys_audit_log` read gate's row classes and fail-closed
 * branches, against a stand-in engine — plus the shape of what it emits. What
 * the emitted filter SELECTS is pinned against a real driver in
 * `audit-log-read-visibility.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import {
  LEDGER_AUDIT_CAPABILITY,
  installAuditLogReadVisibility,
  isLedgerRowAboutNoRecord,
} from './audit-log-read-visibility.js';
import type { CommentAccessEngine, CommentReadMiddlewareCtx } from './comment-access-hooks.js';

const DENY = { id: '__audit_log_parent_denied__' };
const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
type Mw = (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;

function install(opts: {
  scan: (options: any) => Array<Record<string, unknown>>;
  /** parentObject -> readable ids (for any caller), or a thrower. */
  readable?: Record<string, string[] | (() => never)>;
  logger?: ReturnType<typeof silentLogger>;
}) {
  let mw!: Mw;
  const calls = { scans: [] as any[], probes: [] as Array<{ object: string; ids: string[] }> };
  const engine: CommentAccessEngine = {
    registerHook: () => {},
    registerMiddleware: (fn) => {
      mw = fn as Mw;
    },
    find: async (object: string, options: any) => {
      if (object === 'sys_audit_log') {
        calls.scans.push(options);
        return opts.scan(options) as any;
      }
      const ids: string[] = (options?.where?.id?.$in ?? []).map(String);
      calls.probes.push({ object, ids });
      const r = opts.readable?.[object];
      if (typeof r === 'function') r();
      const list = Array.isArray(r) ? r : [];
      return ids.filter((id) => list.includes(id)).map((id) => ({ id })) as any;
    },
    findOne: async () => null,
  };
  installAuditLogReadVisibility(engine, opts.logger ?? silentLogger());
  return { mw, calls };
}

async function read(mw: Mw, partial: Partial<CommentReadMiddlewareCtx> = {}) {
  const ctx: CommentReadMiddlewareCtx = {
    object: 'sys_audit_log',
    operation: 'find',
    ast: { object: 'sys_audit_log', where: undefined },
    context: { userId: 'u1' },
    ...partial,
  };
  let ran = false;
  await mw(ctx, async () => {
    ran = true;
  });
  return { where: ctx.ast?.where, ran };
}

describe('isLedgerRowAboutNoRecord', () => {
  it('a row naming no record under an action that is not about one is outside the record gate', () => {
    for (const action of ['config_change', 'import', 'platform_admin_standing_change', 'login', 'logout']) {
      expect(isLedgerRowAboutNoRecord({ action, object_name: 'sys_setting', record_id: null })).toBe(true);
      expect(isLedgerRowAboutNoRecord({ action, object_name: null })).toBe(true);
      expect(isLedgerRowAboutNoRecord({ action, record_id: '' })).toBe(true);
    }
  });

  it('a record action naming no record, a row naming a record, or a row with no action is not', () => {
    for (const action of ['create', 'read', 'update', 'delete']) {
      expect(isLedgerRowAboutNoRecord({ action, object_name: 'crm_case', record_id: null })).toBe(false);
    }
    expect(isLedgerRowAboutNoRecord({ action: 'login', object_name: null, record_id: 's1' })).toBe(false);
    expect(isLedgerRowAboutNoRecord({ action: 'login', object_name: 'sys_audit_log', record_id: 'a1' })).toBe(false);
    expect(isLedgerRowAboutNoRecord({ action: null, record_id: null })).toBe(false);
    expect(isLedgerRowAboutNoRecord({ action: '', record_id: null })).toBe(false);
  });
});

describe('installAuditLogReadVisibility', () => {
  it('keeps rows about a readable record by their parent pair, as stored', async () => {
    const { mw } = install({
      scan: () => [
        { id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' },
        { id: 'l2', action: 'update', object_name: 'crm_case', record_id: 'c2' },
        { id: 'l3', action: 'login', object_name: 'sys_session', record_id: 's1' },
      ],
      readable: { crm_case: ['c1'], sys_session: ['s1'] },
    });
    const { where, ran } = await read(mw);
    expect(ran).toBe(true);
    expect(where).toEqual({
      $or: [
        { object_name: 'crm_case', record_id: { $in: ['c1'] } },
        { object_name: 'sys_session', record_id: { $in: ['s1'] } },
      ],
    });
  });

  it('keeps the rows about no record by their stored id, beside the record branches', async () => {
    const { mw, calls } = install({
      scan: () => [
        { id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' },
        { id: 'l2', action: 'config_change', object_name: 'sys_setting', record_id: null },
        { id: 'l3', action: 'import', object_name: 'sys_user', record_id: null },
      ],
      readable: { crm_case: [] },
    });
    expect((await read(mw)).where).toEqual({ id: { $in: ['l2', 'l3'] } });
    expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
  });

  it('a record action that names no record is excluded, never kept as a row about none', async () => {
    const { mw, calls } = install({
      scan: () => [{ id: 'l1', action: 'update', object_name: 'crm_case', record_id: null }],
    });
    expect((await read(mw)).where).toEqual(DENY);
    expect(calls.probes).toEqual([]);
  });

  it('denies all when no scanned record is readable and no row is about no record', async () => {
    const { mw } = install({
      scan: () => [
        { id: 'l1', action: 'delete', object_name: 'crm_case', record_id: 'c1' },
        { id: 'l2', action: 'login', object_name: null, record_id: 's1' },
        { id: 'l3', action: 'create', object_name: 'sys_audit_log', record_id: 'a1' },
        { id: 'l4', action: 'create', object_name: 'Not A Name', record_id: 'x1' },
      ],
      readable: { crm_case: [] },
    });
    expect((await read(mw)).where).toEqual(DENY);
  });

  it('a parent object whose read throws contributes nothing (fail closed)', async () => {
    const { mw } = install({
      scan: () => [
        { id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' },
        { id: 'l2', action: 'create', object_name: 'gone_object', record_id: 'g1' },
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
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('audit log read visibility: filter failed, denying all'));
  });

  it('scans under SYSTEM context with the caller’s where and order, the class columns included, bounded', async () => {
    const { mw, calls } = install({ scan: () => [] });
    const where = { action: 'update' };
    const orderBy = [{ field: 'created_at', order: 'desc' }];
    const { where: after } = await read(mw, { ast: { object: 'sys_audit_log', where, orderBy } });
    expect(after).toEqual(where);
    expect(calls.scans).toEqual([
      { where, fields: ['object_name', 'record_id', 'id', 'action'], orderBy, limit: 2000, context: { isSystem: true } },
    ]);
  });

  it('ANDs onto the caller’s where instead of replacing it', async () => {
    const { mw } = install({
      scan: () => [{ id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' }],
      readable: { crm_case: ['c1'] },
    });
    const existing = { action: 'create' };
    const { where } = await read(mw, { ast: { object: 'sys_audit_log', where: existing } });
    expect(where).toEqual({ $and: [existing, { object_name: 'crm_case', record_id: { $in: ['c1'] } }] });
  });

  it('warns when the scan hits its bound', async () => {
    const logger = silentLogger();
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: `l${i}`, action: 'update', object_name: 'crm_case', record_id: `c${i}` }));
    const { mw } = install({ scan: () => rows, readable: { crm_case: ['c1'] }, logger });
    await read(mw);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('audit log read visibility: candidate pre-scan hit the 2000-row cap'));
  });

  it('narrows count, aggregate and findOne, and leaves writes, system and context-less reads alone', async () => {
    const scan = () => [{ id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' }];
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

  it('is inert on an engine without the middleware seam', () => {
    const engine: CommentAccessEngine = { registerHook: () => {}, find: async () => [], findOne: async () => null };
    expect(() => installAuditLogReadVisibility(engine, silentLogger())).not.toThrow();
  });
});

describe('[#21260] the ledger audit capability', () => {
  const unreadable = () => [
    { id: 'l1', action: 'delete', object_name: 'crm_case', record_id: 'c1' },
    { id: 'l2', action: 'logout', object_name: 'sys_session', record_id: 's1' },
  ];
  const holder = { userId: 'u1', systemPermissions: ['setup.access', LEDGER_AUDIT_CAPABILITY] };

  it('is the capability the platform declares, org-scoped, and grants platform administrators by default', () => {
    expect(PLATFORM_CAPABILITIES.find((c) => c.name === LEDGER_AUDIT_CAPABILITY)?.scope).toBe('org');
    expect(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions).toContain(LEDGER_AUDIT_CAPABILITY);
  });

  it('its holder is not narrowed, on any read operation, and nothing is scanned for it', async () => {
    for (const operation of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const { mw, calls } = install({ scan: unreadable, readable: { crm_case: [], sys_session: [] } });
      const existing = { action: 'delete' };
      const { where, ran } = await read(mw, { operation, context: holder, ast: { object: 'sys_audit_log', where: existing } });
      expect(ran).toBe(true);
      expect(where).toBe(existing);
      expect(calls.scans).toEqual([]);
      expect(calls.probes).toEqual([]);
    }
  });

  it('its holder’s broad read never meets the pre-scan bound', async () => {
    const logger = silentLogger();
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: `l${i}`, action: 'update', object_name: 'crm_case', record_id: `c${i}` }));
    const { mw, calls } = install({ scan: () => rows, readable: { crm_case: [] }, logger });
    expect((await read(mw, { context: holder })).where).toBeUndefined();
    expect(calls.scans).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a caller without it gets exactly the parent-record gate: other capabilities, a non-list, or none', async () => {
    for (const systemPermissions of [['setup.access', 'manage_users'], LEDGER_AUDIT_CAPABILITY, undefined]) {
      const { mw, calls } = install({ scan: unreadable, readable: { crm_case: [], sys_session: [] } });
      expect((await read(mw, { context: { userId: 'u1', systemPermissions } })).where).toEqual(DENY);
      expect(calls.scans).toHaveLength(1);
    }
  });
});
