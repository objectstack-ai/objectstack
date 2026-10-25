/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every timestamp face on the record page reads the DECLARED session locale,
 * never the machine's (objectui#9786).
 *
 * ## The contract, and the sentence being honoured
 *
 * `useDisplayLocale` states the rule in its own doc comment: the one thing a
 * caller must not do is reach past the hook and hand `Intl` the `undefined` it
 * gets on an unconfigured workspace, because `undefined` means "the MACHINE's
 * locale, which is neither channel". objectui#9453 put the `summaryFields`
 * chip on the hook; this file covers the timeline / history / dialog / footer
 * surfaces in the same package, which were still passing nothing at all.
 *
 * The census also named `PointInTimeRestore.tsx` and `DiffView.tsx`. Their rows
 * left this file when objectui#7192 deleted both components (with five other
 * unregistered, unmounted `plugin-detail` exports, by maintainer ruling).
 *
 * ## ⭐ Why every family is measured as a DIFFERENCE, not as a literal
 *
 * A literal expectation measures the runner, not the code: on a `de-DE`
 * machine a broken surface and a repaired one print the same bytes. Each
 * family below therefore renders the SAME stored instant twice — once under a
 * declared `de-DE` session, once under a declared `en` one — and requires the
 * two readings to DIFFER. Before this card both readings came from the
 * machine, whatever it was, so they were byte-identical on every runner
 * including a German one.
 *
 * Only the tenant locale moves between the two mounts: the UI language stays
 * `en` in both, so every translated string is identical and the only thing
 * that can make the two readings differ is the `Intl` tag.
 *
 * ## ⭐ What a source grep CANNOT see, and why the tripwire exists
 *
 * The card's census instrument matched `toLocaleDateString()` with no argument
 * and `Intl.*Format(undefined`. That shape is blind to a call that passes a
 * VARIABLE which happens to be `undefined` at runtime — and this package had
 * exactly one: `HistoryTimeline`'s optional `locale` prop reached
 * `Intl.RelativeTimeFormat(locale, …)` and neither of its two call sites
 * passed it, so the prop's own doc comment declared the defect ("Defaults to
 * browser locale"). `recordLocaleArguments` (`@object-ui/test-support`) closes that hole by
 * observing the ARGUMENT every `Intl` constructor and every
 * `Date.prototype.toLocale*` call actually receives while a surface renders.
 * It sees through variables, spreads and defaults, which no grep does.
 *
 * The repo-wide census (`packages/i18n/src/__tests__/machineLocaleCensus-9909.test.ts`,
 * which this package's own census pin became under the ruling on objectui#9786)
 * is the other half: it reddens when a NEW bare or hard-coded site is written
 * anywhere in a package that depends on `@object-ui/i18n`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import type { ActivityEntry, CommentEntry, FeedItem } from '@object-ui/types';
import { ActivityTimeline } from '../ActivityTimeline';
import { ConcurrentUpdateDialog } from '../ConcurrentUpdateDialog';
import { HistoryTimeline, type HistoryEntry } from '../HistoryTimeline';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { RecordComments } from '../RecordComments';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { ThreadedReplies } from '../ThreadedReplies';

afterEach(() => cleanup());

/**
 * One fixed instant, old enough that every relative-phrase branch in this
 * package has already fallen through to its absolute tail. The suite runs in
 * UTC (`vitest.config.mts` pins it), so the local face is deterministic.
 */
const STORED = '2020-03-04T15:30:00.000Z';

/**
 * The session locale is DECLARED, never inherited from the runner — the same
 * mount objectui#9453 pinned the summary chip through. The UI language is `en`
 * on BOTH legs so that the tenant locale is the only variable.
 */
function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

/**
 * What the surface put on the page, portals included.
 *
 * `reveal` is for a face that sits behind an affordance rather than behind a
 * locale — `ThreadedReplies` renders its list collapsed, so without the click
 * the assertion would measure a header that carries no timestamp at all.
 */
function textUnder(locale: string, node: React.ReactNode, reveal?: () => void): string {
  render(session(locale, node));
  reveal?.();
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

/** Open the collapsed reply list. */
function expandReplies(): void {
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  expect(toggle, 'ThreadedReplies renders a reply-count toggle').not.toBeNull();
  fireEvent.click(toggle!);
}

/* -------------------------------------------------------------------------- */
/* The runtime tripwire — it observes ARGUMENTS, so variables cannot hide       */
/* -------------------------------------------------------------------------- */

// `recordLocaleArguments` and `isMachineLocale` were written here and moved to
// `@object-ui/test-support` when objectui#9909 applied this pin pattern to
// every surface its sweep changed: one instrument, not a copy per package. The
// instrument's own controls (it sees a machine-locale call when one is made,
// and passes a call that states its tag) moved with it, to
// `packages/test-support/src/__tests__/locale-tripwire.test.ts`.

/* -------------------------------------------------------------------------- */
/* The surfaces — one entry per file the census named                          */
/* -------------------------------------------------------------------------- */

const activities: ActivityEntry[] = [
  { id: 'a1', type: 'comment', user: 'Ada', timestamp: STORED } as ActivityEntry,
];
const comments: CommentEntry[] = [
  { id: 'c1', author: 'Ada', text: 'hello', createdAt: STORED } as CommentEntry,
];
const feedItems: FeedItem[] = [
  { id: 'f1', type: 'comment', actor: 'Ada', body: 'hello', createdAt: STORED } as FeedItem,
];
const replies: FeedItem[] = [
  { id: 'f2', type: 'comment', actor: 'Grace', body: 'reply', createdAt: STORED } as FeedItem,
];
const historyEntries: HistoryEntry[] = [
  { id: 'h1', created_at: STORED, action: 'update', user_name: 'Ada' },
];

interface Surface {
  /** The file the census named. */
  file: string;
  /** What the repaired call site is. */
  site: string;
  node: React.ReactNode;
  /** The de-DE face this surface must show. */
  de: RegExp;
  /** The `en` face it must keep. */
  en: RegExp;
  /** Opens the affordance the face lives behind, when it has one. */
  reveal?: () => void;
}

/** The two faces of `STORED` that a bare `toLocaleDateString` would hide. */
const DE_DATE = /4\.3\.2020/;
const EN_DATE = /3\/4\/2020/;
/** …and of a bare `toLocaleString`. */
const DE_DATETIME = /4\.3\.2020, 15:30:00/;
// ⚠️ `\s`, not a literal space: ICU puts a NARROW NO-BREAK SPACE before `PM`,
// which `textUnder` collapses to an ASCII space — both spellings must match.
const EN_DATETIME = /3\/4\/2020, 3:30:00\sPM/;

const SURFACES: Surface[] = [
  {
    file: 'ActivityTimeline.tsx',
    site: 'past-a-week toLocaleDateString tail',
    node: <ActivityTimeline activities={activities} />,
    de: DE_DATE,
    en: EN_DATE,
  },
  {
    file: 'RecordComments.tsx',
    site: 'past-a-week toLocaleDateString tail',
    node: <RecordComments comments={comments} />,
    de: DE_DATE,
    en: EN_DATE,
  },
  {
    file: 'RecordActivityTimeline.tsx',
    site: 'past-a-week toLocaleDateString tail',
    node: <RecordActivityTimeline items={feedItems} />,
    de: DE_DATE,
    en: EN_DATE,
  },
  {
    file: 'ThreadedReplies.tsx',
    site: 'past-a-week toLocaleDateString tail',
    node: <ThreadedReplies parentItem={feedItems[0]} replies={replies} showReplyInput={false} />,
    de: DE_DATE,
    en: EN_DATE,
    reveal: expandReplies,
  },
  {
    file: 'ConcurrentUpdateDialog.tsx',
    site: "the racer's updated_at",
    node: (
      <ConcurrentUpdateDialog
        open
        conflict={{
          field: 'stage',
          label: 'Stage',
          pendingValue: 'won',
          currentValue: 'lost',
          currentRecord: { updated_at: STORED, updated_by_name: 'Grace' },
        }}
        onReload={() => {}}
        onOverwrite={() => {}}
        onCancel={() => {}}
      />
    ),
    de: DE_DATETIME,
    en: EN_DATETIME,
  },
  {
    file: 'HistoryTimeline.tsx',
    // ⚠️ The ABSOLUTE face of this file is a `TooltipContent` child and Radix
    // keeps it out of the DOM until the tooltip opens, so the observable face
    // here is the relative one. The absolute call site is covered by the
    // tripwire below, which sees the call without needing its output rendered.
    site: 'the Intl.RelativeTimeFormat face',
    node: <HistoryTimeline entries={historyEntries} />,
    de: /vor \d+ Jahren/,
    en: /\d+ years ago/,
  },
];

/**
 * `RecordMetaFooter` is kept out of the table above for a stated reason: its
 * absolute face is a `TooltipContent` child, which Radix does not put in the
 * DOM until the tooltip opens. The `Intl.DateTimeFormat` call still HAPPENS on
 * every render — a JSX child expression is evaluated when the element is
 * created — so it is measured through the tripwire instead of through the DOM.
 */
const META_FOOTER = (
  <RecordMetaFooter data={{ id: 'r1', created_at: STORED, created_by: 'Ada' }} />
);

describe('record-page timestamps format in the DECLARED session locale (objectui#9786)', () => {
  it.each(SURFACES)('$file — $site says the de-DE face under a de-DE session', ({ node, de, reveal }) => {
    const text = textUnder('de-DE', node, reveal);
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$file — $site keeps its en face under an en session', ({ node, en, reveal }) => {
    const text = textUnder('en', node, reveal);
    expect(text, `got: ${text}`).toMatch(en);
  });

  /**
   * ⭐ THE PIN, stated so the runner's own locale cannot satisfy it. Before
   * this card every one of these read the machine's locale on both legs and
   * was byte-identical; a German runner made the literal rows above green on
   * the broken code and makes no difference at all to this one.
   */
  it.each(SURFACES)('$file — is a reading of the session, not of the machine', ({ node, reveal }) => {
    expect(textUnder('de-DE', node, reveal)).not.toBe(textUnder('en', node, reveal));
  });

  /**
   * The one surface whose relative face is also `Intl`-formatted. Asserted
   * separately because it is a different call site in the same file, and the
   * absolute row above passes while this one is still broken.
   */
  it('HistoryTimeline.tsx — the RELATIVE face follows the session locale too', () => {
    const de = textUnder('de-DE', <HistoryTimeline entries={historyEntries} />);
    const en = textUnder('en', <HistoryTimeline entries={historyEntries} />);
    expect(de, `got: ${de}`).toMatch(/vor \d+ Jahren/);
    expect(en, `got: ${en}`).toMatch(/\d+ years ago/);
  });

  /**
   * The prop is an OVERRIDE, not the channel. A caller that states a tag still
   * wins — this is what keeps the repair from becoming "the hook, always".
   */
  it('HistoryTimeline.tsx — an explicit `locale` prop still overrides the session', () => {
    const text = textUnder('en', <HistoryTimeline entries={historyEntries} locale="de-DE" />);
    expect(text, `got: ${text}`).toMatch(/vor \d+ Jahren/);
  });
});

describe('no record-page surface hands Intl the machine locale (objectui#9786)', () => {
  /**
   * ⭐ The half a grep cannot do. Every surface is rendered with the locale
   * intrinsics instrumented, and every argument they actually received is
   * inspected — so a call that passes a variable, a default or a spread that
   * resolves to `undefined` is caught exactly like a bare call is.
   */
  it.each([
    ...SURFACES,
    {
      file: 'RecordMetaFooter.tsx',
      site: 'the tooltip absolute face',
      node: META_FOOTER,
      de: /x^/,
      en: /x^/,
      reveal: undefined,
    },
  ])('$file — every locale-taking call receives the declared tag', ({ node, reveal }) => {
    const calls = recordLocaleArguments(() => {
      render(session('de-DE', node));
      reveal?.();
    });
    cleanup();

    /**
     * ⚠️ `some(locale === 'de-DE')`, ⛔ NOT `calls.length > 0`. The weaker form
     * is satisfied by any locale-taking call the render happens to make,
     * including i18next's own plural machinery, and it was: measured on the
     * blanket ablation of all nine files, this row stayed GREEN for
     * `ThreadedReplies` — whose face is behind a collapsed toggle — while
     * every other file's went red. The session's tenant locale is the one tag
     * nothing but the surface under test passes, so requiring it is what makes
     * this a reading of the component rather than of its neighbours.
     */
    expect(
      calls.some((c) => c.locale === 'de-DE'),
      `the tripwire observed the surface's own call (saw: ${JSON.stringify(calls)})`,
    ).toBe(true);
    expect(
      calls.filter(isMachineLocale),
      'these call sites formatted in the machine locale',
    ).toEqual([]);
  });
});
