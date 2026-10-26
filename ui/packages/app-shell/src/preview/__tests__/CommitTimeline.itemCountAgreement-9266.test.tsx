/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9266 — the commit row's item count agrees with its own number, in
 * all ten packs.
 *
 * ## Why this has to RENDER, and render through a real provider
 *
 * The defect was not in any one pack value. It was in the ADJACENCY: the row
 * composed `{c.itemCount} {t('preview.history.items')}`, so the number lived in
 * the component and the noun lived in the pack, and no translator could make
 * the two agree from the leaf they owned. A pack-only assertion therefore
 * cannot see the defect — every one of the old values was a perfectly good word
 * on its own. What is asserted here is the string a user reads, taken off the
 * DOM, with `I18nProvider` mounted so i18next (not the provider-less fallback)
 * is what resolves the key.
 *
 * The card that filed this derived the breakage from the call site and the pack
 * values rather than from a run. That derivation was right about six packs and
 * an earlier report of it was wrong about two, which is the reason this file
 * exists: the split is now MEASURED, and it is measured for all ten packs at
 * once so a future reading cannot re-name a subset.
 *
 * ## The negative control
 *
 * `en` / `zh` / `ja` / `ko` were already correct and must still render EXACTLY
 * what they rendered before the fix — `zh`/`ja`/`ko` because their grammar does
 * not mark plural at all, `en` because its value already dodged the problem
 * with the `(s)` marker. Those four cases are green before and after; they are
 * here to fail if a later "consistency" pass drags them into the colon form and
 * changes copy that was never broken.
 *
 * ## Why not a plural family
 *
 * `all-locales-key-parity.test.ts` requires identical key sets across the ten
 * packs, so a family can only ever be base + `_one` + `_other`: `ru` cannot have
 * `_few`, `ar` cannot have `_two` / `_many`. Measured against a real i18next
 * instance, that shape leaves `ru` reading `2 элементов` and `ar` `11 عناصر` —
 * wrong at exactly the counts a build history shows most often. The fix that is
 * correct at EVERY count is one interpolated value per pack, each written in an
 * idiom whose grammar does not bend on the number; that is the same repair
 * `fields.textarea.charactersRemaining` already carries, for the same reason.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { CommitTimeline } from '../CommitTimeline';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** The ten built-in packs, in the order `packages/i18n` registers them. */
const LANGS = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar'] as const;
type Lang = (typeof LANGS)[number];

/** Packs whose rendered output this fix must leave byte-identical. */
const UNCHANGED: readonly Lang[] = ['en', 'zh', 'ja', 'ko'];

/**
 * What the row reads at one item. The six non-control packs are the ones that
 * used to read `1 Elemente` / `1 éléments` / `1 elementos` / `1 itens` /
 * `1 элементов` / `1 عناصر`.
 */
const AT_ONE: Record<Lang, string> = {
  en: '1 item(s)',
  zh: '1 项',
  ja: '1 件',
  ko: '1 항목',
  de: 'Elemente: 1',
  fr: 'Éléments : 1',
  es: 'Elementos: 1',
  pt: 'Itens: 1',
  ru: 'Элементов: 1',
  ar: 'العناصر: 1',
};

/**
 * The same row at a count in the range Russian's `few` and Arabic's `few` cover
 * — the counts a `_one`/`_other` family could not have served. Nothing about
 * the wording may change with the number; only the digit moves.
 */
const AT_THREE: Record<Lang, string> = Object.fromEntries(
  (Object.entries(AT_ONE) as [Lang, string][]).map(([lang, text]) => [
    lang,
    text.replace('1', '3'),
  ]),
) as Record<Lang, string>;

function mockCommits(itemCount: number) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: 'c1', operation: 'apply', message: 'M', itemCount }],
  })) as unknown as typeof fetch;
}

const wrapperFor = (lang: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {children}
      </I18nProvider>
    );
  };

/** The metadata line under the commit message — the count, actor and age row. */
async function metaLineIn(lang: Lang, itemCount: number): Promise<string> {
  mockCommits(itemCount);
  render(<CommitTimeline open onOpenChange={() => {}} packageId="com.x" />, {
    wrapper: wrapperFor(lang),
  });
  const row = await screen.findByTestId('commit-row');
  const meta = row.querySelectorAll('p')[1];
  expect(meta, `${lang}: no metadata line rendered`).toBeTruthy();
  return meta.textContent ?? '';
}

beforeEach(() => {
  // The provider persists the last language, so a stale locale would otherwise
  // leak from one case into the next.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#9266 — the commit row agrees with its own item count', () => {
  it('the table covers every pack — not an empty walk', () => {
    expect(LANGS).toHaveLength(10);
    expect(Object.keys(AT_ONE).sort()).toEqual([...LANGS].sort());
    expect(new Set(Object.values(AT_ONE)).size).toBe(10);
    // Every pack states the count; none of them dropped the number. This is the
    // line that fails if someone "fixes" the grammar by deleting the digit —
    // the ruling objectui#9170 took for `kanban.columns`, where the lanes are
    // visible anyway. Here the count IS the content.
    for (const [lang, text] of Object.entries(AT_ONE)) {
      expect(text, `${lang} dropped the number`).toContain('1');
    }
  });

  it.each(LANGS)('%s reads correctly at one item', async (lang) => {
    expect(await metaLineIn(lang, 1)).toBe(AT_ONE[lang]);
  });

  it.each(LANGS)('%s says the same words at three items', async (lang) => {
    expect(await metaLineIn(lang, 3)).toBe(AT_THREE[lang]);
  });

  it.each(UNCHANGED)('%s renders exactly what it rendered before the fix', async (lang) => {
    // Green before and after — that is the point. These four packs were already
    // grammatical and this change must not have touched what they say.
    const BEFORE: Record<string, string> = {
      en: '1 item(s)',
      zh: '1 项',
      ja: '1 件',
      ko: '1 항목',
    };
    expect(await metaLineIn(lang, 1)).toBe(BEFORE[lang]);
  });
});
