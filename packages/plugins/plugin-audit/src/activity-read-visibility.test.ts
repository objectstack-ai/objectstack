// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_activity` read gate's branches that a real engine cannot easily be
 * made to take, plus the shape of what it emits:
 *
 *  - the leaf path (ADR-0139 D4) against a stand-in engine that answers the
 *    three questions the gate classifies by — one `ReadableIds` leaf per
 *    enumerated parent object, nothing scanned, nothing asked;
 *  - D5's three classes routed to the bounded probe, by name, up front;
 *  - the bounded probe itself — a failing pre-scan, a failing parent read,
 *    the scan bound, the object-level admission — against a stand-in engine
 *    that answers none of the three, so the whole read is the probe.
 *
 * What the emitted filter SELECTS is pinned against a real engine and driver
 * in `parent-record-read-leaf.integration.test.ts` (the leaf) and
 * `activity-read-visibility.integration.test.ts` (the probe).
 */

import { describe, it, expect, vi } from 'vitest';
import { isReadableIds } from '@objectstack/spec/data';
import { installActivityReadVisibility, parseActivityParent } from './activity-read-visibility.js';
import { LEDGER_AUDIT_CAPABILITY } from './audit-log-read-visibility.js';
import { AUDIT_EXCLUDED_OBJECTS } from './audit-writers.js';
import type { CommentAccessEngine, CommentReadMiddlewareCtx } from './comment-access-hooks.js';
import type { ParentObjectReadAdmissionSource, ParentRecordGateEngine } from './parent-record-read-gate.js';

