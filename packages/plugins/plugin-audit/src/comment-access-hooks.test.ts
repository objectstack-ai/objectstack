// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installCommentAccessHooks,
  parseCommentThreadId,
  type CommentAccessEngine,
  type CommentSharingLike,
} from './comment-access-hooks.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/** Capture the three registered hooks so tests can drive them directly. */
function install(opts: {
  comments?: Array<Record<string, unknown>>;
  sharing?: CommentSharingLike | null;
}) {
  const hooks = new Map<string, (ctx: any) => Promise<void>>();
  const engine: CommentAccessEngine = {
    registerHook: (event, handler) => {
      hooks.set(event, handler as any);
    },
    find: async (_object, options: any) => {
      const rows = (opts.comments ?? []).filter((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => r[k] === v),
      );
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    findOne: async (_object, options: any) =>
      (opts.comments ?? []).find((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => r[k] === v),
      ) ?? null,
  };
  installCommentAccessHooks(engine, () => opts.sharing, silentLogger());
  return {
    beforeInsert: hooks.get('beforeInsert')!,
    beforeUpdate: hooks.get('beforeUpdate')!,
    beforeDelete: hooks.get('beforeDelete')!,
  };
}

/** Caller-scoped api fake: `visible` is the set of records the caller can
 * read, keyed `object/id` — i.e. what the parent object's own OWD / sharing /
 * RLS / object-CRUD would let through. */
function apiFor(visible: string[]) {
  return {
    object: (name: string) => ({
      findOne: async ({ where }: any) =>
        visible.includes(`${name}/${where.id}`) ? { id: where.id } : null,
    }),
  };
}

type CallerOpts = { userId?: string; isSystem?: boolean; visible?: string[] };

const sessionFor = (opts: CallerOpts) =>
  opts.isSystem ? { isSystem: true, userId: opts.userId } : opts.userId ? { userId: opts.userId } : undefined;

const insertCtx = (data: any, opts: CallerOpts = {}) => ({
  object: 'sys_comment',
  event: 'beforeInsert',
  input: { data, options: { context: { userId: opts.userId, permissions: [] } } },
  session: sessionFor(opts),
  api: apiFor(opts.visible ?? []),
});

const writeCtx = (event: 'beforeUpdate' | 'beforeDelete', input: any, opts: CallerOpts = {}) => ({
  object: 'sys_comment',
  event,
  input: { ...input, options: { ...(input.options ?? {}), context: { userId: opts.userId, permissions: [] } } },
  session: sessionFor(opts),
  api: apiFor(opts.visible ?? []),
});

describe('parseCommentThreadId', () => {
  it('splits `{object}:{record_id}` on the FIRST colon', () => {
    expect(parseCommentThreadId('crm_opportunity:1A7nlQpfEhWxIaeX')).toEqual({
      object: 'crm_opportunity',
      recordId: '1A7nlQpfEhWxIaeX',
    });
    // a record id may legally contain a colon
    expect(parseCommentThreadId('sys_user:a:b')).toEqual({ object: 'sys_user', recordId: 'a:b' });
  });

  it('rejects every thread id that names no authorizable record', () => {
    expect(parseCommentThreadId('crm_opportunity:')).toBeNull(); // #4630 body: dangling empty id
    expect(parseCommentThreadId(':abc')).toBeNull();
    expect(parseCommentThreadId('free-form thread')).toBeNull();
    expect(parseCommentThreadId('CrmOpportunity:r1')).toBeNull(); // not a machine name
    expect(parseCommentThreadId('sys_comment:c1')).toBeNull(); // no probe re-entry
    expect(parseCommentThreadId(undefined)).toBeNull();
    expect(parseCommentThreadId(42)).toBeNull();
  });
});

describe('comment access — beforeInsert (parent readability + provenance)', () => {
  // #4630 body, repro 2: rep2 POSTs a comment on an opportunity rep2 cannot read.
  it('rejects commenting on a record the caller cannot read (403)', async () => {
    const { beforeInsert } = install({});
    const ctx = insertCtx(
      { thread_id: 'crm_opportunity:1A7nlQpfEhWxIaeX', body: 'rep2 should not be here' },
      { userId: 'rep2', visible: [] },
    );
    await expect(beforeInsert(ctx)).rejects.toMatchObject({
      code: 'RECORD_NOT_ACCESSIBLE',
      status: 403,
      object: 'crm_opportunity',
    });
  });

  // #4630 body, repro 2 verbatim: the empty-id thread that used to 201.
  it('rejects a dangling thread_id with an empty record id', async () => {
    const { beforeInsert } = install({});
    await expect(
      beforeInsert(insertCtx({ thread_id: 'crm_opportunity:', body: 'x' }, { userId: 'rep2', visible: [] })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
  });

  it('rejects a free-form (colon-less) thread_id — unauthorizable is not unguarded', async () => {
    const { beforeInsert } = install({});
    await expect(
      beforeInsert(insertCtx({ thread_id: 'watercooler', body: 'x' }, { userId: 'u1', visible: [] })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
  });

  it('allows commenting on a record the caller CAN read (read is enough — no edit required)', async () => {
    // A sharing service that denies every edit is present: commenting must
    // still work for a user who can merely read the record.
    const canEdit = vi.fn(async () => false);
    const { beforeInsert } = install({ sharing: { canEdit } });
    const ctx = insertCtx(
      { thread_id: 'crm_opportunity:opp1', body: 'kickoff booked' },
      { userId: 'rep1', visible: ['crm_opportunity/opp1'] },
    );
    await expect(beforeInsert(ctx)).resolves.toBeUndefined();
    expect(canEdit).not.toHaveBeenCalled();
  });

  it('server-stamps author_id from the session, overwriting a spoofed value', async () => {
    const { beforeInsert } = install({});
    const data = { thread_id: 'crm_opportunity:opp1', body: 'hi', author_id: 'someone-else' };
    await beforeInsert(insertCtx(data, { userId: 'rep1', visible: ['crm_opportunity/opp1'] }));
    expect(data.author_id).toBe('rep1');
  });

  it('bypasses for system context and context-less calls', async () => {
    const { beforeInsert } = install({});
    await expect(
      beforeInsert(insertCtx({ thread_id: 'x:1', body: 'b' }, { isSystem: true, userId: 'u1' })),
    ).resolves.toBeUndefined();
    await expect(beforeInsert(insertCtx({ thread_id: 'x:1', body: 'b' }, {}))).resolves.toBeUndefined();
  });

  // #3712 — a schedule-triggered flow run has provenance but no caller.
  it('still bypasses a flow run that carries provenance but no session', async () => {
    const { beforeInsert } = install({});
    await expect(
      beforeInsert({ ...insertCtx({ thread_id: 'x:1' }, {}), provenance: { flowRunId: 'run_1' } }),
    ).resolves.toBeUndefined();
  });
});

describe('comment access — beforeUpdate (author or parent editor)', () => {
  const row = { id: 'c1', thread_id: 'crm_opportunity:opp1', author_id: 'rep1', body: 'mine' };

  it('the author may edit their own comment', async () => {
    const canEdit = vi.fn(async () => false);
    const { beforeUpdate } = install({ comments: [row], sharing: { canEdit } });
    await expect(
      beforeUpdate(writeCtx('beforeUpdate', { id: 'c1', data: { body: 'edited' } }, { userId: 'rep1' })),
    ).resolves.toBeUndefined();
    expect(canEdit).not.toHaveBeenCalled();
  });

  it('a stranger without parent edit cannot rewrite someone else\'s comment', async () => {
    const { beforeUpdate } = install({ comments: [row], sharing: { canEdit: async () => false } });
    await expect(
      beforeUpdate(writeCtx('beforeUpdate', { id: 'c1', data: { body: 'tampered' } }, { userId: 'rep2' })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: 'crm_opportunity' });
  });

  it('a parent editor may edit any comment on that record', async () => {
    const { beforeUpdate } = install({ comments: [row], sharing: { canEdit: async () => true } });
    await expect(
      beforeUpdate(writeCtx('beforeUpdate', { id: 'c1', data: { body: 'moderated' } }, { userId: 'manager' })),
    ).resolves.toBeUndefined();
  });

  it('re-pointing thread_id also requires READ on the NEW record', async () => {
    const { beforeUpdate } = install({ comments: [row], sharing: { canEdit: async () => true } });
    // author moving their own comment onto a record they cannot read
    await expect(
      beforeUpdate(
        writeCtx('beforeUpdate', { id: 'c1', data: { thread_id: 'crm_opportunity:secret' } }, { userId: 'rep1', visible: [] }),
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: 'crm_opportunity' });
    // ... and is allowed once that record is readable
    await expect(
      beforeUpdate(
        writeCtx(
          'beforeUpdate',
          { id: 'c1', data: { thread_id: 'crm_opportunity:opp2' } },
          { userId: 'rep1', visible: ['crm_opportunity/opp2'] },
        ),
      ),
    ).resolves.toBeUndefined();
    // an unchanged thread_id in the payload is not a move
    await expect(
      beforeUpdate(
        writeCtx('beforeUpdate', { id: 'c1', data: { thread_id: row.thread_id, body: 'b' } }, { userId: 'rep1', visible: [] }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('comment access — beforeDelete (author or parent editor)', () => {
  const row = { id: 'c1', thread_id: 'crm_opportunity:opp1', author_id: 'rep1', body: 'mine' };

  it('the author may always delete their own comment', async () => {
    const canEdit = vi.fn(async () => false);
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await expect(beforeDelete(writeCtx('beforeDelete', { id: 'c1' }, { userId: 'rep1' }))).resolves.toBeUndefined();
    expect(canEdit).not.toHaveBeenCalled();
  });

  it('a non-author without parent edit is rejected (403)', async () => {
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit: async () => false } });
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c1' }, { userId: 'rep2' })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
  });

  it('a parent editor may delete another user\'s comment', async () => {
    const canEdit = vi.fn(async (object: string, recordId: string, callerCtx: any) => {
      expect(object).toBe('crm_opportunity');
      expect(recordId).toBe('opp1');
      expect(callerCtx.userId).toBe('manager');
      return true;
    });
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c1' }, { userId: 'manager' })),
    ).resolves.toBeUndefined();
  });

  it('multi-delete requires EVERY matched row to pass', async () => {
    const rows = [
      { ...row, id: 'c1', author_id: 'me' },
      { ...row, id: 'c2', author_id: 'someone-else' },
    ];
    const { beforeDelete } = install({ comments: rows, sharing: { canEdit: async () => false } });
    await expect(
      beforeDelete(
        writeCtx(
          'beforeDelete',
          { options: { where: { thread_id: 'crm_opportunity:opp1' }, multi: true } },
          { userId: 'me' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE' });
  });

  it('refuses an UNSCOPED multi-write (no id, no where) instead of reading it as "nothing to authorize"', async () => {
    const { beforeDelete, beforeUpdate } = install({ comments: [row], sharing: { canEdit: async () => true } });
    await expect(
      beforeDelete(writeCtx('beforeDelete', { options: { multi: true } }, { userId: 'me' })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
    await expect(
      beforeUpdate(writeCtx('beforeUpdate', { data: { body: 'x' }, options: { multi: true } }, { userId: 'me' })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
  });

  it('a dangling-thread comment is modifiable only by its author', async () => {
    const orphan = { id: 'c9', thread_id: 'crm_opportunity:', author_id: 'rep1', body: 'orphan' };
    const { beforeDelete } = install({ comments: [orphan], sharing: { canEdit: async () => true } });
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c9' }, { userId: 'rep1' })),
    ).resolves.toBeUndefined();
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c9' }, { userId: 'manager' })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE' });
  });

  it('degrades to parent READ visibility when the sharing service is absent', async () => {
    const { beforeDelete } = install({ comments: [row], sharing: null });
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c1' }, { userId: 'reader', visible: ['crm_opportunity/opp1'] })),
    ).resolves.toBeUndefined();
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c1' }, { userId: 'reader', visible: [] })),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE' });
  });

  it('bypasses for system context; a no-match delete is not blocked', async () => {
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit: async () => false } });
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'c1' }, { isSystem: true, userId: 'x' })),
    ).resolves.toBeUndefined();
    await expect(
      beforeDelete(writeCtx('beforeDelete', { id: 'missing' }, { userId: 'x' })),
    ).resolves.toBeUndefined();
  });
});
