// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auth route-ledger conformance (#3656) — the guard over the one surface the
 * #3642 capstone could only cover with a wildcard.
 *
 * The route table here belongs to better-auth, and the plugin mounts it with a
 * single catch-all, so there are no registration calls to capture the way
 * tranche 3 captured `registerStorageRoutes`. The enumeration seam is
 * `auth.api`: every better-auth endpoint carries `.path` and `.options.method`,
 * so a live instance IS the route table. Still a real enumeration — nothing
 * here is a list someone maintains by hand and hopes is current.
 *
 * Two directions, checked differently on purpose (see the ledger header):
 *
 *  1. STRICT — every reviewed `better-auth` row must exist upstream. This is
 *     the rename detector: `auth.me` targets `/get-session`, and if better-auth
 *     renames it, 26 `auth.*` SDK methods start 404-ing. Today nothing notices.
 *  2. EXACT — the mounted-surface inventory must equal the live enumeration in
 *     both directions. The catch-all publishes whatever upstream adds, so a
 *     version bump that introduces endpoints has to surface as a reviewable
 *     diff rather than as silently-exposed auth surface.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuthManager } from './auth-manager';
import { AUTH_ROUTE_LEDGER, BETTER_AUTH_MOUNTED_SURFACE } from './auth-route-ledger';

const BASE_PATH = '/api/v1/auth';

/**
 * The configuration the inventory is pinned at: every better-auth plugin the
 * SDK targets, turned on explicitly. The maximal surface, so no route the SDK
 * can reach is missing from the enumeration.
 */
const LEDGERED_PLUGIN_CONFIG = {
  organization: true,
  twoFactor: true,
  admin: true,
  oidcProvider: true,
  passkeys: true,
  magicLink: true,
  deviceAuthorization: true,
};

/**
 * `buildPluginList` reads env vars that can flip plugins on top of the config
 * above (`OS_SSO_ENABLED`, `OS_SCIM_ENABLED`, …). A developer with any of them
 * exported would enumerate a different surface and see a spurious diff, so they
 * are cleared for the duration of the suite.
 */
const ENV_KEYS = [
  'OS_SSO_ENABLED', 'OS_SSO_DOMAIN_VERIFICATION', 'OS_SCIM_ENABLED',
  'OS_AUTH_TWO_FACTOR', 'OS_AUTH_PASSWORD_REJECT_BREACHED',
  'OS_OIDC_PROVIDER_ENABLED', 'OS_MCP_SERVER_ENABLED',
];
const savedEnv: Record<string, string | undefined> = {};

let live: Set<string>;
/**
 * The options object better-auth was actually constructed with — the same one
 * its handlers read as `ctx.context.options`, so a capability switch read here
 * is the switch the runtime enforces, not a restatement of the ledger.
 */
let liveOptions: {
  user?: {
    changeEmail?: { enabled?: boolean };
    deleteUser?: { enabled?: boolean };
  };
};

