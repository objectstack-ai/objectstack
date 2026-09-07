// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15352] The parent-governed DOWNLOAD door's API-key admission matrix, under
 * a live tenancy posture.
 *
 * ## What was open
 *
 * `buildFileReadAuthorizer` (`storage-service-plugin.ts`) called
 * `resolveAuthzContext({ ql: engine, headers, getSession })` with no
 * `tenancyPosture`. Both posture-conditional API-key refusals are gated on the
 * CALLER supplying one — `organization_required`
 * (`core/security/api-key.ts`) and `organization_membership_ended`
 * (`core/security/resolve-authz-context.ts`) — so on this door neither ran.
 * Its headers are the real request's (`toWebHeaders`), so `x-api-key` is
 * accepted, and an API key's `tenantId` is `sys_api_key.active_organization_id`
 * copied verbatim: the caller's own stored claim, never vetted against current
 * membership. Under a wall-enforcing posture a key stamped with an organization
 * its owner had LEFT resolved a `userId` here and was then judged by the
 * ownership / record-reachability checks — evaluated for a principal the wall
 * should have refused at the door.
 *
 * ## What "nothing lands" means on a READ-ONLY door
 *
 * The sibling seams in this family (#15349 / #15350) read their WRITE back from
 * the store rather than from the response body, because "was it refused" and
 * "did it land" are different facts. This door performs no write: the thing it
 * hands out is a CAPABILITY — a signed download URL minted by the storage
 * adapter. So the equivalent second fact is read off the ADAPTER, not off the
 * response: every arm below asserts whether `getPresignedDownload` was called
 * at all. A door that answered 401 after minting a URL would pass a
 * status-only suite and still have issued the capability.
 *
 * ## Why the fixture is shaped this way
 *
 *  1. **Controls in BOTH directions, before any subject arm.** A door that
 *     authenticates nobody would "pass" a refusal-only suite perfectly while
 *     taking every attachment download offline. So a CURRENT member must reach
 *     the bytes, an anonymous caller must be refused, and — the third control —
 *     an authenticated caller whose PARENT RECORD is unreachable must get the
 *     reachability refusal (403), not the admission refusal (401). Without that
 *     third arm a subject arm could pass on the wrong reason.
 *  2. **Record reachability is SYMMETRIC across all three key principals.** The
 *     subject file hangs off one record every resolved principal can read. If
 *     they differed, RLS could be what separates the arms; with one shared
 *     reachable parent, only the tenancy posture can be.
 *  3. **A REAL `ObjectKernel` carries the wiring fact.** The classification
 *     under measurement is the REGISTRY's — the branded "never registered"
 *     rejection versus the unbranded "registered and failed to construct" one
 *     (#13906 decision 1 option A) — and a double imitating both would be
 *     asserting about itself.
 *  4. **The ablation is held PERMANENTLY** (§4). Its handle is the wiring this
 *     package shipped before this card: a `PluginContext` with no `getKernel`
 *     at all, which is byte-identically what every other suite here still
 *     mounts (`storage-service-plugin.test.ts`'s `makeCtx`). Remove the fix's
 *     one input and the ex-member downloads again, capability and all. A pin
 *     that cannot go red has measured nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin.js';

const RAW_MEMBER_KEY = 'osk_15352_member';
const RAW_EXMEMBER_KEY = 'osk_15352_exmember';
const RAW_ORGLESS_KEY = 'osk_15352_orgless';

const ORG_ALPHA = 'org_alpha';
const ORG_BETA = 'org_beta';

const BASE_PATH = '/api/v1/storage';

/** The subject file: field-owned, private, parked on a reachable parent. */
const FILE_OPEN = 'file_15352_open';
/** The reachability control's file: same shape, parent readable by nobody. */
const FILE_CLOSED = 'file_15352_closed';

// ---------------------------------------------------------------------------
// The data engine — the permission store in its shipped aggregation shapes,
// plus `sys_file` and the parent object the download gate reaches through.
// ---------------------------------------------------------------------------

/**
 * The fixture's ONE hand-written where-matcher: equality plus `$in` — the two
 * shapes the shared resolver actually issues — refusing every other shape
 * loudly, so a combinator it does not implement can never read as a field that
 * happened not to match.
 */
function matchesWhere(row: Record<string, unknown>, where: unknown): boolean {
  for (const [field, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (field.startsWith('$')) {
      throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    }
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      const inList = (cond as { $in?: unknown }).$in;
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray(inList)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!inList.includes(row[field])) return false;
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
 *
 * `owner_id` on both files is a FOURTH user nobody holds a key for: the
 * authorizer's "uploader may always download" shortcut must not be what any arm
 * below travels through.
 */
function makeEngine() {
  const sysFile = [
    {
      id: FILE_OPEN,
      key: 'files/open.pdf',
      name: 'open.pdf',
      mime_type: 'application/pdf',
      size: 12,
      scope: 'record',
      status: 'committed',
      acl: 'private',
      owner_id: 'u_uploader',
      ref_object: 'contract',
      ref_id: 'rec_open',
      ref_field: 'attachment',
    },
    {
      id: FILE_CLOSED,
      key: 'files/closed.pdf',
      name: 'closed.pdf',
      mime_type: 'application/pdf',
      size: 12,
      scope: 'record',
      status: 'committed',
      acl: 'private',
      owner_id: 'u_uploader',
      ref_object: 'contract',
      ref_id: 'rec_closed',
      ref_field: 'attachment',
    },
  ];

  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [
      { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: ORG_ALPHA, revoked: false },
      { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: ORG_ALPHA, revoked: false },
      { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
    ],
    sys_member: [
      { user_id: 'u_member', organization_id: ORG_ALPHA },
      { user_id: 'u_exmember', organization_id: ORG_BETA },
    ],
    sys_user: [
      { id: 'u_member', email: 'u_member@example.com' },
      { id: 'u_exmember', email: 'u_exmember@example.com' },
      { id: 'u_orgless', email: 'u_orgless@example.com' },
    ],
    sys_file: sysFile,
  };

  /**
   * The parent object the field-owned file hangs off, with row visibility as
   * an explicit allow-list — the fixture's stand-in for RLS. `rec_open` is
   * readable by every principal that resolves at all (note 2); `rec_closed` by
   * nobody, which is what the reachability CONTROL rides on.
   */
  const contractVisibility: Record<string, string[]> = {
    rec_open: ['u_member', 'u_exmember', 'u_orgless'],
    rec_closed: [],
  };

  return {
    find: async (object: string, q: Record<string, unknown> = {}) => {
      if (object === 'contract') {
        const where = (q.where ?? {}) as { id?: unknown };
        const context = (q.context ?? {}) as { userId?: string };
        const id = String(where.id ?? '');
        const readers = contractVisibility[id] ?? [];
        return context.userId && readers.includes(context.userId) ? [{ id }] : [];
      }
      const rows = (tables[object] ?? []).filter((row) => matchesWhere(row, q.where));
      return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    findOne: async (object: string, q: Record<string, unknown> = {}) => {
      const rows = (tables[object] ?? []).filter((row) => matchesWhere(row, q.where));
      return rows[0] ?? null;
    },
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
   * this package shipped before this card, and what every other suite here
   * still mounts. Removes exactly the one input the fix added.
   */
  | { kind: 'no-kernel' };

function kernelFor(wiring: Wiring): ObjectKernel | undefined {
  if (wiring.kind === 'no-kernel') return undefined;
  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
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

interface MockResponse {
  status: number;
  json: Record<string, unknown> | undefined;
  headers: Record<string, string>;
  sent: unknown;
}

interface Harness {
  call: (
    route: 'url' | 'redirect',
    fileId: string,
    rawKey?: string,
  ) => Promise<MockResponse>;
  /** Did the adapter MINT a capability? The read-back this door's "landing" is. */
  minted: () => number;
  warnings: () => string[];
}

function makeRes(): IHttpResponse & MockResponse {
  const res: Record<string, unknown> = {
    status: 200,
    json: undefined,
    headers: {},
    sent: undefined,
  };
  res.json = undefined;
  const api = {
    json(data: Record<string, unknown>) { (res as { json?: unknown }).json = data; return api; },
    send(data: unknown) { (res as { sent?: unknown }).sent = data; return api; },
    status(code: number) { (res as { status: number }).status = code; return api; },
    header(name: string, value: string) {
      ((res as { headers: Record<string, string> }).headers)[name] = value;
      return api;
    },
  };
  return Object.assign(res, api) as unknown as IHttpResponse & MockResponse;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let rootDirs: string[] = [];

async function mount(wiring: Wiring): Promise<Harness> {
  const rootDir = join(tmpdir(), `os-15352-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);

  const engine = makeEngine();
  const routes = new Map<string, RouteHandler>();
  const httpServer = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST:${path}`, handler); },
    put: (path: string, handler: RouteHandler) => { routes.set(`PUT:${path}`, handler); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };

  const services = new Map<string, unknown>();
  services.set('objectql', engine);
  services.set('http-server', httpServer);
  // No session path at all: this matrix is about API keys, and a session that
  // silently authenticated would make every arm unreadable.
  services.set('auth', { api: { getSession: async () => undefined } });

  const readyHooks: Array<() => Promise<void> | void> = [];
  const kernel = kernelFor(wiring);
  const base: Record<string, unknown> = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: (name: string) => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
  };
  const ctx = (kernel ? { ...base, getKernel: () => kernel } : base) as unknown as PluginContext;

  const plugin = new StorageServicePlugin({
    adapter: 'local',
    basePath: BASE_PATH,
    local: { rootDir, signingSecret: 'test-secret-15352' },
    bindToSettings: false,
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const hook of readyHooks) await hook();

  const storage = services.get('storage') as {
    getPresignedDownload: (key: string, ttl: number, opts?: unknown) => Promise<unknown>;
  };
  const mintSpy = vi.spyOn(storage, 'getPresignedDownload');

  return {
    call: async (route, fileId, rawKey) => {
      const path = route === 'url'
        ? `${BASE_PATH}/files/:fileId/url`
        : `${BASE_PATH}/files/:fileId`;
      const handler = routes.get(`GET:${path}`);
      if (!handler) throw new Error(`fixture: no handler registered for GET ${path}`);
      const req = {
        params: { fileId },
        query: {},
        body: undefined,
        headers: rawKey ? { 'x-api-key': rawKey } : {},
        method: 'GET',
        path,
      } as unknown as IHttpRequest;
      const res = makeRes();
      await handler(req, res);
      return {
        status: res.status,
        json: res.json,
        headers: res.headers,
        sent: res.sent,
      };
    },
    minted: () => mintSpy.mock.calls.length,
    warnings: () => warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
  };
}

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

const ISOLATED: Wiring = { kind: 'posture', posture: 'isolated' };

const refusalLines = (h: Harness) => h.warnings().filter((l) => l.includes('API key refused'));

// ---------------------------------------------------------------------------
// §1 — Instrument controls. Both directions, before any subject arm is read.
// ---------------------------------------------------------------------------

describe('[#15352] §1 — the download door can serve, and the download door can refuse', () => {
  it('CONTROL · the door SERVES: a CURRENT member\'s key gets a signed URL, and the adapter MINTED it', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_OPEN, RAW_MEMBER_KEY);
    expect(res.status).toBe(200);
    expect(String((res.json?.data as { url?: string } | undefined)?.url)).toContain('/_local/raw/');
    expect(h.minted()).toBe(1);
  });

  it('CONTROL · the redirect sibling SERVES too: 302 with a Location', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('redirect', FILE_OPEN, RAW_MEMBER_KEY);
    expect(res.status).toBe(302);
    expect(res.headers.Location).toContain('/_local/raw/');
    expect(h.minted()).toBe(1);
  });

  it('CONTROL · the door refuses: no credential is 401 and NO capability is minted', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_OPEN);
    expect(res.status).toBe(401);
    expect((res.json?.error as { code?: string } | undefined)?.code).toBe('AUTH_REQUIRED');
    expect(h.minted()).toBe(0);
  });

  it('CONTROL · the REACHABILITY gate is the other refusal: an unreachable parent is 403, not 401', async () => {
    // A fully admitted CURRENT member, refused by the record's own visibility.
    // It separates "refused at the door" from "refused by the parent record" —
    // without it, an arm below could pass on the wrong reason.
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_CLOSED, RAW_MEMBER_KEY);
    expect(res.status).toBe(403);
    expect((res.json?.error as { code?: string } | undefined)?.code).toBe('FILE_DOWNLOAD_DENIED');
    expect(h.minted()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT. The ex-member's org-stamped key, under `isolated`.
// ---------------------------------------------------------------------------

describe('[#15352] §2 — an ex-member\'s org-stamped key at the download door under `isolated`', () => {
  it('REPAIRED: the signed-URL door is 401 — was 200 with a live capability', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(401);
    expect((res.json?.error as { code?: string } | undefined)?.code).toBe('AUTH_REQUIRED');
    // The second fact, read off the ADAPTER: no capability was minted at all.
    expect(h.minted()).toBe(0);
  });

  it('REPAIRED: the redirect door is 401 too — no Location, no capability', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('redirect', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(401);
    expect(res.headers.Location).toBeUndefined();
    expect(h.minted()).toBe(0);
  });

  it('the refusal reason is the RIGHT one, said out loud server-side', async () => {
    const h = await mount(ISOLATED);
    await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    const lines = refusalLines(h);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('organization_membership_ended');
    expect(lines[0]).toContain('key=key_exmember');
    expect(lines[0]).toContain('principal=u_exmember');
    expect(lines[0]).toContain(`organization=${ORG_ALPHA}`);
    // ⛔ NEVER the credential — neither the raw key nor its at-rest hash.
    expect(lines[0]).not.toContain(RAW_EXMEMBER_KEY);
    expect(lines[0]).not.toContain(hashApiKey(RAW_EXMEMBER_KEY));
  });

  it('⛔ and the WIRE says nothing else — a key holder learns only the generic 401', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(JSON.stringify(res.json)).not.toMatch(
      /membership|organization_membership_ended|org_alpha|key_exmember/i,
    );
  });
});

// ---------------------------------------------------------------------------
// §3 — The organization-less key: the same matrix's other row.
// ---------------------------------------------------------------------------

describe('[#15352] §3 — an organization-less key under `isolated`', () => {
  it('REPAIRED: 401 — `organization_required` now runs at this door', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY);
    expect(res.status).toBe(401);
    expect((res.json?.error as { code?: string } | undefined)?.code).toBe('AUTH_REQUIRED');
    expect(h.minted()).toBe(0);
  });

  it('its refusal is its own line, with its own reason', async () => {
    const h = await mount(ISOLATED);
    await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY);
    const lines = refusalLines(h);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('organization_required');
    expect(lines[0]).toContain('key=key_orgless');
    expect(lines[0]).toContain('organization=<none>');
    expect(lines[0]).not.toContain(RAW_ORGLESS_KEY);
  });

  it('a REFUSAL is not a key scanner\'s log: an unknown key is silent', async () => {
    const h = await mount(ISOLATED);
    const res = await h.call('url', FILE_OPEN, 'osk_not_a_real_key');
    expect(res.status).toBe(401);
    expect(refusalLines(h)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — THE ABLATION, held permanently.
//
// One variable changes: whether the host exposes the kernel this seam reads the
// `tenancy` service off. The engine, the keys, the files, the parent records
// and the routes are byte-identical to §2 and §3.
// ---------------------------------------------------------------------------

describe('[#15352] §4 — ablation: with no kernel to read the posture from, the admission returns', () => {
  const ABLATED: Wiring = { kind: 'no-kernel' };

  it('the ex-member DOWNLOADS again — 200, and the adapter MINTS the capability', async () => {
    const h = await mount(ABLATED);
    const res = await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(200);
    expect(String((res.json?.data as { url?: string } | undefined)?.url)).toContain('/_local/raw/');
    expect(h.minted()).toBe(1);
  });

  it('the redirect door hands the ex-member a Location again', async () => {
    const h = await mount(ABLATED);
    const res = await h.call('redirect', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(302);
    expect(res.headers.Location).toContain('/_local/raw/');
  });

  it('the organization-less key is admitted again too', async () => {
    const h = await mount(ABLATED);
    expect((await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY)).status).toBe(200);
  });

  it('and NOTHING is said about any of it — no refusal line, because no refusal was decided', async () => {
    const h = await mount(ABLATED);
    await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY);
    expect(refusalLines(h)).toHaveLength(0);
  });

  it('NARROWNESS: the member and reachability controls are UNCHANGED by the ablation', async () => {
    const h = await mount(ABLATED);
    expect((await h.call('url', FILE_OPEN, RAW_MEMBER_KEY)).status).toBe(200);
    expect((await h.call('url', FILE_OPEN)).status).toBe(401);
    expect((await h.call('url', FILE_CLOSED, RAW_MEMBER_KEY)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// §5 — #13906 decision 1 option A: the two halves of a failed resolution.
// ---------------------------------------------------------------------------

describe('[#15352] §5 — a `tenancy` service that was NEVER REGISTERED resolves quietly', () => {
  const UNREGISTERED: Wiring = { kind: 'unregistered' };

  it('the supported no-tenancy composition still serves: the member downloads', async () => {
    const h = await mount(UNREGISTERED);
    expect((await h.call('url', FILE_OPEN, RAW_MEMBER_KEY)).status).toBe(200);
  });

  it('and it runs NO posture-conditional refusal — behaviour is exactly what it was', async () => {
    const h = await mount(UNREGISTERED);
    expect((await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY)).status).toBe(200);
    expect((await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY)).status).toBe(200);
    expect(refusalLines(h)).toHaveLength(0);
  });
});

describe('[#15352] §5b — a `tenancy` service that was REGISTERED and FAILED is never permissive', () => {
  const OUTAGE: Wiring = { kind: 'factory-throws' };

  /**
   * ⚠️ MEASURED on this tree, and deliberately pinned as a CLASS rather than as
   * digits: this door answers **`403 FILE_DOWNLOAD_DENIED`** on a failed
   * posture read, not the `503 SERVICE_UNAVAILABLE` the
   * `AuthzStoreUnavailableError` brand carries.
   *
   * The authorizer DOES re-raise the brand (`isAuthzStoreUnavailableError(err)
   * ⇒ throw`, #13279) — but `registerStorageRoutes`' `authorizeDownload` wraps
   * the whole authorizer in `catch { verdict = 'deny' }` one frame up, so on
   * this door the re-raise is absorbed and rendered as the gate's own refusal.
   * That flattening is PRE-EXISTING — it has swallowed the #13279
   * permission-store outage here since that card landed, out of the same
   * `catch` — and is ⛔ not repaired by this one; it is filed separately.
   *
   * The property this file is about is the SECURITY one: a FAILURE must not
   * read as "this check does not apply". So the assertions below say the outage
   * is never answered as an ADMISSION and never mints a capability, and leave
   * the digits free — a later repair that promotes this to 503 must not have to
   * redden a security pin.
   */
  it('⛔ the ex-member is NOT admitted on a failed posture read — the defect a quiet `catch` would restore', async () => {
    const h = await mount(OUTAGE);
    const res = await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect([403, 500, 503]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(h.minted()).toBe(0);
  });

  it('⛔ nor is the redirect door — no 302, no Location, no capability', async () => {
    const h = await mount(OUTAGE);
    const res = await h.call('redirect', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(res.status).not.toBe(302);
    expect(res.status).not.toBe(200);
    expect(res.headers.Location).toBeUndefined();
    expect(h.minted()).toBe(0);
  });

  it('the outage is not selective either: a CURRENT member is refused too, and nothing is minted', async () => {
    // The outage is a fact about the DEPLOYMENT, not about the credential —
    // a door that kept serving the "good" caller would be deciding admission
    // on an input it never read.
    const h = await mount(OUTAGE);
    const res = await h.call('url', FILE_OPEN, RAW_MEMBER_KEY);
    expect(res.status).not.toBe(200);
    expect(h.minted()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §6 — `group`. MEASURED, not assumed (the card forbids assuming it unaffected).
// ---------------------------------------------------------------------------

describe('[#15352] §6 — the `group` posture, measured on this door', () => {
  const GROUP: Wiring = { kind: 'posture', posture: 'group' };

  it('the ex-member IS refused under `group` too — `postureEnforcesWall(\'group\')` is true', async () => {
    const h = await mount(GROUP);
    const res = await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY);
    expect(res.status).toBe(401);
    expect(h.minted()).toBe(0);
    expect(refusalLines(h)[0]).toContain('organization_membership_ended');
  });

  it('the organization-less key is ADMITTED under `group` — union scope, by design', async () => {
    // `organization_required` is scoped to `postureEnforcesWall &&
    // !postureUsesUnionScope`, and `group` uses union scope: such a key already
    // reads the union of its owner's organizations, so refusing it would break
    // working deployments for no security gain. Pinned so the asymmetry with
    // §3 is a recorded decision rather than an accident.
    const h = await mount(GROUP);
    const res = await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY);
    expect(res.status).toBe(200);
    expect(h.minted()).toBe(1);
  });

  it('the member control is unchanged under `group`', async () => {
    const h = await mount(GROUP);
    expect((await h.call('url', FILE_OPEN, RAW_MEMBER_KEY)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §7 — `single`. The posture that enforces no wall admits everyone it did.
// ---------------------------------------------------------------------------

describe('[#15352] §7 — under `single` nothing changes', () => {
  const SINGLE: Wiring = { kind: 'posture', posture: 'single' };

  it('every key is admitted, stamped or not', async () => {
    const h = await mount(SINGLE);
    expect((await h.call('url', FILE_OPEN, RAW_MEMBER_KEY)).status).toBe(200);
    expect((await h.call('url', FILE_OPEN, RAW_EXMEMBER_KEY)).status).toBe(200);
    expect((await h.call('url', FILE_OPEN, RAW_ORGLESS_KEY)).status).toBe(200);
    expect(refusalLines(h)).toHaveLength(0);
  });

  it('and the two non-posture refusals still stand', async () => {
    const h = await mount(SINGLE);
    expect((await h.call('url', FILE_OPEN)).status).toBe(401);
    expect((await h.call('url', FILE_CLOSED, RAW_MEMBER_KEY)).status).toBe(403);
  });
});
