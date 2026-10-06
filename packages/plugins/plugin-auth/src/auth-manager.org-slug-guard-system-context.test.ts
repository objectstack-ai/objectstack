// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The organization slug guard (`organizationHooks.beforeUpdateOrganization`)
 * reads `sys_organization` and `sys_environment` through `withSystemContext`,
 * so both reads carry the explicit system opt-in (`isSystem: true`).
 *
 * The hook IS the guard: the organization id is the `where`, not the reader.
 * Before, both reads reached the engine with no principal and no opt-in — the
 * security middleware's principal-less hand-off (ADR-0096), which is not an
 * authorization, and which a deny of principal-less contexts would refuse.
 *
 * Three facts are pinned here:
 *
 *  1. both reads carry the opt-in, and the guard's answers (refuse a slug
 *     change while an active environment references the organization; allow
 *     it otherwise) are unchanged;
 *  2. the guard KEEPS refusing on an engine that refuses a principal-less,
 *     non-system context — its reads are not one, so the catch below never
 *     turns the refusal into a skipped guard;
 *  3. the catches around the two reads are unchanged: a read that throws ends
 *     the hook without refusing, as it did before. That is pre-existing
 *     behaviour, pinned as it stands, not endorsed here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));
vi.mock('better-auth/plugins/organization', () => ({
  organization: vi.fn((opts: any) => ({ id: 'organization', _opts: opts })),
}));
vi.mock('better-auth/plugins/two-factor', () => ({
  twoFactor: vi.fn((opts: any) => ({ id: 'two-factor', _opts: opts })),
}));
vi.mock('better-auth/plugins/magic-link', () => ({
  magicLink: vi.fn((_opts?: any) => ({ id: 'magic-link' })),
}));
vi.mock('better-auth/plugins/custom-session', () => ({
  customSession: vi.fn((fn: any) => ({ id: 'custom-session', _fn: fn })),
}));
vi.mock('better-auth/plugins/haveibeenpwned', () => ({
  haveIBeenPwned: vi.fn((opts: any) => ({ id: 'have-i-been-pwned', _opts: opts })),
}));

import { betterAuth } from 'better-auth';

type Query = { where?: Record<string, unknown>; context?: Record<string, unknown> } | undefined;
type Options = { context?: Record<string, unknown> } | undefined;

/** The context the engine would act under: the query's, overridden by the trailing options' (ObjectQL's rule). */
const effectiveContext = (q: Query, o?: Options): Record<string, unknown> => ({ ...(q?.context ?? {}), ...(o?.context ?? {}) });

function isPrincipalLessNonSystem(ctx: Record<string, unknown>): boolean {
  const positions = (ctx.positions as unknown[] | undefined) ?? [];
  const permissions = (ctx.permissions as unknown[] | undefined) ?? [];
  return positions.length === 0 && permissions.length === 0 && !ctx.userId && ctx.isSystem !== true;
}

const ORG = { id: 'org-42', slug: 'acme-old' };
const ENVS = [
  { id: 'e1', status: 'active' },
  { id: 'e2', status: 'archived' },
];

const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  // The MCP surface is default-ON and would append jwt + oauth-provider; this
  // file needs only the organization plugin's hooks.
  process.env.OS_MCP_SERVER_ENABLED = 'false';
});
afterEach(() => {
  if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
  else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
});

/** Build the manager over `dataEngine` and hand back the slug guard better-auth would call. */
async function slugGuard(dataEngine: unknown) {
  let captured: any;
  (betterAuth as any).mockImplementation((config: any) => {
    captured = config;
    return { handler: vi.fn(), api: {} };
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const manager = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'http://localhost:3000',
      plugins: { organization: true },
      dataEngine: dataEngine as any,
    });
    await manager.getAuthInstance();
  } finally {
    warnSpy.mockRestore();
  }
  const orgPlugin = captured.plugins.find((p: any) => p.id === 'organization');
  const guard = orgPlugin._opts.organizationHooks.beforeUpdateOrganization as (arg: unknown) => Promise<unknown>;
  expect(typeof guard).toBe('function');
  return (slug: string) => guard({ organization: { slug }, member: { organizationId: ORG.id } });
}