beforeAll(async () => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }

  const manager = new AuthManager({
    secret: 'route-ledger-conformance-secret-32-chars',
    baseUrl: 'http://localhost:9',
    plugins: LEDGERED_PLUGIN_CONFIG,
  } as never);
  // No dataEngine: createDatabaseConfig() falls back to better-auth's in-memory
  // adapter. Route registration does not touch the database — only request
  // handling would — so the table enumerates identically.
  const auth = (await manager.getAuthInstance()) as unknown as {
    api: Record<string, { path?: string; options?: { method?: string | string[] } }>;
    options: typeof liveOptions;
  };
  liveOptions = auth.options;

  live = new Set<string>();
  for (const endpoint of Object.values(auth.api ?? {})) {
    if (typeof endpoint?.path !== 'string') continue;
    // The OIDC/OAuth discovery documents are mounted at the app ROOT by
    // auth-plugin.ts (RFC 8414 and OpenID Discovery both require well-known to
    // sit on the origin), not under the auth base path.
    const wire = endpoint.path.startsWith('/.well-known/')
      ? endpoint.path
      : `${BASE_PATH}${endpoint.path}`;
    const method = endpoint.options?.method;
    for (const verb of Array.isArray(method) ? method : [method ?? 'POST']) {
      live.add(`${verb} ${wire}`);
    }
  }
}, 60_000);

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('auth route ledger ↔ the live better-auth route table', () => {
  it('enumeration produced a real table (guard the guard)', () => {
    // An empty or tiny `auth.api` — a construction failure, a mocked module —
    // would make every assertion below vacuously pass.
    expect(live.size).toBeGreaterThan(100);
  });

  it('every reviewed better-auth row still exists upstream', () => {
    const missing = AUTH_ROUTE_LEDGER
      .filter((e) => e.source === 'better-auth')
      .map((e) => e.route)
      .filter((r) => !live.has(r));
    expect(
      missing,
      'ledgered auth routes better-auth no longer serves — the SDK methods naming them are ' +
        `now wire-level 404s:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('the mounted-surface inventory matches what the catch-all actually publishes', () => {
    const pinned = new Set(BETTER_AUTH_MOUNTED_SURFACE);
    const added = [...live].filter((r) => !pinned.has(r)).sort();
    const removed = [...pinned].filter((r) => !live.has(r)).sort();

    expect(
      added,
      'better-auth now publishes auth endpoints the ledger does not list. These are mounted ' +
        'PUBLICLY by the catch-all, so review them before pinning — then add them to ' +
        `BETTER_AUTH_MOUNTED_SURFACE:\n${added.join('\n')}`,
    ).toEqual([]);

    expect(
      removed,
      'pinned auth endpoints better-auth no longer publishes — anything depending on them ' +
        `is now a 404:\n${removed.join('\n')}`,
    ).toEqual([]);
  });
});

describe('auth route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = AUTH_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = AUTH_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('no route is ledgered twice, and every row is under the auth base path', () => {
    const seen = new Set<string>();
    const dupes = AUTH_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
    expect(dupes, `duplicate auth-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);

    const stray = AUTH_ROUTE_LEDGER
      .filter((e) => !e.route.includes(` ${BASE_PATH}/`))
      .map((e) => e.route);
    expect(stray, `rows outside ${BASE_PATH}: ${stray.join(', ')}`).toEqual([]);
  });

  it('the objectstack-mounted rows are the ones auth-plugin.ts serves itself', () => {
    // These are mounted on the raw app AHEAD of the catch-all, so they are
    // absent from `auth.api`'s wire table by construction (organization/
    // add-member exists on `auth.api` but carries NO path — server-only — so
    // the enumeration, which reads `.path`, never sees it either). Pinned so
    // the `source` split stays honest rather than becoming a place to park a
    // row that failed the upstream check.
    const own = AUTH_ROUTE_LEDGER.filter((e) => e.source === 'objectstack').map((e) => e.route).sort();
    expect(own).toEqual([
      'GET /api/v1/auth/bootstrap-status',
      'GET /api/v1/auth/config',
      'POST /api/v1/auth/organization/add-member',
    ]);
    for (const route of own) {
      expect(live.has(route), `${route} should NOT come from better-auth`).toBe(false);
    }
  });

  it('gap and mismatch counts only shrink', () => {
    // The surface audited clean at #3656: every SDK-reachable auth route
    // resolves against the live better-auth table.
    expect(AUTH_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length).toBeLessThanOrEqual(0);
    expect(AUTH_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length).toBeLessThanOrEqual(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * #7735 — the ledger's disposition for a capability-gated route must agree with
 * the SWITCH THE RUNTIME READS.
 *
 * This is the check whose absence was the whole defect. `change-email` and
 * `delete-user` are published by the catch-all unconditionally, so every guard
 * that asks "does better-auth serve this path" was green while one route
 * answered 400 `CHANGE_EMAIL_DISABLED` and the other 404 — mounted, ledgered as
 * live SDK surface, and dead. Path existence cannot see a feature switch.
 *
 * Both sides here are read independently: the left from `auth.options`, the
 * object better-auth's own handlers consult (`ctx.context.options.user
 * ?.changeEmail?.enabled`), the right from the ledger row. Deleting the config
 * in auth-manager.ts turns this red without touching the ledger, and re-booking
 * a `disabled` row as `sdk` turns it red without touching the config — a pin
 * that derived both sides from the ledger could do neither.
 */
describe('#7735 — capability switches ↔ ledger disposition', () => {
  /** The routes whose liveness is a better-auth `user.*` feature switch. */
  const CAPABILITY_GATED = [
    {
      route: 'POST /api/v1/auth/change-email',
      switchName: 'user.changeEmail.enabled',
      isOn: () => liveOptions?.user?.changeEmail?.enabled === true,
    },
    {
      route: 'POST /api/v1/auth/delete-user',
      switchName: 'user.deleteUser.enabled',
      isOn: () => liveOptions?.user?.deleteUser?.enabled === true,
    },
  ] as const;

  it.each(CAPABILITY_GATED)(
    'the row for $route matches the live $switchName',
    ({ route, switchName, isOn }) => {
      const row = AUTH_ROUTE_LEDGER.find((e) => e.route === route);
      expect(row, `${route} is missing from AUTH_ROUTE_LEDGER`).toBeDefined();

      const on = isOn();
      expect(
        row!.disposition,
        on
          ? `${switchName} is ON, so ${route} really is a live SDK surface and the ledger must book it as \`sdk\`.`
          : `${switchName} is OFF, so ${route} is refused at runtime. Booking it as \`sdk\` is the #7735 defect: `
            + 'either wire the capability, or leave the row `disabled` with the reason.',
      ).toBe(on ? 'sdk' : 'disabled');
    },
  );

  it('every `disabled` row names its refused capability, and the set is the reviewed one', () => {
    const disabled = AUTH_ROUTE_LEDGER.filter((e) => e.disposition === 'disabled');

    // Pinned, not counted: a second withheld capability is a product decision,
    // so it must arrive as a diff someone reads — the same reason
    // BETTER_AUTH_MOUNTED_SURFACE is checked for equality rather than growth.
    expect(
      disabled.map((e) => e.route).sort(),
      'the `disabled` set changed. A route may only sit here with a ruling behind it (#7735); '
        + 'wiring one up means moving it back to `sdk` in the same PR as the config.',
    ).toEqual(['POST /api/v1/auth/delete-user']);

    for (const row of disabled) {
      // `note` is what makes the state honest rather than merely quiet — the
      // hygiene test above requires one; this requires it to say something.
      expect(row.note ?? '', `${row.route} must say WHICH switch is off`).toMatch(/deleteUser|changeEmail/);
    }
  });
});
