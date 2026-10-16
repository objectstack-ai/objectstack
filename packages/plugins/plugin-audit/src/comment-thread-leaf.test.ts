// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 E7] The comment-thread gate's choice between a `ReadableIds` leaf
 * and the bounded probe, per parent object and up front, and the parent pair's
 * stamp — against a stand-in engine that records every read, so "no pre-scan"
 * and "no leaf" are assertions about calls, not about shapes alone. The real
 * engine composing and evaluating the leaf is
 * `comment-parent-pair.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadableIds } from '@objectstack/spec/data';
import {
  installCommentAccessHooks,
  installCommentReadVisibility,
  planCommentParentPair,
  type CommentReadMiddlewareCtx,
} from './comment-access-hooks.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const PAIR_FIELDS = { thread_id: {}, body: {}, object_name: {}, record_id: {} };

type Mw = (ctx: CommentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>;

/** A stand-in engine: one registry, the D5 questions answered by name, every find recorded. */
function standIn(opts: {
  objects?: string[];
  middleware?: string[];
  federated?: string[];
  declaresPair?: boolean;
  classify?: boolean;
  /** comments as stored (system pre-scan) */
  comments?: Array<Record<string, unknown>>;
  /** parent object → readable ids for the caller */
  readable?: Record<string, string[]>;
  findThrows?: boolean;
}) {
  const finds: Array<{ object: string; options: any }> = [];
  let mw!: Mw;
  const engine: any = {
    registerHook: () => {},
    registerMiddleware: (fn: Mw) => {
      mw = fn;
    },
    getSchema: (object: string) =>
      object === 'sys_comment'
        ? { name: 'sys_comment', fields: opts.declaresPair === false ? { thread_id: {}, body: {} } : PAIR_FIELDS }
        : undefined,
    find: async (object: string, options: any) => {
      finds.push({ object, options });
      const rows =
        object === 'sys_comment'
          ? (opts.comments ?? []).filter((r) => r.object_name == null)
          : ((options?.where?.id?.$in ?? []) as unknown[])
              .map(String)
              .filter((id) => (opts.readable?.[object] ?? []).includes(id))
              .map((id) => ({ id }));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
  };
  if (opts.findThrows) {
    engine.find = async (object: string, options: any) => {
      finds.push({ object, options });
      throw new Error('pre-scan exploded');
    };
  }
  if (opts.classify !== false) {
    engine.registry = { getAllObjects: () => (opts.objects ?? ['crm_case', 'sys_comment']).map((name) => ({ name })) };
    engine.hasObjectMiddleware = (object: string) => (opts.middleware ?? []).includes(object);
    engine.resolveEffectiveDatasource = (object: string) => ((opts.federated ?? []).includes(object) ? 'warehouse' : undefined);
  }
  return { engine, finds, mw: () => mw };
}

async function read(mw: Mw, context: Record<string, unknown> = { userId: 'u1' }, where?: unknown) {
  const ctx: CommentReadMiddlewareCtx = { object: 'sys_comment', operation: 'find', ast: { object: 'sys_comment', where }, context: context as any };
  let ran = false;
  await mw(ctx, async () => {
    ran = true;
  });
  return { where: ctx.ast?.where as any, ran };
}

const admission = { canReadObject: async () => true };
const leavesOf = (where: any): string[] =>
  (where?.$or ?? [where]).filter((b: any) => b?.record_id?.$in && !Array.isArray(b.record_id.$in)).map((b: any) => b.object_name);

describe('[ADR-0139 E7] the comment-thread gate: a leaf per parent object, the probe by name', () => {
  it('writes one ReadableIds leaf per parent object and pre-scans no stamped row', async () => {
    const s = standIn({ objects: ['crm_case', 'crm_deal', 'sys_comment', 'sys_session'] });
    installCommentReadVisibility(s.engine, silentLogger(), () => admission);
    const { where, ran } = await read(s.mw());
    expect(ran).toBe(true);
    // Every registered object but sys_comment, the audit writer's exclusions included.
    expect(where).toEqual({
      $or: ['crm_case', 'crm_deal', 'sys_session'].map((p) => ({ object_name: p, record_id: { $in: ReadableIds.of(p) } })),
    });
    // The only read is the probe of rows with no stamped pair.
    expect(s.finds).toHaveLength(1);
    expect(s.finds[0]).toMatchObject({ object: 'sys_comment', options: { where: { object_name: { $null: true } }, context: { isSystem: true } } });
  });

  it('ORs the bounded thread probe for rows with no stamped pair — a literal list, never a leaf', async () => {
    const s = standIn({
      comments: [
        { id: 'k1', thread_id: 'crm_case:c1', object_name: null },
        { id: 'k2', thread_id: 'crm_case:c2', object_name: null },
        { id: 'k3', thread_id: 'watercooler', object_name: null },
      ],
      readable: { crm_case: ['c1'] },
    });
    installCommentReadVisibility(s.engine, silentLogger(), () => admission);
    const { where } = await read(s.mw(), { userId: 'u1' }, { body: 'x' });
    expect(where).toEqual({
      $and: [
        { body: 'x' },
        {
          $or: [
            { object_name: 'crm_case', record_id: { $in: ReadableIds.of('crm_case') } },
            { object_name: { $null: true }, thread_id: { $in: ['crm_case:c1'] } },
          ],
        },
      ],
    });
    expect(s.finds[0].options.where).toEqual({ $and: [{ body: 'x' }, { object_name: { $null: true } }] });
  });

  it('D5.2 and D5.3: a middleware-gated parent and a federated parent are probed over the pair, beside the leaves', async () => {
    const s = standIn({ objects: ['crm_case', 'sys_attachment', 'far_obj'], middleware: ['sys_attachment'], federated: ['far_obj'] });
    installCommentReadVisibility(s.engine, silentLogger(), () => admission);
    const { where } = await read(s.mw());
    expect(leavesOf(where)).toEqual(['crm_case']);
    const pairProbe = s.finds.find((f) => JSON.stringify(f.options.where).includes('"object_name":{"$in"'));
    expect(pairProbe?.options.where).toEqual({ object_name: { $in: ['far_obj', 'sys_attachment'] } });
    expect(pairProbe?.options.fields).toEqual(['object_name', 'record_id']);
  });

  it('D5.1: a delegated caller writes no leaf — the whole read is the probe', async () => {
    const s = standIn({ objects: ['crm_case'] });
    installCommentReadVisibility(s.engine, silentLogger(), () => admission);
    const { where } = await read(s.mw(), { userId: 'u1', onBehalfOf: { userId: 'u0' } });
    expect(leavesOf(where)).toEqual([]);
    expect(where).toEqual({ id: '__comment_thread_denied__' });
  });

  it('no leaf without canReadObject: the whole read is the probe, said once', async () => {
    for (const source of [undefined, () => ({}) as any, () => { throw new Error('no slot'); }]) {
      const logger = silentLogger();
      const s = standIn({ objects: ['crm_case'] });
      installCommentReadVisibility(s.engine, logger, source as any);
      expect(leavesOf((await read(s.mw())).where)).toEqual([]);
      await read(s.mw());
      expect(logger.warn.mock.calls.filter(([m]) => String(m).includes('canReadObject'))).toHaveLength(1);
    }
  });

  it('an engine that cannot classify writes no leaf — the whole read is the probe, said once', async () => {
    const logger = silentLogger();
    const s = standIn({ classify: false });
    installCommentReadVisibility(s.engine, logger, () => admission);
    expect(leavesOf((await read(s.mw())).where)).toEqual([]);
    await read(s.mw());
    expect(logger.warn.mock.calls.filter(([m]) => String(m).includes('hasObjectMiddleware'))).toHaveLength(1);
  });

  it('a sys_comment that declares no pair is read by the thread probe over every row, said once', async () => {
    const logger = silentLogger();
    const s = standIn({ declaresPair: false, comments: [{ id: 'k1', thread_id: 'crm_case:c1' }], readable: { crm_case: ['c1'] } });
    installCommentReadVisibility(s.engine, logger, () => admission);
    expect((await read(s.mw())).where).toEqual({ thread_id: { $in: ['crm_case:c1'] } });
    await read(s.mw());
    expect(s.finds[0].options.where).toEqual({});
    expect(logger.warn.mock.calls.filter(([m]) => String(m).includes('declares no object_name'))).toHaveLength(1);
  });

  it('a probe that throws denies the whole read (fail closed) and says so', async () => {
    const logger = silentLogger();
    const s = standIn({ findThrows: true });
    installCommentReadVisibility(s.engine, logger, () => admission);
    expect((await read(s.mw())).where).toEqual({ id: '__comment_thread_denied__' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('denying all'));
  });

  it('[ADR-0139 D3] the consumer catches nothing: a refusal raised by the read itself reaches the caller', async () => {
    const s = standIn({});
    installCommentReadVisibility(s.engine, silentLogger(), () => admission);
    const refusal = Object.assign(new Error('[driver-x] cannot compile ReadableIds'), { code: 'INTERNAL_ERROR', status: 500 });
    const ctx: CommentReadMiddlewareCtx = { object: 'sys_comment', operation: 'count', ast: { object: 'sys_comment' }, context: { userId: 'u1' } };
    await expect(s.mw()(ctx, async () => { throw refusal; })).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    expect(ctx.ast?.where).not.toEqual({ id: '__comment_thread_denied__' });
  });
});

describe('[ADR-0139 E7] the parent pair: one planner, stamped on create and on the re-point rule', () => {
  it('plans the pair from the thread, by the parse every gate authorizes by', () => {
    expect(planCommentParentPair('crm_case:a:b')).toEqual({ object_name: 'crm_case', record_id: 'a:b' });
    for (const none of ['crm_case:', 'watercooler', 'sys_comment:c1', 'Bad:x', undefined, 42]) {
      expect(planCommentParentPair(none), String(none)).toEqual({ object_name: null, record_id: null });
    }
  });

  function hooks(declaresPair = true) {
    const registered: Array<{ event: string; handler: (ctx: any) => any }> = [];
    const engine: any = {
      registerHook: (event: string, handler: (ctx: any) => any, options: any) => {
        if (options?.object === 'sys_comment') registered.push({ event, handler });
      },
      getSchema: () => ({ fields: declaresPair ? PAIR_FIELDS : { thread_id: {} } }),
    };
    installCommentAccessHooks(engine, () => null, silentLogger());
    // The stamp is the one handler that exempts no caller: drive every handler as the system.
    const run = async (event: string, data: unknown) => {
      for (const h of registered.filter((r) => r.event === event)) {
        await h.handler({ object: 'sys_comment', event, input: { data, options: {} }, session: { isSystem: true }, previous: { body: 'b' } });
      }
      return data;
    };
    return run;
  }

  it('create: every row is stamped over whatever the writer sent, a single row and a batch', async () => {
    const run = hooks();
    expect(await run('beforeInsert', { thread_id: 'crm_case:c1', object_name: 'vault', record_id: 'v1' })).toMatchObject({
      object_name: 'crm_case',
      record_id: 'c1',
    });
    expect(await run('beforeInsert', [{ thread_id: 'crm_case:c2' }, { thread_id: 'watercooler', object_name: 'x' }])).toEqual([
      { thread_id: 'crm_case:c2', object_name: 'crm_case', record_id: 'c2' },
      { thread_id: 'watercooler', object_name: null, record_id: null },
    ]);
  });

  it('update: a re-point re-stamps the pair; an update naming no thread stamps nothing', async () => {
    const run = hooks();
    expect(await run('beforeUpdate', { thread_id: 'crm_deal:d1', object_name: 'vault' })).toMatchObject({
      object_name: 'crm_deal',
      record_id: 'd1',
    });
    expect(await run('beforeUpdate', { body: 'b' })).toEqual({ body: 'b' });
  });

  it('a sys_comment that declares no pair is never stamped (no unknown column is written)', async () => {
    const run = hooks(false);
    expect(await run('beforeInsert', { thread_id: 'crm_case:c1' })).toEqual({ thread_id: 'crm_case:c1' });
    expect(await run('beforeUpdate', { thread_id: 'crm_case:c1' })).toEqual({ thread_id: 'crm_case:c1' });
  });
});
