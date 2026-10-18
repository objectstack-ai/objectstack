// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { storageSettingsManifest, storageTestActionHandler } from './storage.manifest.js';

describe('storageSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(storageSettingsManifest)).not.toThrow();
  });

  it('declares namespace=storage, scope=global, version=1', () => {
    const parsed = SettingsManifestSchema.parse(storageSettingsManifest);
    expect(parsed.namespace).toBe('storage');
    expect(parsed.scope).toBe('global');
    expect(parsed.version).toBe(1);
  });

  it('marks s3_secret_access_key as encrypted', () => {
    const sk = (storageSettingsManifest.specifiers as any[]).find(
      (s) => s.key === 's3_secret_access_key',
    );
    expect(sk).toBeDefined();
    expect(sk.encrypted).toBe(true);
    expect(sk.type).toBe('password');
  });

  it('exposes a test action that POSTs to /api/settings/storage/test', () => {
    const test = (storageSettingsManifest.specifiers as any[]).find(
      (s) => s.type === 'action_button' && s.id === 'test',
    );
    expect(test).toBeDefined();
    expect(test.handler).toMatchObject({
      kind: 'http',
      method: 'POST',
      url: '/api/settings/storage/test',
    });
  });

  it('hides S3 fields when adapter=local and vice-versa via visible expressions', () => {
    const specs = storageSettingsManifest.specifiers as any[];
    const s3Fields = ['s3_bucket', 's3_region', 's3_access_key_id', 's3_secret_access_key'];
    for (const key of s3Fields) {
      const spec = specs.find((s) => s.key === key);
      expect(spec).toBeDefined();
      expect(spec.visible).toBe("${data.adapter === 's3'}");
    }
    const localRoot = specs.find((s) => s.key === 'local_root');
    expect(localRoot.visible).toBe("${data.adapter === 'local'}");
  });
});

describe('storageSettingsManifest — the adapter-switch warning is an info_banner', () => {
  const specs = storageSettingsManifest.specifiers as any[];
  const sectionOf = (i: number) => specs.slice(0, i + 1).reverse().find((s) => s.type === 'group')?.id;

  it('declares it as a warning-severity info_banner with an id, a title and a body', () => {
    const banners = specs.filter((s) => s.type === 'info_banner');
    expect(banners.map((b) => [b.id, b.bannerSeverity])).toEqual([['adapter_switch_warning', 'warning']]);
    expect(typeof banners[0].label).toBe('string');
    expect(banners[0].label.length).toBeGreaterThan(0);
    expect(banners[0].bannerText.length).toBeGreaterThan(0);
  });

  it('places it in the Backend section, directly under the adapter select it concerns', () => {
    const i = specs.findIndex((s) => s.id === 'adapter_switch_warning');
    expect(sectionOf(i)).toBe('adapter');
    expect(specs[i - 1].key).toBe('adapter');
  });

  it('carries the warning glyph nowhere — the banner severity is the only warning marker', () => {
    expect(JSON.stringify(storageSettingsManifest)).not.toContain('⚠');
  });
});

describe('storageTestActionHandler (fallback)', () => {
  it('rejects local adapter without local_root', async () => {
    const r = await storageTestActionHandler({
      namespace: 'storage',
      actionId: 'test',
      values: { adapter: 'local' },
      ctx: {},
    });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('accepts local adapter when local_root is set', async () => {
    const r = await storageTestActionHandler({
      namespace: 'storage',
      actionId: 'test',
      values: { adapter: 'local', local_root: './uploads' },
      ctx: {},
    });
    expect(r.ok).toBe(true);
  });

  it('rejects s3 adapter when credentials are missing', async () => {
    const r = await storageTestActionHandler({
      namespace: 'storage',
      actionId: 'test',
      values: { adapter: 's3', s3_bucket: 'x' },
      ctx: {},
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/s3_region|s3_access_key_id|s3_secret_access_key/);
  });

  it('accepts a fully-specified s3 config', async () => {
    const r = await storageTestActionHandler({
      namespace: 'storage',
      actionId: 'test',
      values: {
        adapter: 's3',
        s3_bucket: 'b',
        s3_region: 'us-east-1',
        s3_access_key_id: 'A',
        s3_secret_access_key: 'S',
      },
      ctx: {},
    });
    expect(r.ok).toBe(true);
  });
});
