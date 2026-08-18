// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve`'s unknown-environment hostname guard (#9442).
 *
 * ## Why this file exists
 *
 * The guard used to be a plugin object literal built inside `Serve.run()`,
 * closing over four locals and installing itself on a `http.server` service
 * resolved from the plugin context. Nothing about it was exported or
 * constructible, so reaching ANY of it meant booting a real `os serve` — and
 * measured, with a control query that proves the search worked, no test in
 * `packages/cli` mentioned it:
 *
 *     $ grep -rln "unknown-hostname-guard\|OS_ROOT_DOMAIN" --include=*.ts packages/cli/src/
 *     packages/cli/src/commands/serve.ts            # the source, no test
 *     $ grep -rln "resolveTenancyPostureOrRefusal" --include=*.ts packages/cli/src/   # control
 *     packages/cli/src/commands/serve-tenancy-posture-gate.test.ts
 *     packages/cli/src/commands/doctor.ts
 *     packages/cli/src/commands/serve.ts
 *
 * #9442 extracted the SEAM — `createUnknownHostnameGuardPlugin()`, exported the
 * way this file's sibling helpers are — without changing what the guard
 * refuses, when, or what it answers. These tests are that extraction's whole
 * point, and they run the REAL middleware on a REAL Hono app (the same
 * `HonoHttpServer` production resolves as `http.server`), never a mock of it.
 *
 * ## What is pinned, and why BOTH directions
 *
 * The guard's value is that it refuses an unmapped hostname. Its DANGER is
 * refusing one it must not: the source says so in as many words —
 * "Returning 404 here on an unmapped hostname would kill the container",
 * because Cloudflare's container probe hits whatever `Host` is bound to the
 * worker. A suite that only asserted the refusal would stay green if the
 * middleware started refusing EVERYTHING, and would have declared that
 * container-killer safe.
 *
 * So every bypass in the matrix is pinned as a PASS-THROUGH (an explicit 200
 * from a sentinel route mounted after the guard, never merely "not a 404" —
 * Hono's own unmatched answer is a 404 too and would read as a refusal), and
 * the refusal is pinned by `error.code` AND HTTP status together. Either alone
 * is satisfied by a body that is wrong in the other half.
 *
 * The reserved-subdomain list and the health-path list are iterated from the
 * exported constants the middleware itself branches on, so a subdomain or a
 * probe path added to the guard is covered the moment it is added rather than
 * the day someone remembers to copy it here.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import {
  createUnknownHostnameGuardPlugin,
  UNKNOWN_HOSTNAME_GUARD_HEALTH_PATHS,
  UNKNOWN_HOSTNAME_GUARD_RESERVED_SUBDOMAINS,
} from './serve.js';

const ROOT_DOMAIN = 'objectos.ai';

/** What the sentinel route answers when the guard let a request through. */
const PASSED_THROUGH = 'PASSED_THROUGH';

interface Harness {
  /** Drive one request through the mounted middleware. */
  call(path: string, host: string, headers?: Record<string, string>): Promise<Response>;
  warnings: string[];
  infos: string[];
  /** Hostnames the fake env-registry was asked about, in order. */
  asked: string[];
}

/**
 * Mount the real guard on a real Hono app, exactly the way `init()` does in
 * production: resolve `http.server`, take its raw app, install the middleware.
 *
 * The sentinel catch-all is registered AFTER the guard, which is also
 * production's order — the guard installs during `init()`, route-registering
 * plugins during `start()`.
 */
function mountGuard(opts: {
  rootDomain?: string;
  cloudUrl?: string;
  /** Hostnames the env-registry resolves. Absent ⇒ registry service missing. */
  knownHosts?: string[];
  /** Replace the env-registry with something broken, to pin the fall-throughs. */
  registryOverride?: unknown;
  /** Force the `http.server` resolution to fail the way production tolerates. */
  httpServer?: 'missing' | 'no-raw-app' | 'throws';
} = {}): Promise<Harness> {
  const server = new HonoHttpServer(0);
  const rawApp = server.getRawApp();
  const warnings: string[] = [];
  const infos: string[] = [];
  const asked: string[] = [];

  const registry = opts.registryOverride !== undefined
    ? opts.registryOverride
    : opts.knownHosts
      ? {
        resolveByHostname: async (host: string) => {
          asked.push(host);
          return opts.knownHosts?.includes(host) ? { id: 'env_1', hostname: host } : null;
        },
      }
      : null;

  const services: Record<string, unknown> = {
    'http.server': opts.httpServer === 'missing'
      ? undefined
      : opts.httpServer === 'no-raw-app'
        ? { getRawApp: () => ({}) }
        : { getRawApp: () => rawApp },
    'env-registry': registry ?? undefined,
  };

  const ctx = {
    getService: (name: string) => {
      if (opts.httpServer === 'throws') throw new Error('service registry exploded');
      return services[name];
    },
    logger: {
      warn: (msg: string) => { warnings.push(msg); },
      info: (msg: string) => { infos.push(msg); },
    },
  };

  const plugin = createUnknownHostnameGuardPlugin({
    rootDomain: opts.rootDomain ?? ROOT_DOMAIN,
    readCloudUrl: () => opts.cloudUrl ?? '',
  });

  return plugin.init(ctx).then(() => {
    rawApp.all('*', (c: { text: (body: string, status: number) => Response }) =>
      c.text(PASSED_THROUGH, 200));
    return {
      warnings,
      infos,
      asked,
      call: (path: string, host: string, headers: Record<string, string> = {}) =>
        rawApp.fetch(new Request(`http://placeholder${path}`, { headers: { host, ...headers } })),
    };
  });
}

/** The refusal body, as `ApiErrorSchema` declares it. */
interface RefusalBody {
  success?: boolean;
  error?: { code?: string; message?: string; details?: { hostname?: string } };
}

describe('createUnknownHostnameGuardPlugin — the refusal', () => {
  it('refuses an unmapped platform hostname with ENVIRONMENT_NOT_FOUND and 404', async () => {
    const h = await mountGuard({ knownHosts: ['acme.objectos.ai'] });

    const res = await h.call('/api/v1/objects', 'nobody.objectos.ai', { accept: 'application/json' });

    // Both halves, together: a body with the right code under the wrong status
    // and a 404 carrying the wrong code each satisfy exactly one of these.
    expect(res.status).toBe(404);
    const body = await res.json() as RefusalBody;
    expect(body.error?.code).toBe('ENVIRONMENT_NOT_FOUND');

    // The rest of the declared envelope (#9364): `success: false`, a message,
    // and `hostname` as context under `error.details` — never a stray top-level
    // key, and never a bare-string `error`.
    expect(body.success).toBe(false);
    expect(body.error?.message).toContain('nobody.objectos.ai');
    expect(body.error?.details?.hostname).toBe('nobody.objectos.ai');
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual(['error', 'success']);
  });

  it('refuses with the HTML page when the caller asks for text/html', async () => {
    const h = await mountGuard({ knownHosts: ['acme.objectos.ai'] });

    const res = await h.call('/', 'nobody.objectos.ai', { accept: 'text/html,application/xhtml+xml' });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Environment not found');
    expect(html).toContain('nobody.objectos.ai');
  });

  it('normalizes the Host header before judging it — port and casing', async () => {
    const h = await mountGuard({ knownHosts: ['acme.objectos.ai'] });

    const refused = await h.call('/api/v1/objects', 'NoBody.ObjectOS.ai:8443', { accept: 'application/json' });
    expect(refused.status).toBe(404);
    expect((await refused.json() as RefusalBody).error?.code).toBe('ENVIRONMENT_NOT_FOUND');

    const allowed = await h.call('/api/v1/objects', 'ACME.objectos.ai:443', { accept: 'application/json' });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe(PASSED_THROUGH);

    // The registry is asked about the normalized host, not the raw header.
    expect(h.asked).toEqual(['nobody.objectos.ai', 'acme.objectos.ai']);
  });

  it('normalizes the configured root domain, so casing cannot switch the guard off', async () => {
    const h = await mountGuard({ rootDomain: '  ObjectOS.AI  ', knownHosts: [] });

    const res = await h.call('/api/v1/objects', 'nobody.objectos.ai', { accept: 'application/json' });

    expect(res.status).toBe(404);
    expect((await res.json() as RefusalBody).error?.code).toBe('ENVIRONMENT_NOT_FOUND');
  });
});

describe('createUnknownHostnameGuardPlugin — what must NOT be refused', () => {
  it('lets a mapped hostname through to the application', async () => {
    const h = await mountGuard({ knownHosts: ['acme.objectos.ai'] });

    const res = await h.call('/api/v1/objects', 'acme.objectos.ai');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PASSED_THROUGH);
  });

  it.each([...UNKNOWN_HOSTNAME_GUARD_HEALTH_PATHS])(
    'never refuses the probe path %s, even on an unmapped hostname',
    async (probePath) => {
      // The container-killer branch. Cloudflare's probe arrives with whatever
      // Host is bound to the worker, so a 404 here takes the container down.
      const h = await mountGuard({ knownHosts: [] });

      const res = await h.call(probePath, 'nobody.objectos.ai');

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PASSED_THROUGH);
      // The registry is never even consulted for a probe.
      expect(h.asked).toEqual([]);
    },
  );

  it.each([...UNKNOWN_HOSTNAME_GUARD_RESERVED_SUBDOMAINS])(
    'lets the reserved platform host %j through',
    async (sub) => {
      const h = await mountGuard({ knownHosts: [] });
      const host = sub === '' ? ROOT_DOMAIN : `${sub}.${ROOT_DOMAIN}`;

      const res = await h.call('/_console/', host);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PASSED_THROUGH);
    },
  );

  it('treats the LAST label before the root domain as the reserved one', async () => {
    // `api.acme.objectos.ai` — `sub` is `api.acme`, whose head is `acme`, so it
    // is judged; `acme.api.objectos.ai` has head `api` and bypasses.
    const h = await mountGuard({ knownHosts: [] });

    expect((await h.call('/x', 'acme.api.objectos.ai')).status).toBe(200);
    expect((await h.call('/x', 'api.acme.objectos.ai')).status).toBe(404);
  });

  it.each(['/_admin', '/_admin/anything', '/.well-known/acme-challenge/token'])(
    'lets the infra path %s through on an unmapped hostname',
    async (infraPath) => {
      const h = await mountGuard({ knownHosts: [] });

      const res = await h.call(infraPath, 'nobody.objectos.ai');

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PASSED_THROUGH);
    },
  );

  it.each(['app.example.com', 'localhost', 'tenant.workers.dev', 'objectos.ai.evil.test'])(
    'never judges the non-platform hostname %s',
    async (host) => {
      const h = await mountGuard({ knownHosts: [] });

      const res = await h.call('/api/v1/objects', host);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PASSED_THROUGH);
      expect(h.asked).toEqual([]);
    },
  );
});

