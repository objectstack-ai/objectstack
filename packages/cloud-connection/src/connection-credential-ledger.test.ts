// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31554] The shared binding credential: the ledger over a real engine, and
 * two real replica processes over one database.
 *
 * The defect: the control-plane binding credential lived in
 * `<cwd>/.objectstack/cloud-connection.json` only, so under peer round-robin
 * the bind ran on one replica and every other replica held no credential —
 * its online licence check reported no control plane, and every control-plane
 * call it made went without a bearer.
 *
 * Pinned here:
 *  - the ledger round-trips the credential through the one sealed row: written
 *    by one ledger, read by another; the bearer is never stored in plaintext;
 *    an unbind that keeps the identity leaves the file's residual shape; a
 *    replica on another crypto key, an engine with no crypto provider and a
 *    runtime with no data engine each refuse by naming the remedy, and none is
 *    read as "not bound"; a single node's file is moved into the empty row once;
 *  - two OS processes, each with its own working directory and credential
 *    file, over one SQLite database file and one crypto key: a bind on A is
 *    the bearer B presents to the control plane — through B's doors at once,
 *    and through B's synchronous `cloud-binding` service within the re-read
 *    interval; an unbind on A clears it on B; neither replica writes a
 *    credential file, the database file never holds the bearer in plaintext,
 *    and neither replica logs it.
 *
 * The single node's own regression pin (same path, bytes and mode) lives with
 * the store's harness, in `connection-credential-store.test.ts`.
 *
 * The values below are obvious dummies.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import { ConnectionCredentialStore, type StoredConnectionCredential } from './connection-credential-store.js';
import {
    CLOUD_BINDING_CREDENTIAL_OBJECT,
    CLOUD_BINDING_CREDENTIAL_SERVICE,
    SharedConnectionCredentialLedger,
    SharedCredentialUnavailableError,
    type CloudBindingCredentialReader,
} from './connection-credential-ledger.js';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { SysCloudBindingCredential } from './sys-cloud-binding-credential.object.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

const TOKEN = 'oscc_dummy_31554_aaaa';
const ROTATED = 'oscc_dummy_31554_bbbb';
const FULL: StoredConnectionCredential = {
    runtimeToken: TOKEN,
    runtimeId: 'rt_31554',
    environmentId: 'env_31554',
    controlPlaneUrl: 'http://cloud.test',
    organizationId: 'org_31554',
    accountEmail: 'ops@example.test',
    boundAt: '2026-11-08T00:00:00.000Z',
};

let dir: string;
const engines: ObjectQL[] = [];
afterEach(async () => {
    for (const e of engines.splice(0)) await e.close().catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
});

/** One database a ledger (or several) reads and writes, with the local crypto provider on `key` unless told otherwise. */
async function database(opts: { key?: Buffer | null; filename?: string } = {}) {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: opts.filename ?? ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    (ql as any).registry.registerObject(SysSecret as never, 'test');
    (ql as any).registry.registerObject(SysCloudBindingCredential as never, 'test');
    await ql.syncSchemas();
    if (opts.key !== null) ql.setCryptoProvider(new LocalCryptoProvider({ key: opts.key ?? randomBytes(32) }));
    /** The rows as the driver holds them — below the engine's read mask. */
    const raw = async (object: string) => driver.find(object, {} as never);
    return { ql, raw };
}

