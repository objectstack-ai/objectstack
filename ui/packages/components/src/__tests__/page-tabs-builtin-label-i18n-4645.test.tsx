/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in record-detail tab labels announce themselves in the session
 * locale — objectui#4645.
 *
 * `buildDefaultPageSchema` synthesizes the record-detail tab strip with plain
 * ENGLISH tokens on the nodes (`label: 'Details'`, `'Related'`,
 * `'Attachments'`, `'Activity'`, `'History'`, `'Approvals'`), and three of its
 * own comments say those tokens "localize through the tab strip's
 * KNOWN_LABEL_DICT". That dict shipped exactly two arms — `zh-CN` and `zh-TW`
 * — so the claim held for Chinese and silently failed for the eight other
 * shipped packs: a ja-JP / es-ES record detail rendered `Details / Related /
 * Attachments` inside otherwise fully-localized chrome.
 *
 * The packs already carry every one of these strings (`detail.details`,
 * `detail.related`, `detail.activity`, `detail.history`,
 * `detail.attachments`, `detail.approvalsPanelTitle` — all ten locales, no key
 * added by this change). The gap was purely that the tab strip never asked
 * them. It does now, BEHIND the exact-locale dict so `zh-TW` keeps the
 * Traditional forms it is the only source of.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * `en` and `zh` were GREEN before this change and stay green — they pin that
 * routing through the packs did not move what an English or a Simplified
 * Chinese session reads (the dict's zh rows and the pack's zh rows are
 * byte-identical for these six tokens). The other eight packs were RED: every
 * one of them rendered the English token. `ja` and `es` are the two the card
 * measured in a real browser on 17.0.0 GA.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/** Exactly the tokens `buildDefaultPageSchema` writes onto its tab nodes. */
const SYNTHESIZED_TABS: Array<{ token: string; packKey: keyof typeof builtInLocales.en.detail }> = [
  { token: 'Details', packKey: 'details' },
  { token: 'Related', packKey: 'related' },
  { token: 'Attachments', packKey: 'attachments' },
  { token: 'Activity', packKey: 'activity' },
  { token: 'History', packKey: 'history' },
  { token: 'Approvals', packKey: 'approvalsPanelTitle' },
];

const textChild = (content: string) => [{ type: 'element:text', properties: { content } }];

function renderSynthesizedStrip(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRenderer
        schema={{
          type: 'page:tabs',
          id: 'tabs',
          // The bag, where `PageTabsProps` declares `items` (objectui#11364).
          properties: {
            items: SYNTHESIZED_TABS.map(({ token }) => ({
              label: token,
              value: token.toLowerCase(),
              children: textChild(`${token} BODY`),
            })),
          },
        }}
      />
    </I18nProvider>,
  );
}

const tabTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="tab"]')).map((el) => el.textContent?.trim() ?? '');

afterEach(() => cleanup());

describe('page:tabs — built-in record-detail labels speak the session locale (objectui#4645)', () => {
  for (const language of Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>) {
    it(`renders the ${language} pack values for every synthesized tab`, () => {
      const { container } = renderSynthesizedStrip(language);
      const pack = builtInLocales[language].detail as Record<string, string>;

      expect(tabTexts(container)).toEqual(
        SYNTHESIZED_TABS.map(({ packKey }) => pack[packKey as string]),
      );
    });
  }

  /**
   * The derived assertion above compares render output against the pack, so it
   * would pass vacuously for a pack whose values happened to BE the English
   * tokens. These two literals are the control: they are the exact strings the
   * card measured as missing in a real browser, written out rather than
   * derived.
   */
  it('renders the ja-JP strings the card measured as English (lit control)', () => {
    const { container } = renderSynthesizedStrip('ja');
    const texts = tabTexts(container);

    expect(texts).toContain('詳細');
    expect(texts).toContain('関連');
    expect(texts).toContain('添付ファイル');
    expect(texts).not.toContain('Details');
    expect(texts).not.toContain('Related');
    expect(texts).not.toContain('Attachments');
  });

  it('renders the es-ES strings the card measured as English (lit control)', () => {
    const { container } = renderSynthesizedStrip('es');
    const texts = tabTexts(container);

    expect(texts).toContain('Detalles');
    expect(texts).toContain('Relacionados');
    expect(texts).toContain('Adjuntos');
    expect(texts).not.toContain('Details');
    expect(texts).not.toContain('Related');
    expect(texts).not.toContain('Attachments');
  });

  /**
   * `zh-TW` has no pack of its own — i18next resolves it to the Simplified
   * `zh` resource — so the exact-locale dict is the ONLY source of Traditional
   * forms for these tokens. It therefore stays AHEAD of the pack lookup, and
   * this is the assertion that says so.
   */
  it('keeps the zh-TW Traditional forms the dict is the only source of', () => {
    const { container } = renderSynthesizedStrip('zh-TW');
    const texts = tabTexts(container);

    expect(texts).toContain('詳情');
    expect(texts).toContain('相關');
    // The Simplified pack values, which a pack-first order would have produced.
    expect(texts).not.toContain('详情');
    expect(texts).not.toContain('相关');
  });

  /**
   * An author-supplied label is not a well-known token and must survive
   * untouched — the strip localizes the synthesizer's English, never the
   * author's copy.
   */
  it('leaves an authored label alone', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'ja', detectBrowserLanguage: false }}>
        <SchemaRenderer
          schema={{
            type: 'page:tabs',
            id: 'tabs',
            properties: {
              items: [
                { label: 'Invoices', value: 'a', children: textChild('A') },
                { label: 'Details', value: 'b', children: textChild('B') },
              ],
            },
          }}
        />
      </I18nProvider>,
    );

    expect(tabTexts(container)).toEqual(['Invoices', '詳細']);
  });
});
