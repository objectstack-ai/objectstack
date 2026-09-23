// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18682] `canWriteObject` against the engine middleware.
 *
 * ## Why this file exists, and why it is an EQUIVALENCE
 *
 * `ObjectQL.validate()` previews a write without running middleware, and a
 * validation rule that reads one hop through a reference field is evaluated
 * there against a related row fetched under SYSTEM authority. The preview asks
 * {@link SecurityPlugin.canWriteObject} before it reads.
 *
 * The first version of that question was NOT the middleware's decision. It
 * checked `isSystem`, a principal, and the CRUD grant — and admitted four
 * classes the write path refuses:
 *
 *   - a caller holding `allowCreate` but NOT an ADR-0066 D3 `requiredPermissions`
 *     capability the object declares (reachable from the wire: the `dryRun`
 *     import route);
 *   - an ADR-0090 D10 `onBehalfOf` context naming a delegator that does not
 *     exist (the in-process / `/mcp` door);
 *   - a user-context caller on an ADR-0103 `engine-owned` object whose
 *     `userActions` do not reopen the verb — refused BEFORE anything resolves,
 *     so no grant the caller can hold changes the answer;
 *   - a plain-CRUD holder on one of the ADR-0090 D12 RBAC link tables, refused
 *     at the same pre-resolution point for the same reason.
 *
 * All four are cases below. ⭐ But the point of this file is not those cases: it
 * is that the first block asserts no expected boolean per case at all. It drives
 * the REAL registered middleware with the write for the same (object, context)
 * and requires the method's answer to EQUAL whether the middleware admitted. Two
 * doors that merely agree today drift the first time one of them grows an arm,
 * and hand-adding the two missing arms without this pin would leave exactly that
 * exposure standing.
 *
 * ## …and why the PAYLOAD is part of every case
 *
 * That pin had a blind spot of its own for exactly one round: its payload was
 * `{ title: 'x' }`, which names no field any fixture restricts, so a whole
 * class of the middleware's write decision was invisible to it. The middleware
 * refuses payload-dependent writes before `next()` — the field-level-security
 * write gate (step 2.5) refuses a caller who holds the object's CRUD grant but
 * is not `editable` on a field the payload names. An editor of the child object
 * who is FLS-locked out of the lookup column is that caller, and it is the
 * common shape, not an exotic one.
 *
 * So the payload travels with the case and reaches BOTH doors, and the table
 * carries a field the fixtures actually restrict — in both directions, and once
 * under D10 delegation where the two masks must intersect rather than union.
 *
 * ## …and two blocks that are NOT equivalences
 *
 * Both need a caller the equivalence block has no fixture for: a DELEGATED
 * administrator (ADR-0090 D12) holding a real `adminScope` over a business-unit
 * subtree — the only caller the D12 gate's delegate branch judges, stamps and
 * refuses without an id. `boot(sets, tables)` hands the gate the stored rows it
 * reads for one (the topology is `delegated-admin-gate.test.ts`'s own); every
 * other boot passes no tables and gets the engine double exactly as before.
 *
 *   - **The copy.** The D12 arm is handed SHALLOW COPIES of the caller's rows,
 *     because the gate stamps `granted_by` onto the rows it is handed and the
 *     preview passes this method the caller's own payload. Nothing reads the
 *     stamp back, so no admission answer can notice the copy — only the
 *     caller's row can, and that is what the block asserts.
 *   - **The DIRECTION.** On an id-less UPDATE the probe refuses a delegate the
 *     middleware — holding the id — admits.
 *
 * Harness mirrors `can-read-object-admission.test.ts`, whose read twin this is.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const ADMIN_SET = defaultPermissionSets.find((s) => s.name === ADMIN_FULL_ACCESS);
if (!ADMIN_SET) throw new Error(`fixture: '${ADMIN_FULL_ACCESS}' is not among the default permission sets`);

/** Holds a write grant on one object and nothing at all on the other. */
const WRITER_SET: PermissionSet = {
  name: 'member_default',
  label: 'Writer',
  objects: { invoice: { allowRead: true, allowCreate: true, allowEdit: true } },
} as unknown as PermissionSet;

/** W3 — holds the write grant but NOT the capability the object requires. */
const CAPLESS_SET: PermissionSet = {
  name: 'member_default',
  label: 'Writer without the capability',
  objects: { payroll_run: { allowRead: true, allowCreate: true, allowEdit: true } },
} as unknown as PermissionSet;

/** …and the same grant WITH the capability, so the D3 arm is proven both ways. */
const CAPABLE_SET: PermissionSet = {
  name: 'member_default',
  label: 'Writer with the capability',
  objects: { payroll_run: { allowRead: true, allowCreate: true, allowEdit: true } },
  systemPermissions: ['manage_payroll'],
} as unknown as PermissionSet;

/** Read but no write — the grant axis itself. */
const READER_SET: PermissionSet = {
  name: 'member_default',
  label: 'Reader only',
  objects: { invoice: { allowRead: true } },
} as unknown as PermissionSet;

/**
 * ⭐ W6 — the write grant on the object, and NO `editable` on the lookup
 * column. The persona the FLS write gate exists for: may edit invoices, may not
 * repoint the account.
 */
const FLS_LOCKED_SET: PermissionSet = {
  name: 'member_default',
  label: 'Writer, FLS-locked on the reference column',
  objects: { invoice: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: { 'invoice.account': { readable: true, editable: false } },
} as unknown as PermissionSet;

/** …and the twin that MAY edit it, so the arm is proven in both directions. */
const FLS_OPEN_SET: PermissionSet = {
  name: 'member_default',
  label: 'Writer who may edit the reference column',
  objects: { invoice: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: { 'invoice.account': { readable: true, editable: true } },
} as unknown as PermissionSet;

/**
 * The AGENT's own set, which grants the column the baseline denies — so the D10
 * case turns on `intersectFieldMasks` and on nothing else. Resolved because the
 * context names it in `permissions`; the delegator resolves to the baseline
 * alone (`member_default`), which is `FLS_LOCKED_SET` in that boot.
 */
const AGENT_FLS_OPEN_SET: PermissionSet = {
  name: 'agent_writer',
  label: 'Agent who may edit the reference column',
  objects: { invoice: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: { 'invoice.account': { readable: true, editable: true } },
} as unknown as PermissionSet;

/**
 * ⭐ Y1 — full CRUD on an object a platform service owns end to end, and on the
 * sibling whose `userActions` reopen the verb. One fixture, both directions.
 */
const ENGINE_OWNED_SET: PermissionSet = {
  name: 'member_default',
  label: 'Full CRUD on an engine-owned object',
  objects: {
    eng_log: { allowRead: true, allowCreate: true, allowEdit: true },
    eng_log_amendable: { allowRead: true, allowCreate: true, allowEdit: true },
  },
} as unknown as PermissionSet;

/**
 * ⭐ Y3 — plain CRUD on an RBAC link table. ADR-0090 D12's whole point: holding
 * this does not make the caller a permission administrator.
 */
const RBAC_CRUD_SET: PermissionSet = {
  name: 'member_default',
  label: 'Plain CRUD on sys_user_position',
  objects: { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true } },
} as unknown as PermissionSet;

const schema = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    title: { type: 'text', label: 'Title' },
    account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
  },
  ...extra,
});

