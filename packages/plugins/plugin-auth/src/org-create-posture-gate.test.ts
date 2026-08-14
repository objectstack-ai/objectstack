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
// #5261 — and the posture the gate judges is the EFFECTIVE one.
//
// #5233 corrected the KNOB and left the gate judging the operator's REQUEST,
// which is what the demoted boolean also meant. That left exactly one shape
// where the gate and the flag answered from different facts: ADR-0093 D5
// degradation — a wall was requested, the enterprise `@objectstack/organizations`
// runtime is absent, so the `tenancy` service resolves an effective posture of
// `single` + `degraded`. The console hid the "Create organization" action while
// the route happily minted organizations whose boundary NO engine enforces:
// declared-but-unenforced, ADR-0049's canonical failure, at the deployment layer.
//
// The maintainer settled it (2026-08-04) as option B: the gate reads the
// EFFECTIVE posture, the same derivation `/auth/config` reads, so the two sites
// are one fact and cannot diverge on ANY deployment shape. The assertions this
// file used to carry as "pinned as CURRENT behaviour (#5261)" are flipped here
// deliberately, which is precisely what pinning them was for.
//
// This is a BREAKING capability contraction, shipped with v17: a deployment
// running without the enterprise runtime can no longer create organizations at
// all, whatever its env says. `serve.ts` already refuses to boot that shape
// without `OS_ALLOW_DEGRADED_TENANCY=1`; the org-create route now refuses too
// rather than half-working.
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
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
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
 * `single` and `degraded` is true. Both walled postures degrade — the wall's
 * code is open, ACTIVATING a multi-organization posture is the entitlement.
 */