const DENY = { id: '__activity_parent_denied__' };
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
  installActivityReadVisibility(engine, opts.logger ?? silentLogger(), opts.admission ?? (() => undefined));
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

  it('a read the probe finds no row for is still narrowed, so a row written meanwhile is judged', async () => {
    const { mw } = install({ scan: () => [] });
    expect((await read(mw)).where).toEqual(DENY);
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

  describe('the object-level read admission: a skipped object is not read as the caller', () => {
    /** Two parent objects; the caller-scoped read refuses `crm_secret` (the middleware's denial). */
    const scan = () => [
      { object_name: 'crm_case', record_id: 'c1' },
      { object_name: 'crm_case', record_id: 'c2' },
      { object_name: 'crm_secret', record_id: 's1' },
    ];
    const readable = {
      crm_case: ['c1'],
      crm_secret: () => {
        throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
      },
    };
    const admissionOf = (answer: (object: string) => unknown) => {
      const canReadObject = vi.fn(async (object: string) => answer(object) as boolean);
      return { canReadObject, source: () => ({ canReadObject }) };
    };
    const CASE_ONLY = { object_name: 'crm_case', record_id: { $in: ['c1'] } };

    it('an object the admission refuses is never read, and the WHERE is the one its refused read gave', async () => {
      const without = install({ scan, readable });
      const before = (await read(without.mw)).where;
      expect(before).toEqual(CASE_ONLY);
      expect(without.calls.probes.map((p) => p.object).sort()).toEqual(['crm_case', 'crm_secret']);

      const { canReadObject, source } = admissionOf((object) => object !== 'crm_secret');
      const { mw, calls } = install({ scan, readable, admission: source });
      expect((await read(mw)).where).toEqual(before);
      expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
      expect(canReadObject.mock.calls.map(([object]) => object).sort()).toEqual(['crm_case', 'crm_secret']);
    });

    it('an admitted object is still read as the caller, and that read decides its rows', async () => {
      const { source } = admissionOf(() => true);
      const { mw, calls } = install({ scan, readable: { crm_case: ['c1'], crm_secret: [] }, admission: source });
      expect((await read(mw)).where).toEqual(CASE_ONLY);
      expect(calls.probes.find((p) => p.object === 'crm_case')?.ids.sort()).toEqual(['c1', 'c2']);
      expect(calls.probes.map((p) => p.object).sort()).toEqual(['crm_case', 'crm_secret']);
    });

    it('asks with the caller envelope, minus the operation-private keys — the envelope the parent read gets', async () => {
      const { canReadObject, source } = admissionOf(() => true);
      const { mw, calls } = install({ scan, readable: { crm_case: ['c1'], crm_secret: [] }, admission: source });
      await read(mw, {
        context: { userId: 'u1', positions: ['org_member'], __readScope: 'org', __expandRead: true } as any,
      });
      for (const [, context] of canReadObject.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
        expect(context).toEqual(calls.probes[0].context);
        expect(context).toMatchObject({ userId: 'u1', positions: ['org_member'] });
        expect(context).not.toHaveProperty('__readScope');
        expect(context).not.toHaveProperty('__expandRead');
      }
    });

    it('every parent object refused: the deny-all sentinel, and no parent read at all', async () => {
      const { source } = admissionOf(() => false);
      const { mw, calls } = install({ scan, readable, admission: source });
      expect((await read(mw)).where).toEqual(DENY);
      expect(calls.probes).toEqual([]);
    });

    it('fails closed: an admission that throws refuses that object, says so, and never widens', async () => {
      const logger = silentLogger();
      // The caller-scoped read WOULD serve crm_secret's record here — the
      // admission's failure must not fall open into it.
      const { source } = admissionOf((object) => {
        if (object === 'crm_secret') throw new Error('admission store unreachable');
        return true;
      });
      const { mw, calls } = install({ scan, readable: { crm_case: ['c1'], crm_secret: ['s1'] }, admission: source, logger });
      expect((await read(mw)).where).toEqual(CASE_ONLY);
      expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("read admission for 'crm_secret' failed"));
    });

    it('fails closed: an answer that is not a plain true refuses', async () => {
      for (const answer of [undefined, null, 'true', 1, {}]) {
        const { source } = admissionOf((object) => (object === 'crm_secret' ? answer : true));
        const { mw, calls } = install({ scan, readable: { crm_case: ['c1'], crm_secret: ['s1'] }, admission: source });
        expect((await read(mw)).where).toEqual(CASE_ONLY);
        expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
      }
    });

    it('no admission composed — no service, a throwing resolver, or no canReadObject — reads every parent as before', async () => {
      const sources: Array<ParentObjectReadAdmissionSource> = [
        () => undefined,
        () => null,
        () => {
          throw new Error("service 'security' not registered");
        },
        () => ({}),
      ];
      for (const admission of sources) {
        const { mw, calls } = install({ scan, readable, admission });
        expect((await read(mw)).where).toEqual(CASE_ONLY);
        expect(calls.probes.map((p) => p.object).sort()).toEqual(['crm_case', 'crm_secret']);
      }
    });

    it('resolves the service on every read, so one that registers after install is asked', async () => {
      let registered: { canReadObject?: (object: string) => Promise<boolean> } | undefined;
      const { mw, calls } = install({ scan, readable, admission: () => registered });
      await read(mw);
      expect(calls.probes.map((p) => p.object).sort()).toEqual(['crm_case', 'crm_secret']);
      registered = { canReadObject: async (object: string) => object !== 'crm_secret' };
      calls.probes.length = 0;
      expect((await read(mw)).where).toEqual(CASE_ONLY);
      expect(calls.probes.map((p) => p.object)).toEqual(['crm_case']);
    });
  });

  it('is inert on an engine without the middleware seam', () => {
    const engine: CommentAccessEngine = { registerHook: () => {}, find: async () => [], findOne: async () => null };
    expect(() => installActivityReadVisibility(engine, silentLogger(), () => undefined)).not.toThrow();
  });

  it('an engine that cannot classify a parent sends the whole read to the probe, and says so once', async () => {
    const logger = silentLogger();
    const admission = () => ({ canReadObject: async () => true });
    const { mw, calls } = install({ scan: () => [{ object_name: 'crm_case', record_id: 'c1' }], readable: { crm_case: ['c1'] }, logger, admission });
    await read(mw);
    await read(mw);
    expect(calls.scans).toHaveLength(2);
    const said = logger.warn.mock.calls.filter(([line]) => String(line).includes('cannot say which parent objects'));
    expect(said).toHaveLength(1);
  });
});

