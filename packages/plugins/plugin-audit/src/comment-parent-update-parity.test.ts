// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_comment` moderation gate gives the answer a by-id update of the
 * parent record gets.
 *
 * The limb that asks "may the caller edit the parent record?" — editing or
 * removing another person's comment — admits only where the security service's
 * judgement of that update admits: its record-grained `explain` verdict for
 * `update` on `(parent object, parent id)`, `allowed` and `record.visible`
 * both. That verdict is the write path's own composition (the object-level
 * grant, the parent's own row-level security, its record sharing and, for a
 * `controlled_by_parent` parent, its master), so the gate keeps no second copy
 * of it.
 *
 * What the gate already composed keeps its answers: record sharing's `deny`
 * still refuses without asking anything further, and so do the master-detail
 * write check's refusals. A store fault keeps its own status. The update
 * judgement can only add refusals; it never admits what the gate refused.
 * Posting a comment stays a READ rule on the parent (the module header says
 * why), so the update judgement is not asked there.
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
      if (object !== 'sys_comment') {
        const ids: unknown[] = options?.where?.id?.$in ?? [];
        return ids.map(String).filter((id) => readable.includes(`${object}/${id}`)).map((id) => ({ id }));
      }
      return (opts.comments ?? []).filter((r) => matches(r, options?.where ?? {}));
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

interface Row {
  shape: string;
  sharing: SharingVerdict;
  master?: ControlledByParentWriteOutcome;
  /** `null` = never asked. */
  judgement: UpdateJudgement | null;
  admits: boolean;
}

const ROWS: Row[] = [
  { shape: 'sharing allow, update judgement admits', sharing: 'allow', judgement: 'admits', admits: true },
  { shape: 'sharing allow, update judgement: record verdict refuses', sharing: 'allow', judgement: 'record_refuses', admits: false },
  { shape: 'sharing allow, update judgement: decision refuses', sharing: 'allow', judgement: 'decision_refuses', admits: false },
  { shape: 'sharing allow, update judgement carries no record verdict', sharing: 'allow', judgement: 'no_record_verdict', admits: false },
  { shape: 'sharing abstain, no master, update judgement admits', sharing: 'abstain', judgement: 'admits', admits: true },
  { shape: 'sharing abstain, no master, update judgement: record verdict refuses', sharing: 'abstain', judgement: 'record_refuses', admits: false },
  {
    shape: 'sharing abstain, no master, update judgement: decision refuses',
    sharing: 'abstain',
    judgement: 'decision_refuses',
    admits: false,
  },
  {
    shape: 'sharing abstain, master admits, update judgement admits',
    sharing: 'abstain',
    master: { outcome: 'allow' },
    judgement: 'admits',
    admits: true,
  },
  {
    shape: 'sharing abstain, master admits, update judgement: decision refuses',
    sharing: 'abstain',
    master: { outcome: 'allow' },
    judgement: 'decision_refuses',
    admits: false,
  },
  {
    shape: 'sharing abstain, master refuses',
    sharing: 'abstain',
    master: { outcome: 'deny', leg: 'object_permission' },
    judgement: null,
    admits: false,
  },
  {
    shape: 'sharing abstain, master unresolvable',
    sharing: 'abstain',
    master: { outcome: 'unresolvable', reason: 'master_reference_missing' },
    judgement: null,
    admits: false,
  },
  { shape: 'sharing deny', sharing: 'deny', judgement: null, admits: false },
];

const judgementOf = (row: Row): UpdateJudgement => row.judgement ?? 'admits';

describe('the comment moderation gate agrees with the parent by-id update', () => {
  for (const row of ROWS) {
    it(`delete another person's comment — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 RECORD_NOT_ACCESSIBLE'}`, async () => {
      const { security, explain } = securityDouble(judgementOf(row), row.master);
      const { beforeDelete } = install({ sharing: sharingDouble(row.sharing), security, comments: [othersComment] });
      const run = beforeDelete(hookCtx('beforeDelete', { id: 'c1' }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: PARENT });
      expect(explain).toHaveBeenCalledTimes(row.judgement === null ? 0 : 1);
    });

    it(`edit another person's comment — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 RECORD_NOT_ACCESSIBLE'}`, async () => {
      const { security } = securityDouble(judgementOf(row), row.master);
      const { beforeUpdate } = install({ sharing: sharingDouble(row.sharing), security, comments: [othersComment] });
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

  it('a kernel with no security service composes no update judgement, as the parent update meets none', async () => {
    const { beforeDelete } = install({ sharing: sharingDouble('abstain'), security: null, comments: [othersComment] });
    await expect(beforeDelete(hookCtx('beforeDelete', { id: 'c1' }))).resolves.toBeUndefined();
  });
});
