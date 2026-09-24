// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security/explain` must fail CLOSED when a dependency it shares with
// enforcement REJECTS.
//
// The report promises it runs the same code paths the enforcement middleware
// runs. Enforcement runs those calls un-caught, so when one of them rejects the
// request it explains FAILS. The explain engine used to catch the same
// rejection into a value its record matcher reads as an ANSWER:
//
//   - plugin-sharing's read filter → `null`, which the matcher reads as "no
//     filter": `record.visible: true`, `decidedBy: 'sharing'`, the sharing
//     layer `admitted` — while the caller's find threw;
//   - plugin-sharing's per-record write gate → "no gate wired", so ownership or
//     a READ share answered a write the by-id PATCH then failed on;
//   - the layered RLS composition → "no tenant wall, no business RLS", so the
//     record read as visible beside an object-level `allowed: false` from the
//     same fault;
//   - the on-behalf-of delegator's resolution → "no delegation", so the agent's
//     own grants decided alone and `allowed` came back `true` where the find
//     answered 503.
//
// Each fault is now reported as what it is — the layer `not_evaluated`, the
// record NOT visible — and never as an admission. Every fault cell asserts both
// halves: explain's verdict, and that the SAME fault fails the real request
// through the real SecurityPlugin + SharingService middlewares. The healthy
// controls pin that a dependency that ANSWERS — including one that answers
// "no restriction" — is reported exactly as before.
import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

const OBJECT = 'kpi_entry_line';

const fieldsOf = (...names: string[]) =>
  Object.fromEntries(names.map((n) => [n, { name: n }]));

/** `sharingModel` unset → `private` (ADR-0090 D1), so plugin-sharing's owner-match is in play. */
const PRIVATE_SCHEMA = {
  name: OBJECT,
  fields: fieldsOf('id', 'name', 'value', 'owner_id', 'created_by', 'organization_id'),
};

/** The object's own model opens reads — a sharing fault must still close the report. */
const PUBLIC_READ_SCHEMA = { ...PRIVATE_SCHEMA, sharingModel: 'public_read' };

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const grantAt = (name: string, scope: 'own' | 'org'): PermissionSet =>
  PermissionSetSchema.parse({
    name,
    objects: { [OBJECT]: { allowRead: true, allowEdit: true, readScope: scope, writeScope: scope } },
  });

/** Depth `org` — plugin-sharing imposes no owner-match, so its read filter answers `null` with no I/O. */
const HR_REVIEWER = grantAt('hr_reviewer', 'org');
/** Depth `own` — widened only by ownership or a share, so the read filter reads the share store. */
const DEPT_REPORTER = grantAt('dept_reporter', 'own');

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, HR_REVIEWER, DEPT_REPORTER];

// ── principals and rows ────────────────────────────────────────────────────

const U_ADMIN = 'u_admin';
const U_HR = 'u_hr';
const U_REPORTER = 'u_reporter';

const ctxFor = (userId: string, permission: string) => ({
  userId, tenantId: 'org1', positions: ['org_member'], permissions: [permission],
});

const HR_CTX = ctxFor(U_HR, 'hr_reviewer');
const REPORTER_CTX = ctxFor(U_REPORTER, 'dept_reporter');
/** An agent-shaped principal acting for the reporter — the ADR-0090 D10 intersection applies. */
const ON_BEHALF_CTX = { ...HR_CTX, onBehalfOf: { userId: U_REPORTER } };

type RowKey = 'shared' | 'owned' | 'unshared';

const ROWS: Record<RowKey, Record<string, unknown>> = {
  /** Owned by the admin; the reporter holds a `read` share on it. */
  shared: { id: 'kle_shared', name: 'Shared', value: 1, owner_id: U_ADMIN, created_by: U_ADMIN, organization_id: 'org1' },
  /** Owned AND created by the reporter, so every write floor admits the reporter. */
  owned: { id: 'kle_owned', name: 'Owned', value: 1, owner_id: U_REPORTER, created_by: U_REPORTER, organization_id: 'org1' },
  /** Neither shared with nor owned by the reporter. */
  unshared: { id: 'kle_unshared', name: 'Unshared', value: 1, owner_id: U_ADMIN, created_by: U_ADMIN, organization_id: 'org1' },
};

const READ_SHARE = {
  id: 'shr_read', object_name: OBJECT, record_id: ROWS.shared.id,
  recipient_type: 'user', recipient_id: U_REPORTER, access_level: 'read', source: 'manual',
};

// ── in-memory engine ───────────────────────────────────────────────────────

