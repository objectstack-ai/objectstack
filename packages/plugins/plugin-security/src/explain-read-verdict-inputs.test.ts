// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security/explain` for a READ must ask plugin-sharing's read filter with the
// same read DEPTH the find path hands it, so its `record.visible` equals whether
// the caller's `find` returns the row.
//
// The measured divergence: on a private-OWD object, explain answered
// `record.visible: false` (`decidedBy: 'sharing'`) for `read` on rows the same
// caller's `find` RETURNED, through the same stack. The middleware (step 2.6)
// stamps `__readScope` on the context before plugin-sharing's `buildReadFilter`
// reads it; explain asked the same filter with the bare context, so an `org`
// reader got an owner-only filter where `find` got none, and a `unit` reader
// got `owner_id = me` where `find` got the unit's owners. It fails CLOSED — the
// report under-states visibility, enforcement is right — and it is the read
// twin of the write-depth stamp in `explain-write-verdict-inputs.test.ts`.
//
// This file wires the REAL SecurityPlugin (middleware + explain entry point),
// the REAL SharingService and sharing middleware, and the REAL platform
// `member_default` seed over one in-memory engine, and asserts one property per
// cell: explain's `record.visible` equals the find's outcome. A cell that
// asserts only one side would pin nothing about the agreement this file exists
// for.
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

/**
 * `sharingModel` UNSET, which ADR-0090 D1 resolves to `private` (fail-closed
 * default), so plugin-sharing's owner-match is in play for every reader.
 */
const PRIVATE_SCHEMA = {
  name: OBJECT,
  fields: fieldsOf('id', 'name', 'value', 'owner_id', 'created_by', 'organization_id'),
};

/** The OWD control: the object's own model opens reads. */
const PUBLIC_READ_SCHEMA = { ...PRIVATE_SCHEMA, sharingModel: 'public_read' };

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const ADMIN_FULL_ACCESS = defaultPermissionSets.find((p) => p.name === 'admin_full_access')!;

const readerAt = (name: string, readScope: 'own' | 'unit' | 'org'): PermissionSet =>
  PermissionSetSchema.parse({
    name,
    objects: { [OBJECT]: { allowRead: true, readScope } },
  });

/** Read depth `org` — an HR reviewer who may read any line. */
const HR_REVIEWER = readerAt('hr_reviewer', 'org');
/** Read depth `unit` — a team lead who reads the lines their unit owns. */
const TEAM_LEAD = readerAt('team_lead', 'unit');
/** Read depth `own` — widened only by ownership or a share. The control. */
const DEPT_REPORTER = readerAt('dept_reporter', 'own');

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, ADMIN_FULL_ACCESS, HR_REVIEWER, TEAM_LEAD, DEPT_REPORTER];

// ── principals and rows ────────────────────────────────────────────────────

const U_ADMIN = 'u_admin';
const U_HR = 'u_hr';
const U_LEAD = 'u_lead';
const U_REPORTER = 'u_reporter';

const ctxFor = (userId: string, permission: string) => ({
  userId, tenantId: 'org1', positions: ['org_member'], permissions: [permission],
});

const ADMIN_CTX = ctxFor(U_ADMIN, 'admin_full_access');
const HR_CTX = ctxFor(U_HR, 'hr_reviewer');
const LEAD_CTX = ctxFor(U_LEAD, 'team_lead');
const REPORTER_CTX = ctxFor(U_REPORTER, 'dept_reporter');

/**
 * The lead's unit is the lead and the reporter. Both sides consult this ONE
 * resolver through plugin-sharing, so a `unit` cell tests the depth input, not
 * two hierarchies.
 */
const UNIT_OWNERS = [U_LEAD, U_REPORTER];

type RowKey = 'shared' | 'owned' | 'unshared';

const ROWS: Record<RowKey, Record<string, unknown>> = {
  /** Owned by the admin; the reporter holds a `read` share on it. */
  shared: { id: 'kle_shared', name: 'Shared', value: 1, owner_id: U_ADMIN, created_by: U_ADMIN, organization_id: 'org1' },
  /** Owned by the reporter — inside the lead's unit. */
  owned: { id: 'kle_owned', name: 'Owned', value: 1, owner_id: U_REPORTER, created_by: U_ADMIN, organization_id: 'org1' },
  /** Neither shared with nor owned by the reporter or the lead's unit. */
  unshared: { id: 'kle_unshared', name: 'Unshared', value: 1, owner_id: U_ADMIN, created_by: U_ADMIN, organization_id: 'org1' },
};

