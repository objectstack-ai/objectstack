// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A field spells its help text `inlineHelpText` (`FieldSchema`), so that is the
// authored default-locale text of `objects.<o>.fields.<f>.help` — the same
// rule an authored label follows. Before, the key's inline source read only
// `help ?? description`: an app authoring `inlineHelpText` and translating
// `help` into one locale had the DEFAULT locale reported missing.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';

const HELP_KEY = 'objects.kpi.fields.score.help';

const stack = (field: Record<string, unknown>, translations: any[]): any => ({
  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN', 'en'] },
  objects: [{ name: 'kpi', label: '指标', fields: { score: { label: '分数', ...field } } }],
  translations,
});

const helpIssues = (report: ReturnType<typeof computeI18nCoverage>, locale: string) =>
  report.issues.filter((i) => i.key === HELP_KEY && i.locale === locale);

const enHelp = { en: { objects: { kpi: { fields: { score: { help: 'Full score' } } } } } };

describe('the field help key takes `inlineHelpText` as its default-locale source', () => {
  it('emits the key inline, from inlineHelpText', () => {
    const entry = collectExpectedEntries(stack({ inlineHelpText: '满分' }, [])).find((e) => e.path.join('.') === HELP_KEY);
    expect(entry?.inline).toBe('满分');
  });

  it('orders the sources help, then inlineHelpText, then description', () => {
    const inlineOf = (field: Record<string, unknown>) =>
      collectExpectedEntries(stack(field, [])).find((e) => e.path.join('.') === HELP_KEY)?.inline;
    expect(inlineOf({ help: 'H', inlineHelpText: 'I', description: 'D' })).toBe('H');
    expect(inlineOf({ inlineHelpText: 'I', description: 'D' })).toBe('I');
    expect(inlineOf({ description: 'D' })).toBe('D');
  });

  it('does not report the default locale when an en bundle carries help and no zh-CN entry exists', () => {
    const report = computeI18nCoverage(stack({ inlineHelpText: '满分' }, [enHelp]), { strict: true });
    expect(helpIssues(report, 'zh-CN')).toEqual([]);
  });

  it('still reports a non-default locale that carries no help', () => {
    const report = computeI18nCoverage(stack({ inlineHelpText: '满分' }, [{ 'zh-CN': {} }, enHelp]), {
      strict: true,
      defaultLocale: 'en',
    });
    // `en` is the default here: zh-CN is the non-default locale and owes help.
    expect(helpIssues(report, 'zh-CN').length).toBe(1);
    expect(helpIssues(report, 'en')).toEqual([]);
  });

  it('keeps the description-only case unchanged: description still seeds the default locale', () => {
    const report = computeI18nCoverage(stack({ description: '说明' }, [enHelp]), { strict: true });
    expect(helpIssues(report, 'zh-CN')).toEqual([]);
  });

  it('keeps the no-inline-source case unchanged: the default locale is still reported', () => {
    const report = computeI18nCoverage(stack({}, [enHelp]), { strict: true });
    expect(helpIssues(report, 'zh-CN').length).toBe(1);
  });
});
