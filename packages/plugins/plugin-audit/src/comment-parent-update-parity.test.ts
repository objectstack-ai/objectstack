// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_comment` moderation gate gives the answer a by-id update of the
 * parent record gets — and, since #24646, asks nothing else.
 *
 * The limb that asks "may the caller edit the parent record?" — editing or
 * removing another person's comment — admits exactly where the security
 * service's judgement of that update admits: its record-grained `explain`
 * verdict for `update` on `(parent object, parent id)`, `allowed` and
 * `record.visible` both. That verdict is the write path's own composition (the
 * object-level grant, the parent's own row-level security, its record sharing
 * at the caller's real write depth and, for a `controlled_by_parent` parent,
 * its master), so the gate keeps no second copy of it: record sharing and the
 * master-detail check are not asked where the judgement is served. A caller
 * record sharing refuses at owner-only depth — a `unit` / `org` write-depth
 * holder — moderates when the update admits them, and a caller the update
 * refuses is refused whatever record sharing or the master check would have
 * said. A store fault keeps its own status. Posting a comment stays a READ rule
 * on the parent (the module header says why), so the update judgement is not
 * asked there.
 *
 * Where the security service serves no `explain`, the gate keeps the
 * composition it had before it could ask one (the last suite below).
 *
 * Refusals are asserted on the ADR-0112 envelope (`code` and `status`).
 */

import { describe, it, expect, vi } from 'vitest';
import type { ControlledByParentWriteOutcome, ExplainAccessRequest } from '@objectstack/spec/contracts';
import type { ExplainDecision } from '@objectstack/spec/security';
import {
  installCommentAccessHooks,
  type CommentAccessEngine,
  type CommentSecurityLike,
  type CommentSharingLike,
} from './comment-access-hooks.js';

const PARENT = 'pgp_case';
const PARENT_ID = 'r1';
const THREAD = `${PARENT}:${PARENT_ID}`;
const CALLER = 'usr_member';
const AUTHOR = 'usr_author';

type SharingVerdict = 'allow' | 'abstain' | 'deny';
/** The shape of the update judgement the security service hands back (its `explain` decision for `update`). */
type UpdateJudgement = 'admits' | 'record_refuses' | 'decision_refuses' | 'no_record_verdict';

function decision(judgement: UpdateJudgement, recordId: string): ExplainDecision {
  const base: ExplainDecision = {
    allowed: judgement !== 'decision_refuses',
    object: PARENT,
    operation: 'update',
    principal: { userId: CALLER, positions: [], permissionSets: [] },
    layers: [],
  };
  if (judgement === 'no_record_verdict') return base;
  return { ...base, record: { recordId, visible: judgement === 'admits' } };
}

function securityDouble(judgement: UpdateJudgement | Error, master: ControlledByParentWriteOutcome = { outcome: 'not_applicable' }) {
  const explain = vi.fn(async (request: ExplainAccessRequest, _context?: unknown): Promise<ExplainDecision> => {
    if (judgement instanceof Error) throw judgement;
    return decision(judgement, String(request.recordId));
  });
  const checkControlledByParentWrite = vi.fn(
    async (_object: string, _recordId: string, _context?: unknown): Promise<ControlledByParentWriteOutcome> => master,
  );
  const security: CommentSecurityLike = { explain, checkControlledByParentWrite };
  return { security, explain, checkControlledByParentWrite };
}

const sharingDouble = (verdict: SharingVerdict): CommentSharingLike => ({
  checkEdit: vi.fn(async () => verdict),
});

