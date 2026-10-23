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

function rig() {
  const http = new MockHttp();
  const logger = { warn: vi.fn(), error: vi.fn() };
  const svc = new SettingsService({ env: {}, logger });
  svc.registerManifest(mailSettingsManifest);
  registerSettingsRoutes(http, svc, { contextFromRequest: admin });
  const read = async () => {
    const req: IHttpRequest = {
      params: { namespace: 'mail' }, query: {}, body: undefined, headers: {}, method: 'GET', path: '/',
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
