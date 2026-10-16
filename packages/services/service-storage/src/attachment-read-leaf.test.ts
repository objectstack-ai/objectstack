// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 E7, D4, D5] The `sys_attachment` read gate's choice between a
 * `ReadableIds` leaf and the bounded probe, per parent object, decided before
 * any branch is written — against a stand-in engine that answers the three
 * classifying questions (`registry.getAllObjects`, `hasObjectMiddleware`,
 * `resolveEffectiveDatasource`) and records every read the gate makes.
 *
 * What a leaf SELECTS is the engine's and the driver's (composition and the
 * subquery), so it is measured on a real engine and driver in
 * `attachment-read-leaf.integration.test.ts`; this file pins which branch each
 * parent gets, that a leaf costs no read at all, and the probe states.
 */

import { describe, it, expect, vi } from 'vitest';
import { isReadableIds } from '@objectstack/spec/data';
import { installAttachmentReadVisibility } from './attachment-access-hooks.js';
import type { AttachmentReadMiddlewareCtx } from './attachment-lifecycle.js';

type Mw = (ctx: AttachmentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;
type Row = { id: string; parent_object: string; parent_id: string };

const DENY_ALL = { id: '__attachment_parent_denied__' };

function recordingLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

/** Filter Protocol subset the probe's pre-scan uses: AND of keys, `$and`, `$in`, equality. */
function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, val]: [string, any]) => {
    if (key === '$and') return (val as any[]).every((w) => matches(row, w));
    if (key === '$or') return (val as any[]).some((w) => matches(row, w));
    if (val && typeof val === 'object' && Array.isArray(val.$in)) return val.$in.map(String).includes(String(row[key]));
    return String(row[key]) === String(val);
  });
}

function boot(fixture: {
  rows?: Row[];
  objects?: string[];
  /** Parents an object-scoped read middleware narrows (D5.2). */
  middlewareGated?: string[];
  /** Parent → its datasource (D5.3); absent rides the default driver. */
  datasources?: Record<string, string>;
  /** parent object → visible ids for any caller. */
  visible?: Record<string, string[]>;
  /** What the security source answers; `'throws'` = no service composed. */
  admission?: 'can-read-object' | 'explain-only' | 'none' | 'throws' | 'omitted';
  /** Drop one classifying question from the engine. */
  engineLacks?: 'registry' | 'hasObjectMiddleware' | 'resolveEffectiveDatasource';
  failPreScan?: boolean;
}) {
  const rows = fixture.rows ?? [];
  const objects = fixture.objects ?? ['att_case', 'att_secret', 'sys_attachment', 'sys_comment'];
  const gated = new Set(fixture.middlewareGated ?? []);
  const reads = { preScans: [] as any[], parentReads: [] as Array<{ object: string; ids: string[] }> };
  let mw!: Mw;
  // Only the members the read gate calls: `find` (its probe) and the three
  // classifying questions. The write verbs are not part of this gate.
  const engine: any = {
    registerHook: () => {},
    registerMiddleware: (fn: Mw) => {
      mw = fn;
    },
    find: async (object: string, query: any) => {
      if (object === 'sys_attachment') {
        reads.preScans.push(query);
        if (fixture.failPreScan === true) throw new Error('driver down');
        const hits = rows.filter((r) => matches(r, query?.where));
        return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
      }
      const ids: string[] = (query?.where?.id?.$in ?? []).map(String);
      reads.parentReads.push({ object, ids });
      const visible = ids.filter((id) => (fixture.visible?.[object] ?? []).includes(id)).map((id) => ({ id }));
      return typeof query?.limit === 'number' ? visible.slice(0, query.limit) : visible;
    },
    registry: { getAllObjects: () => objects.map((name) => ({ name })) },
    hasObjectMiddleware: (name: string) => gated.has(name),
    resolveEffectiveDatasource: (name: string) => fixture.datasources?.[name],
  };
  if (fixture.engineLacks === 'registry') delete engine.registry;
  if (fixture.engineLacks === 'hasObjectMiddleware') delete engine.hasObjectMiddleware;
  if (fixture.engineLacks === 'resolveEffectiveDatasource') delete engine.resolveEffectiveDatasource;

  const admission = fixture.admission ?? 'can-read-object';
  const getAdmission =
    admission === 'omitted'
      ? undefined
      : () => {
          if (admission === 'throws') throw new Error("service 'security' not found");
          if (admission === 'none') return undefined;
          if (admission === 'explain-only') return { explain: async () => ({ allowed: true }) } as any;
          return { canReadObject: async () => true };
        };
  const logger = recordingLogger();
  installAttachmentReadVisibility(engine, logger, getAdmission);
  return { mw, reads, logger };
}

