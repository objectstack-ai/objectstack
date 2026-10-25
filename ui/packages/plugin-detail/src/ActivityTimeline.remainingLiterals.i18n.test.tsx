/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The rest of `ActivityTimeline` speaks the session locale — objectui#7149.
 *
 * objectui#7142 fixed ONE literal in this component (the empty-state title) and
 * filed the sweep that found the other 18. The state that fix left behind is
 * what this file repairs and is worth naming exactly, because "the component is
 * translated" was never true of it: a zh card read `"Activity(0)暂无活动记录"`
 * — the empty state correct, the card title beside it still English.
 *
 * ## Why the assertions are zh/ja/ar and not en
 *
 * An `en`-only test is green BEFORE the fix as well, for every one of these
 * literals: each replacement key's `en` value is byte-identical to the literal
 * it replaces (verified against the pack objects, not by a dotted-key grep —
 * the packs are nested, so `detail.justNow` greps to zero against the very pack
 * that defines it). English therefore cannot discriminate a pack lookup from a
 * hardcoded string. Non-Latin locales can, which is why they carry the load
 * here — the same shape objectui#7142 used.
 *
 * ## The three groups, and why they are one file
 *
 * They differ in reachability, not in defect:
 *
 *   - **Timestamps + card title** render on EVERY activity tab. `DetailView`
 *     mounts this component at two call sites and both are gated only on
 *     `activities.length > 0`.
 *   - **The `formatFieldChange` sentences** render on every activity tab too,
 *     for any entry whose optional `description` is absent — which is the
 *     normal shape of a structured `field_change` / `create` / `delete` /
 *     `status_change` entry. Same reachability as the timestamps; they are a
 *     separate group only because they are assembled in code and so needed new
 *     keys WITH interpolation holes rather than a lookup swap.
 *   - **The filter chips + the group's aria-label** need `filterable`, which no
 *     host in this repo passes; they are reachable through the published export
 *     (`packages/plugin-detail/src/index.tsx`) by an outside consumer.
 *
 * No inline `defaultValue` anywhere (objectui#3517): every key resolves from the
 * ten packs, or from `DETAIL_DEFAULT_TRANSLATIONS` on a provider-less host.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { ActivityEntry } from '@object-ui/types';
import { ActivityTimeline } from './ActivityTimeline';

afterEach(() => cleanup());

/** Fixed clock offsets, chosen to land in each `formatTimestamp` branch. */
const MINUTES = 5;
const HOURS = 3;
const DAYS = 2;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const entry = (over: Partial<ActivityEntry>): ActivityEntry =>
  ({
    id: 'a1',
    type: 'field_change',
    user: 'Ada',
    timestamp: ago(MINUTES * 60_000),
    ...over,
  }) as ActivityEntry;

function renderIn(language: string | null, activities: ActivityEntry[], filterable = false) {
  const ui = <ActivityTimeline activities={activities} filterable={filterable} />;
  if (language === null) return render(ui);
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );
}

