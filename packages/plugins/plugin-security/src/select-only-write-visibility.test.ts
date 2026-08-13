// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7665] A by-id write must be gated by record VISIBILITY when the object's
// narrowing is authored as select-only RLS.
//
// QA run #7637 measured the strongest security finding of the sweep on the
// stock showcase: a contributor whose narrowing is authored ONLY as
// `operation: 'select'` rules (`invoice_own_rows`, `task_own_rows`) could
// PATCH by id records they cannot read — 200, values persisted — on the
// master object AND on a `controlled_by_parent` detail, while the read side
// correctly 404'd. Mechanism: the 2.7 by-id write pre-image gate composes the
// RLS filter for the WRITE operation; with no update-scope policy applicable
// (the platform ownership floor is positions-gated to `org_member`, and the
// showcase contributor holds `contributor`), that filter compiled to a null
// Layer 1 and the gate was a documented no-op. OWD `public_read_write` made
// `resolveSharingCanEdit` answer true, and `assertControlledByParentWrite`
// derived the detail's write access from that same permissive master verdict.
//
// The fix (issue option A, the platform-side one): when NO policy of the
// write class applies to (principal, object, operation), the write scope is
// DERIVED FROM THE CALLER'S SELECT NARROWING — the same predicate the read
// path enforces — inside `computeLayeredRlsFilter`. "You cannot mutate what
// you cannot see" then holds by construction on the by-id gate, the
// controlled_by_parent master check, and the bulk write AST, and the explain
// engine reports the same narrowing for update/delete that it reports for
// read.
//
// ⚠️ THE PROBE PERSONAS HERE HOLD THE OBJECT READ+EDIT (+DELETE) GRANTS and
// are outside the RECORD scope — the issue's acceptance criterion 2. The
// `verify --rls` proof persona holds no object grants at all, so every one of
// its probes is masked by the object-level CRUD gate before record scope is
// ever consulted; a re-tagged version of it is structurally unable to fail
// and is exactly what this file must not be.
//
// What must NOT change (criterion 5 — the widener-dead directions #7401 and
// #6736 track, and the bypass/floor paths):
//   - an object WITH an authored update-scope rule keeps today's behavior in
//     BOTH directions (the widener still widens; its boundary still refuses);
//   - the `org_member` platform ownership floor path is untouched;
//   - a read-side superuser bypass holder (viewAllRecords on a
//     posture-permitting object) is not newly narrowed — their readable set
//     is unbounded, so the readability requirement imposes nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

/**
 * The measured shape, exactly as the showcase ships it: OWD
 * `public_read_write` (so record sharing widens writes rather than narrowing
 * them), an ORDINARY access posture, and select-only RLS authored against an
 * email-shaped owner column.
 */
