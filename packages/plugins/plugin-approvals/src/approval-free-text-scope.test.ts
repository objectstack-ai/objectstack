// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The snapshot column is not a free-text predicate for a caller who reads it
 * redacted (#11040).
 *
 * ## The property being pinned
 *
 * `sys_approval_request.payload_json` holds the submitted record's row, and
 * since #10749 the serve path masks it PER READER — each row's snapshot is cut
 * down to the fields that caller may read on that row's subject object. A
 * filter, however, is evaluated by the driver against the column AT REST, which
 * is unmasked by design (the approval record stays audit evidence of what was
 * actually submitted). So a predicate over that column is a question about its
 * contents answered through row membership, and for a caller whose view of
 * those contents is masked that question is one the masking exists to refuse.
 *
 * The property enforced here: **for a caller whose view of the snapshot is
 * masked, the snapshot column is not among the columns free-text search
 * matches.** The four other searched columns — `process_name`, `object_name`,
 * `record_id`, `submitter_id` — are columns of `sys_approval_request` itself,
 * read whole by anyone who can see the row at all, and are untouched.
 *
 * ## Why each direction below is load-bearing
 *
 *   1. **narrowed** — a masked caller's free-text search no longer matches on
 *      snapshot contents. This is the defect closed.
 *   2. **still searches** — the SAME masked caller still matches on the four
 *      columns they read whole, in the same order. Without this, an
 *      implementation that dropped free-text search altogether — or that
 *      shipped an empty `$or` — scores green on (1) alone while removing a
 *      shipped capability.
 *   3. **unmasked unchanged** — a caller the serve path hands the whole
 *      snapshot to keeps today's behaviour exactly: same rows, same order.
 *      Without this, "drop the arm for everyone" scores green on (1) and (2).
 *   4. **same authority as serve** — the masked/unmasked verdict is read from
 *      the seam `redactPayloads` reads, asked as the CALLER about the SAME
 *      object. A second, independently derived notion of "redacted" would
 *      drift from serve, and that drift is the defect one layer down.
 *
 * (3) has two shapes, and they are not interchangeable. Serve declines to
 * narrow both when NO authority is wired (the shape every deployment that has
 * not wired the security plugin runs) and when a wired authority answers
 * `undefined` — "schema unresolvable", explicitly NOT a denial (#3807). The
 * rule here is CONSISTENCY WITH SERVE, not blanket fail-closed: hardening the
 * `undefined` case into a narrowing serve itself does not perform would invent
 * a behaviour with no counterpart on the way out.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';

const OBJECT = 'expense_report';
const TENANT = 't1';
/** A participant whose view of the snapshot is masked. */
const APPROVER = 'finance_user';

/** Appears ONLY inside a restricted snapshot field, in no searched column. */
const SNAPSHOT_ONLY_TOKEN = '98000';
/**
 * Appears inside a restricted snapshot field of the NEWER request, and in the
 * `record_id` column of the OLDER one — so one query exercises both an arm the
 * masked caller loses and an arm they keep.
 */
const SPLIT_TOKEN = 'zeta';

const ROW_A = {
  id: 'exp_1', title: 'Q1 travel', amount: 1200, submitted_by: 'employee_7',
  salary: SNAPSHOT_ONLY_TOKEN, internal_notes: `${SPLIT_TOKEN} flagged for audit`,
};
const ROW_B = {
  id: `exp_${SPLIT_TOKEN}_2`, title: 'Q2 travel', amount: 300, submitted_by: 'employee_9',
};

const REQ_A = 'req_a';
const REQ_B = 'req_b';

/** What the masked caller may read on the subject object. */
const APPROVER_READABLE = ['id', 'title', 'amount', 'submitted_by'];

interface FakeRow { [k: string]: any }

/**
 * Engine double. `$contains` is modelled because it is the operator under
 * test — a double that ignored it would match every row and make the whole
 * file vacuous.
 *
 * ⛔ No `update` / `delete` ON PURPOSE: this file's subject is the READ path
 * (`listRequests` / `countRequests`), which reaches no write verb, so declaring
 * them would add an engine double to `check:engine-double-contract`'s pinned
 * ledger for coverage nothing here exercises. A future test in this file that
 * drives a write adds them back routed through `assertEngineUpdateDispatch` /
 * `assertEngineDeleteDispatch` — never a hand-mirrored copy of the check.
 */
function makeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  /** Every `where` the service pushed down for `sys_approval_request`. */
  const requestWheres: any[] = [];
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') { if (!(v as any[]).some(s => matches(row, s))) return false; continue; }
      if (k === '$and') { if (!(v as any[]).every(s => matches(row, s))) return false; continue; }
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false; continue;
      }
      if (v != null && typeof v === 'object' && '$contains' in (v as any)) {
        if (!String(rv ?? '').includes(String((v as any).$contains))) return false; continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    _requestWheres: requestWheres,
    async find(object: string, options?: any) {
      const where = options?.filter ?? options?.where;
      if (object === 'sys_approval_request') requestWheres.push(where);
      let rows = ensure(object).filter(r => matches(r, where));
      const order = Array.isArray(options?.orderBy) ? options.orderBy[0] : undefined;
      if (order?.field) {
        const dir = String(order.order ?? 'asc').toLowerCase() === 'desc' ? -1 : 1;
        rows = [...rows].sort((x, y) =>
          (String(x[order.field] ?? '') < String(y[order.field] ?? '') ? -1 : 1) * dir);
      }
      return rows.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
  };
}

/**
 * Field-visibility double standing in for `plugin-security`'s
 * `getReadableFields`, reproducing the three answers the real method gives —
 * a field list, `undefined` (schema unresolvable, NOT a denial) and `[]` (the
 * plugin's own fail-closed tier) — because the seam branches on all three.
 */
function makeVisibility(answers: Record<string, string[] | undefined>) {
  const calls: Array<{ object: string; context: any }> = [];
  return {
    _calls: calls,
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      calls.push({ object, context });
      if (context?.isSystem) return Object.keys(ROW_A);
      return answers[object];
    },
  };
}

