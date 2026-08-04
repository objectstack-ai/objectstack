// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two `session.roles.includes('admin')` exemptions are gone (#4839) — and
 * this file is the evidence that nothing was stranded by removing them.
 *
 * ## What was wrong
 *
 * `lifecycle-hooks.ts` carried two admin bypasses, both reading
 * `ctx.session.roles`: one on the approval **record lock**, one on the
 * **delegation write-guard**. `roles` has no producer anywhere in the platform —
 * ObjectQL's `buildSession()` builds its session field by field and never writes
 * it — so both branches were dead on every real engine path. Classic
 * declared ≠ enforced: the spec's `HookContext` session declares
 * `roles: z.array(z.string()).optional()`, two consumers read it, and no
 * producer ever fills it.
 *
 * They also spoke a **second privilege dialect**. This codebase judges privilege
 * by the ADR-0095 vocabulary — capability grants (`permissions`), placements
 * (`positions`) and the posture derived from them — and ADR-0090 D3 bans the
 * `role` spelling outright. `roles.includes('admin')` is exactly the string
 * comparison those decisions exist to keep out. The sibling code in this very
 * package already does it right: `ApprovalService.isOverrideActor`.
 *
 * ## Why they were DELETED rather than rewired to `isOverrideActor`
 *
 * The maintainer ruled (2026-08-04) that the record lock gets no admin override
 * at all — "an admin edits a record while its approval is live" is a liability
 * for compliance-minded tenants, and the sanctioned rescue path already exists.
 * The delegation half was conditional on evidence, and the evidence is below,
 * executed rather than asserted in prose:
 *
 *   1. {@link describe} "a delegation cannot rescue an in-flight approval" — a
 *      delegation is consulted only while a request is being OPENED, so an admin
 *      forging one for an approver who has *already* gone unavailable would not
 *      have moved that approver's pending work anyway. The exemption could not
 *      do the job it was written for.
 *   2. {@link describe} "the sanctioned admin path covers an unavailable
 *      approver" — `reassign` / `recall` / `decideNode` reject, each gated by
 *      `isOverrideActor`, do cover it, including handing one named approver's
 *      slot to a substitute, which is precisely the "delegate for someone else"
 *      operation.
 *
 * Coverage exists, so delegation is now SELF-MANAGED as its final semantic.
 *
 * ## And the dialect must not come back
 *
 * The last describe is a source-level pin: no non-test source in this package
 * may name a `roles` identifier or compare a value against the string
 * `'admin'`. It is deliberately crude, because the thing it guards against is
 * crude — someone re-adding a plausible-looking admin shortcut next to a guard.
 * The spec-side retirement of `session.roles` is a separate protocol change
 * (ADR-0049 enforce-or-remove); this pin is what lets it start from a clean fact
 * base: zero consumers in this package.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';

import { ApprovalService } from './approval-service.js';
import { bindApprovalLockHook, bindDelegationWriteGuard } from './lifecycle-hooks.js';

interface FakeRow { [k: string]: any }

/** The same minimal engine shape `approval-service.test.ts` uses. */
function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const hooks: Record<string, Array<{ handler: (ctx: any) => any; object?: string | string[]; packageId?: string }>> = {};

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      if (k === '$and') {
        if (!(v as any[]).every(sub => matches(row, sub))) return false;
        continue;
      }
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
    async insert(object: string, data: any) {
      ensure(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      // [#4550] Pinned to ObjectQL.delete's OWN dispatch predicate. A double
      // looser than the engine it stands in for is how #4434 shipped a REST
      // route that answered 500 to every caller with its suite green.
      const dispatch = assertEngineDeleteDispatch(options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        const survivors = table.filter(r => !matches(r, options?.where));
        const deleted = table.length - survivors.length;
        table.splice(0, table.length, ...survivors);
        return { deleted };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table.splice(i, 1);
      return { id: dispatch.id };
    },
    registerHook(event: string, handler: (ctx: any) => any, options?: any) {
      (hooks[event] ??= []).push({ handler, object: options?.object, packageId: options?.packageId });
    },
    unregisterHooksByPackage(packageId: string): number {
      let n = 0;
      for (const ev of Object.keys(hooks)) {
        const before = hooks[ev].length;
        hooks[ev] = hooks[ev].filter(h => h.packageId !== packageId);
        n += before - hooks[ev].length;
      }
      return n;
    },
    async fire(event: string, ctx: any) {
      for (const h of hooks[event] ?? []) {
        if (h.object) {
          const objs = Array.isArray(h.object) ? h.object : [h.object];
          if (!objs.includes(ctx.object)) continue;
        }
        await h.handler(ctx);
      }
    },
  };
}

