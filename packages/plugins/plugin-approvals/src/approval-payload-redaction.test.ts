// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-time redaction of the approval payload snapshot (#10749).
 *
 * ## What is being pinned, and why each direction is load-bearing
 *
 * The maintainer ruled Option B on 2026-08-22: the full snapshot stays AT REST
 * in `sys_approval_request.payload_json` (so the approval record still proves
 * what was actually submitted), and redaction happens at SERVE time, keyed on
 * the reading caller. Three of the four directions below exist because a
 * plausible wrong implementation scores green without them:
 *
 *   1. **leak closed** — a non-admin approver does not receive the
 *      FLS-restricted keys. Asserted BY NAME, not by shape: a shape assertion
 *      ("payload has 4 keys") passes against a redactor that removed the wrong
 *      four.
 *   2. **audit preserved** — the stored column still holds the whole row. A
 *      write-time TRIM would pass a leak-only suite while silently taking
 *      Option A, the option the maintainer declined. This is asserted against
 *      the table, separately from anything served.
 *   3. **still-served** — the approver still receives the business fields the
 *      drawer renders. A seam that redacted everything would also score green
 *      on a leak-only suite, and would break every approval drawer shipping
 *      today.
 *   4. **admin unchanged** — a caller who may read every field still gets the
 *      whole snapshot. This is what makes the change read-time MASKING rather
 *      than trimming; without it (2) and (3) can both hold while the feature is
 *      really a trim with an exception list.
 *
 * ## Both doors, each with its own assertion
 *
 * `payload_json` has two independent read doors, and one pin does not stand for
 * the other:
 *
 *   - **the service door** — `ApprovalService.getRequest` / `listRequests`,
 *     behind `GET /api/v1/approvals/requests[/:id]`, which serve the PARSED
 *     `payload` (plus `payload_display` / `payload_labels` derived from its
 *     keys);
 *   - **the generic data door** — the object declares
 *     `enable.apiMethods: ['get','list']`, so a plain `find`/`findOne` on
 *     `sys_approval_request` returns the RAW `payload_json` string without the
 *     service ever running. Registering at the engine covers the whole family
 *     that shares that producer (REST data routes, ObjectQL, CSV/XLSX export,
 *     MCP).
 *
 * The derived-map pin (`payload_labels`) is not decoration either: those maps
 * are built by walking the snapshot's own keys, so a seam that redacted AFTER
 * enrichment would still ship a restricted field's NAME and authored LABEL.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';
import { redactSnapshot } from './payload-redaction.js';
import {
  bindSnapshotRedactionMiddleware,
  redactRowsInPlace,
  APPROVAL_REQUEST_OBJECT,
} from './payload-redaction-middleware.js';

const OBJECT = 'expense_report';
const RECORD = 'exp_1';
const REQUEST = 'req_1';
const TENANT = 't1';
const APPROVER = 'finance_user';
/**
 * A second approver on the SAME request who holds read on every field. Modelled
 * as a participant on purpose: `getRequest` enforces #3590 participation before
 * any of this runs, so a non-participant "admin" would answer `null` and the
 * pin below would be measuring visibility, not field masking.
 */
const ADMIN = 'finance_admin';

/** The full submitted row, as the flow's `$record` handed it over. */
const FULL_ROW = {
  id: RECORD,
  title: 'Q1 travel',
  amount: 1200,
  submitted_by: 'employee_7',
  // Field-level restricted on the SUBJECT object — the leak this closes.
  salary: 98000,
  ssn: '123-45-6789',
  internal_notes: 'flagged for audit',
};

/** What a restricted approver may read on `expense_report`. */
const APPROVER_READABLE = ['id', 'title', 'amount', 'submitted_by'];
/** The keys an approver must NOT receive — asserted by name throughout. */
const RESTRICTED = ['salary', 'ssn', 'internal_notes'];

interface FakeRow { [k: string]: any }

/**
 * Engine double. The `sys_approval_*` tables are open because the service reads
 * them with `SYSTEM_CTX` on purpose; this file's subject is what happens to the
 * SNAPSHOT on the way out, not who may load the request.
 */
function makeEngine() {
  const tables: Record<string, FakeRow[]> = {};
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
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      return rows.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    // ⛔ No `update` / `delete` here ON PURPOSE. This file's subject is the READ
    // path (`getRequest` / `listRequests` / a generic `find`), which never
    // reaches a write verb — so declaring the two verbs would add an engine
    // double to `check:engine-double-contract`'s pinned ledger for coverage
    // nothing here exercises. If a future test in this file drives a write, add
    // them back routed through `assertEngineUpdateDispatch` /
    // `assertEngineDeleteDispatch` (never a hand-mirrored copy of the check)
    // and run the gate's `--write` in the same edit.
  };
}

/**
 * Field-visibility double standing in for `plugin-security`'s
 * `getReadableFields`. It reproduces the three answers that method actually
 * gives, because this seam branches on all three: a field list, `undefined`
 * (schema unresolvable — NOT a denial, #3807) and `[]` (the plugin's own
 * fail-closed tier).
 */