const SCHEMAS: Record<string, Record<string, unknown>> = {
  invoice: schema('invoice'),
  ledger: schema('ledger'),
  payroll_run: schema('payroll_run', { requiredPermissions: ['manage_payroll'] }),
  // ⭐ Y1 — ADR-0103. The bucket's locked default grants no write, so the
  // resolved affordances refuse every user-context verb…
  eng_log: schema('eng_log', { managedBy: 'engine-owned' }),
  // …and this one is the SAME bucket with `userActions` reopening create and
  // edit, which is how the admin/user-writable members of it pass the guard.
  eng_log_amendable: schema('eng_log_amendable', {
    managedBy: 'engine-owned',
    userActions: { create: true, edit: true },
  }),
  // ⭐ Y3 — ADR-0090 D12 governs this object by NAME, not by a bucket.
  sys_user_position: {
    name: 'sys_user_position',
    fields: {
      organization_id: { type: 'text', label: 'Organization' },
      user: { type: 'text', label: 'User' },
      position: { type: 'text', label: 'Position' },
    },
  },
};

const WRITER_CTX = { userId: 'u_writer', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };
/** W4 — names a delegator no `findOne` will resolve. */
const DANGLING_DELEGATOR_CTX = { ...WRITER_CTX, onBehalfOf: { userId: 'u_ghost' } };
/** The one delegator id the harness's `sys_user` lookup DOES resolve. */
const LIVE_DELEGATOR = 'u_boss';
/** The agent principal, acting for a delegator who resolves to the baseline. */
const AGENT_CTX = {
  userId: 'u_agent', tenantId: 'org-1', positions: [], permissions: ['agent_writer'], posture: 'MEMBER',
};
const DELEGATED_AGENT_CTX = { ...AGENT_CTX, onBehalfOf: { userId: LIVE_DELEGATOR } };

/**
 * ⭐ The tenant-level admin ADR-0090 D12 exists to let through: the context NAMES
 * the wildcard set, because the harness resolves a set only when the context
 * asks for it. Without the name the caller resolves to the baseline alone and
 * the case would prove nothing about the D12 arm.
 */
