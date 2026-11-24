// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { translateMetadataDocument } from '@objectstack/spec/system';
import { ATTACHMENT_MEMBER_PERMISSION_SET as SET } from '../attachment-member-grant.js';
import { StorageTranslations } from './index.js';

/**
 * The permission set this service declares is served in every locale this
 * service ships, beside the sets plugin-security translates: Setup's
 * permission-set list reads no English row for it in a translated Console.
 */
const LOCALES = Object.keys(StorageTranslations).filter((l) => l !== 'en');
const SPLIT = ' — ';

describe('storage_attachment_member translations', () => {
  it('the bundle carries translated locales', () => {
    expect(LOCALES).toEqual(expect.arrayContaining(['zh-CN', 'ja-JP', 'es-ES']));
  });

  describe.each(LOCALES)('%s', (locale) => {
    const group = StorageTranslations[locale]?.permissions ?? {};

    it('translates exactly the set this service declares', () => {
      expect(Object.keys(group)).toEqual([SET.name]);
      const { label, description } = group[SET.name] ?? {};
      expect(label).not.toBe(SET.label);
      expect(description).not.toBe(SET.description);
      expect(label?.split(SPLIT).length, 'not in the English label shape').toBe(SET.label.split(SPLIT).length);
    });

    it('is served in this locale', () => {
      const served = translateMetadataDocument('permission', SET, StorageTranslations, { locale });
      expect(served).toEqual({ ...SET, ...group[SET.name] });
    });
  });

  it('the English locale serves the set as declared', () => {
    expect(translateMetadataDocument('permission', SET, StorageTranslations, { locale: 'en' })).toBe(SET);
  });

  // The i18n service deep-merges every package's bundle: this group must sit
  // beside another package's `permissions` group, not replace it.
  it.each([false, true])('a sibling set still resolves after the merge (storage loaded first: %s)', (first) => {
    const i18n = createMemoryI18n();
    const sibling = { permissions: { member_default: { label: '成员 — 标准访问' } } };
    const loads = [sibling, StorageTranslations['zh-CN']!];
    for (const data of first ? loads.reverse() : loads) i18n.loadTranslations('zh-CN', data);
    const bundle = { 'zh-CN': i18n.getTranslations('zh-CN') };
    const member = { name: 'member_default', label: 'Member — Standard Access' };
    expect(translateMetadataDocument('permission', member, bundle, { locale: 'zh-CN' }).label).toBe('成员 — 标准访问');
    const served = translateMetadataDocument('permission', SET, bundle, { locale: 'zh-CN' });
    expect(served.label).toBe(StorageTranslations['zh-CN']?.permissions?.[SET.name]?.label);
  });
});
