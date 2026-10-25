/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11445 — a count that a word must agree with is an i18next count
 * family, in every pack. No other spelling of a count label may appear.
 *
 * ## What was broken
 *
 * objectui#11432 gave every i18next count family every CLDR category its
 * language selects, and `plural-categories-11432.test.ts` proves i18next
 * selects each slot. Two other spellings of the same defect sat outside that
 * rule, because i18next was not the one choosing:
 *
 *   - **code-selected pairs** — `detail.attachmentCount` / `…CountPlural`,
 *     `common.itemCount` / `…CountOne` and thirteen more. The component picked
 *     the key on `=== 1`, which gives a pack two slots; `ru` needs three integer
 *     forms and `ar` five, so `ru` read «3 вложений» and `ar` «2 مرفقات».
 *   - **single-form count keys** — one string at every count, so `ru` read
 *     «Согласовать 3 запросов?» and `en` itself «3 row modified».
 *
 * Both became families: the component passes `count`, and i18next picks the
 * slot `Intl.PluralRules` selects. From then on the two older pins judge them
 * by construction — `all-locales-key-parity.test.ts` that every slot exists,
 * `plural-categories-11432.test.ts` that i18next selects it.
 *
 * ## What this file owns: that no third spelling appears unpinned
 *
 *   1. No pack holds a `…Plural` key. That was the code-selected pair's
 *      spelling; a component that picks a plural key itself is the defect.
 *   2. Every leaf that interpolates `{{count}}`, in any pack, is a member of a
 *      family — or is named on `COUNT_NEUTRAL` below with the reason no word
 *      agrees with its number. The `…One` spelling of a code-selected pair is
 *      caught here: its plural half interpolates `{{count}}` outside a family.
 *
 * The list can only shrink. Each entry must still exist, still interpolate
 * `{{count}}` and still be outside a family — so converting a key forces its
 * entry out, and a key cannot be listed in advance.
 *
 * ⛔ What this file does NOT judge: whether a family's WORDS are right in a
 * language (no test can; a translator does), and whether each call site passes
 * `count` as a NUMBER — i18next plural-selects nothing else
 * (`needsPluralHandling` is `count !== undefined && !isString(count)` in i18next
 * 26). `check:i18n-keys` holds every call site to passing `count`; the number
 * type is read at the call sites this card converted, not pinned.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

function leaves(node: unknown, prefix = ''): Array<[string, unknown]> {
  return node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        leaves(v, prefix ? `${prefix}.${k}` : k),
      )
    : [[prefix, node]];
}

/** The stem a leaf belongs to, if its name ends in one of i18next's CLDR suffixes. */
const stemOf = (path: string): string | undefined => {
  const suffix = SUFFIXES.find((s) => path.endsWith(s) && path.length > s.length);
  return suffix === undefined ? undefined : path.slice(0, -suffix.length);
};

/** Families the way i18next reads them — union over all ten packs. */
const FAMILIES = new Set(
  LANGS.flatMap((lang) =>
    leaves(builtInLocales[lang]).flatMap(([path]) => {
      const stem = stemOf(path);
      return stem === undefined ? [] : [stem];
    }),
  ),
);

const inAFamily = (path: string) => FAMILIES.has(path) || FAMILIES.has(stemOf(path) ?? '');

/** Every leaf, in any pack, whose value interpolates `{{count}}`. */
const COUNT_LEAVES = [
  ...new Set(
    LANGS.flatMap((lang) =>
      leaves(builtInLocales[lang])
        .filter(([, v]) => typeof v === 'string' && v.includes('{{count}}'))
        .map(([path]) => path),
    ),
  ),
].sort();

/**
 * The `{{count}}` keys that stay outside a family, grouped by the reason no
 * word agrees with the number in ANY pack. A key goes here only when that
 * reason holds in all ten packs; one pack whose form agrees with the number
 * makes it a family instead (that is how most of objectui#11445's 68 families
 * were found: the `en` form was fine and a `ru`, `ar`, `de` or `es` one was not).
 */