describe('createUnknownHostnameGuardPlugin — every registry failure falls through', () => {
  it('passes through when no env-registry service is registered', async () => {
    const h = await mountGuard({}); // no knownHosts ⇒ getService('env-registry') is undefined

    const res = await h.call('/api/v1/objects', 'nobody.objectos.ai');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PASSED_THROUGH);
  });

  it('passes through when the registry cannot resolve hostnames at all', async () => {
    const h = await mountGuard({ registryOverride: { somethingElse: true } });

    const res = await h.call('/api/v1/objects', 'nobody.objectos.ai');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PASSED_THROUGH);
  });

  it('passes through when the registry lookup throws', async () => {
    const h = await mountGuard({
      registryOverride: {
        resolveByHostname: async () => { throw new Error('database is down'); },
      },
    });

    const res = await h.call('/api/v1/objects', 'nobody.objectos.ai');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PASSED_THROUGH);
  });
});

describe('createUnknownHostnameGuardPlugin — the cloud /_console redirect', () => {
  it('redirects Console requests on a reserved host to the control plane', async () => {
    const h = await mountGuard({ cloudUrl: 'https://cloud.objectos.ai//', knownHosts: [] });

    const res = await h.call('/_console/', ROOT_DOMAIN);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cloud.objectos.ai/_console/');
  });

  it('does not redirect when the runtime is not cloud-connected', async () => {
    const h = await mountGuard({ knownHosts: [] }); // no cloud URL

    const res = await h.call('/_console/', ROOT_DOMAIN);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PASSED_THROUGH);
  });

  it('does not redirect non-Console paths on a reserved host', async () => {
    const h = await mountGuard({ cloudUrl: 'https://cloud.objectos.ai', knownHosts: [] });

    const res = await h.call('/api/v1/health', ROOT_DOMAIN);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PASSED_THROUGH);
  });

  it('reads the cloud URL per request, not once at install time', async () => {
    // Production reads `process.env.OS_CLOUD_URL` inside the middleware. The
    // seam keeps that a function for exactly this reason — capturing a string
    // at construction would be a behaviour change wearing a refactor's clothes.
    let cloudUrl = '';
    const server = new HonoHttpServer(0);
    const rawApp = server.getRawApp();
    const plugin = createUnknownHostnameGuardPlugin({
      rootDomain: ROOT_DOMAIN,
      readCloudUrl: () => cloudUrl,
    });
    await plugin.init({ getService: (n: string) => (n === 'http.server' ? { getRawApp: () => rawApp } : undefined) });
    rawApp.all('*', (c: { text: (body: string, status: number) => Response }) => c.text(PASSED_THROUGH, 200));
    const call = () => rawApp.fetch(new Request('http://placeholder/_console/', { headers: { host: ROOT_DOMAIN } }));

    expect((await call()).status).toBe(200);
    cloudUrl = 'https://cloud.objectos.ai';
    expect((await call()).status).toBe(302);
  });
});

describe('createUnknownHostnameGuardPlugin — install is soft, never fatal', () => {
  it('declines to install, with a warning, when http.server is unavailable', async () => {
    const h = await mountGuard({ httpServer: 'missing' });

    expect(h.warnings.join('\n')).toContain('http.server unavailable');
    // Nothing was mounted, so the sentinel answers every hostname.
    expect((await h.call('/api/v1/objects', 'nobody.objectos.ai')).status).toBe(200);
  });

  it('declines to install when the resolved server exposes no usable raw app', async () => {
    const h = await mountGuard({ httpServer: 'no-raw-app' });

    expect(h.warnings.join('\n')).toContain('http.server unavailable');
  });

  it('never throws out of init when service resolution fails', async () => {
    const h = await mountGuard({ httpServer: 'throws' });

    expect(h.warnings.join('\n')).toContain('install failed');
  });

  it('logs the install once the middleware is mounted', async () => {
    const h = await mountGuard({ knownHosts: [] });

    expect(h.infos.join('\n')).toContain('installed');
  });
});
