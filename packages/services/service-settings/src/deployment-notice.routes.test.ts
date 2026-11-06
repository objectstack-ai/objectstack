// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30120, ruling A3 (record 6634240777)] The deployment notice: what a
 * production deployment keeps on its own disk because nobody set it, served
 * to ADMINISTRATORS, and hidden only with a row on the audit log.
 *
 * Driven through the real `registerSettingsRoutes` with the real door
 * (`buildDeploymentNoticeDoor`) over a recording engine, so each claim is the
 * route's answer, not a helper's:
 *
 *  §1 the findings, as `readDeploymentNotice` derives them from the process,
 *     production mode only;
 *  §2 who reads it — a member is refused 403 and the door is never asked, an
 *     anonymous caller gets the family's 401, an administrator reads it;
 *  §3 the hide — an audit row on `sys_audit_log` (`config_change`, by the
 *     administrator, naming what was acknowledged), refused with nothing
 *     recorded when no ledger is mounted, and refused when the notice moved
 *     on since it was read.
 *
 * The state's absence from the public auth config is pinned end to end, on a
 * real `os start`, in `packages/cli/test/start-deployment-durability.integration.test.ts`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { registerSettingsRoutes } from './settings-routes.js';
import {
  buildDeploymentNoticeDoor,
  readDeploymentNotice,
  type DeploymentNoticeSources,
} from './deployment-notice.js';
import type { SettingsContext } from './settings-service.types.js';

const CHANNEL = 'OS_INTERNAL_DEPLOYMENT_FINDINGS';
const BASE = '/api/settings';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'os-notice-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A production process `os start` booted on its defaults. */
function productionEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    OS_HOME: home,
    [CHANNEL]: JSON.stringify({ databaseFile: '/srv/app/.objectstack/data/app.db', authSecretFile: '/srv/app/.objectstack/auth-secret' }),
    ...over,
  };
}

function sources(env: Record<string, string | undefined>, extra: Partial<DeploymentNoticeSources> = {}): DeploymentNoticeSources {
  return {
    env: () => env,
    emailDeliveryLive: () => true,
    storageAdapter: async () => 's3',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// §1 — the findings
// ---------------------------------------------------------------------------

describe('§1 the findings a production process states', () => {
  it('names the database file, the generated sign-in secret and the data key file, in that order', async () => {
    const state = await readDeploymentNotice(sources(productionEnv()));
    expect(state.production).toBe(true);
    expect(state.findings).toEqual([
      { id: 'database_local_file', severity: 'high', variable: 'OS_DATABASE_URL', file: '/srv/app/.objectstack/data/app.db' },
      { id: 'auth_secret_generated', severity: 'high', variable: 'OS_AUTH_SECRET', file: '/srv/app/.objectstack/auth-secret' },
      { id: 'data_key_file', severity: 'high', variable: 'OS_SECRET_KEY', file: join(home, 'dev-crypto-key') },
    ]);
    expect(state.fingerprint).toBe('database_local_file+auth_secret_generated+data_key_file');
  });

  it('the data key file named is the one the CLI handed the provider, when it named one', async () => {
    const state = await readDeploymentNotice(
      sources(productionEnv({ OS_INTERNAL_CRYPTO_KEY_FILE: '/srv/app/.objectstack/dev-crypto-key' })),
    );
    expect(state.findings.find((f) => f.id === 'data_key_file')?.file).toBe('/srv/app/.objectstack/dev-crypto-key');
  });

  it('a set OS_SECRET_KEY, and a boot that did not come through os start, state none of the three', async () => {
    const state = await readDeploymentNotice(
      sources(productionEnv({ [CHANNEL]: undefined, OS_SECRET_KEY: 'a'.repeat(64) })),
    );
    expect(state.findings).toEqual([]);
    expect(state.fingerprint).toBe('');
  });

  it('a channel value that does not parse states nothing from it, rather than a guess', async () => {
    const state = await readDeploymentNotice(sources(productionEnv({ [CHANNEL]: '{not json', OS_SECRET_KEY: 'a'.repeat(64) })));
    expect(state.findings).toEqual([]);
  });

  it('local file storage and an email service that does not deliver are the two lower-severity lines', async () => {
    const env = productionEnv({ [CHANNEL]: undefined, OS_SECRET_KEY: 'a'.repeat(64) });
    const local = await readDeploymentNotice(sources(env, { storageAdapter: async () => 'local', emailDeliveryLive: () => false }));
    expect(local.findings).toEqual([
      { id: 'file_storage_local', severity: 'low' },
      { id: 'email_not_configured', severity: 'low' },
    ]);
    // No email service composed at all is not a deliverable one either.
    const none = await readDeploymentNotice(sources(env, { emailDeliveryLive: () => undefined }));
    expect(none.findings.map((f) => f.id)).toEqual(['email_not_configured']);
    // CONTROL: S3 and a live transport say nothing.
    expect((await readDeploymentNotice(sources(env))).findings).toEqual([]);
  });

  it('outside production mode the notice has nothing to say, whatever the process keeps', async () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      const state = await readDeploymentNotice(
        sources(productionEnv({ NODE_ENV }), { storageAdapter: async () => 'local', emailDeliveryLive: () => false }),
      );
      expect(state).toEqual({ production: false, findings: [], fingerprint: '' });
    }
  });
});

