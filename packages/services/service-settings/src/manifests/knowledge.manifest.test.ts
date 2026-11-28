// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { knowledgeSettingsManifest } from './knowledge.manifest.js';

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
    expect(specs.length).toBeGreaterThanOrEqual(2);
    for (const s of specs) expect(s.visible, s.key ?? s.id).toBeUndefined();
    expect(JSON.stringify(knowledgeSettingsManifest)).not.toContain('data.adapter');
  });

  // "Test connection" checks the Turso fields alone, so it left this page with
  // them: `@objectstack/knowledge-turso` declares it and registers its handler
  // where it contributes the group, and pins both cases.
  it('declares no action: the Turso check is contributed with the Turso fields', () => {
    const specs = knowledgeSettingsManifest.specifiers as any[];
    expect(specs.filter((s) => s.type === 'action_button')).toEqual([]);
    expect(JSON.stringify(knowledgeSettingsManifest)).not.toContain('/api/settings/knowledge/test');
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
