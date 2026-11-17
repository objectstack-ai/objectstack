// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A deployment that does not mount the knowledge service offers no knowledge
 * settings (#33933).
 *
 * The knowledge base is not a default capability, and its settings used to be
 * registered on every boot regardless: the `knowledge` namespace, the `ai`
 * namespace's embedder section, the "Test connection" and "Test embedder"
 * buttons, and the Setup entry. `@objectstack/service-knowledge` now
 * contributes all of them when it is mounted (its own suite pins that half);
 * this file pins the other half on the composition a host gets by default —
 * `new SettingsServicePlugin()` beside the stock Setup navigation:
 *
 *   - no `knowledge` manifest in the hub list, and its doors refuse;
 *   - no `embedder_*` key and no `test_embedder` button on the `ai` page, and a
 *     write of an embedder key is refused like any undeclared key;
 *   - neither test button's door reaches a handler;
 *   - no Setup entry opening the knowledge page;
 *   - the AI page's description names no knowledge base, in any locale.
 *
 * The refusals are pinned by envelope (status + `error.code`), which is what a
 * console or API caller reads.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects';
import type { IHttpRequest, IHttpResponse } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import type { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { MockHttp } from './__tests__/settings-door.testkit.js';
import { aiEmbedderSettingsSpecifiers, aiSettingsManifest, builtinSettingsManifests } from './manifests/index.js';
import { settingsBuiltinTranslations } from './translations/index.js';
import { settingsActionCopy } from './settings-action-copy.js';

const EMBEDDER_KEYS = aiEmbedderSettingsSpecifiers.map((s) => s.key).filter((k): k is string => !!k);

/** The default composition: `new SettingsServicePlugin()` with no options but an empty env. */
async function bootDefault(): Promise<{ service: SettingsService; http: MockHttp }> {
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: kernel.registerService.bind(kernel),
    getService: kernel.getService.bind(kernel),
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };
  const plugin = new SettingsServicePlugin({ env: {}, registerRoutes: false });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  const service = ctx.getService('settings') as SettingsService;
  const http = new MockHttp();
  registerSettingsRoutes(http, service, {
    contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings', 'setup.access'], userId: 'usr_admin' }),
  });
  return { service, http };
}

async function call(
  http: MockHttp,
  route: string,
  params: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<{ status: number; body?: any }> {
  const handler = http.routes.get(route);
  if (!handler) throw new Error(`route not registered: ${route}`);
  const [method] = route.split(' ');
  const req: IHttpRequest = { params, query: {}, body: body ?? {}, headers: {}, method, path: '/' } as IHttpRequest;
  const state: { status: number; body?: any } = { status: 200 };
  const res: IHttpResponse = {
    json: vi.fn((d) => { state.body = d; }) as any,
    send: vi.fn() as any,
    status: vi.fn((c: number) => { state.status = c; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  await handler(req, res);
  return state;
}

describe('#33933 — no knowledge settings on a default boot', async () => {
  const { service, http } = await bootDefault();

  it('reads a real hub: the default slate is registered, AI included', () => {
    // Non-vacuity: the namespaces around the absent one are there.
    const namespaces = service.listManifests().map((m) => m.namespace);
    expect(namespaces).toEqual(expect.arrayContaining(['ai', 'storage', 'mail']));
  });

  it('the bundled aggregate and the hub list carry no knowledge namespace', () => {
    expect(builtinSettingsManifests.map((m) => m.namespace)).not.toContain('knowledge');
    expect(service.listManifests().map((m) => m.namespace)).not.toContain('knowledge');
  });

  it('a direct read of the knowledge page is refused, not served as a form', async () => {
    const read = await call(http, 'GET /api/settings/:namespace', { namespace: 'knowledge' });
    expect(read.status).toBe(404);
    expect(read.body?.error?.code).toBe('UNKNOWN_NAMESPACE');
  });

  it('the ai page declares no embedder key and no Test embedder button', () => {
    const served = service.getManifest('ai').specifiers as Array<{ key?: string; id?: string; type: string }>;
    // Non-vacuity: the provider section the page keeps is there.
    expect(served.some((s) => s.key === 'provider')).toBe(true);
    expect(EMBEDDER_KEYS.length).toBeGreaterThanOrEqual(6);
    for (const key of EMBEDDER_KEYS) expect(served.some((s) => s.key === key), key).toBe(false);
    expect(served.some((s) => s.id === 'embedder' || s.id === 'test_embedder')).toBe(false);
    expect(aiSettingsManifest.specifiers.some((s) => s.key !== undefined && EMBEDDER_KEYS.includes(s.key))).toBe(false);
  });

  it('a write of an embedder key is refused as an undeclared key', async () => {
    const write = await call(http, 'PUT /api/settings/:namespace', { namespace: 'ai' }, { embedder_provider: 'openai' });
    expect(write.status).toBe(400);
    expect(write.body?.error?.code).toBe('UNKNOWN_KEY');
  });

  it('neither test button reaches a handler at its door', async () => {
    const route = 'POST /api/settings/:namespace/:actionId';
    const embedder = await call(http, route, { namespace: 'ai', actionId: 'test_embedder' }, {
      values: { embedder_provider: 'openai', embedder_api_key: 'sk-test', embedder_model: 'text-embedding-3-small' },
    });
    expect(embedder.status).toBe(400);
    expect(embedder.body?.error?.code).toBe('SETTINGS_ACTION_FAILED');
    // "Not reached" is judged against the hub's own no-handler answer for this
    // id, never against a copy of its wording.
    expect(embedder.body?.error?.details?.message).toBe(settingsActionCopy(undefined).noHandler('test_embedder', 'ai'));
    const knowledge = await call(http, route, { namespace: 'knowledge', actionId: 'test' }, { values: { adapter: 'ragflow' } });
    expect(knowledge.status).toBe(404);
    expect(knowledge.body?.error?.code).toBe('UNKNOWN_NAMESPACE');
  });

  it('the stock Setup navigation opens no knowledge page', () => {
    const items = SETUP_NAV_CONTRIBUTIONS.flatMap((c) => (c.items ?? []) as Array<{ id?: string; url?: string }>);
    // Non-vacuity: the AI entry beside it is there.
    expect(items.some((i) => i.id === 'nav_settings_ai')).toBe(true);
    expect(items.some((i) => i.id === 'nav_settings_knowledge' || /\/settings\/knowledge$/.test(i.url ?? ''))).toBe(false);
  });

  it('the AI page description names no knowledge base in any locale', () => {
    expect(aiSettingsManifest.description).not.toMatch(/knowledge/i);
    const bundles = settingsBuiltinTranslations as Record<string, any>;
    const words: Record<string, RegExp> = {
      en: /knowledge/i, 'zh-CN': /知识/, 'zh-Hant': /知識/, 'ja-JP': /ナレッジ/, ko: /지식/,
      de: /Wissen/, 'es-ES': /conocimiento/i, fr: /connaissance/i, 'pt-BR': /conhecimento/i, ru: /знани/i, ar: /المعرفة/,
    };
    for (const [locale, word] of Object.entries(words)) {
      const description = bundles[locale]?.settings?.ai?.description;
      expect(typeof description, locale).toBe('string');
      expect(description, locale).not.toMatch(word);
    }
  });
});
