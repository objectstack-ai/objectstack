// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20964] A snapshot field the reading caller is served MASKED is not served
 * as stored.
 *
 * ## What is pinned, and why each half is load-bearing
 *
 * The data plane serves a field whose `maskingRule` applies to the caller with
 * its value replaced. The security contract's read projection,
 * `getReadableFields`, therefore counts that field READABLE: it is a served
 * column. A snapshot redaction that narrows by the read projection alone keeps
 * the key, and with it the value as it was captured at submission time.
 *
 * The contract's query-side answer, `getQueryableFields` (#20935), is a subset of
 * the read projection that differs from it by exactly the fields this caller is
 * served masked. The redaction reads that answer and drops those keys. It does
 * not re-derive who a masking rule applies to, and it does not reproduce the
 * mask: the contract publishes WHICH fields are masked for a caller, not the
 * masked value.
 *
 *   1. **not served as stored** — for a caller the rule applies to, the key is
 *      absent from the served snapshot, on both read doors (the service door and
 *      the generic data door), and from the derived maps built from its keys.
 *   2. **control** — for a caller who holds what lifts the rule, the same key
 *      carries the stored value. Without it, a redaction that dropped the field
 *      for everyone would pass (1).
 *   3. **audit preserved** — the stored column still holds the whole row.
 *   4. **fail closed** — a source that cannot say which readable fields are
 *      masked for this caller (the answer is missing, `undefined`, or throws) is
 *      served no snapshot field, as the contract obliges a consumer that cannot
 *      get the answer. An unresolvable read projection still passes the
 *      snapshot through whole, exactly as before (#3807).
 *   5. **wiring** — the approvals plugin's bridge to the `security` service
 *      forwards the query-side answer as well as the read projection.
 *
 * The source double below mirrors the contract's two answers per caller; the
 * real `SecurityPlugin` composition is pinned at the HTTP door in
 * `packages/qa/dogfood/test/approval-snapshot-masked-field.dogfood.test.ts`.
 * Fixtures are synthetic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { type FieldVisibilitySource } from './payload-redaction.js';
import { redactRowsInPlace } from './payload-redaction-middleware.js';

const OBJECT = 'probe_note';
const RECORD = 'pn_1';
const REQUEST = 'req_pn_1';
const TENANT = 't1';
/** An approver the field's masking rule applies to. */
const MEMBER = 'probe_member';
/** An approver on the same request who holds what lifts the rule. */
const UNMASKER = 'probe_unmasker';
/** The field served masked to MEMBER. */
const MASKED_KEY = 'probe_code';

/** The submitted row, as the flow handed it over. Synthetic values. */
const FULL_ROW = {
  id: RECORD,
  title: 'Synthetic note',
  amount: 10,
  [MASKED_KEY]: 'SYNTH-0000-VALUE',
};
const ALL_FIELDS = Object.keys(FULL_ROW);
const BUSINESS = { id: RECORD, title: 'Synthetic note', amount: 10 };

type Answer = string[] | undefined;

/**
 * The contract's two answers for each caller: the read projection counts the
 * masked field readable (it is served, masked); the query-side answer leaves it
 * out for the caller the rule applies to and keeps it for the unmasker.
 */
const CONTRACT: Record<string, { readable: Answer; queryable: Answer }> = {
  [MEMBER]: { readable: ALL_FIELDS, queryable: ALL_FIELDS.filter((f) => f !== MASKED_KEY) },
  [UNMASKER]: { readable: ALL_FIELDS, queryable: ALL_FIELDS },
};

function contractSource(opts: {
  queryable?: 'answer' | 'absent' | 'undefined' | 'throws';
  readable?: 'answer' | 'undefined';
} = {}): FieldVisibilitySource {
  const userOf = (context: unknown) => String((context as { userId?: string } | undefined)?.userId ?? '');
  const source: FieldVisibilitySource = {
    async getReadableFields(_object: string, context?: unknown) {
      if (opts.readable === 'undefined') return undefined;
      return CONTRACT[userOf(context)]?.readable;
    },
  };
  const q = opts.queryable ?? 'answer';
  if (q !== 'absent') {
    source.getQueryableFields = async (_object: string, context?: unknown) => {
      if (q === 'throws') throw new Error('synthetic outage');
      if (q === 'undefined') return undefined;
      return CONTRACT[userOf(context)]?.queryable;
    };
  }
  return source;
}

interface FakeRow { [k: string]: any }

/**
 * Engine double — reads and inserts only. This file's subject is the READ path,
 * which never reaches a write verb, so `update` / `delete` are deliberately not
 * declared (the same reasoning as `approval-payload-redaction.test.ts`).
 */
function makeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') { if (!(v as any[]).some((s) => matches(row, s))) return false; continue; }
      if (k === '$and') { if (!(v as any[]).every((s) => matches(row, s))) return false; continue; }
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
      const rows = ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
      return rows.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    /** The subject object's labels, so the derived `payload_labels` map is really built. */
    getSchema(object: string) {
      if (object !== OBJECT) return undefined;
      return {
        name: OBJECT,
        label: 'Probe Note',
        fields: Object.fromEntries(ALL_FIELDS.map((f) => [f, { name: f, label: `Label ${f}` }])),
      };
    },
  };
}

