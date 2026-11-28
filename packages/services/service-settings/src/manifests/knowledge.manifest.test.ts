// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import {
  knowledgeSettingsManifest,
  knowledgeTestActionHandler,
} from './knowledge.manifest.js';

describe('knowledgeSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(knowledgeSettingsManifest)).not.toThrow();
  });

  it('declares namespace=knowledge, scope=global, version=5 (chunk_overlap, the ragflow option, then adapter, over_fetch and enforce_rls retired; the Turso group left for its store)', () => {
    const parsed = SettingsManifestSchema.parse(knowledgeSettingsManifest);
    expect(parsed.namespace).toBe('knowledge');
    expect(parsed.scope).toBe('global');
    expect(parsed.version).toBe(5);
    const keys = parsed.specifiers.map((sp: any) => sp.key).filter(Boolean);
    // Every key left has a named reader (#37104): `chunk_target`, the
    // knowledge service's splitter. A key added here owes its reader first.
    expect(keys).toEqual(['chunk_target']);
    for (const key of [
      'chunk_overlap',
      'ragflow_base_url', 'ragflow_api_key', 'ragflow_default_dataset',
      'adapter', 'over_fetch', 'enforce_rls',
    ]) {
      expect(keys, key).not.toContain(key);
    }
    const groups = parsed.specifiers.filter((sp: any) => sp.type === 'group').map((sp: any) => sp.id);
    expect(groups).toEqual(['indexing']);
  });

  // The Turso fields' one reader is @objectstack/knowledge-turso, which adds
  // them to this page where it reads them (`contributeKnowledgeTursoSettings`;
  // its own tests pin both mount cases). Declared here, they would show on a
  // deployment whose store is pgvector, where nothing reads them.
  it('declares no Turso group or field: the store that reads them contributes them', () => {
    const specs = knowledgeSettingsManifest.specifiers as any[];
    for (const id of ['turso', 'turso_url', 'turso_auth_token']) {
      expect(specs.some((s) => (s.key ?? s.id) === id), id).toBe(false);
    }
    expect(JSON.stringify(knowledgeSettingsManifest)).not.toMatch(/turso/i);
  });

  it('gates nothing on the retired adapter: no specifier declares a visibility predicate', () => {
    const specs = knowledgeSettingsManifest.specifiers as any[];
    // Non-vacuity: the specifiers are there to inspect.
    expect(specs.length).toBeGreaterThanOrEqual(3);
    for (const s of specs) expect(s.visible, s.key ?? s.id).toBeUndefined();
    expect(JSON.stringify(knowledgeSettingsManifest)).not.toContain('data.adapter');
  });

  it('exposes a test action wired to /api/settings/knowledge/test', () => {
    const f = (knowledgeSettingsManifest.specifiers as any[]).find(
      (s) => s.type === 'action_button' && s.id === 'test',
    );
    expect(f).toBeDefined();
    expect(f.handler).toEqual({
      kind: 'http',
      method: 'POST',
      url: '/api/settings/knowledge/test',
    });
  });
});

describe('knowledgeSettingsManifest — no banner outlives the key it warned about', () => {
  // The page carried two warning banners, one under the adapter select and one
  // under the RLS toggle. Both keys are retired (#37104), so both banners went
  // with them: a warning about a switch that is not on the page is noise.
  it('declares no info_banner', () => {
    const specs = knowledgeSettingsManifest.specifiers as any[];
    expect(specs.filter((s) => s.type === 'info_banner')).toEqual([]);
    expect(specs.some((s) => s.id === 'adapter_switch_warning' || s.id === 'enforce_rls_warning')).toBe(false);
  });

  it('carries the warning glyph nowhere', () => {
    expect(JSON.stringify(knowledgeSettingsManifest)).not.toContain('⚠');
  });
});

