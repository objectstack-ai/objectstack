// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The embedder section joins the bundled `ai` page only (#33933).
 *
 * `contributeKnowledgeSettings` must leave a host's own `ai` manifest exactly
 * as the host wrote it, even when it carries the bundled keys: the bundled page
 * is recognised as that very declaration, never by its key set. A host page
 * that already declares the embedder keys keeps its declaration and gets the
 * test button's handler. Each case runs on a real `SettingsService`, with a
 * plugin context reduced to the two services the contribution reads.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import {
  SettingsService,
  aiSettingsManifest,
  aiEmbedderSettingsSpecifiers,
  aiTestEmbedderActionHandler,
  withAiEmbedderSection,
} from '@objectstack/service-settings';
import { contributeKnowledgeSettings, isBundledAiManifest } from '../knowledge-settings-contribution.js';

const EMBEDDER_KEYS = aiEmbedderSettingsSpecifiers.map((s) => s.key).filter((k): k is string => !!k);

function contextFor(settings: SettingsService | undefined) {
  const warn = vi.fn();
  const ctx = {
    getService: (name: string) => {
      if (name === 'settings' && settings) return settings;
      throw new Error(`no service ${name}`);
    },
    logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext;
  return { ctx, warn };
}

function hubWith(ai: typeof aiSettingsManifest): SettingsService {
  const settings = new SettingsService({ env: {} });
  settings.registerManifest(ai);
  return settings;
}

const keysOf = (s: SettingsService) =>
  (s.getManifest('ai').specifiers as Array<{ key?: string }>).map((x) => x.key).filter(Boolean);

describe('#33933 — the embedder section joins the bundled ai page only', () => {
  it('the bundled page is joined: embedder keys and the test button are offered', () => {
    const settings = hubWith(aiSettingsManifest);
    const { ctx, warn } = contextFor(settings);
    expect(contributeKnowledgeSettings(ctx, '0.0.0').embedder).toBe(true);
    expect(keysOf(settings)).toEqual(expect.arrayContaining(EMBEDDER_KEYS));
    expect(warn).not.toHaveBeenCalled();
  });

  it('a page served through an option source is not taken as bundled: no join, and the host is told why', () => {
    // The served copy cannot be told apart from a host page that narrowed an
    // option table, so it is left alone (no `ai` key has a source today).
    const settings = new SettingsService({ env: {} });
    settings.registerOptionSource('ai', 'provider', () => ({ options: [{ value: 'openai', label: 'OpenAI' }], admits: () => true }) as any);
    settings.registerManifest(aiSettingsManifest);
    expect(settings.getManifest('ai')).not.toBe(aiSettingsManifest);
    const { ctx, warn } = contextFor(settings);
    expect(contributeKnowledgeSettings(ctx, '0.0.0').embedder).toBe(false);
    for (const key of EMBEDDER_KEYS) expect(keysOf(settings), key).not.toContain(key);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  for (const [what, host] of [
    ['a different scope', { ...aiSettingsManifest, scope: 'tenant' as const }],
    ['a different read permission', { ...aiSettingsManifest, readPermission: 'host.ai.read' }],
    [
      'a narrowed option table on one key',
      {
        ...aiSettingsManifest,
        specifiers: aiSettingsManifest.specifiers.map((s) =>
          s.key === 'provider' ? { ...s, options: (s as { options?: unknown[] }).options?.slice(0, 2) } : s,
        ),
      },
    ],
    [
      'a different default on one key',
      {
        ...aiSettingsManifest,
        specifiers: aiSettingsManifest.specifiers.map((s) => (s.key === 'temperature' ? { ...s, default: 0.1 } : s)),
      },
    ],
  ] as const) {
    it(`a host ai page with the bundled keys and ${what} is left untouched, and the host is told why`, () => {
      const settings = hubWith(host as typeof aiSettingsManifest);
      const { ctx, warn } = contextFor(settings);
      expect(isBundledAiManifest(settings.getManifest('ai'))).toBe(false);
      expect(contributeKnowledgeSettings(ctx, '0.0.0').embedder).toBe(false);
      expect(settings.getManifest('ai')).toBe(host);
      for (const key of EMBEDDER_KEYS) expect(keysOf(settings), key).not.toContain(key);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('not the bundled one');
    });
  }

  it('a host ai page that already declares the embedder keys keeps its declaration and gets the button handler', async () => {
    const host = withAiEmbedderSection({ ...aiSettingsManifest, scope: 'global' as const, label: 'Host AI' });
    const settings = hubWith(host);
    const { ctx, warn } = contextFor(settings);
    expect(contributeKnowledgeSettings(ctx, '0.0.0').embedder).toBe(true);
    expect(settings.getManifest('ai')).toBe(host);
    expect(warn).not.toHaveBeenCalled();
    const payload = await settings.getNamespace('ai');
    const values = Object.fromEntries(Object.entries(payload.values).map(([k, v]) => [k, (v as { value?: unknown }).value]));
    expect(await settings.runAction('ai', 'test_embedder', {})).toEqual(
      await aiTestEmbedderActionHandler({ namespace: 'ai', actionId: 'test_embedder', values, payload: {}, ctx: {} }),
    );
  });

  it('a composition with no settings service is offered nothing and does not throw', () => {
    const { ctx } = contextFor(undefined);
    expect(contributeKnowledgeSettings(ctx, '0.0.0')).toEqual({ knowledge: false, embedder: false, nav: false });
  });
});
