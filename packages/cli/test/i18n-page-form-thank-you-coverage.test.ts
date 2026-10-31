// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A page `object-form` component's thank-you panel (the `title` / `message`
// of a `kind: 'thank-you'` `properties.submitBehavior`) is translated through
// `pages.<page>.components.<id>.submitBehavior.{title,message}`
// (`translatePage` overlays it, by the form view's panel's rules). The walker
// emits both slots for every `object-form` the page addresses, so
// `os i18n extract` scaffolds them and the coverage gate reports a locale
// that leaves an authored panel untranslated.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { TranslationDataSchema } from '@objectstack/spec/system';

const panelKeys = (config: any) =>
  collectExpectedEntries(config)
    .map((e) => e.path.join('.'))
    .filter((p) => p.startsWith('pages.') && p.includes('.submitBehavior.'));

const form = (id: string | undefined, submitBehavior: unknown) => ({
  ...(id ? { id } : {}),
  type: 'object-form',
  properties: { objectName: 'project', mode: 'create', submitBehavior },
});

const config = (translations: unknown[] = []) => ({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [{ name: 'project', label: 'Project', fields: { name: { type: 'text', label: 'Name' } } }],
  pages: [
    {
      name: 'project_wizard',
      label: 'New Project',
      type: 'app',
      regions: [
        {
          name: 'main',
          components: [
            form('project_form', { kind: 'thank-you', title: 'Project created', message: 'Your project is ready.' }),
            form('redirect_form', { kind: 'redirect', url: '/projects' }),
            // No id: no address, so no slot.
            form(undefined, { kind: 'thank-you', title: 'Anonymous' }),
            // Not an `object-form`: no panel slot under its id.
            { id: 'summary_card', type: 'page:card', properties: { title: 'Summary' } },
            {
              id: 'side_card',
              type: 'page:card',
              properties: { title: 'Quick add', children: [form('quick_form', { kind: 'thank-you', message: 'Added.' })] },
            },
          ],
        },
      ],
    },
  ],
  translations,
});

describe("i18n walker — a page `object-form`'s thank-you panel, `components.<id>.submitBehavior`", () => {
  it('emits both slots for each addressed `object-form`, nested ones included, and none elsewhere', () => {
    expect(panelKeys(config()).sort()).toEqual([
      'pages.project_wizard.components.project_form.submitBehavior.message',
      'pages.project_wizard.components.project_form.submitBehavior.title',
      'pages.project_wizard.components.quick_form.submitBehavior.message',
      'pages.project_wizard.components.quick_form.submitBehavior.title',
      'pages.project_wizard.components.redirect_form.submitBehavior.message',
      'pages.project_wizard.components.redirect_form.submitBehavior.title',
    ]);
  });

  it('seeds authored panel copy and leaves unauthored copy — and every non-thank-you kind — unseeded', () => {
    const entries = collectExpectedEntries(config());
    const at = (p: string) => entries.find((e) => e.path.join('.') === p);
    const root = 'pages.project_wizard.components';
    expect(at(`${root}.project_form.submitBehavior.title`)).toMatchObject({ sourceValue: 'Project created', inline: 'Project created' });
    expect(at(`${root}.project_form.submitBehavior.message`)).toMatchObject({ sourceValue: 'Your project is ready.' });
    expect(at(`${root}.quick_form.submitBehavior.title`)?.inline).toBeUndefined();
    expect(at(`${root}.quick_form.submitBehavior.message`)).toMatchObject({ sourceValue: 'Added.' });
    expect(at(`${root}.redirect_form.submitBehavior.title`)?.inline).toBeUndefined();
    expect(at(`${root}.redirect_form.submitBehavior.message`)?.inline).toBeUndefined();
  });

  it('`os i18n extract` writes a skeleton the translation schema accepts', () => {
    const page: any = extractTranslations(config(), { locales: ['en'] }).bundles.en?.pages?.project_wizard;
    expect(page?.components?.project_form?.submitBehavior).toEqual({ title: 'Project created', message: 'Your project is ready.' });
    const parsed = TranslationDataSchema.safeParse({ pages: { project_wizard: page } });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('the coverage gate reports authored panel copy a supported locale leaves untranslated', () => {
    const issuesOf = (translations: unknown[]) => computeI18nCoverage(config(translations))
      .issues.filter((i) => i.locale === 'zh-CN' && i.key.startsWith('pages.') && i.key.includes('.submitBehavior.'))
      .map((i) => i.key)
      .sort();
    expect(issuesOf([{ 'zh-CN': { objects: { project: { label: '项目' } } } }])).toEqual([
      'pages.project_wizard.components.project_form.submitBehavior.message',
      'pages.project_wizard.components.project_form.submitBehavior.title',
      'pages.project_wizard.components.quick_form.submitBehavior.message',
    ]);
    expect(issuesOf([{
      'zh-CN': {
        pages: {
          project_wizard: {
            components: {
              project_form: { submitBehavior: { title: '项目已创建', message: '您的项目已就绪。' } },
              quick_form: { submitBehavior: { message: '已添加。' } },
            },
          },
        },
      },
    }])).toEqual([]);
  });
});
