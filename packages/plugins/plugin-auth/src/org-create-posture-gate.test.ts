// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5233 — `organization/create` is gated by the AUTHORITATIVE tenancy posture,
// never by the demoted `OS_MULTI_ORG_ENABLED` boolean.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// The gate kept calling `resolveMultiOrgEnabled()` — a contract that stopped
// being true the day of the demotion — so a deployment configured the
// documented way (`OS_TENANCY_POSTURE=isolated`, legacy boolean unset) mounted
// the entire organization wall and still answered 403 "Creating additional
// organizations is disabled on this deployment." Every org-less user's guided
// "create your workspace" path dead-ended there, which under cloud#1012's
// option B (self-serve signup deliberately provisions NO organization) is the
// platform's only answer to "what happens after sign-up". Same defect shape as
// cloud#1020, one site over.
//
// Two things are pinned here, and they are the same fact seen from both ends:
//
//   1. the GATE — a real better-auth `POST /organization/create`, status and
//      body, through `AuthManager.handleRequest`. Asserting the hook function
//      in isolation would re-create the blind spot: the 403 in the field came
//      out of the mounted route, so the route is what has to answer.
//   2. the `/auth/config` FLAG — `features.multiOrgEnabled`, which the console
//      renders the "Create organization" action from, and whose no-tenancy
//      fallback read the same demoted boolean. A flag that advertises a
//      capability the gate refuses (or hides one it allows) is the same class
//      of defect pointed the other way, so every scenario asserts BOTH and the
//      table at the bottom asserts they cannot disagree.
//
// The gate judges the REQUESTED posture, which is what the old boolean also
// meant and what `serve.ts`'s ADR-0093 D5 boot guard keys on — this corrects
// the KNOB and nothing else. Whether a requested wall is actually ENFORCED is
// the `tenancy` service's separate answer; the deployment where those two come
// apart (degraded) is pinned at the bottom as CURRENT behaviour, unchanged by
// this fix, with the follow-up that owns it.
//
// Real better-auth pipeline throughout (the #3585 EdDSA / #4785 session-of-record
// precedent: patch the real thing, never stub our own code).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { createTenancyService, type TenancyService, type TenancyPosture } from './tenancy-service';

/**
 * In-memory IDataEngine — same shape as the #4785 harness (`fields` really
 * projects, `update` matches on `id` the way the ObjectQL adapter calls it), so
 * the fake cannot be more forgiving than the real engine about what better-auth
 * asks for while minting `sys_organization` / `sys_member` rows.
 *
 * `delete` is pinned to ObjectQL's own dispatch predicate
 * ({@link assertEngineDeleteDispatch}) rather than a hand-written copy of it,
 * for the #4550 reason: a fake that accepts a call the real engine refuses is
 * how #4434 shipped a dead REST route with its suite green.
 */
const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
      }
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any) {
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-5233';
const ORIGIN = 'http://localhost:3000';

const makeManager = (engine: any, config: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { organization: true },
    ...config,
  } as any);

const signUp = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${ORIGIN}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Workspace Founder' }),
    }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** The guided "Create your workspace" call, exactly as the console makes it. */
const createOrganization = (manager: AuthManager, cookie: string, slug: string) =>
  manager.handleRequest(
    new Request(`${ORIGIN}/api/v1/auth/organization/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Acme ${slug}`, slug }),
    }),
  );

/** A tenancy service whose requested posture IS the posture in force. */
const enforcedTenancy = (requested: TenancyPosture): TenancyService =>
  createTenancyService({ requested, probeIsolation: () => true });

/**
 * ADR-0093 D5 degradation: a wall was REQUESTED and the enterprise
 * `@objectstack/organizations` runtime is absent, so `posture` resolves to
 * `single` and `degraded` is true.
 */
const degradedTenancy = (): TenancyService =>
  createTenancyService({ requested: 'isolated', probeIsolation: () => false });

interface Scenario {
  /** `OS_TENANCY_POSTURE`, or `undefined` to leave it unset. */
  posture?: string;
  /** `OS_MULTI_ORG_ENABLED`, or `undefined` to leave it unset. */
  legacy?: string;
  /** A wired `tenancy` service, or `undefined` for a lean embedding. */
  tenancy?: TenancyService;
}

/**
 * Boot a manager under a scenario and run the whole guided path: sign up, then
 * ask for a workspace. Returns the real HTTP answer plus the `/auth/config`
 * flag the console would have rendered its button from.
 */