const TENANT_ADMIN_CTX = {
  userId: 'u_admin', tenantId: 'org-1', positions: [],
  permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN',
};
/**
 * ⭐ An authenticated session with NO active organization (ADR-0123 D2): the
 * writer's context minus its `tenantId`. Under a walled posture the write path
 * refuses it before `next()`.
 */
const ORGLESS_CTX = { userId: 'u_writer', positions: [], permissions: [], posture: 'MEMBER' };
/** A principal-less context — no positions, no sets, no `userId`. */
const PRINCIPAL_LESS_CTX = { positions: [], permissions: [] };
/** The system bypass, spelled the way every door spells it. */
const SYSTEM_CTX = { isSystem: true, userId: 'usr_system' };
/** The payload every case carries unless it is about a restricted field. */
const PLAIN_PAYLOAD = { title: 'x' };
/**
 * ⭐ The D12 payload. `position` is deliberately NOT `everyone` / `guest`: those
 * two are refused for every caller by the gate's audience-anchor invariant, and
 * a case that tripped it would prove nothing about the delegated-admin arm.
 */
const RBAC_PAYLOAD = { user: 'u_target', position: 'sales' };
/** …and the one that names the column the FLS fixtures restrict. */
const REFERENCE_PAYLOAD = { title: 'x', account: 'acc_churn' };

/**
 * ⭐ A DELEGATED administrator (ADR-0090 D12): no tenant-level wildcard, a plain
 * CRUD grant on the link table, and an `adminScope` over the `east` subtree —
 * the scope `delegated-admin-gate.test.ts` calls `EAST_SCOPE`, over the same
 * topology:
 *
 *   hq (bu_hq)
 *   ├── east (bu_east)          ← the scope's root
 *   │   └── east_sales (bu_es)
 *   └── west (bu_west)
 */
const EAST_SCOPE = {
  businessUnit: 'east',
  includeSubtree: true,
  manageAssignments: true,
  manageBindings: true,
  authorEnvironmentSets: true,
  assignablePermissionSets: ['sales_user', 'sub_admin'],
};
const DELEGATE_SET: PermissionSet = {
  name: 'sub_admin',
  label: 'Delegated administrator of the east subtree',
  objects: { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true } },
  adminScope: EAST_SCOPE,
} as unknown as PermissionSet;
const DELEGATE_CTX = {
  userId: 'u_delegate', tenantId: 'org-1', positions: [], permissions: ['sub_admin'], posture: 'MEMBER',
};

type Tables = Record<string, Array<Record<string, unknown>>>;

/**
 * The stored rows the D12 gate reads for that delegate: the BU tree its subtree
 * resolves over, the one set `sales_rep` distributes (allowlisted by the scope),
 * and — for the by-id update — the pre-image `a_prev`, anchored inside the
 * subtree. A fresh copy per boot, so no case sees another's rows.
 */
const delegateTables = (): Tables => ({
  sys_business_unit: [
    { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
    { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
    { id: 'bu_es', name: 'east_sales', parent_business_unit_id: 'bu_east' },
    { id: 'bu_west', name: 'west', parent_business_unit_id: 'bu_hq' },
  ],
  sys_position: [{ id: 'pos_sales', name: 'sales_rep' }],
  sys_position_permission_set: [{ id: 'b1', position_id: 'pos_sales', permission_set_id: 'ps_sales' }],
  sys_permission_set: [{ id: 'ps_sales', name: 'sales_user' }],
  sys_user_position: [{ id: 'a_prev', user: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es' }],
});

/** Equality and `$in`, nothing else — an operator this double does not know fails loudly, never matches silently. */
function rowMatches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, want]) => {
    if (key.startsWith('$')) throw new Error(`engine double: unsupported operator ${key}`);
    if (want && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)) {
      return ((want as { $in: unknown[] }).$in).includes(row[key]);
    }
    if (want && typeof want === 'object') throw new Error(`engine double: unsupported predicate on ${key}`);
    return row[key] === want;
  });
}

async function boot(sets: PermissionSet[], tables?: Tables, opts: { orgScoping?: boolean } = {}) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    // The `isolated` posture, resolved the way the plugin falls back to it when
    // no `tenancy` service is wired: only an ADR-0123 D2 case asks for it.
    ...(opts.orgScoping ? { 'org-scoping': { name: 'org-scoping' } } : {}),
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      // Exactly one delegator exists. Every other lookup misses — which is what
      // makes DANGLING_DELEGATOR_CTX the D10 fail-closed case, while
      // DELEGATED_AGENT_CTX gets a delegator that really resolves (to the
      // additive baseline, and to nothing else). A boot handed `tables` answers
      // those objects from its rows instead; no other boot does.
      findOne: vi.fn(async (object: string, query: any) => {
        if (tables && object in tables) {
          return tables[object].find((row) => rowMatches(row, query?.where)) ?? null;
        }
        return query?.where?.id === LIVE_DELEGATOR
          ? { id: LIVE_DELEGATOR, email: 'boss@example.test' }
          : null;
      }),
      // `find` exists ONLY on a boot handed `tables`, so every other boot keeps
      // the engine double the equivalence block has always run against.
      ...(tables
        ? {
            find: vi.fn(async (object: string, query: any) => {
              const rows = (tables[object] ?? []).filter((row) => rowMatches(row, query?.where));
              return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
            }),
          }
        : {}),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => sets,
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: Record<string, unknown> = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  return { plugin, middleware: middlewares[0] };
}