async function read(mw: Mw, partial: Partial<AttachmentReadMiddlewareCtx> = {}, next?: () => Promise<void>) {
  const ctx: AttachmentReadMiddlewareCtx = {
    object: 'sys_attachment',
    operation: 'find',
    ast: { object: 'sys_attachment', where: undefined },
    context: { userId: 'u1' },
    ...partial,
  };
  await mw(ctx, next ?? (async () => {}));
  return ctx.ast?.where as any;
}

/** The branches of an emitted WHERE: its `$or`, or the one branch. */
const branchesOf = (where: any): any[] => (where?.$or ? where.$or : [where]);
const leafBranches = (where: any) => branchesOf(where).filter((b) => isReadableIds(b?.parent_id?.$in));
const literalBranches = (where: any) => branchesOf(where).filter((b) => Array.isArray(b?.parent_id?.$in));

describe('[ADR-0139 D4] the attachment read gate writes one ReadableIds leaf per parent object', () => {
  it('one leaf per registered parent object, over the row’s own pointer pair, and no read at all', async () => {
    const { mw, reads } = boot({});
    const where = await read(mw);
    expect(where.$or).toHaveLength(3);
    for (const [i, parent] of ['att_case', 'att_secret', 'sys_comment'].entries()) {
      const branch = where.$or[i];
      expect(Object.keys(branch).sort()).toEqual(['parent_id', 'parent_object']);
      expect(branch.parent_object).toBe(parent);
      expect(isReadableIds(branch.parent_id.$in)).toBe(true);
      expect(branch.parent_id.$in.object).toBe(parent);
    }
    // No pre-scan, no caller-scoped parent read: the engine composes the leaf.
    expect(reads.preScans).toHaveLength(0);
    expect(reads.parentReads).toHaveLength(0);
  });

  it('sys_attachment is never a parent of its own rows', async () => {
    const { mw } = boot({});
    const where = await read(mw);
    expect(branchesOf(where).map((b) => b.parent_object)).not.toContain('sys_attachment');
  });

  it('a single parent object is a bare branch, ANDed onto the caller’s own where', async () => {
    const { mw } = boot({ objects: ['att_case', 'sys_attachment'] });
    const own = { mime_type: 'application/pdf' };
    const where = await read(mw, { ast: { object: 'sys_attachment', where: own } });
    expect(where.$and[0]).toBe(own);
    expect(where.$and[1].parent_object).toBe('att_case');
    expect(isReadableIds(where.$and[1].parent_id.$in)).toBe(true);
  });

  it('a list and its total get the same WHERE', async () => {
    const { mw } = boot({});
    const list = JSON.stringify(branchesOf(await read(mw)).map((b) => [b.parent_object, b.parent_id.$in.object]));
    const total = JSON.stringify(
      branchesOf(await read(mw, { operation: 'count' })).map((b) => [b.parent_object, b.parent_id.$in.object]),
    );
    expect(total).toBe(list);
  });

  it('a registry holding no parent object leaves deny-all, never an unfiltered read', async () => {
    const { mw } = boot({ objects: ['sys_attachment'] });
    expect(await read(mw)).toEqual(DENY_ALL);
  });
});

