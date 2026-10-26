/**
 * objectui#11696 — `useObjectLabel().objectPluralLabel`, the name of a list of
 * an object's records.
 *
 * The object list page and its breadcrumb used `objectLabel` (the singular) to
 * title a page that lists records, while the nav entry that opens it read
 * "Projects". `pluralLabel` is declared by the spec, served on every object
 * document and carried into the client bundle by `transformSpecTranslations`,
 * but no console surface resolved it.
 *
 * The order pinned here: the translated plural, else the declared plural, else
 * the singular as `objectLabel` resolves it. The `zh-CN` bundles below give
 * `pluralLabel` a DIFFERENT string from `label` on purpose: shipped zh-CN
 * bundles often use one word for both (`项目` / `项目`), and with equal strings
 * an assertion cannot tell which key was read.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';

function wrapperFor(language: 'en' | 'zh-CN') {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, {
      config: { defaultLanguage: language, detectBrowserLanguage: false },
      persistLanguage: false,
      children,
    });
}

function hookIn(language: 'en' | 'zh-CN', objects?: Record<string, unknown>) {
  const { result } = renderHook(
    () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
    { wrapper: wrapperFor(language) },
  );
  if (objects) {
    result.current.i18n.addResourceBundle(language, 'translation', { showcase: { objects } }, true, true);
  }
  return result;
}

const PROJECT = { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects' };

describe('useObjectLabel().objectPluralLabel (objectui#11696)', () => {
  it('en: the declared plural, not the singular', () => {
    const result = hookIn('en');
    expect(result.current.labels.objectPluralLabel(PROJECT)).toBe('Projects');
    // The singular helper is unchanged — the record page keeps it.
    expect(result.current.labels.objectLabel(PROJECT)).toBe('Project');
  });

  it('zh-CN: the translated plural wins over the declared one', () => {
    const result = hookIn('zh-CN', {
      showcase_project: { label: '项目', pluralLabel: '项目清单' },
    });
    expect(result.current.labels.objectPluralLabel(PROJECT)).toBe('项目清单');
    expect(result.current.labels.objectLabel(PROJECT)).toBe('项目');
  });

  it('a namespaced object resolves a bundle keyed by its short name, as objectLabel does', () => {
    const result = hookIn('zh-CN', {
      project: { label: '项目', pluralLabel: '项目清单' },
    });
    expect(
      result.current.labels.objectPluralLabel({ ...PROJECT, name: 'showcase__project' }),
    ).toBe('项目清单');
  });

  it('no plural declared: the singular, translated when the bundle translates it', () => {
    const undeclared = { name: 'showcase_project', label: 'Project' };
    expect(hookIn('en').current.labels.objectPluralLabel(undeclared)).toBe('Project');
    expect(
      hookIn('zh-CN', { showcase_project: { label: '项目' } }).current.labels.objectPluralLabel(undeclared),
    ).toBe('项目');
  });

  it('an empty declared plural counts as undeclared', () => {
    const result = hookIn('en');
    expect(result.current.labels.objectPluralLabel({ ...PROJECT, pluralLabel: '' })).toBe('Project');
  });

  it('a bundle that translates the singular only: the declared plural, as the server serves it', () => {
    // `translateObject` in `@objectstack/spec` resolves `pluralLabel` as the
    // catalog entry, else the authored value, with no step down to a
    // translated singular. The console takes the same answer instead of
    // inventing a second one; see the helper's docblock.
    const result = hookIn('zh-CN', { showcase_project: { label: '项目' } });
    expect(result.current.labels.objectPluralLabel(PROJECT)).toBe('Projects');
  });
});