function seed(engine: ReturnType<typeof makeEngine>) {
  engine._tables[OBJECT] = [{ ...FULL_ROW, organization_id: TENANT }];
  engine._tables['sys_approval_request'] = [{
    id: REQUEST,
    organization_id: TENANT,
    process_name: 'flow:probe_review',
    object_name: OBJECT,
    record_id: RECORD,
    submitter_id: 'probe_submitter',
    status: 'pending',
    current_step: 'review',
    pending_approvers: [MEMBER, UNMASKER].join(','),
    payload_json: JSON.stringify(FULL_ROW),
    created_at: '2026-09-30T00:00:00Z',
  }];
  engine._tables['sys_approval_approver'] = [
    { id: 'idx_m', request_id: REQUEST, approver: MEMBER, organization_id: TENANT },
    { id: 'idx_u', request_id: REQUEST, approver: UNMASKER, organization_id: TENANT },
  ];
  engine._tables['sys_approval_action'] = [];
}

const asUser = (userId: string) => ({ userId, tenantId: TENANT, positions: [], permissions: [] }) as any;

const storedSnapshot = (engine: ReturnType<typeof makeEngine>) =>
  JSON.parse(String(engine._tables['sys_approval_request'][0].payload_json)) as Record<string, unknown>;

describe('[#20964] a snapshot field served masked to the reader is not served as stored — the service door', () => {
  let engine: ReturnType<typeof makeEngine>;
  let service: ApprovalService;

  beforeEach(() => {
    engine = makeEngine();
    seed(engine);
    service = new ApprovalService({ engine: engine as any });
  });

  it('(1) getRequest: the masked-for-this-caller key is not served, and the business fields still are', async () => {
    service.attachFieldVisibility(contractSource());
    const row = await service.getRequest(REQUEST, asUser(MEMBER));
    const payload = row!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty(MASKED_KEY);
    expect(payload).toEqual(BUSINESS);
  });

  it('(1) listRequests: the masked-for-this-caller key is not served', async () => {
    service.attachFieldVisibility(contractSource());
    const rows = await service.listRequests({ approverId: MEMBER }, asUser(MEMBER));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual(BUSINESS);
  });

  it('(1) the derived label map built from the snapshot keys does not carry the masked-for-this-caller key', async () => {
    service.attachFieldVisibility(contractSource());
    const row = (await service.getRequest(REQUEST, asUser(MEMBER))) as any;
    // Built at all (the fixture's schema labels reach it) ...
    expect(row.payload_labels).toHaveProperty('title');
    // ... and without the key the redaction dropped.
    expect(Object.keys(row.payload_labels)).not.toContain(MASKED_KEY);
    const control = (await service.getRequest(REQUEST, asUser(UNMASKER))) as any;
    expect(control.payload_labels).toHaveProperty(MASKED_KEY);
  });

  it('(2) control: a reader who holds what lifts the rule is served the stored value', async () => {
    service.attachFieldVisibility(contractSource());
    const row = await service.getRequest(REQUEST, asUser(UNMASKER));
    expect(row!.payload).toEqual(FULL_ROW);
  });

  it('(3) audit preserved: the stored column still holds the whole row after a masked read', async () => {
    service.attachFieldVisibility(contractSource());
    await service.getRequest(REQUEST, asUser(MEMBER));
    expect(storedSnapshot(engine)).toEqual(FULL_ROW);
  });

  it('(4) fail closed: a source with no query-side answer serves no snapshot field', async () => {
    service.attachFieldVisibility(contractSource({ queryable: 'absent' }));
    const row = await service.getRequest(REQUEST, asUser(UNMASKER));
    expect(row!.payload).toEqual({});
  });

  it('(4) fail closed: a query-side answer of `undefined` serves no snapshot field', async () => {
    service.attachFieldVisibility(contractSource({ queryable: 'undefined' }));
    const row = await service.getRequest(REQUEST, asUser(UNMASKER));
    expect(row!.payload).toEqual({});
  });

  it('(4) fail closed: a query-side answer that throws serves no snapshot field', async () => {
    service.attachFieldVisibility(contractSource({ queryable: 'throws' }));
    const row = await service.getRequest(REQUEST, asUser(UNMASKER));
    expect(row!.payload).toEqual({});
  });

  it('(4) an unresolvable read projection still passes the snapshot through whole (#3807)', async () => {
    service.attachFieldVisibility(contractSource({ readable: 'undefined', queryable: 'absent' }));
    const row = await service.getRequest(REQUEST, asUser(MEMBER));
    expect(row!.payload).toEqual(FULL_ROW);
  });
});