/** The guard's refusal, asserted on its envelope: better-auth's `FORBIDDEN` / 403, naming the active environments. */
async function expectSlugRefusal(attempt: Promise<unknown>) {
  const err = (await attempt.then(
    () => undefined,
    (e: unknown) => e,
  )) as { status?: unknown; statusCode?: unknown; body?: { message?: unknown } } | undefined;
  expect(err, 'the slug change was not refused').toBeTruthy();
  expect(err?.statusCode).toBe(403);
  expect(err?.status).toBe('FORBIDDEN');
  expect(String(err?.body?.message)).toMatch(/active.*environment/i);
}

describe('organization slug guard — both reads carry the system opt-in', () => {
  it('refuses a slug change while an active environment references the org, through two isSystem reads', async () => {
    const engine = {
      findOne: vi.fn(async (_object: string, _q?: Query, _o?: Options) => ORG),
      find: vi.fn(async (_object: string, _q?: Query, _o?: Options) => ENVS),
    };
    const update = await slugGuard(engine);

    await expectSlugRefusal(update('acme-new'));

    expect(engine.findOne).toHaveBeenCalledTimes(1);
    const [orgObject, orgQuery, orgOptions] = engine.findOne.mock.calls[0];
    expect(orgObject).toBe('sys_organization');
    expect(orgQuery?.where).toEqual({ id: ORG.id });
    expect(effectiveContext(orgQuery, orgOptions).isSystem, 'the organization read reached the engine without the system opt-in').toBe(true);

    expect(engine.find).toHaveBeenCalledTimes(1);
    const [envObject, envQuery, envOptions] = engine.find.mock.calls[0];
    expect(envObject).toBe('sys_environment');
    expect(envQuery?.where).toEqual({ organization_id: ORG.id });
    expect(effectiveContext(envQuery, envOptions).isSystem, 'the environment read reached the engine without the system opt-in').toBe(true);
  });

  it('allows the change when no active environment references the org', async () => {
    const engine = {
      findOne: vi.fn(async () => ORG),
      find: vi.fn(async () => [{ id: 'e2', status: 'archived' }]),
    };
    const update = await slugGuard(engine);
    await expect(update('acme-new')).resolves.toBeUndefined();
  });
});

describe('organization slug guard — on an engine that refuses a principal-less, non-system context', () => {
  it('still refuses the slug change — the guard is not skipped by the refusal', async () => {
    const refuse = (q?: Query, o?: Options) => {
      if (isPrincipalLessNonSystem(effectiveContext(q, o))) {
        throw Object.assign(new Error('[Security] Access denied: principal-less context'), {
          code: 'PERMISSION_DENIED',
          status: 403,
        });
      }
    };
    const engine = {
      findOne: vi.fn(async (_object: string, q?: Query, o?: Options) => {
        refuse(q, o);
        return ORG;
      }),
      find: vi.fn(async (_object: string, q?: Query, o?: Options) => {
        refuse(q, o);
        return ENVS;
      }),
    };
    const update = await slugGuard(engine);
    await expectSlugRefusal(update('acme-new'));
  });
});

describe('organization slug guard — the catches around the reads are unchanged (pre-existing)', () => {
  it('an organization read that throws ends the hook without refusing, as before', async () => {
    const engine = {
      findOne: vi.fn(async () => {
        throw new Error('store unavailable');
      }),
      find: vi.fn(async () => ENVS),
    };
    const update = await slugGuard(engine);
    await expect(update('acme-new')).resolves.toBeUndefined();
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('an environment read that throws ends the hook without refusing, as before', async () => {
    const engine = {
      findOne: vi.fn(async () => ORG),
      find: vi.fn(async () => {
        throw new Error('object sys_environment is not registered');
      }),
    };
    const update = await slugGuard(engine);
    await expect(update('acme-new')).resolves.toBeUndefined();
  });
});