/** A stand-in engine that answers the three questions the gate classifies a parent by. */
function installClassifying(opts: {
  objects: string[];
  /** Parent objects an object-scoped read middleware narrows. */
  middleware?: string[];
  /** object → datasource; absent: the default driver (`undefined`). */
  datasource?: Record<string, string>;
  scan?: (options: any) => Array<Record<string, unknown>>;
  readable?: Record<string, string[]>;
  admission?: ParentObjectReadAdmissionSource;
  logger?: ReturnType<typeof silentLogger>;
  registry?: unknown;
}) {
  let mw!: Mw;
  const calls = { scans: [] as any[], probes: [] as Array<{ object: string; ids: string[]; context: any }> };
  const base: CommentAccessEngine = {
    registerHook: () => {},
    registerMiddleware: (fn) => {
      mw = fn as Mw;
    },
    find: async (object: string, options: any) => {
      if (object === 'sys_activity') {
        calls.scans.push(options);
        return (opts.scan?.(options) ?? []) as any;
      }
      const ids: string[] = (options?.where?.id?.$in ?? []).map(String);
      calls.probes.push({ object, ids, context: options?.context });
      const list = opts.readable?.[object] ?? [];
      return ids.filter((id) => list.includes(id)).map((id) => ({ id })) as any;
    },
    findOne: async () => null,
  };
  // The classifying questions, over the comment-gate double above.
  const engine: ParentRecordGateEngine = Object.assign(base, {
    registry: (opts.registry ?? { getAllObjects: () => opts.objects.map((name) => ({ name })) }) as any,
    hasObjectMiddleware: (object: string) => (opts.middleware ?? []).includes(object),
    resolveEffectiveDatasource: (object: string) => opts.datasource?.[object],
  });
  // A security service that answers `canReadObject` unless the case says otherwise:
  // without it the gate writes no leaf (see the `no-object-admission` case).
  installActivityReadVisibility(
    engine,
    opts.logger ?? silentLogger(),
    opts.admission ?? (() => ({ canReadObject: async () => true })),
  );
  return { mw, calls };
}

/** The `$or` branches of a gate WHERE (or the one branch). */
const branchesOf = (where: any): any[] => (where?.$or ? where.$or : [where]);
const leafObjectOf = (branch: any): string | null => {
  const comparand = branch?.record_id?.$in;
  return isReadableIds(comparand) ? comparand.object : null;
};

