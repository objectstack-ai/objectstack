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
          resultDialog: {
            title: 'Password Updated',
            description: 'Copy the temporary password now — it is shown only once.',
            acknowledge: 'Done',
            fields: [
              { path: 'user.email', label: 'Email', format: 'text' },
              { path: 'temporaryPassword', label: 'Temporary Password', format: 'secret' },
              { path: 'unlabeled' }, // no label → no entry
            ],
          },
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

  it('#8543: label-less options seed through the DERIVED channel, authored labels stay authored', () => {
    // `Field.select(['pending'])` normalizes a bare string to
    // `{ value: 'pending', label: 'pending' }` — the label is a copy of the
    // machine value, not authored English. Recording that as authored is how
    // the coverage gate came to demand translations of machine identifiers,
    // and how a raw machine value could ship as rendered text without any
    // gate noticing (#8580 is the shipped instance). All three authoring
    // shapes are pinned: `{value,label}` with the label equal to the value,
    // a bare string, and a record map whose label restates the key.
    const cfg: any = {
      objects: [
        {
          name: 'w',
          label: 'W',
          fields: {
            normalized: {
              label: 'Normalized',
              options: [
                { value: 'pending', label: 'pending' }, // Field.select(['pending']) shape
                { value: 'approved', label: 'Approved' }, // genuinely authored
                { value: 'rejected' }, // no label at all
              ],
            },
            bare: { label: 'Bare', options: ['draft'] },
            map: { label: 'Map', options: { open: 'open', closed: 'Closed' } },
          },
        },
      ],
    };
    const entries = collectExpectedEntries(cfg);
    // Structural annotation: the module import is outside this file's tsc
    // program reach (frozen TS2835 debt), so the parameter would otherwise be
    // an implicitly-any addition to the package's TEST_DEBT ledger.
    const byPath = Object.fromEntries(
      entries.map((e: { path: string[] }) => [e.path.join('.'), e]),
    );
    const opt = (p: string) => byPath[`objects.w.fields.${p}`];

    // Derived: seeded from the value so skeletons stay usable, but `inline`
    // stays unset — nobody authored display text.
    for (const p of ['normalized.options.pending', 'normalized.options.rejected', 'bare.options.draft', 'map.options.open']) {
      expect(opt(p)?.sourceValue, p).toBe(p.split('.').pop());
      expect(opt(p)?.inline, p).toBeUndefined();
    }
    // Authored: the label is real display text and drives the coverage gate.
    expect(opt('normalized.options.approved')?.inline).toBe('Approved');
    expect(opt('map.options.closed')?.inline).toBe('Closed');
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

  it('emits resultDialog entries keyed by the literal field path (dots preserved)', () => {
    const entries = collectExpectedEntries(config);
    const base = 'objects.sys_position._actions.set_password.resultDialog';
    const byPath = Object.fromEntries(entries.map((e) => [e.path.join('.'), e.sourceValue]));

    expect(byPath[`${base}.title`]).toBe('Password Updated');
    expect(byPath[`${base}.description`]).toBe('Copy the temporary password now — it is shown only once.');
    expect(byPath[`${base}.acknowledge`]).toBe('Done');
    expect(byPath[`${base}.fields.temporaryPassword`]).toBe('Temporary Password');
    // The dotted path stays ONE segment ('user.email'), never split.
    const emailEntry = entries.find(
      (e) => e.path.join('\u0000') === ['objects', 'sys_position', '_actions', 'set_password', 'resultDialog', 'fields', 'user.email'].join('\u0000'),
    );
    expect(emailEntry?.sourceValue).toBe('Email');
    // Fields without a label emit nothing.
    expect(byPath[`${base}.fields.unlabeled`]).toBeUndefined();
  });

  it('walks pages and their page:header copy (objectstack#3589)', () => {
    const pageConfig: any = {
      pages: [
        {
          name: 'connect_agent',
          label: 'Connect an Agent',
          description: 'Agent onboarding',
          regions: [
            {
              name: 'header',
              components: [
                {
                  type: 'page:header',
                  // `title` duplicates `label` — resolved by the label
                  // fallback, so it must NOT emit its own entry.
                  properties: { title: 'Connect an Agent', subtitle: 'Governed MCP access.', actions: ['connect_agent'] },
                },
              ],
            },
            { name: 'main', components: [{ type: 'mcp:connect-agent', properties: {} }] },
          ],
        },
        {
          name: 'renamed_header',
          label: 'Nav Label',
          regions: [
            { name: 'header', components: [{ type: 'page:header', properties: { title: 'Different Title' } }] },
          ],
        },
        { name: 'bare_page', label: 'Bare' },
      ],
    };
    const entries = collectExpectedEntries(pageConfig);
    const byPath = Object.fromEntries(entries.map((e) => [e.path.join('.'), e.sourceValue]));

    expect(byPath['pages.connect_agent.label']).toBe('Connect an Agent');
    expect(byPath['pages.connect_agent.description']).toBe('Agent onboarding');
    expect(byPath['pages.connect_agent.subtitle']).toBe('Governed MCP access.');
    // title === label → no redundant entry for translators to fill twice.
    expect(byPath['pages.connect_agent.title']).toBeUndefined();
    // A header title that genuinely differs from the label does emit.
    expect(byPath['pages.renamed_header.title']).toBe('Different Title');
    // Non-header components and non-translatable props (icon) contribute
    // nothing — the page namespace holds only the four translatable keys.
    const pagePaths = Object.keys(byPath).filter((p) => p.startsWith('pages.'));
    expect(pagePaths.sort()).toEqual([
      'pages.bare_page.label',
      'pages.connect_agent.description',
      'pages.connect_agent.label',
      'pages.connect_agent.subtitle',
      'pages.renamed_header.label',
      'pages.renamed_header.title',
    ]);
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
    // The fixture's en bundle matches the source, so this only proves the
    // seed path; the divergence cases live in the #8543 test below.
    expect(bundles.en.objects?.sys_position?.label).toBe('Role');
    expect(bundles.en.objects?.sys_position?.fields?.active?.label).toBe('Active');
    // Missing keys are still filled from schema defaults.
    expect(bundles.en.objects?.sys_position?.pluralLabel).toBe('Roles');
    expect(bundles.en.objects?.sys_position?.fields?.label?.label).toBe('Display Name');
  });

  it('#8543: the default locale tracks the SOURCE, not a stale existing entry; translated locales keep merge', () => {
    // The en bundle is a copy of the source, not a translation. Before #8543
    // the merge branch ran for every locale, so an author editing a field
    // description could never get the edit into the committed en bundle — the
    // stale entry always won and the drift gate stayed green (53 stale
    // entries had accumulated across 6 packages when this was fixed).
    const cfg: any = {
      objects: [
        {
          name: 'thing',
          label: 'Thing (new wording)',
          fields: { note: { label: 'Note', help: 'New help text' } },
        },
      ],
      translations: [
        {
          en: {
            objects: {
              thing: {
                label: 'Thing (stale wording)',
                fields: { note: { label: 'Note', help: 'Old help text' } },
              },
            },
          },
          'zh-CN': {
            objects: {
              thing: { label: '事物', fields: { note: { label: '备注', help: '说明' } } },
            },
          },
        },
      ],
    };
    const { bundles } = extractTranslations(cfg, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      mergeExisting: true,
    });
    // en: the source seed wins over the stale bundle entry.
    expect(bundles.en.objects?.thing?.label).toBe('Thing (new wording)');
    expect(bundles.en.objects?.thing?.fields?.note?.help).toBe('New help text');
    // zh-CN: the human translation is preserved verbatim — merge semantics
    // for translated locales are exactly what they were.
    expect(bundles['zh-CN'].objects?.thing?.label).toBe('事物');
    expect(bundles['zh-CN'].objects?.thing?.fields?.note?.help).toBe('说明');
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
