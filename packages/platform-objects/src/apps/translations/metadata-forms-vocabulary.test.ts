// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression guard for ADR-0090 D2/D3 in the generated metadata-form
// translations. The concepts were retired in the P1 wave, but the FORM
// registry (and therefore these extractor-generated bundles) lagged: the
// bundles kept `role`/`profile` groups (with pre-D3 copy like "Roles compose
// a hierarchy…") while the `position` type had no form translations at all.
// This asserts the retired keys stay gone and the replacement stays present,
// across every locale.

import { describe, it, expect } from 'vitest';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';
import { zhHantMetadataForms } from './zh-Hant.metadata-forms.generated.js';
import { arMetadataForms } from './ar.metadata-forms.generated.js';
import { frMetadataForms } from './fr.metadata-forms.generated.js';

const LOCALES = [
  { name: 'en', forms: enMetadataForms as Record<string, any> },
  { name: 'zh-CN', forms: zhCNMetadataForms as Record<string, any> },
  { name: 'ja-JP', forms: jaJPMetadataForms as Record<string, any> },
  { name: 'es-ES', forms: esESMetadataForms as Record<string, any> },
  { name: 'zh-Hant', forms: zhHantMetadataForms as Record<string, any> },
  { name: 'ar', forms: arMetadataForms as Record<string, any> },
  { name: 'fr', forms: frMetadataForms as Record<string, any> },
];

describe('ADR-0090 D2/D3 — metadata-form translations use the v2 vocabulary', () => {
  it('the form registry itself carries no retired kind', () => {
    expect(Object.keys(METADATA_FORM_REGISTRY)).not.toContain('role');
    expect(Object.keys(METADATA_FORM_REGISTRY)).not.toContain('profile');
    expect(Object.keys(METADATA_FORM_REGISTRY)).toContain('position');
  });

  for (const { name, forms } of LOCALES) {
    it(`${name}: retired role/profile groups are gone, position group exists`, () => {
      expect(forms.role, `${name} still carries a 'role' form group`).toBeUndefined();
      expect(forms.profile, `${name} still carries a 'profile' form group`).toBeUndefined();
      expect(forms.position?.label, `${name} lacks the 'position' form group`).toBeTruthy();
      expect(forms.position?.sections?.position?.label).toBeTruthy();
      for (const field of ['name', 'label', 'description']) {
        expect(forms.position?.fields?.[field]?.label, `${name} position.fields.${field}`).toBeTruthy();
      }
    });
  }
});
