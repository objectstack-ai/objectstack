// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * i18n wire-dialect proof (#3636) — the SDK's i18n calls resolve against a
 * REAL router, not a pinned URL string.
 *
 * The URL pins in `client.test.ts` say what the client sends. They cannot say
 * whether anything answers: that is exactly how `i18n.getTranslations` and
 * `i18n.getFieldLabels` shipped a `?locale=` dialect no server has ever
 * mounted, passing every client-side test while 404-ing in production.
 *
 * So this suite mounts the two route patterns every serving surface declares —
 * `service-i18n`'s autonomous mounts, the dispatcher's HTTP mounts, and the
 * `plugin-rest-api.zod.ts` contract all agree on them — on a real Hono server,
 * and drives the real client at it. The old dialect is asserted DEAD in the
 * same suite, so a revert cannot pass quietly.
 *
 * service-i18n itself is deliberately not imported: it is not a dependency of
 * `@objectstack/client` and must not become one (the tranche-1 no-package-edge
 * lesson). The route PATTERNS are the contract under test, and they are
 * identical on both surfaces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer, IHttpRequest, IHttpResponse } from '@objectstack/spec/contracts';
import { ObjectStackClient } from './index';

describe('i18n SDK calls hit a real router (#3636)', () => {
  let baseUrl: string;
  let kernel: LiteKernel;
  let client: ObjectStackClient;

  beforeAll(async () => {
    kernel = new LiteKernel();
    const hono = new HonoServerPlugin({ port: 0 });
    kernel.use(hono);
    await kernel.bootstrap();

    // The same three patterns I18nServicePlugin.registerI18nRoutes mounts,
    // answering with the same `{ success: true, data }` envelope it now emits
    // — see packages/services/service-i18n/src/i18n-route-ledger.ts.
    const server = kernel.getService<IHttpServer>('http-server');
    server.get('/api/v1/i18n/locales', async (_req: IHttpRequest, res: IHttpResponse) => {
      res.json({ success: true, data: { locales: [{ code: 'zh-CN', label: 'zh-CN', isDefault: true }] } });
    });
    server.get('/api/v1/i18n/translations/:locale', async (req: IHttpRequest, res: IHttpResponse) => {
      res.json({ success: true, data: { locale: req.params.locale, translations: { hello: '你好' } } });
    });
    server.get('/api/v1/i18n/labels/:object/:locale', async (req: IHttpRequest, res: IHttpResponse) => {
      res.json({ success: true, data: { object: req.params.object, locale: req.params.locale, labels: { name: '名称' } } });
    });

    baseUrl = `http://localhost:${(server as unknown as { getPort(): number }).getPort()}`;
    client = new ObjectStackClient({ baseUrl });
  });

  afterAll(async () => {
    await kernel?.shutdown();
  });

  it('getTranslations resolves — the locale arrives as a path param', async () => {
    const res = await client.i18n.getTranslations('zh-CN');
    expect(res.locale).toBe('zh-CN');
    expect(res.translations).toEqual({ hello: '你好' });
  });

  it('getFieldLabels resolves — object AND locale arrive as path params', async () => {
    const res = await client.i18n.getFieldLabels('customer', 'zh-CN');
    expect(res.object).toBe('customer');
    expect(res.locale).toBe('zh-CN');
    expect(res.labels).toEqual({ name: '名称' });
  });

  it('getLocales resolves', async () => {
    const res = await client.i18n.getLocales();
    expect(res.locales).toHaveLength(1);
  });

  it('the abandoned query dialect is dead on the wire — 404, both shapes', async () => {
    // This is what the client sent before #3636. Nothing routes it.
    for (const dead of [
      '/api/v1/i18n/translations?locale=zh-CN',
      '/api/v1/i18n/labels/customer?locale=zh-CN',
    ]) {
      const res = await fetch(`${baseUrl}${dead}`);
      expect(res.status, `${dead} should not resolve on any surface`).toBe(404);
    }
  });
});
