// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
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

  // [#9798] The UNSCOPED multi-write block that used to sit here called the
  // handlers DIRECTLY with a whole-operation context of this file's own
  // construction — a shape the engine's per-row dispatch (#5038/#5574) never
  // produced on either verb, so it stayed green for a behaviour the wired
  // engine did the opposite of. It is re-pointed at the REAL engine below —
  // see the two "#4630 through the wired engine" blocks. [#9974] The update
  // half's block pinned the gap as MEASURED until the dispatch existed; it now
  // pins the refusal itself, on both verbs.

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

  // ── The session fallback, and the org name it reads (#9691) ───────────
  //
  // The kit had no coverage of the no-execution-context path at all, so the
  // dead `s.tenantId ?? s.organizationId` first arm was invisible in both
  // directions: nothing proved the blessed name was read, and nothing would
  // have noticed if the fallback had been dropped. Both directions are pinned
  // here, on the session shape `ObjectQLEngine.buildSession` actually emits.
  it('falls back to the session snapshot and reads the caller org under the BLESSED name (#9691)', async () => {
    const canEdit = vi.fn(async (_o: string, _r: string, _c: any) => true);
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await beforeDelete({
      object: 'sys_comment',
      event: 'beforeDelete',
      input: { id: 'c1' },
      session: { userId: 'u1', organizationId: 'org_1', positions: ['p1'] },
      api: apiFor(['crm_opportunity/opp1']),
    });
    // `tenantId` on the way OUT is `ExecutionContext`'s driver-layer name for
    // the same value — the separate axis #3290 deliberately left alone.
    expect(canEdit.mock.calls[0]![2]).toEqual({ userId: 'u1', tenantId: 'org_1', positions: ['p1'] });
  });

  it('does not resurrect the removed `session.tenantId` alias if one ever reaches a hook (#9691)', async () => {
    const canEdit = vi.fn(async (_o: string, _r: string, _c: any) => true);
    const { beforeDelete } = install({ comments: [row], sharing: { canEdit } });
    await beforeDelete({
      object: 'sys_comment',
      event: 'beforeDelete',
      input: { id: 'c1' },
      // A key `HookContextSchema` strips (#3290). It is not the caller's org.
      session: { userId: 'u1', tenantId: 'stale_org', positions: ['p1'] } as any,
      api: apiFor(['crm_opportunity/opp1']),
    });
    expect((canEdit.mock.calls[0]![2] as any).tenantId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// #4630's unscoped multi-write refusals through the WIRED engine (#9798)
//
// A real `ObjectQL` + in-memory driver + this module's installer — the exact
// path `ql.delete('sys_comment', …)` / `ql.update('sys_comment', …)` take in
// production. The block these replace called the handlers directly with a
// whole-operation context this file built itself: a shape the per-row dispatch
// (#5038/#5574) never produces, so it was green on both verbs while the wired
// engine refused neither.
//
// The two verbs land in DIFFERENT states here, and that asymmetry is the point:
//  - DELETE is restored — the registration declares `dispatchUnscopedMultiDelete`,
//    so the whole-operation dispatch delivers the shape before any row resolves.
//  - UPDATE has no such dispatch (the engine refuses the flag on that event by
//    design), so its declared refusal is still unreachable. That limb is PINNED
//    as the measured gap rather than asserted away — see the note on it.
//
// Every refusal asserts the rows SURVIVED: the defect being replaced was a
// green suite over a table the engine was willing to wipe.
//
// NOTE `@objectstack/objectql` is deliberately un-aliased in this package's
// vitest config (`KNOWN_UNALIASED_TEST_IMPORTS`), so these pins run against
// objectql's BUILT dist — rebuild `@objectstack/objectql` before trusting a
// verdict from this block.
// ─────────────────────────────────────────────────────────────────────────

const COMMENT_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  thread_id: { name: 'thread_id', label: 'Thread', type: 'text' as const },
  author_id: { name: 'author_id', label: 'Author', type: 'text' as const },
  body: { name: 'body', label: 'Body', type: 'text' as const },
};
const sysCommentObject = { name: 'sys_comment', label: 'Comment', fields: COMMENT_FIELDS };
const crmOpportunityObject = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** In-memory driver whose WHERE matcher REFUSES combinators/operator values by
 * throwing — the conforming shape `check-where-matcher-conformance.mjs` asks of
 * a double (a silently wrong answer is the defect class, not incompleteness). */
function makeWiredDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`wired stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object') throw new Error(`wired stub driver: unsupported operator value on ${k}`);
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {}, stores,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      const id = String(data.id);
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const row = storeFor(o).get(String(id));
      if (!row) return null;
      const next = { ...row, ...data, id: String(id) };
      storeFor(o).set(String(id), next);
      return next;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
    },
    async deleteMany(o: string, ast: any) {
      const doomed = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of doomed) storeFor(o).delete(String(r.id));
      return doomed.length;
    },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const hit = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of hit) storeFor(o).set(String(r.id), { ...r, ...data, id: String(r.id) });
      return hit.length;
    },
  };
  return d;
}

async function bootWired(opts: {
  comments?: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
  sharing?: CommentSharingLike | null;
} = {}) {
  const ql = new ObjectQL();
  const driver = makeWiredDriver();
  ql.registerDriver(driver, true);
  await ql.init();
  ql.registry.registerObject(sysCommentObject as any, 'app:test');
  ql.registry.registerObject(crmOpportunityObject as any, 'app:test');
  // `engine as any` mirrors the production wiring in audit-plugin.ts.
  installCommentAccessHooks(ql as any, () => opts.sharing ?? null, silentLogger());
  if (!driver.stores.get('sys_comment')) driver.stores.set('sys_comment', new Map());
  for (const r of opts.comments ?? []) driver.stores.get('sys_comment')!.set(String(r.id), { ...r });
  for (const r of opts.opportunities ?? []) {
    if (!driver.stores.get('crm_opportunity')) driver.stores.set('crm_opportunity', new Map());
    driver.stores.get('crm_opportunity')!.set(String(r.id), { ...r });
  }
  const remaining = () => driver.stores.get('sys_comment')?.size ?? 0;
  const bodies = (): unknown[] => {
    const rows = driver.stores.get('sys_comment') as
      | Map<string, Record<string, unknown>>
      | undefined;
    return Array.from(rows?.values() ?? []).map((r) => r.body);
  };
  return { ql, driver, remaining, bodies };
}

const wiredComment = (id: string, authorId: string, threadId = 'crm_opportunity:opp1') => ({
  id, thread_id: threadId, author_id: authorId, body: `body of ${id}`,
});

/** ADR-0112 envelope of the #4630 refusal. The first sentence IS the declared
 * contract (the issue's quoted wording), so it is asserted alongside the code
 * and status rather than instead of them.
 *
 * [#9974] Parameterized by verb because the refusal now fires on BOTH, and the
 * VERB IN THE MESSAGE is load-bearing: before this card an unscoped multi-update
 * that was refused at all came back with the PER-ROW message
 * (`Cannot update comment c2: …`), which names a row rather than the shape. A
 * matcher that only checked code+status would have passed on that wording, so
 * the shape refusal is pinned to say "unscoped". */
const unscopedRefusal = (verb: 'update' | 'delete') => expect.objectContaining({
  code: 'RECORD_NOT_ACCESSIBLE',
  status: 403,
  message: expect.stringContaining(`Refusing an unscoped multi-${verb} of comments`),
});
const UNSCOPED_REFUSAL = unscopedRefusal('delete');
const UNSCOPED_UPDATE_REFUSAL = unscopedRefusal('update');

describe('unscoped multi-DELETE (no id, no where) — #4630 through the wired engine (#9798)', () => {
  it('refuses `{ multi: true }` even when the caller AUTHORED every matched row — and the rows survive', async () => {
    // The measured gap verbatim: before the fix this call resolved and wiped
    // both rows — the per-row author shortcut licensed each one and no dispatch
    // ever carried the unscoped shape.
    const { ql, remaining } = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'me', 'crm_opportunity:opp2')],
    });
    await expect(
      ql.delete('sys_comment', { multi: true, context: { userId: 'me' } } as any),
    ).rejects.toEqual(UNSCOPED_REFUSAL);
    expect(remaining()).toBe(2);
  });

  it('refuses an explicitly null `where` the same way', async () => {
    const { ql, remaining } = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      ql.delete('sys_comment', { multi: true, where: null, context: { userId: 'me' } } as any),
    ).rejects.toEqual(UNSCOPED_REFUSAL);
    expect(remaining()).toBe(1);
  });

  it('refuses on an EMPTY table — "nothing was ever queried" is not "nothing to authorize"', async () => {
    // The zero-match limb: the per-row dispatch is gated on matched rows, so a
    // handler-only fix can never fire here — a caller probing against an empty
    // table would see success and ship the unscoped delete.
    const { ql } = await bootWired({ comments: [] });
    await expect(
      ql.delete('sys_comment', { multi: true, context: { userId: 'me' } } as any),
    ).rejects.toEqual(UNSCOPED_REFUSAL);
  });

  it('positive control: an empty table is not refused per se — a scoped `where: {}` delete of it resolves', async () => {
    // Proves the empty-table refusal above measures the SHAPE, not emptiness.
    const { ql } = await bootWired({ comments: [] });
    await expect(
      ql.delete('sys_comment', { multi: true, where: {}, context: { userId: 'me' } } as any),
    ).resolves.toBeDefined();
  });

  it('the per-row gate is a DIFFERENT refusal and still fires through the wire', async () => {
    // A scoped delete matching a row the caller may not touch answers with the
    // PER-ROW message, not the unscoped one — the two limbs stay distinguishable.
    const { ql, remaining } = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'someone-else')],
      sharing: { canEdit: async () => false },
    });
    await expect(
      ql.delete('sys_comment', {
        multi: true,
        where: { thread_id: 'crm_opportunity:opp1' },
        context: { userId: 'me' },
      } as any),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'RECORD_NOT_ACCESSIBLE',
        status: 403,
        message: expect.stringContaining('Cannot delete comment'),
      }),
    );
    expect(remaining()).toBe(2);
  });

  it('scoped controls still pass: by id, by a real `where`, and by the match-all `where: {}`', async () => {
    // Over-firing here would break every legitimate comment delete.
    const byId = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      byId.ql.delete('sys_comment', { where: { id: 'c1' }, context: { userId: 'me' } } as any),
    ).resolves.toBeDefined();
    expect(byId.remaining()).toBe(0);

    const byWhere = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'me', 'crm_opportunity:opp2')],
    });
    await expect(
      byWhere.ql.delete('sys_comment', {
        multi: true,
        where: { author_id: 'me' },
        context: { userId: 'me' },
      } as any),
    ).resolves.toBeDefined();
    expect(byWhere.remaining()).toBe(0);

    // `where: {}` is a REAL match-all query (the declared semantics): every
    // matched row is authorized per row, and an entitled caller may empty the
    // table with it — the refusal is about an ABSENT predicate only.
    const matchAll = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      matchAll.ql.delete('sys_comment', { multi: true, where: {}, context: { userId: 'me' } } as any),
    ).resolves.toBeDefined();
    expect(matchAll.remaining()).toBe(0);
  });

  it('system context still bypasses the refusal — engine self-writes and seeds are not the caller', async () => {
    const { ql, remaining } = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      ql.delete('sys_comment', { multi: true, context: { userId: 'x', isSystem: true } } as any),
    ).resolves.toBeDefined();
    expect(remaining()).toBe(0);
  });
});

describe('unscoped multi-UPDATE (no id, no where) — #4630 through the wired engine (#9974)', () => {
  // ⚠️ THESE PINS REPLACE THREE `MEASURED GAP` PINS, AS THE CARD REQUIRED. ⚠️
  //
  // Until #9974 this block documented a LIVE FAIL-OPEN on purpose: the same
  // refusal `resolveTargetRows` declares for `delete` was declared for `update`
  // and could not fire, because `dispatchUnscopedMultiDelete` was valid on
  // `beforeDelete` only and the engine refused it elsewhere BY DESIGN —
  // extending the whole-operation dispatch to `beforeUpdate`'s predicate path
  // was a product-behaviour decision, not drift. Those pins were annotated to
  // go RED when the decision landed, and that is what happened: the maintainer
  // ruled option A on 2026-08-19, the flag became `dispatchUnscopedMultiWrite`
  // valid on both write verbs, and each MEASURED-GAP assertion below is now the
  // REFUSAL it was measuring the absence of — replaced, not relaxed or removed.
  //
  // The three limbs, in the order the card tabled them:
  //   1. caller authored every row  — was "whole table rewritten", now refused;
  //   2. empty table (zero match)   — was "nothing ran, resolves", now refused;
  //   3. a row the caller may not touch is swept — WAS refused, but with the
  //      PER-ROW message; now refused on the SHAPE, which is a different and
  //      stronger claim (see limb 3's own note).
  //
  // ⚠️ Limb 1 is a BEHAVIOUR CHANGE, not a restoration: that call used to
  // succeed for an entitled caller. It is what was ruled for — an overwrite
  // leaves no trace and no pre-image, so the less recoverable verb must not be
  // the less guarded one — and the changeset says so in those terms.

  it('limb 1: an unscoped `{ multi: true }` update is refused even when the caller AUTHORED every row — and the bodies survive', async () => {
    // The behaviour change, stated as a test: this exact call resolved before
    // #9974 and rewrote both rows. The declared refusal is about the SHAPE, so
    // it must fire whatever the rows say — including when every row is the
    // caller's own and the per-row gate would have licensed all of them.
    const { ql, bodies } = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'me', 'crm_opportunity:opp2')],
      sharing: { canEdit: async () => false },
    });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, { multi: true, context: { userId: 'me' } } as any),
    ).rejects.toEqual(UNSCOPED_UPDATE_REFUSAL);
    expect(bodies()).toEqual(['body of c1', 'body of c2']);
  });

  it('refuses an explicitly null `where` the same way', async () => {
    const { ql, bodies } = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, {
        multi: true, where: null, context: { userId: 'me' },
      } as any),
    ).rejects.toEqual(UNSCOPED_UPDATE_REFUSAL);
    expect(bodies()).toEqual(['body of c1']);
  });

  it('limb 2: an unscoped `{ multi: true }` update of an EMPTY table is refused too', async () => {
    // The zero-match limb: the per-row dispatch is gated on matched rows, so a
    // handler-only fix could never fire here — a caller probing against an
    // empty table used to see success and ship the unscoped update.
    const { ql } = await bootWired({ comments: [] });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, { multi: true, context: { userId: 'me' } } as any),
    ).rejects.toEqual(UNSCOPED_UPDATE_REFUSAL);
  });

  it('positive control: an empty table is not refused per se — a scoped `where: {}` update of it resolves', async () => {
    // Proves the empty-table refusal above measures the SHAPE, not emptiness.
    const { ql } = await bootWired({ comments: [] });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, {
        multi: true, where: {}, context: { userId: 'me' },
      } as any),
    ).resolves.toBeDefined();
  });

  it('limb 3: a swept row the caller may not touch is now refused on the SHAPE, not per-row', async () => {
    // The limb that was ALREADY refusing, and the reason it still had to
    // change. Before #9974 this answered `Cannot update comment c2: …` — the
    // per-row gate catching the unscoped shape by accident, on its way through
    // a row it happened to reject. That message names a ROW, so it taught the
    // caller "row c2 is protected" when the truth is "this shape is refused";
    // scoping the write to c1 alone would have "fixed" it and left the hole.
    // The shape check now runs BEFORE any row is read, so the unscoped message
    // arrives whatever the sweep would have found.
    const { ql, bodies } = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'someone-else')],
      sharing: { canEdit: async () => false },
    });
    const err = await ql
      .update('sys_comment', { body: 'rewritten' }, { multi: true, context: { userId: 'me' } } as any)
      .then(() => null, (e: unknown) => e);
    expect(err).toEqual(UNSCOPED_UPDATE_REFUSAL);
    // The old per-row wording is GONE from this shape, not merely joined by the
    // new one — asserting only the new sentence would pass on a message that
    // still led with the row.
    expect(String((err as Error).message)).not.toContain('Cannot update comment c2');
    expect(bodies()).toEqual(['body of c1', 'body of c2']);
  });

  it('the per-row gate is a DIFFERENT refusal and still fires through the wire', async () => {
    // The delete block's twin: a SCOPED update matching a row the caller may
    // not touch keeps answering with the per-row message. The two limbs stay
    // distinguishable, which is what makes limb 3's assertion meaningful.
    const { ql, bodies } = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'someone-else')],
      sharing: { canEdit: async () => false },
    });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, {
        multi: true,
        where: { thread_id: 'crm_opportunity:opp1' },
        context: { userId: 'me' },
      } as any),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'RECORD_NOT_ACCESSIBLE',
        status: 403,
        message: expect.stringContaining('Cannot update comment'),
      }),
    );
    expect(bodies()).toEqual(['body of c1', 'body of c2']);
  });

  it('scoped controls still pass: by id, by a real `where`, and by the match-all `where: {}`', async () => {
    // Over-firing here would break every legitimate comment edit — the blast
    // radius pin for a refusal-widening change.
    const byId = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      byId.ql.update('sys_comment', { body: 'edited' }, {
        where: { id: 'c1' }, context: { userId: 'me' },
      } as any),
    ).resolves.toBeDefined();
    expect(byId.bodies()).toEqual(['edited']);

    const byWhere = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'me', 'crm_opportunity:opp2')],
    });
    await expect(
      byWhere.ql.update('sys_comment', { body: 'edited' }, {
        multi: true, where: { author_id: 'me' }, context: { userId: 'me' },
      } as any),
    ).resolves.toBeDefined();
    expect(byWhere.bodies()).toEqual(['edited', 'edited']);

    // `where: {}` is a REAL match-all query (the declared semantics): every
    // matched row is authorized per row, and an entitled caller may rewrite the
    // table with it — the refusal is about an ABSENT predicate only.
    const matchAll = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      matchAll.ql.update('sys_comment', { body: 'edited' }, {
        multi: true, where: {}, context: { userId: 'me' },
      } as any),
    ).resolves.toBeDefined();
    expect(matchAll.bodies()).toEqual(['edited']);
  });

  it('system context still bypasses the refusal — engine self-writes and seeds are not the caller', async () => {
    const { ql, bodies } = await bootWired({ comments: [wiredComment('c1', 'me')] });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, {
        multi: true, context: { userId: 'x', isSystem: true },
      } as any),
    ).resolves.toBeDefined();
    expect(bodies()).toEqual(['rewritten']);
  });

  it('control: the scoped update paths are gated exactly as declared', async () => {
    // Unchanged from the pre-#9974 block: a real predicate still reaches the
    // per-row author-or-parent-editor gate, and refuses there.
    const { ql, bodies } = await bootWired({
      comments: [wiredComment('c1', 'me'), wiredComment('c2', 'someone-else')],
      sharing: { canEdit: async () => false },
    });
    await expect(
      ql.update('sys_comment', { body: 'rewritten' }, {
        multi: true,
        where: { thread_id: 'crm_opportunity:opp1' },
        context: { userId: 'me' },
      } as any),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'RECORD_NOT_ACCESSIBLE',
        status: 403,
        message: expect.stringContaining('Cannot update comment'),
      }),
    );
    expect(bodies()).toEqual(['body of c1', 'body of c2']);
  });
});
