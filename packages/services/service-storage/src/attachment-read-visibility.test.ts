// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { installAttachmentReadVisibility } from './attachment-access-hooks.js';
import type { AttachmentLifecycleEngine, AttachmentReadMiddlewareCtx } from './attachment-lifecycle.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/**
 * Filter Protocol evaluator for the fake engine below — real `$and` / `$or` /
 * `$not` semantics, not a shape check.
 *
 * Mirrors `driver-memory`'s `memory-matcher.ts` and `formula`'s
 * `matches-filter.ts`: **every key inside one filter object ANDs**, a `$or`
 * array ORs its branches, and a branch's own contents still AND.
 *
 * This used to understand neither logical operators nor anything but `$in`,
 * so these tests could only assert the *shape* of the filter the middleware
 * emits, never the rows that filter selects. That is a poor bargain for a
 * predicate whose whole job is narrowing: `computeParentVisibilityFilter`
 * pairs a discriminator with an id list per branch, and any bug that widens
 * `$or` — the class #3774 fixed in the SQL compiler — turns that pairing into
 * something looser while leaving every shape assertion green. A fake that
 * silently under-implements the protocol cannot see a widening bug, so this
 * one implements it for real and **throws** on anything it does not, rather
 * than quietly matching.
 *
 * Values compare as strings on purpose: `computeParentVisibilityFilter`
 * stringifies every `parent_id` when it builds the `$in` list, so a numeric
 * row value still has to match its stringified filter value.
 */
function matchWhere(row: any, where: any): boolean {
  if (where === null || where === undefined) return true;
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new Error(`harness matcher: a filter must be an object, got ${JSON.stringify(where)}`);
  }
  // A filter object is the AND of every one of its entries.
  return Object.entries(where).every(([key, val]) => {
    if (key === '$and') {
      if (!Array.isArray(val)) throw new Error('harness matcher: $and expects an array');
      return val.every((branch) => matchWhere(row, branch));
    }
    if (key === '$or') {
      if (!Array.isArray(val)) throw new Error('harness matcher: $or expects an array');
      // Each branch is evaluated whole — the keys inside it still AND.
      return val.some((branch) => matchWhere(row, branch));
    }
    if (key === '$not') return !matchWhere(row, val);
    if (key.startsWith('$')) {
      throw new Error(`harness matcher: unsupported logical operator ${key}`);
    }
    return matchField(row[key], val);
  });
}

/** One `field: <spec>` entry. Multiple operators on the same field AND together. */
function matchField(actual: any, spec: any): boolean {
  if (spec === null || spec === undefined) return actual === null || actual === undefined;
  if (Array.isArray(spec)) {
    throw new Error('harness matcher: a bare array is not a field spec — use { $in: [...] }');
  }
  if (typeof spec !== 'object') return String(actual) === String(spec);
  return Object.entries(spec).every(([op, target]) => {
    switch (op) {
      case '$eq':
        return String(actual) === String(target);
      case '$ne':
        return String(actual) !== String(target);
      case '$in':
        return (target as unknown[]).map(String).includes(String(actual));
      case '$nin':
        return !(target as unknown[]).map(String).includes(String(actual));
      default:
        // Loud on purpose — an ignored operator is how the original blind spot happened.
        throw new Error(`harness matcher: unsupported operator ${op} — implement it, don't let it match silently`);
    }
  });
}

/**
 * Fake engine modelling: a sys_attachment table (system pre-scan) + a
 * per-parent-object visibility map keyed by userId. A parent find under a
 * caller context returns only the ids that user can see.
 */
