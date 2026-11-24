// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cloud-managed environment does not offer its file storage or its AI
 * provider settings at the settings doors (#33891, `cloud-managed-settings.ts`).
 *
 * Every door is driven twice on the same composition: once with
 * `OS_CLOUD_MANAGED=1` (hosted) and once without it (self-hosted, the control,
 * which must answer exactly as before). Refusals are pinned by envelope
 * (status + `error.code` + `details.managedBy`), which is what the console and
 * an API caller read.
 *
 * The data-API read of the rows is pinned beside the read door's own suite
 * (`settings-read-door.pin.test.ts`), on the real engine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects';
import type { IHttpRequest, IHttpResponse } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { MockHttp } from './__tests__/settings-door.testkit.js';
import { aiSettingsManifest, builtinSettingsManifests } from './manifests/index.js';
import {
  CLOUD_MANAGED_HIDDEN_SETTINGS,
  CLOUD_MANAGED_SERVED_AI_KEYS,
} from './cloud-managed-settings.js';

const HIDDEN_AI = CLOUD_MANAGED_HIDDEN_SETTINGS.ai.keys as readonly string[];

function hosted(on: boolean): void {
  if (on) process.env.OS_CLOUD_MANAGED = '1';
  else delete process.env.OS_CLOUD_MANAGED;
  resetCloudManagedForTesting();
}

async function boot(): Promise<{ service: SettingsService; http: MockHttp }> {
  const service = new SettingsService({ env: {} });
  for (const m of builtinSettingsManifests) service.registerManifest(m as any);
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
  const req = { params, query: {}, body: body ?? {}, headers: {}, method, path: '/' } as IHttpRequest;
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

const LIST = 'GET /api/settings';
const READ = 'GET /api/settings/:namespace';
const WRITE = 'PUT /api/settings/:namespace';
const ACTION = 'POST /api/settings/:namespace/:actionId';

function expectManaged(answer: { status: number; body?: any }, namespace: string): void {
  expect(answer.status).toBe(409);
  expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
  expect(answer.body?.error?.details?.managedBy).toBe('platform');
  expect(answer.body?.error?.details?.namespace).toBe(namespace);
}

const keysOf = (manifest: any): string[] =>
  (manifest?.specifiers ?? []).map((s: any) => s.key).filter((k: unknown): k is string => typeof k === 'string');
const idsOf = (manifest: any, type: string): string[] =>
  (manifest?.specifiers ?? []).filter((s: any) => s.type === type).map((s: any) => s.id);

describe('#33891 — the hosted projection table', () => {
  it('classifies every ai key: hidden, or served — none both, none neither', () => {
    const declared = keysOf(aiSettingsManifest);
    const served = new Set(CLOUD_MANAGED_SERVED_AI_KEYS);
    for (const key of declared) expect(HIDDEN_AI.includes(key) !== served.has(key), key).toBe(true);
    for (const key of served) expect(declared, key).toContain(key);
    for (const key of HIDDEN_AI) expect(served.has(key), key).toBe(false);
    // The ruled split: provider, model, credentials, temperature, max output
    // and timeout hidden; titles and observability served.
    expect(HIDDEN_AI).toEqual(expect.arrayContaining(['provider', 'openai_model', 'openai_api_key', 'temperature', 'max_tokens', 'request_timeout_ms']));
    expect([...served].sort()).toEqual(['log_prompts', 'title_generation_enabled', 'title_max_length', 'trace_enabled']);
  });
});

for (const managed of [true, false]) {
  describe(`#33891 — the settings doors, ${managed ? 'cloud-managed' : 'self-hosted (control)'}`, () => {
    let service: SettingsService;
    let http: MockHttp;
    beforeEach(async () => {
      hosted(managed);
      ({ service, http } = await boot());
    });
    afterEach(() => hosted(false));

    it('GET /api/settings: storage is listed only self-hosted; ai is listed either way, without its hidden keys when hosted', async () => {
      const answer = await call(http, LIST, {});
      expect(answer.status).toBe(200);
      const manifests = answer.body?.data?.manifests as any[];
      const namespaces = manifests.map((m) => m.namespace);
      expect(namespaces).toEqual(expect.arrayContaining(['ai', 'mail']));
      const ai = manifests.find((m) => m.namespace === 'ai');
      expect(keysOf(ai)).toEqual(expect.arrayContaining([...CLOUD_MANAGED_SERVED_AI_KEYS]));
      if (managed) {
        expect(namespaces).not.toContain('storage');
        for (const key of HIDDEN_AI) expect(keysOf(ai), key).not.toContain(key);
      } else {
        expect(namespaces).toContain('storage');
        expect(keysOf(ai)).toEqual(expect.arrayContaining([...HIDDEN_AI]));
      }
    });

    it('GET /api/settings/storage is refused as platform-managed when hosted, served self-hosted', async () => {
      const answer = await call(http, READ, { namespace: 'storage' });
      if (managed) expectManaged(answer, 'storage');
      else expect(answer.status).toBe(200);
    });

    it('GET /api/settings/ai serves titles and observability; the hidden keys, their sections and the refused buttons only self-hosted', async () => {
      const answer = await call(http, READ, { namespace: 'ai' });
      expect(answer.status).toBe(200);
      const { manifest, values } = answer.body?.data ?? {};
      expect(keysOf(manifest)).toEqual(expect.arrayContaining([...CLOUD_MANAGED_SERVED_AI_KEYS]));
      expect(Object.keys(values)).toEqual(expect.arrayContaining([...CLOUD_MANAGED_SERVED_AI_KEYS]));
      expect(idsOf(manifest, 'group')).toEqual(expect.arrayContaining(['titles', 'observability']));
      if (managed) {
        for (const key of HIDDEN_AI) {
          expect(keysOf(manifest), key).not.toContain(key);
          expect(Object.keys(values), key).not.toContain(key);
        }
        for (const group of ['provider', 'openai', 'defaults', 'embedder']) expect(idsOf(manifest, 'group'), group).not.toContain(group);
        expect(idsOf(manifest, 'action_button')).toEqual([]);
      } else {
        expect(keysOf(manifest)).toEqual(expect.arrayContaining([...HIDDEN_AI]));
        expect(idsOf(manifest, 'group')).toEqual(expect.arrayContaining(['provider', 'defaults', 'embedder']));
        expect(idsOf(manifest, 'action_button')).toEqual(expect.arrayContaining(['test', 'reset', 'test_embedder']));
      }
    });

    it('PUT /api/settings/storage is refused as platform-managed when hosted', async () => {
      const answer = await call(http, WRITE, { namespace: 'storage' }, { adapter: 'local' });
      if (managed) expectManaged(answer, 'storage');
      else expect(answer.status).not.toBe(409);
    });

    it('a write naming a hidden ai key is refused WHOLE when hosted: the served key beside it is not written either', async () => {
      const answer = await call(http, WRITE, { namespace: 'ai' }, { temperature: 0.2, title_max_length: 20 });
      const stored = (await service.get('ai', 'title_max_length')).value;
      if (managed) {
        expectManaged(answer, 'ai');
        expect(answer.body?.error?.details?.keys).toEqual(['temperature']);
        expect(stored).not.toBe(20);
      } else {
        expect(answer.status).toBe(200);
        expect(stored).toBe(20);
      }
    });

    it('a write of served ai keys only is written either way', async () => {
      const answer = await call(http, WRITE, { namespace: 'ai' }, { title_max_length: 24, trace_enabled: false });
      expect(answer.status).toBe(200);
      expect((await service.get('ai', 'title_max_length')).value).toBe(24);
    });

    for (const [namespace, actionId] of [['storage', 'test'], ['ai', 'test'], ['ai', 'test_embedder'], ['ai', 'reset']] as const) {
      it(`POST /api/settings/${namespace}/${actionId} is refused as platform-managed when hosted only`, async () => {
        const answer = await call(http, ACTION, { namespace, actionId }, { values: {} });
        if (managed) expectManaged(answer, namespace);
        else expect(answer.status).not.toBe(409);
      });
    }

    it('the in-process reader keeps reading every value: the registry is whole', async () => {
      const storage = await service.getNamespace('storage');
      expect(Object.keys(storage.values).length).toBeGreaterThan(0);
      await expect(service.get('ai', 'provider')).resolves.toBeDefined();
    });
  });
}

describe('#33891 — the Setup entry', () => {
  const items = SETUP_NAV_CONTRIBUTIONS.flatMap((c) => (c.items ?? []) as Array<{ id?: string; visible?: unknown }>);

  it('the File Storage entry is drawn only where the environment is not cloud-managed', () => {
    expect(items.find((i) => i.id === 'nav_settings_storage')?.visible).toBe('features.cloudManaged != true');
  });

  it('the AI entry stays: its titles and observability are served when hosted', () => {
    const ai = items.find((i) => i.id === 'nav_settings_ai');
    expect(ai).toBeDefined();
    expect(ai?.visible).toBeUndefined();
  });
});
