// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { companySettingsManifest } from './company.manifest.js';

describe('companySettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(companySettingsManifest)).not.toThrow();
  });

  it('declares namespace=company, scope=tenant, version=1', () => {
    const parsed = SettingsManifestSchema.parse(companySettingsManifest);
    expect(parsed.namespace).toBe('company');
    expect(parsed.scope).toBe('tenant');
    expect(parsed.version).toBe(1);
  });

  it('groups keys into identity / address / contact', () => {
    const specs = companySettingsManifest.specifiers as any[];
    const groups = specs.filter((s) => s.type === 'group').map((s) => s.id);
    expect(groups).toEqual(['identity', 'address', 'contact']);
  });

  it('uses the right specifier types for website (url) and contact email', () => {
    const specs = companySettingsManifest.specifiers as any[];
    const byKey = (k: string) => specs.find((s) => s.key === k);
    expect(byKey('website').type).toBe('url');
    expect(byKey('primary_contact_email').type).toBe('email');
    expect(byKey('country').pattern).toBe('^[A-Za-z]{2}$');
  });

  it('has no required fields — every key is optional for v1', () => {
    const specs = companySettingsManifest.specifiers as any[];
    for (const s of specs.filter((x) => x.key)) {
      expect(s.required ?? false).toBe(false);
    }
  });
});
