// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { PRINT_SERVICE, PrintServicePlugin } from './print-service-plugin.js';
import type { PrintService } from './print-service.js';
import { PRINT_BROWSER_ENDPOINT_ENV, PRINT_CHROMIUM_PATH_ENV, PRINT_CONSOLE_URL_ENV } from './config.js';

/**
 * A deployment learns at `start()` — never at its first print — that its
 * engine is absent, misconfigured or unreachable: one `warn` naming the
 * remedy. The unreachable cases drive the real `playwright-core` against a path
 * and an endpoint that answer nothing, so the reason is the library's own.
 * The ready case, which needs a real Chromium, is in `chromium-driver.test.ts`.
 */

const SECRET = 's3cr3t-token-value';
const ENV_KEYS = [PRINT_CHROMIUM_PATH_ENV, PRINT_BROWSER_ENDPOINT_ENV, PRINT_CONSOLE_URL_ENV];

interface Logged {
  level: 'info' | 'warn' | 'error';
  message: string;
}

function fakeContext(): { ctx: PluginContext; logged: Logged[]; services: Map<string, unknown>; ready: () => Promise<void> } {
  const logged: Logged[] = [];
  const services = new Map<string, unknown>();
  const hooks: Array<() => Promise<void>> = [];
  const ctx = {
    logger: {
      info: (message: string) => logged.push({ level: 'info', message }),
      warn: (message: string) => logged.push({ level: 'warn', message }),
      error: (message: string) => logged.push({ level: 'error', message }),
      debug: () => undefined,
    },
    registerService: (name: string, service: unknown) => services.set(name, service),
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service ${name} not found`);
      return services.get(name);
    },
    hook: (event: string, fn: () => Promise<void>) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
  } as unknown as PluginContext;
  return { ctx, logged, services, ready: async () => { for (const h of hooks) await h(); } };
}

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

async function boot(options: ConstructorParameters<typeof PrintServicePlugin>[0]) {
  const f = fakeContext();
  const plugin = new PrintServicePlugin(options);
  await plugin.init(f.ctx);
  await plugin.start(f.ctx);
  return { ...f, service: f.services.get(PRINT_SERVICE) as PrintService };
}

describe('PrintServicePlugin.start — absence is loud, once', () => {
  it('registers the print service on every path', async () => {
    const { service } = await boot({});
    expect(typeof service.printRecordToFile).toBe('function');
    expect(typeof service.status).toBe('function');
  });

  it('no engine configured: one warn naming the variables; status unconfigured', async () => {
    const { logged, service } = await boot({});
    const warns = logged.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toContain(PRINT_CHROMIUM_PATH_ENV);
    expect(warns[0]!.message).toContain(PRINT_BROWSER_ENDPOINT_ENV);
    expect(service.status()).toMatchObject({ state: 'unconfigured', placement: null });
  });

  it('the environment configures it as the options do', async () => {
    process.env[PRINT_CHROMIUM_PATH_ENV] = '/nonexistent/chromium-for-print-test';
    const { service } = await boot({});
    expect(service.status()).toMatchObject({ placement: 'local' });
  });

  it('both placements: one warn, status misconfigured', async () => {
    const { logged, service } = await boot({
      chromiumPath: '/usr/bin/chromium',
      browserEndpoint: `ws://127.0.0.1:9/devtools/browser/x?token=${SECRET}`,
      consoleUrl: 'http://127.0.0.1:3000/_console',
    });
    expect(logged.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(service.status().state).toBe('misconfigured');
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });

  it('a local executable that does not exist: one warn naming the path; status unavailable', async () => {
    const path = '/nonexistent/chromium-for-print-test';
    const { logged, service } = await boot({ chromiumPath: path, consoleUrl: 'http://127.0.0.1:3000/_console' });
    const warns = logged.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toContain(path);
    expect(service.status()).toMatchObject({ state: 'unavailable', placement: 'local' });
    expect(logged.some((l) => l.level === 'info')).toBe(false);
  }, 30_000);

  it('a console URL carrying credentials and a non-numeric port reaches no log line and no status', async () => {
    const { logged, service } = await boot({
      chromiumPath: '/nonexistent/chromium-for-print-test',
      consoleUrl: 'http://print:topsecret@127.0.0.1:abc/_console',
    });
    expect(logged.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain('topsecret');
    expect(JSON.stringify(service.status())).not.toContain('topsecret');
  });

  it('a remote endpoint nobody answers: one warn naming its host, never its token', async () => {
    const { logged, service } = await boot({
      browserEndpoint: `ws://127.0.0.1:9/devtools/browser/x?token=${SECRET}`,
      consoleUrl: 'http://127.0.0.1:3000/_console',
    });
    const warns = logged.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toContain('ws://127.0.0.1:9');
    expect(JSON.stringify(logged)).not.toContain(SECRET);
    const status = service.status();
    expect(status).toMatchObject({ state: 'unavailable', placement: 'remote' });
    expect(JSON.stringify(status)).not.toContain(SECRET);
  }, 30_000);
});
