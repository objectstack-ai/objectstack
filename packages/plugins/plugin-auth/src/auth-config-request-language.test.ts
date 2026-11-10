// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /auth/config` serves the host's organization-create choices in the
 * language the request asked for.
 *
 * The copy is the host's own (`AuthManagerOptions.organizationEditions`):
 * objectui is a product-neutral renderer (objectui ADR-0060), so neither it
 * nor this package carries the words. The route therefore hands its request to
 * `getPublicConfig()`, which reads `accept-language` off it and asks the host.
 *
 * Driven here: the REAL `registerAuthRoutes` on a REAL Hono app over a REAL
 * `AuthManager`, so the request travels the route, the header reader and the
 * served `features` literal as it does in production.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin';
import { AuthManager } from './auth-manager';

const ORIGIN = 'http://localhost:3000';

const COPY: Record<string, { label: string; hint: string }> = {
  en: { label: 'Host edition label', hint: 'Host hint, up to 5 members' },
  zh: { label: '宿主版本名', hint: '宿主说明，最多 5 名成员' },
};

function mount() {
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
  const seen: Array<string | undefined> = [];
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long!!', baseUrl: ORIGIN } as any);
  (plugin as any).authManager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long!!',
    baseUrl: ORIGIN,
    organizationEditions: ({ acceptLanguage }) => {
      seen.push(acceptLanguage);
      const copy = acceptLanguage?.startsWith('zh') ? COPY.zh : COPY.en;
      return [{ edition: 'developer', ...copy, memberLimit: 5 }];
    },
  });
  warnSpy.mockRestore();
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return { app, seen };
}

describe('GET /auth/config answers the organization-create choices in the request language', () => {
  it('hands the request\'s accept-language to the host and serves its words unchanged', async () => {
    const { app, seen } = mount();

    const res = await app.request(`${ORIGIN}/api/v1/auth/config`, {
      headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.5' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(seen).toEqual(['zh-CN,zh;q=0.9,en;q=0.5']);
    expect(body.data.features.organizationEditions).toEqual([
      { edition: 'developer', label: COPY.zh.label, hint: COPY.zh.hint, memberLimit: 5 },
    ]);
    expect(body.data.features.developerEditionCreate).toBe(true);
  });

  it('CONTROL: a request with no accept-language reaches the host as undefined', async () => {
    const { app, seen } = mount();

    const res = await app.request(`${ORIGIN}/api/v1/auth/config`);

    expect(res.status).toBe(200);
    expect(seen).toEqual([undefined]);
    expect((await res.json()).data.features.organizationEditions[0].label).toBe(COPY.en.label);
  });
});