function install(opts: {
  attachments: Array<{ parent_object: string; parent_id: string; id?: string }>;
  /** parentObject -> userId -> visible parent ids */
  visible: Record<string, Record<string, string[]>>;
}) {
  let mw!: (ctx: AttachmentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;
  const calls = {
    parentFinds: [] as Array<{ object: string; ids: string[]; userId?: string }>,
    /** [#7145] The context each parent probe was handed, verbatim. */
    parentFindContexts: [] as any[],
  };

  const engine: AttachmentLifecycleEngine = {
    registerHook: () => {},
    registerMiddleware: (fn) => {
      mw = fn as any;
    },
    find: async (object: string, options: any) => {
      if (object === 'sys_attachment') {
        // system candidate pre-scan
        const rows = opts.attachments.filter((r) => matchWhere(r, options?.where));
        return rows.slice(0, options?.limit ?? rows.length) as any;
      }
      // caller-scoped parent visibility probe
      const userId = options?.context?.userId as string | undefined;
      const ids: string[] = (options?.where?.id?.$in ?? []).map(String);
      calls.parentFinds.push({ object, ids, userId });
      calls.parentFindContexts.push(options?.context);
      const vis = opts.visible[object]?.[userId ?? ''] ?? [];
      return ids.filter((id) => vis.includes(id)).map((id) => ({ id })) as any;
    },
    findOne: async () => null,
    update: async () => ({}),
  };
  installAttachmentReadVisibility(engine, silentLogger());
  return {
    mw,
    calls,
    /**
     * Ids the given `where` actually selects from the fixture — i.e. what a
     * spec-conformant driver would return once the middleware has narrowed
     * the query. Asserting on this (not just on the filter's shape) is what
     * makes a widened scope visible.
     */
    selectIds: (where: unknown): string[] =>
      opts.attachments.filter((r) => matchWhere(r, where)).map((r) => String(r.id)),
  };
}

/** Drive a read op through the middleware and return the resulting where. */
async function runRead(
  mw: (ctx: AttachmentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>,
  ctxPartial: Partial<AttachmentReadMiddlewareCtx>,
) {
  const ctx: AttachmentReadMiddlewareCtx = {
    object: 'sys_attachment',
    operation: 'find',
    ast: { object: 'sys_attachment', where: undefined },
    context: { userId: 'u1' },
    ...ctxPartial,
  };
  let ran = false;
  await mw(ctx, async () => {
    ran = true;
  });
  return { where: ctx.ast?.where, ran };
}

describe('installAttachmentReadVisibility', () => {
  const dataset = {
    attachments: [
      { id: 'a1', parent_object: 'att_case', parent_id: 'c1' },
      { id: 'a2', parent_object: 'att_case', parent_id: 'c2' }, // invisible to u1
      { id: 'a3', parent_object: 'att_secret', parent_id: 's1' }, // invisible to u1
    ],
    visible: {
      att_case: { u1: ['c1'] }, // u1 sees only c1
      att_secret: { u1: [] }, // u1 sees no secrets
    },
  };

  it('constrains the query to only visible parents (single parent_object → bare clause)', async () => {
    const { mw } = install(dataset);
    const { where, ran } = await runRead(mw, {});
    expect(ran).toBe(true);
    // u1 sees att_case/c1 only; att_secret none → dropped.
    expect(where).toEqual({ parent_object: 'att_case', parent_id: { $in: ['c1'] } });
  });

  it('emits a $or across multiple visible parent objects', async () => {
    const { mw } = install({
      attachments: [
        { id: 'a1', parent_object: 'att_case', parent_id: 'c1' },
        { id: 'a2', parent_object: 'att_todo', parent_id: 't1' },
      ],
      visible: { att_case: { u1: ['c1'] }, att_todo: { u1: ['t1'] } },
    });
    const { where } = await runRead(mw, {});
    expect(where).toEqual({
      $or: [
        { parent_object: 'att_case', parent_id: { $in: ['c1'] } },
        { parent_object: 'att_todo', parent_id: { $in: ['t1'] } },
      ],
    });
  });

  it('the multi-parent $or admits only rows matching BOTH keys of one branch', async () => {
    // Each parent type has a visible and an invisible record, plus a row whose
    // parent_object belongs to one branch while its parent_id appears only in
    // the OTHER branch's id list. Nothing but a genuine per-branch AND excludes
    // all three, so this pins the pairing itself rather than the filter's shape.
    const { mw, selectIds } = install({
      attachments: [
        { id: 'a1', parent_object: 'att_case', parent_id: 'c1' }, // visible case
        { id: 'a2', parent_object: 'att_case', parent_id: 'c2' }, // case u1 cannot read
        { id: 'a3', parent_object: 'att_todo', parent_id: 't1' }, // visible todo
        { id: 'a4', parent_object: 'att_todo', parent_id: 't2' }, // todo u1 cannot read
        { id: 'a5', parent_object: 'att_case', parent_id: 't1' }, // object of branch 1, id of branch 2
      ],
      visible: { att_case: { u1: ['c1'] }, att_todo: { u1: ['t1'] } },
    });
    const { where } = await runRead(mw, {});

    expect(where).toEqual({
      $or: [
        { parent_object: 'att_case', parent_id: { $in: ['c1'] } },
        { parent_object: 'att_todo', parent_id: { $in: ['t1'] } },
      ],
    });
    // The rows that filter actually returns — a2/a4 (right parent type, wrong
    // id) and a5 (right type, an id borrowed from the sibling branch) are out.
    expect(selectIds(where)).toEqual(['a1', 'a3']);
  });

  it('denies all when no candidate parent is visible', async () => {
    const { mw } = install({
      attachments: [{ id: 'a3', parent_object: 'att_secret', parent_id: 's1' }],
      visible: { att_secret: { u1: [] } },
    });
    const { where } = await runRead(mw, {});
    expect(where).toEqual({ id: '__attachment_parent_denied__' });
  });

  it('ANDs the visibility filter onto an existing where (does not clobber it)', async () => {
    // The pre-scan honors the caller's where, so the candidate rows must
    // carry the filtered field for this fake to surface them.
    const { mw } = install({
      attachments: [
        { id: 'a1', parent_object: 'att_case', parent_id: 'c1', mime_type: 'application/pdf' } as any,
        { id: 'a2', parent_object: 'att_case', parent_id: 'c2', mime_type: 'text/plain' } as any,
      ],
      visible: { att_case: { u1: ['c1', 'c2'] } },
    });
    const existing = { mime_type: 'application/pdf' };
    const { where } = await runRead(mw, { ast: { object: 'sys_attachment', where: existing } });
    // Only a1 matched the pre-scan (mime_type), and its parent c1 is visible.
    expect(where).toEqual({
      $and: [existing, { parent_object: 'att_case', parent_id: { $in: ['c1'] } }],
    });
  });

  it('filters count() identically (list total cannot leak the unfiltered count)', async () => {
    const { mw } = install(dataset);
    const { where } = await runRead(mw, { operation: 'count' });
    expect(where).toEqual({ parent_object: 'att_case', parent_id: { $in: ['c1'] } });
  });

  it('bypasses system context and context-less reads (internal calls)', async () => {
    const { mw, calls } = install(dataset);
    const sys = await runRead(mw, { context: { isSystem: true } as any });
    expect(sys.where).toBeUndefined();
    const anon = await runRead(mw, { context: undefined });
    expect(anon.where).toBeUndefined();
    // no parent probes were issued for the bypassed reads
    expect(calls.parentFinds).toHaveLength(0);
  });

  it('does not touch write operations', async () => {
    const { mw } = install(dataset);
    const { where } = await runRead(mw, { operation: 'delete', ast: { object: 'sys_attachment', where: { id: 'a1' } } });
    expect(where).toEqual({ id: 'a1' }); // unchanged
  });

  it('leaves an already-empty result set alone (no candidates → no filter)', async () => {
    const { mw } = install({ attachments: [], visible: {} });
    const { where } = await runRead(mw, {});
    expect(where).toBeUndefined();
  });

  it('ignores self-referential (parent_object=sys_attachment) rows — prevents probe re-entry', async () => {
    const { mw, calls } = install({
      attachments: [{ id: 'a1', parent_object: 'sys_attachment', parent_id: 'a0' }],
      visible: {},
    });
    const { where } = await runRead(mw, {});
    // only a self-ref candidate → nothing to grant → deny all, and NO parent
    // probe was issued against sys_attachment.
    expect(where).toEqual({ id: '__attachment_parent_denied__' });
    expect(calls.parentFinds).toHaveLength(0);
  });

  // [#7145] The parent probe reads a DIFFERENT object than the one the security
  // middleware resolved its depth for, so the caller's envelope crosses over
  // but the operation-private keys must not: `__readScope` is
  // `sys_attachment`'s access DEPTH and `__expandRead` marks THAT read as an
  // expansion sub-read. Mirrors the same half of #7141 / PR #7143 in the comment kit.
  it('probes the parent with the caller ENVELOPE, minus the operation-private keys', async () => {
    const { mw, calls } = install(dataset);
    await runRead(mw, {
      context: {
        userId: 'u1',
        principalKind: 'agent',
        onBehalfOf: { userId: 'human_1', principalKind: 'human' },
        accessible_org_ids: ['org_1'],
        posture: 'authenticated',
        __readScope: 'org',
        __delegatorReadScope: 'org',
        __expandRead: true,
      } as any,
    });
    const probed = calls.parentFindContexts;
    expect(probed.length).toBeGreaterThan(0);
    for (const c of probed) {
      expect(c).toMatchObject({
        userId: 'u1',
        principalKind: 'agent',
        onBehalfOf: { userId: 'human_1', principalKind: 'human' },
        accessible_org_ids: ['org_1'],
        posture: 'authenticated',
      });
      for (const key of ['__readScope', '__delegatorReadScope', '__expandRead']) {
        expect(c).not.toHaveProperty(key);
      }
    }
  });
});

/**
 * Who tests the test double? The row assertions above are only worth as much
 * as the matcher evaluating them, so it gets the same 2x2 fixture and the same
 * expectations as the three production backends:
 * `driver-memory/memory-matcher-or-semantics.test.ts`,
 * `formula/matches-filter-or-semantics.test.ts`, and
 * `driver-sql/sql-driver-or-filter.test.ts`. If this harness ever drifts from
 * them, a read scope it declares safe would not be safe in the engine.
 */
describe('harness matcher — Filter Protocol $and/$or/$not semantics', () => {
  const ROWS = [
    { id: '1', a: 'x', b: 'y', c: 'z' },
    { id: '2', a: 'x', b: 'zz', c: 'z' },
    { id: '3', a: 'qq', b: 'y', c: 'z' },
    { id: '4', a: 'qq', b: 'zz', c: 'z' },
  ];
  const ids = (filter: any): string[] => ROWS.filter((r) => matchWhere(r, filter)).map((r) => r.id);

  it('ANDs the keys of a single multi-key branch', () => {
    expect(ids({ $or: [{ a: 'x', b: 'y' }] })).toEqual(['1']);
  });

  it('ANDs the keys of each branch independently', () => {
    expect(ids({ $or: [{ a: 'x', b: 'y' }, { a: 'qq', b: 'zz' }] })).toEqual(['1', '4']);
  });

  it('ANDs operator-object keys within a branch', () => {
    expect(ids({ $or: [{ a: { $eq: 'x' }, b: { $ne: 'zz' } }] })).toEqual(['1']);
  });

  it('ANDs keys inside a $or nested in a $or branch', () => {
    expect(ids({ $or: [{ $or: [{ a: 'x', b: 'zz' }] }] })).toEqual(['2']);
  });

  it('ANDs multiple operators on ONE field within a branch', () => {
    expect(ids({ $or: [{ a: { $ne: 'qq', $eq: 'x' }, b: 'y' }] })).toEqual(['1']);
  });

  it('OR-s a $and branch against a sibling multi-key branch', () => {
    expect(ids({ $or: [{ $and: [{ a: 'x' }, { b: 'y' }] }, { a: 'qq', b: 'zz' }] })).toEqual(['1', '4']);
  });

  it('ANDs a $and with a sibling key in the same branch, either order', () => {
    expect(ids({ $or: [{ c: 'nope' }, { $and: [{ a: 'qq' }], b: 'y' }] })).toEqual(['3']);
    expect(ids({ $or: [{ c: 'nope' }, { b: 'y', $and: [{ a: 'qq' }] }] })).toEqual(['3']);
  });

  it('keeps single-key $or branches as a plain OR', () => {
    expect(ids({ $or: [{ a: 'x' }, { b: 'y' }] })).toEqual(['1', '2', '3']);
  });

  it('ANDs a $or with a sibling top-level field key', () => {
    expect(ids({ $or: [{ a: 'x' }, { b: 'y' }], b: 'zz' })).toEqual(['2']);
  });

  it('negates with $not', () => {
    expect(ids({ $not: { a: 'x' } })).toEqual(['3', '4']);
  });

  it('tells a correctly paired scope apart from a widened one', () => {
    // The proof this matcher can go red: the same clauses, once AND-ed per
    // branch and once flattened to key-level ORs. If both returned the same
    // rows, every row assertion in this file would be decorative.
    const attachments = [
      { id: 'a1', parent_object: 'att_case', parent_id: 'c1' },
      { id: 'a2', parent_object: 'att_case', parent_id: 'c2' },
      { id: 'a3', parent_object: 'att_todo', parent_id: 't1' },
      { id: 'a4', parent_object: 'att_todo', parent_id: 't2' },
    ];
    const pick = (f: any) => attachments.filter((r) => matchWhere(r, f)).map((r) => r.id);

    const correct = {
      $or: [
        { parent_object: 'att_case', parent_id: { $in: ['c1'] } },
        { parent_object: 'att_todo', parent_id: { $in: ['t1'] } },
      ],
    };
    const widened = {
      $or: [
        { parent_object: 'att_case' },
        { parent_id: { $in: ['c1'] } },
        { parent_object: 'att_todo' },
        { parent_id: { $in: ['t1'] } },
      ],
    };
    expect(pick(correct)).toEqual(['a1', 'a3']);
    expect(pick(widened)).toEqual(['a1', 'a2', 'a3', 'a4']); // every row in the tenant
  });

  it('throws instead of silently ignoring an operator it does not implement', () => {
    // The original blind spot in one line: an unimplemented operator must not
    // quietly evaluate to a match.
    expect(() => ids({ a: { $gt: 'x' } })).toThrow(/unsupported operator \$gt/);
    expect(() => ids({ $nor: [{ a: 'x' }] })).toThrow(/unsupported logical operator \$nor/);
  });
});
