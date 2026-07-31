// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileI18nAdapter } from './file-i18n-adapter.js';
import type { II18nService } from '@objectstack/spec/contracts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('FileI18nAdapter', () => {
  it('should implement II18nService contract', () => {
    const i18n: II18nService = new FileI18nAdapter();
    expect(typeof i18n.t).toBe('function');
    expect(typeof i18n.getTranslations).toBe('function');
    expect(typeof i18n.loadTranslations).toBe('function');
    expect(typeof i18n.getLocales).toBe('function');
    expect(typeof i18n.getDefaultLocale).toBe('function');
    expect(typeof i18n.setDefaultLocale).toBe('function');
  });

  it('should default to "en" locale', () => {
    const i18n = new FileI18nAdapter();
    expect(i18n.getDefaultLocale()).toBe('en');
  });

  it('should use custom default locale', () => {
    const i18n = new FileI18nAdapter({ defaultLocale: 'zh-CN' });
    expect(i18n.getDefaultLocale()).toBe('zh-CN');
  });

  it('should set and get default locale', () => {
    const i18n = new FileI18nAdapter();
    i18n.setDefaultLocale('ja');
    expect(i18n.getDefaultLocale()).toBe('ja');
  });

  it('should return empty translations for unknown locale', () => {
    const i18n = new FileI18nAdapter();
    expect(i18n.getTranslations('fr')).toEqual({});
  });

  it('should return empty locales when no translations loaded', () => {
    const i18n = new FileI18nAdapter();
    expect(i18n.getLocales()).toEqual([]);
  });

  it('should load and retrieve translations', () => {
    const i18n = new FileI18nAdapter();
    i18n.loadTranslations('en', { greeting: 'Hello' });
    i18n.loadTranslations('zh-CN', { greeting: '你好' });

    expect(i18n.getLocales()).toContain('en');
    expect(i18n.getLocales()).toContain('zh-CN');
    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hello' });
    expect(i18n.getTranslations('zh-CN')).toEqual({ greeting: '你好' });
  });

  it('should merge translations when loading into existing locale', () => {
    const i18n = new FileI18nAdapter();
    i18n.loadTranslations('en', { greeting: 'Hello' });
    i18n.loadTranslations('en', { farewell: 'Goodbye' });

    expect(i18n.getTranslations('en')).toEqual({
      greeting: 'Hello',
      farewell: 'Goodbye',
    });
  });

  it('should translate a simple key', () => {
    const i18n = new FileI18nAdapter();
    i18n.loadTranslations('en', { greeting: 'Hello' });

    expect(i18n.t('greeting', 'en')).toBe('Hello');
  });

  it('should return key when translation is missing', () => {
    const i18n = new FileI18nAdapter();
    expect(i18n.t('missing.key', 'en')).toBe('missing.key');
  });

  it('should resolve nested dot-notation keys', () => {
    const i18n = new FileI18nAdapter();
    i18n.loadTranslations('en', {
      objects: {
        account: {
          label: 'Account',
        },
      },
    });

    expect(i18n.t('objects.account.label', 'en')).toBe('Account');
  });

  it('should interpolate parameters', () => {
    const i18n = new FileI18nAdapter();
    i18n.loadTranslations('en', { greeting: 'Hello, {{name}}!' });

    expect(i18n.t('greeting', 'en', { name: 'World' })).toBe('Hello, World!');
  });

  it('should keep placeholder when parameter is missing', () => {
    const i18n = new FileI18nAdapter();
    i18n.loadTranslations('en', { greeting: 'Hello, {{name}}!' });

    expect(i18n.t('greeting', 'en', {})).toBe('Hello, {{name}}!');
  });

  it('should fallback to fallback locale when key not found', () => {
    const i18n = new FileI18nAdapter({ fallbackLocale: 'en' });
    i18n.loadTranslations('en', { greeting: 'Hello' });

    expect(i18n.t('greeting', 'zh-CN')).toBe('Hello');
  });

  it('should not fallback when key exists in requested locale', () => {
    const i18n = new FileI18nAdapter({ fallbackLocale: 'en' });
    i18n.loadTranslations('en', { greeting: 'Hello' });
    i18n.loadTranslations('zh-CN', { greeting: '你好' });

    expect(i18n.t('greeting', 'zh-CN')).toBe('你好');
  });

  it('should return key when neither locale nor fallback has translation', () => {
    const i18n = new FileI18nAdapter({ fallbackLocale: 'en' });
    i18n.loadTranslations('en', { greeting: 'Hello' });

    expect(i18n.t('missing.key', 'zh-CN')).toBe('missing.key');
  });

  it('should deep-merge nested objects from multiple plugins', () => {
    const i18n = new FileI18nAdapter();

    // Plugin 1: CRM objects
    i18n.loadTranslations('en', {
      objects: {
        account: { label: 'Account', fields: { name: { label: 'Account Name' } } },
        contact: { label: 'Contact' },
      },
      apps: { crm: { label: 'CRM' } },
    });

    // Plugin 2: HR objects
    i18n.loadTranslations('en', {
      objects: {
        department: { label: 'Department', fields: { name: { label: 'Department Name' } } },
        employee: { label: 'Employee' },
      },
      apps: { hr: { label: 'HR' } },
    });

    const data = i18n.getTranslations('en');

    // Both plugins' objects must be preserved (not overwritten)
    expect(i18n.t('objects.account.label', 'en')).toBe('Account');
    expect(i18n.t('objects.contact.label', 'en')).toBe('Contact');
    expect(i18n.t('objects.department.label', 'en')).toBe('Department');
    expect(i18n.t('objects.employee.label', 'en')).toBe('Employee');
    expect(i18n.t('objects.account.fields.name.label', 'en')).toBe('Account Name');
    expect(i18n.t('objects.department.fields.name.label', 'en')).toBe('Department Name');

    // Both plugins' apps must be preserved
    expect((data as any).apps.crm.label).toBe('CRM');
    expect((data as any).apps.hr.label).toBe('HR');
  });

  describe('file-based loading', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should load translations from JSON files in a directory', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'en.json'),
        JSON.stringify({ greeting: 'Hello', objects: { account: { label: 'Account' } } }),
      );
      fs.writeFileSync(
        path.join(tmpDir, 'zh-CN.json'),
        JSON.stringify({ greeting: '你好', objects: { account: { label: '客户' } } }),
      );

      const i18n = new FileI18nAdapter({ localesDir: tmpDir });

      expect(i18n.getLocales()).toContain('en');
      expect(i18n.getLocales()).toContain('zh-CN');
      expect(i18n.t('greeting', 'en')).toBe('Hello');
      expect(i18n.t('greeting', 'zh-CN')).toBe('你好');
      expect(i18n.t('objects.account.label', 'en')).toBe('Account');
      expect(i18n.t('objects.account.label', 'zh-CN')).toBe('客户');
    });

    it('should ignore non-JSON files in the directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'en.json'), JSON.stringify({ greeting: 'Hello' }));
      fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'not a translation file');

      const i18n = new FileI18nAdapter({ localesDir: tmpDir });

      expect(i18n.getLocales()).toEqual(['en']);
    });

    it('should skip malformed JSON files gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, 'en.json'), JSON.stringify({ greeting: 'Hello' }));
      fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{invalid json');

      const i18n = new FileI18nAdapter({ localesDir: tmpDir });

      expect(i18n.getLocales()).toEqual(['en']);
      expect(i18n.t('greeting', 'en')).toBe('Hello');
    });

    it('should handle non-existent directory gracefully', () => {
      const i18n = new FileI18nAdapter({ localesDir: '/nonexistent/path' });
      expect(i18n.getLocales()).toEqual([]);
    });
  });
});
