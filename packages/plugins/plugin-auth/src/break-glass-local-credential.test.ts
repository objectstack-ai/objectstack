// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5892 / cloud ADR-0024 D5.2] The PASSWORD half of the break-glass
 * invariant — pinned, not implemented.
 *
 * #5892 asked for two things. The ban half was missing and is built in
 * `last-admin-ban-guard.ts`; this half — "`enforced` SSO must never disable the
 * last local admin's password" — was **already implemented** on `origin/main`
 * and had no test of its own, which is the state that lets a security
 * behaviour be refactored away without anything going red. So this file adds
 * the pins, over the shipped code, unchanged:
 *
 *  1. **The escape hatch stays wired under enforced SSO.** `resolveSsoOnly()`
 *     forces `disableSignUp` on and tells the console to hide the password
 *     form (`features.ssoEnforced`), but it must NEVER touch
 *     `emailAndPassword.enabled` — the endpoint has to remain callable, or the
 *     "use a password" link the login UI keeps for the env owner leads
 *     nowhere the day the IdP is down (`auth-manager.ts`, the
 *     `emailAndPassword` block and `getPublicConfig`).
 *  2. **The last local password cannot be removed.** The global before-hook
 *     refuses `/admin/ban-user`, `/admin/remove-user` and `/delete-user` when
 *     the target is the only user holding a `credential` account
 *     (`LAST_LOCAL_CREDENTIAL`). Under enforced SSO the managed team has no
 *     local credential at all, so that one account IS the escape hatch.
 *
 *     [#10776] The guard now runs only once the caller's identity is
 *     established. That moved WHEN it decides, not WHAT it decides, so the
 *     cases below still pin the same verdicts — they just have to present a
 *     resolvable credential to reach the guard at all, and the last case pins
 *     that an anonymous caller never reaches it.
 *
 * The middleware is driven directly with a synthetic `ctx` — the same shape
 * better-auth passes it (`path`, `body`, `context.adapter`) — because the
 * decision under test is entirely a function of those three, and standing up
 * a real better-auth server would test better-auth's router instead.
 *
 * Fail-OPEN is deliberate here and is NOT a drift from the ban guard's
 * fail-closed posture: this check's failure mode is a blocked legitimate
 * removal, whereas the ban guard's is a permanently locked-out environment.
 * The last case below pins that direction so a future "make it consistent"
 * refactor has to argue with a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAPIError } from 'better-auth/api';
import { AuthManager } from './auth-manager';

// Mock better-auth so building the instance neither needs a database nor
// starts a server; the config object is what these assertions read.
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));

import { betterAuth } from 'better-auth';

const SECRET = 'test-secret-at-least-32-chars-long';
const BASE_URL = 'http://localhost:3000';

type CapturedConfig = {
  emailAndPassword?: { enabled?: boolean; disableSignUp?: boolean };
  hooks?: { before?: (ctx: unknown) => Promise<unknown> };
};

async function buildConfig(
  options: Record<string, unknown> = {},
): Promise<{ config: CapturedConfig; manager: AuthManager }> {
  let captured: CapturedConfig = {};
  (betterAuth as unknown as { mockImplementation: (f: (c: CapturedConfig) => unknown) => void })
    .mockImplementation((config: CapturedConfig) => {
      captured = config;
      return { handler: vi.fn(), api: {} };
    });
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE_URL, ...options } as never);
  await manager.getAuthInstance();
  return { config: captured, manager };
}

/**
 * The `account` rows a deployment holds. `findOne` answers the target's own
 * credential lookup; `findMany` answers "who else holds one".
 *
 * [#10776] It also answers the `session` lookup the hook now makes BEFORE the
 * guard: the guard runs only for a caller whose identity is established, so a
 * synthetic ctx that wants to reach the guard has to carry one. Anything the
 * fake is not asked about answers `null`, which is exactly what an anonymous
 * caller's session lookup finds.
 */
const CALLER_TOKEN = 'tok_admin_caller';