describe('[#20964] a snapshot field served masked to the reader is not served as stored — the generic data door', () => {
  const rowsFor = () => [{ id: REQUEST, object_name: OBJECT, payload_json: JSON.stringify(FULL_ROW) }];

  it('(1) the raw snapshot string loses the masked-for-this-caller key and keeps the business fields', async () => {
    const rows = rowsFor();
    await redactRowsInPlace(rows, contractSource(), asUser(MEMBER));
    expect(JSON.parse(rows[0].payload_json)).toEqual(BUSINESS);
  });

  it('(2) control: a reader who holds what lifts the rule is served the stored value', async () => {
    const rows = rowsFor();
    await redactRowsInPlace(rows, contractSource(), asUser(UNMASKER));
    expect(JSON.parse(rows[0].payload_json)).toEqual(FULL_ROW);
  });

  it('(4) fail closed: a source with no query-side answer serves no snapshot field', async () => {
    const rows = rowsFor();
    await redactRowsInPlace(rows, contractSource({ queryable: 'absent' }), asUser(UNMASKER));
    expect(JSON.parse(rows[0].payload_json)).toEqual({});
  });
});

describe('[#20964] the approvals plugin forwards the query-side answer to the redaction', () => {
  it('(5) the service door narrows by the `security` service\'s query-side answer', async () => {
    const engine = makeEngine();
    seed(engine);
    const services: Record<string, unknown> = { objectql: engine, security: contractSource() };
    const ctx: any = {
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
        return services[name];
      },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);
    const approvals = services.approvals as ApprovalService;
    expect(approvals).toBeInstanceOf(ApprovalService);

    const masked = await approvals.getRequest(REQUEST, asUser(MEMBER));
    expect(masked!.payload).toEqual(BUSINESS);
    const control = await approvals.getRequest(REQUEST, asUser(UNMASKER));
    expect(control!.payload).toEqual(FULL_ROW);
  });
});