const degradedTenancy = (requested: TenancyPosture = 'isolated'): TenancyService =>
  createTenancyService({ requested, probeIsolation: () => false });

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
    degradedTenancy: features.degradedTenancy as boolean,
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
describe('#5233 — no tenancy service wired: the gate reads OS_TENANCY_POSTURE, not the demoted boolean', () => {
  // A lean embedding that never registered the `tenancy` service. There is
  // nothing that knows whether a wall is standing, so both the gate and
  // `/auth/config` fall back to the operator's env-resolved REQUEST — the path
  // #5261 leaves exactly as #5233 shipped it, and these cases are its proof.
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

  it('DEGRADED (isolated requested, no enterprise runtime): the gate REFUSES — #5261', async () => {
    // THE #5261 regression, and the whole point of this change.
    //
    // ADR-0093 D5: a wall was REQUESTED and cannot be enforced (no enterprise
    // `@objectstack/organizations`), so the tenancy service reports an effective
    // posture of `single` + `degraded`. Before #5261 the gate judged the REQUEST
    // and answered 200 here, while `/auth/config` reported ACTUAL capability and
    // hid the button — so the console showed no way to create an organization
    // and the API minted them anyway, each one a tenant boundary that nothing
    // isolates. Now both read the effective posture: no wall, no organization.
    const run = await runGuidedWorkspaceCreation(
      { posture: 'isolated', tenancy: degradedTenancy() },
      'degraded',
    );

    expect(run.status).toBe(403);
    expect(JSON.stringify(run.body)).toContain(
      'Creating additional organizations is disabled on this deployment.',
    );
    // Nothing was minted — the assertion that separates "refused" from
    // "returned an error after committing the row" (#3624's failure shape).
    expect(run.orgRows).toHaveLength(0);
    expect(run.multiOrgEnabled).toBe(false);
    expect(run.tenancyPosture).toBe('single');
    // …and the deployment is branded degraded, so an operator reading
    // /auth/config can tell "no wall was asked for" from "the wall fell down".
    expect(run.degradedTenancy).toBe(true);
  });

  it('DEGRADED (group requested) refuses too — the entitlement gates BOTH walled postures', async () => {
    // `group` walls organizations as much as `isolated` does (ADR-0105 D1); the
    // wall's code is open but ACTIVATING a multi-organization posture is the
    // entitlement, so a `group` request without the enterprise runtime degrades
    // to `single` exactly like `isolated`. Asserted separately because reading
    // the gate as an `isolated`-only concern is how `group` briefly became a
    // free multi-org back door around it.
    const run = await runGuidedWorkspaceCreation(
      { posture: 'group', tenancy: degradedTenancy('group') },
      'degraded-group',
    );

    expect(run.status).toBe(403);
    expect(run.orgRows).toHaveLength(0);
    expect(run.multiOrgEnabled).toBe(false);
    expect(run.tenancyPosture).toBe('single');
    expect(run.degradedTenancy).toBe(true);
  });

  it('the env knobs cannot talk the gate past a degraded tenancy service', async () => {
    // The escape hatch #5261 deliberately closes. `resolveTenancyPosture()` is
    // still the fallback for a lean embedding with no tenancy service, so the
    // temptation is to let a loud enough env config win. It must not: the
    // service is the only thing that knows whether the wall is STANDING, and a
    // deployment that could out-shout it would be back to minting unenforced
    // boundaries. Both knobs are set as loudly as possible here.
    const run = await runGuidedWorkspaceCreation(
      { posture: 'isolated', legacy: 'true', tenancy: degradedTenancy() },
      'degraded-loud-env',
    );

    expect(run.status).toBe(403);
    expect(run.orgRows).toHaveLength(0);
    expect(run.multiOrgEnabled).toBe(false);
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

  it('sees the enterprise runtime that registers AFTER plugin-auth — the probe is live too', async () => {
    // [#5261] Same recorded-verdict hazard, one layer down. The `tenancy`
    // service's `probeIsolation` is lazy BECAUSE `org-scoping` registers after
    // plugin-auth: the wall genuinely comes up mid-boot. Now that the gate reads
    // the service's effective posture, caching either the service handle's
    // answer or our own derivation would freeze the deployment in its
    // pre-org-scoping state and refuse org creation forever on a fully walled
    // deployment — #5233's 403, resurrected by a different mistake.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    delete process.env.OS_MULTI_ORG_ENABLED;

    let orgScopingRegistered = false;
    const tenancy = createTenancyService({
      requested: 'isolated',
      probeIsolation: () => orgScopingRegistered,
    });

    const engine = createMemoryEngine();
    const manager = makeManager(engine, { getTenancy: () => tenancy });
    const cookie = cookieFrom(await signUp(manager, 'late-wall@example.com'));

    const refused = await createOrganization(manager, cookie, 'before-wall');
    expect(refused.status).toBe(403);
    expect((manager.getPublicConfig() as any).features.multiOrgEnabled).toBe(false);

    // The enterprise runtime registers its `org-scoping` service.
    orgScopingRegistered = true;

    const allowed = await createOrganization(manager, cookie, 'after-wall');
    expect(allowed.status).toBe(200);
    expect((manager.getPublicConfig() as any).features.multiOrgEnabled).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5233 / #5261 — /auth/config and the gate agree on EVERY deployment shape', () => {
  // `features.multiOrgEnabled` must predict the HTTP answer exactly. A future
  // change that fixes one site and forgets the other fails here, which is the
  // only reason #5233 was ever hard to see — the flag said yes, the route said
  // no, and nothing compared them.
  //
  // [#5261] The table now covers EVERY shape, with no exceptions carved out.
  // It used to exclude the degraded rows, because there the two sites reported
  // different facts by design; making the gate read the effective posture is
  // what let the exception go, and the exception's absence is itself the proof.
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
    // [#5261] The rows the table could not previously hold.
    {
      name: 'tenancy service: isolated requested + DEGRADED (no enterprise runtime)',
      scenario: { posture: 'isolated', tenancy: degradedTenancy('isolated') },
      allowed: false,
    },
    {
      name: 'tenancy service: group requested + DEGRADED (no enterprise runtime)',
      scenario: { posture: 'group', tenancy: degradedTenancy('group') },
      allowed: false,
    },
    {
      name: 'tenancy service: DEGRADED with both env knobs shouting yes',
      scenario: { posture: 'isolated', legacy: 'true', tenancy: degradedTenancy('isolated') },
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
