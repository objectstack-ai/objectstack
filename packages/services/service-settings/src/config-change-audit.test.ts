// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8145] `config_change` reaches `sys_audit_log` — the SEAM half.
 *
 * ## What was broken, and where
 *
 * `SettingsServicePlugin.start()` called
 * `bindEngine(engine, undefined, { auditWriter, … })`. That second argument is
 * the `SettingsAuditSink` slot — documented since Phase 3 as the one that writes
 * the generic `sys_audit_log` — and nothing ever supplied it. So every settings
 * write landed on `sys_setting_audit` with `action: 'set'` and NOWHERE else,
 * which is #7675's `config_change` half: the declared enum member, the shipped
 * `config_changes` list view and every `$filter={"action":"config_change"}` were
 * permanently empty.
 *
 * **The defect is the WIRING, not the row shape.** A test that called
 * `buildConfigChangeAuditSink` directly would stay green on a plugin that never
 * wired it, so every case here drives the real `SettingsServicePlugin` through
 * its real `init`/`start`/`kernel:ready` sequence and lets it build its own
 * sinks. Case 1 is red on `origin/main` for exactly the reason above.
 *
 * ## What this file can and cannot see
 *
 * `sys_setting` and `sys_setting_audit` are `@objectstack/platform-objects`
 * declarations this package already depends on, so those rows are REAL here —
 * registered in a real `ObjectQL` over a memory driver, and read back out of the
 * driver's own store. `sys_audit_log` belongs to the optional
 * `@objectstack/plugin-audit`, which this package must not depend on (the
 * dependency would invert the optional-plugin relationship the best-effort write
 * exists to respect), so its insert is intercepted at the engine seam and the
 * ROW SHAPE is asserted there.
 *
 * That the shape lands in the real object, that the real `action` enum accepts
 * it, and that the shipped `config_changes` list view returns it, are pinned end
 * to end against the real routes and the real object in
 * `packages/qa/dogfood/test/settings-config-change-audit.dogfood.test.ts` — the
 * parent's reproduction, inverted. Neither file is sufficient alone.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysSetting, SysSettingAudit } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  SettingsServicePlugin,
  buildSettingAuditWriter,
  wrapEngineAsSettingsEngine,
} from './settings-service-plugin.js';
import {
  buildConfigChangeAuditSink,
  CONFIG_CHANGE_ACTION,
  CONFIG_CHANGE_OBJECT_NAME,
} from './config-change-audit.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { NoopCryptoAdapter } from './crypto-adapter.js';
import { SettingsCryptoUnavailableError } from './settings-service.types.js';
import { SettingsService } from './settings-service.js';

const OWNER_PACKAGE = 'com.objectstack.test.config-change-audit';

const SECRET = 'sk_live_8145_do_not_log';

/**
 * One plain key, one encrypted key, one namespace. Deliberately minimal: the
 * shipped manifests carry `visible` predicates and cross-field `required` rules,
 * and this file is about what a write puts on the two ledgers.
 */
const manifest: SettingsManifest = {
  namespace: 'branding_test',
  version: 1,
  label: 'Branding (test)',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'text', key: 'workspace_name', label: 'Workspace name', required: false },
    { type: 'password', key: 'api_key', label: 'API key', required: false },
  ],
};

type Store = Map<string, Map<string, Record<string, unknown>>>;