function makeVisibility(answers: Record<string, string[] | undefined>, opts?: { throwFor?: string }) {
  const calls: Array<{ object: string; context: any }> = [];
  return {
    _calls: calls,
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      calls.push({ object, context });
      if (opts?.throwFor === object) throw new Error('metadata unavailable');
      // Mirrors the real method's `isSystem` bypass: system reads see everything.
      if (context?.isSystem) return Object.keys(FULL_ROW);
      return answers[object];
    },
  };
}

const asUser = (userId: string) =>
  ({ userId, tenantId: TENANT, positions: [], permissions: [] }) as any;

function seed(engine: ReturnType<typeof makeEngine>) {
  engine._tables[OBJECT] = [{ ...FULL_ROW, organization_id: TENANT }];
  engine._tables['sys_approval_request'] = [{
    id: REQUEST,
    organization_id: TENANT,
    process_name: 'flow:expense_review',
    object_name: OBJECT,
    record_id: RECORD,
    submitter_id: 'employee_7',
    status: 'pending',
    current_step: 'finance',
    pending_approvers: [APPROVER, ADMIN].join(','),
    payload_json: JSON.stringify(FULL_ROW),
    created_at: '2026-08-01T00:00:00Z',
  }];
  engine._tables['sys_approval_approver'] = [
    { id: 'idx_1', request_id: REQUEST, approver: APPROVER, organization_id: TENANT },
    { id: 'idx_2', request_id: REQUEST, approver: ADMIN, organization_id: TENANT },
  ];
  engine._tables['sys_approval_action'] = [];
}

/** The snapshot still in the column — the audit-preservation probe. */
function storedSnapshot(engine: ReturnType<typeof makeEngine>): Record<string, unknown> {
  return JSON.parse(String(engine._tables['sys_approval_request'][0].payload_json));
}

describe('#10749 payload snapshot redaction — the service door', () => {
  let engine: ReturnType<typeof makeEngine>;
  let service: ApprovalService;

  beforeEach(() => {
    engine = makeEngine();
    seed(engine);
    service = new ApprovalService({ engine: engine as any });
  });

  it('(1) leak closed + (3) still-served: a restricted approver loses the restricted keys BY NAME and keeps the business ones', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }));

    const row = await service.getRequest(REQUEST, asUser(APPROVER));
    const payload = row!.payload as Record<string, unknown>;

    // (1) leak closed — by name, not by shape.
    for (const key of RESTRICTED) {
      expect(payload, `restricted key '${key}' must not be served`).not.toHaveProperty(key);
    }
    // (3) still-served — the drawer still renders.
    expect(payload).toMatchObject({
      id: RECORD, title: 'Q1 travel', amount: 1200, submitted_by: 'employee_7',
    });
  });

  it('(2) audit preserved: the stored column still holds the WHOLE row after a restricted read', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }));

    await service.getRequest(REQUEST, asUser(APPROVER));

    // A write-time trim would have taken Option A and would fail here while
    // passing every leak-only assertion above.
    expect(storedSnapshot(engine)).toEqual(FULL_ROW);
    for (const key of RESTRICTED) {
      expect(storedSnapshot(engine)).toHaveProperty(key);
    }
  });

  it('(4) admin unchanged: a caller who may read every field still receives the whole snapshot', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: Object.keys(FULL_ROW) }));

    const row = await service.getRequest(REQUEST, asUser(ADMIN));

    expect(row!.payload).toEqual(FULL_ROW);
    for (const key of RESTRICTED) expect(row!.payload).toHaveProperty(key);
  });

  it('derived maps are clean: `payload_labels` never carries a restricted key (redaction runs BEFORE enrichment)', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }));

    const row = await service.getRequest(REQUEST, asUser(APPROVER)) as any;

    for (const key of RESTRICTED) {
      expect(Object.keys(row.payload_labels ?? {})).not.toContain(key);
      expect(Object.keys(row.payload_display ?? {})).not.toContain(key);
    }
  });

  it('the list door narrows too — one door\'s pin does not stand for another\'s', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }));

    const rows = await service.listRequests({ approverId: APPROVER }, asUser(APPROVER));

    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    for (const key of RESTRICTED) expect(payload).not.toHaveProperty(key);
    expect(payload).toHaveProperty('amount', 1200);
  });

  it('redaction is keyed on the READING caller, and asks about the SUBJECT object', async () => {
    const vis = makeVisibility({ [OBJECT]: APPROVER_READABLE });
    service.attachFieldVisibility(vis);

    await service.getRequest(REQUEST, asUser(APPROVER));

    expect(vis._calls).toHaveLength(1);
    expect(vis._calls[0].object).toBe(OBJECT);
    expect(vis._calls[0].context?.userId).toBe(APPROVER);
    // ⛔ Not SYSTEM_CTX: the service loads the ROW as system, but the
    // visibility question must be asked as the caller, or every read unmasks.
    expect(vis._calls[0].context?.isSystem).toBeFalsy();
  });

  it('no security service wired ⇒ served exactly as before (no new way for a drawer to render empty)', async () => {
    const row = await service.getRequest(REQUEST, asUser(APPROVER));
    expect(row!.payload).toEqual(FULL_ROW);
  });

  it('`undefined` readable set is NOT a denial (#3807) — the snapshot passes through whole', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: undefined }));
    const row = await service.getRequest(REQUEST, asUser(APPROVER));
    expect(row!.payload).toEqual(FULL_ROW);
  });

  it('`[]` IS a denial — the security plugin\'s own fail-closed tier is honoured', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: [] }));
    const row = await service.getRequest(REQUEST, asUser(APPROVER));
    expect(row!.payload).toEqual({});
    // and still nothing was trimmed at rest.
    expect(storedSnapshot(engine)).toEqual(FULL_ROW);
  });

  it('a THROW from the visibility authority serves unredacted rather than blanking every drawer', async () => {
    service.attachFieldVisibility(makeVisibility({ [OBJECT]: APPROVER_READABLE }, { throwFor: OBJECT }));
    const row = await service.getRequest(REQUEST, asUser(APPROVER));
    expect(row!.payload).toEqual(FULL_ROW);
  });
});