function adapterWithCredentials(holders: string[]) {
  const rows = holders.map((userId) => ({ userId, providerId: 'credential' }));
  return {
    findOne: vi.fn(async ({ model, where }: { model?: string; where: Array<{ field: string; value: unknown }> }) => {
      if (model === 'session') {
        const token = where.find((w) => w.field === 'token')?.value;
        return token === CALLER_TOKEN
          ? { token, userId: 'usr_admin_caller', expiresAt: new Date(Date.now() + 3_600_000) }
          : null;
      }
      const userId = where.find((w) => w.field === 'userId')?.value;
      return rows.find((r) => r.userId === userId) ?? null;
    }),
    findMany: vi.fn(async () => rows),
  };
}

/**
 * A ctx the way better-auth hands it to the global before-hook, carrying a
 * resolvable credential. `signedIn: false` is the anonymous caller.
 */
function hookCtx(
  path: string,
  body: Record<string, unknown>,
  adapter: unknown,
  { signedIn = true }: { signedIn?: boolean } = {},
) {
  const headers = new Headers(signedIn ? { authorization: `Bearer ${CALLER_TOKEN}` } : {});
  return { path, body, headers, context: { adapter } };
}

let consoleSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const prevMcp = process.env.OS_MCP_SERVER_ENABLED;
const prevSsoOnly = process.env.OS_AUTH_SSO_ONLY;

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Keep the plugin list to the default surface — the MCP pair has its own
  // coverage and only lengthens these boots.
  process.env.OS_MCP_SERVER_ENABLED = 'false';
  delete process.env.OS_AUTH_SSO_ONLY;
});

