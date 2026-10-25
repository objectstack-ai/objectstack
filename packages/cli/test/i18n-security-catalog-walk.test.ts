// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `positions.<name>.…` and `permissions.<name>.…` — the extractor walks the
// security catalog's two translation groups.
//
// A position is what an admin assigns a person to and what an approval step
// waits on; a permission set is what Setup lists under it. Both are served
// through `translatePosition` / `translatePermissionSet`, so without this walk
// `os i18n extract` scaffolded no key for them and `os i18n check` measured a
// debt of zero while the labels shipped in the authoring language.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const config = () => ({
  positions: [
    { name: 'srm_legal_counsel', label: 'Legal Counsel', description: 'Reviews supplier contracts' },
    { name: 'srm_buyer', label: 'Buyer' },
  ],
  permissions: [
    { name: 'srm_contract_reviewer', label: 'Contract Review', description: 'Reads and approves contracts', objects: {} },
    // No label, no description: nothing an author wrote, so nothing is demanded.
    { name: 'srm_unlabelled', objects: {} },
  ],
});

const keysOf = (group: string) =>
  collectExpectedEntries(config())
    .filter((e) => e.path[0] === group)
    .map((e) => e.path.join('.'))
    .sort();

describe('i18n extract — the `positions` and `permissions` groups', () => {
  it('walks each position\'s label and description', () => {
    expect(keysOf('positions')).toEqual([
      'positions.srm_buyer.description',
      'positions.srm_buyer.label',
      'positions.srm_legal_counsel.description',
      'positions.srm_legal_counsel.label',
    ]);
  });

  it('walks each permission set\'s label and description', () => {
    expect(keysOf('permissions')).toEqual([
      'permissions.srm_contract_reviewer.description',
      'permissions.srm_contract_reviewer.label',
      'permissions.srm_unlabelled.description',
      'permissions.srm_unlabelled.label',
    ]);
  });

  it('seeds authored text and records an unwritten string without demanding it', () => {
    const byKey = new Map(collectExpectedEntries(config()).map((e) => [e.path.join('.'), e]));
    expect(byKey.get('positions.srm_legal_counsel.label'))
      .toMatchObject({ sourceValue: 'Legal Counsel', inline: 'Legal Counsel', source: 'position' });
    expect(byKey.get('permissions.srm_contract_reviewer.description'))
      .toMatchObject({ sourceValue: 'Reads and approves contracts', source: 'permission' });
    const unwritten = byKey.get('positions.srm_buyer.description');
    expect(unwritten?.sourceValue).toBeUndefined();
    expect(unwritten?.inline).toBeUndefined();
  });

  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(Object.keys(zh?.positions ?? {}).sort()).toEqual(['srm_buyer', 'srm_legal_counsel']);
    expect(zh?.permissions?.srm_contract_reviewer?.label).toBeDefined();
    expect(TranslationDataSchema.safeParse({ positions: zh.positions, permissions: zh.permissions }).success).toBe(true);
  });

  it('reports an untranslated label under its own bucket', () => {
    const report = computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations: [
        { 'zh-CN': { positions: { srm_legal_counsel: { label: '法务顾问', description: '审核供应商合同' } } } },
      ],
    });
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    const keys = zhIssues.map((i) => i.key);
    expect(keys).toContain('positions.srm_buyer.label');
    expect(keys).toContain('permissions.srm_contract_reviewer.label');
    expect(keys).not.toContain('positions.srm_legal_counsel.label');
    // Nothing authored ⇒ nothing to translate.
    expect(keys).not.toContain('positions.srm_buyer.description');
    expect(keys).not.toContain('permissions.srm_unlabelled.label');
    expect(zhIssues.find((i) => i.key === 'positions.srm_buyer.label')?.source).toBe('position');
    expect(zhIssues.find((i) => i.key === 'permissions.srm_contract_reviewer.label')?.source).toBe('permission');
  });
});
