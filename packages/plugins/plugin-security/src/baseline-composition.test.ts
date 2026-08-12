// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7555] The human baseline COMPOSES; it does not displace.
//
// An app that marks one of its permission sets `isDefault` used to REPLACE the
// platform baseline for every member of that app: `fallbackPermissionSet` was a
// single name, and the app's name went in it. ADR-0090 D5 rules the opposite
// ("The fallback cliff is abolished. … `everyone` is additive like any other
// position: baseline ∪ explicit, always"), and the QA run behind #7555 measured
// what the displacement costs: on the showcase, all 10 built-in Account nav
// entries are served to a fresh member and 7/7 of the objects behind them
// answer 403, because `showcase_member_default` names no `sys_*` object and
// `member_default` was no longer in force.
//
// The cases below are red in BOTH directions on purpose:
//   • the app half goes red if the declared baseline stops being in force;
//   • the platform half goes red if the composition regresses to displacement;
//   • the `null` half goes red if composition turned the baseline into an
//     unconditional fall-open;
//   • the agent half goes red if the composed HUMAN baseline ever becomes
//     reachable from an agent principal (ADR-0090 D10).

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SET_RESTRICTED } from '@objectstack/spec/ai';
import { SecurityPlugin } from './security-plugin.js';
import { securityDefaultPermissionSets } from './manifest.js';
import {
  composeHumanBaselinePermissionSets,
  PLATFORM_BASELINE_PERMISSION_SET,
} from './app-default-permission-set.js';

