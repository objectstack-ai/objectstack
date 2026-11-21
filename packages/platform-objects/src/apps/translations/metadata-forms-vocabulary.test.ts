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
import { ptBRMetadataForms } from './pt-BR.metadata-forms.generated.js';
import { ruMetadataForms } from './ru.metadata-forms.generated.js';
import { deMetadataForms } from './de.metadata-forms.generated.js';
import { koMetadataForms } from './ko.metadata-forms.generated.js';

const LOCALES = [
  { name: 'en', forms: enMetadataForms as Record<string, any> },
  { name: 'zh-CN', forms: zhCNMetadataForms as Record<string, any> },
  { name: 'ja-JP', forms: jaJPMetadataForms as Record<string, any> },
  { name: 'es-ES', forms: esESMetadataForms as Record<string, any> },
  { name: 'zh-Hant', forms: zhHantMetadataForms as Record<string, any> },
  { name: 'ar', forms: arMetadataForms as Record<string, any> },
  { name: 'fr', forms: frMetadataForms as Record<string, any> },
  { name: 'pt-BR', forms: ptBRMetadataForms as Record<string, any> },
  { name: 'ru', forms: ruMetadataForms as Record<string, any> },
  { name: 'de', forms: deMetadataForms as Record<string, any> },
  { name: 'ko', forms: koMetadataForms as Record<string, any> },
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

// A master-detail child reaches the parent's forms (and its record-page
// placement) because a parent field group names it (`fieldGroups[].relatedList`),
// not because the child's FK sets `inlineEdit`. `os i18n extract --merge`
// never overwrites a present leaf and nothing records a source hash for these
// authored leaves, so a locale left on the old rule would stay served. These
// two leaves are pinned per locale: the inline-columns help names the group
// key and not `inlineEdit`, and the group help no longer carries the retired
// "the record page does not draw this placement yet" sentence.
const RETIRED_NOT_DRAWN_YET: Record<string, string> = {
  en: 'The record page does not draw this placement yet.',
  'zh-CN': '记录页目前还不会绘制这种位置。',
  'ja-JP': 'レコードページはこの配置をまだ描画しません。',
  'es-ES': 'La página de registro aún no dibuja esta ubicación.',
  'zh-Hant': '記錄頁目前還不會繪製這種位置。',
  ar: 'لا ترسم صفحة السجل هذا الموضع بعد.',
  fr: 'La page de l’enregistrement ne dessine pas encore cet emplacement.',
  'pt-BR': 'A página do registro ainda não desenha este posicionamento.',
  ru: 'Страница записи пока не выводит такое размещение.',
  de: 'Die Datensatzseite zeichnet diese Platzierung noch nicht.',
  ko: '레코드 페이지는 아직 이 배치를 그리지 않습니다.',
};

describe('master-detail form placement — every locale states the field-group rule', () => {
  it('names a retired sentence for every locale', () => {
    expect(Object.keys(RETIRED_NOT_DRAWN_YET).sort()).toEqual(LOCALES.map((l) => l.name).sort());
  });

  for (const { name, forms } of LOCALES) {
    it(`${name}: inlineColumns names the parent field group, not inlineEdit`, () => {
      const help: string = forms.field?.fields?.inlineColumns?.helpText;
      expect(help, `${name} field.fields.inlineColumns.helpText`).toBeTruthy();
      expect(help).toContain('fieldGroups[].relatedList');
      expect(help).not.toContain('inlineEdit');
    });

    it(`${name}: fieldGroups.relatedList no longer says the record page does not draw it`, () => {
      const help: string = forms.object?.fields?.['fieldGroups.relatedList']?.helpText;
      expect(help, `${name} object.fields['fieldGroups.relatedList'].helpText`).toBeTruthy();
      expect(help).not.toContain(RETIRED_NOT_DRAWN_YET[name]);
    });
  }
});
