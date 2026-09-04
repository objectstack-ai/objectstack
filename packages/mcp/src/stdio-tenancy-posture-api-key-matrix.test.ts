// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15348] The #15163 matrix, driven through the MCP **stdio** door.
 *
 * ## The defect this measures
 *
 * `resolveStdioExecutionContext` built its own header map and called
 * `resolveAuthzContext` with no `tenancyPosture`. Both posture-conditional
 * API-key refusals are gated on the caller supplying one
 * (`organization_required` in `api-key.ts`, `organization_membership_ended` in
 * `resolve-authz-context.ts`), so a door that supplies none runs NEITHER, and
 * the key's `sys_api_key.active_organization_id` — the caller's own stored
 * claim, never vetted against current membership — became the request's tenant.
 *
 * This transport is the sharpest of the census: it has no session path at all,
 * so the API-key admission is not one branch of its authorization, it IS its
 * authorization.
 *
 * ## What this door answers, and why it is not REST's 401
 *
 * The stdio face is FAIL-CLOSED BY REFUSING TO START (ADR-0101): a key that
 * does not resolve to an identity throws out of `start()` rather than
 * attaching a transport. A posture refusal resolves to no principal, so it
 * takes that same exit — there is no wire on which to answer 401. §2 and §3
 * therefore assert a refused BOOT, and §5 asserts the per-call half, where the
 * transport is already live and the next call is what has to refuse.
 *
 * ## Why the fixture is shaped the way it is
 *
 * Carried from the REST reading (`single-kernel-isolated-api-key-matrix.test.ts`):
 *
 *  1. **Data must be shown to REACH.** Every arm has a current member's key on
 *     the same door requiring rows back, so a green cannot mean "nothing works".
 *  2. **The write is read back FROM THE STORE**, never from the tool's response
 *     body. `store()` is the fixture's table and the assertions count rows in it.
 *  3. **Layer 0 is modelled as the hard equality it is** — `organization_id =
 *     context.tenantId` (`tenant-layer.ts`'s `isolated` branch), which is
 *     exactly what admits an ex-member whose key names the organization. A
 *     second organization is seeded so a wall that stopped applying reddens.
 *  4. **A REAL `ObjectKernel` holds the services.** The classification under
 *     test is the registry's own — branded "never registered" versus the
 *     unbranded rejection of a factory that threw — so a hand-built stub error
 *     at the seam would be the fixture asserting itself. `@objectstack/core` is
 *     not mocked anywhere in this file: the real verify → authorize chain runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ObjectKernel,
  hashApiKey,
  isServiceNotRegisteredError,
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { MCPServerPlugin } from './plugin.js';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const OBJECT = 'crm_unit';

const RAW_MEMBER_KEY = 'osk_15348_member';
const RAW_EXMEMBER_KEY = 'osk_15348_exmember';
const RAW_ORGLESS_KEY = 'osk_15348_orgless';

// ---------------------------------------------------------------------------
// The store — the fixture's table, read directly by the write assertions
// ---------------------------------------------------------------------------

interface UnitRow {
  id: string;
  organization_id: string | undefined;
  created_by: string | undefined;
  name: string;
}

const SEED: readonly UnitRow[] = [
  { id: 'u_a1', organization_id: 'org_alpha', created_by: undefined, name: 'alpha unit 1' },
  { id: 'u_a2', organization_id: 'org_alpha', created_by: undefined, name: 'alpha unit 2' },
  // The other organization, seeded so "the wall is live" is a control rather
  // than an assumption: a member of org_alpha must never see these two.
  { id: 'u_b1', organization_id: 'org_beta', created_by: undefined, name: 'beta unit 1' },
  { id: 'u_b2', organization_id: 'org_beta', created_by: undefined, name: 'beta unit 2' },
];

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
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as { $in?: unknown }).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!((cond as { $in: unknown[] }).$in).includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

interface Engine {
  find: (object: string, query?: unknown, opts?: unknown) => Promise<unknown>;
  insert: (object: string, data: unknown, opts?: unknown) => Promise<unknown>;
  update: (object: string, data: unknown, opts?: unknown) => Promise<unknown>;
  delete: (object: string, opts?: unknown) => Promise<unknown>;
  findOne: (object: string, query?: unknown, opts?: unknown) => Promise<unknown>;
  count: () => Promise<number>;
}

interface Fixture {
  engine: Engine;
  store: () => UnitRow[];
  /** Drop `u_exmember`'s remaining membership row — used by §5's live arm. */
  endMembership: (userId: string) => void;
}

