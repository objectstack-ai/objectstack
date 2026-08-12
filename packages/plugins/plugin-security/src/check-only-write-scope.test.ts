// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8059] A `check`-only UPDATE policy must not disable the write-side row
// gates — the #1994 class ("you cannot mutate what you cannot see") reopened
// through a different AUTHORING SHAPE, one issue after #7665 closed it for the
// select-only shape.
//
// MEASURED ON STOCK `main`, on the shipped showcase: a persona holding the
// plain `contributor` position gets `GET /data/showcase_invoice/:id` → 404 —
// `invoice_own_rows` correctly hides an invoice it does not own — and
// `PATCH /data/showcase_invoice/:id` → 200, WITH THE ROW ACTUALLY CHANGED
// (re-read as admin). Same on `showcase_invoice_line`, which is
// `controlled_by_parent` on the invoice. The one thing that separates it from
// `showcase_task`, which is consistent on the same run, is that the invoice
// also authors `invoice_owner_immutable`: `operation: 'update'` with `check`
// only, no `using`.
//
// TWO SITES, DISABLED BY THAT ONE AUTHORING SHAPE — which is why a fix to
// either alone is not a partial fix but a fix that does not work:
//
//   1. `computeLayeredRlsFilter`'s write-visibility floor triggered on
//      `collected.length === 0`. A check-only policy is fully APPLICABLE
//      (object + `positions` + operation all match) but carries no `using`,
//      so the collection was non-empty, the #7665 derivation never ran, and
//      the collected policy then compiled to no row filter at all — Layer 1
//      null, and every write-side row gate composed from it a no-op again:
//      the by-id pre-image gate (2.7), the controlled_by_parent master check,
//      the bulk AST injection. Fixed by asking whether a write-scope
//      PREDICATE applies, which is what #7665 criterion 5 says; a `check`
//      clause is post-image validation (ADR-0058 D4), not a scope predicate.
//
//   2. `computeWriteCheckFilter` did not pass `heldPositions`, so
//      `getApplicablePolicies` evaluated the ADR-0090 P2 applicability domain
//      against `[]` and dropped EVERY policy declaring `positions` from the
//      post-image check — for holders and non-holders alike. The second belt
//      was not merely late, it was absent (ADR-0049 enforce-or-remove; the
//      class #3539 closed for org-scoped policies).
//
// ── HOW THIS FILE PINS THE TWO SITES SEPARATELY ────────────────────────────
// The belts overlap on the obvious probe, and that overlap is a trap: revert
// site 1 and a naive "the PATCH was refused" assertion STAYS GREEN, because
// the check gate refuses it instead — the caller cannot read the pre-image, so
// the post-image is missing `owner` and fails the check by accident. Two
// consequences, both deliberate here:
//
//   • every refusal is asserted on its ADR-0112 ENVELOPE, never on the bare
//     fact of a refusal. The belts have distinct envelopes — the row gate
//     denies with `record_access_denied` ("(row-level security)"), the check
//     gate with `record_change_not_allowed` ("would violate a row-level
//     CHECK") — so a refusal migrating from one belt to the other reddens;
//   • site 1 is additionally pinned where the check gate CANNOT stand in for
//     it: a payload that SATISFIES the check (the record steal below), and the
//     BULK path, which step 3.6 explicitly declines to post-image validate.
//
// Reverting site 1 alone reddens the site-1 describes (and mutates rows that
// must not change); reverting site 2 alone reddens the site-2 holder describe.
// Neither revert reddens the other's pins.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata: the showcase invoice graph, exactly as it ships ──────────────

/**
 * OWD `public_read_write` (so record sharing widens writes rather than
 * narrowing them — the showcase default, and the reason the measured PATCH
 * reached the row gate at all) and an ORDINARY access posture.
 *
 * The owner column is `owner` (an email), NOT `owner_id`: the showcase authors
 * `owner == current_user.email`, and the distinction matters here — the step
 * 3.5 system-managed-owner guard keys on an `owner_id` FIELD EXISTING on the
 * object, so on this shape it never fires and cannot be mistaken for either
 * belt under test.
 */
