// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18682] `canWriteObject` agrees with the engine middleware, case for case.
 *
 * ## Why this file exists, and why it is an EQUIVALENCE
 *
 * `ObjectQL.validate()` previews a write without running middleware, and a
 * validation rule that reads one hop through a reference field is evaluated
 * there against a related row fetched under SYSTEM authority. The accepted cost
 * of that elevation is an inference channel bounded to callers who could
 * perform the write — a bound the real write path gets for free, because the
 * middleware refuses first. The preview has to ask for it, and
 * {@link SecurityPlugin.canWriteObject} is what it asks.
 *
 * The first version of that question was NOT the middleware's decision. It
 * checked `isSystem`, a principal, and the CRUD grant — and admitted two
 * classes the write path refuses:
 *
 *   - a caller holding `allowCreate` but NOT an ADR-0066 D3 `requiredPermissions`
 *     capability the object declares (reachable from the wire: the `dryRun`
 *     import route);
 *   - an ADR-0090 D10 `onBehalfOf` context naming a delegator that does not
 *     exist (the in-process / `/mcp` door).
 *
 * Both are cases below. ⭐ But the point of this file is not those two cases: it
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

/** The payload every case carries unless it is about a restricted field. */
const PLAIN_PAYLOAD = { title: 'x' };
/** …and the one that names the column the FLS fixtures restrict. */
const REFERENCE_PAYLOAD = { title: 'x', account: 'acc_churn' };

async function boot(sets: PermissionSet[]) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      // Exactly one delegator exists. Every other lookup misses — which is what
      // makes DANGLING_DELEGATOR_CTX the D10 fail-closed case, while
      // DELEGATED_AGENT_CTX gets a delegator that really resolves (to the
      // additive baseline, and to nothing else).
      findOne: vi.fn(async (_object: string, query: any) => (
        query?.where?.id === LIVE_DELEGATOR
          ? { id: LIVE_DELEGATOR, email: 'boss@example.test' }
          : null
      )),
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

/** Would the ENGINE middleware admit this write here? */
async function middlewareAdmits(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  object: string,
  operation: 'insert' | 'update',
  context: Record<string, unknown>,
  data: unknown,
): Promise<boolean> {
  const opCtx: any = {
    object,
    operation,
    context: { ...context },
    options: {},
    data,
    ast: { where: {} },
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
  }> = [
    { label: 'no grant of any kind on the object', object: 'ledger', operation: 'insert', sets: [WRITER_SET], context: WRITER_CTX },
    { label: 'an explicit create grant', object: 'invoice', operation: 'insert', sets: [WRITER_SET], context: WRITER_CTX },
    { label: 'an explicit edit grant', object: 'invoice', operation: 'update', sets: [WRITER_SET], context: WRITER_CTX },
    { label: 'read but no write grant', object: 'invoice', operation: 'insert', sets: [READER_SET], context: WRITER_CTX },
    { label: 'a superuser wildcard', object: 'ledger', operation: 'insert', sets: [ADMIN_SET], context: { ...WRITER_CTX, posture: 'PLATFORM_ADMIN' } },
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
  ];

  for (const c of CASES) {
    it(`agrees on ${c.label}`, async () => {
      const { plugin, middleware } = await boot(c.sets);
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
});
