// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `packages.MANIFEST_ID.name` / `.description` — a package's display name per
// locale (objectstack#35513).
//
// Before this group existed a package had one name, the plain-string
// `manifest.name`, so a zh-CN admin read every package in Setup's package list
// and in Studio's package switcher in English, beside a launcher that already
// named the same apps in Chinese. The console reads the group from the served
// translation document; the manifest keeps its authored `name`.

import { describe, it, expect } from 'vitest';
import {
  TranslationDataSchema,
  TranslationItemSchema,
  PlatformTranslationDataSchema,
  ServedTranslationDataSchema,
  TranslationBundleSchema,
} from './translation.zod';
import { formatZodError } from '../shared/error-map.zod';

const zhCN = {
  packages: {
    'com.hotcrm.revenue': { name: '回款', description: '报价、合同与回款' },
  },
};

describe('TranslationDataSchema — packages', () => {
  it('opens at every door — bundle entry, platform bundle, served document, registered item and the bundle', () => {
    expect(TranslationDataSchema.safeParse(zhCN).success).toBe(true);
    expect(PlatformTranslationDataSchema.safeParse(zhCN).success).toBe(true);
    expect(ServedTranslationDataSchema.safeParse(zhCN).success).toBe(true);
    expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', ...zhCN }).success).toBe(true);
    expect(TranslationBundleSchema.safeParse({ 'zh-CN': zhCN }).success).toBe(true);
  });

  it('keeps the dotted manifest id as one key — it is never split into segments', () => {
    const parsed = TranslationDataSchema.parse(zhCN) as typeof zhCN;
    expect(Object.keys(parsed.packages)).toEqual(['com.hotcrm.revenue']);
    expect(parsed.packages['com.hotcrm.revenue'].name).toBe('回款');
  });

  it('refuses a key that is not a manifest id (a namespace, a display name), naming the rule', () => {
    for (const key of ['crm', 'HotCRM Revenue', 'com.hotcrm_revenue']) {
      const result = TranslationDataSchema.safeParse({ packages: { [key]: { name: 'x' } } });
      expect(result.success, key).toBe(false);
      expect(result.error!.issues[0].code).toBe('invalid_key');
      expect(formatZodError(result.error!)).toContain(`'${key}' is not a package id`);
    }
  });

  it('closes the face at `name` and `description`', () => {
    const result = TranslationDataSchema.safeParse({ packages: { 'com.acme.crm': { icon: 'box' } } });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('renames the singular and the name\'s aliases onto the declared keys', () => {
    expect(() => TranslationDataSchema.parse({ package: { 'com.acme.crm': { name: 'x' } } })).toThrow(/packages/);
    for (const alias of ['label', 'title', 'displayName']) {
      expect(() => TranslationDataSchema.parse({ packages: { 'com.acme.crm': { [alias]: 'x' } } })).toThrow(/`name`/);
    }
    expect(() => TranslationItemSchema.parse({ locale: 'zh-CN', package: { 'com.acme.crm': { name: 'x' } } })).toThrow(/packages/);
  });
});