describe('[#31554] the shared ledger keeps the credential in one sealed row', () => {
    it('a write on one ledger is what another loads; the bearer is never stored in plaintext; clear empties it for both', async () => {
        const { ql, raw } = await database();
        const a = new SharedConnectionCredentialLedger(() => ql as never);
        const b = new SharedConnectionCredentialLedger(() => ql as never);
        expect(await a.load()).toBeNull();
        expect(a.read()).toBeNull();

        await a.write(FULL);
        expect(a.read()).toEqual(FULL);
        expect(b.read()).toBeNull(); // nothing read yet
        expect(await b.load()).toEqual(FULL);
        expect(b.read()).toEqual(FULL);

        const rows = await raw(CLOUD_BINDING_CREDENTIAL_OBJECT);
        expect(rows).toHaveLength(1);
        expect(String(rows[0]!.runtime_token)).toMatch(/^secret:/);
        expect(JSON.stringify(rows)).not.toContain(TOKEN);
        expect(JSON.stringify(await raw('sys_secret'))).not.toContain(TOKEN);

        expect(await a.clear()).toBe(true);
        expect(await b.load()).toBeNull();
        expect(await b.clear()).toBe(false);
        expect(await raw(CLOUD_BINDING_CREDENTIAL_OBJECT)).toHaveLength(0);
    });

    it('an unbind that keeps the identity leaves the residual a file keeps; a re-bind rotates the bearer on the same row', async () => {
        const { ql, raw } = await database();
        const a = new SharedConnectionCredentialLedger(() => ql as never);
        const b = new SharedConnectionCredentialLedger(() => ql as never);
        await a.write(FULL);
        await a.write({ runtimeToken: '', runtimeId: 'rt_31554' });
        expect(await b.load()).toEqual({ runtimeToken: '', runtimeId: 'rt_31554' });
        expect(String((await raw(CLOUD_BINDING_CREDENTIAL_OBJECT))[0]!.runtime_token ?? '')).toBe('');

        await b.write({ ...FULL, runtimeToken: ROTATED });
        expect((await a.load())?.runtimeToken).toBe(ROTATED);
        expect(await raw(CLOUD_BINDING_CREDENTIAL_OBJECT)).toHaveLength(1);
    });

    it('a replica on another crypto key refuses to read the row, names the remedy, keeps its last copy and never shows the bearer', async () => {
        const { ql } = await database();
        const a = new SharedConnectionCredentialLedger(() => ql as never);
        const b = new SharedConnectionCredentialLedger(() => ql as never);
        await a.write(FULL);
        ql.setCryptoProvider(new LocalCryptoProvider({ key: randomBytes(32) }));
        const err = await b.load().then(() => undefined, (e: unknown) => e);
        expect(err).toBeInstanceOf(SharedCredentialUnavailableError);
        expect(String((err as Error).message)).toContain('OS_SECRET_KEY');
        expect(String((err as Error).message)).not.toContain(TOKEN);
        expect(b.read()).toBeNull(); // not "unbound by a read" — never read
    });

    it('with no crypto provider the write is refused before anything is stored, naming the remedy', async () => {
        const { ql, raw } = await database({ key: null });
        const ledger = new SharedConnectionCredentialLedger(() => ql as never);
        const err = await ledger.write(FULL).then(() => undefined, (e: unknown) => e);
        expect(err).toBeInstanceOf(SharedCredentialUnavailableError);
        expect(String((err as Error).message)).toMatch(/crypto provider/);
        expect(String((err as Error).message)).not.toContain(TOKEN);
        expect(await raw(CLOUD_BINDING_CREDENTIAL_OBJECT)).toHaveLength(0);
        expect(ledger.read()).toBeNull();
    });

    it('with no data engine every verb refuses by naming the shared store, and none reads as unbound', async () => {
        const ledger = new SharedConnectionCredentialLedger(() => undefined);
        for (const run of [() => ledger.load(), () => ledger.write(FULL), () => ledger.clear()]) {
            const err = await run().then(() => undefined, (e: unknown) => e);
            expect(err).toBeInstanceOf(SharedCredentialUnavailableError);
            expect(String((err as Error).message)).toContain('shared database');
        }
    });

    it("moves a single node's file into the empty row once, and never over a row a replica already wrote", async () => {
        dir = mkdtempSync(join(tmpdir(), 'ccl-'));
        const { ql } = await database();
        const file = new ConnectionCredentialStore(join(dir, 'cc.json'));
        const ledger = new SharedConnectionCredentialLedger(() => ql as never);
        expect(await ledger.adoptFrom(file)).toBe(false); // nothing in the file
        file.write(FULL);
        expect(await ledger.adoptFrom(file)).toBe(true);
        expect(await new SharedConnectionCredentialLedger(() => ql as never).load()).toEqual(FULL);
        expect(existsSync(file.path)).toBe(true); // left in place, not read again

        file.write({ ...FULL, runtimeToken: ROTATED });
        expect(await ledger.adoptFrom(file)).toBe(false);
        expect((await ledger.load())?.runtimeToken).toBe(TOKEN);
    });
});