/**
 * `storeFaults` names the tables whose reads THROW — a store that is down. The
 * thrown error is one instance per table, so a cell can assert that the error
 * the real request failed with IS the injected fault, not merely some error.
 */
function makeEngine(schema: Record<string, unknown>, storeFaults: ReadonlyMap<string, Error>) {
  const tables: Record<string, any[]> = {
    [OBJECT]: (Object.keys(ROWS) as RowKey[]).map((k) => ({ ...ROWS[k] })),
    sys_record_share: [{ ...READ_SHARE }],
    // The delegator exists, so `resolveDelegatorContext` reaches the grant reads.
    sys_user: [{ id: U_REPORTER, email: 'reporter@example.com' }],
  };
  // `$or` / `$and` conjoin WITH their sibling keys, the way a real driver ANDs
  // them. An operator this double does not know THROWS rather than comparing an
  // object to a scalar: a matcher that silently answers `false` would green a
  // refused cell for the wrong reason.
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      if (k.startsWith('$')) throw new Error(`engine double: unsupported operator '${k}'`);
      if (v != null && typeof v === 'object') {
        const ops = Object.keys(v as object);
        if (ops.length !== 1 || ops[0] !== '$in') {
          throw new Error(`engine double: unsupported predicate on '${k}': ${JSON.stringify(v)}`);
        }
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const middlewares: any[] = [];
  return {
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => (name === OBJECT ? schema : undefined),
    async find(object: string, options: any = {}) {
      const fault = storeFaults.get(object);
      if (fault) throw fault;
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      assertEngineFindOnePredicate(object, options);
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
  };
}

// ── the stack ──────────────────────────────────────────────────────────────

/** The real request's outcome. A failure keeps the thrown error itself. */
interface RequestOutcome {
  /** Read: the row came back. Write: the request passed every gate and reached the engine. */
  ok: boolean;
  error?: any;
}

interface Stack {
  /** The SecurityPlugin instance — private members reached for dependency-level faults. */
  plugin: any;
  sharing: SharingService;
  /** One error instance per faulted table (see {@link makeEngine}). */
  storeFaults: Map<string, Error>;
  explain: (operation: 'read' | 'update', rowKey: RowKey, context: any) => Promise<any>;
  /** The caller's own request for this one row, through BOTH real middlewares. */
  request: (operation: 'read' | 'update', rowKey: RowKey, context: any) => Promise<RequestOutcome>;
}

async function makeStack(
  opts: { schema?: Record<string, unknown>; storeFaults?: string[] } = {},
): Promise<Stack> {
  const schema = opts.schema ?? PRIVATE_SCHEMA;
  const storeFaults = new Map<string, Error>(
    (opts.storeFaults ?? []).map((t) => [t, new Error(`store unavailable: ${t}`)]),
  );
  const engine = makeEngine(schema, storeFaults);
  const metadata = {
    get: async (_type: string, name: string) => (name === OBJECT ? schema : null),
    list: async () => PERMISSION_SETS,
  };
  let security: any;
  let sharing: SharingService;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    // Org scoping active, so Layer 0 contributes a real tenant predicate.
    'org-scoping': { name: 'org-scoping' },
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
  const idOf = (rowKey: RowKey) => String(ROWS[rowKey].id);

  return {
    plugin,
    sharing,
    storeFaults,
    explain: (operation, rowKey, context) =>
      security.explain({ object: OBJECT, operation, recordId: idOf(rowKey) }, { ...context }),
    async request(operation, rowKey, context) {
      const recordId = idOf(rowKey);
      const where = { id: recordId };
      const opCtx: any = operation === 'read'
        ? { object: OBJECT, operation: 'find', context: { ...context }, options: { where }, ast: { where } }
        : { object: OBJECT, operation: 'update', context: { ...context }, data: { id: recordId, value: 2 } };
      let rows: any[] | undefined;
      let reached = false;
      try {
        await securityMw(opCtx, async () => {
          await sharingMw(opCtx, async () => {
            reached = true;
            // A write stops at the engine's door: reaching it is the admission
            // under test, and no write verb is exercised on this double.
            if (operation === 'read') rows = await engine.find(OBJECT, { where: opCtx.ast.where });
          });
        });
      } catch (error) {
        return { ok: false, error };
      }
      if (!reached) throw new Error('a middleware swallowed the request');
      return { ok: operation === 'read' ? (rows ?? []).some((r) => r.id === recordId) : true };
    },
  };
}

const layerOf = (decision: any, layer: string) => decision.layers.find((l: any) => l.layer === layer);

/** A rejecting stand-in whose error a cell can compare by identity. */
function rejecting(message: string): { fn: (...args: any[]) => Promise<never>; error: Error } {
  const error = new Error(message);
  return { fn: async () => { throw error; }, error };
}

/**
 * A fault cell: explain reports the record NOT visible, decided by `decidedBy`,
 * and the SAME fault fails the real request — the thrown error is `fault`.
 */
async function expectFaultCell(
  stack: Stack,
  operation: 'read' | 'update',
  rowKey: RowKey,
  context: any,
  decidedBy: string,
  fault: Error,
): Promise<any> {
  const decision = await stack.explain(operation, rowKey, context);
  const outcome = await stack.request(operation, rowKey, context);
  const cell = `${context.userId} × ${rowKey} × ${operation}`;
  expect(outcome.ok, `${cell}: the real request fails`).toBe(false);
  expect(outcome.error, `${cell}: the request failed with the injected fault itself`).toBe(fault);
  expect(
    decision.record?.visible,
    `${cell}: explain record.visible (decidedBy ${decision.record?.decidedBy}) — a fault is not an admission`,
  ).toBe(false);
  expect(decision.record?.decidedBy, `${cell}: the layer whose dependency faulted decides`).toBe(decidedBy);
  return decision;
}

/** The layer attribution a fault leaves: not evaluated, and no filter it never received. */
function expectNotEvaluated(decision: any, layer: string): void {
  const record = layerOf(decision, layer).record;
  expect(record.outcome, `${layer}: a layer whose dependency threw was not evaluated`).toBe('not_evaluated');
  expect(record.rowFilter, `${layer}: no filter is published for a call that returned none`).toBeUndefined();
  expect(record.matchesRecord, `${layer}: no match is claimed against a filter that does not exist`).toBeUndefined();
}

// ───────────────────────────────────────────────────────────────────────────

describe("plugin-sharing's read filter rejects — explain(read) fails closed", () => {
  const rows: RowKey[] = ['unshared', 'shared', 'owned'];
  it.each(rows)('the share store is down × %s row: not visible, and the find fails on the same fault', async (rowKey) => {
    const stack = await makeStack({ storeFaults: ['sys_record_share'] });
    const decision = await expectFaultCell(
      stack, 'read', rowKey, REPORTER_CTX, 'sharing', stack.storeFaults.get('sys_record_share')!,
    );
    expectNotEvaluated(decision, 'sharing');
  });

  it('a public_read object: the OWD does not reopen a record whose sharing call threw', async () => {
    // The sharing middleware asks the read filter on EVERY find, whatever the
    // OWD, and a rejection fails the find — so the baseline cannot admit it.
    const stack = await makeStack({ schema: PUBLIC_READ_SCHEMA });
    const fault = rejecting('sharing read filter rejected');
    (stack.sharing as any).buildReadFilter = fault.fn;
    const decision = await expectFaultCell(stack, 'read', 'unshared', REPORTER_CTX, 'sharing', fault.error);
    expectNotEvaluated(decision, 'sharing');
  });
});

describe('healthy sharing layer — reported exactly as before', () => {
  it('a shared row: admitted by sharing, and the find returns it', async () => {
    const stack = await makeStack();
    const decision = await stack.explain('read', 'shared', REPORTER_CTX);
    expect((await stack.request('read', 'shared', REPORTER_CTX)).ok).toBe(true);
    expect(decision.record).toEqual({ recordId: ROWS.shared.id, visible: true, decidedBy: 'sharing' });
    const sharingRecord = layerOf(decision, 'sharing').record;
    expect(sharingRecord.outcome).toBe('admitted');
    expect(sharingRecord.matchesRecord).toBe(true);
  });

  it('an unshared row: excluded by sharing, and the find does not return it', async () => {
    const stack = await makeStack();
    const decision = await stack.explain('read', 'unshared', REPORTER_CTX);
    expect((await stack.request('read', 'unshared', REPORTER_CTX)).ok).toBe(false);
    expect(decision.record).toEqual({ recordId: ROWS.unshared.id, visible: false, decidedBy: 'sharing' });
    const sharingRecord = layerOf(decision, 'sharing').record;
    expect(sharingRecord.outcome).toBe('excluded');
    expect(sharingRecord.matchesRecord).toBe(false);
  });

  it('a read filter that ANSWERS "no restriction" is still an answer — org depth with the share store down', async () => {
    // At `org` depth plugin-sharing returns `null` before it reads a share, so
    // the find succeeds with the store down. Only a REJECTION is a fault.
    const stack = await makeStack({ storeFaults: ['sys_record_share'] });
    const decision = await stack.explain('read', 'unshared', HR_CTX);
    expect((await stack.request('read', 'unshared', HR_CTX)).ok).toBe(true);
    expect(decision.record.visible).toBe(true);
    const sharingRecord = layerOf(decision, 'sharing').record;
    expect(sharingRecord.outcome).toBe('admitted');
    expect(sharingRecord.rowFilter).toBeNull();
  });
});

describe("plugin-sharing's per-record write gate rejects — explain(update) fails closed", () => {
  it('the owner: ownership does not answer for a gate that threw', async () => {
    const stack = await makeStack();
    const fault = rejecting('sharing write gate rejected');
    (stack.sharing as any).canEdit = fault.fn;
    const decision = await expectFaultCell(stack, 'update', 'owned', REPORTER_CTX, 'sharing', fault.error);
    expectNotEvaluated(decision, 'sharing');
  });

  it('a public_read object: the OWD does not answer for a gate that threw', async () => {
    const stack = await makeStack({ schema: PUBLIC_READ_SCHEMA });
    const fault = rejecting('sharing write gate rejected');
    (stack.sharing as any).canEdit = fault.fn;
    const decision = await expectFaultCell(stack, 'update', 'owned', REPORTER_CTX, 'sharing', fault.error);
    expectNotEvaluated(decision, 'sharing');
  });

  it('control: the healthy gate admits the owner, and the PATCH reaches the engine', async () => {
    const stack = await makeStack();
    const decision = await stack.explain('update', 'owned', REPORTER_CTX);
    expect((await stack.request('update', 'owned', REPORTER_CTX)).ok).toBe(true);
    expect(decision.record.visible).toBe(true);
    expect(layerOf(decision, 'sharing').record.outcome).toBe('admitted');
  });
});

describe('the layered RLS composition rejects — explain(read) fails closed', () => {
  const cells: Array<[string, RowKey, any]> = [
    ['dept_reporter via read share', 'shared', REPORTER_CTX],
    ['dept_reporter as owner', 'owned', REPORTER_CTX],
    ['hr_reviewer (org depth)', 'unshared', HR_CTX],
  ];
  it.each(cells)('%s × %s row: not visible, and the find fails on the same fault', async (_label, rowKey, context) => {
    const stack = await makeStack();
    const fault = rejecting('layered RLS composition rejected');
    stack.plugin.computeLayeredRlsFilter = fault.fn;
    const decision = await expectFaultCell(stack, 'read', rowKey, context, 'rls', fault.error);
    // The object-level answer to the same fault was already a denial; the row
    // verdict may no longer contradict it.
    expect(decision.allowed).toBe(false);
    expectNotEvaluated(decision, 'tenant_isolation');
    expectNotEvaluated(decision, 'rls');
  });

  it('control: the healthy composition admits the tenant wall and publishes its predicate', async () => {
    const stack = await makeStack();
    const decision = await stack.explain('read', 'owned', REPORTER_CTX);
    expect((await stack.request('read', 'owned', REPORTER_CTX)).ok).toBe(true);
    expect(decision.record.visible).toBe(true);
    const tenantRecord = layerOf(decision, 'tenant_isolation').record;
    expect(tenantRecord.outcome).toBe('admitted');
    expect(tenantRecord.rowFilter).not.toBeNull();
  });
});

describe("the on-behalf-of delegator's grants cannot be read — explain fails closed", () => {
  it('the D10 intersection is not dropped: allowed is false, and the find answers the 503', async () => {
    const stack = await makeStack({ storeFaults: ['sys_user_position'] });
    const decision = await stack.explain('read', 'unshared', ON_BEHALF_CTX);
    const outcome = await stack.request('read', 'unshared', ON_BEHALF_CTX);
    // ADR-0112 envelope of the enforcement refusal — never a bare throw.
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(outcome.error?.statusCode ?? outcome.error?.status).toBe(503);
    expect(decision.allowed, 'the agent may not act alone when its delegator cannot be resolved').toBe(false);
    expect(layerOf(decision, 'principal').verdict).toBe('denies');
    expect(layerOf(decision, 'object_crud').verdict).toBe('denies');
    expect(decision.record).toEqual({ recordId: ROWS.unshared.id, visible: false, decidedBy: 'object_crud' });
  });

  it('control: a delegator that resolves leaves the principal layer neutral', async () => {
    const stack = await makeStack();
    const decision = await stack.explain('read', 'unshared', ON_BEHALF_CTX);
    expect(layerOf(decision, 'principal').verdict).toBe('neutral');
  });
});
