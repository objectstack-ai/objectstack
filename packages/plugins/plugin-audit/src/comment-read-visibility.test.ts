// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installCommentReadVisibility,
  type CommentAccessEngine,
  type CommentReadMiddlewareCtx,
} from './comment-access-hooks.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/**
 * Filter Protocol evaluator for the fake engine below — real `$and` / `$or` /
 * `$not` semantics, not a shape check. Same discipline (and the same
 * self-test at the bottom) as service-storage's
 * `attachment-read-visibility.test.ts`: a fake that silently under-implements
 * the protocol cannot see a WIDENING bug, so this one implements what it needs
 * and **throws** on anything it does not, rather than quietly matching.
 *
 * Values compare as strings on purpose: the middleware emits thread ids
 * verbatim, and a row's value has to match the filter's value exactly.
 */
function matchWhere(row: any, where: any): boolean {
  if (where === null || where === undefined) return true;
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new Error(`harness matcher: a filter must be an object, got ${JSON.stringify(where)}`);
  }
  return Object.entries(where).every(([key, val]) => {
    if (key === '$and') {
      if (!Array.isArray(val)) throw new Error('harness matcher: $and expects an array');
      return val.every((branch) => matchWhere(row, branch));
    }
    if (key === '$or') {
      if (!Array.isArray(val)) throw new Error('harness matcher: $or expects an array');
      return val.some((branch) => matchWhere(row, branch));
    }
    if (key === '$not') return !matchWhere(row, val);
    if (key.startsWith('$')) throw new Error(`harness matcher: unsupported logical operator ${key}`);
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
        throw new Error(`harness matcher: unsupported operator ${op} — implement it, don't let it match silently`);
    }
  });
}

/**
 * Fake engine modelling: a sys_comment table (system pre-scan) + a per-object
 * visibility map keyed by userId. A parent find under a caller context returns
 * only the ids that user can see — i.e. what the parent's OWD / sharing / RLS
 * / object-level CRUD would allow.
 */
