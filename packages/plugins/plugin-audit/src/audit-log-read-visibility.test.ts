// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21175] The `sys_audit_log` read gate's row classes and fail-closed
 * branches, against stand-in engines — plus the shape of what it emits: the
 * leaf path (ADR-0139 D4) against an engine that answers the gate's three
 * classifying questions, and the bounded probe against one that answers none
 * of them. What the emitted filter SELECTS is pinned against a real driver in
 * `parent-record-read-leaf.integration.test.ts` and
 * `audit-log-read-visibility.integration.test.ts`.
 */

import { isDeepStrictEqual } from 'node:util';
import { describe, it, expect, vi } from 'vitest';
import { PLATFORM_OPERATOR_POSTURE } from '@objectstack/metadata-core';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { isReadableIds } from '@objectstack/spec/data';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { SystemObjectName } from '@objectstack/spec/system';
import {
  LEDGER_AUDIT_CAPABILITY,
  LEDGER_NAMED_PARENTS,
  installAuditLogReadVisibility,
  isLedgerRowAboutNoRecord,
  ledgerRowAboutAnOrganizationWhere,
  ledgerRowAboutNoRecordWhere,
  readsDeploymentLevelLedgerRows,
} from './audit-log-read-visibility.js';
import { AUDIT_EXCLUDED_OBJECTS } from './audit-writers.js';
import type { CommentAccessEngine, CommentReadMiddlewareCtx } from './comment-access-hooks.js';
import type { ParentObjectReadAdmissionSource, ParentRecordGateEngine } from './parent-record-read-gate.js';

