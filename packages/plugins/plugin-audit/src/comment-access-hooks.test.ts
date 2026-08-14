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
        Object.entries(options?.where ?? {}).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
      );
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    findOne: async (_object, options: any) =>
      (opts.comments ?? []).find((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
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


// ─────────────────────────────────────────────────────────────────────────
// #7141 — what the gate FORWARDS to the sharing service
// ─────────────────────────────────────────────────────────────────────────

/**
 * The caller's execution envelope as a real transport builds it — an OAuth MCP
 * agent principal acting on behalf of a human (`resolve-execution-context.ts`
 * is the live producer of `principalKind: 'agent'` + `onBehalfOf`) — with the
 * middleware-private keys plugin-security stamps for the object of the
 * operation in flight (`sys_comment`) riding along, because that is exactly
 * what `sc.__readScope = …` leaves on the context these hooks receive.
 */
const DELEGATED_ENVELOPE = {
  userId: 'human_1',
  tenantId: 'org_1',
  email: 'human@example.com',
  positions: [],
  permissions: ['mcp_agent_data_write'],
  systemPermissions: [],
  principalKind: 'agent',
  onBehalfOf: { userId: 'human_1', principalKind: 'human' },
  audience: 'internal',
  posture: 'authenticated',
  accessible_org_ids: ['org_1'],
  rlsMembership: { team: ['t1'] },
  isSystem: false,
  // Middleware-private, resolved for `sys_comment` — NOT for the parent.
  __readScope: 'org',
  __writeScope: 'org',
  __delegatorReadScope: 'org',
  __delegatorWriteScope: 'org',
  __expandRead: true,
} as const;

/** The same context, shaped the way the write hooks receive it. */
const envelopeWriteCtx = (
  event: 'beforeUpdate' | 'beforeDelete',
  input: any,
  exec: Record<string, unknown>,
) => ({
  object: 'sys_comment',
  event,
  input: { ...input, options: { ...(input.options ?? {}), context: exec } },
  session: { userId: exec.userId as string },
  api: apiFor([]),
});

/** The deployment's `fallbackPermissionSet` (ADR-0056 D7: an app's `isDefault`
 * profile, else the built-in `member_default`). */
const DEPLOYMENT_BASELINE_SET = 'app_default_profile';

/**
 * `ISecurityService.hasWriteBypass` as plugin-security implements it
 * (`security-plugin.ts`) — the three guard lines, then the `modifyAllRecords`
 * set probe. A DOUBLE, not a copy of production logic: plugin-audit does not
 * depend on plugin-security (dependency-free posture), so the only way to pin
 * the OUTCOME on this side of the seam is to model the contract the gate is
 * documented to be talking to. `setsWithBypass` names which permission sets
 * carry the bit in the modelled deployment.
 */
function hasWriteBypassDouble(context: any, setsWithBypass: string[]): boolean {
  if (context?.isSystem) return true;
  if (!context?.userId) return false;
  if (context?.onBehalfOf?.userId) return false; // documented fail-CLOSED on delegation
  // `resolvePermissionSetsForContext`: positions + explicit sets, plus the
  // ADDITIVE human baseline — which an ADR-0090 D10 agent principal must NOT
  // receive (its grants are exactly its scope-derived ceiling).
  const requested = [...(context?.positions ?? []), ...(context?.permissions ?? [])];
  const resolved =
    context?.principalKind === 'agent' ? requested : [...requested, DEPLOYMENT_BASELINE_SET];
  return resolved.some((name: string) => setsWithBypass.includes(name));
}

/**
 * `SharingService.checkEdit`'s positive bases, in order: ownership widened by
 * the middleware-stamped write DEPTH (`matchesOwnerScope` — `__writeScope ===
 * 'org'` short-circuits to true), then the `modifyAllRecords` bypass. The share
 * branch is omitted (no grants in these fixtures).
 */
function sharingCanEditDouble(opts: { ownerId: string; setsWithBypass?: string[] }) {
  return vi.fn(async (_object: string, _recordId: string, callerCtx: any) => {
    if (callerCtx?.isSystem) return true;
    if (!callerCtx?.userId) return false;
    if ((callerCtx as any).__writeScope === 'org') return true; // depth fast-exit
    if (String(callerCtx.userId) === opts.ownerId) return true;
    return hasWriteBypassDouble(callerCtx, opts.setsWithBypass ?? []);
  });
}

describe('#7141 — caller envelope forwarded to the sharing gate', () => {
  const row = { id: 'c1', thread_id: 'crm_opportunity:opp1', author_id: 'someone_else', body: 'hi' };

  it('forwards the whole envelope MINUS the operation-private keys', async () => {
    const canEdit = vi.fn(async (_object: string, _recordId: string, _callerCtx: any) => true);
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await beforeDelete(envelopeWriteCtx('beforeDelete', { id: 'c1' }, { ...DELEGATED_ENVELOPE }));

    const forwarded = canEdit.mock.calls[0]![2] as unknown as Record<string, unknown>;
    // Every principal field survives — the #6523 contract's unit is the envelope
    // and #6206 forbids rebuilding a subset of it.
    expect(forwarded).toEqual({
      userId: 'human_1',
      tenantId: 'org_1',
      email: 'human@example.com',
      positions: [],
      permissions: ['mcp_agent_data_write'],
      systemPermissions: [],
      principalKind: 'agent',
      onBehalfOf: { userId: 'human_1', principalKind: 'human' },
      audience: 'internal',
      posture: 'authenticated',
      accessible_org_ids: ['org_1'],
      rlsMembership: { team: ['t1'] },
      isSystem: false,
    });
    // …and every middleware-private key resolved for `sys_comment` is gone.
    for (const key of ['__readScope', '__writeScope', '__delegatorReadScope', '__delegatorWriteScope', '__expandRead']) {
      expect(forwarded).not.toHaveProperty(key);
    }
  });

  it('hands the service a COPY, so a callee stamping its own depth cannot write back', async () => {
    const exec: Record<string, unknown> = { ...DELEGATED_ENVELOPE };
    const canEdit = vi.fn(async (_o: string, _r: string, callerCtx: any) => {
      // What plugin-security does right before it calls the sharing service.
      callerCtx.__writeScope = 'unit';
      return true;
    });
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await beforeDelete(envelopeWriteCtx('beforeDelete', { id: 'c1' }, exec));

    expect(canEdit.mock.calls[0]![2]).not.toBe(exec);
    expect(exec.__writeScope).toBe('org'); // untouched: still sys_comment's own
  });

  it('REFUSES a delegated principal whose sets carry modifyAllRecords (fail-closed, #7141)', async () => {
    // The exploit shape the card names: an OAuth agent on the `/mcp` surface
    // presenting sets that carry the super-user write bypass. `hasWriteBypass`
    // is documented to fail CLOSED on `onBehalfOf` — it can only do that if the
    // field reaches it.
    const canEdit = sharingCanEditDouble({ ownerId: 'other_owner', setsWithBypass: ['admin_full_access'] });
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await expect(
      beforeDelete(
        envelopeWriteCtx('beforeDelete', { id: 'c1' }, {
          ...DELEGATED_ENVELOPE,
          permissions: ['admin_full_access'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
    expect(canEdit).toHaveBeenCalledTimes(1);
  });

  it('keeps an AGENT principal capped at its ceiling — no additive human baseline (ADR-0090 D10)', async () => {
    // `resolvePermissionSetsForContext` keys that rule on `principalKind`, which
    // the old projection dropped: the agent was resolved as a human and the
    // deployment's default profile was appended to its consented ceiling.
    const canEdit = sharingCanEditDouble({
      ownerId: 'other_owner',
      setsWithBypass: [DEPLOYMENT_BASELINE_SET],
    });
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await expect(
      beforeDelete(
        envelopeWriteCtx('beforeDelete', { id: 'c1' }, {
          ...DELEGATED_ENVELOPE,
          onBehalfOf: undefined, // isolate the ceiling rule from the delegation guard
        }),
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
  });

  it('does NOT carry sys_comment\'s access DEPTH into the parent\'s owner-match', async () => {
    // The half of the old projection that was CORRECT and must survive: the
    // context carries `__writeScope: 'org'` resolved for `sys_comment`, and the
    // gate asks about `crm_opportunity`. Forwarding it whole would widen one
    // object's question with another object's answer.
    const canEdit = sharingCanEditDouble({ ownerId: 'other_owner' });
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await expect(
      beforeDelete(
        envelopeWriteCtx('beforeDelete', { id: 'c1' }, {
          ...DELEGATED_ENVELOPE,
          principalKind: 'human',
          onBehalfOf: undefined,
          userId: 'plain_member',
          permissions: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
    expect((canEdit.mock.calls[0]![2] as any).__writeScope).toBeUndefined();
  });
});