// ---------------------------------------------------------------------------
// The routes, over the real door and a recording engine
// ---------------------------------------------------------------------------

interface Inserted { object: string; row: Record<string, any>; options: any }

function recordingEngine(opts: { ledger: boolean }) {
  const inserted: Inserted[] = [];
  const engine = {
    getSchema: (name: string) => (name === 'sys_audit_log' && opts.ledger ? { name } : undefined),
    insert: async (object: string, row: Record<string, any>, options: any) => {
      inserted.push({ object, row, options });
      return { id: `aud_${inserted.length}`, ...row };
    },
  };
  return { engine, inserted };
}

function mount(opts: {
  context: SettingsContext;
  env?: Record<string, string | undefined>;
  engine?: unknown;
}) {
  const routes = new Map<string, RouteHandler>();
  const reads: string[] = [];
  const http = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET ${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST ${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT ${p}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  const env = opts.env ?? productionEnv();
  const door = buildDeploymentNoticeDoor({
    sources: sources(env, {
      env: () => {
        reads.push('env');
        return env;
      },
    }),
    engine: () => (opts.engine ?? null) as any,
  });
  registerSettingsRoutes(http as any, {} as any, {
    basePath: BASE,
    contextFromRequest: () => opts.context,
    deploymentNotice: door,
  });
  return { routes, reads };
}

async function call(routes: Map<string, RouteHandler>, key: string, body?: unknown) {
  const handler = routes.get(key);
  if (!handler) throw new Error(`fixture: no route ${key}`);
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  const [method, path] = key.split(' ');
  await handler({ params: {}, query: {}, body, headers: {}, method, path } as unknown as IHttpRequest, res as IHttpResponse);
  return answer;
}

const ADMIN: SettingsContext = { enforced: true, userId: 'usr_admin', permissions: ['setup.access', 'manage_platform_settings'] };
/** A signed-in member, `setup.access` included: Setup is not the capability. */
const MEMBER: SettingsContext = { enforced: true, userId: 'usr_member', permissions: ['setup.access', 'setup.write'] };
const READ = `GET ${BASE}/deployment/notice`;
const HIDE = `POST ${BASE}/deployment/notice/hide`;
const FINGERPRINT = 'database_local_file+auth_secret_generated+data_key_file';

// ---------------------------------------------------------------------------
// §2 — who reads it
// ---------------------------------------------------------------------------

describe('§2 the notice is for administrators', () => {
  it('an administrator reads the findings', async () => {
    const { routes } = mount({ context: ADMIN });
    const answer = await call(routes, READ);
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.fingerprint).toBe(FINGERPRINT);
    expect(answer.body?.data?.findings.map((f: any) => f.id)).toEqual([
      'database_local_file',
      'auth_secret_generated',
      'data_key_file',
    ]);
  });

  it.each([
    ['read', READ, undefined],
    ['hide', HIDE, { fingerprint: FINGERPRINT }],
  ])('a member is refused the %s 403 PERMISSION_DENIED, and the door never reads the process', async (_n, key, body) => {
    const { engine, inserted } = recordingEngine({ ledger: true });
    const { routes, reads } = mount({ context: MEMBER, engine });
    const answer = await call(routes, key, body);
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('PERMISSION_DENIED');
    expect(answer.body?.data).toBeUndefined();
    expect(JSON.stringify(answer.body)).not.toContain('/srv/app');
    expect(reads).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it.each([
    ['read', READ, undefined],
    ['hide', HIDE, { fingerprint: FINGERPRINT }],
  ])('an anonymous caller is refused the %s with the family 401', async (_n, key, body) => {
    const { routes, reads } = mount({ context: { enforced: true } });
    const answer = await call(routes, key, body);
    expect(answer.status).toBe(401);
    expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(reads).toEqual([]);
  });

  it('a host that wires no door answers 503, never a guess', async () => {
    const routes = new Map<string, RouteHandler>();
    const http = {
      get: (p: string, h: RouteHandler) => { routes.set(`GET ${p}`, h); },
      post: (p: string, h: RouteHandler) => { routes.set(`POST ${p}`, h); },
      put: () => {}, delete: () => {}, patch: () => {}, use: () => {}, listen: async () => {}, close: async () => {},
    };
    registerSettingsRoutes(http as any, {} as any, { basePath: BASE, contextFromRequest: () => ADMIN });
    const answer = await call(routes, READ);
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// §3 — the hide
// ---------------------------------------------------------------------------

describe('§3 a hide is a row on the audit log', () => {
  it('writes one config_change row by the administrator, naming what was acknowledged', async () => {
    const { engine, inserted } = recordingEngine({ ledger: true });
    const { routes } = mount({ context: ADMIN, engine });
    const answer = await call(routes, HIDE, { fingerprint: FINGERPRINT });
    expect(answer.status).toBe(200);
    expect(answer.body?.data).toEqual({ hidden: true, fingerprint: FINGERPRINT });
    expect(inserted).toHaveLength(1);
    const [{ object, row, options }] = inserted;
    expect(object).toBe('sys_audit_log');
    expect(row).toMatchObject({
      action: 'config_change',
      user_id: 'usr_admin',
      actor: 'usr_admin',
      object_name: null,
      record_id: null,
      tenant_id: null,
    });
    expect(JSON.parse(row.metadata)).toEqual({
      event: 'deployment_notice.hide',
      fingerprint: FINGERPRINT,
      findings: ['database_local_file', 'auth_secret_generated', 'data_key_file'],
    });
    expect(JSON.parse(row.new_value)).toMatchObject({ hidden: true, fingerprint: FINGERPRINT });
    expect(options?.context?.isSystem).toBe(true);
  });

  it('is refused, with nothing recorded, where no audit log is mounted', async () => {
    const { engine, inserted } = recordingEngine({ ledger: false });
    const { routes } = mount({ context: ADMIN, engine });
    const answer = await call(routes, HIDE, { fingerprint: FINGERPRINT });
    expect(answer.status).toBe(409);
    expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(answer.body?.error?.details).toEqual({ reason: 'no_audit_log' });
    expect(inserted).toEqual([]);
  });

  it('is refused where the composition has no data engine at all', async () => {
    const { routes } = mount({ context: ADMIN });
    const answer = await call(routes, HIDE, { fingerprint: FINGERPRINT });
    expect(answer.status).toBe(409);
    expect(answer.body?.error?.details).toEqual({ reason: 'no_audit_log' });
  });

  it('is refused when the notice moved on since it was read, answering what it says now', async () => {
    const { engine, inserted } = recordingEngine({ ledger: true });
    const { routes } = mount({ context: ADMIN, engine });
    const answer = await call(routes, HIDE, { fingerprint: 'database_local_file' });
    expect(answer.status).toBe(409);
    expect(answer.body?.error?.details?.fingerprint).toBe(FINGERPRINT);
    expect(inserted).toEqual([]);
  });

  it('is refused when there is nothing to hide', async () => {
    const { engine, inserted } = recordingEngine({ ledger: true });
    const { routes } = mount({
      context: ADMIN,
      engine,
      env: productionEnv({ [CHANNEL]: undefined, OS_SECRET_KEY: 'a'.repeat(64) }),
    });
    const answer = await call(routes, HIDE, { fingerprint: FINGERPRINT });
    expect(answer.status).toBe(409);
    expect(answer.body?.error?.details?.findings).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it('names the notice it hides: a hide without a fingerprint is a 400', async () => {
    const { engine, inserted } = recordingEngine({ ledger: true });
    const { routes } = mount({ context: ADMIN, engine });
    for (const body of [undefined, {}, { fingerprint: '' }, { fingerprint: 42 }]) {
      const answer = await call(routes, HIDE, body);
      expect(answer.status).toBe(400);
      expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    }
    expect(inserted).toEqual([]);
  });

  it('a failed audit write is a fault, not a hide', async () => {
    const { engine } = recordingEngine({ ledger: true });
    engine.insert = async () => {
      throw new Error('disk full');
    };
    const { routes } = mount({ context: ADMIN, engine });
    const answer = await call(routes, HIDE, { fingerprint: FINGERPRINT });
    expect(answer.status).toBe(500);
    expect(answer.body?.data).toBeUndefined();
  });
});
