// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ISecurityService.canReadObject` — the OBJECT-level read admission, exposed
 * for the read doors that bypass the engine middleware.
 *
 * ## Why the method exists
 *
 * `getReadFilter` answers "which ROWS", and it answers `undefined` — "no row
 * restriction" — for a caller who may not read the object at all. A door
 * holding only the filter therefore reads a caller with NO grant as a caller
 * with NO restriction. That inversion is what let the analytics raw-SQL path
 * answer `200 {"rows":[{"cnt":24}]}` for an object whose `/data` door answers
 * `403 PERMISSION_DENIED`, for the same principal on the same deployment.
 *
 * ## What these cases pin, and why the first one is the load-bearing one
 *
 * The value of this method is entirely in NOT DRIFTING from the middleware, so
 * the first describe block does not assert an expected boolean per case at
 * all: it drives the REAL registered middleware with a `find` for the same
 * (object, context) and asserts the method's answer equals whether the
 * middleware admitted. A future edit that changes one and not the other fails
 * here regardless of which direction it moved.
 *
 * The remaining blocks pin the arms individually, so a failure says WHICH arm
 * moved rather than only that something did.
 *
 * Harness: `tenant-layer0-verdict-on-operation.test.ts` — a SecurityPlugin over
 * a fake ObjectQL, with the registered middleware captured so the same plugin
 * instance answers both questions.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const ADMIN_SET = defaultPermissionSets.find((s) => s.name === ADMIN_FULL_ACCESS);
if (!ADMIN_SET) throw new Error(`fixture: '${ADMIN_FULL_ACCESS}' is not among the default permission sets`);

/**
 * The reported shape, in miniature: a member who holds a grant on ONE object
 * and nothing at all on the other. `employer_member` is the object the probe
 * counted 24 rows of while `/data` answered 403.
 */
const SEEKER_SET: PermissionSet = {
  name: 'member_default',
  label: 'Seeker',
  objects: { employer: { allowRead: true } },
} as unknown as PermissionSet;

/** Holds the read grant but not the capability the object requires (ADR-0066 D3). */
const CAPLESS_SET: PermissionSet = {
  name: 'member_default',
  label: 'Reader without the capability',
  objects: { payroll_run: { allowRead: true } },
} as unknown as PermissionSet;

/** …and the same grant WITH the capability, so the D3 arm is proven both ways. */
const CAPABLE_SET: PermissionSet = {
  name: 'member_default',
  label: 'Reader with the capability',
  objects: { payroll_run: { allowRead: true } },
  systemPermissions: ['manage_payroll'],
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
  employer: schema('employer'),
  employer_member: schema('employer_member'),
  payroll_run: schema('payroll_run', { requiredPermissions: ['manage_payroll'] }),
};

const SEEKER_CTX = { userId: 'u_seeker', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };

async function boot(sets: PermissionSet[]) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
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

/** Would the ENGINE middleware admit a plain `find` here? */
async function middlewareAdmits(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  object: string,
  context: Record<string, unknown>,
): Promise<boolean> {
  const opCtx: any = { object, operation: 'find', context: { ...context }, options: {}, ast: { where: {} } };
  try {
    await middleware(opCtx, async () => {});
    return true;
  } catch {
    return false;
  }
}

describe('canReadObject agrees with the engine middleware, case for case', () => {
  // The acceptance condition of the card this closes, asserted as an
  // EQUIVALENCE rather than as two independent expectations: whatever the
  // middleware answers for (object, context), this method must answer too.
  const CASES: Array<{ label: string; object: string; sets: PermissionSet[]; context: Record<string, unknown> }> = [
    { label: 'no grant of any kind on the object', object: 'employer_member', sets: [SEEKER_SET], context: SEEKER_CTX },
    { label: 'an explicit read grant', object: 'employer', sets: [SEEKER_SET], context: SEEKER_CTX },
    { label: 'a superuser wildcard', object: 'employer_member', sets: [ADMIN_SET], context: { ...SEEKER_CTX, posture: 'PLATFORM_ADMIN' } },
    { label: 'a required capability the caller lacks', object: 'payroll_run', sets: [CAPLESS_SET], context: SEEKER_CTX },
    { label: 'a required capability the caller holds', object: 'payroll_run', sets: [CAPABLE_SET], context: SEEKER_CTX },
    // A principal-less context — whichever way the middleware falls (it
    // short-circuits before its CRUD gate), this method must fall the same
    // way. Asserted as agreement rather than as an expected boolean precisely
    // because the fall direction is the middleware's to choose, not this
    // method's: pinning a literal here would be a second declaration of it.
    { label: 'a principal-less context', object: 'employer_member', sets: [SEEKER_SET], context: { positions: [], permissions: [] } },
    // …and the same question on an object no schema resolves — the #3545
    // fail-closed arm, again pinned as agreement.
    { label: 'an object whose posture cannot be resolved', object: 'not_a_registered_object', sets: [SEEKER_SET], context: SEEKER_CTX },
  ];

  it.each(CASES)('$label — one verdict for both doors', async ({ object, sets, context }) => {
    const { plugin, middleware } = await boot(sets);
    const viaMiddleware = await middlewareAdmits(middleware, object, context);
    const viaService = await (plugin as unknown as {
      canReadObject(o: string, c?: unknown): Promise<boolean>;
    }).canReadObject(object, context);
    expect(viaService).toBe(viaMiddleware);
  });
});