const INVOICE_SCHEMA = {
  name: 'qa_invoice',
  sharingModel: 'public_read_write',
  fields: {
    id: { name: 'id' },
    subject: { name: 'subject' },
    amount: { name: 'amount' },
    owner: { name: 'owner' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/** The DETAIL — access derived from `qa_invoice` through the master_detail FK. */
const LINE_SCHEMA = {
  name: 'qa_invoice_line',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id' },
    description: { name: 'description' },
    quantity: { name: 'quantity' },
    invoice: { name: 'invoice', type: 'master_detail', required: true, reference: 'qa_invoice' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * The #7665 criterion-5 CONTROL: an object authoring BOTH a `using` update
 * predicate and a `check` clause. A write-scope predicate applies here, so the
 * derivation must stay OFF and the authored predicate must keep deciding alone
 * — in both directions.
 */
const QUOTE_SCHEMA = {
  name: 'qa_quote',
  sharingModel: 'public_read_write',
  fields: {
    id: { name: 'id' },
    subject: { name: 'subject' },
    stage: { name: 'stage' },
    owner: { name: 'owner' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = {
  qa_invoice: INVOICE_SCHEMA,
  qa_invoice_line: LINE_SCHEMA,
  qa_quote: QUOTE_SCHEMA,
};

/**
 * The real platform baseline. Its `owner_only_writes` / `owner_only_deletes`
 * floor is positions-gated to `org_member`, and the contributor personas below
 * deliberately do NOT hold that position — that domain miss is what leaves the
 * write class with no `using` predicate on the showcase, so it must be present
 * for this fixture to reproduce the measured shape rather than a simplified
 * one.
 */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * The showcase contributor, transcribed: a select-only `using` narrowing plus
 * an update-class policy that declares `check` ALONE. That pair is the entire
 * defect — either policy on its own is safe.
 */
const QA_CONTRIBUTOR: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_contributor',
  objects: {
    qa_invoice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    qa_invoice_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    qa_quote: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    {
      name: 'invoice_own_rows',
      object: 'qa_invoice',
      operation: 'select',
      using: 'owner == current_user.email',
      positions: ['contributor'],
    },
    // ⚠️ THE SHAPE UNDER TEST — `check` only, no `using`. Its intent is
    // post-image validation ("a contributor cannot reassign an invoice"); it
    // says nothing about WHICH existing rows may be targeted.
    {
      name: 'invoice_owner_immutable',
      object: 'qa_invoice',
      operation: 'update',
      check: 'owner == current_user.email',
      positions: ['contributor'],
    },
    // No qa_invoice_line rule — the line follows its master via
    // controlled_by_parent, exactly as the showcase comments promise.
    {
      name: 'quote_own_rows',
      object: 'qa_quote',
      operation: 'select',
      using: 'owner == current_user.email',
      positions: ['contributor'],
    },
    // The criterion-5 control: a REAL update-scope predicate, beside a check.
    {
      name: 'quote_update_open',
      object: 'qa_quote',
      operation: 'update',
      using: "stage == 'open'",
      check: 'owner == current_user.email',
      positions: ['contributor'],
    },
  ],
});

/**
 * Site 2's other direction: object grants, NO `contributor` position, and no
 * RLS of its own. `invoice_owner_immutable` declares `positions:
 * ['contributor']`, so it is outside this caller's applicability domain and
 * must not apply to them — the half of ADR-0090 P2 that a naive "always pass
 * the positions" fix could get wrong in the over-blocking direction.
 */
const QA_OPS: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_ops',
  objects: {
    qa_invoice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

/** Ground truth. Read grants, no RLS — sees every row in the tenant. */
const QA_ADMIN: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_admin',
  objects: {
    qa_invoice: { allowRead: true },
    qa_invoice_line: { allowRead: true },
    qa_quote: { allowRead: true },
  },
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, QA_CONTRIBUTOR, QA_OPS, QA_ADMIN];

// ── rows ───────────────────────────────────────────────────────────────────

const C1 = { userId: 'u_c1', email: 'c1@example.com' };
const C2 = { userId: 'u_c2', email: 'c2@example.com' };

const INVOICE_C1 = {
  id: 'inv_c1', subject: 'C1 invoice', amount: 100,
  owner: C1.email, created_by: C1.userId, organization_id: 'org1',
};
const INVOICE_C2 = {
  id: 'inv_c2', subject: 'C2 invoice', amount: 200,
  owner: C2.email, created_by: C2.userId, organization_id: 'org1',
};
const LINE_C1 = {
  id: 'ln_c1', description: 'C1 line', quantity: 1,
  invoice: INVOICE_C1.id, created_by: C1.userId, organization_id: 'org1',
};
const QUOTE_OPEN_C1 = {
  id: 'qt_open', subject: 'open quote', stage: 'open',
  owner: C1.email, created_by: C1.userId, organization_id: 'org1',
};
const QUOTE_CLOSED_C1 = {
  id: 'qt_closed', subject: 'closed quote', stage: 'closed',
  owner: C1.email, created_by: C1.userId, organization_id: 'org1',
};

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine() {
  const tables: Record<string, any[]> = {
    qa_invoice: [{ ...INVOICE_C1 }, { ...INVOICE_C2 }],
    qa_invoice_line: [{ ...LINE_C1 }],
    qa_quote: [{ ...QUOTE_OPEN_C1 }, { ...QUOTE_CLOSED_C1 }],
    sys_record_share: [],
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or)) return filter.$or.some((f: any) => matches(row, f));
    if (Array.isArray(filter.$and)) return filter.$and.every((f: any) => matches(row, f));
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const middlewares: any[] = [];
  return {
    _tables: tables,
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => SCHEMAS[name],
    async find(object: string, options: any = {}) {
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    // Both write verbs open with the PRODUCER's own dispatch predicate
    // (`assertEngine*Dispatch`), never a hand-mirrored guard.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

// ── the stack ──────────────────────────────────────────────────────────────

interface WriteOutcome {
  ok: boolean;
  /** ADR-0112 envelope of the refusal — asserted, never a bare `toThrow()`. */
  code?: string;
  status?: number;
  message: string;
  developerMessage?: string;
}

interface Stack {
  security: any;
  engine: any;
  write: (
    operation: 'insert' | 'update' | 'delete',
    object: string,
    payload: { recordId?: string; data?: Record<string, unknown> },
    context: any,
  ) => Promise<WriteOutcome>;
  read: (object: string, context: any, where?: Record<string, unknown>) => Promise<any[]>;
  rows: (object: string) => any[];
}

async function makeStack(opts: { orgScoping?: boolean } = {}): Promise<Stack> {
  const orgScoping = opts.orgScoping ?? true;
  const engine = makeEngine();
  const metadata = {
    get: async (_type: string, name: string) => SCHEMAS[name] ?? null,
    list: async () => PERMISSION_SETS,
  };
  let security: any;
  let sharing: SharingService;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    // Org scoping active by DEFAULT, as a multi-tenant deployment wires it, so
    // no green below can be "the write filter was empty for the tenant reason
    // instead". The explain describe turns it OFF deliberately — see its own
    // note, and #7665's: under an active wall Layer 0 alone reports `narrows`
    // for every operation and the assertion cannot fail.
    ...(orgScoping ? { 'org-scoping': { name: 'org-scoping' } } : {}),
    get sharing() { return sharing; },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, impl: any) => { if (name === 'security') security = impl; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (!security) throw new Error('SecurityPlugin did not register the security service');

  sharing = new SharingService({ engine: engine as any, securityService: () => security });
  const sharingMw = buildSharingMiddleware(sharing, ctx.logger);
  const securityMw = engine._middlewares[0];

  const run = async (opCtx: any): Promise<WriteOutcome> => {
    let reached = false;
    try {
      await securityMw(opCtx, async () => {
        await sharingMw(opCtx, async () => {
          if (opCtx.operation === 'delete') await engine.delete(opCtx.object, opCtx.options);
          else if (opCtx.operation === 'insert') await engine.insert(opCtx.object, opCtx.data);
          else await engine.update(opCtx.object, opCtx.data, opCtx.options);
          reached = true;
        });
      });
    } catch (e: any) {
      return {
        ok: false,
        code: e?.code,
        status: e?.statusCode,
        message: String(e?.message ?? e),
        developerMessage: e?.developerMessage,
      };
    }
    return reached
      ? { ok: true, message: 'written' }
      : { ok: false, message: 'middleware swallowed the write' };
  };

  return {
    security,
    engine,
    rows: (object: string) => (engine._tables[object] ??= []),
    async write(operation, object, payload, context) {
      // The by-id dispatch shape — no `ast`, which is the whole #1994 class:
      // only the pre-image gates stand between the caller and the row.
      const opCtx: any = { object, operation, context: { ...context } };
      if (operation === 'insert') {
        opCtx.data = { ...payload.data };
      } else if (operation === 'update') {
        opCtx.data = { id: payload.recordId, ...payload.data };
      } else {
        opCtx.options = { where: { id: payload.recordId } };
      }
      return run(opCtx);
    },
    async read(object, context, where) {
      const opCtx: any = {
        object,
        operation: 'find',
        context: { ...context },
        options: { where: where ?? {} },
        ast: { where: where ?? {} },
      };
      let result: any[] = [];
      await securityMw(opCtx, async () => {
        await sharingMw(opCtx, async () => {
          result = await engine.find(object, { where: opCtx.ast.where });
        });
      });
      return result;
    },
  };
}

/** The showcase-contributor shape: holds `contributor`, NOT `org_member`. */
const ctxFor = (
  u: { userId: string; email: string },
  positions: string[],
  ...permissions: string[]
) => ({ userId: u.userId, email: u.email, tenantId: 'org1', positions, permissions });

const C1_CTX = ctxFor(C1, ['contributor'], 'qa_contributor');
const C2_CTX = ctxFor(C2, ['contributor'], 'qa_contributor');
/** Holds the object grants, does NOT hold `contributor`. */
const OPS_CTX = ctxFor(C2, ['ops_agent'], 'qa_ops');
const ADMIN_CTX = ctxFor({ userId: 'u_admin', email: 'admin@example.com' }, [], 'qa_admin');

/** The 2.7 pre-image gate / master gate — BELT 1 (row scope). */
function expectRowLevelDenial(outcome: WriteOutcome, operation: 'update' | 'delete', object: string) {
  expect(outcome.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the user half is the localized catalog sentence')
    .toBe(BUILTIN_OPERATION_MESSAGES.en.record_access_denied);
  expect(
    outcome.developerMessage,
    'BELT 1 must be what refused — a refusal arriving from the CHECK gate instead means ' +
      'the row scope was never derived (site 1 regressed) and the check gate stood in for it',
  ).toContain(
    `[Security] Access denied: not permitted to ${operation} this '${object}' record (row-level security)`,
  );
}

/** The 3.6 post-image gate — BELT 2 (check clause). A different envelope. */
function expectCheckDenial(outcome: WriteOutcome, operation: 'insert' | 'update', object: string) {
  expect(outcome.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the user half — "change what you entered", not "ask an admin"')
    .toBe(BUILTIN_OPERATION_MESSAGES.en.record_change_not_allowed);
  expect(outcome.developerMessage, 'BELT 2 must be what refused').toContain(
    `[Security] Access denied: the ${operation} would violate a row-level CHECK on '${object}'`,
  );
}

/** The controlled_by_parent master gate's envelope (its sentence IS `message`). */
function expectMasterEditDenial(outcome: WriteOutcome, operation: string, object: string) {
  expect(outcome.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message).toContain(
    `[Security] Access denied: ${operation} on '${object}' requires edit access to its master record`,
  );
  expect(outcome.message, 'the RLS half of the master gate is what refused').toContain('(row-level security)');
}

/**
 * GROUND TRUTH. `#1994`'s family hides behind a refusal that still wrote, so
 * every refusal below is followed by an ADMIN RE-READ of the row through the
 * full middleware chain — the same thing the QA run did with a second HTTP
 * call — and by the raw stored row, which is what "the row actually changed"
 * means.
 */
async function expectRowUnchanged(
  stack: Stack,
  object: string,
  original: Record<string, unknown>,
  fields: string[],
) {
  const asAdmin = (await stack.read(object, ADMIN_CTX)).find((r) => r.id === original.id);
  expect(asAdmin, `admin re-read: '${object}' record ${original.id} must still exist`).toBeDefined();
  for (const f of fields) {
    expect(asAdmin?.[f], `admin re-read: '${object}'.${f} must be unchanged`).toBe(original[f]);
    expect(
      stack.rows(object).find((r) => r.id === original.id)?.[f],
      `stored row: '${object}'.${f} must be unchanged`,
    ).toBe(original[f]);
  }
}

// ───────────────────────────────────────────────────────────────────────────

describe('[#8059 site 1] a check-only UPDATE policy no longer suppresses the write-scope derivation', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('the read side is the premise: the out-of-scope invoice is invisible to its would-be writer', async () => {
    // The GET half of the measured 404/200 split — asserted first so the write
    // assertions below are known to be about a record the caller cannot read.
    const rows = await stack.read('qa_invoice', C2_CTX);
    expect(rows.map((r) => r.id)).toEqual([INVOICE_C2.id]);
  });

  it('a by-id UPDATE whose payload SATISFIES the check is still refused by the ROW gate, and the row does not change', async () => {
    // ⚠️ THE PIN THE CHECK GATE CANNOT STAND IN FOR, and the reason it is
    // first: `owner: C2.email` makes the post-image satisfy
    // `invoice_owner_immutable` outright, so belt 2 passes this write by
    // design. Only belt 1 — the derived row scope — refuses it. It is also the
    // worst version of the defect: a record STEAL, the exact write the
    // check-only policy was authored to prevent and structurally cannot.
    const out = await stack.write(
      'update',
      'qa_invoice',
      { recordId: INVOICE_C1.id, data: { owner: C2.email, subject: 'C2-STOLEN' } },
      C2_CTX,
    );
    expectRowLevelDenial(out, 'update', 'qa_invoice');
    await expectRowUnchanged(stack, 'qa_invoice', INVOICE_C1, ['owner', 'subject']);
  });

  it('an ordinary out-of-scope by-id UPDATE is refused by the ROW gate specifically, not by the check gate', async () => {
    // The measured PATCH. It reddens on a site-1 revert through the ENVELOPE:
    // the write is still refused there, but by belt 2 and for an unrelated
    // reason (the caller cannot read the pre-image, so the post-image is
    // missing `owner` and fails the check by accident). A bare "was refused"
    // assertion is green on the defect — hence `expectRowLevelDenial`.
    const out = await stack.write(
      'update',
      'qa_invoice',
      { recordId: INVOICE_C1.id, data: { subject: 'C2-FORGED', amount: 999 } },
      C2_CTX,
    );
    expectRowLevelDenial(out, 'update', 'qa_invoice');
    await expectRowUnchanged(stack, 'qa_invoice', INVOICE_C1, ['subject', 'amount']);
  });

  it('an out-of-scope by-id DELETE is refused by the ROW gate (the CRUD delete bit is held)', async () => {
    const out = await stack.write('delete', 'qa_invoice', { recordId: INVOICE_C1.id }, C2_CTX);
    expectRowLevelDenial(out, 'delete', 'qa_invoice');
    await expectRowUnchanged(stack, 'qa_invoice', INVOICE_C1, ['subject', 'owner']);
  });

  it('the controlled_by_parent line follows its master: a by-id UPDATE under an unreadable invoice is refused, and the line does not change', async () => {
    // `showcase_invoice_line`, the second HOLE the run reported. The line
    // authors no policy of its own; its whole gate is the master's write
    // filter, which was null for the same reason.
    const out = await stack.write(
      'update',
      'qa_invoice_line',
      { recordId: LINE_C1.id, data: { description: 'C2-FORGED', quantity: 999 } },
      C2_CTX,
    );
    expectMasterEditDenial(out, 'update', 'qa_invoice_line');
    await expectRowUnchanged(stack, 'qa_invoice_line', LINE_C1, ['description', 'quantity']);
  });

  it('INSERT of a line under an unreadable invoice is refused by the master gate', async () => {
    const out = await stack.write(
      'insert',
      'qa_invoice_line',
      { data: { id: 'ln_new', description: 'forged', invoice: INVOICE_C1.id, organization_id: 'org1' } },
      C2_CTX,
    );
    expectMasterEditDenial(out, 'insert', 'qa_invoice_line');
    expect(stack.rows('qa_invoice_line').find((r) => r.id === 'ln_new')).toBeUndefined();
  });
});

describe('[#8059 site 1] Layer 1 actually DERIVES for a check-only policy — the belt itself, not the refusal', () => {
  // The card's second pin: show the select narrowing IS derived, not merely
  // that a request failed. Both cases below are decided by Layer 1 alone —
  // neither can be satisfied by belt 2.
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('the bulk UPDATE path touches only READABLE rows — a path step 3.6 explicitly declines to check', async () => {
    // Step 3.6 logs "not post-image validated" and skips for a write with no
    // single id, so belt 2 contributes NOTHING here by its own construction.
    // The only thing that can scope this write is Layer 1 injected into the
    // AST — i.e. the derivation. On a site-1 revert both rows are rewritten.
    const opCtx: any = {
      object: 'qa_invoice',
      operation: 'update',
      context: { ...C2_CTX },
      data: { subject: 'bulk-edit' },
      options: { where: {}, multi: true },
      ast: { where: {} },
    };
    const securityMw = stack.engine._middlewares[0];
    await securityMw(opCtx, async () => {
      await stack.engine.update(opCtx.object, opCtx.data, { ...opCtx.options, where: opCtx.ast.where, multi: true });
    });
    expect(stack.rows('qa_invoice').find((r) => r.id === INVOICE_C2.id)?.subject).toBe('bulk-edit');
    expect(
      stack.rows('qa_invoice').find((r) => r.id === INVOICE_C1.id)?.subject,
      'the unreadable row must stay untouched',
    ).toBe('C1 invoice');
  });

  it('the derived scope admits the caller’s OWN rows — it is the select narrowing, not a blanket deny', async () => {
    // Distinguishes "Layer 1 derived the read predicate" from "Layer 1 became
    // the deny sentinel". A blanket deny would satisfy every refusal pin in
    // this file while breaking the product.
    const opCtx: any = {
      object: 'qa_invoice',
      operation: 'update',
      context: { ...C2_CTX },
      data: { subject: 'own-bulk-edit' },
      options: { where: {}, multi: true },
      ast: { where: {} },
    };
    const securityMw = stack.engine._middlewares[0];
    await securityMw(opCtx, async () => {
      await stack.engine.update(opCtx.object, opCtx.data, { ...opCtx.options, where: opCtx.ast.where, multi: true });
    });
    expect(stack.rows('qa_invoice').find((r) => r.id === INVOICE_C2.id)?.subject).toBe('own-bulk-edit');
  });
});

describe('[#8059 site 1] the explain engine reports the derived narrowing', () => {
  // Posture `single` (no org wall): under an active wall Layer 0 alone reports
  // `narrows` for every operation and this whole describe is vacuous — the
  // #7665 file measured exactly that. A null Layer 0 is also what reproduces
  // the deployment signal the card quotes.
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack({ orgScoping: false }); });

  const rlsLayer = (decision: any) => decision.layers.find((l: any) => l.layer === 'rls');

  it("operation:'update' on a check-only object reports rls 'narrows', not 'not_applicable'", async () => {
    const layer = rlsLayer(await stack.security.explain({ object: 'qa_invoice', operation: 'update' }, C2_CTX));
    expect(layer.verdict).toBe('narrows');
    expect(layer.detail).toContain('Row-level security narrows the row set');
    expect(layer.detail).not.toContain('No RLS policy applies');
  });

  it("operation:'read' keeps reporting 'narrows' — the split is CLOSED, not inverted", async () => {
    expect(rlsLayer(await stack.security.explain({ object: 'qa_invoice', operation: 'read' }, C2_CTX)).verdict)
      .toBe('narrows');
  });

  it("operation:'create' still reports 'not_applicable' — insert has no pre-image to be visible", async () => {
    expect(rlsLayer(await stack.security.explain({ object: 'qa_invoice', operation: 'create' }, C2_CTX)).verdict)
      .toBe('not_applicable');
  });
});

describe('[#8059 site 2] a `check` policy declaring `positions` reaches the write-check filter', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('a HOLDER cannot write their own invoice into a state the check forbids — and the row does not change', async () => {
    // C1 owns this invoice and is squarely inside the row scope, so belt 1
    // admits the write: only belt 2 can refuse it. This is
    // `invoice_owner_immutable` doing the single job it was authored for
    // ("a contributor cannot reassign an invoice they own"), which it could
    // not do for ANY caller while `heldPositions` was withheld. On a site-2
    // revert the reassignment lands and the stored `owner` really changes.
    const out = await stack.write(
      'update',
      'qa_invoice',
      { recordId: INVOICE_C1.id, data: { owner: 'someone_else@example.com' } },
      C1_CTX,
    );
    expectCheckDenial(out, 'update', 'qa_invoice');
    await expectRowUnchanged(stack, 'qa_invoice', INVOICE_C1, ['owner']);
  });

  it('a NON-HOLDER is outside the policy’s applicability domain, so the check does not apply to them', async () => {
    // ADR-0090 P2's other direction, and the over-block guard for this site:
    // `qa_ops` holds no `contributor` position, so a policy scoped to
    // `contributor` must not gate their write. Threading positions must
    // ENFORCE the domain, never ignore it.
    const out = await stack.write(
      'update',
      'qa_invoice',
      { recordId: INVOICE_C2.id, data: { owner: 'ops_assigned@example.com' } },
      OPS_CTX,
    );
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('qa_invoice').find((r) => r.id === INVOICE_C2.id)?.owner)
      .toBe('ops_assigned@example.com');
  });

  it('the holder’s in-scope write that SATISFIES the check still lands', async () => {
    const out = await stack.write(
      'update',
      'qa_invoice',
      { recordId: INVOICE_C1.id, data: { subject: 'C1 edited' } },
      C1_CTX,
    );
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('qa_invoice').find((r) => r.id === INVOICE_C1.id)?.subject).toBe('C1 edited');
    expect(
      stack.rows('qa_invoice').find((r) => r.id === INVOICE_C1.id)?.owner,
      'the untouched owner still satisfies the check via the pre-image merge',
    ).toBe(C1.email);
  });
});

describe('[#8059] nothing over-blocks — a legitimate in-scope write by a holder still lands', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('the owner’s by-id UPDATE of their own invoice lands and the row really changes', async () => {
    const out = await stack.write(
      'update',
      'qa_invoice',
      { recordId: INVOICE_C1.id, data: { subject: 'C1 revised', amount: 150 } },
      C1_CTX,
    );
    expect(out, out.message).toMatchObject({ ok: true });
    const row = stack.rows('qa_invoice').find((r) => r.id === INVOICE_C1.id);
    expect(row?.subject).toBe('C1 revised');
    expect(row?.amount).toBe(150);
  });

  it('the owner still writes their own line — the master gate admits an in-scope master', async () => {
    const out = await stack.write(
      'update',
      'qa_invoice_line',
      { recordId: LINE_C1.id, data: { description: 'C1 edit' } },
      C1_CTX,
    );
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('qa_invoice_line').find((r) => r.id === LINE_C1.id)?.description).toBe('C1 edit');
  });

  it('the owner still INSERTs a line under their own invoice', async () => {
    const out = await stack.write(
      'insert',
      'qa_invoice_line',
      { data: { id: 'ln_c1_new', description: 'new line', invoice: INVOICE_C1.id, organization_id: 'org1' } },
      C1_CTX,
    );
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('qa_invoice_line').find((r) => r.id === 'ln_c1_new')).toBeDefined();
  });

  it('the owner’s by-id DELETE of their own invoice still lands', async () => {
    const out = await stack.write('delete', 'qa_invoice', { recordId: INVOICE_C1.id }, C1_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('qa_invoice').find((r) => r.id === INVOICE_C1.id)).toBeUndefined();
  });
});

describe('[#8059] #7665 criterion 5 is unchanged where a write-scope predicate IS authored', () => {
  // The control: `qa_quote` authors `using` AND `check` on its update class.
  // A write-scope predicate applies, so derivation must stay OFF and the
  // authored predicate must keep deciding alone — the #7401 / #6736 widening
  // direction. If the site-1 fix had asked "is there a check?" instead of "is
  // there a `using`?", this describe is what would go red.
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('the authored widener still admits a row OUTSIDE the select scope', async () => {
    // C1 owns qt_open, C2 does not and cannot read it — but the authored
    // update rule admits any quote in 'open'. C2's post-image must still
    // satisfy the check, so it writes the quote to itself; the point of the
    // case is that belt 1 does NOT refuse it.
    const out = await stack.write(
      'update',
      'qa_quote',
      { recordId: QUOTE_OPEN_C1.id, data: { owner: C2.email, subject: 'widened edit' } },
      C2_CTX,
    );
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('qa_quote').find((r) => r.id === QUOTE_OPEN_C1.id)?.subject).toBe('widened edit');
  });

  it("the authored rule's own boundary still refuses (stage != 'open')", async () => {
    const out = await stack.write(
      'update',
      'qa_quote',
      { recordId: QUOTE_CLOSED_C1.id, data: { owner: C2.email, subject: 'forged' } },
      C2_CTX,
    );
    expectRowLevelDenial(out, 'update', 'qa_quote');
    await expectRowUnchanged(stack, 'qa_quote', QUOTE_CLOSED_C1, ['subject', 'owner']);
  });

  it('the check on that same object still refuses a post-image the caller may not produce', async () => {
    // Both clauses live on `quote_update_open`: `using` admits the row, and
    // `check` still validates the post-image — belt 2 applies to the holder
    // here for the same site-2 reason.
    const out = await stack.write(
      'update',
      'qa_quote',
      { recordId: QUOTE_OPEN_C1.id, data: { owner: 'third_party@example.com' } },
      C1_CTX,
    );
    expectCheckDenial(out, 'update', 'qa_quote');
    await expectRowUnchanged(stack, 'qa_quote', QUOTE_OPEN_C1, ['owner']);
  });
});