const runGuidedWorkspaceCreation = async (scenario: Scenario, slug = 'acme') => {
  if (scenario.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = scenario.posture;
  if (scenario.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = scenario.legacy;

  const engine = createMemoryEngine();
  const manager = makeManager(
    engine,
    scenario.tenancy ? { getTenancy: () => scenario.tenancy } : {},
  );
  const cookie = cookieFrom(await signUp(manager, `founder-${slug}@example.com`));
  expect(cookie).not.toBe('');

  const response = await createOrganization(manager, cookie, slug);
  const body = await response.json().catch(() => null);
  const features = (manager.getPublicConfig() as any).features;
  return {
    engine,
    manager,
    status: response.status,
    body,
    multiOrgEnabled: features.multiOrgEnabled as boolean,
    tenancyPosture: features.tenancyPosture as TenancyPosture,
    orgRows: (engine.tables.get('sys_organization') ?? []) as any[],
  };
};

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5233 — the org-create gate reads OS_TENANCY_POSTURE, not the demoted boolean', () => {
  it('posture-only deployment (OS_TENANCY_POSTURE=isolated, legacy boolean UNSET) creates the workspace', async () => {
    // THE regression. Configured exactly as the docs say, and exactly as
    // cloud#1012's real `objectstack serve` probe was: the authoritative knob
    // and nothing else. Before the fix this was 403 FORBIDDEN.
    const run = await runGuidedWorkspaceCreation({ posture: 'isolated' }, 'posture-only');

    expect(run.status).toBe(200);
    expect(run.orgRows).toHaveLength(1);
    expect(run.orgRows[0].slug).toBe('posture-only');
    // …and the console was right to offer the button.
    expect(run.multiOrgEnabled).toBe(true);
    expect(run.tenancyPosture).toBe('isolated');
  });

  it('`group` is a multi-org posture too — it creates, it is not just `isolated`', async () => {
    // The gate asks `postureEnforcesWall`, the spec's own vocabulary, rather
    // than comparing against `'isolated'`: `group` walls organizations just as
    // much (ADR-0105 D1), it only widens READ scope across the membership set.
    const run = await runGuidedWorkspaceCreation({ posture: 'group' }, 'group-posture');

    expect(run.status).toBe(200);
    expect(run.orgRows).toHaveLength(1);
    expect(run.multiOrgEnabled).toBe(true);
    expect(run.tenancyPosture).toBe('group');
  });

  it('legacy-boolean-only deployment keeps working — back-compat via the posture resolver', async () => {
    // No behaviour change for anything already deployed: `resolveTenancyPosture()`
    // falls back to `OS_MULTI_ORG_ENABLED` when the posture knob is unset, so the
    // pre-ADR-0105 configuration resolves to `isolated` and still creates.
    const run = await runGuidedWorkspaceCreation({ legacy: 'true' }, 'legacy-only');

    expect(run.status).toBe(200);
    expect(run.orgRows).toHaveLength(1);
    expect(run.multiOrgEnabled).toBe(true);
    expect(run.tenancyPosture).toBe('isolated');
  });

  it('single-org deployment is still refused, with the same message', async () => {
    // The gate's INTENT is unchanged — only the knob it reads. A deployment
    // with no organization wall must not mint an organization: the boundary
    // would be declared and unenforced (ADR-0049 at the deployment layer).
    const run = await runGuidedWorkspaceCreation({ posture: 'single' }, 'single-posture');

    expect(run.status).toBe(403);
    expect(JSON.stringify(run.body)).toContain(
      'Creating additional organizations is disabled on this deployment.',
    );
    expect(run.orgRows).toHaveLength(0);
    expect(run.multiOrgEnabled).toBe(false);
    expect(run.tenancyPosture).toBe('single');
  });

  it('neither knob set (the default) is refused — the default is single-org', async () => {
    const run = await runGuidedWorkspaceCreation({}, 'unset');

    expect(run.status).toBe(403);
    expect(run.orgRows).toHaveLength(0);
    expect(run.multiOrgEnabled).toBe(false);
  });

  it('an explicit legacy `false` does not veto the authoritative posture', async () => {
    // The precise inversion the demotion created: the canonical knob asks for a
    // wall, the superseded one says "no multi-org". The canonical knob wins —
    // otherwise the legacy flag would still be authoritative in disguise.
    const run = await runGuidedWorkspaceCreation(
      { posture: 'isolated', legacy: 'false' },
      'posture-beats-legacy',
    );

    expect(run.status).toBe(200);
    expect(run.multiOrgEnabled).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5233 — with a `tenancy` service wired, as a real kernel boot has', () => {
  it('a wired, enforced tenancy service creates the workspace', async () => {
    const run = await runGuidedWorkspaceCreation(
      { posture: 'isolated', tenancy: enforcedTenancy('isolated') },
      'wired-isolated',
    );

    expect(run.status).toBe(200);
    expect(run.multiOrgEnabled).toBe(true);
  });

  it('DEGRADED: the gate still allows while the flag hides — pinned as CURRENT behaviour (#5261)', async () => {
    // ADR-0093 D5: a wall was REQUESTED and cannot be enforced (no enterprise
    // `@objectstack/organizations`), so the tenancy service reports an
    // effective posture of `single` + `degraded`. The gate judges the REQUEST,
    // so it allows; the flag reports ACTUAL capability, so it hides.
    //
    // That divergence PREDATES this fix — `resolveMultiOrgEnabled()` was an env
    // read too, and answered `true` here just the same — so #5233 does not
    // silently change it: tightening the gate to the effective posture would
    // take org creation away from every deployment running without the
    // enterprise package, which is a capability decision for the maintainer,
    // not a knob correction. Filed as #5261. This assertion exists so that
    // whichever way it is settled, it is settled DELIBERATELY.
    const run = await runGuidedWorkspaceCreation(
      { posture: 'isolated', tenancy: degradedTenancy() },
      'degraded',
    );

    expect(run.status).toBe(200);
    expect(run.multiOrgEnabled).toBe(false);
    expect(run.tenancyPosture).toBe('single');
  });

  it('the verdict is taken LIVE per request, never frozen at plugin-build time', async () => {
    // The org plugin is constructed once, at the first `getAuthInstance()`. If
    // the gate captured the posture there instead of calling per request, a
    // provider registering later in the same boot could never widen it — the
    // recorded-verdict defect AGENTS.md's startup-registry rule names.
    delete process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_MULTI_ORG_ENABLED;

    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const cookie = cookieFrom(await signUp(manager, 'live@example.com'));

    const refused = await createOrganization(manager, cookie, 'before');
    expect(refused.status).toBe(403);
    expect((manager.getPublicConfig() as any).features.multiOrgEnabled).toBe(false);

    // Same manager, same already-built better-auth instance.
    process.env.OS_TENANCY_POSTURE = 'isolated';

    const allowed = await createOrganization(manager, cookie, 'after');
    expect(allowed.status).toBe(200);
    expect((manager.getPublicConfig() as any).features.multiOrgEnabled).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5233 — /auth/config and the gate agree on every deployment shape', () => {
  // For every configuration where the requested wall is the wall in force,
  // `features.multiOrgEnabled` must predict the HTTP answer exactly. A future
  // change that fixes one site and forgets the other fails here, which is the
  // only reason #5233 was ever hard to see — the flag said yes, the route said
  // no, and nothing compared them. (The one shape where the two legitimately
  // report different facts — degraded — is asserted above, not here.)
  const scenarios: Array<{ name: string; scenario: Scenario; allowed: boolean }> = [
    { name: 'posture=isolated (legacy unset)', scenario: { posture: 'isolated' }, allowed: true },
    { name: 'posture=group (legacy unset)', scenario: { posture: 'group' }, allowed: true },
    { name: 'posture=single (legacy unset)', scenario: { posture: 'single' }, allowed: false },
    { name: 'legacy=true (posture unset)', scenario: { legacy: 'true' }, allowed: true },
    { name: 'legacy=false (posture unset)', scenario: { legacy: 'false' }, allowed: false },
    { name: 'nothing set', scenario: {}, allowed: false },
    {
      name: 'posture=isolated + legacy=true (the workaround config)',
      scenario: { posture: 'isolated', legacy: 'true' },
      allowed: true,
    },
    {
      name: 'tenancy service: isolated + enforced',
      scenario: { posture: 'isolated', tenancy: enforcedTenancy('isolated') },
      allowed: true,
    },
    {
      name: 'tenancy service: group + enforced',
      scenario: { posture: 'group', tenancy: enforcedTenancy('group') },
      allowed: true,
    },
    {
      name: 'tenancy service: single',
      scenario: { posture: 'single', tenancy: enforcedTenancy('single') },
      allowed: false,
    },
  ];

  it.each(scenarios)('$name', async ({ name, scenario, allowed }) => {
    const run = await runGuidedWorkspaceCreation(
      scenario,
      `agree-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    );

    expect(run.status).toBe(allowed ? 200 : 403);
    expect(run.multiOrgEnabled).toBe(allowed);
    // The flag PREDICTS the route: this is the invariant, not the two numbers.
    expect(run.multiOrgEnabled).toBe(run.status === 200);
  });
});