function install(opts: {
  comments: Array<{ id?: string; thread_id: string } & Record<string, unknown>>;
  /** parentObject -> userId -> visible record ids */
  visible: Record<string, Record<string, string[]>>;
}) {
  let mw!: (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;
  const calls = {
    parentFinds: [] as Array<{ object: string; ids: string[]; userId?: string }>,
    /** [#7141] The context each parent probe was handed, verbatim. */
    parentFindContexts: [] as any[],
  };

  const engine: CommentAccessEngine = {
    registerHook: () => {},
    registerMiddleware: (fn) => {
      mw = fn as any;
    },
    find: async (object: string, options: any) => {
      if (object === 'sys_comment') {
        const rows = opts.comments.filter((r) => matchWhere(r, options?.where));
        return rows.slice(0, options?.limit ?? rows.length) as any;
      }
      const userId = options?.context?.userId as string | undefined;
      const ids: string[] = (options?.where?.id?.$in ?? []).map(String);
      calls.parentFinds.push({ object, ids, userId });
      calls.parentFindContexts.push(options?.context);
      const vis = opts.visible[object]?.[userId ?? ''] ?? [];
      return ids.filter((id) => vis.includes(id)).map((id) => ({ id })) as any;
    },
    findOne: async () => null,
  };
  installCommentReadVisibility(engine, silentLogger());
  return {
    mw,
    calls,
    /** Ids the given `where` actually selects from the fixture — i.e. what a
     * spec-conformant driver would return once the middleware has narrowed the
     * query. Asserting on this (not just the filter's shape) is what makes a
     * widened scope visible. */
    selectIds: (where: unknown): string[] =>
      opts.comments.filter((r) => matchWhere(r, where)).map((r) => String(r.id)),
  };
}

/** Drive a read op through the middleware and return the resulting where. */
async function runRead(
  mw: (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>,
  ctxPartial: Partial<CommentReadMiddlewareCtx>,
) {
  const ctx: CommentReadMiddlewareCtx = {
    object: 'sys_comment',
    operation: 'find',
    ast: { object: 'sys_comment', where: undefined },
    context: { userId: 'rep2' },
    ...ctxPartial,
  };
  let ran = false;
  await mw(ctx, async () => {
    ran = true;
  });
  return { where: ctx.ast?.where, ran };
}

describe('installCommentReadVisibility', () => {
  // The #4630 repro, as data: one comment on an opportunity rep2 cannot read,
  // one on a case rep2 can.
  const dataset = {
    comments: [
      { id: 'k1', thread_id: 'crm_opportunity:1A7nlQpfEhWxIaeX', body: 'Dogfood #602: kickoff call booked' },
      { id: 'k2', thread_id: 'crm_case:c1', body: 'visible' },
    ],
    visible: {
      crm_opportunity: { rep1: ['1A7nlQpfEhWxIaeX'], rep2: [], guest_portal: [] },
      crm_case: { rep1: ['c1'], rep2: ['c1'], guest_portal: [] },
    },
  };

  // #4630 body, repro 1: the leaked list must come back empty for rep2.
  it('excludes threads whose record the caller cannot read', async () => {
    const { mw, selectIds } = install(dataset);
    const { where, ran } = await runRead(mw, { context: { userId: 'rep2' } });
    expect(ran).toBe(true);
    expect(where).toEqual({ thread_id: { $in: ['crm_case:c1'] } });
    expect(selectIds(where)).toEqual(['k2']); // the opportunity comment is gone
  });

  it('keeps every thread a reader of both records can see', async () => {
    const { mw, selectIds } = install(dataset);
    const { where } = await runRead(mw, { context: { userId: 'rep1' } });
    expect(where).toEqual({ thread_id: { $in: ['crm_opportunity:1A7nlQpfEhWxIaeX', 'crm_case:c1'] } });
    expect(selectIds(where)).toEqual(['k1', 'k2']);
  });

  // #4630 body, repro 3: an INSERT-only permission set that "reads nothing".
  it('denies all for a principal who can read no record at all (guest_portal)', async () => {
    const { mw, selectIds } = install(dataset);
    const { where } = await runRead(mw, { context: { userId: 'guest_portal' } });
    expect(where).toEqual({ id: '__comment_thread_denied__' });
    expect(selectIds(where)).toEqual([]);
  });

  it('scoping the query to one unreadable thread still returns nothing', async () => {
    const { mw, selectIds } = install(dataset);
    const scoped = { thread_id: 'crm_opportunity:1A7nlQpfEhWxIaeX' };
    const { where } = await runRead(mw, {
      context: { userId: 'rep2' },
      ast: { object: 'sys_comment', where: scoped },
    });
    expect(where).toEqual({ $and: [scoped, { id: '__comment_thread_denied__' }] });
    expect(selectIds(where)).toEqual([]);
  });

  it('ANDs the visibility filter onto an existing where (does not clobber it)', async () => {
    const { mw, selectIds } = install(dataset);
    const existing = { thread_id: 'crm_case:c1' };
    const { where } = await runRead(mw, {
      context: { userId: 'rep2' },
      ast: { object: 'sys_comment', where: existing },
    });
    expect(where).toEqual({ $and: [existing, { thread_id: { $in: ['crm_case:c1'] } }] });
    expect(selectIds(where)).toEqual(['k2']);
  });

  it('filters count() identically (list total cannot leak the unfiltered count)', async () => {
    const { mw } = install(dataset);
    const { where } = await runRead(mw, { operation: 'count', context: { userId: 'rep2' } });
    expect(where).toEqual({ thread_id: { $in: ['crm_case:c1'] } });
  });

  it('bypasses system context and context-less reads (internal calls)', async () => {
    const { mw, calls } = install(dataset);
    const sys = await runRead(mw, { context: { isSystem: true } as any });
    expect(sys.where).toBeUndefined();
    const anon = await runRead(mw, { context: undefined });
    expect(anon.where).toBeUndefined();
    expect(calls.parentFinds).toHaveLength(0);
  });

  // [#7141] The parent probe reads a DIFFERENT object than the one the security
  // middleware resolved its depth for, so the caller's envelope crosses over
  // but the operation-private keys must not: `__readScope` is `sys_comment`'s
  // access DEPTH and `__expandRead` waives the object-level CRUD check.
  it('probes the parent with the caller ENVELOPE, minus the operation-private keys', async () => {
    const { mw, calls } = install(dataset);
    await runRead(mw, {
      context: {
        userId: 'rep2',
        principalKind: 'agent',
        onBehalfOf: { userId: 'human_1', principalKind: 'human' },
        accessible_org_ids: ['org_1'],
        __readScope: 'org',
        __delegatorReadScope: 'org',
        __expandRead: true,
      } as any,
    });
    const probed = calls.parentFindContexts;
    expect(probed.length).toBeGreaterThan(0);
    for (const c of probed) {
      expect(c).toMatchObject({
        userId: 'rep2',
        principalKind: 'agent',
        onBehalfOf: { userId: 'human_1', principalKind: 'human' },
        accessible_org_ids: ['org_1'],
      });
      for (const key of ['__readScope', '__delegatorReadScope', '__expandRead']) {
        expect(c).not.toHaveProperty(key);
      }
    }
  });

  it('does not touch write operations (the hooks gate those)', async () => {
    const { mw } = install(dataset);
    const { where } = await runRead(mw, {
      operation: 'delete',
      ast: { object: 'sys_comment', where: { id: 'k1' } },
    });
    expect(where).toEqual({ id: 'k1' }); // unchanged
  });

  it('leaves an already-empty result set alone (no candidates → no filter)', async () => {
    const { mw } = install({ comments: [], visible: {} });
    const { where } = await runRead(mw, {});
    expect(where).toBeUndefined();
  });

  it('hides threads that name no record — dangling, free-form, or self-referential', async () => {
    const { mw, calls } = install({
      comments: [
        { id: 'd1', thread_id: 'crm_opportunity:' }, // #4630's dangling id
        { id: 'd2', thread_id: 'watercooler' }, // free-form
        { id: 'd3', thread_id: 'sys_comment:c1' }, // would re-enter this middleware
      ],
      visible: {},
    });
    const { where } = await runRead(mw, {});
    expect(where).toEqual({ id: '__comment_thread_denied__' });
    // no probe was issued for any of them — in particular none against sys_comment
    expect(calls.parentFinds).toHaveLength(0);
  });

  it('probes each parent object once with the deduped id set', async () => {
    const { mw, calls } = install({
      comments: [
        { id: 'x1', thread_id: 'crm_case:c1' },
        { id: 'x2', thread_id: 'crm_case:c1' }, // same thread twice
        { id: 'x3', thread_id: 'crm_case:c2' },
      ],
      visible: { crm_case: { rep2: ['c1'] } },
    });
    const { where } = await runRead(mw, {});
    expect(calls.parentFinds).toEqual([{ object: 'crm_case', ids: ['c1', 'c2'], userId: 'rep2' }]);
    expect(where).toEqual({ thread_id: { $in: ['crm_case:c1'] } });
  });

  it('fails CLOSED when the parent probe throws (deny-all, never a fall-open)', async () => {
    let mw!: (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;
    const engine: CommentAccessEngine = {
      registerHook: () => {},
      registerMiddleware: (fn) => {
        mw = fn as any;
      },
      find: async (object: string) => {
        if (object === 'sys_comment') return [{ id: 'k1', thread_id: 'crm_case:c1' }] as any;
        throw new Error('sharing service exploded');
      },
      findOne: async () => null,
    };
    installCommentReadVisibility(engine, silentLogger());
    const { where } = await runRead(mw, {});
    expect(where).toEqual({ id: '__comment_thread_denied__' });
  });

  it('fails CLOSED (and warns) when the whole filter computation throws', async () => {
    const logger = silentLogger();
    let mw!: (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;
    const engine: CommentAccessEngine = {
      registerHook: () => {},
      registerMiddleware: (fn) => {
        mw = fn as any;
      },
      find: async () => {
        throw new Error('pre-scan exploded');
      },
      findOne: async () => null,
    };
    installCommentReadVisibility(engine, logger);
    const { where, ran } = await runRead(mw, {});
    expect(where).toEqual({ id: '__comment_thread_denied__' });
    expect(ran).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('denying all'));
  });

  it('is inert on an engine without the middleware seam (no throw)', async () => {
    const engine: CommentAccessEngine = {
      registerHook: () => {},
      find: async () => [],
      findOne: async () => null,
    };
    expect(() => installCommentReadVisibility(engine, silentLogger())).not.toThrow();
  });
});

/**
 * Who tests the test double? The row assertions above are only worth as much
 * as the matcher evaluating them, so it gets the same self-test as its
 * service-storage twin: a correctly scoped filter and a widened one must
 * select DIFFERENT rows, or every assertion in this file is decorative.
 */
describe('harness matcher — Filter Protocol semantics', () => {
  const comments = [
    { id: 'k1', thread_id: 'crm_opportunity:o1' },
    { id: 'k2', thread_id: 'crm_case:c1' },
  ];
  const pick = (f: any) => comments.filter((r) => matchWhere(r, f)).map((r) => r.id);

  it('tells a correctly scoped $in apart from an absent one', () => {
    expect(pick({ thread_id: { $in: ['crm_case:c1'] } })).toEqual(['k2']);
    expect(pick({})).toEqual(['k1', 'k2']);
  });

  it('ANDs an outer where with the injected filter', () => {
    expect(pick({ $and: [{ thread_id: 'crm_opportunity:o1' }, { thread_id: { $in: ['crm_case:c1'] } }] })).toEqual([]);
  });

  it('throws instead of silently ignoring an operator it does not implement', () => {
    expect(() => pick({ thread_id: { $gt: 'x' } })).toThrow(/unsupported operator \$gt/);
    expect(() => pick({ $nor: [{ thread_id: 'x' }] })).toThrow(/unsupported logical operator \$nor/);
  });
});