/**
 * The permission store, in the SHIPPED aggregation shapes, plus the one data
 * object the door reads and writes.
 *
 * `u_exmember`'s key is stamped `org_alpha` while its only current `sys_member`
 * row is for `org_beta` — the credential outlived the membership that backed
 * it, which is the whole scenario. RBAC is opened SYMMETRICALLY through one
 * shared permission set, so only the organization wall can separate the arms.
 */
function makeFixture(): Fixture {
  const rows: UnitRow[] = SEED.map((r) => ({ ...r }));
  let seq = 0;
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [
      { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: 'org_alpha', revoked: false },
      { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: 'org_alpha', revoked: false },
      { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
    ],
    sys_member: [
      { user_id: 'u_member', organization_id: 'org_alpha' },
      { user_id: 'u_exmember', organization_id: 'org_beta' },
    ],
    sys_user: [
      { id: 'u_member', email: 'u_member@example.com' },
      { id: 'u_exmember', email: 'u_exmember@example.com' },
      { id: 'u_orgless', email: 'u_orgless@example.com' },
    ],
    sys_user_permission_set: [
      { user_id: 'u_member', permission_set_id: 'ps_shared' },
      { user_id: 'u_exmember', permission_set_id: 'ps_shared' },
      { user_id: 'u_orgless', permission_set_id: 'ps_shared' },
    ],
    sys_permission_set: [
      { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
    ],
  };

  /** The context reaches `find` in the options bag on one call shape and in a
   *  third argument on the other — both are live on this door (the ADR-0101
   *  record reader uses the first, the data bridge the second). */
  const contextOf = (query: unknown, opts: unknown): ExecutionContext | undefined =>
    ((opts as { context?: ExecutionContext } | undefined)?.context
      ?? (query as { context?: ExecutionContext } | undefined)?.context);

  const engine: Engine = {
    async find(object, query: any = {}, opts?: unknown) {
      if (object !== OBJECT) {
        const matched = (tables[object] ?? []).filter((row) => matchesWhere(row, query?.where));
        return typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
      }
      // ADR-0105 Layer 0 under `isolated`, as `tenant-layer.ts` computes it: a
      // HARD EQUALITY against the caller's active organization. It never reads
      // `accessible_org_ids` — that is the `group` union branch — which is
      // precisely why a key naming an organization its owner LEFT passes it.
      const tenantId = contextOf(query, opts)?.tenantId;
      const visible = rows.filter(
        (row) => row.organization_id === tenantId && matchesWhere(row as never, query?.where),
      );
      return { value: visible, total: visible.length };
    },
    async insert(object, data: any, opts?: unknown) {
      if (object !== OBJECT) throw new Error(`fixture: no write table for '${object}'`);
      const ctx = contextOf(undefined, opts);
      const row: UnitRow = {
        id: `w${++seq}`,
        organization_id: ctx?.tenantId,
        created_by: ctx?.userId,
        name: String(data?.name ?? ''),
      };
      rows.push(row);
      return { ...row };
    },
    async update() { throw new Error('fixture: update not exercised'); },
    async delete() { throw new Error('fixture: delete not exercised'); },
    async findOne() { return null; },
    async count() { return 0; },
  };

  return {
    engine,
    store: () => rows.map((r) => ({ ...r })),
    endMembership: (userId) => {
      tables.sys_member = tables.sys_member.filter((m) => m.user_id !== userId);
    },
  };
}

// ---------------------------------------------------------------------------
// The host — a REAL kernel behind a plugin context, so the registry's own
// branded / unbranded rejections are what the seam classifies.
// ---------------------------------------------------------------------------

/** A `tenancy` service whose posture the test can move while the door is live. */
interface LiveTenancy { posture: string }

type TenancyWiring =
  | { kind: 'posture'; posture: string }
  | { kind: 'live'; service: LiveTenancy }
  | { kind: 'unregistered' }
  | { kind: 'factory-throws' };

function makeKernel(engine: Engine, tenancy: TenancyWiring): ObjectKernel {
  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals (the default registers SIGTERM/SIGINT handlers).
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  kernel.registerService('objectql', engine);
  kernel.registerService('metadata', {
    listObjects: vi.fn(async () => []),
    // No declaration to read ⇒ the ADR-0049 exposure gate falls open, which is
    // the state a bare kernel is in. That gate is #8266's subject, not this
    // file's: what is measured here is the tenant the read runs under.
    getObject: vi.fn(async () => null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  });
  if (tenancy.kind === 'posture') {
    kernel.registerService('tenancy', { posture: tenancy.posture });
  } else if (tenancy.kind === 'live') {
    kernel.registerService('tenancy', tenancy.service);
  } else if (tenancy.kind === 'factory-throws') {
    // The REAL failure class (#13905 "registered and FAILED to construct"):
    // the registry's own UNBRANDED rejection, not a stub error thrown at the
    // seam under measurement.
    kernel.registerServiceFactory('tenancy', () => {
      throw new Error('tenancy backend unavailable');
    });
  }
  // 'unregistered' → nothing registered: the branded not-registered rejection.
  return kernel;
}

/** The plugin context, delegating every registry question to the real kernel. */
function makeCtx(kernel: ObjectKernel) {
  return {
    registerService: vi.fn((name: string, service: unknown) => { kernel.registerService(name, service); }),
    getService: vi.fn(<T>(name: string): T => kernel.getService<T>(name)),
    replaceService: vi.fn(),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(() => kernel),
  };
}

/**
 * `McpDataBridge.query` declares `Promise<unknown>` (its shape is the tool
 * layer's business, not the bridge contract's), so every read in this file goes
 * through one narrowing point rather than a cast per assertion.
 */
interface QueryAnswer {
  records: Array<Record<string, unknown>>;
  total: number;
}

async function readAll(bridge: McpDataBridge): Promise<QueryAnswer> {
  return (await bridge.query(OBJECT, {})) as QueryAnswer;
}

interface Started {
  bridge: McpDataBridge;
  getRecord: (object: string, id: string) => Promise<Record<string, unknown> | null>;
}

/**
 * Boot the plugin on the stdio path and hand back the two principal-bound
 * surfaces it registered. The transport itself is stubbed: a real `start()`
 * would claim this process's stdin/stdout.
 */
async function startStdio(ctx: unknown): Promise<Started> {
  let bridge: McpDataBridge | undefined;
  let getRecord: Started['getRecord'] | undefined;
  const spies = [
    vi.spyOn(MCPServerRuntime.prototype, 'bridgeResources').mockImplementation(
      (_meta, reader) => { getRecord = reader as Started['getRecord']; },
    ),
    vi.spyOn(MCPServerRuntime.prototype, 'bridgePrompts').mockImplementation(async () => {}),
    vi.spyOn(MCPServerRuntime.prototype, 'bridgeDataTools').mockImplementation(
      (b) => { bridge = b as McpDataBridge; return []; },
    ),
    vi.spyOn(MCPServerRuntime.prototype, 'start').mockImplementation(async () => {}),
  ];
  try {
    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
  } finally {
    for (const s of spies) s.mockRestore();
  }
  if (!bridge || !getRecord) throw new Error('stdio start registered no principal-bound surface');
  return { bridge, getRecord };
}

/** Boot with this raw key, and hand back whatever `start()` did. */
async function boot(rawKey: string, tenancy: TenancyWiring) {
  process.env.OS_MCP_STDIO_API_KEY = rawKey;
  const fixture = makeFixture();
  const ctx = makeCtx(makeKernel(fixture.engine, tenancy));
  return { fixture, ctx, start: () => startStdio(ctx) };
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// §0 — Instrument controls. Both directions, before any subject arm is read.
// ---------------------------------------------------------------------------

describe('[#15348] §0 — the door can serve, and the door can refuse', () => {
  it('CONTROL · data REACHES: a CURRENT member reads its own organization and only that one', async () => {
    const h = await boot(RAW_MEMBER_KEY, { kind: 'posture', posture: 'isolated' });
    const { bridge } = await h.start();
    const res = await readAll(bridge);
    expect(res.total).toBe(2);
    expect(res.records.map((r) => r.id)).toEqual(['u_a1', 'u_a2']);
    // The wall IS live: org_beta's two rows exist in the store and are not served.
    expect(h.fixture.store().filter((r) => r.organization_id === 'org_beta')).toHaveLength(2);
    expect(res.records.every((r) => r.organization_id === 'org_alpha')).toBe(true);
  });

  it('CONTROL · writes REACH: a CURRENT member\'s create lands, read back FROM THE STORE', async () => {
    const h = await boot(RAW_MEMBER_KEY, { kind: 'posture', posture: 'isolated' });
    const { bridge } = await h.start();
    await bridge.create(OBJECT, { name: 'w-member' });
    const landed = h.fixture.store().filter((r) => r.name === 'w-member');
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_member' });
  });

  it('CONTROL · the ADR-0101 record reader is bound to the same identity', async () => {
    const h = await boot(RAW_MEMBER_KEY, { kind: 'posture', posture: 'isolated' });
    const { getRecord } = await h.start();
    expect(await getRecord(OBJECT, 'u_a1')).toMatchObject({ id: 'u_a1', organization_id: 'org_alpha' });
    // The other organization's row is in the store and is NOT readable.
    expect(await getRecord(OBJECT, 'u_b1')).toBeNull();
  });

  it('CONTROL · the door refuses: an unknown key never starts a transport', async () => {
    const h = await boot('osk_not_a_real_key', { kind: 'posture', posture: 'isolated' });
    await expect(h.start()).rejects.toThrow(/did not resolve to a valid identity/);
  });
});

// ---------------------------------------------------------------------------
// §1 — the seam actually reads a posture at all
// ---------------------------------------------------------------------------

describe('[#15348] §1 — the fixture\'s two rejection classes are the registry\'s own', () => {
  it('an unregistered `tenancy` rejects BRANDED — the fact the quiet branch keys on', async () => {
    const kernel = makeKernel(makeFixture().engine, { kind: 'unregistered' });
    const err = await kernel.getServiceAsync('tenancy').then(() => undefined, (e) => e);
    expect(isServiceNotRegisteredError(err)).toBe(true);
  });

  it('a `tenancy` factory that THROWS rejects UNBRANDED — the fact the loud branch keys on', async () => {
    const kernel = makeKernel(makeFixture().engine, { kind: 'factory-throws' });
    const err = await kernel.getServiceAsync('tenancy').then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isServiceNotRegisteredError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT ROW. An ex-member's org-stamped key under `isolated`.
// ---------------------------------------------------------------------------

describe('[#15348] §2 — an ex-member\'s org-stamped key on the stdio door under `isolated`', () => {
  it('REPAIRED: the transport REFUSES TO START — it used to attach and serve the other organization', async () => {
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'posture', posture: 'isolated' });
    await expect(h.start()).rejects.toThrow(/did not resolve to a valid identity/);
    // Nothing ran, so nothing was written.
    expect(h.fixture.store()).toHaveLength(SEED.length);
  });

  it('[2A] the refusal is said OUT LOUD on the server side, naming key / principal / organization / reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'posture', posture: 'isolated' });
    await h.start().catch(() => {});
    const lines = warn.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('API key refused'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('organization_membership_ended');
    expect(lines[0]).toContain('key=key_exmember');
    expect(lines[0]).toContain('principal=u_exmember');
    expect(lines[0]).toContain('organization=org_alpha');
    // ⛔ NEVER the credential — neither the raw key nor its at-rest hash.
    expect(lines[0]).not.toContain(RAW_EXMEMBER_KEY);
    expect(lines[0]).not.toContain(hashApiKey(RAW_EXMEMBER_KEY));
  });

  it('`group` refuses it too — the union scope is not a licence for a key naming an org its owner left', async () => {
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'posture', posture: 'group' });
    await expect(h.start()).rejects.toThrow(/did not resolve to a valid identity/);
  });

  it('NARROWNESS · `single` admits it — there is no wall to be walled out of', async () => {
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'posture', posture: 'single' });
    const { bridge } = await h.start();
    // Admitted, and the read is what an unwalled deployment answers.
    expect((await readAll(bridge)).total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §3 — The organization-less key: the silent-empty row of the same matrix.
// ---------------------------------------------------------------------------

describe('[#15348] §3 — an organization-less key', () => {
  it('REPAIRED under `isolated`: refused at start — it used to attach and answer a silent empty set', async () => {
    const h = await boot(RAW_ORGLESS_KEY, { kind: 'posture', posture: 'isolated' });
    await expect(h.start()).rejects.toThrow(/did not resolve to a valid identity/);
  });

  it('[2A] its refusal is its own line, with its own reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await boot(RAW_ORGLESS_KEY, { kind: 'posture', posture: 'isolated' });
    await h.start().catch(() => {});
    const lines = warn.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('API key refused'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('organization_required');
    expect(lines[0]).toContain('key=key_orgless');
    expect(lines[0]).toContain('organization=<none>');
  });

  it('NARROWNESS · `group` admits it — `organization_required` is the `isolated` refusal only', async () => {
    // `postureUsesUnionScope('group')` is true, so an org-less key still reads
    // through the membership union. Asserted so the two refusals cannot be
    // conflated into one broader rule than either declares.
    const h = await boot(RAW_ORGLESS_KEY, { kind: 'posture', posture: 'group' });
    const { bridge } = await h.start();
    expect((await readAll(bridge)).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — THE CLASSIFICATION. #13906 decision 1 option A, both halves.
//
// This is the pin 1.2 of the dispatch is about, and the one a naive
// `try { … } catch { undefined }` at this seam would turn green in the wrong
// direction: it would make the BROKEN service admit exactly like the absent one.
// ---------------------------------------------------------------------------

describe('[#15348] §4 — a `tenancy` service that is registered and FAILS TO BUILD', () => {
  it('raises the ADR-0112 outage envelope — code AND status — instead of admitting quietly', async () => {
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'factory-throws' });
    const err = await h.start().then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: unknown }).code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect((err as { status?: unknown }).status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect((err as { object?: unknown }).object).toBe('tenancy');
    // ⛔ NOT the fail-closed identity refusal: an outage must not wear the
    // costume of "this key is not valid", which is what a `catch { undefined }`
    // would have produced here (a quiet admit, or a 401-shaped refusal).
    expect(String((err as Error).message)).not.toMatch(/did not resolve to a valid identity/);
  });

  it('and the CURRENT member is refused too — an undecidable posture is not a per-key verdict', async () => {
    const h = await boot(RAW_MEMBER_KEY, { kind: 'factory-throws' });
    const err = await h.start().then(() => undefined, (e) => e);
    expect((err as { code?: unknown }).code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
  });

  it('CONTRAST · a `tenancy` that was NEVER REGISTERED stays quiet — the supported no-tenancy composition', async () => {
    // The other half of decision 1A, and simultaneously this file's permanent
    // ABLATION: with no posture in play the ex-member's key is admitted again
    // and reads `org_alpha`'s rows, which is the measured defect returning the
    // moment the argument stops being supplied. It is CORRECT here — a kernel
    // with no `tenancy` service enforces no organization wall — and it is what
    // makes every refusal above attributable to the posture and nothing else.
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'unregistered' });
    const { bridge } = await h.start();
    const res = await readAll(bridge);
    expect(res.total).toBe(2);
    expect(res.records.map((r) => r.id)).toEqual(['u_a1', 'u_a2']);
    await bridge.create(OBJECT, { name: 'w-nowall' });
    expect(h.fixture.store().filter((r) => r.name === 'w-nowall')[0]).toMatchObject({
      organization_id: 'org_alpha', created_by: 'u_exmember',
    });
  });
});

// ---------------------------------------------------------------------------
// §5 — READ PER CALL, not frozen at `start()`.
//
// `TenancyService.posture` is a live getter that reports a wall it cannot yet
// enforce as `single` (ADR-0093 D4/D5), and this plugin's `start()` runs before
// every other plugin's. A posture captured there and held would freeze
// "no wall" for the life of a long-lived transport — #11580's defect pointed at
// a security control. These two arms are what a hoist would redden.
// ---------------------------------------------------------------------------

describe('[#15348] §5 — the posture and the membership are both re-read per call', () => {
  it('a wall that comes up AFTER the transport attaches refuses the next call', async () => {
    const service: LiveTenancy = { posture: 'single' };
    const h = await boot(RAW_EXMEMBER_KEY, { kind: 'live', service });
    // Boots: at start there is no wall, so the key is legitimately admitted.
    const { bridge } = await h.start();
    expect((await readAll(bridge)).total).toBe(2);

    // The enterprise multi-org runtime registers and the wall goes live.
    service.posture = 'isolated';

    await expect(bridge.query(OBJECT, {})).rejects.toThrow(/no longer valid/);
    await expect(bridge.create(OBJECT, { name: 'w-after-wall' })).rejects.toThrow(/no longer valid/);
    expect(h.fixture.store().filter((r) => r.name === 'w-after-wall')).toHaveLength(0);
  });

  it('a membership that ENDS mid-session refuses the next call (ADR-0101 D1)', async () => {
    // `u_member` starts as a current member of the organization its key names.
    const h = await boot(RAW_MEMBER_KEY, { kind: 'posture', posture: 'isolated' });
    const { bridge, getRecord } = await h.start();
    expect((await readAll(bridge)).total).toBe(2);

    h.fixture.endMembership('u_member');

    await expect(bridge.query(OBJECT, {})).rejects.toThrow(/no longer valid/);
    // The ADR-0101 record reader is on the same schedule.
    await expect(getRecord(OBJECT, 'u_a1')).rejects.toThrow(/no longer valid/);
  });
});
