/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10242 — the sibling keys of objectui#10024. Three surfaces choose
 * their key on `count === 1`: the `page:tabs` count badge's accessible name
 * (`common.itemCount`/`itemCountOne`), the activity-feed reaction chip
 * (`detail.reactionCount`/`reactionCountOne`) and the comment thread's header
 * and reaction tooltip (`collaboration.commentCount`/`reactionCount` and their
 * `…One` halves). Two slots fit `en`. They do not fit `ru` (one: 1, 21, 31…;
 * few: 2-4, 22-24…; many: 0, 5-20…) or `ar` (zero, one, two, few 3-10,
 * many 11-99, other 100-102…).
 *
 * What shipped before this card: the count-not-one half held one noun form. In
 * `ru` that was the `many` form, so a badge read `2 элементов` at two and
 * `21 элементов` at twenty-one, and a chip read `👍 2 реакций`. In `ar` it was
 * the 3-10 plural, so the badge, the header and the tooltip were wrong at 2 and
 * from 11 up.
 *
 * ## The repair: the objectui#10024 device, key by key
 *
 * The count-not-one half becomes a count label — a label, a colon, then the
 * number — so no noun has to agree with the number. The `ru` values match the
 * `ru` controls that already read right, `collaboration.commentCount`
 * (`Комментариев: {{count}}`) and `collaboration.reactionCount`
 * (`Реакций: {{count}}`). The `ar` values use the `عدد …: {{count}}` shape of
 * `search.resultsCountPlural` and `calendar.a11y.dayCell`. The singular halves,
 * the key set and the call sites were unchanged then.
 *
 * ## objectui#11445 — the repair this file pins now
 *
 * A count label reads right at any number, but it is not the noun form the
 * language uses. objectui#11432 let a pack hold every CLDR slot its language
 * selects, so objectui#11445 made each of these keys an i18next count family:
 * the components pass `count`, i18next picks the slot, and `ru` reads
 * «2 элемента», «5 элементов», «21 элемент» while `ar` reads the dual at 2, the
 * plural at 3-10 and the accusative singular at 11-99. The `…One` siblings
 * left all ten packs. The strings below are those, read from a real render.
 *
 * ## Why this file sits beside the objectui#10024 pin
 *
 * It is the same defect on the neighbouring keys, pinned in the same shape
 * (`SearchResultsPage.resultsCountPlural-10024.test.tsx`). `@object-ui/app-shell`
 * is also the one package that depends on all three consumers —
 * `@object-ui/components`, `@object-ui/plugin-detail` and
 * `@object-ui/collaboration` — so one file can render each of them for real.
 *
 * ## What this file measures
 *
 * The strings a user reads, from a real render inside a real i18next instance
 * booted in the session's language. `t` is not mocked. The reaction chip
 * passes `count` as a number, so i18next's own plural lookup (`_few` before the
 * bare key) is in the path. `en` and the `ru` comment thread are the controls:
 * this card does not change them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { SchemaRenderer } from '@object-ui/react';
import type { PublicBlockNodeOf } from '@object-ui/types';
import type { PageTabsProps } from '@objectstack/spec/ui';
import type { z } from 'zod';
// Registers `page:tabs` (and every other renderer) at module scope, never in a
// hook — see object-ui/no-dynamic-import-in-test-hook.
import '@object-ui/components';
import { ReactionPicker } from '@object-ui/plugin-detail';
import { CommentThread, type Comment } from '@object-ui/collaboration';

type Lang = 'en' | 'ru' | 'ar';

afterEach(() => cleanup());

function boot(lang: Lang) {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test; otherwise every
  // string below would be `en` read through `fallbackLng`.
  expect(i18n.language).toBe(lang);
  return i18n;
}

