// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { SettingsService } from '../settings-service.js';
import { aiSettingsManifest, aiTestActionHandler, aiTestEmbedderActionHandler } from './ai.manifest.js';

describe('aiSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(aiSettingsManifest)).not.toThrow();
  });

  it('declares namespace=ai, scope=global, version=1', () => {
    const parsed = SettingsManifestSchema.parse(aiSettingsManifest);
    expect(parsed.namespace).toBe('ai');
    expect(parsed.scope).toBe('global');
    expect(parsed.version).toBe(1);
  });

  it('exposes provider select with memory + gateway + SDK + OpenAI-compatible presets', () => {
    const provider = (aiSettingsManifest.specifiers as any[]).find(
      (s) => s.key === 'provider' && s.type === 'select',
    );
    expect(provider).toBeDefined();
    const values = provider.options.map((o: any) => o.value).sort();
    expect(values).toEqual([
      'anthropic',
      'cloudflare',
      'dashscope',
      'deepseek',
      'gateway',
      'google',
      'memory',
      'openai',
      'openrouter',
      'siliconflow',
    ]);
    expect(provider.default).toBe('memory');
  });

  it('marks every per-provider api key field as encrypted password input', () => {
    const keys = ['openai_api_key', 'anthropic_api_key', 'google_api_key', 'gateway_api_key'];
    for (const key of keys) {
      const f = (aiSettingsManifest.specifiers as any[]).find((s) => s.key === key);
      expect(f, `${key} missing`).toBeDefined();
      expect(f.type).toBe('password');
      expect(f.encrypted).toBe(true);
    }
  });

  it('exposes a test action that POSTs to /api/settings/ai/test', () => {
    const test = (aiSettingsManifest.specifiers as any[]).find(
      (s) => s.type === 'action_button' && s.id === 'test',
    );
    expect(test).toBeDefined();
    expect(test.handler).toEqual({ kind: 'http', method: 'POST', url: '/api/settings/ai/test' });
  });
});

/** Mirror how the service invokes a handler: full input, never a partial. */
const runTest = (values: Record<string, unknown>) =>
  aiTestActionHandler({ namespace: 'ai', actionId: 'test', values, ctx: {} });
const runTestEmbedder = (values: Record<string, unknown>) =>
  aiTestEmbedderActionHandler({ namespace: 'ai', actionId: 'test_embedder', values, ctx: {} });