const DENY = { id: '__audit_log_parent_denied__' };
const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
type Mw = (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;

function install(opts: {
  scan: (options: any) => Array<Record<string, unknown>>;
  /** parentObject -> readable ids (for any caller), or a thrower. */
  readable?: Record<string, string[] | (() => never)>;
  logger?: ReturnType<typeof silentLogger>;
  /** The security service's object-level read admission the gate resolves per read; absent: none composed. */
  admission?: ParentObjectReadAdmissionSource;
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
  installAuditLogReadVisibility(engine, opts.logger ?? silentLogger(), opts.admission ?? (() => undefined));
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
  return { ...splitOrganizationBound(ctx.ast?.where), ran };
}

/** [#26750] The deployment-level rule's clause, ANDed into a read after the parent-record gate's. */
const ORGANIZATION = ledgerRowAboutAnOrganizationWhere();

/**
 * A read's WHERE as the parent-record gate left it, and whether the
 * deployment-level rule then ANDed its clause in. The suites below assert the
 * gate's part exactly, as before the rule; the rule's own suite asserts both.
 */
function splitOrganizationBound(where: unknown): { where: unknown; organizationBound: boolean } {
  const and = (where as { $and?: unknown[] } | undefined)?.$and;
  if (Array.isArray(and) && and.length === 2 && isDeepStrictEqual(and[1], ORGANIZATION)) {
    return { where: and[0], organizationBound: true };
  }
  if (isDeepStrictEqual(where, ORGANIZATION)) return { where: undefined, organizationBound: true };
  return { where, organizationBound: false };
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

/** The outside class's predicate, as the gate ORs it in. */
const OUTSIDE = ledgerRowAboutNoRecordWhere();

describe('ledgerRowAboutNoRecordWhere', () => {
  it('is the outside class as a predicate on the ledger’s own columns, a fresh tree per call', () => {
    expect(OUTSIDE).toEqual({
      $and: [
        { $or: [{ record_id: null }, { record_id: '' }] },
        { action: { $ne: null } },
        { action: { $nin: ['', 'create', 'update', 'delete', 'read'] } },
      ],
    });
    expect(ledgerRowAboutNoRecordWhere()).not.toBe(ledgerRowAboutNoRecordWhere());
  });
});

describe('installAuditLogReadVisibility — the bounded probe (an engine that cannot classify a parent)', () => {
  it('keeps rows about a readable record by their parent pair, as stored, beside the outside class', async () => {
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
        OUTSIDE,
      ],
    });
  });

  it('the rows about no record are kept by the predicate, never by a stored id the scan saw', async () => {
    const { mw, calls } = install({
      scan: () => [
        { id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' },
        { id: 'l2', action: 'config_change', object_name: 'sys_setting', record_id: null },
        { id: 'l3', action: 'import', object_name: 'sys_user', record_id: null },
      ],
      readable: { crm_case: [] },
    });
    expect((await read(mw)).where).toEqual(OUTSIDE);
    expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
  });

  it('asks the object-level read admission first: a refused object is never read, and the WHERE is unchanged', async () => {
    const scan = () => [
      { id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' },
      { id: 'l2', action: 'update', object_name: 'sys_migration', record_id: 'm1' },
      { id: 'l3', action: 'config_change', object_name: 'sys_setting', record_id: null },
    ];
    const readable = {
      crm_case: ['c1'],
      sys_migration: () => {
        throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
      },
    };
    const without = install({ scan, readable });
    const before = (await read(without.mw)).where;
    expect(without.calls.probes.map((p) => p.object).sort()).toEqual(['crm_case', 'sys_migration']);

    const canReadObject = vi.fn(async (object: string) => object !== 'sys_migration');
    const { mw, calls } = install({ scan, readable, admission: () => ({ canReadObject }) });
    expect((await read(mw)).where).toEqual(before);
    expect(before).toEqual({ $or: [{ object_name: 'crm_case', record_id: { $in: ['c1'] } }, OUTSIDE] });
    expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
    expect(canReadObject.mock.calls.map(([object]) => object).sort()).toEqual(['crm_case', 'sys_migration']);
  });

  it('a holder of the audit capability is exempt before the admission is asked', async () => {
    const canReadObject = vi.fn(async () => true);
    const { mw, calls } = install({
      scan: () => [{ id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' }],
      admission: () => ({ canReadObject }),
    });
    const { where } = await read(mw, { context: { userId: 'u1', systemPermissions: [LEDGER_AUDIT_CAPABILITY] } });
    expect(where).toBeUndefined();
    expect(calls.scans).toEqual([]);
    expect(canReadObject).not.toHaveBeenCalled();
  });

  it('a record action that names no record is excluded, never kept as a row about none', async () => {
    const { mw, calls } = install({
      scan: () => [{ id: 'l1', action: 'update', object_name: 'crm_case', record_id: null }],
    });
    expect((await read(mw)).where).toEqual(OUTSIDE);
    expect(isLedgerRowAboutNoRecord({ id: 'l1', action: 'update', object_name: 'crm_case', record_id: null })).toBe(false);
    expect(calls.probes).toEqual([]);
  });

  it('no scanned record readable: only the outside class remains', async () => {
    const { mw } = install({
      scan: () => [
        { id: 'l1', action: 'delete', object_name: 'crm_case', record_id: 'c1' },
        { id: 'l2', action: 'login', object_name: null, record_id: 's1' },
        { id: 'l3', action: 'create', object_name: 'sys_audit_log', record_id: 'a1' },
        { id: 'l4', action: 'create', object_name: 'Not A Name', record_id: 'x1' },
      ],
      readable: { crm_case: [] },
    });
    expect((await read(mw)).where).toEqual(OUTSIDE);
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
    expect((await read(mw)).where).toEqual({ $or: [{ object_name: 'crm_case', record_id: { $in: ['c1'] } }, OUTSIDE] });
  });

  it('denies all, and says so, when the pre-scan itself fails — the outside class included', async () => {
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
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('audit log read visibility: the bounded probe'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed, denying all'));
  });

  it('scans under SYSTEM context with the caller’s where and order, the parent pair only, bounded', async () => {
    const { mw, calls } = install({ scan: () => [] });
    const where = { action: 'update' };
    const orderBy = [{ field: 'created_at', order: 'desc' }];
    const { where: after } = await read(mw, { ast: { object: 'sys_audit_log', where, orderBy } });
    expect(after).toEqual({ $and: [where, OUTSIDE] });
    expect(calls.scans).toEqual([
      { where, fields: ['object_name', 'record_id'], orderBy, limit: 2000, context: { isSystem: true } },
    ]);
  });

  it('ANDs onto the caller’s where instead of replacing it', async () => {
    const { mw } = install({
      scan: () => [{ id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' }],
      readable: { crm_case: ['c1'] },
    });
    const existing = { action: 'create' };
    const { where } = await read(mw, { ast: { object: 'sys_audit_log', where: existing } });
    expect(where).toEqual({ $and: [existing, { $or: [{ object_name: 'crm_case', record_id: { $in: ['c1'] } }, OUTSIDE] }] });
  });

  it('warns when the scan hits its bound', async () => {
    const logger = silentLogger();
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: `l${i}`, action: 'update', object_name: 'crm_case', record_id: `c${i}` }));
    const { mw } = install({ scan: () => rows, readable: { crm_case: ['c1'] }, logger });
    await read(mw);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("audit log read visibility: the bounded probe's candidate pre-scan"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('hit the 2000-row cap'));
  });

  it('narrows count, aggregate and findOne, and leaves writes, system and context-less reads alone', async () => {
    const scan = () => [{ id: 'l1', action: 'create', object_name: 'crm_case', record_id: 'c1' }];
    for (const operation of ['count', 'aggregate', 'findOne'] as const) {
      const { mw } = install({ scan, readable: { crm_case: [] } });
      expect((await read(mw, { operation })).where).toEqual(OUTSIDE);
    }
    const { mw, calls } = install({ scan, readable: { crm_case: [] } });
    expect((await read(mw, { operation: 'insert' })).where).toBeUndefined();
    expect((await read(mw, { context: { isSystem: true } })).where).toBeUndefined();
    expect((await read(mw, { context: undefined })).where).toBeUndefined();
    expect(calls.scans).toEqual([]);
  });

  it('is inert on an engine without the middleware seam', () => {
    const engine: CommentAccessEngine = { registerHook: () => {}, find: async () => [], findOne: async () => null };
    expect(() => installAuditLogReadVisibility(engine, silentLogger(), () => undefined)).not.toThrow();
  });
});

/** A stand-in engine that answers the three questions the gate classifies a parent by. */
/** The comment-gate engine double, recording its middleware and its reads. */
function baseEngine(onMiddleware: (fn: Mw) => void, onFind: (object: string, options: any) => void): CommentAccessEngine {
  return {
    registerHook: () => {},
    registerMiddleware: (fn) => onMiddleware(fn as Mw),
    find: async (object: string, options: any) => {
      onFind(object, options);
      return [];
    },
    findOne: async () => null,
  };
}

function installClassifying(objects: string[]) {
  let mw!: Mw;
  const calls = { scans: [] as any[] };
  // The classifying questions, over the comment-gate double.
  const engine: ParentRecordGateEngine = Object.assign(
    baseEngine((fn) => (mw = fn), (object, options) => calls.scans.push({ object, options })),
    {
      registry: { getAllObjects: () => objects.map((name) => ({ name })) } as any,
      hasObjectMiddleware: () => false,
      resolveEffectiveDatasource: () => undefined,
    },
  );
  installAuditLogReadVisibility(engine, silentLogger(), () => ({ canReadObject: async () => true }));
  return { mw, calls };
}

describe('[ADR-0139 D4] the ledger on the leaf path', () => {
  const leafOf = (branch: any): string | null => {
    const comparand = branch?.record_id?.$in;
    return isReadableIds(comparand) ? comparand.object : null;
  };

  it('one leaf per parent object, the outside class as a predicate beside them, nothing scanned', async () => {
    const { mw, calls } = installClassifying(['crm_case', 'crm_deal', 'sys_audit_log']);
    const where = (await read(mw)).where as any;
    expect(where.$or.map(leafOf)).toEqual(['crm_case', 'crm_deal', null]);
    expect(where.$or[2]).toEqual(OUTSIDE);
    expect(calls.scans).toEqual([]);
  });

  it('names the session its auth-event sink writes about, which the audit writer excludes', async () => {
    expect(LEDGER_NAMED_PARENTS).toEqual([SystemObjectName.SESSION]);
    expect(AUDIT_EXCLUDED_OBJECTS).toContain(SystemObjectName.SESSION);
    const others = AUDIT_EXCLUDED_OBJECTS.filter((o) => o !== SystemObjectName.SESSION && o !== 'sys_audit_log');
    const { mw } = installClassifying(['crm_case', SystemObjectName.SESSION, ...others]);
    const where = (await read(mw)).where as any;
    expect(where.$or.map(leafOf)).toEqual(['crm_case', SystemObjectName.SESSION, null]);
  });

  it('a read naming its parent objects keeps a leaf for each named one, and the outside class beside them, whole', async () => {
    const { mw } = installClassifying(['crm_case', 'crm_deal', 'crm_lead', 'sys_audit_log']);
    const named = { object_name: { $in: ['crm_deal', 'sys_setting'] } };
    const where = (await read(mw, { ast: { object: 'sys_audit_log', where: named } })).where as any;
    expect(where.$and[0]).toBe(named);
    expect(where.$and[1].$or.map(leafOf)).toEqual(['crm_deal', null]);
    expect(where.$and[1].$or[1]).toEqual(OUTSIDE);
    // Naming no parent it enumerates: the outside class alone, never the deny-all sentinel.
    const none = (await read(mw, { ast: { object: 'sys_audit_log', where: { object_name: 'sys_setting' } } })).where as any;
    expect(none.$and[1]).toEqual(OUTSIDE);
  });

  it('the exemption is decided before anything is enumerated', async () => {
    const getAllObjects = vi.fn(() => [{ name: 'crm_case' }]);
    let mw!: Mw;
    const engine: ParentRecordGateEngine = Object.assign(
      baseEngine((fn) => (mw = fn), () => {}),
      { registry: { getAllObjects } as any, hasObjectMiddleware: () => false, resolveEffectiveDatasource: () => undefined },
    );
    installAuditLogReadVisibility(engine, silentLogger(), () => undefined);
    const existing = { action: 'delete' };
    const { where } = await read(mw, {
      context: { userId: 'u1', systemPermissions: [LEDGER_AUDIT_CAPABILITY] },
      ast: { object: 'sys_audit_log', where: existing },
    });
    expect(where).toBe(existing);
    expect(getAllObjects).not.toHaveBeenCalled();
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

  it('its holder is not narrowed by the parent-record gate, on any read operation, and nothing is scanned for it', async () => {
    for (const operation of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const { mw, calls } = install({ scan: unreadable, readable: { crm_case: [], sys_session: [] } });
      const existing = { action: 'delete' };
      const { where, organizationBound, ran } = await read(mw, { operation, context: holder, ast: { object: 'sys_audit_log', where: existing } });
      expect(ran).toBe(true);
      expect(where).toBe(existing);
      // [#26750] Only the gate: an organization holder is still kept off the deployment-level rows.
      expect(organizationBound).toBe(true);
      expect(calls.scans).toEqual([]);
      expect(calls.probes).toEqual([]);
    }
  });

  it('its holder’s broad read never meets the probe’s bound', async () => {
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
      expect((await read(mw, { context: { userId: 'u1', systemPermissions } })).where).toEqual(OUTSIDE);
      expect(calls.scans).toHaveLength(1);
    }
  });
});

describe('[#26750, ruling A] the deployment-level rows: the platform administrator alone', () => {
  const unreadable = () => [{ id: 'l1', action: 'delete', object_name: 'crm_case', record_id: 'c1' }];
  const platformAdmin = { userId: 'u_platform', posture: PLATFORM_OPERATOR_POSTURE, systemPermissions: [LEDGER_AUDIT_CAPABILITY] };

  it('the clause is the rows that name an organization in tenant_id, a fresh tree per call', () => {
    expect(ORGANIZATION).toEqual({ $and: [{ tenant_id: { $ne: null } }, { tenant_id: { $ne: '' } }] });
    expect(ledgerRowAboutAnOrganizationWhere()).not.toBe(ledgerRowAboutAnOrganizationWhere());
  });

  it('the platform administrator is the carried PLATFORM_ADMIN rung, and nothing else', () => {
    expect(PLATFORM_OPERATOR_POSTURE).toBe('PLATFORM_ADMIN');
    expect(readsDeploymentLevelLedgerRows({ userId: 'u1', posture: 'PLATFORM_ADMIN' })).toBe(true);
    for (const context of [
      { userId: 'u1', posture: 'TENANT_ADMIN' },
      { userId: 'u1', posture: 'MEMBER' },
      { userId: 'u1', posture: 'EXTERNAL' },
      { userId: 'u1', posture: 'platform_admin' },
      // No rung carried: fail closed, whatever else the context holds.
      { userId: 'u1' },
      { userId: 'u1', positions: ['platform_admin'] },
      { userId: 'u1', permissions: ['admin_full_access'] },
      { userId: 'u1', systemPermissions: [...ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions] },
      undefined,
    ]) {
      expect(readsDeploymentLevelLedgerRows(context), JSON.stringify(context)).toBe(false);
    }
  });

  it('a caller without the audit capability gets the gate, then the clause ANDed after it', async () => {
    const { mw } = install({ scan: unreadable, readable: { crm_case: [] } });
    const existing = { action: 'delete' };
    const ctx: CommentReadMiddlewareCtx = {
      object: 'sys_audit_log', operation: 'find', ast: { object: 'sys_audit_log', where: existing }, context: { userId: 'u1' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast?.where).toEqual({ $and: [{ $and: [existing, OUTSIDE] }, ORGANIZATION] });
  });

  it('an organization holder of the audit capability, on every rung but the platform administrator’s, gets the clause alone', async () => {
    for (const posture of ['TENANT_ADMIN', 'MEMBER', 'EXTERNAL', undefined]) {
      for (const operation of ['find', 'findOne', 'count', 'aggregate'] as const) {
        const { mw, calls } = install({ scan: unreadable, readable: { crm_case: [] } });
        const { where, organizationBound } = await read(mw, {
          operation, context: { userId: 'u1', posture, systemPermissions: [LEDGER_AUDIT_CAPABILITY] },
        });
        expect(where, `${posture} ${operation}`).toBeUndefined();
        expect(organizationBound, `${posture} ${operation}`).toBe(true);
        expect(calls.scans).toEqual([]);
      }
    }
  });

  it('the platform administrator is not narrowed at all: its read reaches the driver as it was sent', async () => {
    for (const operation of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const { mw, calls } = install({ scan: unreadable, readable: { crm_case: [] } });
      const existing = { action: 'delete' };
      const ctx: CommentReadMiddlewareCtx = {
        object: 'sys_audit_log', operation, ast: { object: 'sys_audit_log', where: existing }, context: platformAdmin,
      };
      await mw(ctx, async () => {});
      expect(ctx.ast?.where).toBe(existing);
      expect(calls.scans).toEqual([]);
    }
  });

  it('the platform administrator without the audit capability gets the gate, and no clause', async () => {
    const { mw } = install({ scan: unreadable, readable: { crm_case: [] } });
    const { where, organizationBound } = await read(mw, { context: { userId: 'u_platform', posture: PLATFORM_OPERATOR_POSTURE } });
    expect(where).toEqual(OUTSIDE);
    expect(organizationBound).toBe(false);
  });

  it('writes, system reads and context-less reads take no clause', async () => {
    const { mw } = install({ scan: unreadable, readable: { crm_case: [] } });
    for (const partial of [{ operation: 'insert' as const }, { context: { isSystem: true } }, { context: undefined }]) {
      const { where, organizationBound } = await read(mw, partial);
      expect(where).toBeUndefined();
      expect(organizationBound).toBe(false);
    }
  });
});