/** The `page:tabs` count badge's accessible name at `count`. */
function tabBadge(lang: Lang, count: number): string {
  const text = (content: string) => [{ type: 'element:text', properties: { content } }];
  // The node in the spec's carrier: `page:tabs` takes its props in the
  // `properties` bag, checked here against `@objectstack/spec`'s own
  // `PageTabsProps`, and `SchemaRenderer` hoists the bag onto the node before
  // the renderer reads `items` (objectui#11355).
  const tabs: PublicBlockNodeOf<'page:tabs'> = {
    type: 'page:tabs',
    id: 'tabs',
    properties: {
      // Two tabs: the strip, and with it the badge, is hidden at one.
      items: [
        { label: 'Related', value: 'related', count, children: text('A') },
        { label: 'Details', value: 'details', children: text('B') },
      ],
    } satisfies z.input<typeof PageTabsProps>,
  };
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <SchemaRenderer schema={tabs} />
    </I18nProvider>,
  );
  const badges = container.querySelectorAll('[role="tab"] span[aria-label]');
  expect(badges, `${lang} at ${count}: tab badge not found exactly once`).toHaveLength(1);
  expect(badges[0].textContent).toBe(String(count));
  const name = badges[0].getAttribute('aria-label') ?? '';
  cleanup();
  return name;
}

/** The activity-feed reaction chip's accessible name at `count`. */
function reactionChip(lang: Lang, count: number): string {
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <ReactionPicker reactions={[{ emoji: '👍', count, reacted: false }]} />
    </I18nProvider>,
  );
  // No `onToggleReaction`, so no add-reaction button: the chip is the only one.
  const chips = container.querySelectorAll('button[aria-label]');
  expect(chips, `${lang} at ${count}: reaction chip not found exactly once`).toHaveLength(1);
  const name = chips[0].getAttribute('aria-label') ?? '';
  cleanup();
  return name;
}

const users = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

/**
 * The comment thread at `count`: its header line with `count` comments, and
 * the tooltip of a reaction that `count` users gave.
 */
function commentThread(lang: Lang, count: number): { header: string; tooltip: string } {
  const comments: Comment[] = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    author: { id: 'u0', name: 'Author' },
    content: 'Looks good.',
    mentions: [],
    createdAt: new Date().toISOString(),
    reactions: i === 0 ? { '👍': users(count) } : undefined,
  }));
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <CommentThread threadId="t" comments={comments} currentUser={{ id: 'u0', name: 'Author' }} />
    </I18nProvider>,
  );
  // The header's count sits in a leaf span that holds nothing else (the thread
  // is unresolved, so no suffix follows it). Every other leaf span is a name,
  // a timestamp or a comment body, and none of those carries a digit here.
  const headers = Array.from(container.querySelectorAll('span')).filter(
    (span) => span.children.length === 0 && (span.textContent ?? '').includes(String(count)),
  );
  expect(headers, `${lang} at ${count}: header not found exactly once`).toHaveLength(1);
  const chips = Array.from(container.querySelectorAll('button[title]')).filter(
    (button) => button.textContent === `👍 ${count}`,
  );
  expect(chips, `${lang} at ${count}: reaction chip not found exactly once`).toHaveLength(1);
  const result = {
    header: headers[0].textContent ?? '',
    tooltip: chips[0].getAttribute('title') ?? '',
  };
  cleanup();
  return result;
}

/** One row per count: badge name, thread header, thread tooltip. */
type Row = [count: number, badge: string, header: string, tooltip: string];

/**
 * Every string this file expects. The counts are the triage's representative
 * numbers: `ru` 2 (few), 5 (many) and 21 (one); `ar` 2 (two), 3 (few) and 11
 * (many). Since objectui#11445 each is the family slot i18next selects — before
 * it, every count but 1 read the count label («Элементов: 2», «عدد العناصر: 2»).
 */
const EXPECTED: Record<Lang, Row[]> = {
  en: [
    [1, '1 item', '1 comment', '1 reaction'],
    [2, '2 items', '2 comments', '2 reactions'],
  ],
  ru: [
    [1, '1 элемент', '1 комментарий', '1 реакция'],
    [2, '2 элемента', '2 комментария', '2 реакции'],
    [5, '5 элементов', '5 комментариев', '5 реакций'],
    [21, '21 элемент', '21 комментарий', '21 реакция'],
  ],
  ar: [
    [1, '1 عنصر', '1 تعليق', '1 تفاعل'],
    [2, 'عنصران (2)', 'تعليقان (2)', 'تفاعلان (2)'],
    [3, '3 عناصر', '3 تعليقات', '3 تفاعلات'],
    [11, '11 عنصرًا', '11 تعليقًا', '11 تفاعلًا'],
  ],
};