const COUNT_NEUTRAL = {
  /** The number stands alone — in parentheses, after `+`, beside `/ {{total}}`,
   *  or after a label or verb — so nothing has to agree with it. */
  tally: [
    'lookup.showAllResults',
    'fields.textarea.characterCount',
    'fields.textarea.charactersRemaining',
    'table.totalRecords',
    'table.saveAll',
    'grid.bulk.overLimit',
    'grid.bulk.affectedRecords',
    'grid.bulk.andMore',
    'grid.bulk.processed',
    'grid.bulk.processedFailed',
    'grid.bulk.succeeded',
    'grid.bulk.resultFailed',
    'calendar.moreEvents',
    'calendar.unscheduled',
    'view.moreViews',
    'detail.showDiscussion',
    'console.ai.buildDoctorDrawer.timeline',
    'marketplace.installedCount',
    'approvalsInbox.approveN',
    'approvalsInbox.rejectN',
    // objectui#12910 — `element:metadata_viewer`'s counts, each "Label: N" in
    // every pack so no plural family is needed.
    'element.metadataViewer.steps',
    'element.metadataViewer.hiddenSteps',
    'element.metadataViewer.objectAccess',
  ],
  /** Every pack phrases it count-invariantly: an `(s)` marker in `en`/`de`/
   *  `fr`/`es`/`pt` (the convention `perm-home-namespace-3546.test.tsx` pins),
   *  a label, partitive or impersonal form in `ru`/`ar`, a counter in zh/ja/ko. */
  invariant: [
    'grid.import.imported',
    'grid.import.skippedCount',
    'console.ai.pendingDrafts.count',
    'console.ai.buildDoctorDrawer.allLive',
    'console.ai.buildDoctorDrawer.discrepancies',
    'console.ai.buildDoctorDrawer.issueCount',
    'console.ai.buildDoctorDrawer.platformNoise',
    'home.pendingDrafts.publishedVerified',
    'home.pendingDrafts.capabilityWarn',
    'preview.history.items',
  ],
  /** A relative time whose unit is abbreviated in every pack (`5m ago`,
   *  `vor 5 Min.`, `5 мин назад`, `منذ 5 د`); an abbreviation does not inflect. */
  abbreviated: [
    'console.ai.minutesAgo',
    'console.ai.hoursAgo',
    'console.ai.daysAgo',
    'layout.activityFeed.relativeSecondsAgo',
    'layout.activityFeed.relativeMinutesAgo',
    'layout.activityFeed.relativeHoursAgo',
    'layout.activityFeed.relativeDaysAgo',
    'marketplace.relativeTime.daysAgo',
  ],
  /** Rendered only at 2 or more, and every pack's form is right at every such
   *  count: the cross-page bulk banner needs `totalMatching > pageSize`
   *  (`BulkActionBar`), and the inbox group header needs a group of two
   *  (`InboxPopover` renders a single item as its own row). */
  twoOrMore: [
    'grid.bulkSelectedAllMatches',
    'grid.bulkSelectAllMatching',
    'grid.bulkAllMatchingSelected',
    'notifications.groupCount',
  ],
  /** No `t()` caller asks for it — `check:i18n-dead-keys` lists each as a
   *  retirement candidate. Retiring a dead key is that gate's business; a
   *  family for a string nobody renders would be dead weight in ten packs. */
  unreached: [
    'detail.relatedRecords',
    'detail.relatedRecordOne',
    'appDesigner.objectManager.fieldCount',
    'console.objectView.toolbarEnabledCount',
    'layout.appSwitcher.appsAvailable',
  ],
} as const;

const NEUTRAL_KEYS: string[] = Object.values(COUNT_NEUTRAL).flat();

describe('a count label is an i18next count family, or names why it needs none (objectui#11445)', () => {
  it('the walk is real — packs, families and count leaves are all non-empty', () => {
    expect(LANGS).toHaveLength(10);
    // objectui#11432's 14 families plus objectui#11445's 68 — a floor, so a
    // later family raises it for free and only a lost family is a failure.
    expect(FAMILIES.size).toBeGreaterThanOrEqual(82);
    expect(COUNT_LEAVES.length).toBeGreaterThan(200);
    // A family the card converted, from each spelling, is really a family.
    for (const key of ['detail.attachmentCount', 'common.itemCount', 'approvalsInbox.bulkApproveTitle']) {
      expect(FAMILIES.has(key), key).toBe(true);
    }
  });

  it('no pack holds a `…Plural` key — the code-selected pair spelling is gone', () => {
    const plural = LANGS.flatMap((lang) =>
      leaves(builtInLocales[lang])
        .map(([path]) => path)
        .filter((path) => (path.split('.').pop() ?? '').endsWith('Plural'))
        .map((path) => `${lang}:${path}`),
    );
    expect(plural, `${plural.length} \`…Plural\` key(s)`).toEqual([]);
  });

  it('every `{{count}}` leaf is in a family or on the count-neutral list', () => {
    const outside = COUNT_LEAVES.filter((path) => !inAFamily(path) && !NEUTRAL_KEYS.includes(path));
    expect(
      outside,
      `${outside.length} count label(s) outside any family — make each an i18next count family ` +
        '(the component passes `count`, every pack spells each CLDR slot), or, if no word agrees ' +
        'with the number in ANY pack, name it on COUNT_NEUTRAL with that reason',
    ).toEqual([]);
  });

  it('every count-neutral entry is still live — present, counting, and outside a family', () => {
    const en = new Map(leaves(builtInLocales.en));
    const stale = NEUTRAL_KEYS.flatMap((key) => {
      if (typeof en.get(key) !== 'string') return [`${key}: no longer an en key`];
      if (!COUNT_LEAVES.includes(key)) return [`${key}: interpolates no {{count}} any more`];
      if (inAFamily(key)) return [`${key}: is a family now — take it off the list`];
      return [];
    });
    expect(stale).toEqual([]);
    expect(new Set(NEUTRAL_KEYS).size, 'a key is listed under two reasons').toBe(NEUTRAL_KEYS.length);
    for (const [reason, keys] of Object.entries(COUNT_NEUTRAL)) {
      expect(keys.length, `${reason} lists nothing — drop the reason`).toBeGreaterThan(0);
    }
  });

  it('the rule is not vacuous — it fails a single-form count key and a `…Plural` key', () => {
    // A leaf shaped like the two retired spellings, judged by the same
    // predicates the cases above use, so the predicates cannot pass by
    // accepting everything.
    const probe = { probe: { rowCount: '{{count}} rows', rowCountPlural: '{{count}} rows' } };
    const counting = leaves(probe).filter(([, v]) => String(v).includes('{{count}}'));
    expect(counting.filter(([path]) => !inAFamily(path)).map(([path]) => path)).toEqual([
      'probe.rowCount',
      'probe.rowCountPlural',
    ]);
    expect(leaves(probe).some(([path]) => path.endsWith('Plural'))).toBe(true);
  });
});