/** A driver over plain Maps — enough of `IDataDriver` for the settings write path. */
function makeMemoryDriver() {
  const store: Store = new Map();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => (row[k] ?? null) === (v ?? null));
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return [...rowsOf(object).values()].filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) rowsOf(object).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/** Minimal `IHttpServer` that just keeps the handlers so a route can be invoked. */
class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(p: string, h: RouteHandler) { this.add('GET', p, h); return this as any; }
  post(p: string, h: RouteHandler) { this.add('POST', p, h); return this as any; }
  put(p: string, h: RouteHandler) { this.add('PUT', p, h); return this as any; }
  delete(p: string, h: RouteHandler) { this.add('DELETE', p, h); return this as any; }
  patch(p: string, h: RouteHandler) { this.add('PATCH', p, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

interface BootOptions {
  /** Make every `sys_audit_log` insert fail, to exercise the best-effort path. */
  ledgerThrows?: boolean;
  /** Identity the write runs under. */
  userId?: string;
  tenantId?: string;
  /** `OS_*` overrides — an env-pinned key makes the service REFUSE its write. */
  env?: Record<string, string>;
}

/**
 * Boot the REAL `SettingsServicePlugin` against a real engine, through a
 * hand-rolled `PluginContext` — the production sequence (`init` →
 * `start` → the `kernel:ready` hook) rather than a re-creation of its wiring.
 * The plugin builds its own secret store, its own `sys_setting_audit` writer and
 * its own `config_change` sink; nothing here supplies any of them.
 */
async function bootPlugin(opts: BootOptions = {}) {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(SysSetting as any, OWNER_PACKAGE);
  engine.registry.registerObject(SysSettingAudit as any, OWNER_PACKAGE);

  // `sys_audit_log` is plugin-audit's object and is deliberately not resolvable
  // from this package (see the file header), so its insert is answered at the
  // engine seam and recorded. Every other call — including the `sys_setting` and
  // `sys_setting_audit` writes — goes to the real engine untouched, so those
  // rows are real.
  const ledgerInserts: Array<{ row: Record<string, unknown>; opts: any }> = [];
  const realInsert = engine.insert.bind(engine);
  (engine as any).insert = async (object: string, data: any, options?: any) => {
    if (object !== 'sys_audit_log') return realInsert(object, data, options);
    ledgerInserts.push({ row: data, opts: options });
    if (opts.ledgerThrows) throw new Error('no such table: sys_audit_log');
    return { ...data, id: `audit_${ledgerInserts.length}` };
  };

  const logged: string[] = [];
  const logger = {
    info: () => {},
    warn: (m: string) => { logged.push(m); },
    error: (m: string) => { logged.push(m); },
    debug: () => {},
  };

  const http = new MockHttp();
  let readyHook: (() => Promise<void>) | undefined;
  const services: Record<string, unknown> = { objectql: engine, 'http-server': http };
  const ctx: any = {
    logger,
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`no service '${name}'`);
      return services[name];
    },
    hook: (event: string, fn: () => Promise<void>) => {
      if (event === 'kernel:ready') readyHook = fn;
    },
  };

  const plugin = new SettingsServicePlugin({
    manifests: [manifest],
    env: opts.env ?? {},
    // The bundled `mail`/`sms`/`storage`/`ai` test-connection handlers register
    // against manifests this fixture does not load; opting out keeps the boot to
    // the one namespace under test.
    actionHandlers: {},
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();

  const service = services.settings as SettingsService;
  const writeCtx = { userId: opts.userId, tenantId: opts.tenantId, requestId: 'req_8145' };

  return {
    service,
    writeCtx,
    /** Every `sys_audit_log` row the write path asked the engine to insert. */
    ledgerRows: () => ledgerInserts.map((i) => i.row),
    ledgerOpts: () => ledgerInserts.map((i) => i.opts),
    /** REAL `sys_setting_audit` rows, read out of the driver's store. */
    settingAuditRows: () => [...rowsOf('sys_setting_audit').values()],
    /** REAL `sys_setting` rows. */
    settingRows: () => [...rowsOf('sys_setting').values()],
    logged,
    http,
  };
}

/** Parse a row's `metadata` JSON. */
const metaOf = (row: Record<string, unknown>): any => JSON.parse(String(row.metadata));

/** Drive `PUT /api/settings/branding_test` through a mounted route set. */
async function put(http: MockHttp, body: Record<string, unknown>) {
  const handler = http.routes.get('PUT /api/settings/:namespace')!;
  const req = {
    params: { namespace: 'branding_test' },
    query: {},
    body,
    headers: {},
    method: 'PUT',
    path: '/api/settings/branding_test',
  } as unknown as IHttpRequest;
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: vi.fn((data: any) => { state.body = data; }),
    send: vi.fn(),
    status: vi.fn((code: number) => { state.status = code; return res; }),
    header: vi.fn(() => res),
  } as unknown as IHttpResponse;
  await handler(req, res);
  return { state };
}

// ---------------------------------------------------------------------------
// 1. The wiring — the defect itself
// ---------------------------------------------------------------------------

describe('#8145 — a settings write reaches sys_audit_log as `config_change`', () => {
  it('the plugin WIRES the generic sink: one write, one config_change row', async () => {
    const boot = await bootPlugin({ userId: 'usr_admin', tenantId: 'org_1' });

    await boot.service.setMany('branding_test', { workspace_name: 'ObjectStack' }, boot.writeCtx);

    // RED on `origin/main`: `bindEngine`'s sink argument was `undefined`, so this
    // array is empty there and the length assertion is the one that fails.
    const rows = boot.ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(CONFIG_CHANGE_ACTION);
    expect(rows[0].action).toBe('config_change');
    expect(rows[0].object_name).toBe(CONFIG_CHANGE_OBJECT_NAME);
    // A settings row has no single id — the composite key is in `metadata`.
    expect(rows[0].record_id).toBeNull();
    // Attribution: both channels, per ADR-0014 D2.
    expect(rows[0].user_id).toBe('usr_admin');
    expect(rows[0].actor).toBe('usr_admin');
    // Tenant context — without it RLS hides the row from non-platform readers.
    expect(rows[0].tenant_id).toBe('org_1');
    // Written as the platform, on an append-only, all-`readonly` table.
    expect(boot.ledgerOpts()[0]?.context).toMatchObject({ isSystem: true });

    const meta = metaOf(rows[0]);
    expect(meta).toMatchObject({
      event: 'settings.set',
      namespace: 'branding_test',
      key: 'workspace_name',
      scope: 'global',
      encrypted: false,
      requestId: 'req_8145',
    });
    expect(JSON.parse(String(rows[0].new_value))).toMatchObject({
      namespace: 'branding_test',
      key: 'workspace_name',
      scope: 'global',
    });
  });

  it('records one row per CHANGED KEY, not one per request', async () => {
    const boot = await bootPlugin({ userId: 'usr_admin' });
    await boot.service.setMany(
      'branding_test',
      { workspace_name: 'A', api_key: SECRET },
      boot.writeCtx,
    );
    const keys = boot.ledgerRows().map((r) => metaOf(r).key).sort();
    expect(keys).toEqual(['api_key', 'workspace_name']);
  });

  it('a CLEARED key is still a config_change, with no new state described', async () => {
    const boot = await bootPlugin({ userId: 'usr_admin' });
    await boot.service.setMany('branding_test', { workspace_name: 'A' }, boot.writeCtx);
    await boot.service.setMany('branding_test', { workspace_name: null }, boot.writeCtx);

    const rows = boot.ledgerRows();
    expect(rows).toHaveLength(2);
    // The action stays `config_change` — `set` vs `reset` is a settings-shaped
    // distinction and lives in `metadata`, because the generic enum has no
    // member for it (and #8147 retired, rather than added, enum members).
    expect(rows[1].action).toBe('config_change');
    expect(metaOf(rows[1]).event).toBe('settings.reset');
    expect(rows[1].new_value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Dual-write: the settings-specific ledger is UNCHANGED
// ---------------------------------------------------------------------------

describe('#8145 — dual-write: `sys_setting_audit` keeps its rows', () => {
  it('one write leaves exactly one row on EACH ledger', async () => {
    const boot = await bootPlugin({ userId: 'usr_admin', tenantId: 'org_1' });

    await boot.service.setMany('branding_test', { workspace_name: 'ObjectStack' }, boot.writeCtx);

    // The presence half. This is a REAL row in the REAL `sys_setting_audit`
    // object, so the assertion cannot pass emptily on a fixture that never wrote
    // there — which is exactly how an "existing behaviour unchanged" pin goes
    // green for the wrong reason.
    const settingAudit = boot.settingAuditRows();
    expect(settingAudit).toHaveLength(1);
    expect(settingAudit[0]).toMatchObject({
      namespace: 'branding_test',
      key: 'workspace_name',
      scope: 'global',
      action: 'set',
      source: 'api',
      actor_id: 'usr_admin',
    });
    expect(settingAudit[0].new_hash).toBeTruthy();

    // …and the generic ledger got its own, distinct row for the same event.
    expect(boot.ledgerRows()).toHaveLength(1);
    expect(boot.ledgerRows()[0].action).toBe('config_change');

    // The two are not copies: each carries what the other's columns cannot hold.
    expect(settingAudit[0].object_name).toBeUndefined();
    expect(boot.ledgerRows()[0].new_hash).toBeUndefined();
  });

  it('the settings row itself still lands (neither ledger is in the write path)', async () => {
    const boot = await bootPlugin({ userId: 'usr_admin' });
    await boot.service.setMany('branding_test', { workspace_name: 'ObjectStack' }, boot.writeCtx);
    const rows = boot.settingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ namespace: 'branding_test', key: 'workspace_name' });
    expect(await boot.service.get('branding_test', 'workspace_name')).toMatchObject({
      value: 'ObjectStack',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. No plaintext on either ledger
// ---------------------------------------------------------------------------

describe('#8145 — an encrypted key never reaches the ledger in cleartext', () => {
  it('records a masked digest, and the secret appears nowhere in the row', async () => {
    const boot = await bootPlugin({ userId: 'usr_admin' });
    await boot.service.setMany('branding_test', { api_key: SECRET }, boot.writeCtx);

    const row = boot.ledgerRows()[0];
    expect(metaOf(row).encrypted).toBe(true);
    const digest = JSON.parse(String(row.new_value)).digest as string;
    expect(digest).toMatch(/^<encrypted:/);
    expect(digest).not.toContain(SECRET);
    // The whole row, not just the field we happen to be looking at.
    expect(JSON.stringify(row)).not.toContain(SECRET);
    // And the settings-specific ledger is clean too (pre-existing behaviour,
    // asserted here so the dual write cannot leak through the other half).
    expect(JSON.stringify(boot.settingAuditRows())).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// 4. A REFUSED write is not a successful one
// ---------------------------------------------------------------------------

/**
 * The contract line says "every successful write". A write refused before
 * anything is persisted is not one, and must therefore leave BOTH ledgers
 * untouched — otherwise `config_changes` would list configuration changes that
 * never happened, which is a worse lie than the empty view this card fixes.
 *
 * ⚠️ **Which refusal, and why not the one the card names.** #8026's fail-closed
 * `SettingsCryptoUnavailableError` was expected to be the case that matters
 * here. Measured on this tree, it is NOT reachable through the plugin's own
 * wiring at all: `SettingsServicePlugin.start()` passes
 * `cryptoProvider: this.opts.cryptoProvider ?? new LocalCryptoProvider()` and
 * `secretStore: this.buildSecretStore(engine)` — both always present — while
 * `assertEncryptionAvailable` returns early on exactly that pair. So on any
 * deployment where the settings service has an engine, every declared-encrypted
 * key CAN be encrypted and the refusal never fires; it is reachable only on an
 * engine-less service (lean kernels, control-plane mock) or one whose host binds
 * its own engine without a provider, and it is pinned there by
 * `settings-crypto-fail-closed.test.ts`.
 *
 * So the property is pinned with a refusal the plugin path really does reach —
 * the env-pinned key (`SettingsLockedError`, `409 SETTINGS_LOCKED`), raised in
 * the same pre-persist region of `setMany` — and the crypto refusal is pinned
 * one layer down, where it actually exists, in the second case.
 */
describe('#8145 — a refused write emits NO config_change row', () => {
  it('an ANONYMOUS write over the plugin\'s own routes: 403, and BOTH ledgers untouched', async () => {
    // The plugin's `verifiedContextFromRequest` fails closed with no auth
    // service resolvable (Finding-1), so this is the deny an unauthenticated
    // caller really meets on a running server — reached through the routes the
    // plugin mounted itself, no context injected.
    const boot = await bootPlugin({ userId: 'usr_admin' });
    const { state } = await put(boot.http, { workspace_name: 'never-written' });

    // Both halves of the ADR-0112 envelope — a status-only assertion could not
    // tell this refusal from any other 4xx, and "it threw" is not a pin.
    expect(state.status).toBe(403);
    expect(state.body.error.code).toBe('SETTINGS_FORBIDDEN');

    expect(boot.ledgerRows()).toHaveLength(0);
    expect(boot.settingAuditRows()).toHaveLength(0);
    expect(boot.settingRows()).toHaveLength(0);

    // ⚠️ NON-VACUITY — see the case below; the same argument applies, and the
    // authorized write there runs against this same wiring.
    await boot.service.setMany('branding_test', { workspace_name: 'ok' }, boot.writeCtx);
    expect(boot.ledgerRows()).toHaveLength(1);
  });

  it('an env-locked key: 409 SETTINGS_LOCKED, and BOTH ledgers untouched', async () => {
    const boot = await bootPlugin({
      userId: 'usr_admin',
      env: { OS_BRANDING_TEST_WORKSPACE_NAME: 'pinned-by-env' },
    });
    // The plugin's service, its plugin-built sinks — but routes mounted with an
    // AUTHORIZED context, so the refusal under test is the env lock rather than
    // the anonymous deny above. Only the identity resolution is stubbed; the
    // handler, the error mapping and both ledgers are the real ones.
    const authorized = new MockHttp();
    registerSettingsRoutes(authorized, boot.service, {
      contextFromRequest: () => ({
        enforced: true,
        userId: 'usr_admin',
        permissions: ['setup.access', 'setup.write'],
      }),
    });

    const { state } = await put(authorized, { workspace_name: 'never-written' });
    expect(state.status).toBe(409);
    expect(state.body.error.code).toBe('SETTINGS_LOCKED');

    expect(boot.ledgerRows()).toHaveLength(0);
    expect(boot.settingAuditRows()).toHaveLength(0);
    expect(boot.settingRows()).toHaveLength(0);

    // ⚠️ NON-VACUITY. Every assertion above is zero-length, and a fixture that
    // never reaches the emitter at all would satisfy each one. So the SAME
    // routes are now driven through a write that IS allowed (a different key,
    // not env-pinned): if the emitter were unreachable in this fixture, this
    // half would be zero too and the case would fail instead of passing emptily.
    const ok = await put(authorized, { api_key: SECRET });
    expect(ok.state.status).toBe(200);
    expect(boot.ledgerRows()).toHaveLength(1);
    expect(boot.ledgerRows()[0].action).toBe('config_change');
    expect(boot.settingAuditRows()).toHaveLength(1);
  });

  it('#8026 fail-closed: no config_change row where that refusal IS reachable', async () => {
    // The engine-less/host-bound shape described above: a service with nothing
    // able to encrypt, wired with the SAME two ledger writers the plugin builds
    // (imported, not re-created — a hand-copied row shape here would be pinning
    // the test's own copy of the thing under test).
    const engine = new ObjectQL();
    const { driver, rowsOf } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(SysSetting as any, OWNER_PACKAGE);
    engine.registry.registerObject(SysSettingAudit as any, OWNER_PACKAGE);

    const ledgerRows: Array<Record<string, unknown>> = [];
    const realInsert = engine.insert.bind(engine);
    (engine as any).insert = async (object: string, data: any, options?: any) => {
      if (object !== 'sys_audit_log') return realInsert(object, data, options);
      ledgerRows.push(data);
      return { ...data, id: `audit_${ledgerRows.length}` };
    };

    const svc = new SettingsService({
      env: {},
      engine: wrapEngineAsSettingsEngine(engine as any),
      // No `cryptoProvider`, no `secretStore`, and the base64 default adapter —
      // which declares no confidentiality, so the write is refused.
      crypto: new NoopCryptoAdapter(),
      audit: buildConfigChangeAuditSink(engine as any),
      auditWriter: buildSettingAuditWriter(engine as any),
      logger: { error: () => {} },
    });
    svc.registerManifest(manifest);

    const err = await svc
      .setMany('branding_test', { workspace_name: 'sibling', api_key: SECRET })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(SettingsCryptoUnavailableError);
    expect(err.code).toBe('SETTINGS_CRYPTO_UNAVAILABLE');

    // The #8026 pre-flight refuses the WHOLE batch before the write loop, so the
    // plain sibling key is neither persisted nor audited — a half-audited batch
    // would be worse than no audit at all.
    const settingAudit = () => [...rowsOf('sys_setting_audit').values()];
    expect(ledgerRows).toHaveLength(0);
    expect(settingAudit()).toHaveLength(0);
    expect([...rowsOf('sys_setting').values()]).toHaveLength(0);

    // NON-VACUITY, same argument as the case above: the refusal is scoped to the
    // secret, so a plain-only write on this same service still reaches both
    // ledgers.
    await svc.setMany('branding_test', { workspace_name: 'ok' });
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].action).toBe('config_change');
    expect(settingAudit()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Best-effort: the ledger never breaks the write
// ---------------------------------------------------------------------------

describe('#8145 — the config_change write is best-effort', () => {
  it('a failing sys_audit_log insert leaves the settings write landed and reported', async () => {
    // The shape of a deployment WITHOUT plugin-audit: the table does not exist.
    const boot = await bootPlugin({ ledgerThrows: true, userId: 'usr_admin' });

    const out = await boot.service.setMany(
      'branding_test',
      { workspace_name: 'ObjectStack' },
      boot.writeCtx,
    );

    expect(out.workspace_name.value).toBe('ObjectStack');
    expect(boot.settingRows()).toHaveLength(1);
    // The settings-specific trail is unaffected by the generic one failing.
    expect(boot.settingAuditRows()).toHaveLength(1);
    // …and the operator is told, once, with the consequence and the cause.
    const reported = boot.logged.filter((l) => l.includes('config_change audit row NOT written'));
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('plugin-audit');
  });

  it('reports ONCE per process, not once per write', async () => {
    const boot = await bootPlugin({ ledgerThrows: true, userId: 'usr_admin' });
    await boot.service.setMany('branding_test', { workspace_name: 'A' }, boot.writeCtx);
    await boot.service.setMany('branding_test', { workspace_name: 'B' }, boot.writeCtx);
    await boot.service.setMany('branding_test', { workspace_name: 'C' }, boot.writeCtx);
    expect(boot.logged.filter((l) => l.includes('config_change audit row NOT written'))).toHaveLength(1);
    // Every one of those writes still landed.
    expect(boot.settingAuditRows()).toHaveLength(3);
  });
});
