// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15350] The datasource-admin family's API-KEY admission matrix, under a live
 * tenancy posture.
 *
 * ## What was open
 *
 * `admin-routes.ts` called `resolveAuthzContext({ ql, headers, getSession })`
 * with no `tenancyPosture`. Both posture-conditional API-key refusals are gated
 * on the CALLER supplying one — `organization_required`
 * (`core/security/api-key.ts`) and `organization_membership_ended`
 * (`core/security/resolve-authz-context.ts`) — so on this door neither ran, and
 * an API key stamped with an organization its owner had LEFT authenticated.
 * The key's `tenantId` is `sys_api_key.active_organization_id` copied verbatim:
 * the caller's own stored claim, never vetted against current membership.
 *
 * ⚠️ Severity, as the card states it and as this file measures it: this family
 * gates on `authz.systemPermissions`, not on org-scoped rows, so the measured
 * consequence is an **admitted principal** — an ex-member whose platform grants
 * outlive their membership creates, patches and deletes this deployment's
 * datasources — not a cross-organization row read. Every write arm below reads
 * the DATASOURCE STORE back rather than the response body, because "was it
 * refused" and "did it land" are different facts and only the store answers the
 * second.
 *
 * ## Why the fixture is shaped this way
 *
 *  1. **Controls in BOTH directions, before any subject arm.** A door that
 *     authenticates nobody would "pass" a refusal-only suite perfectly while
 *     taking Setup → Datasources offline. So a CURRENT member with the
 *     capability must reach the routes and land a write, an anonymous caller
 *     must be refused, and an authenticated caller without the capability must
 *     get the capability refusal — all on the same wiring.
 *  2. **The RBAC grant is SYMMETRIC across all three key principals.** One
 *     shared permission set carries `manage_platform_settings` for the member,
 *     the ex-member and the organization-less caller alike. If they held
 *     different capabilities, RBAC could be what separates the arms; with one
 *     shared grant, only the tenancy posture can be.
 *  3. **A REAL `ObjectKernel` carries the wiring fact.** The classification
 *     under measurement is the REGISTRY's — the branded "never registered"
 *     rejection versus the unbranded "registered and failed to construct" one
 *     (#13905 / #13906 decision 1 option A) — and a double imitating both would
 *     be asserting about itself.
 *  4. **The ablation is held PERMANENTLY** (§4). Its handle is the wiring this
 *     package shipped before this card: a `PluginContext` with no `getKernel`
 *     at all, which is byte-identically what the other suites in this package
 *     still mount. Remove the fix's input and the ex-member is admitted again,
 *     writes and all. A pin that cannot go red has measured nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes, DATASOURCE_ADMIN_CAPABILITY } from '../admin-routes.js';

const RAW_MEMBER_KEY = 'osk_15350_member';
const RAW_EXMEMBER_KEY = 'osk_15350_exmember';
const RAW_ORGLESS_KEY = 'osk_15350_orgless';
const RAW_UNENTITLED_KEY = 'osk_15350_unentitled';

const ORG_ALPHA = 'org_alpha';
const ORG_BETA = 'org_beta';

/** The permission set every KEY principal shares — see fixture note 2. */
const SHARED_SET = 'ps_15350_shared';

// ---------------------------------------------------------------------------
// The permission store, in the shipped aggregation shapes
// ---------------------------------------------------------------------------

/**
 * The fixture's ONE hand-written where-matcher: equality plus `$in` — the two
 * shapes the shared resolver actually issues — refusing every other shape
 * loudly, so a combinator it does not implement can never read as a field that
 * happened not to match.
 */