/** The submitter who opens every request below. */
const SUBMITTER = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;
const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** An ADR-0095 platform admin: an unscoped `admin_full_access` capability grant. */
const PLATFORM_ADMIN = { userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'] } as any;
/** The substitute who takes the unavailable approver's work. */
const SUBSTITUTE = { userId: 'u7', tenantId: 't1', positions: [], permissions: [] } as any;

/**
 * A properly STAFFED approval: one named, real approver (`u9`) — the person who
 * is about to go on sick leave. Not the #3424 "unstaffed position" shape; the
 * whole question here is what happens when a REAL approver becomes unavailable.
 */
const staffedInput = (approver = 'u9') => ({
  object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'approve_step',
  flowName: 'deal_approval',
  config: {
    approvers: [{ type: 'user' as const, value: approver }],
    behavior: 'first_response' as const,
    lockRecord: true,
  },
  record: { id: 'opp1', amount: 100 },
});

describe('#4839 evidence — a delegation cannot rescue an IN-FLIGHT approval', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
  });

  /** Declare an out-of-office delegation directly (bypassing the write guard). */
  const seedDelegation = (delegatorId: string, delegateId: string) => {
    engine._tables['sys_approval_delegation'] = [{
      id: 'del1', delegator_id: delegatorId, delegate_id: delegateId,
      valid_from: null, valid_until: null, reason: 'sick leave', organization_id: null,
    }];
  };

  it('a delegation declared AFTER the request opened does not move the pending slot', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    expect(req.pending_approvers).toEqual(['u9']);

    // u9 falls ill. Someone declares the delegation now — the very thing the
    // deleted admin exemption would have let an admin do on u9's behalf.
    seedDelegation('u9', 'u7');

    const after = await svc.getRequest(req.id, SYS);
    expect(after!.status).toBe('pending');
    // Still routed to u9. `applyOooDelegation` runs inside `resolveApproverSpec`,
    // i.e. at slate-resolution time, and this request's slate was resolved and
    // snapshotted when it opened. So the exemption could not have delivered the
    // outcome ("hand u9's pending approvals to u7") it was written for.
    expect(after!.pending_approvers).toEqual(['u9']);
  });

  it('the delegation DOES apply to a request opened afterwards — it is an open-time rule, nothing more', async () => {
    seedDelegation('u9', 'u7');
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    // Guard the guard: the delegation machinery is wired and working in this
    // fixture, so the assertion above is "does not apply to in-flight work",
    // not "delegation is broken here".
    expect(req.pending_approvers).toEqual(['u7']);
  });
});

describe('#4839 evidence — the sanctioned admin path covers an unavailable approver', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    bindApprovalLockHook(engine as any);
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100, stage: 'new' }];
  });

  /** An ordinary member's edit of the approval's target record. */
  const memberEdit = () => engine.fire('beforeUpdate', {
    object: 'opportunity',
    input: { id: 'opp1', data: { amount: 200 } },
    session: { isSystem: false, positions: [], permissions: [], userId: 'u1' },
  });

  it('REASSIGN: an admin hands the unavailable approver’s slot to a substitute, who decides normally', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    expect(req.pending_approvers).toEqual(['u9']);

    // This is the "delegate on someone else's behalf" operation, in the one
    // vocabulary the codebase has: `isOverrideActor` admits the admin even
    // though they hold no slot, and the hand-off is audited.
    const out = await svc.reassign(req.id, { actorId: 'root', to: 'u7', from: 'u9', comment: 'u9 on sick leave' }, PLATFORM_ADMIN);
    expect(out.request.pending_approvers).toEqual(['u7']);

    const decided = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u7' }, SUBSTITUTE);
    expect(decided.finalized).toBe(true);
    expect(decided.request.status).toBe('approved');
  });

  it('the reassign is audited as an override — the admin is never spoofed as the approver', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.reassign(req.id, { actorId: 'root', to: 'u7', from: 'u9' }, PLATFORM_ADMIN);
    const acts = await svc.listActions(req.id, SYS);
    expect(acts.at(-1)).toMatchObject({
      action: 'reassign', actor_id: 'root', reassign_from: 'u9', reassign_to: 'u7', via_override: true,
    });
  });

  it('RECALL: an admin withdraws the request, and THAT is what releases the record lock', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    // While the approval is live the record is locked — for everyone, admins
    // included (see `approval-service.test.ts`, "does NOT exempt ...").
    await expect(memberEdit()).rejects.toThrow(/RECORD_LOCKED/);

    const out = await svc.recall(req.id, { actorId: 'root', comment: 'approver unreachable' }, PLATFORM_ADMIN);
    expect(out.request.status).toBe('recalled');
    expect(out.request.pending_approvers).toEqual([]);

    // The lock keys on PENDING status, so finalising the request is the release.
    // The record was never edited under a live approval — the property the
    // deleted record-lock exemption would have broken.
    await expect(memberEdit()).resolves.toBeUndefined();
  });

  it('REJECT: an admin decides the request instead, which also releases the lock', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    const out = await svc.decideNode(req.id, { decision: 'reject', actorId: 'root', comment: 'approver left' }, PLATFORM_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('rejected');
    await expect(memberEdit()).resolves.toBeUndefined();
  });

  it('a NON-privileged member gets none of this — the override is a real gate, not an open door', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    const member = { userId: 'nobody', tenantId: 't1', positions: [], permissions: [] } as any;
    await expect(svc.reassign(req.id, { actorId: 'nobody', to: 'u7', from: 'u9' }, member)).rejects.toThrow(/FORBIDDEN/);
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'nobody' }, member)).rejects.toThrow(/FORBIDDEN/);
  });

  it('a `roles: [admin]` session gets none of it either — the retired dialect grants nothing anywhere', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    const fakeAdmin = { userId: 'pretender', tenantId: 't1', positions: [], permissions: [], roles: ['admin'] } as any;
    await expect(svc.reassign(req.id, { actorId: 'pretender', to: 'u7', from: 'u9' }, fakeAdmin)).rejects.toThrow(/FORBIDDEN/);
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'pretender' }, fakeAdmin)).rejects.toThrow(/FORBIDDEN/);
  });
});