describe('canReadObject — the arms, individually', () => {
  it('REFUSES the object the caller holds no grant on (the reported request)', async () => {
    const { plugin } = await boot([SEEKER_SET]);
    await expect((plugin as any).canReadObject('employer_member', SEEKER_CTX)).resolves.toBe(false);
  });

  it('ADMITS the object the caller does hold a read grant on (the negative control)', async () => {
    // The control that separates this fix from "refuse everything on the
    // analytics path", which would make the refusal case above green while
    // deleting the SQL analytics path.
    const { plugin } = await boot([SEEKER_SET]);
    await expect((plugin as any).canReadObject('employer', SEEKER_CTX)).resolves.toBe(true);
  });

  it('bypasses for a system context, exactly as the middleware does', async () => {
    const { plugin } = await boot([SEEKER_SET]);
    await expect(
      (plugin as any).canReadObject('employer_member', { isSystem: true }),
    ).resolves.toBe(true);
  });

  it('REFUSES a required capability the caller lacks (ADR-0066 D3), ahead of the grant', async () => {
    const { plugin } = await boot([CAPLESS_SET]);
    await expect((plugin as any).canReadObject('payroll_run', SEEKER_CTX)).resolves.toBe(false);
  });

  it('ADMITS the same object once the caller holds the capability', async () => {
    const { plugin } = await boot([CAPABLE_SET]);
    await expect((plugin as any).canReadObject('payroll_run', SEEKER_CTX)).resolves.toBe(true);
  });

  it('REFUSES an unresolvable object posture (#3545 fail-closed)', async () => {
    // `isPrivate` would default to `false`, which is exactly what lets a plain
    // wildcard reach an object ADR-0066 D2 says it must not.
    const { plugin } = await boot([ADMIN_SET]);
    await expect((plugin as any).canReadObject('not_a_registered_object', SEEKER_CTX)).resolves.toBe(false);
  });

  it('REFUSES an empty object name rather than resolving something', async () => {
    const { plugin } = await boot([ADMIN_SET]);
    await expect((plugin as any).canReadObject('', SEEKER_CTX)).resolves.toBe(false);
  });

  it('is exposed on the registered "security" service, not only on the class', async () => {
    // A method the class declares but the service literal does not expose is
    // unreachable across the service-locator seam every cross-package consumer
    // uses — which for this method would mean the gate silently never runs.
    const registered: Record<string, unknown> = {};
    const middlewares: Array<unknown> = [];
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: {
        registerMiddleware: (mw: unknown) => middlewares.push(mw),
        getSchema: (name: string) => SCHEMAS[name],
        findOne: vi.fn(async () => null),
      },
      metadata: { get: async (_t: string, n: string) => SCHEMAS[n], list: async () => [SEEKER_SET] },
    };
    const ctx: Record<string, unknown> = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: (name: string, svc: unknown) => {
        registered[name] = svc;
      },
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as any);
    await plugin.start(ctx as any);

    const security = registered['security'] as { canReadObject?: (o: string, c?: unknown) => Promise<boolean> };
    expect(typeof security?.canReadObject).toBe('function');
    await expect(security.canReadObject!('employer_member', SEEKER_CTX)).resolves.toBe(false);
    await expect(security.canReadObject!('employer', SEEKER_CTX)).resolves.toBe(true);
  });
});