describe('#10749 payload snapshot redaction — the generic data door', () => {
  it('a generic read is narrowed: the RAW `payload_json` string loses the restricted keys and keeps the business ones', async () => {
    const rows = [{
      id: REQUEST, object_name: OBJECT, payload_json: JSON.stringify(FULL_ROW),
    }];
    await redactRowsInPlace(rows, makeVisibility({ [OBJECT]: APPROVER_READABLE }), asUser(APPROVER));

    const served = JSON.parse(rows[0].payload_json);
    for (const key of RESTRICTED) expect(served).not.toHaveProperty(key);
    expect(served).toMatchObject({ id: RECORD, title: 'Q1 travel', amount: 1200 });
  });

  it('an admin generic read still returns the whole snapshot', async () => {
    const rows = [{ id: REQUEST, object_name: OBJECT, payload_json: JSON.stringify(FULL_ROW) }];
    await redactRowsInPlace(rows, makeVisibility({ [OBJECT]: Object.keys(FULL_ROW) }), asUser(ADMIN));
    expect(JSON.parse(rows[0].payload_json)).toEqual(FULL_ROW);
  });

  it('is registered against `sys_approval_request` only, and skips writes and system reads', async () => {
    const registered: Array<{ fn: any; options: any }> = [];
    const engine = { registerMiddleware: (fn: any, options: any) => registered.push({ fn, options }) };
    bindSnapshotRedactionMiddleware(engine, () => makeVisibility({ [OBJECT]: APPROVER_READABLE }));

    expect(registered).toHaveLength(1);
    expect(registered[0].options).toEqual({ object: APPROVAL_REQUEST_OBJECT });

    const mw = registered[0].fn;
    const rowsFor = () => [{ id: REQUEST, object_name: OBJECT, payload_json: JSON.stringify(FULL_ROW) }];

    // A read as a restricted caller narrows.
    const read: any = { operation: 'find', context: asUser(APPROVER), result: rowsFor() };
    await mw(read, async () => {});
    expect(JSON.parse(read.result[0].payload_json)).not.toHaveProperty('ssn');

    // A SYSTEM read is the audit/replay channel — untouched.
    const sys: any = { operation: 'find', context: { isSystem: true }, result: rowsFor() };
    await mw(sys, async () => {});
    expect(JSON.parse(sys.result[0].payload_json)).toEqual(FULL_ROW);

    // A write is not a serve door — untouched.
    const write: any = { operation: 'update', context: asUser(APPROVER), result: rowsFor() };
    await mw(write, async () => {});
    expect(JSON.parse(write.result[0].payload_json)).toEqual(FULL_ROW);
  });
});

describe('#10749 redactSnapshot — the shape contract', () => {
  it('drops exactly the keys outside the readable set, and reports them', () => {
    const out = redactSnapshot(FULL_ROW, APPROVER_READABLE);
    expect(out.redactedKeys).toEqual(['internal_notes', 'salary', 'ssn']);
    expect(Object.keys(out.payload as object).sort()).toEqual([...APPROVER_READABLE].sort());
  });

  it('passes a non-object snapshot through — field visibility governs COLUMNS', () => {
    for (const v of ['a string', 42, null, ['a', 'b']]) {
      expect(redactSnapshot(v, APPROVER_READABLE).payload).toEqual(v);
    }
  });

  it('returns the SAME reference when nothing was removed (no needless rewrite)', () => {
    const out = redactSnapshot(FULL_ROW, Object.keys(FULL_ROW));
    expect(out.payload).toBe(FULL_ROW);
    expect(out.redactedKeys).toEqual([]);
  });
});