const READ_SHARE = {
  id: 'shr_read', object_name: OBJECT, record_id: ROWS.shared.id,
  recipient_type: 'user', recipient_id: U_REPORTER, access_level: 'read', source: 'manual',
};

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine(schema: Record<string, unknown>) {
  const tables: Record<string, any[]> = {
    [OBJECT]: (Object.keys(ROWS) as RowKey[]).map((k) => ({ ...ROWS[k] })),
    sys_record_share: [{ ...READ_SHARE }],
  };
  // `$or` / `$and` conjoin WITH their sibling keys, the way a real driver ANDs
  // them (#7620). An operator this double does not know THROWS rather than
  // comparing an object to a scalar: a matcher that silently answers `false`
  // would green every refused cell below for the wrong reason.
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
    _tables: tables,
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => (name === OBJECT ? schema : undefined),
    async find(object: string, options: any = {}) {
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

interface Stack {
  explain: (rowKey: RowKey, context: any) => Promise<any>;
  /** The caller's `find` for this one row, through BOTH real middlewares. */
  find: (rowKey: RowKey, context: any) => Promise<any[]>;
  /** Every context explain handed plugin-sharing's read filter. */
  readFilterContexts: any[];
}

async function makeStack(opts: { schema?: Record<string, unknown> } = {}): Promise<Stack> {
  const schema = opts.schema ?? PRIVATE_SCHEMA;
  const engine = makeEngine(schema);
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

  sharing = new SharingService({
    engine: engine as any,
    securityService: () => security,
    hierarchyResolver: () => ({
      resolveOwnerIds: async (input: { userId: string }, scope: string) =>
        (scope === 'unit' && input.userId === U_LEAD ? [...UNIT_OWNERS] : [input.userId]),
    }) as any,
  });
  const sharingMw = buildSharingMiddleware(sharing, ctx.logger);
  const securityMw = engine._middlewares[0];
  const idOf = (rowKey: RowKey) => String(ROWS[rowKey].id);

  // Recorded for the on-behalf-of pin; the call itself goes through unchanged.
  const readFilterContexts: any[] = [];
  const buildReadFilter = sharing.buildReadFilter.bind(sharing);
  let explaining = false;
  sharing.buildReadFilter = async (o: string, c: any) => {
    if (explaining) readFilterContexts.push(c);
    return buildReadFilter(o, c);
  };

  return {
    readFilterContexts,
    async explain(rowKey, context) {
      explaining = true;
      try {
        return await security.explain({ object: OBJECT, operation: 'read', recordId: idOf(rowKey) }, { ...context });
      } finally {
        explaining = false;
      }
    },
    async find(rowKey, context) {
      const where = { id: idOf(rowKey) };
      const opCtx: any = {
        object: OBJECT,
        operation: 'find',
        context: { ...context },
        options: { where },
        ast: { where },
      };
      let result: any[] | undefined;
      await securityMw(opCtx, async () => {
        await sharingMw(opCtx, async () => {
          result = await engine.find(OBJECT, { where: opCtx.ast.where });
        });
      });
      if (!result) throw new Error('a middleware swallowed the find');
      return result;
    },
  };
}

/**
 * One cell: explain FIRST, then the find, then the agreement. The find's own
 * answer is asserted too, so a cell cannot go green by both sides drifting.
 */
async function expectCell(stack: Stack, rowKey: RowKey, context: any, expected: boolean): Promise<any> {
  const decision = await stack.explain(rowKey, context);
  const rows = await stack.find(rowKey, context);
  const found = rows.some((r) => r.id === ROWS[rowKey].id);
  const cell = `${context.userId} × ${rowKey} × read`;
  expect(found, `${cell}: the find returns the row`).toBe(expected);
  expect(
    decision.record?.visible,
    `${cell}: explain record.visible (decidedBy ${decision.record?.decidedBy}) must equal the find's outcome`,
  ).toBe(found);
  return decision;
}

// ───────────────────────────────────────────────────────────────────────────

describe('explain(read) agrees with the find, cell by cell (private OWD)', () => {
  const cells: Array<[string, RowKey, any, boolean]> = [
    ['builtin admin', 'unshared', ADMIN_CTX, true],
    ['hr_reviewer (org depth)', 'shared', HR_CTX, true],
    ['hr_reviewer (org depth)', 'owned', HR_CTX, true],
    ['hr_reviewer (org depth)', 'unshared', HR_CTX, true],
    ['team_lead (unit depth), owned inside the unit', 'owned', LEAD_CTX, true],
    ['team_lead (unit depth), owned outside the unit', 'unshared', LEAD_CTX, false],
    ['team_lead (unit depth), shared to someone else', 'shared', LEAD_CTX, false],
    ['dept_reporter (own depth) via read share', 'shared', REPORTER_CTX, true],
    ['dept_reporter (own depth) as owner', 'owned', REPORTER_CTX, true],
    ['dept_reporter (own depth), unshared and not owned', 'unshared', REPORTER_CTX, false],
  ];
  it.each(cells)('%s × %s row', async (_label, rowKey, context, expected) => {
    await expectCell(await makeStack(), rowKey, context, expected);
  });

  it('negative control: the refused cell is refused by the sharing layer explain reports', async () => {
    const decision = await expectCell(await makeStack(), 'unshared', REPORTER_CTX, false);
    expect(decision.record.decidedBy).toBe('sharing');
    expect(decision.layers.find((l: any) => l.layer === 'sharing').record.outcome).toBe('excluded');
  });
});

describe('the read depth: explain stamps it the way step 2.6 does', () => {
  it('an org-depth reader is admitted by the sharing layer on an unshared, not-owned row', async () => {
    const decision = await expectCell(await makeStack(), 'unshared', HR_CTX, true);
    const sharingRecord = decision.layers.find((l: any) => l.layer === 'sharing').record;
    // `org` depth: plugin-sharing imposes no owner-match, which is what the
    // find saw (its AST carries only the id and tenant terms).
    expect(sharingRecord.outcome).toBe('admitted');
    expect(sharingRecord.rowFilter).toBeNull();
  });

  it('a depth the CALLER brings does not decide — explain computes it, as step 2.6 overwrites it (widening)', async () => {
    // One variable: `__readScope` stamped on the explained context. The find
    // path overwrites any such key before plugin-sharing reads it, so it
    // refuses; explain must not be widened by it either.
    const forged = { ...REPORTER_CTX, __readScope: 'org' };
    await expectCell(await makeStack(), 'unshared', forged, false);
  });

  it('a depth the CALLER brings does not decide — explain computes it, as step 2.6 overwrites it (narrowing)', async () => {
    const forged = { ...HR_CTX, __readScope: 'own' };
    await expectCell(await makeStack(), 'unshared', forged, true);
  });
});

describe('the on-behalf-of path keeps its previous inputs', () => {
  it("explain hands plugin-sharing's read filter the delegated context unchanged", async () => {
    // The middleware's delegated read depth (the agent-leg intersection, plus
    // a second filter AND-ed in under the delegator's identity) is not
    // modelled on explain's record path. Stamping the AGENT's own depth here
    // without that second filter could only widen the report past what the
    // delegated find returns, so the delegated context is passed as it was.
    const stack = await makeStack();
    const delegated = { ...HR_CTX, onBehalfOf: { userId: U_REPORTER } };
    await stack.explain('unshared', delegated);
    expect(stack.readFilterContexts.length, 'explain consulted the read filter').toBeGreaterThan(0);
    for (const c of stack.readFilterContexts) {
      expect(c.onBehalfOf?.userId).toBe(U_REPORTER);
      expect('__readScope' in c, 'no read depth stamped on a delegated context').toBe(false);
    }
  });
});

describe('OWD control: `public_read` — the object\'s own model opens reads', () => {
  const principals: Array<[string, any]> = [
    ['hr_reviewer', HR_CTX],
    ['team_lead', LEAD_CTX],
    ['dept_reporter', REPORTER_CTX],
  ];
  const rows: RowKey[] = ['shared', 'owned', 'unshared'];
  const cells = principals.flatMap(([label, context]) => rows.map((r) => [label, r, context] as const));
  it.each(cells)('%s × %s row: both admit', async (_label, rowKey, context) => {
    await expectCell(await makeStack({ schema: PUBLIC_READ_SCHEMA }), rowKey, context, true);
  });
});
