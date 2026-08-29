// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The END USER's half of the non-submitter recall refusal (#11993).
 *
 * The report: in a fully Chinese deployment a non-submitter clicked 「撤回审批」
 * and read `撤回审批失败: <an English sentence>`. Console composes its own
 * localized label and splices the server's reason onto it verbatim — so a
 * hardcoded English reason surfaces as a Chinese prefix glued to English prose
 * the operator cannot act on.
 *
 * The refusal now renders through the shared Operation Message Catalog
 * (`@objectstack/spec/system`, key `approval_recall_not_submitter`, landed by
 * #12493) instead of a package-local string.
 *
 * ⚠️ These tests assert the SENTENCE AN OPERATOR READS, in zh-CN specifically.
 * Asserting only that a catalog key was passed would pass against a message
 * that still renders in English — which is the entire reported defect.
 *
 * They also pin the two things the conversion must NOT move:
 *   - the `FORBIDDEN:` code prefix, which is not user copy but how
 *     `@objectstack/rest`'s `handleApprovalError` derives 403 + the ADR-0112
 *     wire code before stripping it off the body's `error` string;
 *   - WHO may recall. The gate is byte-identical; only its message changed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import {
  ApprovalService,
  type ApprovalServiceOptions,
  type ApprovalNodeAutoOutcome,
} from './approval-service.js';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';

interface FakeRow { [k: string]: any }

/** The same minimal engine shape `approval-service.test.ts` uses. */
function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        const { field, order } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      const start = options?.offset ?? 0;
      return rows.slice(start, start + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    async update(object: string, data: any, options?: any) {
      // Pinned to ObjectQL.update's OWN dispatch predicate — a double looser
      // than the engine it stands in for turns a green suite into no suite.
      const dispatch = assertEngineUpdateDispatch(data, options);
      const t = ensure(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < t.length; i++) {
          if (matches(t[i], options?.where)) { t[i] = { ...t[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = t.findIndex(r => r.id === dispatch.id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const t = ensure(object);
      if (dispatch.kind === 'multi') {
        const survivors = t.filter(r => !matches(r, options?.where));
        const deleted = t.length - survivors.length;
        t.splice(0, t.length, ...survivors);
        return { deleted };
      }
      const i = t.findIndex(r => r.id === dispatch.id);
      if (i >= 0) t.splice(i, 1);
      return { id: dispatch.id };
    },
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

/**
 * `openNodeRequest` returns `ApprovalRequestRow | ApprovalNodeAutoOutcome` — the
 * second arm is the `onEmptyApprovers: 'auto_approve'` exit, which opens no
 * request at all. Narrowed rather than read through the union: every probe below
 * is about an OPENED request, and reading `.id` off the union bills the
 * package's TEST_DEBT ledger a raw TS2339 that
 * `pnpm --filter @objectstack/plugin-approvals typecheck` cannot see (its
 * tsconfig excludes `**\/*.test.ts`).
 */
function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) {
    throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  }
  return result;
}

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** The submitter — user A in the report. */
const SUBMITTER = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;
/** User B in the report: not the submitter, not an admin, Console set to zh-CN. */
const OTHER_ZH = {
  userId: 'u2', tenantId: 't1', positions: [], permissions: [], locale: 'zh-CN',
} as any;
const OTHER_EN = {
  userId: 'u2', tenantId: 't1', positions: [], permissions: [], locale: 'en',
} as any;
/** A platform admin — the #3424 stuck-record override. */
const ADMIN_ZH = {
  userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'], locale: 'zh-CN',
} as any;

/**
 * The zh-CN copy an operator actually reads, pinned as a LITERAL rather than
 * read back out of the catalog — a test that renders the catalog against
 * itself cannot tell Chinese from English. Its twin lives in
 * `packages/spec/src/system/operation-message.test.ts`; the two move together.
 */
const ZH_SENTENCE = '只有提交人可以撤回这条审批请求，如需撤回请联系提交人或管理员。';

/** What `@objectstack/rest`'s `handleApprovalError` does to a thrown message. */
const WIRE_CODE = (msg: string) => /^FORBIDDEN/.test(msg);
const WIRE_ERROR = (msg: string) => msg.replace(/^[A-Z_]+:\s*/, '');

describe('non-submitter recall refusal renders through the operation catalog (#11993)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let n = 0;
  const baseTime = new Date('2026-02-01T09:00:00Z').getTime();

  const svcFor = (extra: Partial<ApprovalServiceOptions> = {}) => new ApprovalService({
    engine: engine as any,
    clock: { now: () => new Date(baseTime + (n++) * 1000) },
    ...extra,
  });

  const openInput = () => ({
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'step_1',
    flowName: 'record_change_approval',
    config: {
      approvers: [{ type: 'user' as const, value: 'u9' }],
      behavior: 'first_response' as const,
    },
    record: { id: 'opp1', amount: 100 },
  });

  /** The report's setup: A submits, the request is pending, B opens the record. */
  const pendingRequest = async (svc: ApprovalService) =>
    opened(await svc.openNodeRequest(openInput(), SUBMITTER));

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
  });

  it('the reported symptom: a zh-CN operator reads Chinese, with no English spliced in', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);

    const err = await svc.recall(req.id, { actorId: 'u2' }, OTHER_ZH)
      .then(() => null, (e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(`FORBIDDEN: ${ZH_SENTENCE}`);
    // The half Console splices under 「撤回审批失败: 」 carries no Latin prose.
    // Before this conversion it was an entire English sentence.
    expect(WIRE_ERROR(err.message)).toBe(ZH_SENTENCE);
    expect(WIRE_ERROR(err.message)).not.toMatch(/[A-Za-z]/);
  });

  it('the status/code prefix survives the conversion — REST still answers 403 FORBIDDEN', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);

    const err = await svc.recall(req.id, { actorId: 'u2' }, OTHER_ZH)
      .then(() => null, (e: any) => e);

    // The prefix is the wire contract, not copy: `handleApprovalError` tests it
    // for the status and strips it off the body. A localized sentence must not
    // shadow it — `FORBIDDEN: 只有…` still matches, and still strips clean.
    expect(WIRE_CODE(err.message)).toBe(true);
    expect(WIRE_ERROR(err.message).startsWith('FORBIDDEN')).toBe(false);
  });

  it('renders each platform locale from the catalog, not one hardcoded sentence', async () => {
    for (const locale of ['en', 'ja-JP', 'es-ES'] as const) {
      // A fresh engine per locale: `openNodeRequest` refuses a second pending
      // request on the same record (`DUPLICATE_REQUEST`).
      engine = makeFakeEngine();
      const svc = svcFor();
      const req = await pendingRequest(svc);
      const err = await svc.recall(req.id, { actorId: 'u2' }, { ...OTHER_ZH, locale })
        .then(() => null, (e: any) => e);
      expect(WIRE_ERROR(err.message))
        .toBe(BUILTIN_OPERATION_MESSAGES[locale].approval_recall_not_submitter);
    }
  });

  it('no longer emits the legacy hardcoded English reason', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);
    const err = await svc.recall(req.id, { actorId: 'u2' }, OTHER_EN)
      .then(() => null, (e: any) => e);
    expect(err.message).not.toContain('only the submitter may recall this request');
  });

  it('an unknown locale falls back to English rather than to the bare key', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);
    const err = await svc.recall(req.id, { actorId: 'u2' }, { ...OTHER_ZH, locale: 'kl-GL' })
      .then(() => null, (e: any) => e);
    expect(WIRE_ERROR(err.message))
      .toBe(BUILTIN_OPERATION_MESSAGES.en.approval_recall_not_submitter);
    expect(WIRE_ERROR(err.message)).not.toBe('approval_recall_not_submitter');
  });

  it('a deployment `translation` for `errors.approval_recall_not_submitter` wins', async () => {
    const seen: string[] = [];
    const svc = svcFor({
      messageTranslator: () => (key: string, locale: string) => {
        seen.push(`${key}@${locale}`);
        return key === 'errors.approval_recall_not_submitter' && locale === 'zh-CN'
          ? '本单只能由发起人撤回,请联系发起人。'
          : key; // II18nService echoes the key back on a miss.
      },
    });
    const req = await pendingRequest(svc);
    const err = await svc.recall(req.id, { actorId: 'u2' }, OTHER_ZH)
      .then(() => null, (e: any) => e);

    expect(seen).toContain('errors.approval_recall_not_submitter@zh-CN');
    expect(WIRE_ERROR(err.message)).toBe('本单只能由发起人撤回,请联系发起人。');
  });

  it('a misbehaving i18n service degrades to the built-in copy, never to a 500', async () => {
    const svc = svcFor({
      messageTranslator: () => { throw new Error('i18n exploded'); },
    });
    const req = await pendingRequest(svc);
    const err = await svc.recall(req.id, { actorId: 'u2' }, OTHER_ZH)
      .then(() => null, (e: any) => e);

    // Still the refusal, still 403-shaped — not the i18n service's error.
    expect(err.message).toBe(`FORBIDDEN: ${ZH_SENTENCE}`);
  });

  it('logs the developer half — the ids the user-facing sentence deliberately omits', async () => {
    const warn: Array<[string, any]> = [];
    const svc = svcFor({ logger: { warn: (m: any, meta?: any) => { warn.push([String(m), meta]); } } });
    const req = await pendingRequest(svc);
    await svc.recall(req.id, { actorId: 'u2' }, OTHER_ZH).catch(() => {});

    const entry = warn.find(([m]) => m.includes('recall refused'));
    expect(entry).toBeTruthy();
    expect(entry![0]).toContain("actor 'u2'");
    expect(entry![0]).toContain("submitter 'u1'");
    expect(entry![1]).toMatchObject({ actor: 'u2', submitter: 'u1', status: 'pending' });
  });

  // ── WHO may recall is unchanged (the permission boundary) ─────────
  // This conversion touches the refusal's message and nothing else. These are
  // the controls that say so: the same three callers get the same three
  // answers they got before it.

  it('the submitter still recalls their own pending request', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);
    const out = await svc.recall(req.id, { actorId: 'u1' }, SUBMITTER);
    expect(out.request.status).toBe('recalled');
  });

  it('a #3424 admin still recalls a request they did not submit', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);
    const out = await svc.recall(req.id, { actorId: 'root' }, ADMIN_ZH);
    expect(out.request.status).toBe('recalled');
  });

  it('a plain non-submitter is still refused, and the request is untouched', async () => {
    const svc = svcFor();
    const req = await pendingRequest(svc);
    await expect(svc.recall(req.id, { actorId: 'u2' }, OTHER_ZH)).rejects.toThrow(/^FORBIDDEN/);
    const after = await svc.getRequest(req.id, SYS);
    expect(after!.status).toBe('pending');
  });
});
