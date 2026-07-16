// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  collectExpectedEntries,
  extractTranslations,
  renderTranslationModule,
} from '../src/utils/i18n-extract';

const config: any = {
  objects: [
    {
      name: 'sys_position',
      label: 'Role',
      pluralLabel: 'Roles',
      description: 'Role definitions for RBAC',
      fields: {
        label: { label: 'Display Name' },
        active: { label: 'Active' },
        status: {
          label: 'Status',
          options: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
        kind: {
          label: 'Kind',
          options: { internal: 'Internal', external: 'External' },
        },
      },
      listViews: {
        active: { label: 'Active', name: 'active' },
        all: { label: 'All' },
      },
      actions: [
        {
          name: 'set_password',
          label: 'Set Password',
          params: [
            { field: 'label' },
            { field: 'active', label: 'Enabled Override' },
            {
              name: 'generatePassword',
              label: 'Generate Temporary Password',
              type: 'boolean',
              helpText: 'Leave checked to auto-generate.',
            },
            {
              name: 'mode',
              type: 'select',
              placeholder: 'Pick a mode',
              options: [
                { value: 'auto', label: 'Auto' },
                { value: 'manual', label: 'Manual' },
              ],
            },
          ],
        },
      ],
    },
  ],
  actions: [
    {
      name: 'merge',
      label: 'Merge',
      objectName: 'sys_position',
      confirmText: 'Merge?',
      successMessage: 'Merged.',
    },
    {
      name: 'export_csv',
      label: 'Export CSV',
      successMessage: 'Done.',
      params: [{ name: 'delimiter', label: 'Delimiter' }],
    },
  ],
  translations: [
    {
      en: {
        objects: {
          sys_position: {
            label: 'Role',
            // pluralLabel missing intentionally
            fields: { active: { label: 'Active' } },
          },
        },
      },
    },
  ],
};

describe('collectExpectedEntries', () => {
  it('walks objects, fields, options (array + record), listViews, and actions', () => {
    const entries = collectExpectedEntries(config);
    const paths = entries.map((e) => e.path.join('.'));

    expect(paths).toContain('objects.sys_position.label');
    expect(paths).toContain('objects.sys_position.pluralLabel');
    expect(paths).toContain('objects.sys_position.description');
    expect(paths).toContain('objects.sys_position.fields.label.label');
    expect(paths).toContain('objects.sys_position.fields.status.options.on');
    expect(paths).toContain('objects.sys_position.fields.status.options.off');
    expect(paths).toContain('objects.sys_position.fields.kind.options.internal');
    expect(paths).toContain('objects.sys_position.fields.kind.options.external');
    expect(paths).toContain('objects.sys_position._views.active.label');
    expect(paths).toContain('objects.sys_position._views.all.label');
    expect(paths).toContain('objects.sys_position._actions.merge.label');
    expect(paths).toContain('objects.sys_position._actions.merge.confirmText');
    expect(paths).toContain('objects.sys_position._actions.merge.successMessage');
    expect(paths).toContain('globalActions.export_csv.label');
    expect(paths).toContain('globalActions.export_csv.successMessage');
    expect(paths).toContain('metadataForms.flow.fields.name.label');
  });

  it('carries source values from the schema', () => {
    const entries = collectExpectedEntries(config);
    const byPath = Object.fromEntries(entries.map((e) => [e.path.join('.'), e.sourceValue]));
    expect(byPath['objects.sys_position.label']).toBe('Role');
    expect(byPath['objects.sys_position.fields.status.options.on']).toBe('On');
    expect(byPath['objects.sys_position.fields.kind.options.internal']).toBe('Internal');
    expect(byPath['objects.sys_position._actions.merge.label']).toBe('Merge');
    expect(byPath['metadataForms.flow.fields.name.label']).toBe('Name');
  });

  it('emits action param entries (inline + top-level), skipping field-backed labels without overrides', () => {
    const entries = collectExpectedEntries(config);
    const byPath = Object.fromEntries(entries.map((e) => [e.path.join('.'), e.sourceValue]));
    const base = 'objects.sys_position._actions.set_password.params';

    // Field-backed param with no literal override → no label entry (field
    // translations cover it at runtime).
    expect(byPath[`${base}.label.label`]).toBeUndefined();
    // Field-backed param WITH a literal override → entry under the field name.
    expect(byPath[`${base}.active.label`]).toBe('Enabled Override');
    // Inline params emit label / helpText / placeholder / options.
    expect(byPath[`${base}.generatePassword.label`]).toBe('Generate Temporary Password');
    expect(byPath[`${base}.generatePassword.helpText`]).toBe('Leave checked to auto-generate.');
    expect(byPath[`${base}.mode.label`]).toBe('mode'); // no label → falls back to name
    expect(byPath[`${base}.mode.placeholder`]).toBe('Pick a mode');
    expect(byPath[`${base}.mode.options.auto`]).toBe('Auto');
    expect(byPath[`${base}.mode.options.manual`]).toBe('Manual');
    // Top-level (global) actions get the same treatment.
    expect(byPath['globalActions.export_csv.params.delimiter.label']).toBe('Delimiter');
  });
});

describe('extractTranslations', () => {
  it('fills the default locale from schema and emits empty strings for other locales', () => {
    const { bundles, counts } = extractTranslations(config, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'empty',
      mergeExisting: false,
    });
    expect(counts.en).toBeGreaterThan(0);
    expect(counts['zh-CN']).toBe(counts.en);
    expect(bundles.en.objects?.sys_position?.label).toBe('Role');
    expect(bundles['zh-CN'].objects?.sys_position?.label).toBe('');
    expect(bundles['zh-CN'].objects?.sys_position?.fields?.status?.options?.on).toBe('');
  });

  it('supports --fill=default (copy from source) and --fill=todo (prefix)', () => {
    const { bundles } = extractTranslations(config, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'default',
    });
    expect(bundles['zh-CN'].objects?.sys_position?.label).toBe('Role');

    const { bundles: todoBundles } = extractTranslations(config, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'todo',
    });
    expect(todoBundles['zh-CN'].objects?.sys_position?.label).toBe('[TODO] Role');
  });

  it('mergeExisting carries through values already translated in the input bundle', () => {
    const { bundles } = extractTranslations(config, {
      defaultLocale: 'en',
      locales: ['en'],
      mergeExisting: true,
    });
    // Existing translations are preserved verbatim so the generated file
    // is a complete, self-contained bundle (not just a delta).
    expect(bundles.en.objects?.sys_position?.label).toBe('Role');
    expect(bundles.en.objects?.sys_position?.fields?.active?.label).toBe('Active');
    // Missing keys are still filled from schema defaults.
    expect(bundles.en.objects?.sys_position?.pluralLabel).toBe('Roles');
    expect(bundles.en.objects?.sys_position?.fields?.label?.label).toBe('Display Name');
  });

  it('filters by object name regex', () => {
    const cfg = {
      objects: [
        { name: 'sys_position', label: 'Role', fields: {} },
        { name: 'crm_account', label: 'Account', fields: {} },
      ],
    };
    const { bundles, totalExpected } = extractTranslations(cfg, {
      defaultLocale: 'en',
      filter: /^sys_/,
      mergeExisting: false,
    });
    expect(bundles.en.objects?.sys_position).toBeDefined();
    expect(bundles.en.objects?.crm_account).toBeUndefined();
    expect(totalExpected).toBe(1);
  });
});

describe('renderTranslationModule', () => {
  it('emits a TypeScript module with a typed default export', () => {
    const { bundles } = extractTranslations(config, {
      defaultLocale: 'en',
      mergeExisting: false,
    });
    const ts = renderTranslationModule(bundles.en, { locale: 'en' });
    expect(ts).toContain("import type { TranslationData } from '@objectstack/spec/system'");
    expect(ts).toContain('export const enObjects:');
    expect(ts).toContain('sys_position:');
    expect(ts).toContain('label: "Role"');
  });

  it('quotes non-identifier keys (e.g. hyphenated values)', () => {
    const ts = renderTranslationModule(
      { objects: { 'foo-bar': { label: 'Foo Bar', fields: {} } } as any },
      { locale: 'en' },
    );
    expect(ts).toContain('"foo-bar":');
  });
});