describe('#4839 — the delegation guard has no admin exemption left', () => {
  const DEL = 'sys_approval_delegation';
  let engine: ReturnType<typeof makeFakeEngine>;

  beforeEach(() => {
    engine = makeFakeEngine();
    bindDelegationWriteGuard(engine as any);
  });

  const fireInsert = (data: any, session: any) =>
    engine.fire('beforeInsert', { object: DEL, input: { data }, session });

  it('an ADR-0095 platform admin may not declare a delegation for someone else', async () => {
    await expect(fireInsert({ delegator_id: 'u9', delegate_id: 'u7' }, PLATFORM_ADMIN))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('the system context still bypasses — service / seed / import writes are not user writes', async () => {
    await expect(fireInsert({ delegator_id: 'u9', delegate_id: 'u7' }, SYS)).resolves.toBeUndefined();
  });
});

// ── The dialect must not come back ───────────────────────────────────

/**
 * Strip `//` and block comments, keeping string and template literals intact.
 *
 * Comments are stripped because this file's own explanation — and the ones now
 * standing where the exemptions were — necessarily *name* the retired dialect.
 * A pin that could not tell an explanation from an implementation would force
 * the rationale out of the code, which is the failure ADR anchoring exists to
 * prevent (AGENTS.md Prime Directive #13).
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n) { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i]; i++;
      }
      if (i < n) { out += src[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Every shape of the retired admin dialect, as source patterns. */
const DIALECT_PATTERNS: Array<[string, RegExp]> = [
  ['a `roles` identifier (the session field ObjectQL never populates)', /\broles\b/],
  ["a membership test against the string 'admin'", /\.includes\(\s*(['"])admin\1/],
  ["an equality test against the string 'admin'", /[=!]==?\s*(['"])admin\1|(['"])admin\2\s*[=!]==?/],
];

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { collectSources(full, acc); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;   // fixtures legitimately build the shape
    acc.push(full);
  }
  return acc;
}

describe('#4839 pin — `session.roles` has zero readers left in plugin-approvals', () => {
  const SRC = fileURLToPath(new URL('.', import.meta.url));
  const sources = collectSources(SRC);

  it('the scan actually reads this package’s sources', () => {
    // Guard the guard: a broken path or a too-eager filter would make every
    // assertion below pass over an empty list.
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some(f => f.endsWith('lifecycle-hooks.ts'))).toBe(true);
    expect(sources.some(f => f.endsWith('approval-service.ts'))).toBe(true);
    expect(sources.every(f => !f.endsWith('.test.ts'))).toBe(true);
  });

  it('the comment stripper keeps code and strings, and drops only comments', () => {
    expect(stripComments("const a = 1; // roles.includes('admin')\nconst b = 2;"))
      .toBe('const a = 1; \nconst b = 2;');
    expect(stripComments("/* roles */ const c = 'admin';")).toBe(" const c = 'admin';");
    // A `//` inside a string is not a comment — a stripper that thought so would
    // silently blind the scan from that point on.
    expect(stripComments("const u = 'https://x'; const r = roles;")).toContain('roles');
  });

  it.each(DIALECT_PATTERNS)('no non-test source contains %s', (_label, pattern) => {
    const offenders = sources
      .filter(file => pattern.test(stripComments(readFileSync(file, 'utf8'))))
      .map(file => file.slice(SRC.length));
    expect(offenders, [
      `The retired admin dialect (#4839) reappeared in: ${offenders.join(', ')}.`,
      'Privilege in this codebase is judged by the ADR-0095 vocabulary — capability',
      'grants (`permissions`), placements (`positions`) and the derived posture —',
      'never by a session field named `roles` or a comparison against the string',
      "'admin' (ADR-0090 D3 bans the `role` spelling outright). `session.roles` has",
      'no producer at all: ObjectQL\'s `buildSession()` never writes it, so a guard',
      'reading it is dead code that merely LOOKS like an authorization decision.',
      'Reuse `ApprovalService.isOverrideActor` (or its exact predicate) instead.',
    ].join('\n')).toEqual([]);
  });

  it('detects the dialect when it IS present — the patterns are not vacuous', () => {
    const reintroduced = "const roles = ctx.session.roles ?? []; if (roles.includes('admin')) return;";
    const stripped = stripComments(reintroduced);
    for (const [, pattern] of DIALECT_PATTERNS.slice(0, 2)) {
      expect(pattern.test(stripped)).toBe(true);
    }
    expect(DIALECT_PATTERNS[2][1].test("if (r === 'admin') return;")).toBe(true);
  });
});