const asUser = (userId: string) =>
  ({ userId, tenantId: TENANT, positions: [], permissions: [] }) as any;

function seed(engine: ReturnType<typeof makeEngine>) {
  const req = (id: string, row: FakeRow, createdAt: string) => ({
    id,
    organization_id: TENANT,
    process_name: 'flow:expense_review',
    object_name: OBJECT,
    record_id: row.id,
    submitter_id: row.submitted_by ?? 'employee_7',
    status: 'pending',
    current_step: 'finance',
    pending_approvers: APPROVER,
    payload_json: JSON.stringify(row),
    created_at: createdAt,
  });
  // A is NEWER than B — the order assertions below depend on it.
  engine._tables['sys_approval_request'] = [
    req(REQ_A, ROW_A, '2026-08-03T00:00:00Z'),
    req(REQ_B, ROW_B, '2026-08-02T00:00:00Z'),
  ];
  engine._tables['sys_approval_approver'] = [
    { id: 'idx_a', request_id: REQ_A, approver: APPROVER, organization_id: TENANT },
    { id: 'idx_b', request_id: REQ_B, approver: APPROVER, organization_id: TENANT },
  ];
  engine._tables['sys_approval_action'] = [];
}

/**
 * The `$or` arms of the last pushed-down request predicate.
 *
 * Indexed from the end by hand rather than with `Array.prototype.at`: this
 * package compiles against `lib: ES2021`, where `at` does not exist.
 */
function lastFreeTextArms(engine: ReturnType<typeof makeEngine>): any[] {
  const pushed = engine._requestWheres.filter(w => w && '$or' in w);
  const where = pushed.length > 0 ? pushed[pushed.length - 1] : undefined;
  return (where?.$or ?? []) as any[];
}

/** Which columns the last free-text predicate matched on. */
function lastFreeTextColumns(engine: ReturnType<typeof makeEngine>): string[] {
  return lastFreeTextArms(engine).map(a => Object.keys(a)[0]).sort();
}

const UNMASKED_COLUMNS =
  ['object_name', 'payload_json', 'process_name', 'record_id', 'submitter_id'];
const MASKED_COLUMNS =
  ['object_name', 'process_name', 'record_id', 'submitter_id'];