/**
 * Would the ENGINE middleware admit this write here?
 *
 * Without `id` this is the id-less write every equivalence case uses. With one
 * it is the engine's by-id update: the row named as `options.where.id`, and no
 * AST, because `update()` builds one only when it has no single id.
 */
async function middlewareAdmits(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  object: string,
  operation: 'insert' | 'update',
  context: Record<string, unknown>,
  data: unknown,
  id?: string,
): Promise<boolean> {
  const opCtx: any = {
    object,
    operation,
    context: { ...context },
    ...(id === undefined ? { options: {}, ast: { where: {} } } : { options: { where: { id } } }),
    data,
  };
  try {
    await middleware(opCtx, async () => {});
    return true;
  } catch {
    return false;
  }
}

describe('canWriteObject agrees with the engine middleware, case for case', () => {
  const CASES: Array<{
    label: string;
    object: string;
    operation: 'insert' | 'update';
    sets: PermissionSet[];
    context: Record<string, unknown>;
    /** The caller's payload, reaching BOTH doors. Defaults to `PLAIN_PAYLOAD`. */
    data?: unknown;
    /** Boot under the `isolated` posture, so the ADR-0123 D2 wall is armed. */
    orgScoping?: true;
  }> = [
    { label: 'no grant of any kind on the object', object: 'ledger', operation: 'insert', sets: [WRITER_SET], context: WRITER_CTX },
    { label: 'an explicit create grant', object: 'invoice', operation: 'insert', sets: [WRITER_SET], context: WRITER_CTX },
    { label: 'an explicit edit grant', object: 'invoice', operation: 'update', sets: [WRITER_SET], context: WRITER_CTX },
    { label: 'read but no write grant', object: 'invoice', operation: 'insert', sets: [READER_SET], context: WRITER_CTX },
    // ⭐ The context NAMES the wildcard set, for the reason TENANT_ADMIN_CTX
    // does: the harness resolves a set only when the context asks for it, so
    // without the name this caller resolves to the baseline alone, both doors
    // answer `false`, and the case agrees about something that is not a
    // wildcard at all — green, and vacuous with respect to its own label.
    { label: 'a superuser wildcard', object: 'ledger', operation: 'insert', sets: [ADMIN_SET], context: { ...WRITER_CTX, permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' } },
    // ⭐ W3 — the ADR-0066 D3 capability arm, the first class that leaked.
    { label: 'a required capability the caller LACKS', object: 'payroll_run', operation: 'insert', sets: [CAPLESS_SET], context: WRITER_CTX },
    { label: 'a required capability the caller HOLDS', object: 'payroll_run', operation: 'insert', sets: [CAPABLE_SET], context: WRITER_CTX },
    // ⭐ W4 — the ADR-0090 D10 dangling delegator, the second class that leaked.
    { label: 'an onBehalfOf naming a delegator that does not exist', object: 'invoice', operation: 'insert', sets: [WRITER_SET], context: DANGLING_DELEGATOR_CTX },
    // Whichever way the middleware falls on these, the method must fall the
    // same way — asserted as agreement rather than as an expected boolean,
    // because the fall direction is the middleware's to choose.
    { label: 'a principal-less context', object: 'invoice', operation: 'insert', sets: [WRITER_SET], context: { positions: [], permissions: [] } },
    { label: 'an object whose posture cannot be resolved', object: 'not_a_registered_object', operation: 'insert', sets: [WRITER_SET], context: WRITER_CTX },
    // ⭐ W6 — the field-level-security write gate, the third class that leaked,
    // and the first that only a PAYLOAD can reach. Both directions, both modes:
    // the same caller and the same payload, differing only in whether the
    // fixture grants `editable` on the column the payload names.
    { label: 'a payload naming a field the caller may NOT edit', object: 'invoice', operation: 'insert', sets: [FLS_LOCKED_SET], context: WRITER_CTX, data: REFERENCE_PAYLOAD },
    { label: 'a payload naming a field the caller MAY edit', object: 'invoice', operation: 'insert', sets: [FLS_OPEN_SET], context: WRITER_CTX, data: REFERENCE_PAYLOAD },
    { label: 'W6u — the same non-editable field in UPDATE mode', object: 'invoice', operation: 'update', sets: [FLS_LOCKED_SET], context: WRITER_CTX, data: REFERENCE_PAYLOAD },
    { label: 'a restricted field the payload does not name', object: 'invoice', operation: 'insert', sets: [FLS_LOCKED_SET], context: WRITER_CTX, data: PLAIN_PAYLOAD },
    // ⭐ The D10 half of the same arm: the agent may edit the column, the
    // delegator may not, and the effective mask is the INTERSECTION. Its
    // control twin is the identical caller with no delegation link.
    { label: 'a delegated agent whose delegator may not edit the field', object: 'invoice', operation: 'insert', sets: [AGENT_FLS_OPEN_SET, FLS_LOCKED_SET], context: DELEGATED_AGENT_CTX, data: REFERENCE_PAYLOAD },
    { label: 'the same agent acting for nobody', object: 'invoice', operation: 'insert', sets: [AGENT_FLS_OPEN_SET, FLS_LOCKED_SET], context: AGENT_CTX, data: REFERENCE_PAYLOAD },
    // ⭐ Y1 — ADR-0103, the first of the two PRE-RESOLUTION classes that leaked.
    // The caller holds every grant the object's own permission set can give and
    // the write path still refuses them: the refusal is about the OBJECT and the
    // CALLER CLASS, so no payload and no row can get them past it.
    { label: 'an engine-owned object under a full CRUD grant', object: 'eng_log', operation: 'insert', sets: [ENGINE_OWNED_SET], context: WRITER_CTX },
    { label: 'the same engine-owned object in UPDATE mode', object: 'eng_log', operation: 'update', sets: [ENGINE_OWNED_SET], context: WRITER_CTX },
    // …and the OTHER direction, which is what keeps the arm from being a blanket
    // deny on the bucket: the same bucket, the same caller, `userActions` open.
    { label: 'an engine-owned object whose userActions reopen create', object: 'eng_log_amendable', operation: 'insert', sets: [ENGINE_OWNED_SET], context: WRITER_CTX },
    { label: 'an engine-owned object for a SYSTEM context', object: 'eng_log', operation: 'insert', sets: [ENGINE_OWNED_SET], context: SYSTEM_CTX },
    { label: 'an engine-owned object for a principal-less context', object: 'eng_log', operation: 'insert', sets: [ENGINE_OWNED_SET], context: PRINCIPAL_LESS_CTX },
    // ⭐ Y3 — ADR-0090 D12, the second. Same shape, different mechanism: the
    // gate governs the object by name and asks about the caller's delegated
    // administration, which a CRUD grant is not.
    { label: 'an RBAC link table under a plain CRUD grant', object: 'sys_user_position', operation: 'insert', sets: [RBAC_CRUD_SET], context: WRITER_CTX, data: RBAC_PAYLOAD },
    { label: 'the same RBAC link table in UPDATE mode', object: 'sys_user_position', operation: 'update', sets: [RBAC_CRUD_SET], context: WRITER_CTX, data: RBAC_PAYLOAD },
    // …and its other direction: the tenant admin the gate exists to let through.
    { label: 'an RBAC link table for a tenant-level admin', object: 'sys_user_position', operation: 'insert', sets: [ADMIN_SET], context: TENANT_ADMIN_CTX, data: RBAC_PAYLOAD },
    { label: 'an RBAC link table for a SYSTEM context', object: 'sys_user_position', operation: 'insert', sets: [RBAC_CRUD_SET], context: SYSTEM_CTX, data: RBAC_PAYLOAD },
    { label: 'an RBAC link table for a principal-less context', object: 'sys_user_position', operation: 'insert', sets: [RBAC_CRUD_SET], context: PRINCIPAL_LESS_CTX, data: RBAC_PAYLOAD },
    // ⭐ ADR-0123 D2 — the no-active-organization wall, under the `isolated`
    // posture. The write grant is held; only the missing organization differs
    // from the control twin below, which the wall admits.
    { label: 'an authenticated caller with no active organization (ADR-0123 D2)', object: 'invoice', operation: 'insert', sets: [WRITER_SET], context: ORGLESS_CTX, orgScoping: true },
    { label: 'the same org-less caller in UPDATE mode', object: 'invoice', operation: 'update', sets: [WRITER_SET], context: ORGLESS_CTX, orgScoping: true },
    { label: 'an org-less caller who resolves no permission set at all', object: 'invoice', operation: 'insert', sets: [], context: ORGLESS_CTX, orgScoping: true },
    { label: 'the same caller WITH an active organization, under the same posture', object: 'invoice', operation: 'insert', sets: [WRITER_SET], context: WRITER_CTX, orgScoping: true },
  ];

  for (const c of CASES) {
    it(`agrees on ${c.label}`, async () => {
      const { plugin, middleware } = await boot(c.sets, undefined, { orgScoping: c.orgScoping });
      const data = 'data' in c ? c.data : PLAIN_PAYLOAD;
      const admitted = await middlewareAdmits(middleware, c.object, c.operation, c.context, data);
      const answered = await plugin.canWriteObject(c.object, c.operation, c.context, data);
      expect(answered).toBe(admitted);
    });
  }
});

/**
 * The two arms the first probe was missing, pinned individually so a failure
 * says WHICH arm moved rather than only that something did. Both assert the
 * DENY direction explicitly — the equivalence block above would still pass if
 * both doors admitted together, and these are the cases where admitting is the
 * defect.
 */
describe('the arms the CRUD grant alone does not cover', () => {
  it('DENIES a caller holding the write grant but not the required capability (ADR-0066 D3)', async () => {
    const { plugin } = await boot([CAPLESS_SET]);
    await expect(plugin.canWriteObject('payroll_run', 'insert', WRITER_CTX)).resolves.toBe(false);
  });

  it('ADMITS the same caller once the capability is held — so the arm is not a blanket deny', async () => {
    const { plugin } = await boot([CAPABLE_SET]);
    await expect(plugin.canWriteObject('payroll_run', 'insert', WRITER_CTX)).resolves.toBe(true);
  });

  it('DENIES an onBehalfOf naming a delegator that does not exist (ADR-0090 D10)', async () => {
    const { plugin } = await boot([WRITER_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', DANGLING_DELEGATOR_CTX)).resolves.toBe(false);
  });

  it('ADMITS the same caller with no onBehalfOf — so the D10 arm is not a blanket deny', async () => {
    const { plugin } = await boot([WRITER_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX)).resolves.toBe(true);
  });

  it('separates create from edit rather than answering one for both', async () => {
    const CREATE_ONLY: PermissionSet = {
      name: 'member_default',
      label: 'Create but not edit',
      objects: { invoice: { allowRead: true, allowCreate: true } },
    } as unknown as PermissionSet;
    const { plugin } = await boot([CREATE_ONLY]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX)).resolves.toBe(true);
    await expect(plugin.canWriteObject('invoice', 'update', WRITER_CTX)).resolves.toBe(false);
  });

  it('fails CLOSED on an empty object name', async () => {
    const { plugin } = await boot([ADMIN_SET]);
    await expect(plugin.canWriteObject('', 'insert', WRITER_CTX)).resolves.toBe(false);
  });

  it('admits a system context, like every other door', async () => {
    const { plugin } = await boot([WRITER_SET]);
    await expect(plugin.canWriteObject('ledger', 'insert', { isSystem: true })).resolves.toBe(true);
  });

  // ── the field-level-security write gate (the middleware's step 2.5) ───────

  it('DENIES a payload naming a field the caller may not edit', async () => {
    const { plugin } = await boot([FLS_LOCKED_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX, REFERENCE_PAYLOAD)).resolves.toBe(false);
  });

  it('DENIES it in UPDATE mode too — the gate is not insert-only', async () => {
    const { plugin } = await boot([FLS_LOCKED_SET]);
    await expect(plugin.canWriteObject('invoice', 'update', WRITER_CTX, REFERENCE_PAYLOAD)).resolves.toBe(false);
  });

  it('ADMITS the same payload once the field is editable — so the arm is not a blanket deny', async () => {
    const { plugin } = await boot([FLS_OPEN_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX, REFERENCE_PAYLOAD)).resolves.toBe(true);
  });

  it('ADMITS the locked caller for a payload that does not name the field', async () => {
    const { plugin } = await boot([FLS_LOCKED_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX, PLAIN_PAYLOAD)).resolves.toBe(true);
  });

  it('judges EVERY row of a batch, not just the first', async () => {
    const { plugin } = await boot([FLS_LOCKED_SET]);
    await expect(
      plugin.canWriteObject('invoice', 'insert', WRITER_CTX, [PLAIN_PAYLOAD, REFERENCE_PAYLOAD]),
    ).resolves.toBe(false);
  });

  it('asks NOTHING about fields when no payload is supplied — the middleware skips 2.5 the same way', async () => {
    const { plugin } = await boot([FLS_LOCKED_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX)).resolves.toBe(true);
  });

  it('DENIES a delegated agent the DELEGATOR may not edit the field for (ADR-0090 D10)', async () => {
    const { plugin } = await boot([AGENT_FLS_OPEN_SET, FLS_LOCKED_SET]);
    await expect(
      plugin.canWriteObject('invoice', 'insert', DELEGATED_AGENT_CTX, REFERENCE_PAYLOAD),
    ).resolves.toBe(false);
  });

  it('ADMITS the same agent acting for nobody — so the intersection is what denied', async () => {
    const { plugin } = await boot([AGENT_FLS_OPEN_SET, FLS_LOCKED_SET]);
    await expect(
      plugin.canWriteObject('invoice', 'insert', AGENT_CTX, REFERENCE_PAYLOAD),
    ).resolves.toBe(true);
  });

  // ── arm 2: the ADR-0103 engine-owned affordance gate (pre-resolution) ─────

  it('DENIES a full-CRUD holder on an engine-owned object (ADR-0103)', async () => {
    const { plugin } = await boot([ENGINE_OWNED_SET]);
    await expect(plugin.canWriteObject('eng_log', 'insert', WRITER_CTX, PLAIN_PAYLOAD)).resolves.toBe(false);
  });

  it('DENIES it in UPDATE mode too — the affordance is per verb, not per object', async () => {
    const { plugin } = await boot([ENGINE_OWNED_SET]);
    await expect(plugin.canWriteObject('eng_log', 'update', WRITER_CTX, PLAIN_PAYLOAD)).resolves.toBe(false);
  });

  it('ADMITS the same bucket once userActions reopen the verb — so the arm is not a blanket deny', async () => {
    const { plugin } = await boot([ENGINE_OWNED_SET]);
    await expect(plugin.canWriteObject('eng_log_amendable', 'insert', WRITER_CTX, PLAIN_PAYLOAD)).resolves.toBe(true);
  });

  it('ADMITS a system context on the engine-owned object — the bypass is intact', async () => {
    const { plugin } = await boot([ENGINE_OWNED_SET]);
    await expect(plugin.canWriteObject('eng_log', 'insert', SYSTEM_CTX, PLAIN_PAYLOAD)).resolves.toBe(true);
  });

  // ── arm 3: the ADR-0090 D12 delegated-admin gate (pre-resolution) ─────────

  it('DENIES a plain-CRUD holder on an RBAC link table (ADR-0090 D12)', async () => {
    const { plugin } = await boot([RBAC_CRUD_SET]);
    await expect(
      plugin.canWriteObject('sys_user_position', 'insert', WRITER_CTX, RBAC_PAYLOAD),
    ).resolves.toBe(false);
  });

  it('DENIES it in UPDATE mode too', async () => {
    const { plugin } = await boot([RBAC_CRUD_SET]);
    await expect(
      plugin.canWriteObject('sys_user_position', 'update', WRITER_CTX, RBAC_PAYLOAD),
    ).resolves.toBe(false);
  });

  it('ADMITS a tenant-level admin on the same table — so the arm is not a blanket deny', async () => {
    const { plugin } = await boot([ADMIN_SET]);
    await expect(
      plugin.canWriteObject('sys_user_position', 'insert', TENANT_ADMIN_CTX, RBAC_PAYLOAD),
    ).resolves.toBe(true);
  });

  it('DENIES a principal-less context on the RBAC link table — the gate fails CLOSED before the fall-open', async () => {
    const { plugin } = await boot([RBAC_CRUD_SET]);
    await expect(
      plugin.canWriteObject('sys_user_position', 'insert', PRINCIPAL_LESS_CTX, RBAC_PAYLOAD),
    ).resolves.toBe(false);
  });

  it('ADMITS a system context on the RBAC link table — the bypass is intact', async () => {
    const { plugin } = await boot([RBAC_CRUD_SET]);
    await expect(
      plugin.canWriteObject('sys_user_position', 'insert', SYSTEM_CTX, RBAC_PAYLOAD),
    ).resolves.toBe(true);
  });

  it('leaves an ordinary object untouched by either pre-resolution arm', async () => {
    const { plugin } = await boot([WRITER_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX, PLAIN_PAYLOAD)).resolves.toBe(true);
  });

  // ── arm 10: the ADR-0123 D2 no-active-organization wall (step 3.7) ─────────

  it('DENIES an authenticated caller with no active organization under a walled posture (ADR-0123 D2)', async () => {
    const { plugin } = await boot([WRITER_SET], undefined, { orgScoping: true });
    await expect(plugin.canWriteObject('invoice', 'insert', ORGLESS_CTX, PLAIN_PAYLOAD)).resolves.toBe(false);
    await expect(plugin.canWriteObject('invoice', 'update', ORGLESS_CTX, PLAIN_PAYLOAD)).resolves.toBe(false);
  });

  it('DENIES it when no permission set resolves, too — the wall is not behind the CRUD guard', async () => {
    const { plugin } = await boot([], undefined, { orgScoping: true });
    await expect(plugin.canWriteObject('invoice', 'insert', ORGLESS_CTX, PLAIN_PAYLOAD)).resolves.toBe(false);
  });

  it('ADMITS the same caller with an active organization — so the arm is not a blanket deny', async () => {
    const { plugin } = await boot([WRITER_SET], undefined, { orgScoping: true });
    await expect(plugin.canWriteObject('invoice', 'insert', WRITER_CTX, PLAIN_PAYLOAD)).resolves.toBe(true);
  });

  it('ADMITS the org-less caller under the `single` posture — the wall arms only where the posture walls', async () => {
    const { plugin } = await boot([WRITER_SET]);
    await expect(plugin.canWriteObject('invoice', 'insert', ORGLESS_CTX, PLAIN_PAYLOAD)).resolves.toBe(true);
  });
});

/**
 * ⭐ The D12 arm is handed COPIES of the caller's rows — a preview never writes
 * into the caller's own objects.
 *
 * The gate stamps `granted_by` (its dual audit) onto the rows it materialises,
 * and on an insert it materialises the payload rows BY REFERENCE. `validate()`
 * hands this method the caller's RAW payload, so passing it straight through
 * would stamp the caller's objects during a PREVIEW. No admission answer can
 * notice either way — nothing reads `granted_by` back — so only the caller's
 * row can, and that is what these cases read.
 *
 * Driven through the REAL booted plugin and the REAL gate. The call-through spy
 * is the non-vacuity leg: each case first proves the gate DID stamp what it was
 * handed — the hazard is live on this path — and only then that the caller's
 * row carries no stamp. Without that leg a gate refusing before its stamp would
 * leave the caller's row clean for the wrong reason, and the pin would hold
 * while pinning nothing.
 */
describe("the D12 arm judges copies — a preview never stamps the caller's rows", () => {
  const assignment = (user: string, businessUnit: string) => ({
    user, position: 'sales_rep', business_unit_id: businessUnit,
  });

  it('leaves a single caller row unstamped, while the gate stamps the copy it was handed', async () => {
    const { plugin } = await boot([DELEGATE_SET], delegateTables());
    const handedToGate = vi.spyOn((plugin as any).delegatedAdminGate, 'assert');
    const row = assignment('u_east_1', 'bu_es');

    await expect(
      plugin.canWriteObject('sys_user_position', 'insert', DELEGATE_CTX, row),
    ).resolves.toBe(true);

    expect(handedToGate).toHaveBeenCalledTimes(1);
    expect((handedToGate.mock.calls[0][0] as any).data.granted_by).toBe('u_delegate');
    expect('granted_by' in row).toBe(false);
  });

  it('leaves every row of a batch unstamped — the shape validate() actually sends', async () => {
    const { plugin } = await boot([DELEGATE_SET], delegateTables());
    const handedToGate = vi.spyOn((plugin as any).delegatedAdminGate, 'assert');
    const rows = [assignment('u_east_1', 'bu_es'), assignment('u_east_2', 'bu_east')];

    await expect(
      plugin.canWriteObject('sys_user_position', 'insert', DELEGATE_CTX, rows),
    ).resolves.toBe(true);

    expect(handedToGate).toHaveBeenCalledTimes(1);
    const handed = (handedToGate.mock.calls[0][0] as any).data as Array<Record<string, unknown>>;
    expect(handed.map((r) => r.granted_by)).toEqual(['u_delegate', 'u_delegate']);
    expect(rows.map((r) => 'granted_by' in r)).toEqual([false, false]);
  });
});

/**
 * ⭐ DIRECTION, not equivalence.
 *
 * A preview names no stored row, so on an UPDATE the probe hands the D12 gate
 * no id, and the gate's delegate branch refuses a mutation it cannot attribute
 * to one pre-imaged row (`isMutationWithoutId`, ahead of its branch switch).
 * The middleware holds that id — the engine's by-id update carries it as
 * `options.where.id` — and judges the pre-image instead, so the same delegate
 * sending the same patch is ADMITTED there.
 *
 * So this is asserted as a direction — this method `false`, the middleware
 * `true` — ⛔ never as equality, and it is kept out of the equivalence block,
 * whose doors must agree by construction. Both doors get the shape they really
 * receive: the probe an ARRAY (`validate()` always sends `rawRows`), the
 * middleware the engine's by-id `data` and id.
 */
describe('DIRECTION — a delegate UPDATE the probe refuses and the middleware admits', () => {
  it("REFUSES a scope-holding delegate's id-less UPDATE that the middleware, holding the id, ADMITS (ADR-0090 D12)", async () => {
    const { plugin, middleware } = await boot([DELEGATE_SET], delegateTables());
    const patch = { position: 'sales_rep', business_unit_id: 'bu_es' };

    const admitted = await middlewareAdmits(middleware, 'sys_user_position', 'update', DELEGATE_CTX, patch, 'a_prev');
    const answered = await plugin.canWriteObject('sys_user_position', 'update', DELEGATE_CTX, [patch]);

    expect(admitted).toBe(true);
    expect(answered).toBe(false);
  });
});