describe('[ADR-0139 D5] three classes keep the bounded probe, chosen before any leaf is written', () => {
  const rows: Row[] = [
    { id: 'a1', parent_object: 'sys_comment', parent_id: 'c1' },
    { id: 'a2', parent_object: 'sys_comment', parent_id: 'c2' },
    { id: 'a3', parent_object: 'att_far', parent_id: 'f1' },
    { id: 'a4', parent_object: 'att_case', parent_id: 'k1' },
  ];

  it('D5.2: a parent an object-scoped read middleware narrows is probed, its pre-scan restricted to its rows', async () => {
    const { mw, reads } = boot({ rows, middlewareGated: ['sys_comment'], visible: { sys_comment: ['c1'] } });
    const where = await read(mw);
    expect(leafBranches(where).map((b) => b.parent_object)).toEqual(['att_case', 'att_secret']);
    expect(literalBranches(where)).toEqual([{ parent_object: 'sys_comment', parent_id: { $in: ['c1'] } }]);
    expect(reads.preScans).toHaveLength(1);
    expect(reads.preScans[0].where).toEqual({ parent_object: { $in: ['sys_comment'] } });
    expect(reads.preScans[0].limit).toBe(2_000);
    expect(reads.preScans[0].context).toEqual({ isSystem: true });
    expect(reads.parentReads).toEqual([{ object: 'sys_comment', ids: ['c1', 'c2'] }]);
  });

  it('D5.3: a parent bound to another datasource is probed beside the leaves', async () => {
    const { mw, reads } = boot({
      rows,
      objects: ['att_case', 'att_far', 'sys_attachment'],
      datasources: { att_far: 'warehouse' },
      visible: { att_far: ['f1'] },
    });
    const where = await read(mw);
    expect(leafBranches(where).map((b) => b.parent_object)).toEqual(['att_case']);
    expect(literalBranches(where)).toEqual([{ parent_object: 'att_far', parent_id: { $in: ['f1'] } }]);
    expect(reads.preScans[0].where).toEqual({ parent_object: { $in: ['att_far'] } });
  });

  it('D5.3: sys_attachment on its own datasource makes every default-driver parent federated', async () => {
    const { mw } = boot({ rows, objects: ['att_case', 'sys_attachment'], datasources: { sys_attachment: 'files' }, visible: { att_case: ['k1'] } });
    const where = await read(mw);
    expect(leafBranches(where)).toEqual([]);
    expect(where).toEqual({ parent_object: 'att_case', parent_id: { $in: ['k1'] } });
  });

  it('the restricted probe keeps the caller’s own where in its pre-scan', async () => {
    const { mw, reads } = boot({ rows, middlewareGated: ['sys_comment'], visible: { sys_comment: ['c1', 'c2'] } });
    const own = { file_name: 'x.txt' };
    await read(mw, { ast: { object: 'sys_attachment', where: own } });
    expect(reads.preScans[0].where).toEqual({ $and: [own, { parent_object: { $in: ['sys_comment'] } }] });
  });

  it('D5.1: a delegated caller reads through the whole-read probe — no leaf at all', async () => {
    const { mw, reads } = boot({ rows, visible: { att_case: ['k1'], sys_comment: ['c2'] } });
    const where = await read(mw, { context: { userId: 'agent_1', onBehalfOf: { userId: 'u1' } } as any });
    expect(leafBranches(where)).toEqual([]);
    expect(where).toEqual({
      $or: [
        { parent_object: 'sys_comment', parent_id: { $in: ['c2'] } },
        { parent_object: 'att_case', parent_id: { $in: ['k1'] } },
      ],
    });
    // The whole read's window: the caller's where, unrestricted.
    expect(reads.preScans[0].where).toEqual({});
  });

  it('a restricted probe that throws denies the whole read and says so — the leaves are not served alone', async () => {
    const { mw, logger } = boot({ rows, middlewareGated: ['sys_comment'], failPreScan: true });
    expect(await read(mw)).toEqual(DENY_ALL);
    expect(logger.warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /bounded probe \(object-middleware: sys_comment\) failed, denying all \(driver down\)/,
    );
  });

  it('a probe past the bound says which class it was', async () => {
    const many: Row[] = Array.from({ length: 2_000 }, (_u, i) => ({ id: `g${i}`, parent_object: 'sys_comment', parent_id: `c${i}` }));
    const { mw, logger } = boot({ rows: many, middlewareGated: ['sys_comment'], visible: { sys_comment: ['c1'] } });
    await read(mw);
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((l) => l.includes('(object-middleware: sys_comment) hit the 2000-row cap') && l.includes('fail-closed'))).toBe(true);
  });
});

describe('[ADR-0139 E5’s guard] no leaf without canReadObject; an engine that cannot classify probes', () => {
  const rows: Row[] = [{ id: 'a4', parent_object: 'att_case', parent_id: 'k1' }];

  for (const admission of ['explain-only', 'none', 'throws', 'omitted'] as const) {
    it(`security source ${admission}: the whole read is the probe, said once for the engine`, async () => {
      const { mw, logger, reads } = boot({ rows, admission, visible: { att_case: ['k1'] } });
      expect(await read(mw)).toEqual({ parent_object: 'att_case', parent_id: { $in: ['k1'] } });
      await read(mw);
      expect(reads.preScans).toHaveLength(2);
      const said = logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('answers no canReadObject()'));
      expect(said).toHaveLength(1);
    });
  }

  for (const lacks of ['registry', 'hasObjectMiddleware', 'resolveEffectiveDatasource'] as const) {
    it(`an engine without ${lacks} cannot classify: the whole read is the probe, said once`, async () => {
      const { mw, logger } = boot({ rows, engineLacks: lacks, visible: { att_case: ['k1'] } });
      expect(await read(mw)).toEqual({ parent_object: 'att_case', parent_id: { $in: ['k1'] } });
      await read(mw);
      const said = logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('cannot say which parent objects'));
      expect(said).toHaveLength(1);
    });
  }
});

describe('[ADR-0139 D3] the read’s own refusal reaches the caller', () => {
  it('a refusal raised by next() (the composition, the driver) propagates — the WHERE keeps its leaves', async () => {
    const { mw } = boot({});
    const refusal = Object.assign(new Error('[driver-mongodb] compiles no ReadableIds leaf'), { code: 'INTERNAL_ERROR', status: 500 });
    const ctx: AttachmentReadMiddlewareCtx = {
      object: 'sys_attachment',
      operation: 'find',
      ast: { object: 'sys_attachment', where: undefined },
      context: { userId: 'u1' },
    };
    await expect(
      mw(ctx, async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(ctx.ast?.where).not.toEqual(DENY_ALL);
    expect(leafBranches(ctx.ast?.where)).toHaveLength(3);
  });
});