describe('[ADR-0139 D4] the leaf path: one ReadableIds leaf per parent object, and no pre-scan', () => {
  it('writes one branch per registered parent object, in name order, each a branded leaf on record_id', async () => {
    const { mw, calls } = installClassifying({ objects: ['crm_deal', 'crm_case'] });
    const { where, ran } = await read(mw);
    expect(ran).toBe(true);
    const branches = branchesOf(where);
    expect(branches.map((b) => b.object_name)).toEqual(['crm_case', 'crm_deal']);
    expect(branches.map(leafObjectOf)).toEqual(['crm_case', 'crm_deal']);
    // Nothing scanned, nothing read as the caller.
    expect(calls.scans).toEqual([]);
    expect(calls.probes).toEqual([]);
  });

  it('enumerates outside the audit writer’s excluded objects, the gated object and non-machine names', async () => {
    const excluded = AUDIT_EXCLUDED_OBJECTS.filter((o) => o !== 'sys_activity').slice(0, 3);
    expect(excluded.length).toBeGreaterThan(0);
    const { mw } = installClassifying({ objects: ['crm_case', 'sys_activity', 'Not A Name', ...excluded] });
    expect(branchesOf((await read(mw)).where).map(leafObjectOf)).toEqual(['crm_case']);
  });

  it('asks the security service nothing: the engine composes each leaf, so a refused object is never read', async () => {
    const canReadObject = vi.fn(async () => false);
    const { mw, calls } = installClassifying({ objects: ['crm_case', 'crm_secret'], admission: () => ({ canReadObject }) });
    expect(branchesOf((await read(mw)).where).map(leafObjectOf)).toEqual(['crm_case', 'crm_secret']);
    expect(canReadObject).not.toHaveBeenCalled();
    expect(calls.probes).toEqual([]);
  });

  it('ANDs onto the caller’s where, on all four reads, and leaves writes, system and context-less reads alone', async () => {
    const existing = { type: 'updated' };
    for (const operation of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const { mw } = installClassifying({ objects: ['crm_case'] });
      const where = (await read(mw, { operation, ast: { object: 'sys_activity', where: existing } })).where as {
        $and: unknown[];
      };
      expect(where.$and[0]).toBe(existing);
      expect(leafObjectOf(where.$and[1])).toBe('crm_case');
    }
    const { mw } = installClassifying({ objects: ['crm_case'] });
    expect((await read(mw, { operation: 'insert' })).where).toBeUndefined();
    expect((await read(mw, { context: { isSystem: true } })).where).toBeUndefined();
    expect((await read(mw, { context: undefined })).where).toBeUndefined();
  });

  it('a fresh leaf per read: nothing is shared between two reads', async () => {
    const { mw } = installClassifying({ objects: ['crm_case'] });
    const first = (await read(mw)).where as any;
    const second = (await read(mw)).where as any;
    expect(first.record_id.$in).not.toBe(second.record_id.$in);
  });

  it('no parent object to enumerate: the deny-all sentinel', async () => {
    const { mw } = installClassifying({ objects: ['sys_activity'] });
    expect((await read(mw)).where).toEqual(DENY);
  });

  it('[#21260] a holder of the ledger’s audit capability is narrowed here exactly like any caller', async () => {
    const { mw } = installClassifying({ objects: ['crm_case'] });
    const holder = { userId: 'u1', systemPermissions: [LEDGER_AUDIT_CAPABILITY] };
    expect(leafObjectOf((await read(mw, { context: holder })).where)).toBe('crm_case');
  });
});