/** `readable`: the parents the caller can READ through the engine (the not-visible check), keyed `object/id`. */
function install(opts: {
  sharing: CommentSharingLike | null;
  security: CommentSecurityLike | null;
  comments?: Array<Record<string, unknown>>;
  readable?: string[];
}) {
  const hooks = new Map<string, (ctx: any) => Promise<void>>();
  const readable = opts.readable ?? [`${PARENT}/${PARENT_ID}`];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row[k] === v;
    });
  const engine: CommentAccessEngine = {
    // The FIRST handler per event is the authorization gate; the stamps the
    // installer registers after it are not what this suite drives.
    registerHook: (event, handler) => {
      if (!hooks.has(event)) hooks.set(event, handler as any);
    },
    find: async (object, options: any) => {
      const rows =
        object === 'sys_comment'
          ? (opts.comments ?? []).filter((r) => matches(r, options?.where ?? {}))
          : ((options?.where?.id?.$in ?? []) as unknown[])
              .map(String)
              .filter((id) => readable.includes(`${object}/${id}`))
              .map((id) => ({ id }));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    findOne: async (_object, options: any) => (opts.comments ?? []).find((r) => matches(r, options?.where ?? {})) ?? null,
  };
  installCommentAccessHooks(
    engine,
    () => opts.sharing,
    { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    undefined,
    () => opts.security,
  );
  return {
    beforeInsert: hooks.get('beforeInsert')!,
    beforeUpdate: hooks.get('beforeUpdate')!,
    beforeDelete: hooks.get('beforeDelete')!,
  };
}

/** The caller-scoped api the read rule (and the degraded mode) reads the parent through. */
const apiReading = (visible: string[]) => ({
  object: (name: string) => ({
    findOne: async ({ where }: any) => (visible.includes(`${name}/${where.id}`) ? { id: where.id } : null),
  }),
});

const callerEnvelope = { userId: CALLER, positions: ['org_member'], permissions: ['pgp_set'], tenantId: 'org_1' };

const hookCtx = (event: string, input: Record<string, unknown>, visible: string[] = [`${PARENT}/${PARENT_ID}`]) => ({
  object: 'sys_comment',
  event,
  input: { ...input, options: { ...((input.options as object) ?? {}), context: { ...callerEnvelope, __writeScope: 'org' } } },
  session: { userId: CALLER },
  api: apiReading(visible),
});

const othersComment = { id: 'c1', thread_id: THREAD, author_id: AUTHOR, body: 'hello' };

/** What record sharing and the master-detail check WOULD answer — neither is asked where the judgement is served. */
interface Row {
  shape: string;
  sharing: SharingVerdict;
  master?: ControlledByParentWriteOutcome;
  judgement: UpdateJudgement;
  admits: boolean;
}

const ROWS: Row[] = [
  { shape: 'update judgement admits (record sharing allows)', sharing: 'allow', judgement: 'admits', admits: true },
  { shape: 'update judgement: record verdict refuses (record sharing allows)', sharing: 'allow', judgement: 'record_refuses', admits: false },
  { shape: 'update judgement: decision refuses (record sharing allows)', sharing: 'allow', judgement: 'decision_refuses', admits: false },
  { shape: 'update judgement carries no record verdict (record sharing allows)', sharing: 'allow', judgement: 'no_record_verdict', admits: false },
  // [#24646] The write-depth holder: record sharing at owner-only depth
  // refuses, the parent's own update admits — and so does the gate.
  { shape: 'update judgement admits, record sharing at own depth refuses (a unit / org write-depth holder)', sharing: 'deny', judgement: 'admits', admits: true },
  { shape: 'update judgement: record verdict refuses, record sharing refuses', sharing: 'deny', judgement: 'record_refuses', admits: false },
  { shape: 'update judgement admits (record sharing abstains)', sharing: 'abstain', judgement: 'admits', admits: true },
  // A controlled_by_parent parent follows its master THROUGH the judgement.
  {
    shape: 'update judgement admits, the master check alone would refuse',
    sharing: 'abstain',
    master: { outcome: 'deny', leg: 'object_permission' },
    judgement: 'admits',
    admits: true,
  },
  {
    shape: 'update judgement: record verdict refuses, the master check alone would admit',
    sharing: 'abstain',
    master: { outcome: 'allow' },
    judgement: 'record_refuses',
    admits: false,
  },
  {
    shape: 'update judgement: decision refuses, the master check is unresolvable',
    sharing: 'abstain',
    master: { outcome: 'unresolvable', reason: 'master_reference_missing' },
    judgement: 'decision_refuses',
    admits: false,
  },
];

const rowDoubles = (row: Row) => {
  const { security, explain, checkControlledByParentWrite } = securityDouble(row.judgement, row.master);
  const sharing = sharingDouble(row.sharing);
  return { security, explain, checkControlledByParentWrite, sharing, checkEdit: sharing.checkEdit as ReturnType<typeof vi.fn> };
};

describe('the comment moderation gate asks the parent by-id update, and only it', () => {
  for (const row of ROWS) {
    it(`delete another person's comment — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 RECORD_NOT_ACCESSIBLE'}`, async () => {
      const { security, explain, checkControlledByParentWrite, sharing, checkEdit } = rowDoubles(row);
      const { beforeDelete } = install({ sharing, security, comments: [othersComment] });
      const run = beforeDelete(hookCtx('beforeDelete', { id: 'c1' }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: PARENT });
      expect(explain).toHaveBeenCalledTimes(1);
      expect(checkEdit).not.toHaveBeenCalled();
      expect(checkControlledByParentWrite).not.toHaveBeenCalled();
    });

    it(`edit another person's comment — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 RECORD_NOT_ACCESSIBLE'}`, async () => {
      const { security, sharing } = rowDoubles(row);
      const { beforeUpdate } = install({ sharing, security, comments: [othersComment] });
      const run = beforeUpdate(hookCtx('beforeUpdate', { id: 'c1', data: { body: 'edited' } }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: PARENT });
    });
  }
});

describe('the comment moderation gate asks the update judgement of the parent record, as the caller', () => {
  it('asks once, for `update` on the parent object and id, with the caller envelope minus operation-private keys', async () => {
    const { security, explain } = securityDouble('admits');
    const { beforeDelete } = install({ sharing: sharingDouble('allow'), security, comments: [othersComment] });
    await beforeDelete(hookCtx('beforeDelete', { id: 'c1' }));
    expect(explain).toHaveBeenCalledTimes(1);
    const [request, context] = explain.mock.calls[0]!;
    expect(request).toEqual({ object: PARENT, operation: 'update', recordId: PARENT_ID });
    expect(context).toMatchObject(callerEnvelope);
    expect(context).not.toHaveProperty('__writeScope');
  });

  it('a multi-row delete on one thread asks it once', async () => {
    const { security, explain } = securityDouble('admits');
    const rows = [othersComment, { ...othersComment, id: 'c2' }];
    const { beforeDelete } = install({ sharing: sharingDouble('allow'), security, comments: rows });
    await beforeDelete(hookCtx('beforeDelete', { options: { where: { thread_id: THREAD }, multi: true } }));
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("the author's own comment is not asked about: authors govern their own words", async () => {
    const { security, explain } = securityDouble('record_refuses');
    const { beforeDelete } = install({
      sharing: sharingDouble('allow'),
      security,
      comments: [{ ...othersComment, author_id: CALLER }],
    });
    await expect(beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).resolves.toBeUndefined();
    expect(explain).not.toHaveBeenCalled();
  });

  it('a caller who cannot read the parent still gets the not-visible refusal (403 PERMISSION_DENIED)', async () => {
    const { security } = securityDouble('record_refuses');
    const { beforeDelete } = install({ sharing: sharingDouble('allow'), security, comments: [othersComment], readable: [] });
    await expect(beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  });

  it('a store fault from the update judgement propagates unchanged — never an admit and never a 403', async () => {
    const outage = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
    const { security } = securityDouble(outage);
    const { beforeDelete } = install({ sharing: sharingDouble('allow'), security, comments: [othersComment] });
    await expect(beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).rejects.toBe(outage);
  });

  it('without a sharing service the parent read is the first question, and the update judgement the second', async () => {
    const admits = securityDouble('admits');
    const ok = install({ sharing: null, security: admits.security, comments: [othersComment] });
    await expect(ok.beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).resolves.toBeUndefined();
    expect(admits.explain).toHaveBeenCalledTimes(1);

    const refuses = securityDouble('decision_refuses');
    const refused = install({ sharing: null, security: refuses.security, comments: [othersComment] });
    await expect(refused.beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).rejects.toMatchObject({
      code: 'RECORD_NOT_ACCESSIBLE',
      status: 403,
    });

    const unread = securityDouble('admits');
    const hidden = install({ sharing: null, security: unread.security, comments: [othersComment] });
    await expect(hidden.beforeDelete(hookCtx('beforeDelete', { id: 'c1' }, []))).rejects.toMatchObject({ status: 403 });
    expect(unread.explain).not.toHaveBeenCalled();
  });

  it('posting a comment stays a READ rule on the parent: the update judgement is not asked', async () => {
    const { security, explain } = securityDouble('decision_refuses');
    const { beforeInsert } = install({ sharing: sharingDouble('deny'), security });
    await expect(beforeInsert(hookCtx('beforeInsert', { data: { thread_id: THREAD, body: 'hi' } }))).resolves.toBeUndefined();
    expect(explain).not.toHaveBeenCalled();
  });
});

/**
 * [#24646] A kernel whose security service serves no `explain` — or no
 * security service at all — judges no by-id update of the parent, and the gate
 * keeps the composition it had before it could ask one: record sharing's
 * tri-state `checkEdit` at owner-only depth, then, on an abstention, the
 * master-detail check. Removing those steps there would admit every caller, so
 * this suite holds them: each row is the answer the gate gave before #24646.
 */
describe('a kernel that judges no by-id update keeps the record-sharing and master-detail steps', () => {
  const masterOnly = (outcome: ControlledByParentWriteOutcome): CommentSecurityLike => ({
    checkControlledByParentWrite: vi.fn(async (): Promise<ControlledByParentWriteOutcome> => outcome),
  });
  const DEGRADED: Array<{ shape: string; sharing: SharingVerdict; master: ControlledByParentWriteOutcome; admits: boolean }> = [
    { shape: 'record sharing allows', sharing: 'allow', master: { outcome: 'deny', leg: 'record_sharing' }, admits: true },
    { shape: 'record sharing refuses at owner-only depth', sharing: 'deny', master: { outcome: 'allow' }, admits: false },
    { shape: 'record sharing abstains, the master check admits', sharing: 'abstain', master: { outcome: 'allow' }, admits: true },
    { shape: 'record sharing abstains, the master check refuses', sharing: 'abstain', master: { outcome: 'deny', leg: 'record_sharing' }, admits: false },
  ];
  for (const row of DEGRADED) {
    it(`delete another person's comment on a security service serving no explain — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 RECORD_NOT_ACCESSIBLE'}`, async () => {
      const { beforeDelete } = install({ sharing: sharingDouble(row.sharing), security: masterOnly(row.master), comments: [othersComment] });
      const run = beforeDelete(hookCtx('beforeDelete', { id: 'c1' }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: PARENT });
    });

    it(`edit another person's comment with no security service — ${row.shape} → ${row.sharing === 'deny' ? 'refused 403 RECORD_NOT_ACCESSIBLE' : 'admitted'}`, async () => {
      // No security service: an abstention admits, as the parent's own update meets no master check either.
      const { beforeUpdate } = install({ sharing: sharingDouble(row.sharing), security: null, comments: [othersComment] });
      const run = beforeUpdate(hookCtx('beforeUpdate', { id: 'c1', data: { body: 'edited' } }));
      if (row.sharing !== 'deny') await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: PARENT });
    });
  }

  it('with no sharing service either, the parent read alone decides — as before', async () => {
    const shown = install({ sharing: null, security: null, comments: [othersComment] });
    await expect(shown.beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).resolves.toBeUndefined();
    const hidden = install({ sharing: null, security: null, comments: [othersComment] });
    await expect(hidden.beforeDelete(hookCtx('beforeDelete', { id: 'c1' }, []))).rejects.toMatchObject({
      code: 'RECORD_NOT_ACCESSIBLE',
      status: 403,
    });
  });
});
