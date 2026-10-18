// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24022 — a boot with no HTTP server takes the datasource admin routes
 * plugin's own degrade line, never "route registration failed" with the
 * kernel's "composition/ordering fault" text.
 *
 * ## The defect
 *
 * `os serve <host config> --no-server --preset minimal` printed, in its boot
 * diagnostics, `WARN [datasource-admin] route registration failed: [Kernel]
 * Service 'http.server' not found (while plugin
 * 'com.objectstack.cli.datasource-admin-routes' was initializing — a
 * composition/ordering fault; …)`. Nothing was at fault: `--no-server` composed
 * no server on purpose. The plugin read the server with
 * `getService?.('http.server') ?? getService?.('http-server')`, and the
 * kernel's `getService` THROWS on a name nothing registered, so the `??` never
 * ran and the throw landed in the registration `catch`.
 *
 * ## What this file pins
 *
 * The plugin's `init` runs inside a REAL `ObjectKernel`, so the throw it must
 * survive is the kernel's own, with the kernel's own wording:
 *
 *   1. no server composed: one `[datasource-admin]` warning, the degrade line,
 *      and no warning anywhere in the boot says "route registration failed" or
 *      "ordering fault";
 *   2. CONTROL: a composed server gets the real routes under
 *      `/api/v1/datasources`, and no `[datasource-admin]` warning;
 *   3. CONTROL: a composed server whose registration throws still warns
 *      "route registration failed".
 *
 * The wiring inside `run()` is a source pin with comments masked, as
 * `serve-no-transport-announcements.test.ts` pins its call site. A request to
 * the mounted route on a real boot is pinned in
 * `serve-no-server-banner.integration.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectKernel } from '@objectstack/core';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';

// The repo's ONE code/prose separator: a comment naming the factory must not
// answer for code that does not call it.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import { createDatasourceAdminRoutesPlugin } from './serve.js';

/** …/packages/cli/src/commands — seeded from `import.meta.url`. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `serve.ts`'s CODE, with every comment span blanked. */
const SERVE = maskComments(readFileSync(resolve(HERE, 'serve.ts'), 'utf8'));

/** The one service a kernel refuses to start without. Nothing here reads data. */
const DATA_STUB = {
  name: 'com.example.fx24022.data-stub',
  version: '1.0.0',
  init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('data', {}); },
  start: async () => {},
};

/** An `IHttpServer` stand-in that records every route registered on it. */
function recordingServer(opts: { refuse?: boolean } = {}) {
  const routes: string[] = [];
  const add = (method: string) => (path: string) => {
    if (opts.refuse) throw new Error('route table sealed');
    routes.push(`${method} ${path}`);
  };
  return { routes, server: { get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') } };
}

/** A stand-in for the composed transport, under the Hono plugin's name, registering `http.server`. */
function serverPlugin(server: unknown) {
  return {
    name: 'com.objectstack.server.hono',
    version: '1.0.0',
    init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('http.server', server); },
    start: async () => {},
  };
}

/**
 * Boot a real kernel holding the routes plugin (and `extra`, registered AFTER
 * it), and return every string the kernel logger was asked to `warn`. The
 * plugin's `ctx.logger` IS the kernel's logger, so the spy sees the plugin's
 * own lines as well as the kernel's.
 */
async function bootWarnings(
  registerRoutes: (server: any, ctx: any, basePath: string) => void,
  extra: Array<ReturnType<typeof serverPlugin>> = [],
): Promise<{ warnings: string[] }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  const logger = (kernel as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger;
  const warn = vi.spyOn(logger, 'warn');
  await kernel.use(DATA_STUB);
  await kernel.use(createDatasourceAdminRoutesPlugin(registerRoutes));
  for (const plugin of extra) await kernel.use(plugin);
  await kernel.bootstrap();
  const warnings = warn.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  await kernel.shutdown();
  return { warnings };
}

const ours = (warnings: string[]) => warnings.filter((w) => w.includes('[datasource-admin]'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDatasourceAdminRoutesPlugin — a boot with no HTTP server (#24022)', () => {
  it('the kernel this runs in THROWS for an unregistered http.server — the premise the read must survive', () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    expect(() => kernel.getService('http.server')).toThrow(/not found/);
  });

  it('takes its own degrade line: no "route registration failed", no "ordering fault"', async () => {
    const register = vi.fn();
    const { warnings } = await bootWarnings(register);
    const seen = `\n--- warnings ---\n${warnings.join('\n')}`;

    expect(register, `routes registered on a boot with no server${seen}`).not.toHaveBeenCalled();
    expect(warnings.filter((w) => w.includes('route registration failed')), seen).toEqual([]);
    expect(warnings.filter((w) => w.includes('ordering fault')), seen).toEqual([]);
    // Kept on purpose (see the factory's docblock): one line naming the
    // surface left unmounted, beside the boot's other "not mounted" lines.
    expect(ours(warnings), `not exactly one [datasource-admin] line${seen}`).toHaveLength(1);
  });

  it('asks for the canonical service name only — never the deprecated http-server alias', async () => {
    const asked: string[] = [];
    const warnings: string[] = [];
    await createDatasourceAdminRoutesPlugin(vi.fn()).init({
      getService: (name: string) => {
        asked.push(name);
        throw new Error(`[Kernel] Service '${name}' not found`);
      },
      logger: { warn: (msg: string) => { warnings.push(msg); } },
    });
    expect(asked).toEqual(['http.server']);
    expect(warnings).toHaveLength(1);
  });
});

describe('createDatasourceAdminRoutesPlugin — a composed HTTP server (controls)', () => {
  it('CONTROL: mounts the real routes under /api/v1/datasources, ordered after the server plugin', async () => {
    const { routes, server } = recordingServer();
    // Registered AFTER the routes plugin: `optionalDependencies` orders it ahead.
    const { warnings } = await bootWarnings(registerDatasourceAdminRoutes, [serverPlugin(server)]);
    const seen = `\n--- warnings ---\n${warnings.join('\n')}`;

    expect(routes, 'the list route was not mounted').toContain('GET /api/v1/datasources');
    expect(routes.every((r) => r.includes(' /api/v1/datasources')), routes.join('\n')).toBe(true);
    expect(ours(warnings), `a [datasource-admin] warning on a composed boot${seen}`).toEqual([]);
  });

  it('CONTROL: a registration that genuinely throws still warns "route registration failed"', async () => {
    const { routes, server } = recordingServer({ refuse: true });
    const { warnings } = await bootWarnings(registerDatasourceAdminRoutes, [serverPlugin(server)]);
    const seen = `\n--- warnings ---\n${warnings.join('\n')}`;

    expect(routes).toEqual([]);
    const said = ours(warnings);
    expect(said, `not exactly one [datasource-admin] line${seen}`).toHaveLength(1);
    expect(said[0], seen).toContain('route registration failed');
    expect(said[0], `the error itself is not named${seen}`).toContain('route table sealed');
  });
});

describe('the wiring inside `run()` (#24022)', () => {
  it('serve mounts the routes through the factory, handing it the real registrar', () => {
    expect(SERVE).toContain('await kernel.use(createDatasourceAdminRoutesPlugin(registerDatasourceAdminRoutes));');
    expect(SERVE.match(/'com\.objectstack\.cli\.datasource-admin-routes'/g) ?? [], 'a second inline copy of the plugin').toHaveLength(1);
  });
});
