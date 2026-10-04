// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's `handler` name resolves inside the hook's own package only, end to
 * end in a composed kernel, on the doors that bind a hook by name:
 *
 *   ① a multi-app composition — app Y's hook names `x_stamp`, a function app X
 *     registered. It is refused at registration (`INVALID_REFERENCE`, 400) and
 *     X's code never runs on Y's events. This is the cross-package binding
 *     measured through the public door before the change: Y's insert came back
 *     stamped by X's function.
 *   ② the metadata door — a hook authored at runtime through
 *     `PUT /api/v1/meta/hook/:name` that names `x_stamp` and carries no `body`
 *     is refused AT THE DOOR (#21658): `VALIDATION_ERROR` / 400, naming the
 *     hook and prescribing a `body`, with nothing stored and nothing bound. A
 *     runtime-authored hook ships with no code package and holds no functions,
 *     so the name could only ever be refused again at bind (the binder's
 *     `metadata-service` refusal, pinned in objectql's
 *     `hook-binder-package-scope.test.ts`).
 *
 * Controls, the two shapes a package's own function takes: app X's hook naming
 * X's own `functions` entry binds and runs, and app Z's hook naming a function
 * its `--artifact` runtime module exports (loaded through `loadArtifactBundle`,
 * the artifact door's loader) binds and runs — a built artifact's `handler`
 * hook through its own door, which the save-door refusal leaves unchanged. A
 * body hook authored through the metadata door saves, binds and runs, which is
 * also the witness that the door's re-sync has happened; so does one carrying
 * both a `body` and a `handler`, whose body is what runs.
 *
 * Every observation is a neutral marker appended to a free-text `status`
 * column. The binder's code and status are read off the engine's own logger,
 * where it records each coded registration refusal at `error`; the door's are
 * read off the HTTP answer.
 *
 * Composition: the in-process kernel `@objectstack/verify`'s `bootStack`
 * mirrors (engine, sqlite-wasm default datasource, HTTP server, the apps,
 * platform objects, auth, security, sharing, REST, dispatcher), requests
 * injected through the HTTP app as the signed-in administrator. The boot is
 * paid in `beforeAll`, never inside a case.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { loadArtifactBundle } from './load-artifact-bundle.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

const X_NOTE = 'scope_x_note';
const Y_NOTE = 'scope_y_note';
const Z_NOTE = 'scope_z_note';

const noteObject = (name: string) => ({
  name,
  label: name,
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status' },
  },
});

/** Append `token` to the `status` of the row being written (a code handler's view of the input). */
function appendStatus(ctx: any, token: string): void {
  const d = ctx && ctx.input && ctx.input.data ? ctx.input.data : ctx.input;
  d.status = (typeof d.status === 'string' ? d.status : '') + `|${token}`;
}

const X_APP: any = {
  manifest: { id: 'com.pin.scope.x', name: 'Scope X', version: '1.0.0' },
  objects: [noteObject(X_NOTE)],
  functions: { x_stamp: async (ctx: any) => appendStatus(ctx, 'x-fn') },
  hooks: [{ name: 'scope_x_own', object: X_NOTE, events: ['beforeInsert'], handler: 'x_stamp' }],
};

const Y_APP: any = {
  manifest: { id: 'com.pin.scope.y', name: 'Scope Y', version: '1.0.0' },
  objects: [noteObject(Y_NOTE)],
  hooks: [{ name: 'scope_y_cross', object: Y_NOTE, events: ['beforeInsert'], handler: 'x_stamp' }],
};

/** App Z ships as an `--artifact`: its hook names a function only its runtime module carries. */
const Z_ARTIFACT = {
  manifest: { id: 'com.pin.scope.z', name: 'Scope Z', version: '1.0.0' },
  objects: [noteObject(Z_NOTE)],
  hooks: [{ name: 'scope_z_own', object: Z_NOTE, events: ['beforeInsert'], handler: 'z_stamp' }],
  runtimeModule: './runtime.mjs',
};
const Z_RUNTIME_MODULE =
  'export const functions = {\n'
  + '  z_stamp: async (ctx) => {\n'
  + '    const d = ctx && ctx.input && ctx.input.data ? ctx.input.data : ctx.input;\n'
  + "    d.status = (typeof d.status === 'string' ? d.status : '') + '|z-fn';\n"
  + '  },\n'
  + '};\n';

const js = (source: string) => ({ language: 'js', source, capabilities: [], timeoutMs: 5000 });

/** The engine's logger: quiet, and read back for the binder's coded refusals. */
const engineLogger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let kernel: any;
let httpServer: any;
let app: any;
let adminToken: string;
let artifactDir: string;
let prevNodeEnv: string | undefined;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const asAdmin = (method: string, path: string, body?: unknown) =>
  req(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function engine(): Promise<any> {
  return kernel.getServiceAsync('objectql');
}

/** Insert one row in-process and read back its `status` — what every hook that fired appended. */
async function insertAndReadStatus(object: string, title: string): Promise<string> {
  const ql = await engine();
  await ql.insert(object, { title, status: '' }, { context: { isSystem: true } });
  const rows: any[] = await ql.find(object, { where: { title }, fields: ['id', 'status'], context: { isSystem: true } });
  return rows.map((r) => String(r?.status ?? '')).join(',');
}

/** The binder's coded refusals of `hook`, as the engine logged them. */
function refusalsOf(hook: string): any[][] {
  return engineLogger.error.mock.calls.filter((call: any[]) => call[2]?.hook === hook);
}

async function waitFor(predicate: () => Promise<boolean>, ms = 15_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it

  artifactDir = mkdtempSync(join(tmpdir(), 'hook-scope-artifact-'));
  const artifactPath = join(artifactDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(Z_ARTIFACT, null, 2), 'utf8');
  writeFileSync(join(artifactDir, 'runtime.mjs'), Z_RUNTIME_MODULE, 'utf8');
  const zBundle = await loadArtifactBundle(artifactPath);
  if (!zBundle) throw new Error('pin setup: the Z artifact did not load');

  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin({ ql: new ObjectQL({ logger: engineLogger }) }));
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(X_APP));
  await kernel.use(new AppPlugin(Y_APP));
  await kernel.use(new AppPlugin(zBundle));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'hook-handler-package-scope-secret', autoDefaultOrganization: false }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(X_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status}`);
  adminToken = (await res.json()).token;
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  try { rmSync(artifactDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('a hook handler name resolves inside its own package only — composed kernel', () => {
  it('① multi-app composition: app Y\'s hook naming app X\'s function is refused and X\'s code never runs on Y\'s events', async () => {
    const status = await insertAndReadStatus(Y_NOTE, 'y-cross-probe');
    expect(status, "app X's function ran on app Y's event").not.toContain('x-fn');

    const refusals = refusalsOf('scope_y_cross');
    expect(refusals.length, 'no coded refusal was recorded for the cross-package hook').toBeGreaterThan(0);
    expect(refusals[0][1]).toBeInstanceOf(Error);
    expect(refusals[0][2]).toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 400,
      handler: 'x_stamp',
      packageId: 'app:com.pin.scope.y',
    });
  });

  // A built artifact's `handler` hook through its own door: unchanged by the
  // metadata door's refusal in ② (#21658), which no artifact or boot door reaches.
  it('control: app X\'s hook naming X\'s own `functions` entry binds and runs', async () => {
    expect(await insertAndReadStatus(X_NOTE, 'x-own-probe')).toContain('x-fn');
    expect(refusalsOf('scope_x_own')).toEqual([]);
  });

  it('control: app Z\'s hook naming a function its --artifact runtime module exports binds and runs', async () => {
    expect(await insertAndReadStatus(Z_NOTE, 'z-own-probe')).toContain('z-fn');
    expect(refusalsOf('scope_z_own')).toEqual([]);
  });

  it('② the metadata door refuses a runtime-authored hook that names a function and carries no `body`: VALIDATION_ERROR / 400, nothing stored', async () => {
    const crossHook = await asAdmin('PUT', '/meta/hook/scope_authored_cross', {
      name: 'scope_authored_cross',
      object: Y_NOTE,
      events: ['beforeInsert'],
      handler: 'x_stamp',
    });
    // The `/meta` save door's error body: `{ error: <message>, code }`.
    const refusal: any = await crossHook.json();
    expect({ status: crossHook.status, code: refusal?.code }, JSON.stringify(refusal))
      .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    // The named subject and the prescription: the hook, the function its
    // `handler` names, and the `body` that would run.
    expect(refusal.error).toContain("'scope_authored_cross'");
    expect(refusal.error).toContain("'x_stamp'");
    expect(refusal.error).toContain('Give it a `body`');
    // Nothing stored: the by-name read finds no row.
    const stored = await asAdmin('GET', '/meta/hook/scope_authored_cross');
    expect(stored.status, await stored.text()).toBe(404);
  });

  it('②b a body hook authored through the metadata door saves, binds and runs; so does one carrying both a `body` and a `handler`', async () => {
    const bodyHook = await asAdmin('PUT', '/meta/hook/scope_authored_body', {
      name: 'scope_authored_body',
      object: Y_NOTE,
      events: ['beforeInsert'],
      body: js("ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + '|authored-body';"),
    });
    expect(bodyHook.status, await bodyHook.text()).toBeLessThan(300);
    // A `body` beside a `handler` saves: the binder runs the body and never consults the name.
    const bothHook = await asAdmin('PUT', '/meta/hook/scope_authored_both', {
      name: 'scope_authored_both',
      object: Y_NOTE,
      events: ['beforeInsert'],
      handler: 'x_stamp',
      body: js("ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + '|authored-both';"),
    });
    expect(bothHook.status, await bothHook.text()).toBeLessThan(300);

    // The door's re-sync has bound both authored body hooks once they fire…
    let lastStatus = '';
    let probe = 0;
    const bound = await waitFor(async () => {
      lastStatus = await insertAndReadStatus(Y_NOTE, `authored-probe-${probe++}`);
      return lastStatus.includes('authored-body') && lastStatus.includes('authored-both');
    });
    expect(bound, `the runtime-authored body hooks never both bound (last status: ${lastStatus})`).toBe(true);
    // …and nothing named `x_stamp` ran on the same insert.
    expect(lastStatus, "a runtime-authored hook ran app X's function").not.toContain('x-fn');
    expect(refusalsOf('scope_authored_both')).toEqual([]);
  }, 30_000);

  it('② nothing bound: once the re-sync has run (②b), the refused hook never reached the binder', async () => {
    // There was no row for the re-sync to bind, so the binder recorded no
    // refusal of it either: the door refused it before anything was stored.
    expect(refusalsOf('scope_authored_cross')).toEqual([]);
  });
});
