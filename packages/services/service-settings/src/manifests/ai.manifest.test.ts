// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { PLATFORM_CAPABILITY_PROVIDERS } from '@objectstack/spec/kernel';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { PluginContext } from '@objectstack/core';
import { SettingsService } from '../settings-service.js';
import { SettingsServicePlugin } from '../settings-service-plugin.js';
import { registerSettingsRoutes } from '../settings-routes.js';
import type { CryptoAdapter } from '../crypto-adapter.js';
import {
  aiSettingsManifest,
  aiEmbedderSettingsSpecifiers,
  withAiEmbedderSection,
  aiTestActionHandler,
  aiTestEmbedderActionHandler,
  aiProviderTestActionHandlers,
} from './ai.manifest.js';
import {
  AI_PROVIDERS,
  AI_MODEL_RULE_KEYS,
  parseAiModelList,
  registerAiModelRules,
  resolveAiModelConfiguration,
  type AiProviderId,
} from './ai-models.js';

/**
 * #8026 — the write-door cases below save a complete `openai` provider config,
 * which includes `openai_api_key` (a declared secret). Since the settings write
 * path fails CLOSED on a secret it cannot protect, the fixture supplies an
 * adapter that DECLARES confidentiality; without it these cases would be
 * measuring the crypto gate instead of `temperature`'s declared window.
 */
