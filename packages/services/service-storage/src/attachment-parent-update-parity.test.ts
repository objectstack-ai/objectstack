// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_attachment` parent gate gives the answer a by-id update of the
 * parent record gets.
 *
 * Every limb that asks "may the caller edit the parent record?" — the attach
 * rule, the row rule's parent-editor limb on update and delete, the attach rule
 * on a re-point, and the caller-scoped `mayEditAttachmentParent` the
 * file-attachments service asks before it spends work on a file — admits only
 * where the security service's judgement of that update admits: its
 * record-grained `explain` verdict for `update` on `(parent object, parent id)`,
 * `allowed` and `record.visible` both. That verdict is the write path's own
 * composition (the object-level grant, the parent's own row-level security, its
 * record sharing and, for a `controlled_by_parent` parent, its master), so the
 * gate keeps no second copy of it.
 *
 * What the gate already composed keeps its answers: record sharing's `deny`
 * still refuses without asking anything further, and so do the master-detail
 * write check's refusals. A store fault keeps its own status. The update
 * judgement can only add refusals; it never admits what the gate refused.
 *
 * Each row below names the shape of the answers the gate is handed and the
 * answer it gives. Refusals are asserted on the ADR-0112 envelope (`code` and
 * `status`).
 */

import { describe, it, expect, vi } from 'vitest';
import type { ControlledByParentWriteOutcome, ExplainAccessRequest } from '@objectstack/spec/contracts';
import type { ExplainDecision } from '@objectstack/spec/security';
import {
  installAttachmentAccessHooks,
  mayEditAttachmentParent,
  type AttachmentSecurityLike,
  type AttachmentSharingLike,
} from './attachment-access-hooks.js';
import type { AttachmentLifecycleEngine } from './attachment-lifecycle.js';

const PARENT = 'pgp_case';
const PARENT_ID = 'r1';
const NEXT_ID = 'r2';
const CALLER = 'usr_member';
const UPLOADER = 'usr_uploader';

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

interface SecurityDouble {
  security: AttachmentSecurityLike;
  explain: ReturnType<typeof vi.fn>;
  checkControlledByParentWrite: ReturnType<typeof vi.fn>;
}

function securityDouble(
  judgement: UpdateJudgement | Error,
  master: ControlledByParentWriteOutcome = { outcome: 'not_applicable' },
): SecurityDouble {
  const explain = vi.fn(async (request: ExplainAccessRequest, _context?: unknown): Promise<ExplainDecision> => {
    if (judgement instanceof Error) throw judgement;
    return decision(judgement, String(request.recordId));
  });
  const checkControlledByParentWrite = vi.fn(
    async (_object: string, _recordId: string, _context?: unknown): Promise<ControlledByParentWriteOutcome> => master,
  );
  return { security: { explain, checkControlledByParentWrite }, explain, checkControlledByParentWrite };
}

const sharingDouble = (verdict: SharingVerdict): AttachmentSharingLike => ({
  checkEdit: vi.fn(async () => verdict),
});