// ---------------------------------------------------------------------------
// The pure decision, on its own.
// ---------------------------------------------------------------------------
describe('composeHumanBaselinePermissionSets (#7555)', () => {
  it('composes an app-declared baseline WITH the platform one, app first', () => {
    expect(composeHumanBaselinePermissionSets('app_member_default')).toEqual([
      'app_member_default',
      'member_default',
    ]);
  });

  it('does not duplicate the platform baseline when that IS the configured name', () => {
    expect(composeHumanBaselinePermissionSets(PLATFORM_BASELINE_PERMISSION_SET)).toEqual([
      'member_default',
    ]);
  });

  it('`null` still means NO baseline at all — composition never re-adds one', () => {
    // The one escape hatch, and deliberately all-or-nothing: a deployment that
    // wants a floor narrower than the platform's unbinds `member_default` from
    // the `everyone` anchor, it does not name a different set to displace it.
    expect(composeHumanBaselinePermissionSets(null)).toEqual([]);
    expect(composeHumanBaselinePermissionSets(undefined)).toEqual([]);
    expect(composeHumanBaselinePermissionSets('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// …and the same decision as the runtime enforces it.
// ---------------------------------------------------------------------------

/**
 * The app's declared default: read on ONE app object, and — exactly like the
 * showcase's own `showcase_member_default` — no `sys_*` object whatsoever.
 * That absence is the whole point: under displacement it is the entire access a
 * fresh member has.
 */
const appDefault: PermissionSet = {
  name: 'app_member_default',
  label: 'App Member Default',
  isDefault: true,
  objects: { app_announcement: { allowRead: true } },
} as any;

/**
 * `sys_user_preference` is the discriminator, for the reason the showcase
 * dogfood pins already record: the platform baseline grants it and nothing else
 * in the default set list does, so reading it answers "is `member_default` in
 * force" and nothing else. Asserted rather than assumed — if the platform
 * baseline ever stops naming it, this file must say so out loud instead of
 * quietly measuring nothing (the #6964 vacuity, one file over).
 */
const PLATFORM_ONLY_OBJECT = 'sys_user_preference';

it('guard: the platform baseline is the only default set granting the discriminator object', () => {
  const granting = securityDefaultPermissionSets
    .filter((p) => (p.objects as any)?.[PLATFORM_ONLY_OBJECT]?.allowRead === true)
    .map((p) => p.name);
  expect(granting).toEqual([PLATFORM_BASELINE_PERMISSION_SET]);
});

const makeHarness = (permissionSets: PermissionSet[]) => {
  const fields: Record<string, any> = {};
  for (const f of ['id', 'organization_id', 'owner_id', 'user_id', 'created_by', 'name']) {
    fields[f] = { name: f };
  }
  const schema: any = { name: 'probe', fields };
  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: () => schema,
    findOne: vi.fn(async () => null),
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => schema, list: async () => permissionSets },
  };
  const registered = new Map<string, unknown>();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: (name: string, value: unknown) => registered.set(name, value),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return {
    ctx,
    registered,
    read: async (object: string, context: any) => {
      const opCtx: any = { object, operation: 'find', options: {}, context };
      await middleware(opCtx, async () => {});
      return opCtx;
    },
  };
};

const bootWith = async (options: ConstructorParameters<typeof SecurityPlugin>[0]) => {
  const harness = makeHarness([appDefault]);
  const plugin = new SecurityPlugin(options);
  await plugin.init(harness.ctx);
  await plugin.start(harness.ctx);
  return harness;
};

const MEMBER = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };

describe('an app-declared baseline composes with the platform one (#7555)', () => {
  it('the app half: the declared baseline is in force', async () => {
    const h = await bootWith({ fallbackPermissionSet: 'app_member_default' });
    await expect(h.read('app_announcement', MEMBER)).resolves.toBeDefined();
  });

  it('the platform half: `member_default` is STILL in force alongside it', async () => {
    // Pre-#7555 this rejected — the single `fallbackPermissionSet` name held
    // the app's set, so the platform baseline resolved for nobody in that app
    // and every built-in Account destination 403'd for its members.
    const h = await bootWith({ fallbackPermissionSet: 'app_member_default' });
    await expect(h.read(PLATFORM_ONLY_OBJECT, MEMBER)).resolves.toBeDefined();
  });

  it('composition never re-adds a baseline the deployment DISABLED (`null`)', async () => {
    // Asserted on the resolved baseline rather than through the middleware, and
    // the difference is not stylistic: with zero permission sets the middleware
    // SKIPS its whole CRUD gate by design ("no permission-set restriction
    // applies"), so a `.rejects` case here would be red for a reason that has
    // nothing to do with composition — and green whether or not `member_default`
    // had been quietly composed back in. The baseline list is the thing under
    // test, so the baseline list is what this reads.
    const h = await bootWith({ fallbackPermissionSet: null });
    expect(h.registered.get('security.baselinePermissionSets')).toEqual([]);
    expect(h.registered.get('security.fallbackPermissionSet')).toBeNull();
  });

  it('and an undeclared app is unchanged — the platform baseline, alone', async () => {
    const h = await bootWith(undefined);
    await expect(h.read(PLATFORM_ONLY_OBJECT, MEMBER)).resolves.toBeDefined();
    await expect(h.read('app_announcement', MEMBER)).rejects.toMatchObject({
      name: 'PermissionDeniedError',
    });
  });

  it('publishes the composed list as `security.baselinePermissionSets`', async () => {
    const h = await bootWith({ fallbackPermissionSet: 'app_member_default' });
    expect(h.registered.get('security.baselinePermissionSets')).toEqual([
      'app_member_default',
      'member_default',
    ]);
    // …while `security.fallbackPermissionSet` keeps meaning "the single name
    // this deployment DECLARED". Consumers on the old contract are unmoved.
    expect(h.registered.get('security.fallbackPermissionSet')).toBe('app_member_default');
  });
});

describe('ADR-0090 D10 — the composed human baseline is unreachable from an agent', () => {
  const AGENT = {
    userId: 'u1',
    tenantId: 'org-1',
    positions: [],
    permissions: [],
    principalKind: 'agent',
  };

  it('an agent gets the restricted CEILING, never the human floor', async () => {
    const h = await bootWith({ fallbackPermissionSet: 'app_member_default' });
    // Both objects deny: the agent resolves `mcp_agent_restricted` (no object
    // access) and neither the app baseline nor `member_default` is composed in.
    // A composed human baseline leaking here would silently widen a read-only
    // agent past the scope its delegating user consented to.
    await expect(h.read(PLATFORM_ONLY_OBJECT, AGENT)).rejects.toMatchObject({
      name: 'PermissionDeniedError',
    });
    await expect(h.read('app_announcement', AGENT)).rejects.toMatchObject({
      name: 'PermissionDeniedError',
    });
  });

  it('the restricted set the agent DOES get is the spec constant, still shipped', () => {
    // Guards the case above against passing for the wrong reason: "everything
    // denies" would also be true if the restricted set had simply vanished from
    // the default list, which is a different bug wearing the same green.
    expect(securityDefaultPermissionSets.map((p) => p.name)).toContain(
      MCP_AGENT_PERMISSION_SET_RESTRICTED,
    );
  });
});
