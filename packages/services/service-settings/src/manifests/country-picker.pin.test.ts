// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Company → Country and Localization → Default country are pickers that show
 * country names and store the ISO 3166-1 alpha-2 code (#27867).
 *
 * Both were two-letter text boxes: "Germany" was cut to "Ge" and refused, and
 * nothing said a code was wanted. They are now `select`s whose `options` are
 * every member of the `iso_3166_alpha2` value domain, named — and the domain
 * is still the enforcement boundary, so the set of accepted values did not
 * move: these pins hold the options equal to the domain, a stored code
 * round-trip, and the unchanged refusals.
 */

import { describe, it, expect } from 'vitest';
import { ISO_3166_ALPHA2_CODES } from '@objectstack/spec/shared';
import { SettingsManifestSchema, type SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from '../settings-service.js';
import { companySettingsManifest, countryOptionLabels } from './company.manifest.js';
import { localizationSettingsManifest } from './localization.manifest.js';
import { en, zhCN, jaJP, esES } from '../translations/index.js';

const PICKERS: Array<[SettingsManifest, string]> = [
  [companySettingsManifest, 'country'],
  [localizationSettingsManifest, 'default_country'],
];

const specOf = (m: SettingsManifest, key: string) =>
  (m.specifiers as any[]).find((s) => s.key === key);

describe('country pickers show names and store the code (#27867)', () => {
  for (const [manifest, key] of PICKERS) {
    const at = `${manifest.namespace}.${key}`;

    it(`${at} is a select that keeps the iso_3166_alpha2 domain`, () => {
      const spec = specOf(manifest, key);
      expect(spec.type).toBe('select');
      expect(spec.valueDomain).toBe('iso_3166_alpha2');
      const parsed = SettingsManifestSchema.parse(manifest) as any;
      const parsedSpec = parsed.specifiers.find((s: any) => s.key === key);
      expect(parsedSpec.type).toBe('select');
      expect(parsedSpec.valueDomain).toBe('iso_3166_alpha2');
    });

    it(`${at} offers exactly the domain's codes, each named`, () => {
      const options = specOf(manifest, key).options as Array<{ value: string; label: string }>;
      const values = options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect([...values].sort()).toEqual([...ISO_3166_ALPHA2_CODES].sort());
      for (const o of options) {
        // A name, with the code it stores beside it — never the bare code.
        expect(o.label, o.value).not.toBe(o.value);
        expect(o.label, o.value).toContain(`(${o.value})`);
      }
    });

    it(`${at}: a stored code round-trips and is its picked option`, async () => {
      const svc = new SettingsService({ env: {} });
      svc.registerManifest(manifest);
      await svc.setMany(manifest.namespace, { [key]: 'DE' });
      const stored = (await svc.get(manifest.namespace, key)).value;
      expect(stored).toBe('DE');
      const picked = (specOf(manifest, key).options as Array<{ value: string }>).find(
        (o) => o.value === stored,
      );
      expect(picked).toBeDefined();
    });

    it(`${at}: the accepted set did not move (a name, lowercase and ZZ are refused as before)`, async () => {
      const svc = new SettingsService({ env: {} });
      svc.registerManifest(manifest);
      for (const value of ['ZZ', 'de']) {
        await expect(svc.setMany(manifest.namespace, { [key]: value })).rejects.toMatchObject({
          code: 'SETTINGS_VALIDATION',
          fields: [{ field: key, code: 'value_domain', constraint: { valueDomain: 'iso_3166_alpha2' } }],
        });
      }
      await expect(svc.setMany(manifest.namespace, { [key]: 'Germany' })).rejects.toMatchObject({
        code: 'SETTINGS_VALIDATION',
        fields: [{ field: key }],
      });
    });

    for (const [locale, data] of [['en', en], ['zh-CN', zhCN], ['ja-JP', jaJP], ['es-ES', esES]] as const) {
      it(`${at}: the ${locale} pack names every code`, () => {
        const options = (data.settings as any)?.[manifest.namespace]?.keys?.[key]?.options ?? {};
        expect(Object.keys(options).sort()).toEqual([...ISO_3166_ALPHA2_CODES].sort());
      });
    }
  }

  it('countryOptionLabels names a code in the asked locale', () => {
    const de = countryOptionLabels('de-DE').DE;
    expect(de).toContain('(DE)');
    expect(de).not.toBe(countryOptionLabels('en').DE);
  });
});