/** A plugin context with the services given, recording registrations, hooks and log lines. */
function pluginContext(services: Record<string, unknown>) {
    const registered = new Map<string, unknown>(Object.entries(services));
    const hooks = new Map<string, Array<() => Promise<void>>>();
    const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => { hooks.set(e, [...(hooks.get(e) ?? []), h]); },
        getService: (name: string) => {
            if (!registered.has(name)) throw new Error(`no ${name}`);
            return registered.get(name);
        },
        registerService: (name: string, svc: unknown) => { registered.set(name, svc); },
        logger: {
            info: (m: string) => { logs.info.push(m); },
            warn: (m: string) => { logs.warn.push(m); },
            error: (m: string) => { logs.error.push(m); },
        },
    };
    const fire = async (event: string) => { for (const h of hooks.get(event) ?? []) await h(); };
    return { ctx, registered, logs, fire };
}

describe('[#31554] the plugin chooses the shared row only for declared replicas over a remote driver', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it("registers the object, says so once, and moves a single node's file into the row before the first door", async () => {
        vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
        dir = mkdtempSync(join(tmpdir(), 'ccl-plugin-'));
        const credPath = join(dir, 'cc.json');
        new ConnectionCredentialStore(credPath).write(FULL); // bound while it was one node
        const { ql } = await database();
        const register = vi.fn();
        const { ctx, registered, logs, fire } = pluginContext({ manifest: { register }, cluster: { driver: 'redis', nodeId: 'n1' }, objectql: ql });
        const plugin = new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', credentialPath: credPath });
        await plugin.init(ctx as never);
        expect(register).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'sys', objects: [SysCloudBindingCredential] }));
        expect(logs.info.filter((m) => m.includes('sys_cloud_binding_credential'))).toHaveLength(1);
        const reader = registered.get(CLOUD_BINDING_CREDENTIAL_SERVICE) as CloudBindingCredentialReader;
        expect(reader.shared).toBe(true);
        expect(reader.read()).toBeNull(); // nothing read before kernel:ready

        await plugin.start(ctx as never);
        await fire('kernel:ready');
        expect(reader.read()).toEqual(FULL);
        expect((registered.get('cloud-binding') as { credential(): string }).credential()).toBe(TOKEN);
        expect(await new SharedConnectionCredentialLedger(() => ql as never).load()).toEqual(FULL);
        expect(logs.info.some((m) => m.includes(`moved the cloud binding credential from ${credPath}`))).toBe(true);
        expect([...logs.info, ...logs.warn, ...logs.error].join('\n')).not.toContain(TOKEN);
        await fire('kernel:shutdown');
        await plugin.destroy();
    });

    it('with no manifest service to register the object, reports the split at error with its consequence and fix, and keeps the file', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        dir = mkdtempSync(join(tmpdir(), 'ccl-plugin-'));
        const { ctx, registered, logs } = pluginContext({ cluster: { driver: 'redis', nodeId: 'n1' } });
        const plugin = new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', credentialPath: join(dir, 'cc.json') });
        await plugin.init(ctx as never);
        expect((registered.get(CLOUD_BINDING_CREDENTIAL_SERVICE) as CloudBindingCredentialReader).shared).toBe(false);
        expect(logs.error).toHaveLength(1);
        expect(logs.error[0]).toContain('a bind made on one replica is not seen by the others');
        expect(logs.error[0]).toContain('Compose the data engine');
    });
});

// ── two replica processes ───────────────────────────────────────────────

/**
 * One replica: a real Node process with its OWN credential file, booting
 * `CloudConnectionPlugin` (this checkout's source, through tsx) over a real
 * ObjectQL engine on the shared SQLite file, the local crypto provider on the
 * shared key, `OS_CLUSTER_REPLICAS=2` and a cluster service whose driver is
 * remote. It answers commands over IPC by calling the plugin's own doors and
 * its `cloud-binding` service.
 */
