// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { localizationSettingsManifest } from './localization.manifest.js';

describe('localizationSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(localizationSettingsManifest)).not.toThrow();
  });

  it('declares namespace=localization, scope=tenant, version=1', () => {
    const parsed = SettingsManifestSchema.parse(localizationSettingsManifest);
    expect(parsed.namespace).toBe('localization');
    expect(parsed.scope).toBe('tenant'); // 组织级 (per-user overrides out of scope for v1)
    expect(parsed.version).toBe(1);
  });

  it('defaults to UTC / en-US — preserving pre-Phase-2 behavior when nothing is set', () => {
    const specs = localizationSettingsManifest.specifiers as any[];
    const byKey = (k: string) => specs.find((s) => s.key === k);
    expect(byKey('timezone').default).toBe('UTC');
    expect(byKey('locale').default).toBe('en-US');
    // No platform default currency: a code-less currency field renders as a
    // plain number unless the workspace explicitly sets one (avoids surfacing
    // an unwanted "$"/"US$" on every amount that omits its own code).
    expect(byKey('currency').default).toBeUndefined();
    expect(byKey('date_format').default).toBe('YYYY-MM-DD');
    expect(byKey('first_day_of_week').default).toBe('monday');
    expect(byKey('fiscal_year_start').default).toBe('january');
  });

  it('every timezone option is a valid IANA zone', () => {
    const tz = (localizationSettingsManifest.specifiers as any[]).find((s) => s.key === 'timezone');
    for (const opt of tz.options) {
      expect(
        () => new Intl.DateTimeFormat('en-US', { timeZone: String(opt.value) }),
      ).not.toThrow();
    }
  });

  it('exposes the nine regional keys grouped into region/formats/finance', () => {
    const specs = localizationSettingsManifest.specifiers as any[];
    const keys = specs.filter((s) => s.key).map((s) => s.key);
    expect(keys).toEqual([
      'timezone', 'locale', 'default_country',
      'date_format', 'time_format', 'number_format', 'first_day_of_week',
      'currency', 'fiscal_year_start',
    ]);
    const groups = specs.filter((s) => s.type === 'group').map((s) => s.id);
    expect(groups).toEqual(['region', 'formats', 'finance']);
  });
});