describe('objectui#7149 — relative timestamps resolve from the packs', () => {
  it('renders zh relative times, with the count interpolated into the pack value', () => {
    renderIn('zh', [
      entry({ id: 'm', timestamp: ago(MINUTES * 60_000) }),
      entry({ id: 'h', timestamp: ago(HOURS * 3_600_000) }),
      entry({ id: 'd', timestamp: ago(DAYS * 86_400_000) }),
      entry({ id: 'n', timestamp: ago(1_000) }),
    ]);

    // The `{{count}}` hole is filled, and filled by the ZH pack value —
    // "5分钟前", not "5m ago". Both halves matter: a lookup that resolved but
    // did not interpolate would render the literal braces.
    expect(screen.getByText(`${MINUTES}分钟前`)).toBeTruthy();
    expect(screen.getByText(`${HOURS}小时前`)).toBeTruthy();
    expect(screen.getByText(`${DAYS}天前`)).toBeTruthy();
    expect(screen.getByText('刚刚')).toBeTruthy();

    // The regression itself: the English literals must not survive.
    expect(screen.queryByText(`${MINUTES}m ago`)).toBeNull();
    expect(screen.queryByText('just now')).toBeNull();
    // …nor an uninterpolated hole.
    expect(screen.queryByText('{{count}}分钟前')).toBeNull();
  });

  it('renders ja and ar relative times', () => {
    renderIn('ja', [entry({ timestamp: ago(MINUTES * 60_000) })]);
    expect(screen.getByText(`${MINUTES}分前`)).toBeTruthy();
    cleanup();

    renderIn('ar', [entry({ timestamp: ago(MINUTES * 60_000) })]);
    // `detail.minutesAgo` is a count family since objectui#11445: 5 is `ar`
    // `few` (3-10), which takes the plural noun — the single form it replaced
    // read «منذ 5 دقيقة».
    expect(screen.getByText(`منذ ${MINUTES} دقائق`)).toBeTruthy();
  });

  it('still reads English with no provider mounted — the defaults map, not a raw key', () => {
    renderIn(null, [entry({ timestamp: ago(MINUTES * 60_000) })]);

    expect(screen.getByText(`${MINUTES}m ago`)).toBeTruthy();
    expect(screen.queryByText('detail.minutesAgo')).toBeNull();
    // The provider-less path interpolates too (`interpolateFallback`), so the
    // braces must be gone here as well — objectui#6219's failure shape.
    expect(screen.queryByText('{{count}}m ago')).toBeNull();
  });
});

describe('objectui#7149 — the Activity card title resolves from the packs', () => {
  it('titles the card in zh, ja and ar', () => {
    for (const [lang, word] of [
      ['zh', '活动'],
      ['ja', 'アクティビティ'],
      ['ar', 'النشاط'],
    ] as const) {
      renderIn(lang, [entry({})]);
      expect(screen.getByText(word), `${lang} card title`).toBeTruthy();
      // "Activity" was the literal; it must not be rendered as copy any more.
      expect(screen.queryByText('Activity'), `${lang} kept English title`).toBeNull();
      cleanup();
    }
  });

  it('is the half objectui#7142 left English — the whole card is now zh', () => {
    // The exact string the card recorded as the visible half-done state:
    // `"Activity(0)暂无活动记录"`. It is now Chinese end to end.
    const { container } = renderIn('zh', []);
    expect(container.textContent).toBe('活动(0)暂无活动记录');
  });
});

describe('objectui#7149 — formatFieldChange sentences resolve, holes and all', () => {
  it('renders the zh field-change sentence with all three holes filled', () => {
    renderIn('zh', [
      entry({ type: 'field_change', field: 'status_code', oldValue: 'open', newValue: 'closed' }),
    ]);

    expect(screen.getByText('将 Status code 从“open”改为“closed”')).toBeTruthy();
    expect(screen.queryByText('Changed Status code from "open" to "closed"')).toBeNull();
  });

  it('substitutes the localized (empty) placeholder for a null side', () => {
    renderIn('zh', [
      entry({ type: 'field_change', field: 'owner', oldValue: null, newValue: 'Ada' }),
    ]);

    // `(empty)` was a literal too, and it is INSIDE the sentence — a lookup that
    // translated the sentence but not the placeholder would read "从(empty)".
    expect(screen.getByText('将 Owner 从“(空)”改为“Ada”')).toBeTruthy();
  });

  it('renders the create / delete / status / fallback sentences in zh', () => {
    renderIn('zh', [
      entry({ id: 'c', type: 'create' }),
      entry({ id: 'd', type: 'delete' }),
      entry({ id: 's', type: 'status_change', field: 'stage', newValue: 'Won' }),
      entry({ id: 'u', type: 'comment' }),
    ]);

    expect(screen.getByText('创建了此记录')).toBeTruthy();
    expect(screen.getByText('删除了此记录')).toBeTruthy();
    expect(screen.getByText('将状态改为“Won”')).toBeTruthy();
    // `comment` with no description falls through to the catch-all.
    expect(screen.getByText('更新了记录')).toBeTruthy();

    for (const english of [
      'Created this record',
      'Deleted this record',
      'Changed status to "Won"',
      'Updated record',
    ]) {
      expect(screen.queryByText(english), `English survived: ${english}`).toBeNull();
    }
  });

  it('renders the de sentence with German quotes, not the ASCII pair', () => {
    renderIn('de', [
      entry({ type: 'field_change', field: 'stage', oldValue: 'A', newValue: 'B' }),
    ]);

    // The de pack may hold no U+0022 at all (de-quote-pairing-3876), so this is
    // also the render-side proof of that gate's subject.
    expect(screen.getByText('Stage von „A“ zu „B“ geändert')).toBeTruthy();
  });

  it('leaves an author-supplied description alone in every locale', () => {
    // `description` short-circuits before any lookup: it is the host's own copy,
    // not ours to translate.
    renderIn('zh', [entry({ type: 'create', description: 'Imported from CRM' })]);
    expect(screen.getByText('Imported from CRM')).toBeTruthy();
    expect(screen.queryByText('创建了此记录')).toBeNull();
  });
});

