// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// A settings page states what is LIVE, not only what is stored. The stored
// `mail` default (provider `smtp`, empty host) reads as SMTP while the live
// transport is the development log. The owning package registers a live-status
// provider, and `GET /api/settings/:namespace` puts its answer at the top of the
// page as an `info_banner`, asked on every read.

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsNamespacePayloadSchema } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import { aiSettingsManifest } from './manifests/ai.manifest.js';
import {
  SETTINGS_LIVE_STATUS_BANNER_ID,
  type SettingsLiveStatus,
  UnknownNamespaceError,
} from './settings-service.types.js';

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

const admin = () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' });

function rig(
  manifest = mailSettingsManifest,
  contextFromRequest: () => Record<string, unknown> = admin,
) {
  const http = new MockHttp();
  const logger = { warn: vi.fn(), error: vi.fn() };
  const svc = new SettingsService({ env: {}, logger });
  svc.registerManifest(manifest);
  registerSettingsRoutes(http, svc, { contextFromRequest: contextFromRequest as any });
  const read = async () => {
    const req: IHttpRequest = {
      params: { namespace: manifest.namespace }, query: {}, body: undefined, headers: {}, method: 'GET', path: '/',
    };
    const state: { status: number; body?: any } = { status: 200 };
    const res: IHttpResponse = {
      json: vi.fn((data) => { state.body = data; }) as any,
      send: vi.fn() as any,
      status: vi.fn((code: number) => { state.status = code; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    await http.routes.get('GET /api/settings/:namespace')!(req, res);
    return state;
  };
  return { svc, read, logger };
}

describe('GET /api/settings/:namespace — the live-status statement', () => {
  it('heads the page with the provider\'s answer as a spec-valid info_banner', async () => {
    const { svc, read } = rig();
    svc.registerLiveStatus('mail', () => ({
      label: 'No mail leaves this machine', bannerText: 'Development log.', bannerSeverity: 'warning',
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    const first = body.data.manifest.specifiers[0];
    expect(first).toMatchObject({
      type: 'info_banner',
      id: SETTINGS_LIVE_STATUS_BANNER_ID,
      label: 'No mail leaves this machine',
      bannerSeverity: 'warning',
    });
    // The rest of the page is the registered manifest, unchanged and in order.
    expect(body.data.manifest.specifiers.slice(1)).toEqual(mailSettingsManifest.specifiers);
    expect(SettingsNamespacePayloadSchema.safeParse(body.data).success).toBe(true);
  });

  it('asks on every read, so the statement follows what is live', async () => {
    const { svc, read } = rig();
    let live: SettingsLiveStatus = { label: 'Before', bannerText: 'b', bannerSeverity: 'warning' };
    svc.registerLiveStatus('mail', () => live);
    expect((await read()).body.data.manifest.specifiers[0].label).toBe('Before');
    live = { label: 'After', bannerText: 'a', bannerSeverity: 'info' };
    expect((await read()).body.data.manifest.specifiers[0].label).toBe('After');
  });

  it('leaves the registered manifest itself untouched', async () => {
    const { svc, read } = rig();
    svc.registerLiveStatus('mail', () => ({ label: 'L', bannerText: 't', bannerSeverity: 'info' }));
    await read();
    const own = (await svc.getNamespace('mail', admin())).manifest.specifiers;
    expect(own.some((s) => s.id === SETTINGS_LIVE_STATUS_BANNER_ID)).toBe(false);
  });

  it('states nothing extra where no provider is registered, or the provider has nothing to say', async () => {
    const { svc, read } = rig();
    expect((await read()).body.data.manifest.specifiers).toEqual(mailSettingsManifest.specifiers);
    svc.registerLiveStatus('mail', () => undefined);
    expect((await read()).body.data.manifest.specifiers).toEqual(mailSettingsManifest.specifiers);
  });

  it('says the live status could not be read when the provider throws, instead of omitting it', async () => {
    const { svc, read, logger } = rig();
    svc.registerLiveStatus('mail', () => { throw new Error('boom'); });
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.data.manifest.specifiers[0]).toMatchObject({
      type: 'info_banner', id: SETTINGS_LIVE_STATUS_BANNER_ID, bannerSeverity: 'error',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('refuses a provider for a namespace that is not registered', () => {
    const { svc } = rig();
    expect(() => svc.registerLiveStatus('nope', () => undefined)).toThrow(UnknownNamespaceError);
  });
});

// #32052 — the page also serves, machine-readable, the value a key has in the
// RUNNING system, as the runtime that decides it states it: the AI runtime's
// provider may come from saved settings or from boot environment variables,
// and `values.provider` (what is stored) cannot tell those apart from "none".
describe('GET /api/settings/:namespace — the live values the runtime states', () => {
  /** A credential the runtime holds; it must never reach the served body. */
  const SECRET = 'sk-live-0123456789abcdefSECRET';

  it('serves the runtime\'s value and its source as `live`, beside the banner', async () => {
    const { svc, read } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => ({
      label: 'Built-in AI: OpenAI', bannerText: 'Detected from the environment.', bannerSeverity: 'info',
      values: { provider: { value: 'openai', source: 'environment' } },
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.data.live).toEqual({ provider: { value: 'openai', source: 'environment' } });
    // Stored and live stay two answers: nothing is saved, the runtime uses OpenAI.
    expect(body.data.values.provider.value ?? null).toBeNull();
    expect(body.data.manifest.specifiers[0]).toMatchObject({ type: 'info_banner', id: SETTINGS_LIVE_STATUS_BANNER_ID });
    expect(SettingsNamespacePayloadSchema.safeParse(body.data).success).toBe(true);
  });

  it('serves "none" only when the runtime states it, and nothing when nobody states anything', async () => {
    const { svc, read } = rig(aiSettingsManifest);
    // No runtime registered (this repo alone): not stated, which is not "none".
    expect('live' in (await read()).body.data).toBe(false);
    // A statement with only a banner states no value either.
    svc.registerLiveStatus('ai', () => ({ label: 'L', bannerText: 't', bannerSeverity: 'info' }));
    expect('live' in (await read()).body.data).toBe(false);
    svc.registerLiveStatus('ai', () => ({
      label: 'The built-in AI is off', bannerText: 'No provider is configured.', bannerSeverity: 'warning',
      values: { provider: { value: null, source: 'none' } },
    }));
    const { body } = await read();
    expect(body.data.live).toEqual({ provider: { value: null, source: 'none' } });
    expect(SettingsNamespacePayloadSchema.safeParse(body.data).success).toBe(true);
  });

  it('⛔ serves only the value and its source: a credential the runtime attaches never leaves', async () => {
    const { svc, read } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => ({
      label: 'Built-in AI: OpenAI', bannerText: 'Detected from the environment.', bannerSeverity: 'info',
      values: {
        provider: { value: 'openai', source: 'environment', apiKey: SECRET, keyPrefix: SECRET.slice(0, 7) },
      } as any,
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.data.live).toEqual({ provider: { value: 'openai', source: 'environment' } });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain(SECRET.slice(0, 7));
  });

  it('⛔ leaves out a value that is not one of the key\'s options, so a credential cannot be served as one', async () => {
    const { svc, read, logger } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => ({
      label: 'Built-in AI', bannerText: 'In use.', bannerSeverity: 'info',
      values: { provider: { value: SECRET, source: 'environment' } },
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    expect('live' in body.data).toBe(false);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    // The banner the runtime stated stands; the dropped value is said once, without itself.
    expect(body.data.manifest.specifiers[0]).toMatchObject({
      type: 'info_banner', id: SETTINGS_LIVE_STATUS_BANNER_ID, label: 'Built-in AI', bannerSeverity: 'info',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain("'provider'");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET);
  });

  it.each([
    ['a key with no option table (a credential)', { openai_api_key: { value: SECRET, source: 'environment' } }],
    ['a key with no option table (free text)', { openai_model: { value: 'gpt-4o', source: 'environment' } }],
    ['a key with no option table, even as "none"', { openai_model: { value: null, source: 'none' } }],
    ['a key the namespace does not declare', { api_key: { value: 'openai', source: 'environment' } }],
    ['a source outside the closed set', { provider: { value: 'openai', source: 'env' } }],
    ['a value under source "none"', { provider: { value: 'openai', source: 'none' } }],
    ['no value under a source other than "none"', { provider: { value: null, source: 'settings' } }],
    ['an entry that is not { value, source }', { provider: 'openai' }],
  ])('leaves out an entry naming %s, keeping the stated banner', async (_what, values) => {
    const { svc, read, logger } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => ({
      label: 'Built-in AI', bannerText: 'In use.', bannerSeverity: 'info', values: values as any,
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    expect('live' in body.data).toBe(false);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.data.manifest.specifiers[0]).toMatchObject({
      id: SETTINGS_LIVE_STATUS_BANNER_ID, label: 'Built-in AI', bannerSeverity: 'info',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET);
  });

  it('serves the valid entry and drops only the invalid one beside it', async () => {
    const { svc, read, logger } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => ({
      label: 'Built-in AI: Anthropic', bannerText: 'Saved in settings.', bannerSeverity: 'success',
      values: {
        provider: { value: 'anthropic', source: 'settings' },
        embedder_provider: { value: SECRET, source: 'environment' },
      },
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.data.live).toEqual({ provider: { value: 'anthropic', source: 'settings' } });
    expect(body.data.manifest.specifiers[0]).toMatchObject({
      id: SETTINGS_LIVE_STATUS_BANNER_ID, label: 'Built-in AI: Anthropic', bannerSeverity: 'success',
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain("'embedder_provider'");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET);
    expect(SettingsNamespacePayloadSchema.safeParse(body.data).success).toBe(true);
  });

  it('answers the error banner, not a 500, when the stated values cannot be read', async () => {
    const { svc, read, logger } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => ({
      label: 'Built-in AI', bannerText: 'In use.', bannerSeverity: 'info',
      get values(): never { throw new Error('values unreadable'); },
    }));
    const { status, body } = await read();
    expect(status).toBe(200);
    expect('live' in body.data).toBe(false);
    expect(body.data.manifest.specifiers[0]).toMatchObject({ id: SETTINGS_LIVE_STATUS_BANNER_ID, bannerSeverity: 'error' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('serves no live values when the provider throws: the error banner alone', async () => {
    const { svc, read } = rig(aiSettingsManifest);
    svc.registerLiveStatus('ai', () => { throw new Error('boom'); });
    const { body } = await read();
    expect('live' in body.data).toBe(false);
    expect(body.data.manifest.specifiers[0]).toMatchObject({ id: SETTINGS_LIVE_STATUS_BANNER_ID, bannerSeverity: 'error' });
  });

  it('⛔ is behind the page\'s own gate: a caller without its read permission is refused and the runtime is never asked', async () => {
    const provider = vi.fn(() => ({
      label: 'Built-in AI: OpenAI', bannerText: 'Detected from the environment.', bannerSeverity: 'info' as const,
      values: { provider: { value: 'openai', source: 'environment' as const } },
    }));
    const member = () => ({ enforced: true, permissions: ['setup.access'], userId: 'usr_member' });
    const { svc, read } = rig(aiSettingsManifest, member);
    svc.registerLiveStatus('ai', provider);
    const { status, body } = await read();
    expect(status).toBe(403);
    expect(body.error?.code ?? body.code).toBe('SETTINGS_FORBIDDEN');
    expect(JSON.stringify(body)).not.toContain('openai');
    expect(provider).not.toHaveBeenCalled();
  });
});