describe('[ADR-0139 D4] a read that names its parent objects enumerates only those', () => {
  /** Forty registered parents: the gate's full enumeration, for a read that names none. */
  const OBJECTS = Array.from({ length: 40 }, (_, i) => `crm_o${String(i).padStart(2, '0')}`);
  const NAMED = ['crm_o05', 'crm_o17', 'crm_o33'];
  /** The gate's own conjunct: the second member of the `$and` it builds onto the caller's where. */
  const gateBranches = (where: any): any[] => branchesOf(where?.$and ? where.$and[1] : where);
  const readWhere = async (mw: Mw, where: unknown) => (await read(mw, { ast: { object: 'sys_activity', where } })).where;

  it('a read for 3 objects carries 3 branches — one leaf per named parent, of 40 registered', async () => {
    const { mw, calls } = installClassifying({ objects: OBJECTS });
    expect(branchesOf((await read(mw)).where)).toHaveLength(OBJECTS.length);
    const branches = gateBranches(await readWhere(mw, { object_name: { $in: NAMED } }));
    expect(branches).toHaveLength(3);
    expect(branches.map(leafObjectOf)).toEqual(NAMED);
    expect(branches.map((b) => b.object_name)).toEqual(NAMED);
    expect(calls.scans).toEqual([]);
  });

  it('reads a plain value, $eq and $in, at the root or inside a root $and at any depth; two confinements intersect', async () => {
    const { mw } = installClassifying({ objects: OBJECTS });
    for (const [where, expected] of [
      [{ object_name: 'crm_o05' }, ['crm_o05']],
      [{ object_name: { $eq: 'crm_o17' } }, ['crm_o17']],
      [{ $and: [{ type: 'updated' }, { $and: [{ object_name: { $in: NAMED } }] }] }, NAMED],
      [{ object_name: { $in: NAMED }, $and: [{ object_name: { $in: ['crm_o17', 'crm_o33', 'crm_o39'] } }] }, ['crm_o17', 'crm_o33']],
      [{ object_name: { $in: NAMED }, $or: [{ type: 'created' }, { type: 'updated' }] }, NAMED],
    ] as const) {
      expect(gateBranches(await readWhere(mw, where)).map(leafObjectOf), JSON.stringify(where)).toEqual(expected);
    }
  });

  it('a named object the gate does not enumerate gets no branch; naming none it does is the deny-all sentinel', async () => {
    const excluded = AUDIT_EXCLUDED_OBJECTS.filter((o) => o !== 'sys_activity')[0];
    const { mw } = installClassifying({ objects: [...OBJECTS, excluded, 'sys_activity'] });
    const named = { object_name: { $in: ['crm_o05', 'crm_unregistered', excluded, 'sys_activity'] } };
    expect(gateBranches(await readWhere(mw, named)).map(leafObjectOf)).toEqual(['crm_o05']);
    for (const where of [
      { object_name: { $in: ['crm_unregistered', excluded, 'sys_activity'] } },
      { object_name: { $in: [] } },
      { $and: [{ object_name: 'crm_o05' }, { object_name: 'crm_o17' }] },
    ]) {
      expect((await readWhere(mw, where) as any).$and[1], JSON.stringify(where)).toEqual(DENY);
    }
  });

  it('a shape it does not read — another operator, an $or, a $not, a value that is not a machine name — keeps every branch', async () => {
    const { mw } = installClassifying({ objects: OBJECTS });
    for (const where of [
      { $or: [{ object_name: 'crm_o05' }, { object_name: 'crm_o17' }] },
      { $or: [{ object_name: { $in: NAMED } }, { type: 'note' }] },
      { $not: { object_name: { $in: NAMED } } },
      { object_name: { $nin: NAMED } },
      { object_name: { $ne: 'crm_o05' } },
      { object_name: { $in: NAMED, $ne: 'crm_o05' } },
      { object_name: { $eq: 'crm_o05', $in: NAMED } },
      { object_name: { $in: ['crm_o05', 'CRM_O17'] } },
      { object_name: { $in: ['crm_o05', 7] } },
      { object_name: 'Crm_O05' },
      { object_name: { $startsWith: 'crm_o0' } },
      { record_id: { $in: NAMED } },
      { $and: { object_name: 'crm_o05' } },
    ]) {
      expect(gateBranches(await readWhere(mw, where)), JSON.stringify(where)).toHaveLength(OBJECTS.length);
    }
  });

  it('the bounded probe reads only the named parents of its classes, and is not run when the read names none of them', async () => {
    const opts = {
      objects: ['crm_case', 'sys_attachment', 'ext_ticket'],
      middleware: ['sys_attachment'],
      datasource: { ext_ticket: 'warehouse' },
      scan: () => [{ object_name: 'sys_attachment', record_id: 'f1' }],
      readable: { sys_attachment: ['f1'] },
    };
    const both = installClassifying(opts);
    const named = { object_name: { $in: ['crm_case', 'sys_attachment'] } };
    const branches = gateBranches(await readWhere(both.mw, named));
    expect(branches.map(leafObjectOf)).toEqual(['crm_case', null]);
    expect(branches[1]).toEqual({ object_name: 'sys_attachment', record_id: { $in: ['f1'] } });
    expect(both.calls.scans.map((s) => s.where)).toEqual([{ $and: [named, { object_name: { $in: ['sys_attachment'] } }] }]);

    const leafOnly = installClassifying(opts);
    expect(gateBranches(await readWhere(leafOnly.mw, { object_name: 'crm_case' })).map(leafObjectOf)).toEqual(['crm_case']);
    expect(leafOnly.calls.scans).toEqual([]);
    expect(leafOnly.calls.probes).toEqual([]);
  });

  it('a delegated caller’s whole-read probe is unchanged: it scans the caller’s own where', async () => {
    const { mw, calls } = installClassifying({
      objects: OBJECTS,
      scan: () => [{ object_name: 'crm_o05', record_id: 'c1' }],
      readable: { crm_o05: ['c1'] },
    });
    const where = { object_name: { $in: NAMED } };
    const ctxWhere = (await read(mw, { ast: { object: 'sys_activity', where }, context: { userId: 'u_agent', onBehalfOf: { userId: 'u_d' } } as any })).where as any;
    expect(ctxWhere.$and[1]).toEqual({ object_name: 'crm_o05', record_id: { $in: ['c1'] } });
    expect(calls.scans.map((s) => s.where)).toEqual([where]);
  });
});