function matchesWhere(row: any, where: any): boolean {
  for (const [field, cond] of Object.entries(where ?? {})) {
    if (field.startsWith('$')) {
      throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    }
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!(cond as any).$in.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

/**
 * `u_exmember`'s key is stamped `org_alpha` while its only current `sys_member`
 * row is for `org_beta` — the credential outlived the membership that backed
 * it, which is the whole scenario. `u_member` is still in `org_alpha`.
 */
function makeQl() {
  const tables: Record<string, any[]> = {
    sys_api_key: [
      { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: ORG_ALPHA, revoked: false },
      { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: ORG_ALPHA, revoked: false },
      { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
      { id: 'key_unentitled', key: hashApiKey(RAW_UNENTITLED_KEY), user_id: 'u_plain', active_organization_id: ORG_ALPHA, revoked: false },
    ],
    sys_member: [
      { user_id: 'u_member', organization_id: ORG_ALPHA },
      { user_id: 'u_exmember', organization_id: ORG_BETA },
      { user_id: 'u_plain', organization_id: ORG_ALPHA },
    ],
    sys_user: [
      { id: 'u_member', email: 'u_member@example.com' },
      { id: 'u_exmember', email: 'u_exmember@example.com' },
      { id: 'u_orgless', email: 'u_orgless@example.com' },
      { id: 'u_plain', email: 'u_plain@example.com' },
    ],
    // The grant, SYMMETRIC across the three subject principals (note 2).
    // `u_plain` is deliberately absent: it is the capability control, the one
    // caller separated by RBAC rather than by posture.
    sys_user_permission_set: [
      { user_id: 'u_member', permission_set_id: SHARED_SET, organization_id: null },
      { user_id: 'u_exmember', permission_set_id: SHARED_SET, organization_id: null },
      { user_id: 'u_orgless', permission_set_id: SHARED_SET, organization_id: null },
    ],
    sys_permission_set: [
      {
        id: SHARED_SET,
        name: 'datasource_operator',
        // Stored as a JSON string — the spelling SQLite hands back, which the
        // resolver parses. Pinning the stored shape keeps the fixture on the
        // real read path rather than a convenient in-memory one.
        system_permissions: JSON.stringify([DATASOURCE_ADMIN_CAPABILITY]),
        object_permissions: '{}',
      },
    ],
  };
  return {
    find: async (object: string, q: any = {}) => {
      const rows = (tables[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  };
}

// ---------------------------------------------------------------------------
// The datasource store — the fixture's table, read directly by write arms
// ---------------------------------------------------------------------------

interface DatasourceRow {
  name: string;
  driver: string;
  origin: string;
}

const SEED: DatasourceRow[] = [{ name: 'pg', driver: 'sqlite', origin: 'runtime' }];

/**
 * The `datasource-admin` service double, over a real array. `createDatasource`
 * and `removeDatasource` MUTATE it, so "was the write refused" is answered by
 * counting rows rather than by reading a status the door could have faked.
 */
function createServiceDouble(rows: DatasourceRow[]) {
  return {
    listDatasources: vi.fn(async () => rows.map((r) => ({ ...r }))),
    getDatasource: vi.fn(async (name: string) => rows.find((r) => r.name === name) ?? { name }),
    createDatasource: vi.fn(async (draft: any) => {
      const row: DatasourceRow = { name: String(draft?.name ?? ''), driver: String(draft?.driver ?? 'sqlite'), origin: 'runtime' };
      rows.push(row);
      return row;
    }),
    updateDatasource: vi.fn(async (name: string, patch: any) => {
      const row = rows.find((r) => r.name === name);
      if (row) row.driver = String(patch?.driver ?? row.driver);
      return row ?? { name };
    }),
    removeDatasource: vi.fn(async (name: string) => {
      const i = rows.findIndex((r) => r.name === name);
      if (i >= 0) rows.splice(i, 1);
    }),
    migrateCredential: vi.fn(async () => ({ status: 'migrated' })),
    listRemoteTables: vi.fn(async () => [{ name: 'customers' }]),
    generateObjectDraft: vi.fn(async () => ({ name: 'customer' })),
    testConnection: vi.fn(async () => ({ ok: true })),
  };
}

// ---------------------------------------------------------------------------
// The wiring under test
// ---------------------------------------------------------------------------

/**
 * The four wirings this file distinguishes. Three of them are the #13906
 * decision-1-option-A classification; the fourth is the ABLATION.
 */
type Wiring =
  /** A `tenancy` service registered on the kernel, answering this posture. */
  | { kind: 'posture'; posture: 'single' | 'group' | 'isolated' }
  /** Kernel present, NOTHING registered ⇒ branded ⇒ quiet `undefined`. */
  | { kind: 'unregistered' }
  /** Registered and unable to build ⇒ unbranded ⇒ the LOUD answer. */
  | { kind: 'factory-throws' }
  /**
   * ⭐ THE ABLATION. A `PluginContext` with no `getKernel` at all — the wiring
   * this package shipped before this card, and what the other suites here still
   * mount. Removes exactly the one input the fix added.
   */
  | { kind: 'no-kernel' };

function kernelFor(wiring: Wiring): ObjectKernel | undefined {
  if (wiring.kind === 'no-kernel') return undefined;
  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  if (wiring.kind === 'posture') {
    kernel.registerService('tenancy', { posture: wiring.posture });
  } else if (wiring.kind === 'factory-throws') {
    kernel.registerServiceFactory('tenancy', () => {
      throw new Error('tenancy backend unavailable');
    });
  }
  // 'unregistered' → nothing registered: the branded rejection, off the REAL
  // registry rather than a double imitating a brand.
  return kernel;
}

interface Harness {
  app: { fetch: (req: Request) => Promise<Response> };
  /** Every datasource row the fixture holds, in insertion order. */
  store: () => DatasourceRow[];
  service: ReturnType<typeof createServiceDouble>;
  warnings: () => string[];
}

function mount(wiring: Wiring): Harness {
  const rows: DatasourceRow[] = SEED.map((r) => ({ ...r }));
  const service = createServiceDouble(rows);
  const ql = makeQl();
  const kernel = kernelFor(wiring);

  const base = {
    getService: vi.fn((name: string) => {
      // No session path at all: this matrix is about API keys, and a session
      // that silently authenticated would make every arm unreadable.
      if (name === 'auth') return { api: { getSession: async () => undefined } };
      if (name === 'objectql' || name === 'data') return ql;
      return service;
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const ctx = (kernel ? { ...base, getKernel: () => kernel } : base) as unknown as PluginContext;

  const server = new HonoHttpServer(0);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return {
    app: server.getRawApp(),
    store: () => rows.map((r) => ({ ...r })),
    service,
    warnings: () => warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
  };
}

async function call(
  h: Harness,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  raw?: string,
  body?: Record<string, unknown>,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (raw) headers['x-api-key'] = raw;
  const res = await h.app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

const listOf = (h: Harness, raw?: string) => call(h, 'GET', '/api/v1/datasources', raw);
const createOf = (h: Harness, raw: string | undefined, name: string) =>
  call(h, 'POST', '/api/v1/datasources', raw, { name, driver: 'sqlite' });
const removeOf = (h: Harness, raw?: string) => call(h, 'DELETE', '/api/v1/datasources/pg', raw);

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

const ISOLATED: Wiring = { kind: 'posture', posture: 'isolated' };

// ---------------------------------------------------------------------------
// §1 — Instrument controls. Both directions, before any subject arm is read.
// ---------------------------------------------------------------------------

describe('[#15350] §1 — the door can serve, and the door can refuse', () => {
  it('CONTROL · the family REACHES: a CURRENT member\'s key lists the datasources', async () => {
    const h = mount(ISOLATED);
    const res = await listOf(h, RAW_MEMBER_KEY);
    expect(res.status).toBe(200);
    expect(res.body?.data?.datasources?.map((d: DatasourceRow) => d.name)).toEqual(['pg']);
  });

  it('CONTROL · writes REACH: a CURRENT member\'s POST lands, read back FROM THE STORE', async () => {
    const h = mount(ISOLATED);
    const res = await createOf(h, RAW_MEMBER_KEY, 'ds_member');
    expect(res.status).toBe(201);
    expect(h.store().filter((r) => r.name === 'ds_member')).toHaveLength(1);
  });

  it('CONTROL · deletes REACH: a CURRENT member\'s DELETE removes the row FROM THE STORE', async () => {
    const h = mount(ISOLATED);
    const res = await removeOf(h, RAW_MEMBER_KEY);
    expect(res.status).toBe(204);
    expect(h.store().filter((r) => r.name === 'pg')).toHaveLength(0);
  });

  it('CONTROL · the door refuses: no credential is 401 and nothing lands', async () => {
    const h = mount(ISOLATED);
    const get = await listOf(h);
    expect(get.status).toBe(401);
    expect(get.body?.error?.code).toBe('UNAUTHENTICATED');
    const post = await createOf(h, undefined, 'ds_anon');
    expect(post.status).toBe(401);
    expect(h.store()).toHaveLength(SEED.length);
  });

  it('CONTROL · the CAPABILITY gate is the other refusal: an entitled-less key is 403, not 401', async () => {
    // A current member of `org_alpha` holding NO permission set. It separates
    // "refused for the posture" from "refused for the grant" — without it, an
    // arm below could pass on the wrong reason.
    const h = mount(ISOLATED);
    const res = await listOf(h, RAW_UNENTITLED_KEY);
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
  });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT. The ex-member's org-stamped key, under `isolated`.
// ---------------------------------------------------------------------------

describe('[#15350] §2 — an ex-member\'s org-stamped key on the datasource ADMIN routes under `isolated`', () => {
  it('REPAIRED: the list is 401 — was 200, an admitted principal', async () => {
    const h = mount(ISOLATED);
    const res = await listOf(h, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHENTICATED');
    // ⛔ And the wire says nothing else. A holder of someone else's key must
    // learn nothing the generic 401 does not already say.
    expect(JSON.stringify(res.body)).not.toMatch(
      /membership|organization_membership_ended|org_alpha|key_exmember/i,
    );
  });

  it('REPAIRED: the CREATE is 401 and NOTHING LANDS — read back from the store', async () => {
    const h = mount(ISOLATED);
    const res = await createOf(h, RAW_EXMEMBER_KEY, 'ds_exmember');
    expect(res.status).toBe(401);
    expect(h.store().filter((r) => r.name === 'ds_exmember')).toHaveLength(0);
    expect(h.store()).toHaveLength(SEED.length);
    // Refused BEFORE dispatch: a write refused after the service ran has
    // already changed the deployment.
    expect(h.service.createDatasource).not.toHaveBeenCalled();
  });

  it('REPAIRED: the DELETE is 401 and the row SURVIVES in the store', async () => {
    const h = mount(ISOLATED);
    const res = await removeOf(h, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(401);
    expect(h.store().filter((r) => r.name === 'pg')).toHaveLength(1);
    expect(h.service.removeDatasource).not.toHaveBeenCalled();
  });

  it('the refusal is said OUT LOUD on the server side — one line, naming key / principal / organization / reason', async () => {
    const h = mount(ISOLATED);
    await listOf(h, RAW_EXMEMBER_KEY);
    const lines = h.warnings().filter((l) => l.includes('API key refused'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('organization_membership_ended');
    expect(lines[0]).toContain('key=key_exmember');
    expect(lines[0]).toContain('principal=u_exmember');
    expect(lines[0]).toContain(`organization=${ORG_ALPHA}`);
    // ⛔ NEVER the credential — neither the raw key nor its at-rest hash.
    expect(lines[0]).not.toContain(RAW_EXMEMBER_KEY);
    expect(lines[0]).not.toContain(hashApiKey(RAW_EXMEMBER_KEY));
  });
});

// ---------------------------------------------------------------------------
// §3 — The organization-less key: the same matrix's other row.
// ---------------------------------------------------------------------------

describe('[#15350] §3 — an organization-less key under `isolated`', () => {
  it('REPAIRED: the list is 401 — `organization_required` now runs at this door', async () => {
    const h = mount(ISOLATED);
    const res = await listOf(h, RAW_ORGLESS_KEY);
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHENTICATED');
  });

  it('REPAIRED: the CREATE is 401 and nothing lands', async () => {
    const h = mount(ISOLATED);
    const res = await createOf(h, RAW_ORGLESS_KEY, 'ds_orgless');
    expect(res.status).toBe(401);
    expect(h.store().filter((r) => r.name === 'ds_orgless')).toHaveLength(0);
  });

  it('its refusal is its own line, with its own reason', async () => {
    const h = mount(ISOLATED);
    await listOf(h, RAW_ORGLESS_KEY);
    const lines = h.warnings().filter((l) => l.includes('API key refused'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('organization_required');
    expect(lines[0]).toContain('key=key_orgless');
    expect(lines[0]).toContain('organization=<none>');
    expect(lines[0]).not.toContain(RAW_ORGLESS_KEY);
  });

  it('a REFUSAL is not a key scanner\'s log: an unknown key is silent', async () => {
    const h = mount(ISOLATED);
    const res = await listOf(h, 'osk_not_a_real_key');
    expect(res.status).toBe(401);
    expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — THE ABLATION, held permanently.
//
// One variable changes: whether the host exposes the kernel this seam reads the
// `tenancy` service off. The engine, the keys, the routes, the grants and the
// store are byte-identical to §2 and §3.
// ---------------------------------------------------------------------------

describe('[#15350] §4 — ablation: with no kernel to read the posture from, the admission returns', () => {
  const ABLATED: Wiring = { kind: 'no-kernel' };

  it('the ex-member is ADMITTED again — the list answers 200', async () => {
    const h = mount(ABLATED);
    const res = await listOf(h, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(200);
    expect(res.body?.data?.datasources?.map((d: DatasourceRow) => d.name)).toEqual(['pg']);
  });

  it('the ex-member WRITES again — POST 201 and the row LANDS in the store', async () => {
    const h = mount(ABLATED);
    const res = await createOf(h, RAW_EXMEMBER_KEY, 'ds_exmember');
    expect(res.status).toBe(201);
    expect(h.store().filter((r) => r.name === 'ds_exmember')).toHaveLength(1);
  });

  it('the ex-member DELETES again — DELETE 204 and the row is GONE from the store', async () => {
    const h = mount(ABLATED);
    const res = await removeOf(h, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(204);
    expect(h.store().filter((r) => r.name === 'pg')).toHaveLength(0);
  });

  it('the organization-less key is admitted again too', async () => {
    const h = mount(ABLATED);
    const res = await listOf(h, RAW_ORGLESS_KEY);
    expect(res.status).toBe(200);
  });

  it('and NOTHING is said about any of it — no refusal line, because no refusal was decided', async () => {
    const h = mount(ABLATED);
    await listOf(h, RAW_EXMEMBER_KEY);
    await listOf(h, RAW_ORGLESS_KEY);
    expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
  });

  it('NARROWNESS: the member and capability controls are UNCHANGED by the ablation', async () => {
    const h = mount(ABLATED);
    expect((await listOf(h, RAW_MEMBER_KEY)).status).toBe(200);
    expect((await listOf(h)).status).toBe(401);
    expect((await listOf(h, RAW_UNENTITLED_KEY)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// §5 — #13906 decision 1 option A: the two halves of a failed resolution.
// ---------------------------------------------------------------------------

describe('[#15350] §5 — a `tenancy` service that was NEVER REGISTERED resolves quietly', () => {
  const UNREGISTERED: Wiring = { kind: 'unregistered' };

  it('the supported no-tenancy composition still serves: the member reads', async () => {
    const h = mount(UNREGISTERED);
    expect((await listOf(h, RAW_MEMBER_KEY)).status).toBe(200);
  });

  it('and it runs NO posture-conditional refusal — behaviour is exactly what it was', async () => {
    const h = mount(UNREGISTERED);
    expect((await listOf(h, RAW_EXMEMBER_KEY)).status).toBe(200);
    expect((await listOf(h, RAW_ORGLESS_KEY)).status).toBe(200);
    expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
  });
});

describe('[#15350] §5b — a `tenancy` service that was REGISTERED and FAILED is LOUD, never permissive', () => {
  const OUTAGE: Wiring = { kind: 'factory-throws' };

  it('⛔ the ex-member is NOT admitted on a failed posture read — the defect a quiet `catch` would restore', async () => {
    const h = mount(OUTAGE);
    const res = await listOf(h, RAW_EXMEMBER_KEY);
    // The whole point of #13906 option A: a FAILURE must not read as "this
    // check does not apply". Whatever the transport renders, it is not the
    // 200 the ablation in §4 produces.
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('⛔ nor is a WRITE let through — nothing lands, read back from the store', async () => {
    const h = mount(OUTAGE);
    const res = await createOf(h, RAW_EXMEMBER_KEY, 'ds_outage');
    expect(res.status).not.toBe(201);
    expect(h.store().filter((r) => r.name === 'ds_outage')).toHaveLength(0);
    expect(h.service.createDatasource).not.toHaveBeenCalled();
  });

  it('the outage is not answered as a capability denial either — 403 would be the #13279 defect', async () => {
    const h = mount(OUTAGE);
    const res = await listOf(h, RAW_MEMBER_KEY);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §6 — `group`. MEASURED, not assumed (the card forbids assuming it unaffected).
// ---------------------------------------------------------------------------

describe('[#15350] §6 — the `group` posture, measured on the READ and the WRITE path', () => {
  const GROUP: Wiring = { kind: 'posture', posture: 'group' };

  it('the ex-member IS refused under `group` too — `postureEnforcesWall(\'group\')` is true', async () => {
    // ⚠️ The card records the `group` WRITE path as never measured. It is
    // measured here: `organization_membership_ended` keys on
    // `postureEnforcesWall`, which `group` satisfies, so the ex-member's
    // stamped key is refused under `group` exactly as under `isolated`.
    const h = mount(GROUP);
    expect((await listOf(h, RAW_EXMEMBER_KEY)).status).toBe(401);
    const post = await createOf(h, RAW_EXMEMBER_KEY, 'ds_group_exmember');
    expect(post.status).toBe(401);
    expect(h.store().filter((r) => r.name === 'ds_group_exmember')).toHaveLength(0);
  });

  it('the organization-less key is ADMITTED under `group` — union scope, by design', async () => {
    // `organization_required` is scoped to `postureEnforcesWall &&
    // !postureUsesUnionScope`, and `group` uses union scope: such a key already
    // reads the union of its owner\'s organizations, so refusing it would break
    // working deployments for no security gain. Pinned so the asymmetry with
    // §3 is a recorded decision rather than an accident.
    const h = mount(GROUP);
    expect((await listOf(h, RAW_ORGLESS_KEY)).status).toBe(200);
    const post = await createOf(h, RAW_ORGLESS_KEY, 'ds_group_orgless');
    expect(post.status).toBe(201);
    expect(h.store().filter((r) => r.name === 'ds_group_orgless')).toHaveLength(1);
  });

  it('the member control is unchanged under `group`', async () => {
    const h = mount(GROUP);
    expect((await listOf(h, RAW_MEMBER_KEY)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §7 — `single`. The posture that enforces no wall admits everyone it did.
// ---------------------------------------------------------------------------

describe('[#15350] §7 — under `single` nothing changes', () => {
  const SINGLE: Wiring = { kind: 'posture', posture: 'single' };

  it('every entitled key is admitted, stamped or not', async () => {
    const h = mount(SINGLE);
    expect((await listOf(h, RAW_MEMBER_KEY)).status).toBe(200);
    expect((await listOf(h, RAW_EXMEMBER_KEY)).status).toBe(200);
    expect((await listOf(h, RAW_ORGLESS_KEY)).status).toBe(200);
    expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
  });

  it('and the two non-posture refusals still stand', async () => {
    const h = mount(SINGLE);
    expect((await listOf(h)).status).toBe(401);
    expect((await listOf(h, RAW_UNENTITLED_KEY)).status).toBe(403);
  });
});