describe('knowledgeTestActionHandler', () => {
  it('accepts no URL (the plugin defaults to its own file)', async () => {
    const r = await knowledgeTestActionHandler({ values: {} } as any);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('info');
    // The plugin opens a file of its own, never the platform's database (#37107).
    expect(r.message).toMatch(/knowledge\.db/);
    expect(r.message).not.toMatch(/reuse the tenant/);
  });

  it('accepts a local file URL', async () => {
    const r = await knowledgeTestActionHandler({
      values: { turso_url: 'file:./knowledge.db' },
    } as any);
    expect(r.ok).toBe(true);
  });

  it('rejects managed turso URL without auth token', async () => {
    const r = await knowledgeTestActionHandler({
      values: { turso_url: 'libsql://x.turso.io' },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('accepts managed turso URL with auth token', async () => {
    const r = await knowledgeTestActionHandler({
      values: { turso_url: 'libsql://x.turso.io', turso_auth_token: 't' },
    } as any);
    expect(r.ok).toBe(true);
  });

  // The turso adapter's plugin package is built in this repo since #37107. The
  // live-call hint names the package and how a deployment registers it, and no
  // longer says it ships elsewhere. Pinned as a property, not as a literal, so
  // the wording can be improved without the guard going stale.
  it('turso live-call hint names the package and how it is registered, not an outside origin', async () => {
    const r = await knowledgeTestActionHandler({
      values: { turso_url: 'file:./knowledge.db' },
    } as any);
    expect(r.ok).toBe(true);
    const message = String(r.message);
    expect(message).toContain('@objectstack/knowledge-turso');
    expect(message).toMatch(/registered beside the knowledge service/);
    expect(message).not.toMatch(/ObjectOS Cloud monorepo|does not ship/);
    // the un-followable form this card retired: named, with no origin stated
    expect(message).not.toMatch(/Mount @objectstack\/knowledge-turso to exercise live calls/);
  });

  // #24769 — "Test connection" is answered (the handler is in the plugin's
  // default map), and what it answers is a form check: no package in this repo
  // registers `knowledge/test`, so nothing replaces it with a live probe. Every
  // green answer must say no connection was attempted, and none may promise
  // that mounting a package makes this button live — no package does.
  it('every green answer says no connection was attempted', async () => {
    const forms: Array<[string, Record<string, unknown>]> = [
      ['no URL', {}],
      ['local file', { turso_url: 'file:./knowledge.db' }],
      ['managed', { turso_url: 'libsql://x.turso.io', turso_auth_token: 't' }],
    ];
    for (const [label, values] of forms) {
      const r = await knowledgeTestActionHandler({ values } as any);
      expect(r.ok, label).toBe(true);
      const message = String(r.message);
      expect(message, label).toMatch(/no connection was attempted/);
      expect(message, label).not.toMatch(/to exercise live calls/);
    }
  });

  // `adapter` is retired (#37104): a value saved before, or a stale form still
  // sending one, is not read. The answer is the one the same Turso fields get
  // with no adapter at all — never "Unknown adapter", never the in-memory
  // warning the retired `memory` option answered.
  it('reads no adapter: a stale one in the values or the payload changes nothing', async () => {
    const fields = { turso_url: 'libsql://x.turso.io', turso_auth_token: 't' };
    const baseline = await knowledgeTestActionHandler({ values: fields } as any);
    expect(baseline.ok).toBe(true);
    for (const adapter of ['memory', 'turso', 'ragflow', 'pgvector']) {
      const fromValues = await knowledgeTestActionHandler({ values: { ...fields, adapter } } as any);
      const fromPayload = await knowledgeTestActionHandler({ values: fields, payload: { values: { adapter } } } as any);
      expect(fromValues, adapter).toEqual(baseline);
      expect(fromPayload, adapter).toEqual(baseline);
    }
    // Non-vacuity: the fields it does read change the answer.
    expect((await knowledgeTestActionHandler({ values: { turso_url: 'libsql://x.turso.io' } } as any)).ok).toBe(false);
  });

  it('prefers payload.values over persisted values', async () => {
    const r = await knowledgeTestActionHandler({
      values: { turso_url: 'libsql://x.turso.io' },
      payload: { values: { turso_url: 'file:foo.db' } },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/file:foo\.db/);
  });
});

describe('aiTestEmbedderActionHandler', () => {
  it('returns warning when embedder is disabled', async () => {
    const handler = await import('./ai.manifest.js').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({ values: { embedder_provider: 'none' } } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
  });

  it('rejects OpenAI-compatible provider without api key', async () => {
    const handler = await import('./ai.manifest.js').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({ values: { embedder_provider: 'dashscope' } } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('rejects custom / azure without base URL', async () => {
    const handler = await import('./ai.manifest.js').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({
      values: { embedder_provider: 'custom', embedder_api_key: 'k' },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('does not require api key for ollama', async () => {
    const handler = await import('./ai.manifest.js').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({
      values: { embedder_provider: 'ollama', embedder_model: 'bge-m3' },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('bge-m3');
  });

  it('accepts siliconflow with key + model', async () => {
    const handler = await import('./ai.manifest.js').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({
      values: {
        embedder_provider: 'siliconflow',
        embedder_api_key: 'sk-test',
        embedder_model: 'BAAI/bge-m3',
      },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('BAAI/bge-m3');
  });
});