describe('objectui#7149 — filter chips and the group aria-label (published-export path)', () => {
  it('labels all six chips from the packs under zh', () => {
    renderIn('zh', [entry({})], true);

    const group = screen.getByRole('group');
    for (const label of ['全部', '字段变更', '创建', '删除', '评论', '状态变更']) {
      expect(within(group).getByText(label), `zh chip ${label}`).toBeTruthy();
    }
    for (const english of ['All', 'Field Changes', 'Creates', 'Deletes', 'Comments', 'Status Changes']) {
      expect(within(group).queryByText(english), `English chip survived: ${english}`).toBeNull();
    }
  });

  it('names the chip group from the pack, in zh and ar', () => {
    // Reuses `detail.filterActivity` — the key `RecordActivityTimeline` already
    // uses for the accessible name of ITS activity filter. That is a deliberate
    // English copy change ("Activity type filter" -> "Filter activity") so one
    // control does not carry two names across two components; see the PR.
    renderIn('zh', [entry({})], true);
    expect(screen.getByRole('group', { name: '筛选活动' })).toBeTruthy();
    cleanup();

    renderIn('ar', [entry({})], true);
    expect(screen.getByRole('group', { name: 'تصفية النشاط' })).toBeTruthy();
  });

  it('falls back to English chip labels with no provider, never raw keys', () => {
    renderIn(null, [entry({})], true);

    const group = screen.getByRole('group');
    for (const label of ['All', 'Field Changes', 'Creates', 'Deletes', 'Comments', 'Status Changes']) {
      expect(within(group).getByText(label), `no-provider chip ${label}`).toBeTruthy();
    }
    for (const key of ['detail.allFilter', 'detail.createsFilter', 'detail.deletesFilter']) {
      expect(within(group).queryByText(key), `raw key rendered: ${key}`).toBeNull();
    }
  });
});

describe('objectui#7149 — no raw key reaches the DOM on any path', () => {
  it('renders no `detail.` key text, provider or not, filterable or not', () => {
    const activities = [
      entry({ id: 'f', type: 'field_change', field: 'stage', oldValue: 'A', newValue: 'B' }),
      entry({ id: 'c', type: 'create' }),
      entry({ id: 's', type: 'status_change', field: 'stage', newValue: 'Won' }),
    ];

    for (const lang of ['zh', 'ja', 'ar', 'de', 'en', null] as const) {
      for (const filterable of [true, false]) {
        const { container } = renderIn(lang, activities, filterable);
        expect(
          container.textContent,
          `raw key leaked (lang=${lang}, filterable=${filterable})`,
        ).not.toMatch(/detail\.[a-zA-Z]/);
        // …and no unfilled interpolation hole, which the raw-key probe misses.
        expect(
          container.textContent,
          `unfilled hole (lang=${lang}, filterable=${filterable})`,
        ).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
        cleanup();
      }
    }
  });
});