describe('#11040 free-text search does not push a predicate onto a masked snapshot', () => {
  let engine: ReturnType<typeof makeEngine>;
  let service: ApprovalService;

  beforeEach(() => {
    engine = makeEngine();
    seed(engine);
    service = new ApprovalService({ engine: engine as any });
  });

  describe('(1) narrowed — a masked caller', () => {
    beforeEach(() => {
      service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }));
    });

    it('object-filtered scope: a term carried only by a restricted snapshot field matches nothing', async () => {
      const rows = await service.listRequests(
        { object: OBJECT, q: SNAPSHOT_ONLY_TOKEN }, asUser(APPROVER),
      );

      expect(rows).toEqual([]);
      expect(lastFreeTextColumns(engine)).toEqual(MASKED_COLUMNS);
    });

    it('UNFILTERED scope: the scope spans every object, so the arm is dropped there too', async () => {
      const rows = await service.listRequests({ q: SNAPSHOT_ONLY_TOKEN }, asUser(APPROVER));

      expect(rows).toEqual([]);
      expect(lastFreeTextColumns(engine)).toEqual(MASKED_COLUMNS);
    });

    it('`countRequests` agrees with the list it paginates', async () => {
      const n = await service.countRequests(
        { object: OBJECT, q: SNAPSHOT_ONLY_TOKEN }, asUser(APPROVER),
      );
      expect(n).toBe(0);
    });

    it('the security plugin\'s own fail-closed tier (`[]`) drops the arm', async () => {
      service.attachFieldVisibility(makeVisibility({ [OBJECT]: [] }));

      const rows = await service.listRequests(
        { object: OBJECT, q: SNAPSHOT_ONLY_TOKEN }, asUser(APPROVER),
      );
      expect(rows).toEqual([]);
      expect(lastFreeTextColumns(engine)).toEqual(MASKED_COLUMNS);
    });
  });

  describe('(2) still searches — the same masked caller keeps the columns they read whole', () => {
    beforeEach(() => {
      service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }));
    });

    it('matches on `record_id` and drops only the snapshot arm', async () => {
      const rows = await service.listRequests(
        { object: OBJECT, q: SPLIT_TOKEN }, asUser(APPROVER),
      );

      // B matches on `record_id` — kept. A matches ONLY inside the snapshot —
      // gone. Both halves in one assertion, so neither can drift alone.
      expect(rows.map(r => r.id)).toEqual([REQ_B]);
    });

    it('the `$or` is never empty — four arms always remain', async () => {
      await service.listRequests({ object: OBJECT, q: SPLIT_TOKEN }, asUser(APPROVER));

      const arms = lastFreeTextArms(engine);
      // An empty `$or: []` reads as match-none on some drivers and match-all on
      // others; either would be a silent second defect.
      expect(arms.length).toBe(4);
      expect(lastFreeTextColumns(engine)).toEqual(MASKED_COLUMNS);
      for (const arm of arms) {
        expect(Object.values(arm)[0]).toEqual({ $contains: SPLIT_TOKEN });
      }
    });

    it('a search with no free-text term pushes no `$or` at all', async () => {
      await service.listRequests({ object: OBJECT }, asUser(APPROVER));
      expect(engine._requestWheres.some(w => w && '$or' in w)).toBe(false);
    });
  });

  describe('(3) unmasked unchanged — a caller the serve path hands the whole snapshot', () => {
    it('no authority wired (the un-wired deployment): same rows, same order', async () => {
      const rows = await service.listRequests(
        { object: OBJECT, q: SPLIT_TOKEN }, asUser(APPROVER),
      );

      // A (newer) matched via the snapshot, B via `record_id`; `created_at`
      // desc. This is today's behaviour, unchanged.
      expect(rows.map(r => r.id)).toEqual([REQ_A, REQ_B]);
      expect(lastFreeTextColumns(engine)).toEqual(UNMASKED_COLUMNS);
    });

    it('no authority wired: the snapshot-only term still matches', async () => {
      const rows = await service.listRequests(
        { object: OBJECT, q: SNAPSHOT_ONLY_TOKEN }, asUser(APPROVER),
      );
      expect(rows.map(r => r.id)).toEqual([REQ_A]);
    });

    it('no authority wired + UNFILTERED scope: still unchanged (the verdict is uniform over every object)', async () => {
      const rows = await service.listRequests({ q: SPLIT_TOKEN }, asUser(APPROVER));

      expect(rows.map(r => r.id)).toEqual([REQ_A, REQ_B]);
      expect(lastFreeTextColumns(engine)).toEqual(UNMASKED_COLUMNS);
    });

    it('`undefined` readable set is NOT a denial (#3807) — serve does not narrow, so neither does the filter', async () => {
      service.attachFieldVisibility(makeVisibility({ [OBJECT]: undefined }));

      const rows = await service.listRequests(
        { object: OBJECT, q: SPLIT_TOKEN }, asUser(APPROVER),
      );

      // Consistency with serve, not blanket fail-closed: hardening this case
      // would invent a narrowing the way out does not perform.
      expect(rows.map(r => r.id)).toEqual([REQ_A, REQ_B]);
      expect(lastFreeTextColumns(engine)).toEqual(UNMASKED_COLUMNS);
    });
  });

  describe('(4) same authority as serve', () => {
    it('asks the visibility seam as the CALLER, about the SUBJECT object', async () => {
      const vis = makeVisibility({ [OBJECT]: APPROVER_READABLE });
      service.attachFieldVisibility(vis);

      await service.listRequests({ object: OBJECT, q: SPLIT_TOKEN }, asUser(APPROVER));

      const predicateCall = vis._calls[0];
      expect(predicateCall.object).toBe(OBJECT);
      expect(predicateCall.context?.userId).toBe(APPROVER);
      // ⛔ Not SYSTEM_CTX: the service loads ROWS as system, but asking the
      // visibility question as system would unmask every predicate.
      expect(predicateCall.context?.isSystem).toBeFalsy();
    });

    it('does not ask at all when there is no free-text term to scope', async () => {
      const vis = makeVisibility({ [OBJECT]: APPROVER_READABLE });
      service.attachFieldVisibility(vis);

      await service.listRequests({ object: OBJECT, status: 'pending' }, asUser(APPROVER));

      // The serve path still asks on the way out; what must not happen is a
      // predicate-time probe for a query that has no free-text arm to govern.
      expect(vis._calls.filter(c => c.context?.userId === APPROVER).length).toBeLessThanOrEqual(1);
    });
  });
});