class ConfidentialTestAdapter implements CryptoAdapter {
  readonly confidential = true;
  async encrypt(plaintext: string): Promise<string> {
    return 'kms:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  async decrypt(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.replace(/^kms:/, ''), 'base64').toString('utf8');
  }
  digest(): string {
    return 'fnv32:deadbeef';
  }
}

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

  it('exposes provider select with gateway + SDK + OpenAI-compatible presets', () => {
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
      'openai',
      'openrouter',
      'siliconflow',
    ]);
    // #31960: no default — an unset provider reads as unset, not as a provider.
    expect(provider.default).toBeUndefined();
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
  it('no longer answers memory as a provider (#31960): it fails like any provider with no key', async () => {
    const r = await runTest({ provider: 'memory' });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
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
    // The patch carries a real provider (and its required key), as the
    // console's form does once a provider is chosen.
    const svc = new SettingsService({ env: {}, crypto: new ConfidentialTestAdapter() });
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
    const svc = new SettingsService({ env: {}, crypto: new ConfidentialTestAdapter() });
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

describe('aiSettingsManifest — the log_prompts PII warning is an info_banner', () => {
  const specs = aiSettingsManifest.specifiers as any[];
  const sectionOf = (i: number) => specs.slice(0, i + 1).reverse().find((s) => s.type === 'group')?.id;

  it('declares it as a warning-severity info_banner with an id, a title and a body', () => {
    const banners = specs.filter((s) => s.type === 'info_banner');
    expect(banners.map((b) => [b.id, b.bannerSeverity])).toEqual([['log_prompts_warning', 'warning']]);
    expect(typeof banners[0].label).toBe('string');
    expect(banners[0].label.length).toBeGreaterThan(0);
    expect(banners[0].bannerText.length).toBeGreaterThan(0);
  });

  it('places it in the Observability section, directly under the log_prompts toggle', () => {
    const i = specs.findIndex((s) => s.id === 'log_prompts_warning');
    expect(sectionOf(i)).toBe('observability');
    expect(specs[i - 1].key).toBe('log_prompts');
  });

  it('carries the warning glyph nowhere — the banner severity is the only warning marker', () => {
    expect(JSON.stringify(aiSettingsManifest)).not.toContain('⚠');
  });
});

describe('aiEmbedderSettingsSpecifiers — the embedder section the knowledge service contributes', () => {
  it('exposes embedder_provider select with 10 options incl. none + 5 Chinese providers', () => {
    const f = (aiEmbedderSettingsSpecifiers as any[]).find(
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
    const f = (aiEmbedderSettingsSpecifiers as any[]).find((s) => s.key === 'embedder_api_key');
    expect(f).toBeDefined();
    expect(f.type).toBe('password');
    expect(f.encrypted).toBe(true);
  });

  it('exposes embedder test action wired to /api/settings/ai/test_embedder', () => {
    const f = (aiEmbedderSettingsSpecifiers as any[]).find(
      (s) => s.type === 'action_button' && s.id === 'test_embedder',
    );
    expect(f).toBeDefined();
    expect(f.handler).toEqual({
      kind: 'http',
      method: 'POST',
      url: '/api/settings/ai/test_embedder',
    });
  });

  it('parses inside the ai manifest it joins, and only joins it once', () => {
    const joined = withAiEmbedderSection(aiSettingsManifest);
    expect(() => SettingsManifestSchema.parse(joined)).not.toThrow();
    expect(joined.specifiers).toHaveLength(aiSettingsManifest.specifiers.length + aiEmbedderSettingsSpecifiers.length);
    expect(withAiEmbedderSection(joined)).toBe(joined);
  });
});

/**
 * The card behind commit 99ccbb9c8: the live-call hint an operator reads under "Test connection" in
 * Settings -> AI must carry the edition boundary the platform's own capability
 * roster already records. `PLATFORM_CAPABILITY_PROVIDERS.ai` declares
 * `edition: 'cloud'` ("no installable version in the open edition"), while the
 * hint used to say only "Mount @objectstack/service-ai to exercise live calls"
 * on all three real-provider branches.
 *
 * Pinned as a PROPERTY, not as a literal sentence: these assertions read the
 * roster entry here and require the message to carry its `package` and its
 * `note`, so the wording stays free to improve, but strip the note from spec —
 * or stop interpolating it — and they fail. A sentence copied into this file
 * would be one more hand-written copy of the very claim this card is about,
 * free to drift from spec with the test still green. Same shape PR #11266
 * established for the CLI's enterprise hint.
 */
describe('aiTestActionHandler — live-call hint carries the cloud boundary (#11318)', () => {
  const ai = PLATFORM_CAPABILITY_PROVIDERS.ai;

  it('the roster still answers this question — the premise the rest rests on', () => {
    expect(ai, 'PLATFORM_CAPABILITY_PROVIDERS must still carry an `ai` entry').toBeTruthy();
    expect(ai.package).toBe('@objectstack/service-ai');
    expect(ai.edition).toBe('cloud');
    expect(ai.note, 'the cloud entry must carry an edition note to surface').toBeTruthy();
  });

  // All three branches that print the hint, each exercised separately so a fix
  // applied to one cannot stand in for the others.
  const branches: Array<[string, Record<string, unknown>]> = [
    ['the Vercel AI Gateway branch', { provider: 'gateway', gateway_model: 'openai/gpt-4o' }],
    [
      'the Cloudflare AI Gateway branch',
      { provider: 'cloudflare', cloudflare_account_id: 'acct-1', cloudflare_api_key: 'cf-key' },
    ],
    [
      'the plain SDK-provider branch',
      { provider: 'openai', openai_api_key: 'sk-test', openai_model: 'gpt-4o' },
    ],
  ];

  for (const [label, values] of branches) {
    it(`states the boundary on ${label}`, async () => {
      const r = await runTest(values);
      // Unchanged outcome: this is a boundary added to an advisory message,
      // not a new refusal.
      expect(r.ok).toBe(true);
      expect(r.severity).toBe('info');
      const message = String(r.message);
      // The instruction is KEPT — an operator may well have a cloud tier.
      expect(message).toContain(ai.package);
      // ...and now carries spec's own note, verbatim rather than re-typed.
      expect(message).toContain(ai.note!);
      expect(message).toMatch(/no open-edition version to install/);
      // The un-followable form this card retired: the package named, bare.
      expect(message).not.toMatch(/Mount @objectstack\/service-ai to exercise live calls/);
    });
  }

  // The embedder hint used to stand here as this block's contrast control — a
  // plain "Mount @objectstack/embedder-openai + a knowledge adapter to exercise
  // live calls", kept because that package IS built in this repo. Followable,
  // but measured false for the button it answered (#24769): no package in this
  // repo registers `ai/test_embedder`, so mounting it never made "Test
  // embedder" live. Its replacement is pinned with the embedder handler below;
  // the three branches above are still exercised one by one, so a blanket
  // rewording cannot stand in for them.
});

/**
 * #24769 — "Test embedder" is now answered (the knowledge service registers
 * the handler with the embedder section it contributes, #33933), and what it
 * answers is a form check: no embedding request is
 * sent and no package in this repo replaces it with a live probe. A green
 * answer must say so, and must not name a package whose mounting would make the
 * check live.
 */
describe('aiTestEmbedderActionHandler — a form check says it is one (#24769)', () => {
  it('states that no embedding request was sent, and promises no live call', async () => {
    const r = await runTestEmbedder({
      embedder_provider: 'openai',
      embedder_api_key: 'sk-test',
      embedder_model: 'text-embedding-3-small',
    });
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('info');
    const message = String(r.message);
    expect(message).toContain('text-embedding-3-small');
    expect(message).toMatch(/no embedding request was sent/);
    expect(message).not.toMatch(/to exercise live calls/);
  });
});

/**
 * #31960 — Setup → AI presented "Memory (echo — testing only)" as the chosen
 * provider on a host where AI is disabled, and saved it with a success toast
 * although the AI runtime never honours it. The manifest now declares no
 * provider default and no longer offers `memory`: an unset provider reads as
 * unset, the save door refuses `memory` through the declared option table, and
 * the open-edition "Test connection" stub stops reading an absent provider as
 * memory. Whether AI is disabled is the AI runtime's own decision, stated on
 * the page by that runtime (`registerLiveStatus`), never re-derived here.
 */
describe('aiSettingsManifest — no provider is presented until one is configured (#31960)', () => {
  const providerSpec = () =>
    (aiSettingsManifest.specifiers as any[]).find((s) => s.key === 'provider' && s.type === 'select');
  // `withEmbedder` registers the page as a deployment that mounts the
  // knowledge service serves it (`withAiEmbedderSection`, #33933).
  const aiSvc = (env: Record<string, string> = {}, errors: string[] = [], withEmbedder = false) => {
    const svc = new SettingsService({
      env,
      crypto: new ConfidentialTestAdapter(),
      logger: { error: (m: string) => void errors.push(m) },
    });
    svc.registerManifest(withEmbedder ? withAiEmbedderSection(aiSettingsManifest) : aiSettingsManifest);
    return svc;
  };

  it('declares no provider default and does not offer memory', () => {
    const spec = providerSpec();
    expect(spec).toBeDefined();
    expect('default' in spec).toBe(false);
    expect(spec.options.map((o: any) => o.value)).not.toContain('memory');
    const parsed = SettingsManifestSchema.parse(aiSettingsManifest) as any;
    expect(parsed.specifiers.find((s: any) => s.key === 'provider').default).toBeUndefined();
  });

  it('an unset provider reads as null from the default rung', async () => {
    const r = await aiSvc().get('ai', 'provider');
    expect(r.value).toBeNull();
    expect(r.source).toBe('default');
    expect(r.locked).toBe(false);
  });

  it('save door: memory is refused as a value outside the option table, and nothing is stored', async () => {
    const svc = aiSvc();
    await expect(svc.setMany('ai', { provider: 'memory' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'provider', code: 'invalid_option', value: 'memory' }],
    });
    const r = await svc.get('ai', 'provider');
    expect(r.value).toBeNull();
    expect(r.source).toBe('default');
  });

  it('env door: OS_AI_PROVIDER=memory is loudly ignored and the provider stays unset', async () => {
    const errors: string[] = [];
    const r = await aiSvc({ OS_AI_PROVIDER: 'memory' }, errors).get('ai', 'provider');
    expect(r.value).toBeNull();
    expect(r.source).toBe('default');
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_AI_PROVIDER');
    expect(errors[0]).toContain('IGNORED');
  });

  it('a memory row stored before the option left the table is served as stored, never throws, and locks nothing', async () => {
    // Simulated as it happens on an upgraded host: written under the OLD
    // table, then the narrowed manifest registered over the same namespace
    // (the `mail.provider` / `sendgrid` precedent in settings-service.test.ts).
    const svc = new SettingsService({ env: {}, crypto: new ConfidentialTestAdapter() });
    svc.registerManifest({
      ...aiSettingsManifest,
      specifiers: (aiSettingsManifest.specifiers as any[]).map((s) =>
        s.key === 'provider' ? { ...s, options: [{ value: 'memory', label: 'Memory' }, ...s.options] } : s,
      ),
    } as any);
    await svc.setMany('ai', { provider: 'memory' });
    svc.registerManifest(aiSettingsManifest);

    const r = await svc.get('ai', 'provider');
    expect(r.value).toBe('memory');
    expect(r.source).toBe('global');
    await expect(svc.getMany('ai', ['provider', 'temperature'])).resolves.toBeDefined();
    // Unrelated keys still save; re-writing memory is refused; a real provider
    // replaces it; a reset clears the namespace.
    await expect(svc.setMany('ai', { trace_enabled: false })).resolves.toBeDefined();
    await expect(svc.setMany('ai', { provider: 'memory' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'provider', code: 'invalid_option' }],
    });
    await expect(
      svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test' }),
    ).resolves.toBeDefined();
    expect((await svc.get('ai', 'provider')).value).toBe('openai');
    await expect(svc.resetNamespace('ai')).resolves.toBeGreaterThan(0);
    expect((await svc.get('ai', 'provider')).value).toBeNull();
  });

  it('a real provider saves and reads exactly as before', async () => {
    const svc = aiSvc();
    await expect(
      svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test', openai_model: 'gpt-4o' }),
    ).resolves.toBeDefined();
    const r = await svc.get('ai', 'provider');
    expect(r.value).toBe('openai');
    expect(r.source).toBe('global');
  });

  it('provider is not required: with nothing stored, an embedder-only save and a trace-only save resolve', async () => {
    // The console blocks a page save on any visible required key that reads
    // empty, so an unset provider must not be a required one: the Embedder and
    // Observability sections save on their own, and a provider configured by
    // boot environment variables keeps working with nothing stored here.
    expect(providerSpec().required).toBe(false);
    const parsed = SettingsManifestSchema.parse(aiSettingsManifest) as any;
    expect(parsed.specifiers.find((s: any) => s.key === 'provider').required).toBe(false);
    const svc = aiSvc({}, [], true);
    await expect(
      svc.setMany('ai', { embedder_provider: 'openai', embedder_api_key: 'k', embedder_model: 'text-embedding-3-small' }),
    ).resolves.toBeDefined();
    await expect(svc.setMany('ai', { trace_enabled: false })).resolves.toBeDefined();
    await expect(svc.setMany('ai', { temperature: 0.3 })).resolves.toBeDefined();
    expect((await svc.get('ai', 'embedder_provider')).value).toBe('openai');
    expect((await svc.get('ai', 'trace_enabled')).value).toBe(false);
    expect((await svc.get('ai', 'provider')).value).toBeNull();
  });

  it('an empty provider in a save is accepted: null clears to unset, an empty string reads as not configured', async () => {
    const svc = aiSvc();
    await svc.setMany('ai', { provider: 'openai', openai_api_key: 'sk-test' });
    // `null` is a clear: the key falls back to the default rung, which is unset.
    await expect(svc.setMany('ai', { provider: null, trace_enabled: true })).resolves.toBeDefined();
    const cleared = await svc.get('ai', 'provider');
    expect(cleared.value).toBeNull();
    expect(cleared.source).toBe('default');
    // `''` is stored as given (no option check judges an empty value), and the
    // Test connection stub reads it as not configured.
    await expect(svc.setMany('ai', { provider: '' })).resolves.toBeDefined();
    const blank = await svc.get('ai', 'provider');
    expect(blank.value).toBe('');
    const r = await runTest({ provider: blank.value });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
  });

  it('with no provider the generation fields show, so their declared windows bind on a save', async () => {
    // On main these fields were hidden while the provider was memory (the
    // default), and a hidden specifier is not validated: `temperature: 5`
    // was stored. They now always show, so the window refuses it.
    const svc = aiSvc();
    await expect(svc.setMany('ai', { temperature: 5 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'temperature', code: 'max_value', constraint: { min: 0, max: 2 }, value: 5 }],
    });
    expect((await svc.get('ai', 'temperature')).source).toBe('default');
  });

  it('Test connection with no provider answers that none is configured, not a memory echo', async () => {
    for (const values of [{}, { provider: null }, { provider: '' }]) {
      const r = await runTest(values);
      expect(r.ok).toBe(false);
      expect(r.severity).toBe('warning');
      expect(r.message).not.toMatch(/memory|echo/i);
    }
  });
});