afterEach(() => {
  consoleSpy.mockRestore();
  warnSpy.mockRestore();
  if (prevMcp === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
  else process.env.OS_MCP_SERVER_ENABLED = prevMcp;
  if (prevSsoOnly === undefined) delete process.env.OS_AUTH_SSO_ONLY;
  else process.env.OS_AUTH_SSO_ONLY = prevSsoOnly;
});

// ---------------------------------------------------------------------------
// 1. Enforced SSO keeps the password endpoint alive
// ---------------------------------------------------------------------------

describe('[#5892] enforced SSO hides the password form — it never disables it', () => {
  it('config knob: `emailAndPassword.enabled` stays true while sign-up is forced off', async () => {
    const { config, manager } = await buildConfig({ ssoOnlyMode: true });

    expect(config.emailAndPassword?.enabled).toBe(true);
    expect(config.emailAndPassword?.disableSignUp).toBe(true);

    const publicConfig = manager.getPublicConfig() as {
      emailPassword: { enabled: boolean; disableSignUp: boolean };
      features: { ssoEnforced: boolean };
    };
    // The console is told to HIDE the form (ssoEnforced) while the capability
    // it hides is still advertised as enabled — that gap is the break-glass
    // link, not an inconsistency.
    expect(publicConfig.features.ssoEnforced).toBe(true);
    expect(publicConfig.emailPassword.enabled).toBe(true);
    expect(publicConfig.emailPassword.disableSignUp).toBe(true);
  });

  it('env knob: `OS_AUTH_SSO_ONLY` reaches the same place', async () => {
    process.env.OS_AUTH_SSO_ONLY = 'true';
    const { config, manager } = await buildConfig();

    expect(config.emailAndPassword?.enabled).toBe(true);
    expect(config.emailAndPassword?.disableSignUp).toBe(true);
    expect(
      (manager.getPublicConfig() as { features: { ssoEnforced: boolean } }).features.ssoEnforced,
    ).toBe(true);
  });

  it('a deployment that really wants passwords off can still say so explicitly', async () => {
    // The invariant is "enforced SSO does not disable it", not "it can never be
    // disabled" — otherwise the assertion above would pass against code that
    // ignores the option entirely.
    const { config } = await buildConfig({ emailAndPassword: { enabled: false } });
    expect(config.emailAndPassword?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The last local credential cannot be banned / removed / deleted
// ---------------------------------------------------------------------------

describe('[#5892] the last local password login survives ban / remove / delete', () => {
  const BAN_PATHS = ['/admin/ban-user', '/admin/remove-user', '/delete-user'];

  it('refuses the removal when the target holds the ONLY credential account', async () => {
    const { config } = await buildConfig({ ssoOnlyMode: true });
    const before = config.hooks?.before;
    expect(typeof before).toBe('function');

    for (const path of BAN_PATHS) {
      const adapter = adapterWithCredentials(['usr_owner']);
      let caught: unknown;
      try {
        await before!(hookCtx(path, { userId: 'usr_owner' }, adapter));
      } catch (e) {
        caught = e;
      }
      expect(isAPIError(caught)).toBe(true);
      const api = caught as { statusCode: number; body: { code?: string; message?: string } };
      expect(api.body.code).toBe('LAST_LOCAL_CREDENTIAL');
      expect(api.body.message).toMatch(/identity-\s*provider outage|provider outage/);
    }
  });

  it('allows it when another user still holds a local password', async () => {
    const { config } = await buildConfig({ ssoOnlyMode: true });
    const adapter = adapterWithCredentials(['usr_owner', 'usr_second_admin']);

    await expect(
      config.hooks!.before!(hookCtx('/admin/ban-user', { userId: 'usr_owner' }, adapter)),
    ).resolves.toBeUndefined();
  });

  it('never fires for a credential-less (IdP-managed) target', async () => {
    // The managed population signs in through the IdP and holds no local
    // password, so removing one of them cannot cost anyone the escape hatch.
    const { config } = await buildConfig({ ssoOnlyMode: true });
    const adapter = adapterWithCredentials(['usr_owner']);

    await expect(
      config.hooks!.before!(hookCtx('/admin/ban-user', { userId: 'usr_managed' }, adapter)),
    ).resolves.toBeUndefined();
    // Only the target's own lookup ran — the whole-table scan is skipped.
    expect(adapter.findMany).not.toHaveBeenCalled();
  });

  it('fails OPEN on a lookup error — the opposite direction from the ban guard, on purpose', async () => {
    const { config } = await buildConfig({ ssoOnlyMode: true });
    // The session lookup succeeds — the identity is established — and it is the
    // GUARD's own lookup that fails. Otherwise this would be measuring the
    // #10776 fall-through instead of the fail-open direction.
    const adapter = {
      findOne: vi.fn(async ({ model, where }: { model?: string; where: Array<{ field: string; value: unknown }> }) => {
        if (model === 'session') {
          const token = where.find((w) => w.field === 'token')?.value;
          return token === CALLER_TOKEN
            ? { token, userId: 'usr_admin_caller', expiresAt: new Date(Date.now() + 3_600_000) }
            : null;
        }
        throw new Error('account table unreadable');
      }),
      findMany: vi.fn(async () => []),
    };

    // A blocked legitimate removal is the cost here; a locked-out environment
    // is the cost in `last-admin-ban-guard.ts`. Different failure modes,
    // different directions — see that file's header.
    await expect(
      config.hooks!.before!(hookCtx('/admin/ban-user', { userId: 'usr_owner' }, adapter)),
    ).resolves.toBeUndefined();
  });

  // ── [#10776] the guard is now downstream of authentication ───────────────

  it('does not run AT ALL for an unauthenticated caller — no throw, and no lookup', async () => {
    // The disclosure this closes is not only the 409: it is that the guard
    // queried the database about a user named by a caller nobody had
    // authenticated. So the absence of the lookup is asserted, not just the
    // absence of the refusal. The status-level half is pinned end-to-end in
    // `break-glass-guard-authentication-order.test.ts`.
    const { config } = await buildConfig({ ssoOnlyMode: true });

    for (const path of BAN_PATHS) {
      const adapter = adapterWithCredentials(['usr_owner']);

      await expect(
        config.hooks!.before!(hookCtx(path, { userId: 'usr_owner' }, adapter, { signedIn: false })),
      ).resolves.toBeUndefined();

      const askedAboutAccounts = adapter.findOne.mock.calls.some(
        ([q]: [{ model?: string }]) => q?.model === 'account',
      );
      expect(askedAboutAccounts, `${path}: the guard must not query for an anonymous caller`).toBe(
        false,
      );
      expect(adapter.findMany).not.toHaveBeenCalled();
    }
  });
});