const REPLICA_SCRIPT = [
    'const [pluginUrl, objectUrl, testkitUrl, dbPath, credPath, keyHex, cpUrl, nodeId, refreshMs] = process.argv.slice(1);',
    'const { ObjectQL } = await import("@objectstack/objectql");',
    'const { SqlDriver } = await import("@objectstack/driver-sql");',
    'const { SysSecret } = await import("@objectstack/platform-objects");',
    'const { LocalCryptoProvider } = await import("@objectstack/service-settings");',
    'const { CloudConnectionPlugin } = await import(pluginUrl);',
    'const { SysCloudBindingCredential } = await import(objectUrl);',
    'const { bindCatalogFromTables } = await import(testkitUrl);',
    'const ql = new ObjectQL();',
    'const driver = new SqlDriver({ client: "better-sqlite3", connection: { filename: dbPath }, useNullAsDefault: true });',
    'await driver.connect();',
    'ql.registerDriver(driver, true);',
    'await ql.init();',
    'ql.registry.registerObject(SysSecret, "test");',
    'ql.registry.registerObject(SysCloudBindingCredential, "test");',
    'await ql.syncSchemas();',
    'ql.setCryptoProvider(new LocalCryptoProvider({ key: Buffer.from(keyHex, "hex") }));',
    'const GRANTS = {',
    '  sys_user_permission_set: [{ id: "ups_1", user_id: "admin", permission_set_id: "ps_1", permission_set: "platform_admin", organization_id: "o1" }],',
    '  sys_permission_set: [{ id: "ps_1", name: "platform_admin", system_permissions: ["setup.access", "manage_platform_settings"] }],',
    '};',
    'const engine = bindCatalogFromTables({',
    '  find: (o, q) => (o === "sys_cloud_binding_credential" ? ql.find(o, q) : Promise.resolve(GRANTS[o] ?? [])),',
    '  insert: (o, d, x) => ql.insert(o, d, x),',
    '  update: (o, d, x) => ql.update(o, d, x),',
    '  delete: (o, x) => ql.delete(o, x),',
    '  resolveSecretField: (o, id, f) => ql.resolveSecretField(o, id, f),',
    '}, GRANTS);',
    'const routes = new Map();',
    'const hooks = new Map();',
    'const logs = [];',
    'const services = new Map(Object.entries({',
    '  objectql: engine,',
    '  protocol: { getDiscovery: async () => ({ version: "release-31554" }) },',
    '  auth: { api: { getSession: async () => ({ user: { id: "admin" }, session: { activeOrganizationId: "o1" } }) } },',
    '  manifest: { register() {} },',
    '  cluster: { driver: "redis", nodeId },',
    '  "http-server": { getRawApp: () => ({ get: (p, h) => routes.set("GET " + p, h), post: (p, h) => routes.set("POST " + p, h) }) },',
    '}));',
    'const ctx = {',
    '  hook: (e, h) => { if (!hooks.has(e)) hooks.set(e, []); hooks.get(e).push(h); },',
    '  getService: (n) => { if (!services.has(n)) throw new Error("no " + n); return services.get(n); },',
    '  registerService: (n, s) => services.set(n, s),',
    '  logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m, e) => logs.push(String(m) + " " + String(e?.message ?? "")) },',
    '};',
    'const plugin = new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: cpUrl, credentialPath: credPath, sharedCredentialRefreshMs: Number(refreshMs) });',
    'await plugin.init(ctx);',
    'await plugin.start(ctx);',
    'for (const h of hooks.get("kernel:ready") ?? []) await h();',
    'const door = (method, path, body) => {',
    '  const url = "http://replica.test" + path;',
    '  const c = { req: { url, raw: new Request(url), json: async () => body ?? {} }, json: (payload, status) => ({ payload, status: status ?? 200 }) };',
    '  return routes.get(method + " " + path)(c);',
    '};',
    'const commands = {',
    '  credential: async () => services.get("cloud-binding").credential(),',
    '  status: async () => (await door("GET", "/api/v1/cloud-connection/status")).payload,',
    '  bind: async () => (await door("POST", "/api/v1/cloud-connection/bind/poll", { device_code: "dc" })).payload,',
    '  unbind: async () => (await door("POST", "/api/v1/cloud-connection/unbind")).payload,',
    '  orgPackages: async () => (await door("GET", "/api/v1/cloud-connection/org-packages")).payload,',
    '  logs: async () => logs,',
    '  exit: async () => { for (const h of hooks.get("kernel:shutdown") ?? []) await h(); await plugin.destroy(); await ql.close(); setTimeout(() => process.exit(0), 0); return true; },',
    '};',
    'process.on("message", async (m) => {',
    '  try { process.send({ id: m.id, result: await commands[m.cmd]() }); }',
    '  catch (e) { process.send({ id: m.id, error: String(e?.stack ?? e) }); }',
    '});',
    'process.send({ ready: true });',
].join('\n');

