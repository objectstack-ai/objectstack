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

  it('country declares the iso_3166_alpha2 value domain (#6579)', () => {
    // #5712's fourth case: the description promised ISO 3166-1 all along while
    // `^[A-Za-z]{2}$` constrained shape only (`ZZ` and `UK` passed the write
    // door). The declaration is what makes the promise true; `SettingsService`
    // enforces it on both doors. The pattern STAYS — shape still speaks first.
    const specs = companySettingsManifest.specifiers as any[];
    const byKey = (k: string) => specs.find((s) => s.key === k);
    expect(byKey('country').valueDomain).toBe('iso_3166_alpha2');
    expect(byKey('country').pattern).toBe('^[A-Za-z]{2}$');
    // Every other key stays UNDECLARED on purpose: free-text legal-identity
    // fields, not published standards.
    for (const s of specs.filter((x) => x.key && x.key !== 'country')) {
      expect(s.valueDomain, `${s.key} must not declare a domain`).toBeUndefined();
    }
    // And the declaration round-trips the spec parse (the enum is closed —
    // a misspelt member would throw here, not silently strip).
    const parsed = SettingsManifestSchema.parse(companySettingsManifest) as any;
    expect(parsed.specifiers.find((s: any) => s.key === 'country').valueDomain)
      .toBe('iso_3166_alpha2');
  });

  it('has no required fields — every key is optional for v1', () => {
    const specs = companySettingsManifest.specifiers as any[];
    for (const s of specs.filter((x) => x.key)) {
      expect(s.required ?? false).toBe(false);
    }
  });
});
