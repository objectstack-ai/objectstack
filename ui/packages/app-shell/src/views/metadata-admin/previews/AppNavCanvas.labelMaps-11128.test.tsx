// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11128: Studio's app designer canvas (AppNavCanvas, design mode)
 * shows a locale-map nav label resolved in the designer locale, and an inline
 * rename of a map edits the designer locale's entry only.
 *
 * The spec types a nav item's `label` as `I18nLabel`: a plain string or an
 * inline locale map. Before this card the canvas:
 *   - read the label only when `typeof label === 'string'`, so a map-labelled
 *     entry read as the positional "Item N" while the preview's landing line
 *     beside it showed the resolved text (objectui#11100's fix);
 *   - renamed by writing `{ ...item, label: nextLabel }`, which replaced the
 *     whole map with one string and deleted every other language's text;
 *   - printed that positional fallback as English under zh-CN.
 *
 * The cases:
 *   - a map-labelled item shows the resolved text under en and zh;
 *   - renaming it under zh changes only `zh-CN`, and `en` survives;
 *   - renaming it under en writes the `en` entry the card read (the designer
 *     locale is `en-US`), and adds no second English key;
 *   - a map with no entry for the designer locale gains one, and the entry the
 *     resolver only reached as another language's fallback is kept;
 *   - a plain-string item renames to a plain string, as before (the control);
 *   - the catalogue's positional row reads in zh. It is for an entry the
 *     runtime's inheritance rule names nothing (a separator): an unlabelled
 *     item with a target shows the text it inherits (objectui#11196).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { tFormat } from '../i18n';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

const ITEM_LABEL = { en: 'Accounts', 'zh-CN': '客户' };

type Language = 'en' | 'zh';
const DESIGNER_LOCALE: Record<Language, string> = { en: 'en-US', zh: 'zh-CN' };

/** Design mode: `editing` + `onSelectionChange` selects the canvas; `onPatch` makes it editable. */
function renderCanvas(navigation: unknown[], language: Language) {
  const onPatch = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <AppPreview
        type="app"
        name="crm"
        draft={{ name: 'crm', label: 'CRM', navigation }}
        editing
        selection={null}
        onSelectionChange={() => {}}
        onPatch={onPatch}
        locale={DESIGNER_LOCALE[language]}
      />
    </I18nProvider>,
  );
  return onPatch;
}

/** Inline-rename the card showing `shown` to `next`, and return the label the canvas wrote. */
function rename(onPatch: ReturnType<typeof vi.fn>, shown: string, next: string): unknown {
  fireEvent.doubleClick(screen.getByText(shown));
  const input = screen.getByDisplayValue(shown);
  fireEvent.change(input, { target: { value: next } });
  fireEvent.blur(input);
  expect(onPatch).toHaveBeenCalledTimes(1);
  const patch = onPatch.mock.calls[0][0] as { navigation: Array<{ label?: unknown }> };
  return patch.navigation[0].label;
}

describe('AppNavCanvas resolves a locale-map nav label in the designer locale (objectui#11128)', () => {
  const cases: Array<[Language, string]> = [
    ['en', 'Accounts'],
    ['zh', '客户'],
  ];

  for (const [language, shown] of cases) {
    it(`shows a map-labelled item as its ${DESIGNER_LOCALE[language]} text in design mode`, () => {
      renderCanvas([{ id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' }], language);

      expect(screen.getByText(shown)).toBeTruthy();
      const positional = tFormat('engine.appNav.item', DESIGNER_LOCALE[language], { n: 1 });
      expect(screen.queryByText(positional), 'a resolved label never reads as the positional fallback').toBeNull();
      expect(document.body.textContent).not.toContain('[object Object]');
    });
  }

  it('reads the catalogue row, in zh, for an entry the inheritance rule names nothing', () => {
    renderCanvas([{ id: 'rule', type: 'separator' }], 'zh');

    const zh = tFormat('engine.appNav.item', 'zh-CN', { n: 1 });
    expect(zh).not.toBe(tFormat('engine.appNav.item', 'en-US', { n: 1 }));
    expect(screen.getByText(zh)).toBeTruthy();
  });
});

describe('AppNavCanvas renames only the designer locale entry of a map (objectui#11128)', () => {
  it('renaming under zh changes only `zh-CN`, and `en` survives', () => {
    const onPatch = renderCanvas([{ id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' }], 'zh');

    expect(rename(onPatch, '客户', '客户账户')).toEqual({ en: 'Accounts', 'zh-CN': '客户账户' });
  });

  it('renaming under en writes the `en` entry the card read, not a second `en-US` key', () => {
    const onPatch = renderCanvas([{ id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' }], 'en');

    expect(rename(onPatch, 'Accounts', 'Customers')).toEqual({ en: 'Customers', 'zh-CN': '客户' });
  });

  it('a map with no entry for the designer locale gains one, and keeps every other entry', () => {
    // Under zh-CN the card falls back to another language's text: the sibling
    // region is read first. Neither it nor `en` / `default` is the zh-CN entry.
    const label = { default: 'Accounts', en: 'Accounts (en)', 'zh-TW': '客戶' };
    const onPatch = renderCanvas([{ id: 'accounts', type: 'object', label, objectName: 'account' }], 'zh');

    expect(rename(onPatch, '客戶', '客户')).toEqual({ ...label, 'zh-CN': '客户' });
  });

  it('renames a plain-string label to a plain string, as before (the control)', () => {
    const onPatch = renderCanvas([{ id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' }], 'zh');

    expect(rename(onPatch, 'Accounts', 'Customers')).toBe('Customers');
  });
});