interface Replica {
    send<T = any>(cmd: string): Promise<T>;
    child: ChildProcess;
    stderr: () => string;
}

const children: ChildProcess[] = [];
const servers: Server[] = [];
afterEach(async () => {
    for (const c of children.splice(0)) if (c.exitCode === null) c.kill('SIGKILL');
    for (const s of servers.splice(0)) await new Promise<void>((done) => s.close(() => done()));
});

function startReplica(args: { db: string; credPath: string; key: Buffer; cpUrl: string; nodeId: string }): Promise<Replica> {
    const child = spawn(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e', REPLICA_SCRIPT,
        pathToFileURL(join(HERE, 'cloud-connection-plugin.ts')).href,
        pathToFileURL(join(HERE, 'sys-cloud-binding-credential.object.ts')).href,
        pathToFileURL(join(HERE, '__tests__', 'security-catalog.testkit.ts')).href,
        args.db, args.credPath, args.key.toString('hex'), args.cpUrl, args.nodeId, '150',
    ], {
        cwd: PKG,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
            PATH: process.env.PATH ?? '',
            HOME: dir,
            ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
            OS_CLUSTER_REPLICAS: '2',
            OS_REGISTRY_LOG: 'warn',
            OS_LOG_LEVEL: 'warn',
        },
    });
    children.push(child);
    let stderr = '';
    child.stderr!.on('data', (d) => { stderr += String(d); });
    child.stdout!.on('data', () => { /* drained */ });
    let next = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    return new Promise<Replica>((ready, fail) => {
        const timer = setTimeout(() => fail(new Error(`replica ${args.nodeId} did not boot: ${stderr}`)), 60_000);
        child.on('exit', (code) => {
            clearTimeout(timer);
            for (const p of pending.values()) p.reject(new Error(`replica ${args.nodeId} exited ${code}: ${stderr}`));
            fail(new Error(`replica ${args.nodeId} exited ${code}: ${stderr}`));
        });
        child.on('message', (m: any) => {
            if (m?.ready) {
                clearTimeout(timer);
                ready({
                    child,
                    stderr: () => stderr,
                    send: (cmd) => new Promise((resolveCmd, rejectCmd) => {
                        const id = ++next;
                        pending.set(id, { resolve: resolveCmd, reject: rejectCmd });
                        child.send({ id, cmd });
                    }),
                });
                return;
            }
            const p = pending.get(m?.id);
            if (!p) return;
            pending.delete(m.id);
            if (m.error) p.reject(new Error(m.error));
            else p.resolve(m.result);
        });
    });
}

