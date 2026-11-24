// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36840] The print door as a member of the `print` service
 * (`IPrintDoorService.handlePrintDoor`), for a kernel with no `http.server`:
 * a hosted tenant kernel, whose host's runtime dispatcher forwards
 * `POST /api/v1/print/records` to it.
 *
 * The member runs the very registration the `http.server` mount runs, so each
 * case here asks both faces the same request and asserts one answer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { PRINT_SERVICE, PrintServicePlugin } from './print-service-plugin.js';
import type { PrintService } from './print-service.js';
import { PRINT_BROWSER_ENDPOINT_ENV, PRINT_CHROMIUM_PATH_ENV, PRINT_CONSOLE_URL_ENV } from './config.js';
import { PRINT_RECORDS_ROUTE } from './print-routes.js';

const ENV_KEYS = [PRINT_CHROMIUM_PATH_ENV, PRINT_BROWSER_ENDPOINT_ENV, PRINT_CONSOLE_URL_ENV];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** A kernel context; `http` decides whether it registers an `http-server`. */
async function boot(withHttpServer: boolean) {
  const services = new Map<string, unknown>();
  const hooks: Array<() => Promise<void>> = [];
  const http = withHttpServer ? new HonoHttpServer(0) : undefined;
  if (http) services.set('http-server', http);
  const ctx = {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    registerService: (name: string, service: unknown) => services.set(name, service),
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service ${name} not found`);
      return services.get(name);
    },
    hook: (event: string, fn: () => Promise<void>) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
  } as unknown as PluginContext;
  const plugin = new PrintServicePlugin({});
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const h of hooks) await h();
  return { service: services.get(PRINT_SERVICE) as PrintService, http };
}

function printRequest(init: { method?: string; path?: string } = {}): Request {
  return new Request(`http://tenant.example.test${init.path ?? PRINT_RECORDS_ROUTE}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: (init.method ?? 'POST') === 'GET' ? undefined : JSON.stringify({ app: 'sales', object: 'invoice', recordId: 'inv_1', page: 'invoice_document' }),
  });
}

async function snapshot(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

describe('PrintService.handlePrintDoor — the print door for a kernel with no http.server', () => {
  it('is registered on the print service whether or not the kernel has an http.server', async () => {
    const without = await boot(false);
    const withHttp = await boot(true);
    expect(typeof without.service.handlePrintDoor).toBe('function');
    expect(typeof withHttp.service.handlePrintDoor).toBe('function');
  });

  it('answers a request exactly as the http.server mount answers it (anonymous: 401)', async () => {
    const { service, http } = await boot(true);
    const viaMember = await snapshot(await service.handlePrintDoor!(printRequest()));
    const viaMount = await snapshot(await http!.getRawApp().fetch(printRequest()));
    expect(viaMember.status).toBe(401);
    expect(viaMember).toEqual(viaMount);
  });

  it('serves on a kernel with no http.server, where nothing else mounts the door', async () => {
    const { service } = await boot(false);
    const res = await service.handlePrintDoor!(printRequest());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('answers a method or path that is not the door with the transport miss, reaching no door', async () => {
    const { service } = await boot(false);
    for (const req of [printRequest({ method: 'GET' }), printRequest({ path: '/api/v1/print/records/extra' })]) {
      const res = await service.handlePrintDoor!(req);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ENDPOINT_NOT_FOUND');
    }
  });
});