/** Parents the caller can READ through the engine (the not-visible check), keyed `object/id`. */
function install(opts: {
  sharing: AttachmentSharingLike | null;
  security: AttachmentSecurityLike | null;
  attachments?: Array<Record<string, unknown>>;
  readable?: string[];
}) {
  const hooks = new Map<string, (ctx: any) => Promise<void>>();
  const readable = opts.readable ?? [`${PARENT}/${PARENT_ID}`, `${PARENT}/${NEXT_ID}`];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row[k] === v;
    });
  const engine: AttachmentLifecycleEngine = {
    registerHook: (event, handler) => {
      hooks.set(event, handler as any);
    },
    find: async (object, options: any) => {
      if (object !== 'sys_attachment') {
        const ids: unknown[] = options?.where?.id?.$in ?? [];
        return ids.map(String).filter((id) => readable.includes(`${object}/${id}`)).map((id) => ({ id }));
      }
      return (opts.attachments ?? []).filter((r) => matches(r, options?.where ?? {}));
    },
    findOne: async (_object, options: any) =>
      (opts.attachments ?? []).find((r) => matches(r, options?.where ?? {})) ?? null,
    update: async () => ({}),
  };
  installAttachmentAccessHooks(
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

/** The caller-scoped api the degraded (no sharing service) mode reads the parent through. */
const apiReading = (visible: string[]) => ({
  object: (name: string) => ({
    findOne: async ({ where }: any) => (visible.includes(`${name}/${where.id}`) ? { id: where.id } : null),
  }),
});

const callerEnvelope = { userId: CALLER, positions: ['org_member'], permissions: ['pgp_set'], tenantId: 'org_1' };

const hookCtx = (event: string, input: Record<string, unknown>) => ({
  object: 'sys_attachment',
  event,
  input: { ...input, options: { ...((input.options as object) ?? {}), context: { ...callerEnvelope, __writeScope: 'org' } } },
  session: { userId: CALLER },
  api: apiReading([`${PARENT}/${PARENT_ID}`, `${PARENT}/${NEXT_ID}`]),
});

const attachCtx = () =>
  hookCtx('beforeInsert', { data: { parent_object: PARENT, parent_id: PARENT_ID, file_id: 'f1' } });
const othersRow = { id: 'a1', file_id: 'f1', parent_object: PARENT, parent_id: PARENT_ID, uploaded_by: UPLOADER };

/**
 * One row per shape: what record sharing answers, what the master-detail check
 * answers (only asked on an abstention), what the parent's update judgement
 * answers (`null` = never asked), and the gate's answer.
 */
interface Row {
  shape: string;
  sharing: SharingVerdict;
  master?: ControlledByParentWriteOutcome;
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
    master: { outcome: 'deny', leg: 'record_sharing' },
    judgement: null,
    admits: false,
  },
  {
    shape: 'sharing abstain, master unresolvable',
    sharing: 'abstain',
    master: { outcome: 'unresolvable', reason: 'record_not_found' },
    judgement: null,
    admits: false,
  },
  { shape: 'sharing deny', sharing: 'deny', judgement: null, admits: false },
];

/** The judgement a row hands the double; a row whose judgement is never asked still gets one that admits. */
const judgementOf = (row: Row): UpdateJudgement => row.judgement ?? 'admits';

describe('the attachment parent gate agrees with the parent by-id update', () => {
  for (const row of ROWS) {
    it(`attach — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 ATTACHMENT_PARENT_ACCESS'}`, async () => {
      const { security, explain } = securityDouble(judgementOf(row), row.master);
      const { beforeInsert } = install({ sharing: sharingDouble(row.sharing), security });
      const run = beforeInsert(attachCtx());
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'ATTACHMENT_PARENT_ACCESS', status: 403, object: PARENT });
      expect(explain).toHaveBeenCalledTimes(row.judgement === null ? 0 : 1);
    });

    it(`delete another user's file — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 ATTACHMENT_DELETE_DENIED'}`, async () => {
      const { security } = securityDouble(judgementOf(row), row.master);
      const { beforeDelete } = install({ sharing: sharingDouble(row.sharing), security, attachments: [othersRow] });
      const run = beforeDelete(hookCtx('beforeDelete', { id: 'a1' }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED', status: 403, object: PARENT });
    });

    it(`update another user's file — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 RECORD_NOT_ACCESSIBLE'}`, async () => {
      const { security } = securityDouble(judgementOf(row), row.master);
      const { beforeUpdate } = install({ sharing: sharingDouble(row.sharing), security, attachments: [othersRow] });
      const run = beforeUpdate(hookCtx('beforeUpdate', { id: 'a1', data: { file_name: 'renamed.pdf' } }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: PARENT });
    });

    it(`re-point the caller's own file — ${row.shape} → ${row.admits ? 'admitted' : 'refused 403 ATTACHMENT_PARENT_ACCESS'}`, async () => {
      const { security } = securityDouble(judgementOf(row), row.master);
      const own = { ...othersRow, uploaded_by: CALLER };
      const { beforeUpdate } = install({ sharing: sharingDouble(row.sharing), security, attachments: [own] });
      const run = beforeUpdate(hookCtx('beforeUpdate', { id: 'a1', data: { parent_id: NEXT_ID } }));
      if (row.admits) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'ATTACHMENT_PARENT_ACCESS', status: 403, object: PARENT });
    });

    it(`mayEditAttachmentParent — ${row.shape} → ${row.admits}`, async () => {
      const { security } = securityDouble(judgementOf(row), row.master);
      const verdict = await mayEditAttachmentParent(
        { getSharing: () => sharingDouble(row.sharing), getSecurity: () => security, logger: { debug: vi.fn() } },
        PARENT,
        PARENT_ID,
        callerEnvelope,
        'attach',
        async () => ({ id: PARENT_ID }),
      );
      expect(verdict).toBe(row.admits);
    });
  }
});