/**
 * The reaction chip, `en` and `ru` only: the card's key list names `ru`
 * `detail.reactionCount`, not the `ar` one.
 */
const CHIP: Record<'en' | 'ru', Array<[number, string]>> = {
  en: [
    [1, '👍 1 reaction'],
    [2, '👍 2 reactions'],
  ],
  ru: [
    [1, '👍 1 реакция'],
    [2, '👍 2 реакции'],
    [5, '👍 5 реакций'],
    [21, '👍 21 реакция'],
  ],
};

describe('count labels read correctly at every CLDR category in ru and ar (objectui#10242)', () => {
  it('the representative counts reach the categories the count-not-one half serves', () => {
    const ru = new Intl.PluralRules('ru');
    const ar = new Intl.PluralRules('ar');
    expect([2, 5, 21].map((n) => ru.select(n))).toEqual(['few', 'many', 'one']);
    expect([2, 3, 11].map((n) => ar.select(n))).toEqual(['two', 'few', 'many']);
  });

  describe.each(['en', 'ru', 'ar'] as const)('%s', (lang) => {
    it.each(EXPECTED[lang])('page:tabs badge at %i', (count, badge) => {
      expect(tabBadge(lang, count)).toBe(badge);
    });

    it.each(EXPECTED[lang])('comment thread at %i', (count, _badge, header, tooltip) => {
      expect(commentThread(lang, count)).toEqual({ header, tooltip });
    });
  });

  describe.each(['en', 'ru'] as const)('%s', (lang) => {
    it.each(CHIP[lang])('reaction chip at %i', (count, chip) => {
      expect(reactionChip(lang, count)).toBe(chip);
    });
  });

  it('ru no longer binds the many-form noun to a few or one count', () => {
    // The shipped defect, named as the strings a Russian user read.
    expect(tabBadge('ru', 2)).not.toBe('2 элементов');
    expect(tabBadge('ru', 21)).not.toBe('21 элементов');
    expect(reactionChip('ru', 2)).not.toBe('👍 2 реакций');
    expect(reactionChip('ru', 21)).not.toBe('👍 21 реакций');
  });

  it('ar no longer binds the 3-10 plural to a dual or an 11+ count', () => {
    // The shipped defect, named as the strings an Arabic user read.
    expect(tabBadge('ar', 2)).not.toBe('2 عناصر');
    expect(tabBadge('ar', 11)).not.toBe('11 عناصر');
    expect(commentThread('ar', 2)).not.toEqual({ header: '2 تعليقات', tooltip: '2 تفاعلات' });
    expect(commentThread('ar', 11).header).not.toBe('11 تعليقات');
    expect(commentThread('ar', 11).tooltip).not.toBe('11 تفاعلات');
  });

  it('each label is an i18next count family in ru and ar, and its `…One` sibling is gone', () => {
    // The mechanism of the objectui#11445 repair, stated on the pack values: every
    // CLDR slot the language selects is spelled, so i18next — not a `=== 1` key
    // switch in the component — chooses the form.
    const at = (lang: 'ru' | 'ar', dotted: string) =>
      dotted
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], builtInLocales[lang]);
    const KEYS = ['common.itemCount', 'detail.reactionCount', 'collaboration.commentCount', 'collaboration.reactionCount'];
    for (const lang of ['ru', 'ar'] as const) {
      for (const key of KEYS) {
        for (const category of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
          expect(at(lang, `${key}_${category}`), `${lang} ${key}_${category}`).toEqual(expect.any(String));
        }
        expect(at(lang, `${key}One`), `${lang} ${key}One`).toBeUndefined();
      }
    }
  });
});