describe('[ADR-0139 D5] three classes keep the bounded probe, by name, chosen before any leaf is written', () => {
  it('a parent an object-scoped read middleware narrows is probed — its rows only — beside the other parents’ leaves', async () => {
    const { mw, calls } = installClassifying({
      objects: ['crm_case', 'sys_attachment'],
      middleware: ['sys_attachment'],
      scan: () => [
        { object_name: 'sys_attachment', record_id: 'f1' },
        { object_name: 'sys_attachment', record_id: 'f2' },
      ],
      readable: { sys_attachment: ['f2'] },
    });
    const branches = branchesOf((await read(mw)).where);
    expect(branches.map(leafObjectOf)).toEqual(['crm_case', null]);
    expect(branches[1]).toEqual({ object_name: 'sys_attachment', record_id: { $in: ['f2'] } });
    expect(calls.scans).toEqual([
      {
        where: { object_name: { $in: ['sys_attachment'] } },
        fields: ['object_name', 'record_id'],
        limit: 2000,
        context: { isSystem: true },
      },
    ]);
    expect(calls.probes.map((p) => p.object)).toEqual(['sys_attachment']);
  });

  it('a parent bound to another datasource than the stream is probed', async () => {
    const { mw, calls } = installClassifying({
      objects: ['crm_case', 'ext_ticket'],
      datasource: { ext_ticket: 'warehouse' },
      scan: () => [{ object_name: 'ext_ticket', record_id: 't1' }],
      readable: { ext_ticket: ['t1'] },
    });
    const branches = branchesOf((await read(mw)).where);
    expect(branches.map(leafObjectOf)).toEqual(['crm_case', null]);
    expect(branches[1]).toEqual({ object_name: 'ext_ticket', record_id: { $in: ['t1'] } });
    expect(calls.scans[0].where).toEqual({ object_name: { $in: ['ext_ticket'] } });
  });

  it('every parent federated (a telemetry-split stream): no leaf, the probe answers every row', async () => {
    const { mw } = installClassifying({
      objects: ['crm_case', 'crm_deal'],
      datasource: { sys_activity: 'telemetry' },
      scan: () => [{ object_name: 'crm_case', record_id: 'c1' }],
      readable: { crm_case: ['c1'] },
    });
    expect((await read(mw)).where).toEqual({ object_name: 'crm_case', record_id: { $in: ['c1'] } });
  });

  it('a delegated caller: no leaf at all, the whole read is the probe, read with the caller’s envelope', async () => {
    const onBehalfOf = { userId: 'u_delegator' };
    const { mw, calls } = installClassifying({
      objects: ['crm_case', 'crm_deal'],
      scan: () => [{ object_name: 'crm_case', record_id: 'c1' }],
      readable: { crm_case: ['c1'] },
    });
    const { where } = await read(mw, { context: { userId: 'u_agent', onBehalfOf } as any });
    expect(where).toEqual({ object_name: 'crm_case', record_id: { $in: ['c1'] } });
    expect(calls.scans[0].where).toEqual({});
    expect(calls.probes[0].context).toMatchObject({ userId: 'u_agent', onBehalfOf });
  });

  it('no object-level admission (no canReadObject, or no security service): no leaf, the whole read is the probe, said once', async () => {
    // A leaf would then be admitted by explain(), which refuses the SYSTEM
    // re-read of this WHERE the withheld-update rule makes (gate module header).
    const sources: ParentObjectReadAdmissionSource[] = [
      () => undefined,
      () => ({}),
      () => {
        throw new Error("service 'security' not registered");
      },
    ];
    for (const admission of sources) {
      const logger = silentLogger();
      const { mw, calls } = installClassifying({
        objects: ['crm_case', 'crm_deal'],
        scan: () => [{ object_name: 'crm_case', record_id: 'c1' }],
        readable: { crm_case: ['c1'] },
        admission,
        logger,
      });
      expect((await read(mw)).where).toEqual({ object_name: 'crm_case', record_id: { $in: ['c1'] } });
      await read(mw);
      expect(calls.scans.map((s) => s.where)).toEqual([{}, {}]);
      const said = logger.warn.mock.calls.filter(([line]) => String(line).includes('answers no canReadObject()'));
      expect(said).toHaveLength(1);
    }
  });

  it('the probe’s cap warning names the class it was probing for', async () => {
    const logger = silentLogger();
    const rows = Array.from({ length: 2000 }, (_, i) => ({ object_name: 'sys_attachment', record_id: `f${i}` }));
    const { mw } = installClassifying({ objects: ['crm_case', 'sys_attachment'], middleware: ['sys_attachment'], scan: () => rows, logger });
    await read(mw);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('(object-middleware: sys_attachment) hit the 2000-row cap'));
  });

  it('a probe that fails denies the whole read, and says so', async () => {
    const logger = silentLogger();
    const { mw } = installClassifying({
      objects: ['crm_case', 'sys_attachment'],
      middleware: ['sys_attachment'],
      scan: () => {
        throw new Error('pre-scan exploded');
      },
      logger,
    });
    expect((await read(mw)).where).toEqual(DENY);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed, denying all'));
  });
});