describe('the attachment parent gate asks the update judgement of the parent record, as the caller', () => {
  it('asks once, for `update` on the parent object and id, with the caller envelope minus operation-private keys', async () => {
    const { security, explain } = securityDouble('admits');
    const { beforeInsert } = install({ sharing: sharingDouble('allow'), security });
    await beforeInsert(attachCtx());
    expect(explain).toHaveBeenCalledTimes(1);
    const [request, context] = explain.mock.calls[0]!;
    expect(request).toEqual({ object: PARENT, operation: 'update', recordId: PARENT_ID });
    expect(context).toMatchObject(callerEnvelope);
    expect(context).not.toHaveProperty('__writeScope');
  });

  it('a multi-row delete on one parent asks it once', async () => {
    const { security, explain } = securityDouble('admits');
    const rows = [othersRow, { ...othersRow, id: 'a2', file_id: 'f2' }];
    const { beforeDelete } = install({ sharing: sharingDouble('allow'), security, attachments: rows });
    await beforeDelete(hookCtx('beforeDelete', { options: { where: { parent_id: PARENT_ID }, multi: true } }));
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("the uploader's own file is not asked about: the uploader governs it", async () => {
    const { security, explain } = securityDouble('record_refuses');
    const { beforeDelete } = install({
      sharing: sharingDouble('allow'),
      security,
      attachments: [{ ...othersRow, uploaded_by: CALLER }],
    });
    await expect(beforeDelete(hookCtx('beforeDelete', { id: 'a1' }))).resolves.toBeUndefined();
    expect(explain).not.toHaveBeenCalled();
  });

  it('a caller who cannot read the parent still gets the not-visible refusal (403 PERMISSION_DENIED)', async () => {
    const { security } = securityDouble('record_refuses');
    const { beforeDelete } = install({ sharing: sharingDouble('allow'), security, attachments: [othersRow], readable: [] });
    await expect(beforeDelete(hookCtx('beforeDelete', { id: 'a1' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  });

  it('a store fault from the update judgement propagates unchanged — never an admit and never a 403', async () => {
    const outage = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
    const { security } = securityDouble(outage);
    const { beforeInsert } = install({ sharing: sharingDouble('allow'), security });
    await expect(beforeInsert(attachCtx())).rejects.toBe(outage);
  });

  it('without a sharing service the parent read is the first question, and the update judgement the second', async () => {
    const admits = securityDouble('admits');
    await expect(install({ sharing: null, security: admits.security }).beforeInsert(attachCtx())).resolves.toBeUndefined();
    expect(admits.explain).toHaveBeenCalledTimes(1);

    const refuses = securityDouble('decision_refuses');
    await expect(install({ sharing: null, security: refuses.security }).beforeInsert(attachCtx())).rejects.toMatchObject({
      code: 'ATTACHMENT_PARENT_ACCESS',
      status: 403,
    });

    const unread = securityDouble('admits');
    const ctx = { ...attachCtx(), api: apiReading([]) };
    await expect(install({ sharing: null, security: unread.security }).beforeInsert(ctx)).rejects.toMatchObject({
      code: 'ATTACHMENT_PARENT_ACCESS',
      status: 403,
    });
    expect(unread.explain).not.toHaveBeenCalled();
  });

  it('a kernel with no security service composes no update judgement, as the parent update meets none', async () => {
    const { beforeInsert } = install({ sharing: sharingDouble('abstain'), security: null });
    await expect(beforeInsert(attachCtx())).resolves.toBeUndefined();
  });
});
