// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `action_button` a bundled settings manifest declares against the
 * settings action route is answered by the plugin's DEFAULT composition
 * (#24769).
 *
 * ## The defect
 *
 * `ai.test_embedder` ("Test embedder") and `knowledge.test` ("Test connection")
 * were declared in their manifests, so Setup rendered both buttons, and their
 * handlers (`aiTestEmbedderActionHandler`, `knowledgeTestActionHandler`) were
 * exported beside the manifests — but `SettingsServicePlugin`'s default
 * `actionHandlers` map registered only `mail.test`, `sms.test`, `storage.test`
 * and `ai.test`. Both buttons answered `400 SETTINGS_ACTION_FAILED`, "No
 * handler registered". Nothing registers either action later: at a43405d59 the
 * only `registerAction` calls against a settings namespace outside this
 * package are plugin-email (`mail`), service-sms (`sms`) and service-storage
 * (`storage`).
 *
 * ## What is pinned
 *
 * The CLASS, not the two instances: each bundled manifest's `http`-kind
 * `action_button` whose URL is the settings action route is driven through
 * `runAction` on the service the default-constructed plugin registers, and must
 * reach a handler. "Reached" is observed, not inferred from message text: every
 * handler the plugin registers is wrapped to record its own invocation, so an
 * action is honoured when a registered handler ran, or when `runAction`
 * answered `ok` without one — its built-in `reset` fallback, the one action it
 * serves for every namespace. The no-handler answer is neither: no handler
 * runs and it is `ok: false`. A new button declared without its handler, or a
 * handler dropped from the default map, goes red here by name.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import { SettingsService } from './settings-service.js';
import type { SettingsActionHandler } from './settings-service.types.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { builtinSettingsManifests } from './manifests/index.js';

/** The settings action route under the plugin's default base path. */
const SETTINGS_ACTION_ROUTE = /^\/api\/settings\/([^/]+)\/([^/]+)$/;

interface DeclaredRouteAction {
  manifestNamespace: string;
  buttonId: string;
  namespace: string;
  actionId: string;
}

/** Every bundled `action_button` whose handler POSTs to the settings action route. */
function declaredRouteActions(): DeclaredRouteAction[] {
  const out: DeclaredRouteAction[] = [];
  for (const manifest of builtinSettingsManifests) {
    for (const spec of manifest.specifiers as any[]) {
      if (spec.type !== 'action_button' || spec.handler?.kind !== 'http') continue;
      const m = SETTINGS_ACTION_ROUTE.exec(String(spec.handler.url));
      if (!m) continue;
      out.push({ manifestNamespace: manifest.namespace, buttonId: spec.id, namespace: m[1], actionId: m[2] });
    }
  }
  return out;
}

/**
 * Construct the plugin with NO options — the composition a host gets by
 * default — and capture the service its `init()` registers. Every handler the
 * plugin registers is wrapped so the test can see which one ran.
 */
async function bootDefaultPlugin() {
  const invoked = new Set<string>();
  const register = SettingsService.prototype.registerAction;
  vi.spyOn(SettingsService.prototype, 'registerAction').mockImplementation(function (
    this: SettingsService,
    namespace: string,
    actionId: string,
    handler: SettingsActionHandler,
  ) {
    register.call(this, namespace, actionId, (input) => {
      invoked.add(`${namespace}/${actionId}`);
      return handler(input);
    });
  });
  let service: SettingsService | undefined;
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService: (name: string, svc: unknown) => {
      if (name === 'settings') service = svc as SettingsService;
    },
    getService: (name: string) => {
      throw new Error(`fixture: no '${name}' service`);
    },
  } as unknown as PluginContext;
  await new SettingsServicePlugin({ env: {} }).init(ctx);
  if (!service) throw new Error('fixture: the plugin registered no settings service');
  return { service, invoked };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('[#24769] the default composition answers every declared settings action button', () => {
  it('enumerates the declared population — the two buttons this card is about among it', () => {
    const declared = declaredRouteActions().map((a) => `${a.namespace}/${a.actionId}`);
    expect(declared).toEqual(
      expect.arrayContaining([
        'ai/test',
        'ai/reset',
        'ai/test_embedder',
        'knowledge/test',
        'mail/test',
        'sms/test',
        'storage/test',
      ]),
    );
  });

  it('each button targets its own namespace and its own id on the route', () => {
    for (const a of declaredRouteActions()) {
      expect(a.namespace, `${a.manifestNamespace}.${a.buttonId}`).toBe(a.manifestNamespace);
      expect(a.actionId, `${a.manifestNamespace}.${a.buttonId}`).toBe(a.buttonId);
    }
  });

  it('every declared action reaches a handler — none answers "no handler registered"', async () => {
    const { service, invoked } = await bootDefaultPlugin();
    const unanswered: string[] = [];
    for (const { namespace, actionId } of declaredRouteActions()) {
      const result = await service.runAction(namespace, actionId, {}, {});
      if (!invoked.has(`${namespace}/${actionId}`) && !result.ok) unanswered.push(`${namespace}/${actionId}`);
    }
    expect(unanswered).toEqual([]);
  });
});

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

async function post(http: MockHttp, namespace: string, actionId: string, body: unknown) {
  const req = { params: { namespace, actionId }, query: {}, body, headers: {}, method: 'POST', path: '/' } as IHttpRequest;
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: (data: unknown) => { state.body = data; },
    send: () => {},
    status: (code: number) => { state.status = code; return res; },
    header: () => res,
  } as unknown as IHttpResponse;
  await http.routes.get('POST /api/settings/:namespace/:actionId')!(req, res);
  return state;
}

describe('[#24769] the two buttons the card measured, at the HTTP door', () => {
  // A platform admin: both namespaces gate reads and writes (and so actions) on
  // `manage_platform_settings`.
  const admin = () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' });

  it('POST /api/settings/ai/test_embedder is answered by the embedder check (200, not 400)', async () => {
    const { service } = await bootDefaultPlugin();
    const http = new MockHttp();
    registerSettingsRoutes(http, service, { contextFromRequest: admin });
    const answer = await post(http, 'ai', 'test_embedder', {
      values: { embedder_provider: 'openai', embedder_api_key: 'sk-test', embedder_model: 'text-embedding-3-small' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.ok).toBe(true);
    expect(answer.body?.data?.message).toContain('text-embedding-3-small');
  });

  it('POST /api/settings/knowledge/test is answered by the adapter check (200, not 400)', async () => {
    const { service } = await bootDefaultPlugin();
    const http = new MockHttp();
    registerSettingsRoutes(http, service, { contextFromRequest: admin });
    const answer = await post(http, 'knowledge', 'test', {
      values: { adapter: 'ragflow', ragflow_base_url: 'http://localhost:9380', ragflow_api_key: 'k' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.ok).toBe(true);
    expect(answer.body?.data?.message).toContain('localhost:9380');
  });
});