describe('aiSettingsManifest — several providers at once, a model list each, a default and a structured-output model', () => {
  const specs = () => aiSettingsManifest.specifiers as any[];
  const byKey = (k: string) => specs().find((s) => s.key === k);
  const byId = (id: string) => specs().find((s) => s.id === id);

  /** A service carrying the `ai` page and its save rule, as the settings plugin registers both. */
  const ruled = (env: Record<string, string> = {}) => {
    const svc = new SettingsService({ env, crypto: new ConfidentialTestAdapter() });
    svc.registerManifest(aiSettingsManifest);
    registerAiModelRules(svc, aiSettingsManifest);
    return svc;
  };

  /** OpenAI as the default provider and Anthropic beside it, each with two models. */
  const twoProviders = {
    provider: 'openai',
    openai_api_key: 'sk-openai-secret',
    openai_model: 'gpt-4o',
    openai_models: 'gpt-4o-mini',
    anthropic_enabled: true,
    anthropic_api_key: 'sk-ant-secret',
    anthropic_model: 'claude-sonnet-4-20250514',
    anthropic_models: 'claude-haiku-4-5',
  };

  const values = async (svc: SettingsService) => {
    const payload = await svc.getNamespace('ai');
    return Object.fromEntries(Object.entries(payload.values).map(([k, v]) => [k, (v as any)?.value]));
  };

  it('declares, per provider, an on/off toggle beside the default provider, a model list, and its own Test connection', () => {
    for (const { id } of AI_PROVIDERS) {
      expect(byKey(`${id}_enabled`), id).toMatchObject({ type: 'toggle', default: false });
      expect(byKey(`${id}_enabled`).visible, id).toBe(`\${data.provider !== '${id}'}`);
      expect(byKey(`${id}_models`), id).toMatchObject({ type: 'textarea' });
      expect(byId(`test_${id}`), id).toMatchObject({
        type: 'action_button',
        handler: { kind: 'http', method: 'POST', url: `/api/settings/ai/test_${id}` },
      });
      // The provider's section shows while it is the default provider or turned on.
      expect(byId(id).visible, id).toBe(`\${data.provider === '${id}' || data.${id}_enabled === true}`);
    }
    // One encrypted key per provider (Cloudflare's is its gateway token), as before.
    for (const { id } of AI_PROVIDERS) expect(byKey(`${id}_api_key`), id).toMatchObject({ type: 'password', encrypted: true });
  });

  it('keeps `provider` as the default provider, and adds the default and structured-output models with existing specifier kinds', () => {
    expect(byKey('provider')).toMatchObject({ type: 'select', label: 'Default provider' });
    expect(byKey('default_model')).toMatchObject({ type: 'text', required: false });
    expect(byKey('structured_output_provider')).toMatchObject({ type: 'select', required: false });
    expect(byKey('structured_output_provider').options.map((o: any) => o.value))
      .toEqual(byKey('provider').options.map((o: any) => o.value));
    expect(byKey('structured_output_model')).toMatchObject({ type: 'text', required: false });
    // Every specifier is one the spec declares: the whole page parses.
    expect(() => SettingsManifestSchema.parse(aiSettingsManifest)).not.toThrow();
  });

  it('a model list takes ids separated by line breaks or commas; the gateway list keeps the gateway model shape', async () => {
    expect(parseAiModelList(' gpt-4o-mini \n\n o3 , gpt-4o-mini,')).toEqual(['gpt-4o-mini', 'o3']);
    expect(parseAiModelList(null)).toEqual([]);
    const svc = ruled();
    await expect(svc.setMany('ai', { ...twoProviders, openai_models: 'gpt-4o-mini\no3' })).resolves.toBeDefined();
    await expect(
      svc.setMany('ai', { provider: 'gateway', gateway_model: 'openai/gpt-4o', gateway_models: 'anthropic/claude-sonnet-4.6\nnot-a-gateway-id' }),
    ).rejects.toMatchObject({ code: 'SETTINGS_VALIDATION', fields: [{ field: 'gateway_models', code: 'invalid_format' }] });
  });

  it('two providers on with two models each validate, and read back as two providers with their models', async () => {
    const svc = ruled();
    await expect(
      svc.setMany('ai', { ...twoProviders, default_model: 'gpt-4o-mini', structured_output_provider: 'anthropic', structured_output_model: 'claude-haiku-4-5' }),
    ).resolves.toBeDefined();
    expect(resolveAiModelConfiguration(await values(svc))).toEqual({
      providers: [
        { provider: 'openai', models: ['gpt-4o', 'gpt-4o-mini'] },
        { provider: 'anthropic', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5'] },
      ],
      defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
      structuredOutputModel: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    });
  });

  it('a default model outside the default provider\'s models is refused with a named error, and nothing is stored', async () => {
    const svc = ruled();
    await expect(svc.setMany('ai', { ...twoProviders, default_model: 'claude-haiku-4-5' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{
        field: 'default_model',
        code: 'invalid_value',
        constraint: { rule: 'default_model_not_listed', provider: 'openai', model: 'claude-haiku-4-5', models: ['gpt-4o', 'gpt-4o-mini'] },
      }],
    });
    expect((await svc.get('ai', 'provider')).value).toBeNull();
  });

  it('a later save that drops the default model from its provider\'s list is refused at the list it changes', async () => {
    const svc = ruled();
    await svc.setMany('ai', { ...twoProviders, default_model: 'gpt-4o-mini' });
    await expect(svc.setMany('ai', { openai_models: 'o3' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'openai_models', code: 'invalid_value', constraint: { rule: 'default_model_not_listed' } }],
    });
    // Changing the default model together with the list is accepted.
    await expect(svc.setMany('ai', { openai_models: 'o3', default_model: 'o3' })).resolves.toBeDefined();
    // Turning the structured-output provider off later is refused at its toggle.
    await svc.setMany('ai', { structured_output_provider: 'anthropic' });
    await expect(svc.setMany('ai', { anthropic_enabled: false })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'anthropic_enabled', code: 'invalid_value', constraint: { rule: 'structured_output_provider_off' } }],
    });
  });

  it('a structured-output provider that is off, or a model it does not list, is refused', async () => {
    const svc = ruled();
    await expect(
      svc.setMany('ai', { ...twoProviders, anthropic_enabled: false, structured_output_provider: 'anthropic' }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        { field: 'structured_output_provider', code: 'invalid_value', constraint: { rule: 'structured_output_provider_off', provider: 'anthropic' } },
      ],
    });
    await expect(
      svc.setMany('ai', { ...twoProviders, structured_output_model: 'claude-haiku-4-5' }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'structured_output_model', code: 'invalid_value', constraint: { rule: 'structured_output_model_not_listed', provider: 'openai' } }],
    });
  });

  it('the refusal is written in the caller\'s language', async () => {
    const svc = ruled();
    await expect(
      svc.setMany('ai', { ...twoProviders, default_model: 'o9' }, {}, { locale: 'zh-CN' }),
    ).rejects.toMatchObject({ fields: [{ field: 'default_model', message: expect.stringContaining('默认模型「o9」') }] });
  });

  it('a legacy single-provider value set reads as one enabled provider with that model as the default — no rewrite', async () => {
    const svc = ruled();
    // The shape a deployment stored before several providers existed.
    await svc.setMany('ai', { provider: 'deepseek', deepseek_api_key: 'sk-ds-secret', deepseek_model: 'deepseek-reasoner' });
    const read = await values(svc);
    expect(read.deepseek_enabled).toBe(false);
    expect(read.default_model).toBeNull();
    expect(resolveAiModelConfiguration(read)).toEqual({
      providers: [{ provider: 'deepseek', models: ['deepseek-reasoner'] }],
      defaultModel: { provider: 'deepseek', model: 'deepseek-reasoner' },
      structuredOutputModel: { provider: 'deepseek', model: 'deepseek-reasoner' },
    });
    // The stored model key keeps its value: nothing was rewritten.
    expect((await svc.get('ai', 'deepseek_model')).value).toBe('deepseek-reasoner');
    // A legacy provider left at its manifest model reads that model as the default.
    const fresh = ruled();
    await fresh.setMany('ai', { provider: 'openai', openai_api_key: 'sk-openai-secret' });
    expect(resolveAiModelConfiguration(await values(fresh)).defaultModel).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('a save that touches none of the model keys is never refused for them', async () => {
    const svc = ruled();
    await svc.setMany('ai', { ...twoProviders });
    await expect(svc.setMany('ai', { temperature: 0.2 })).resolves.toBeDefined();
  });

  it('no key value appears in any read of the settings', async () => {
    const http = new RouteHttp();
    const svc = ruled();
    registerSettingsRoutes(http, svc, { contextFromRequest: platformAdmin as any });
    const put = await http.call('PUT', 'ai', { ...twoProviders, default_model: 'gpt-4o' });
    expect(put.status).toBe(200);
    const get = await http.call('GET', 'ai');
    expect(get.status).toBe(200);
    for (const answer of [put, get]) {
      const text = JSON.stringify(answer.body);
      expect(text).not.toContain('sk-openai-secret');
      expect(text).not.toContain('sk-ant-secret');
    }
    const refused = await http.call('PUT', 'ai', { default_model: 'claude-haiku-4-5' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(refused.body.error.details.fields[0]).toMatchObject({ field: 'default_model', code: 'invalid_value' });
    expect(JSON.stringify(refused.body)).not.toContain('sk-');
  });

  it('each provider\'s Test connection checks that provider, whichever provider is the default', async () => {
    const run = (provider: AiProviderId, values: Record<string, unknown>) =>
      aiProviderTestActionHandlers[`test_${provider}`]!({ namespace: 'ai', actionId: `test_${provider}`, values, ctx: {} });
    await expect(run('anthropic', { provider: 'openai', openai_api_key: 'k' })).resolves.toMatchObject({
      ok: false, message: 'anthropic API key is required.',
    });
    await expect(run('anthropic', { provider: 'openai', anthropic_api_key: 'k', anthropic_model: 'claude-haiku-4-5' })).resolves.toMatchObject({
      ok: true, message: expect.stringContaining('anthropic configured (model=claude-haiku-4-5)'),
    });
    // The unsaved form posted with the click is what is checked.
    await expect(
      aiProviderTestActionHandlers.test_gateway!({ namespace: 'ai', actionId: 'test_gateway', values: {}, payload: { values: { gateway_model: 'openai/gpt-4o' } }, ctx: {} }),
    ).resolves.toMatchObject({ ok: true });
    expect(Object.keys(aiProviderTestActionHandlers).sort()).toEqual(AI_PROVIDERS.map((p) => `test_${p.id}`).sort());
  });

  it('the settings plugin registers the save rule and every provider\'s Test connection by default', async () => {
    const predicates: string[] = [];
    const register = SettingsService.prototype.registerWritePredicate;
    const spy = vi.spyOn(SettingsService.prototype, 'registerWritePredicate').mockImplementation(function (
      this: SettingsService,
      ...args: Parameters<SettingsService['registerWritePredicate']>
    ) {
      predicates.push(`${args[0]}.${args[1]}`);
      return register.apply(this, args);
    });
    let service: SettingsService | undefined;
    const ctx = {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService: (name: string, svc: unknown) => { if (name === 'settings') service = svc as SettingsService; },
      getService: (name: string) => { throw new Error(`fixture: no '${name}' service`); },
    } as unknown as PluginContext;
    try {
      await new SettingsServicePlugin({ env: {} }).init(ctx);
    } finally {
      spy.mockRestore();
    }
    expect(predicates.filter((p) => p.startsWith('ai.')).sort()).toEqual(AI_MODEL_RULE_KEYS.map((k) => `ai.${k}`).sort());
    const answer = await service!.runAction('ai', 'test_anthropic', { values: { anthropic_api_key: 'k' } });
    expect(answer).toMatchObject({ ok: true, message: expect.stringContaining('anthropic configured') });
  });
});

/** The settings routes over a recording HTTP double, for the read-and-refusal pin above. */
class RouteHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) { this.routes.set(`${method} ${path}`, handler); return this as any; }
  get(path: string, h: RouteHandler) { return this.add('GET', path, h); }
  post(path: string, h: RouteHandler) { return this.add('POST', path, h); }
  put(path: string, h: RouteHandler) { return this.add('PUT', path, h); }
  delete(path: string, h: RouteHandler) { return this.add('DELETE', path, h); }
  patch(path: string, h: RouteHandler) { return this.add('PATCH', path, h); }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }

  async call(method: 'GET' | 'PUT', namespace: string, body?: unknown): Promise<{ status: number; body: any }> {
    const state: { status: number; body?: any } = { status: 200 };
    const req = { params: { namespace }, query: {}, body, headers: {}, method, path: `/api/settings/${namespace}` } as IHttpRequest;
    const res: IHttpResponse = {
      json: ((data: unknown) => { state.body = data; }) as any,
      send: (() => undefined) as any,
      status: ((code: number) => { state.status = code; return res; }) as any,
      header: (() => res) as any,
    };
    await this.routes.get(`${method} /api/settings/:namespace`)!(req, res);
    return { status: state.status, body: state.body };
  }
}

const platformAdmin = () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' });
