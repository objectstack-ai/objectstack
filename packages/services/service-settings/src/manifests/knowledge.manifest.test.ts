// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import {
  knowledgeSettingsManifest,
  knowledgeTestActionHandler,
} from './knowledge.manifest';

describe('knowledgeSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(knowledgeSettingsManifest)).not.toThrow();
  });

  it('declares namespace=knowledge, scope=global, version=1', () => {
    const parsed = SettingsManifestSchema.parse(knowledgeSettingsManifest);
    expect(parsed.namespace).toBe('knowledge');
    expect(parsed.scope).toBe('global');
    expect(parsed.version).toBe(1);
  });

  it('exposes adapter select with memory + turso + ragflow', () => {
    const f = (knowledgeSettingsManifest.specifiers as any[]).find(
      (s) => s.key === 'adapter' && s.type === 'select',
    );
    expect(f).toBeDefined();
    expect(f.default).toBe('memory');
    expect(f.options.map((o: any) => o.value).sort()).toEqual(['memory', 'ragflow', 'turso']);
  });

  it('marks every secret field as encrypted password', () => {
    const secretKeys = ['turso_auth_token', 'ragflow_api_key'];
    for (const key of secretKeys) {
      const f = (knowledgeSettingsManifest.specifiers as any[]).find((s) => s.key === key);
      expect(f, `${key} missing`).toBeDefined();
      expect(f.type).toBe('password');
      expect(f.encrypted).toBe(true);
    }
  });

  it('defaults enforce_rls to true (security-critical)', () => {
    const f = (knowledgeSettingsManifest.specifiers as any[]).find((s) => s.key === 'enforce_rls');
    expect(f).toBeDefined();
    expect(f.default).toBe(true);
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

describe('knowledgeTestActionHandler', () => {
  it('warns for memory adapter (no service to probe)', async () => {
    const r = await knowledgeTestActionHandler({ values: { adapter: 'memory' } } as any);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('warning');
  });

  it('accepts turso with no URL (will reuse tenant connection)', async () => {
    const r = await knowledgeTestActionHandler({ values: { adapter: 'turso' } } as any);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('info');
    expect(r.message).toMatch(/reuse the tenant/);
  });

  it('accepts turso with local file URL', async () => {
    const r = await knowledgeTestActionHandler({
      values: { adapter: 'turso', turso_url: 'file:./knowledge.db' },
    } as any);
    expect(r.ok).toBe(true);
  });

  it('rejects managed turso URL without auth token', async () => {
    const r = await knowledgeTestActionHandler({
      values: { adapter: 'turso', turso_url: 'libsql://x.turso.io' },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('accepts managed turso URL with auth token', async () => {
    const r = await knowledgeTestActionHandler({
      values: {
        adapter: 'turso',
        turso_url: 'libsql://x.turso.io',
        turso_auth_token: 't',
      },
    } as any);
    expect(r.ok).toBe(true);
  });

  it('rejects ragflow without base URL', async () => {
    const r = await knowledgeTestActionHandler({
      values: { adapter: 'ragflow', ragflow_api_key: 'k' },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('rejects ragflow without api key', async () => {
    const r = await knowledgeTestActionHandler({
      values: { adapter: 'ragflow', ragflow_base_url: 'http://x' },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('accepts ragflow with base URL + api key', async () => {
    const r = await knowledgeTestActionHandler({
      values: {
        adapter: 'ragflow',
        ragflow_base_url: 'http://localhost:9380',
        ragflow_api_key: 'k',
      },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('localhost:9380');
  });

  it('prefers payload.values over persisted values', async () => {
    const r = await knowledgeTestActionHandler({
      values: { adapter: 'memory' },
      payload: { values: { adapter: 'turso', turso_url: 'file:foo.db' } },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/file:foo\.db/);
  });
});

describe('aiTestEmbedderActionHandler', () => {
  it('returns warning when embedder is disabled', async () => {
    const handler = await import('./ai.manifest').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({ values: { embedder_provider: 'none' } } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
  });

  it('rejects OpenAI-compatible provider without api key', async () => {
    const handler = await import('./ai.manifest').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({ values: { embedder_provider: 'dashscope' } } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('rejects custom / azure without base URL', async () => {
    const handler = await import('./ai.manifest').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({
      values: { embedder_provider: 'custom', embedder_api_key: 'k' },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('does not require api key for ollama', async () => {
    const handler = await import('./ai.manifest').then((m) => m.aiTestEmbedderActionHandler);
    const r = await handler({
      values: { embedder_provider: 'ollama', embedder_model: 'bge-m3' },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('bge-m3');
  });

  it('accepts siliconflow with key + model', async () => {
    const handler = await import('./ai.manifest').then((m) => m.aiTestEmbedderActionHandler);
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