describe('[ADR-0139 D3] the gate catches nothing the read itself raises', () => {
  it('a refusal the read raises after the gate hands it on reaches the caller unchanged', async () => {
    const { mw } = installClassifying({ objects: ['crm_case'] });
    const refusal = Object.assign(new Error('[driver-x] where.$or[0].record_id.$in holds a ReadableIds leaf'), {
      code: 'INTERNAL_ERROR',
      status: 500,
    });
    const ctx: CommentReadMiddlewareCtx = { object: 'sys_activity', operation: 'find', ast: { object: 'sys_activity' }, context: { userId: 'u1' } };
    await expect(mw(ctx, async () => {
      throw refusal;
    })).rejects.toBe(refusal);
  });

  it('a fault in deciding how to read the parents fails the read: it is never served as the deny-all sentinel', async () => {
    const registry = {
      getAllObjects: () => {
        throw new Error('registry exploded');
      },
    };
    const { mw } = installClassifying({ objects: [], registry });
    let ran = false;
    const ctx: CommentReadMiddlewareCtx = { object: 'sys_activity', operation: 'find', ast: { object: 'sys_activity' }, context: { userId: 'u1' } };
    await expect(mw(ctx, async () => {
      ran = true;
    })).rejects.toThrow('registry exploded');
    expect(ran).toBe(false);
    expect(ctx.ast?.where).toBeUndefined();
  });
});