describe('aiTestActionHandler', () => {
  it('returns warning for memory provider (no external call to validate)', async () => {
    const r = await runTest({ provider: 'memory' });
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('warning');
  });

  it('rejects gateway provider without gateway_model', async () => {
    const r = await runTest({ provider: 'gateway' });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('rejects openai provider without api key', async () => {
    const r = await runTest({ provider: 'openai' });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('accepts openai provider with api key and reports the model', async () => {
    const r = await runTest({
      provider: 'openai',
      openai_api_key: 'sk-test',
      openai_model: 'gpt-4o',
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('gpt-4o');
  });

  it('accepts anthropic with api key', async () => {
    const r = await runTest({ provider: 'anthropic', anthropic_api_key: 'sk-ant-test' });
    expect(r.ok).toBe(true);
  });
});

describe('aiTestEmbedderActionHandler', () => {
  it('warns when the embedder is disabled', async () => {
    const r = await runTestEmbedder({ embedder_provider: 'none' });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
  });

  it('requires an api key for non-ollama providers', async () => {
    const r = await runTestEmbedder({ embedder_provider: 'openai' });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
    expect(r.message).toContain('API key');
  });
});

/**
 * #6550 — `temperature` declares a window, not a grid. Since #6199 a declared
 * `step` binds as a value constraint on both doors, and temperature's true
 * domain is continuous on [0, 2]: the old `step: 0.1` refused legal values
 * (`0.15`), the same declared-narrower-than-true-domain shape the #5712 ruling
 * corrected for timezone/currency. A slider's step feel is a UI-layer display
 * concern, not a contract refusal; `min`/`max` describe the real domain and
 * stay binding. #6199's grid machinery is untouched — its enforcement and
 * tests stand for any key that still declares `step`.
 */
describe('aiSettingsManifest — temperature declares a window, not a grid (#6550)', () => {
  const byKey = (k: string) => (aiSettingsManifest.specifiers as any[]).find((s) => s.key === k);

  it('declares min 0 / max 2 and NO step, and that round-trips the spec parse', () => {
    const t = byKey('temperature');
    expect(t.min).toBe(0);
    expect(t.max).toBe(2);
    expect(t.step).toBeUndefined();
    const parsed = SettingsManifestSchema.parse(aiSettingsManifest) as any;
    const pt = parsed.specifiers.find((s: any) => s.key === 'temperature');
    expect(pt.min).toBe(0);
    expect(pt.max).toBe(2);
    expect(pt.step).toBeUndefined();
  });

  it('write door: accepts 0.15 — the refusal that forced the ruling — and still 0.7', async () => {
    // `temperature` is `visible: "${data.provider !== 'memory'}"` and the
    // default provider is `memory`, so the patch carries a real provider (and
    // its required key) — otherwise the TOUCH/visible contract skips the
    // specifier entirely and this test would be green for the wrong reason.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(aiSettingsManifest);
    await expect(
      svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test', temperature: 0.15 }),
    ).resolves.toBeDefined();
    expect((await svc.get('ai', 'temperature')).value).toBe(0.15);
    // …and the values the slider emits keep working, of course.
    await expect(
      svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test', temperature: 0.7 }),
    ).resolves.toBeDefined();
    expect((await svc.get('ai', 'temperature')).value).toBe(0.7);
  });

  it('write door: the window still binds — out-of-range values are refused in the min/max vocabulary', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(aiSettingsManifest);
    await expect(
      svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test', temperature: 2.5 }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        { field: 'temperature', code: 'max_value', constraint: { min: 0, max: 2 }, value: 2.5 },
      ],
    });
    await expect(
      svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test', temperature: -0.5 }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        { field: 'temperature', code: 'min_value', constraint: { min: 0, max: 2 }, value: -0.5 },
      ],
    });
    // Atomic: nothing landed.
    expect((await svc.get('ai', 'temperature')).source).toBe('default');
  });

  it('env door: OS_AI_TEMPERATURE=0.15 wins the cascade and locks the key', async () => {
    // The mirror of the write door — #6199 judges both doors at the ONE
    // decision point, so removing the grid frees this door too.
    const errors: string[] = [];
    const svc = new SettingsService({
      env: { OS_AI_TEMPERATURE: '0.15' },
      logger: { error: (m: string) => void errors.push(m) },
    });
    svc.registerManifest(aiSettingsManifest);
    const r = await svc.get('ai', 'temperature');
    expect(r.value).toBe(0.15);
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(r.cascadeChain?.some((e) => e.scope === 'env')).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('env door: an out-of-window OS_AI_TEMPERATURE is still loudly ignored', async () => {
    // The window survives the grid's removal: `2.5` sits outside `max: 2`.
    const errors: string[] = [];
    const svc = new SettingsService({
      env: { OS_AI_TEMPERATURE: '2.5' },
      logger: { error: (m: string) => void errors.push(m) },
    });
    svc.registerManifest(aiSettingsManifest);
    const r = await svc.get('ai', 'temperature');
    expect(r.value).toBe(0.7); // the manifest default, not 2.5
    expect(r.source).toBe('default');
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_AI_TEMPERATURE');
    expect(errors[0]).toContain('IGNORED');
    expect(errors[0]).toContain('does NOT take effect');
  });
});

describe('aiSettingsManifest — embedder section', () => {
  it('exposes embedder_provider select with 10 options incl. none + 5 Chinese providers', () => {
    const f = (aiSettingsManifest.specifiers as any[]).find(
      (s) => s.key === 'embedder_provider' && s.type === 'select',
    );
    expect(f).toBeDefined();
    expect(f.default).toBe('none');
    const values = f.options.map((o: any) => o.value);
    for (const expected of [
      'none', 'openai', 'azure', 'dashscope', 'zhipu',
      'siliconflow', 'doubao', 'minimax', 'ollama', 'custom',
    ]) {
      expect(values, `missing: ${expected}`).toContain(expected);
    }
  });

  it('marks embedder_api_key as encrypted password', () => {
    const f = (aiSettingsManifest.specifiers as any[]).find((s) => s.key === 'embedder_api_key');
    expect(f).toBeDefined();
    expect(f.type).toBe('password');
    expect(f.encrypted).toBe(true);
  });

  it('exposes embedder test action wired to /api/settings/ai/test_embedder', () => {
    const f = (aiSettingsManifest.specifiers as any[]).find(
      (s) => s.type === 'action_button' && s.id === 'test_embedder',
    );
    expect(f).toBeDefined();
    expect(f.handler).toEqual({
      kind: 'http',
      method: 'POST',
      url: '/api/settings/ai/test_embedder',
    });
  });
});
