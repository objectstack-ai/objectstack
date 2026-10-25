/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A read-only boolean is drawn with the locale's word (objectui#11689).
 *
 * Under zh-CN a record showed its boolean values as "Yes" / "No": the
 * read-only surfaces that draw a boolean as text spelled the English words in
 * code. They now read `common.yes` / `common.no` through `useBooleanValueLabel`
 * (`widgets/booleanValueLabel.tsx` says why that pair and not `grid.*` or
 * `lookup.yes`).
 *
 * Every case renders through a REAL `I18nProvider` over the real packs, so a
 * pin goes red if the word stops coming from the pack — a stand-in `t` would
 * pass against a widget that never asked the locale anything. The provider-less
 * cases pin the other half of the contract: an embed with no provider still
 * says `Yes` / `No`, through `useFieldTranslation`'s defaults table.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

import { BooleanField } from '../widgets/BooleanField';
import { FormulaField } from '../widgets/FormulaField';
import { renderLookupColumnValue } from '../widgets/lookupColumnDisplay';
import { BooleanCellRenderer } from '../index';

afterEach(() => cleanup());

const noop = () => {};

type Lang = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as Lang[];

function inLocale(language: Lang | null, node: React.ReactElement) {
  if (language === null) return render(node);
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {node}
    </I18nProvider>,
  );
}

/** The three read-only boolean drawers in this package, each as a host renders it. */
const DRAWERS: Record<string, (value: boolean) => React.ReactElement> = {
  'BooleanField (readonly)': (value) => (
    <BooleanField
      value={value}
      onChange={noop}
      field={{ type: 'boolean', name: 'email_verified' } as never}
      readonly={true}
    />
  ),
  'FormulaField (returnType boolean)': (value) => (
    <FormulaField
      value={value}
      onChange={noop}
      field={{ type: 'formula', name: 'is_overdue', returnType: 'boolean' } as never}
      readonly={true}
    />
  ),
  // No descriptor and no resolver: the plain-text fallback, the branch that
  // spelled the word.
  'renderLookupColumnValue (plain-text fallback)': (value) => (
    <span>{renderLookupColumnValue({ active: value }, { field: 'active' } as never, { descriptors: {} })}</span>
  ),
};

describe('read-only boolean words come from the locale (objectui#11689)', () => {
  for (const [name, draw] of Object.entries(DRAWERS)) {
    describe(name, () => {
      it('zh renders 是 / 否', () => {
        expect(inLocale('zh', draw(true)).container.textContent).toBe('是');
        cleanup();
        expect(inLocale('zh', draw(false)).container.textContent).toBe('否');
      });

      it('en is unchanged: Yes / No', () => {
        expect(inLocale('en', draw(true)).container.textContent).toBe('Yes');
        cleanup();
        expect(inLocale('en', draw(false)).container.textContent).toBe('No');
      });

      it("every pack's own common.yes / common.no is the word drawn", () => {
        for (const lang of LANGS) {
          expect(inLocale(lang, draw(true)).container.textContent, `${lang}: true`).toBe(
            builtInLocales[lang].common.yes,
          );
          cleanup();
          expect(inLocale(lang, draw(false)).container.textContent, `${lang}: false`).toBe(
            builtInLocales[lang].common.no,
          );
          cleanup();
        }
      });

      it('with no I18nProvider it still says Yes / No (the defaults table)', () => {
        expect(inLocale(null, draw(true)).container.textContent).toBe('Yes');
        cleanup();
        expect(inLocale(null, draw(false)).container.textContent).toBe('No');
      });
    });
  }
});

/**
 * The list face's own words (objectui#11689, the family site seat 1 recorded
 * from objectui#11721): the completion indicator's two accessible names, and
 * until objectui#13412 the status column's "LABEL — Off" badge. Every list
 * surface draws this face, so these were English on every list under every
 * pack.
 *
 * objectui#13412 retired the badge: a `false` on a status-like name draws the
 * plain unchecked box, named by the column label it is handed and by nothing
 * else. Its locale leg is therefore that the box carries the label as given
 * and no pack word at all, under every pack.
 */
describe('BooleanCellRenderer words come from the locale (objectui#11689)', () => {
  const badgeOf = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="boolean-warning-badge"]');
  const boxName = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[role="checkbox"]')?.getAttribute('aria-label');
  const indicatorName = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="completion-indicator"]')?.getAttribute('aria-label');

  it('zh: a status column holding false is an unchecked box named by the column label, with no pack word', () => {
    const { container } = inLocale(
      'zh',
      <BooleanCellRenderer value={false} field={{ name: 'active', type: 'boolean', label: '启用' } as never} />,
    );
    expect(badgeOf(container)).toBeNull();
    expect(boxName(container)).toBe('启用');
    // The badge's zh word, by its text: the face no longer reads that key.
    expect(container.textContent).not.toContain('已关闭');
  });

  it('zh: the completion indicator is named in the pack', () => {
    const field = { name: 'completed', type: 'boolean', label: 'Completed' } as never;
    expect(indicatorName(inLocale('zh', <BooleanCellRenderer value={true} field={field} />).container)).toBe('已完成');
    cleanup();
    expect(indicatorName(inLocale('zh', <BooleanCellRenderer value={false} field={field} />).container)).toBe('未完成');
  });

  it('en: an Active box, Completed, Not completed', () => {
    expect(
      boxName(
        inLocale('en', <BooleanCellRenderer value={false} field={{ name: 'active', type: 'boolean', label: 'Active' } as never} />)
          .container,
      ),
    ).toBe('Active');
    cleanup();
    const field = { name: 'completed', type: 'boolean' } as never;
    expect(indicatorName(inLocale('en', <BooleanCellRenderer value={true} field={field} />).container)).toBe('Completed');
    cleanup();
    expect(indicatorName(inLocale('en', <BooleanCellRenderer value={false} field={field} />).container)).toBe('Not completed');
  });

  it("every pack's own words are the ones drawn", () => {
    for (const lang of LANGS) {
      const words = builtInLocales[lang].fields.boolean;
      const off = inLocale(lang, <BooleanCellRenderer value={false} field={{ name: 'active', type: 'boolean', label: 'L' } as never} />)
        .container;
      expect(badgeOf(off), `${lang}: no badge`).toBeNull();
      expect(boxName(off), `${lang}: the box is named by the label alone`).toBe('L');
      expect(off.textContent, `${lang}: the box carries no pack word`).toBe('');
      cleanup();
      expect(
        indicatorName(inLocale(lang, <BooleanCellRenderer value={true} field={{ name: 'done', type: 'boolean' } as never} />).container),
        `${lang}: completed`,
      ).toBe(words.completed);
      cleanup();
      expect(
        indicatorName(inLocale(lang, <BooleanCellRenderer value={false} field={{ name: 'done', type: 'boolean' } as never} />).container),
        `${lang}: not completed`,
      ).toBe(words.notCompleted);
      cleanup();
    }
  });

  it('with no I18nProvider it still says the English words (the defaults table)', () => {
    expect(
      boxName(inLocale(null, <BooleanCellRenderer value={false} field={{ name: 'active', type: 'boolean', label: 'Active' } as never} />).container),
    ).toBe('Active');
    cleanup();
    expect(indicatorName(inLocale(null, <BooleanCellRenderer value={true} field={{ name: 'done', type: 'boolean' } as never} />).container)).toBe(
      'Completed',
    );
  });
});