const TICKET_SCHEMA = {
  name: 'qa_ticket',
  sharingModel: 'public_read_write',
  fields: {
    id: { name: 'id' },
    title: { name: 'title' },
    next_step: { name: 'next_step' },
    owner: { name: 'owner' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/** The DETAIL — access derived from `qa_ticket` through the master_detail FK. */
const LINE_SCHEMA = {
  name: 'qa_ticket_line',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id' },
    description: { name: 'description' },
    quantity: { name: 'quantity' },
    ticket: { name: 'ticket', type: 'master_detail', required: true, reference: 'qa_ticket' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * The #7401 / #6736 CONTROL: an object that DOES author an update-scope rule
 * beside its select narrowing. Derive-from-select must never fire for it —
 * the authored update predicate keeps deciding alone, in both directions.
 */
const DOC_SCHEMA = {
  name: 'qa_doc',
  sharingModel: 'public_read_write',
  fields: {
    id: { name: 'id' },
    body: { name: 'body' },
    stage: { name: 'stage' },
    owner: { name: 'owner' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * The read-BYPASS control: `access.default: 'private'` makes the posture
 * permit the ADR-0066 ① superuser short-circuits, and the auditor below holds
 * `viewAllRecords` WITHOUT `modifyAllRecords` — the one combination where the
 * write class compiles to nothing applicable while the read class is
 * unbounded. Derivation must recognise the unbounded readable set and impose
 * nothing.
 */
const VAULT_SCHEMA = {
  name: 'qa_vault',
  sharingModel: 'public_read_write',
  access: { default: 'private' },
  fields: {
    id: { name: 'id' },
    body: { name: 'body' },
    owner: { name: 'owner' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = {
  qa_ticket: TICKET_SCHEMA,
  qa_ticket_line: LINE_SCHEMA,
  qa_doc: DOC_SCHEMA,
  qa_vault: VAULT_SCHEMA,
};

/**
 * The real platform baseline — additive for every authenticated member. Its
 * `owner_only_writes` / `owner_only_deletes` floor is positions-gated to
 * `org_member`, and the contributor personas below deliberately do NOT hold
 * that position: that domain miss is the exact reason the write class had no
 * applicable policy on the showcase (#7665 root cause), so it must be present
 * here for the fixture to reproduce the measured shape rather than a
 * simplified one.
 */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * Criterion 2's probe profile: read+edit+delete on every object under test
 * (delete deliberately, so a refused delete below is the ROW gate refusing,
 * never the CRUD bit), narrowed only by select-scope RLS.
 */
const QA_CONTRIBUTOR: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_contributor',
  objects: {
    qa_ticket: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    qa_ticket_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    qa_doc: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    {
      name: 'ticket_own_rows',
      object: 'qa_ticket',
      operation: 'select',
      using: 'owner == current_user.email',
      positions: ['contributor'],
    },
    // No qa_ticket_line rule is authored — the line follows its master via
    // controlled_by_parent, exactly as the showcase comments promise.
    {
      name: 'doc_select_own',
      object: 'qa_doc',
      operation: 'select',
      using: 'owner == current_user.email',
      positions: ['contributor'],
    },
    // The authored UPDATE widener — #7401/#6736's protected direction. Its
    // presence must switch derive-from-select OFF for qa_doc entirely.
    {
      name: 'doc_update_open',
      object: 'qa_doc',
      operation: 'update',
      using: "stage == 'open'",
      positions: ['contributor'],
    },
  ],
});

/** viewAllRecords WITHOUT modifyAllRecords — the read-bypass control. */
const QA_AUDITOR: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_auditor',
  objects: {
    qa_vault: { allowRead: true, allowEdit: true, allowDelete: true, viewAllRecords: true },
  },
  rowLevelSecurity: [
    {
      name: 'vault_own_rows',
      object: 'qa_vault',
      operation: 'select',
      using: 'owner == current_user.email',
      positions: ['contributor'],
    },
  ],
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, QA_CONTRIBUTOR, QA_AUDITOR];

// ── rows ───────────────────────────────────────────────────────────────────

const C1 = { userId: 'u_c1', email: 'c1@example.com' };
const C2 = { userId: 'u_c2', email: 'c2@example.com' };

const TICKET_C1 = {
  id: 'tk_c1', title: 'C1 ticket', next_step: 'call',
  owner: C1.email, created_by: C1.userId, organization_id: 'org1',
};
const TICKET_C2 = {
  id: 'tk_c2', title: 'C2 ticket', next_step: 'call',
  owner: C2.email, created_by: C2.userId, organization_id: 'org1',
};
const LINE_C1 = {
  id: 'ln_c1', description: 'C1 line', quantity: 1,
  ticket: TICKET_C1.id, created_by: C1.userId, organization_id: 'org1',
};
const DOC_OPEN_C1 = {
  id: 'doc_open', body: 'open doc', stage: 'open',
  owner: C1.email, created_by: C1.userId, organization_id: 'org1',
};
const DOC_CLOSED_C1 = {
  id: 'doc_closed', body: 'closed doc', stage: 'closed',
  owner: C1.email, created_by: C1.userId, organization_id: 'org1',
};
const VAULT_C1 = {
  id: 'va_c1', body: 'vault row', owner: C1.email,
  created_by: C1.userId, organization_id: 'org1',
};

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine() {
  const tables: Record<string, any[]> = {
    qa_ticket: [{ ...TICKET_C1 }, { ...TICKET_C2 }],
    qa_ticket_line: [{ ...LINE_C1 }],
    qa_doc: [{ ...DOC_OPEN_C1 }, { ...DOC_CLOSED_C1 }],
    qa_vault: [{ ...VAULT_C1 }],
    sys_record_share: [],
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    // `$or` / `$and` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — a short-circuiting `return` here would discard every
    // sibling equality key in the same object. See #7620.
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
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
    // (#4550 / #5480 / #6277), never a hand-mirrored guard.
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
    payload: { recordId?: string; data?: Record<string, unknown>; where?: Record<string, unknown> },
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
    // Org scoping active by DEFAULT, as a multi-tenant deployment wires it —
    // Layer 0 contributes a real tenant predicate, so a green on the
    // enforcement describes can never be "the write filter was empty for the
    // tenant reason instead".
    //
    // ⚠️ The explain describe below deliberately turns it OFF, and that is not
    // a convenience: with a wall in force Layer 0 is non-null for EVERY
    // operation, and the rls layer's verdict is read off the COMPOSED
    // `layer0 AND layer1` (`explain-engine.ts`, `readFilter ? 'narrows' :
    // 'not_applicable'`). A `narrows` assertion under an active wall is
    // therefore satisfied by the tenant predicate alone and holds whether or
    // not this fix exists — measured: it stayed GREEN under the full ablation.
    // Posture `single` makes Layer 0 null, so the verdict is decided by Layer 1
    // alone and the assertion can actually fail. This also reproduces the
    // card's measured signal exactly, which came from a deployment reporting
    // `not_applicable` — only a null Layer 0 can report that.
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
      // The by-id dispatch shape — no `ast`, which is the whole #1994/#7665
      // class: only the pre-image gates stand between the caller and the row.
      // (The bulk path has its own describe below, driving the middleware's
      // AST injection directly.)
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

/** The showcase-contributor shape: NOT an org_member — the floor's domain miss. */
const ctxFor = (u: { userId: string; email: string }, ...permissions: string[]) => ({
  userId: u.userId, email: u.email, tenantId: 'org1', positions: ['contributor'], permissions,
});

const C1_CTX = ctxFor(C1, 'qa_contributor');
const C2_CTX = ctxFor(C2, 'qa_contributor');
const AUDITOR_CTX = ctxFor(C2, 'qa_auditor');

/** [#7451] The 2.7 pre-image gate's exact two-axis envelope. */
function expectRowLevelDenial(outcome: WriteOutcome, operation: 'update' | 'delete', object: string) {
  expect(outcome.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the user half is the localized catalog sentence')
    .toBe(BUILTIN_OPERATION_MESSAGES.en.record_access_denied);
  expect(outcome.developerMessage, 'the developer half names WHICH gate refused').toContain(
    `[Security] Access denied: not permitted to ${operation} this '${object}' record (row-level security)`,
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

const rowById = (stack: Stack, object: string, id: string) =>
  stack.rows(object).find((r) => r.id === id);

// ───────────────────────────────────────────────────────────────────────────

describe('[#7665] select-only RLS gates the by-id WRITE on the master object', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('out-of-scope by-id UPDATE is refused with the row-level envelope, and the row does not change', async () => {
    const out = await stack.write('update', 'qa_ticket', { recordId: TICKET_C1.id, data: { next_step: 'C2-FORGED' } }, C2_CTX);
    expectRowLevelDenial(out, 'update', 'qa_ticket');
    expect(rowById(stack, 'qa_ticket', TICKET_C1.id)?.next_step).toBe('call');
  });

  it('out-of-scope by-id DELETE is refused by the ROW gate (the CRUD delete bit is held)', async () => {
    const out = await stack.write('delete', 'qa_ticket', { recordId: TICKET_C1.id }, C2_CTX);
    expectRowLevelDenial(out, 'delete', 'qa_ticket');
    expect(rowById(stack, 'qa_ticket', TICKET_C1.id)).toBeDefined();
  });

  it('a legitimately in-scope by-id UPDATE still succeeds and the row really changes', async () => {
    const out = await stack.write('update', 'qa_ticket', { recordId: TICKET_C2.id, data: { next_step: 'updated' } }, C2_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'qa_ticket', TICKET_C2.id)?.next_step).toBe('updated');
  });

  it('the read side is unchanged: the out-of-scope row stays invisible to find', async () => {
    const rows = await stack.read('qa_ticket', C2_CTX);
    expect(rows.map((r) => r.id)).toEqual([TICKET_C2.id]);
  });
});

describe('[#7665] the same requirement holds on the controlled_by_parent detail', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('by-id UPDATE of a line under an unreadable master is refused by the master gate', async () => {
    const out = await stack.write('update', 'qa_ticket_line', { recordId: LINE_C1.id, data: { description: 'C2-FORGED', quantity: 999 } }, C2_CTX);
    expectMasterEditDenial(out, 'update', 'qa_ticket_line');
    expect(rowById(stack, 'qa_ticket_line', LINE_C1.id)?.description).toBe('C1 line');
  });

  it('INSERT of a line under an unreadable master is refused by the master gate', async () => {
    const out = await stack.write('insert', 'qa_ticket_line', { data: { id: 'ln_new', description: 'forged', ticket: TICKET_C1.id, organization_id: 'org1' } }, C2_CTX);
    expectMasterEditDenial(out, 'insert', 'qa_ticket_line');
    expect(rowById(stack, 'qa_ticket_line', 'ln_new')).toBeUndefined();
  });

  it('the owner still writes their own line — the master gate admits an in-scope master', async () => {
    const out = await stack.write('update', 'qa_ticket_line', { recordId: LINE_C1.id, data: { description: 'C1 edit' } }, C1_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'qa_ticket_line', LINE_C1.id)?.description).toBe('C1 edit');
  });
});

describe("[#7665] criterion 5 — an authored update-scope rule keeps deciding ALONE (#7401/#6736's protected direction)", () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('the authored widener still admits a row OUTSIDE the select scope (derive-from-select must not AND in)', async () => {
    // C2 cannot read doc_open (owner C1) — but the authored update rule admits
    // any doc in 'open'. If derive-from-select fired despite the authored
    // rule, this write would newly 403: the exact #6736 defect family.
    //
    // ⚠️ SCOPE OF THIS PIN, stated precisely because the green is easy to
    // over-read. What it establishes is the FILTER COMPOSITION at the layer
    // this fix edits: an applicable authored write predicate keeps deciding
    // alone, and the derived select scope is not AND-ed into it. It does NOT
    // establish that the widener works end-to-end on a real stack: there the
    // pre-image gate's `findOne` runs under the CALLER's context and re-enters
    // the middleware chain, so the caller's READ narrowing applies to the
    // probe read as well — the mechanism #7401 measured (`public_read` → 200,
    // `private` → 403, same widener). This fake engine's `findOne` does not
    // re-enter the chain, so that second, independent gate is deliberately not
    // simulated here. #7401 owns that question and is untouched by #7665:
    // mutation-tested by forcing derivation unconditionally, which turns THIS
    // case red and nothing else.
    const out = await stack.write('update', 'qa_doc', { recordId: DOC_OPEN_C1.id, data: { body: 'widened edit' } }, C2_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'qa_doc', DOC_OPEN_C1.id)?.body).toBe('widened edit');
  });

  it("the authored rule's own boundary still refuses (stage != 'open')", async () => {
    const out = await stack.write('update', 'qa_doc', { recordId: DOC_CLOSED_C1.id, data: { body: 'forged' } }, C2_CTX);
    expectRowLevelDenial(out, 'update', 'qa_doc');
    expect(rowById(stack, 'qa_doc', DOC_CLOSED_C1.id)?.body).toBe('closed doc');
  });

  it('class-per-class: the DELETE class (no authored delete rule) still derives from select on the same object', async () => {
    // Criterion 5 protects each write CLASS that has its own authored
    // predicate — qa_doc's `update` class. Its `delete` class authors nothing,
    // so there is no delete-widener to kill: an out-of-visibility by-id DELETE
    // is refused by the derived readable-set scope. Pinned deliberately so the
    // class-per-class reading is a measured contract, not an accident.
    const out = await stack.write('delete', 'qa_doc', { recordId: DOC_OPEN_C1.id }, C2_CTX);
    expectRowLevelDenial(out, 'delete', 'qa_doc');
    expect(rowById(stack, 'qa_doc', DOC_OPEN_C1.id)).toBeDefined();
  });
});

describe('[#7665] bypass and floor paths are untouched', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('a viewAllRecords holder (no modifyAllRecords) is NOT newly narrowed — the readable set is unbounded', async () => {
    const out = await stack.write('update', 'qa_vault', { recordId: VAULT_C1.id, data: { body: 'audit edit' } }, AUDITOR_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'qa_vault', VAULT_C1.id)?.body).toBe('audit edit');
  });

  it("an org_member's cross-creator write is still refused by the platform floor, not by derivation", async () => {
    const memberCtx = { ...C2_CTX, positions: ['org_member', 'contributor'] };
    const out = await stack.write('update', 'qa_ticket', { recordId: TICKET_C1.id, data: { next_step: 'forged' } }, memberCtx);
    expectRowLevelDenial(out, 'update', 'qa_ticket');
    expect(rowById(stack, 'qa_ticket', TICKET_C1.id)?.next_step).toBe('call');
  });
});

describe('[#7665] the bulk write path is scoped by the same derived visibility', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('an unfiltered multi-UPDATE touches only readable rows', async () => {
    const opCtx: any = {
      object: 'qa_ticket',
      operation: 'update',
      context: { ...C2_CTX },
      data: { next_step: 'bulk-edit' },
      options: { where: {}, multi: true },
      ast: { where: {} },
    };
    const securityMw = stack.engine._middlewares[0];
    await securityMw(opCtx, async () => {
      await stack.engine.update(opCtx.object, opCtx.data, { ...opCtx.options, where: opCtx.ast.where, multi: true });
    });
    expect(rowById(stack, 'qa_ticket', TICKET_C2.id)?.next_step).toBe('bulk-edit');
    expect(rowById(stack, 'qa_ticket', TICKET_C1.id)?.next_step, 'the unreadable row must stay untouched').toBe('call');
  });
});

describe('[#7665] the explain engine tells the same story it enforces', () => {
  // Posture `single` (no org wall) — see the note in `makeStack`. Under an
  // active wall this whole describe is vacuous: Layer 0 alone reports
  // `narrows` for every operation.
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack({ orgScoping: false }); });

  const rlsLayer = (decision: any) => decision.layers.find((l: any) => l.layer === 'rls');

  it("operation:'update' on a select-only object now reports rls 'narrows' (the #7637 confirmation ran the other way: 'not_applicable — No RLS policy applies')", async () => {
    const layer = rlsLayer(await stack.security.explain({ object: 'qa_ticket', operation: 'update' }, C2_CTX));
    expect(layer.verdict).toBe('narrows');
    // The sentence too: `not_applicable` ships "No RLS policy applies." — the
    // exact string QA #7637 quoted as the confirmation of the split.
    expect(layer.detail).toContain('Row-level security narrows the row set');
    expect(layer.detail).not.toContain('No RLS policy applies');
  });

  it("operation:'delete' reports the same narrowing (the class the card's DELETE half rides on)", async () => {
    expect(rlsLayer(await stack.security.explain({ object: 'qa_ticket', operation: 'delete' }, C2_CTX)).verdict)
      .toBe('narrows');
  });

  it("operation:'read' keeps reporting 'narrows' exactly as before — the split #7637 measured is CLOSED, not inverted", async () => {
    expect(rlsLayer(await stack.security.explain({ object: 'qa_ticket', operation: 'read' }, C2_CTX)).verdict)
      .toBe('narrows');
  });

  it("operation:'create' still reports 'not_applicable' — insert has no pre-image to be visible, so nothing is derived for it", async () => {
    expect(rlsLayer(await stack.security.explain({ object: 'qa_ticket', operation: 'create' }, C2_CTX)).verdict)
      .toBe('not_applicable');
  });
});