/** A control plane that mints {@link TOKEN} at bind and records the bearer each request presents. */
async function controlPlane(): Promise<{ url: string; seen: Array<{ path: string; authorization?: string }> }> {
    const seen: Array<{ path: string; authorization?: string }> = [];
    const body = (req: IncomingMessage) => new Promise<void>((done) => { req.resume(); req.on('end', () => done()); });
    const server = createServer(async (req, res) => {
        await body(req);
        const path = (req.url ?? '').split('?')[0]!;
        seen.push({ path, authorization: req.headers.authorization });
        const json = (status: number, payload: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
        if (path === '/api/v1/auth/device/token') return json(200, { access_token: 'op-token' });
        if (path === '/api/v1/cloud-connection/bind') {
            return json(200, { success: true, data: {
                bound: true, runtime_id: 'rt_31554', runtime_token: TOKEN,
                connection: { organization_id: 'org_31554', account_email: 'ops@example.test', bound_at: '2026-11-08T00:00:00.000Z' },
            } });
        }
        if (path === '/api/v1/cloud-connection/revoke') return json(200, { success: true });
        if (path === '/api/v1/cloud/org-packages') return json(200, { success: true, data: { items: [{ id: 'pkg_1' }] } });
        // Status answers nothing usable, so each replica reports the binding it holds.
        return json(503, { success: false });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const address = server.address() as { port: number };
    return { url: `http://127.0.0.1:${address.port}`, seen };
}

async function eventually<T>(read: () => Promise<T>, accept: (v: T) => boolean, ms = 10_000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
        const v = await read();
        if (accept(v) || Date.now() > until) return v;
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('[#31554] two replica processes over one database share the binding', () => {
    it('⭐ a bind on A is the bearer B presents; an unbind on A clears it on B; no file, no plaintext, no log line', async () => {
        dir = mkdtempSync(join(tmpdir(), 'ccl-2p-'));
        const db = join(dir, 'shared.sqlite');
        const key = randomBytes(32);
        const cp = await controlPlane();
        const credA = join(dir, 'a', 'cloud-connection.json');
        const credB = join(dir, 'b', 'cloud-connection.json');
        // A boots first and creates the tables; B boots over them.
        const a = await startReplica({ db, credPath: credA, key, cpUrl: cp.url, nodeId: 'node-a' });
        const b = await startReplica({ db, credPath: credB, key, cpUrl: cp.url, nodeId: 'node-b' });

        expect(await b.send('credential')).toBe('');
        expect((await b.send('status')).data.bound).toBe(false);

        // Bind on A. The browser never sees the bearer.
        const bound = await a.send('bind');
        expect(bound.success).toBe(true);
        expect(JSON.stringify(bound)).not.toContain(TOKEN);

        // B's synchronous service converges by its re-read alone — no door called on B yet.
        expect(await eventually(() => b.send<string>('credential'), (v) => v === TOKEN)).toBe(TOKEN);
        // B's door presents the bearer A bound.
        const before = cp.seen.length;
        const listed = await b.send('orgPackages');
        expect(listed.data).toEqual({ items: [{ id: 'pkg_1' }], total: 1, connected: true });
        expect(cp.seen.slice(before)).toEqual([{ path: '/api/v1/cloud/org-packages', authorization: `Bearer ${TOKEN}` }]);
        expect((await b.send('status')).data).toMatchObject({ bound: true, runtimeId: 'rt_31554' });

        // Neither replica wrote a credential file; the database never holds the bearer in plaintext.
        expect(existsSync(credA)).toBe(false);
        expect(existsSync(credB)).toBe(false);
        expect(readFileSync(db).includes(Buffer.from(TOKEN))).toBe(false);

        // Unbind on A: revoked with the bearer, cleared for every replica.
        const unbound = await a.send('unbind');
        expect(unbound.data).toMatchObject({ revoked: true, cleared: true });
        const afterUnbind = cp.seen.length;
        const empty = await b.send('orgPackages');
        expect(empty.data).toEqual({ items: [], total: 0, connected: false });
        expect(cp.seen.length).toBe(afterUnbind); // B no longer reaches the control plane with a bearer
        // The identity survives the unbind, as the file's residual does.
        expect((await b.send('status')).data).toMatchObject({ bound: false, runtimeId: 'rt_31554' });
        expect(await b.send('credential')).toBe('');

        for (const r of [a, b]) {
            const logs: string[] = await r.send('logs');
            expect(logs.join('\n')).not.toContain(TOKEN);
            expect(r.stderr()).not.toContain(TOKEN);
        }
        await Promise.all([a.send('exit'), b.send('exit')]);
    }, 120_000);
});
