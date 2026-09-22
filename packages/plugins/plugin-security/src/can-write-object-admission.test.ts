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

const schema = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    title: { type: 'text', label: 'Title' },
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

async function boot(sets: PermissionSet[]) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      // Every delegator lookup misses — which is what makes
      // DANGLING_DELEGATOR_CTX the D10 case.
      findOne: vi.fn(async () => null),
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
): Promise<boolean> {
  const opCtx: any = {
    object,
    operation,
    context: { ...context },
    options: {},
    data: { title: 'x' },
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
  ];

  for (const c of CASES) {
    it(`agrees on ${c.label}`, async () => {
      const { plugin, middleware } = await boot(c.sets);
      const admitted = await middlewareAdmits(middleware, c.object, c.operation, c.context);
      const answered = await plugin.canWriteObject(c.object, c.operation, c.context);
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
});
