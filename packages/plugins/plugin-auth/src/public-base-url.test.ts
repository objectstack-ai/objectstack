// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /auth/config` serves `features.publicBaseUrl`: the canonical origin
 * every link the auth layer hands out is built on (`getCanonicalOrigin`), sub-
 * path included, reduced to its address. The console's mobile-app connect page
 * encodes it, so the door being anonymous means a credential in the configured
 * base URL must never reach it.
 *
 * The door case drives the REAL `registerAuthRoutes` on a REAL Hono app over a
 * REAL `AuthManager`, as `auth-config-request-language.test.ts` does.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin';
import { AuthManager } from './auth-manager';
import { publicBaseUrlOf } from './public-base-url';

const SECRET = 'test-secret-at-least-32-chars-long!!';

function manager(baseUrl?: string): AuthManager {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return new AuthManager({ secret: SECRET, ...(baseUrl === undefined ? {} : { baseUrl }) });
  } finally {
    warnSpy.mockRestore();
  }
}

function mountDoor(baseUrl: string) {
  const app = new Hono();
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn(),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  const plugin = new AuthPlugin({ secret: SECRET, baseUrl } as any);
  (plugin as any).authManager = manager(baseUrl);
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

describe('GET /api/v1/auth/config serves features.publicBaseUrl over the real door', () => {
  it('the configured base URL, sub-path included', async () => {
    const app = mountDoor('https://os.acme.example/platform');

    const res = await app.request('https://os.acme.example/api/v1/auth/config');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.features.publicBaseUrl).toBe('https://os.acme.example/platform');
  });

  it('a credential, query or fragment in the configured base URL is not served', async () => {
    const app = mountDoor('https://ops:s3cret@os.acme.example/platform/?token=abc#x');

    const res = await app.request('https://os.acme.example/api/v1/auth/config');

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).data.features.publicBaseUrl).toBe('https://os.acme.example/platform');
    expect(text).not.toMatch(/s3cret|token=abc/);
  });
});

describe('getPublicConfig().features.publicBaseUrl', () => {
  it('follows getCanonicalOrigin: a bare host gains https://, a trailing slash goes', () => {
    expect(manager('os.acme.example').getPublicConfig().features.publicBaseUrl).toBe('https://os.acme.example');
    expect(manager('https://os.acme.example/').getPublicConfig().features.publicBaseUrl).toBe('https://os.acme.example');
  });

  it('CONTROL: with no base URL set it is the loopback fallback, which the console refuses to encode', () => {
    expect(manager().getPublicConfig().features.publicBaseUrl).toBe('http://localhost:3000');
  });
});

describe('publicBaseUrlOf', () => {
  it.each([
    ['https://os.acme.example', 'https://os.acme.example'],
    ['https://os.acme.example:8443/os', 'https://os.acme.example:8443/os'],
    ['https://os.acme.example:443/os', 'https://os.acme.example/os'],
    ['HTTPS://OS.Acme.Example/os/', 'https://os.acme.example/os'],
    ['https://ops@os.acme.example', 'https://os.acme.example'],
  ])('%s → %s', (origin, served) => {
    expect(publicBaseUrlOf(origin)).toBe(served);
  });

  it('a value that is not an absolute URL is not served', () => {
    expect(publicBaseUrlOf('https://bad host')).toBeUndefined();
    expect(publicBaseUrlOf('not a url')).toBeUndefined();
  });
});
