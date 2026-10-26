/**
 * The last of objectui#3546 — slice seven, the **residue**: every entry that was
 * still in `scripts/i18n-call-site-key-baseline.json`. After this slice both of
 * the ratchet's lists are empty and `check-i18n-call-site-keys.mjs` reports
 * **2320/2320** literal call-site keys resolving against `en`.
 *
 * ## What was left, precisely (measured, never hand-counted)
 *
 * `analyze()` from #3530's gate, run on the branch point:
 *
 *   - **17 distinct keys at 23 call sites** — the first slice in this series
 *     where the two numbers differ by more than a rounding error. Five keys are
 *     shared: `common.retry` (3 sites), `common.record`, `common.editInStudio`,
 *     `detail.add` and `layout.systemNav.datasources` (2 each). Slice two
 *     predicted 90 and the truth was 93; the lesson is applied here by taking
 *     the call-site list from the script, not from the ratchet's line count.
 *   - **both remaining `missing-prefix` families**, 3 call sites:
 *     `gantt.linkEnd.` (1) and `organization.invitations.status.` (2).
 *
 * Nine namespaces, ten owning surfaces, spread across `app-shell`,
 * `plugin-detail`, `plugin-dashboard`, `plugin-kanban` and `plugin-gantt` — the
 * long tail that was never big enough to be its own slice.
 *
 * ## Severity: all English-visible, zero raw keys — and three different ways
 *
 * The 8 raw-key sites the issue's body named were slice one's (PR #3583), and
 * `detail.viewSource` / `wizard.missingRequired` / `gantt.toolbar.refresh` have
 * resolved in `en` ever since. Everything in THIS slice is the milder
 * objectui#3517 class, but the inline English default takes three shapes, which
 * is why the byte-equality test below is split three ways:
 *
 *   1. **22 sites / 16 keys** pass `t(key, { defaultValue: 'English' })`.
 *   2. **1 site** (`dashboard.loading`) uses `useSafeTranslate`'s positional
 *      form, `tt(key, 'Loading…')` — a fallback, not a `defaultValue` property.
 *      A test that greps only for `defaultValue:` would call this site
 *      unprotected and be wrong about it.
 *   3. **the two families' defaults are not literals at all**:
 *      `organization.invitations.status.` passes `{ defaultValue: tab }` — the
 *      enum member itself, CSS-capitalised by the element — and
 *      `gantt.linkEnd.` passes no default, relying on
 *      `useGanttTranslation`'s PER-KEY fallback map, which does contain both
 *      members. So a byte compare is structurally impossible for all seven, and
 *      what is pinned instead is the equivalence each one actually needs.
 *
 * Consequence for test design, as in slices two through six: **`en` output was
 * already correct before the change**, so an `en` assertion cannot discriminate
 * before from after. Every assertion that pins the fix is a non-`en` one; the
 * `en` ones prove reachability and prove the wording did not move.
 *
 * ## The provider-less path is a different, filed defect
 *
 * Four of the owning files bind `createSafeTranslation` hooks
 * (`useDetailTranslation`, `useKanbanT`) whose defaults maps do NOT list these
 * keys, and `useSafeTranslate`/`useGanttTranslation` are per-call/per-key. With
 * a provider mounted — the console — i18next answers, which is the path these
 * assertions describe. Without one, `createSafeTranslation`'s `fallbackT` reads
 * `defaults[key] || key` and never looks at the call site's inline
 * `defaultValue`, so it renders the raw key: that is objectui#3865, filed by
 * slice six, and it is not what this slice repairs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { builtInLocales } from '../locales/index';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799).
 *
 * It was `process.cwd()` until then, on the reasoning that
 * `scripts/vitest-invocation-guard.mjs` refuses any invocation whose vitest root
 * is not the repo root. That guard is real, but it is a DIFFERENT invariant:
 * `--root` moves VITEST's root and moves nothing about `process.cwd()`. This
 * package's own `test` script — `vitest run --root ../.. packages/i18n/`, which
 * is what `pnpm --filter … test` and `turbo run test` both run — leaves cwd at
 * `packages/i18n/`, so every read below resolved against the package directory
 * and the assertions guarding them failed.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796): `new URL(rel, import.meta.url)` is REWRITTEN by Vite into a
 * `http://localhost:3000/@fs/…` dev-server URL, so only bare `import.meta.url`
 * is read here and taken apart by hand. Measured on this card under both cwds
 * and in both the `unit` and the `dom` project, it is
 * `file:///…/packages/i18n/src/__tests__/<this file>`.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / i18n / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');


/** The 17 keys the guard measured as missing, in the ratchet's own order. */
const MEASURED_KEYS = [
  'common.done',
  'common.editInStudio',
  'common.record',
  'common.retry',
  'dashboard.loading',
  'detail.add',
  'detail.concurrentUpdateRecordLabel',
  'detail.deleted',
  'detail.historyEmpty',
  'empty.appNotAvailable',
  'empty.appNotAvailableDescription',
  'empty.interfacePageSourceMissing',
  'kanban.columns',
  'layout.systemNav.administration',
  'layout.systemNav.datasources',
  'layout.systemNav.documentation',
  'workspace.multiOrgDisabled',
] as const;

/**
 * `gantt.linkEnd.` — the value domain is the closed union `'start' | 'end'`,
 * declared in GanttView itself (the `linkDrag` state type and the `endLabel`
 * parameter). Same situation as slice four's `console.ai.group.`
 * (`ConversationGroupKey` in the same file), and unlike slice five's
 * `marketplace.disclosure.runtime.`, whose authority lives in the sibling repo's
 * `packages/spec`.
 */
const LINK_END_MEMBERS = ['start', 'end'] as const;

/**
 * `organization.invitations.status.` — the value domain is `StatusFilter`,
 * declared at the top of InvitationsPage. `all` is the filter tab's extra
 * member; the other four are also `AuthInvitation.status` values.
 */
const STATUS_MEMBERS = ['all', 'pending', 'accepted', 'rejected', 'canceled'] as const;

/** Every path this slice adds: 17 leaves + 2 + 5 family members = 24. */
const KEYS = [
  ...MEASURED_KEYS,
  ...LINK_END_MEMBERS.map((m) => `gantt.linkEnd.${m}`),
  ...STATUS_MEMBERS.map((m) => `organization.invitations.status.${m}`),
];

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

// ── the owning surfaces ──────────────────────────────────────────────────────
const INVITE_DIALOG = 'packages/app-shell/src/console/organizations/manage/InviteMemberDialog.tsx';
const PAGE_VIEW = 'packages/app-shell/src/views/PageView.tsx';
const APP_CONTENT = 'packages/app-shell/src/console/AppContent.tsx';
const INVITATIONS = 'packages/app-shell/src/console/organizations/manage/InvitationsPage.tsx';
const MEMBERS = 'packages/app-shell/src/console/organizations/manage/MembersPage.tsx';
const DATASET_WIDGET = 'packages/plugin-dashboard/src/DatasetWidget.tsx';
const RELATED_LIST = 'packages/plugin-detail/src/RelatedList.tsx';
const SAVE_BAR = 'packages/plugin-detail/src/InlineEditSaveBar.tsx';
const RECORD_DETAIL = 'packages/app-shell/src/views/RecordDetailView.tsx';
const DETAIL_VIEW = 'packages/plugin-detail/src/DetailView.tsx';
const INTERFACE_LIST = 'packages/app-shell/src/views/InterfaceListPage.tsx';
const KANBAN = 'packages/plugin-kanban/src/KanbanImpl.tsx';
const UNIFIED_SIDEBAR = 'packages/app-shell/src/layout/UnifiedSidebar.tsx';
const CREATE_WORKSPACE = 'packages/app-shell/src/console/organizations/CreateWorkspaceDialog.tsx';
const GANTT_VIEW = 'packages/plugin-gantt/src/GanttView.tsx';
const GANTT_HOOK = 'packages/plugin-gantt/src/useGanttTranslation.ts';
const OCC_DIALOG = 'packages/plugin-detail/src/ConcurrentUpdateDialog.tsx';

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const wrapperFor = (lang: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {children}
      </I18nProvider>
    );
  };

/**
 * Read a component's source, resolved from THIS FILE's own location rather than
 * from the cwd (objectui#7799) — and prove the read landed, or every assertion
 * on it is vacuous.
 */
function sourceOf(rel: string): string {
  const path = join(REPO_ROOT, rel);
  expect(existsSync(path), `source not found at ${path}`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** What CSS `text-transform: capitalize` does to a single lowercase word. */
const cssCapitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

beforeEach(() => {
  // The provider persists the last language (objectstack#5406); without this a
  // stale locale leaks into the `en` cases.
  window.localStorage.clear();
});

describe('objectui#3546 slice seven — the ratchet residue', () => {
  it('covers all ten packs and all twenty-four paths (guards the loops from emptying)', () => {
    expect(LANGS).toHaveLength(10);
    expect(MEASURED_KEYS).toHaveLength(17);
    expect(LINK_END_MEMBERS).toHaveLength(2);
    expect(STATUS_MEMBERS).toHaveLength(5);
    expect(KEYS).toHaveLength(24);
    expect(new Set(KEYS).size).toBe(24);
    // 17 measured leaves + 7 family members. Keeping the two counts apart here
    // is what stops a later reader reading "24" off the ratchet, which held 17
    // key lines and 2 prefix lines.
    const perNamespace = MEASURED_KEYS.reduce<Record<string, number>>((acc, k) => {
      const ns = k.split('.')[0];
      acc[ns] = (acc[ns] ?? 0) + 1;
      return acc;
    }, {});
    expect(perNamespace).toEqual({
      common: 4,
      dashboard: 1,
      detail: 4,
      empty: 3,
      kanban: 1,
      layout: 3,
      workspace: 1,
    });
  });

  it.each(LANGS)('%s defines every path in this slice as a non-empty string', (lang) => {
    for (const key of KEYS) {
      const value = at(builtInLocales[lang], key);
      expect(typeof value, `${lang}.${key}`).toBe('string');
      expect((value as string).trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('the nine non-en packs carry real translations, not the English strings', () => {
    // The failure this catches is a backfill that copy-pastes `en` into the other
    // nine packs: full key parity, ten packs green, nine languages still reading
    // English. `all-locales-key-parity.test.ts` cannot see it — it compares key
    // sets and placeholder shape, never what a value SAYS.
    //
    // Exact set, not "few enough": 2 of 216 pairs. Both are `fr`, both are words
    // French and English genuinely spell the same, and both sit in the system
    // navigation next to `layout.systemNav.configuration`, which `fr` has spelled
    // "Configuration" since before this slice. A third entry fails here and must
    // be justified on this list the way slices two (12), three (18) and four (1)
    // justified theirs.
    const identical: string[] = [];
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      for (const key of KEYS) {
        if (at(builtInLocales[lang], key) === at(builtInLocales.en, key)) identical.push(`${lang} :: ${key}`);
      }
    }
    expect(identical.sort()).toEqual([
      'fr :: layout.systemNav.administration',
      'fr :: layout.systemNav.documentation',
    ]);
    // …and the neighbour that makes them ordinary rather than a slip.
    expect(at(builtInLocales.fr, 'layout.systemNav.configuration')).toBe('Configuration');
    expect(at(builtInLocales.en, 'layout.systemNav.configuration')).toBe('Configuration');
  });

  it('the two-entry cognate set is not vacuous — other packs did translate those two', () => {
    // A set-equality assertion is also green when the packs are EMPTY (slice
    // two's B1 lesson). The presence assertion above covers emptiness; this one
    // covers the other way the set could be right for the wrong reason: if the
    // two `fr` rows were a copy-paste of `en`, the same copy-paste would show up
    // in the packs that CAN translate them, and it does not.
    expect(at(builtInLocales.de, 'layout.systemNav.administration')).toBe('Verwaltung');
    expect(at(builtInLocales.ru, 'layout.systemNav.administration')).toBe('Администрирование');
    expect(at(builtInLocales.de, 'layout.systemNav.documentation')).toBe('Dokumentation');
    expect(at(builtInLocales.ar, 'layout.systemNav.documentation')).toBe('الوثائق');
    // Loanwords that are carried through and still differ from `en`, so "no more
    // cognates" is a real zero rather than a pack dodging every English-looking
    // token: `Studio` and `Datenquellen`/`データソース` all survive.
    expect(at(builtInLocales.ja, 'common.editInStudio')).toBe('Studio で編集');
    expect(at(builtInLocales.ko, 'common.editInStudio')).toBe('Studio에서 편집');
    expect(at(builtInLocales.de, 'layout.systemNav.datasources')).toBe('Datenquellen');
    for (const [lang, key] of [
      ['ja', 'common.editInStudio'],
      ['ko', 'common.editInStudio'],
      ['de', 'layout.systemNav.datasources'],
    ] as const) {
      expect(at(builtInLocales[lang], key)).not.toBe(at(builtInLocales.en, key));
    }
  });

  it('exactly one path interpolates, and every pack carries the same hole', () => {
    // A translator who drops `{{name}}` renders a sentence with the source name
    // missing; one who invents a second hole renders braces verbatim.
    // `all-locales-key-parity` compares placeholder shape too — this states the
    // intended shape BY NAME so a wrong one is legible here.
    // Deliberately two regexes: a `/g` one is stateful, and reusing it for
    // `.test()` inside a `filter` silently skips every other match through
    // `lastIndex` (slice five's own bug).
    const HOLES = /\{\{\w+\}\}/g;
    const HAS_HOLE = /\{\{\w+\}\}/;
    const INTERPOLATED = ['empty.interfacePageSourceMissing'];
    expect(KEYS.filter((k) => HAS_HOLE.test(at(builtInLocales.en, k) as string)).sort()).toEqual(INTERPOLATED);
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const holes = ((at(builtInLocales[lang], key) as string).match(HOLES) ?? []).join(',');
        expect(holes, `${lang}.${key}`).toBe(INTERPOLATED.includes(key) ? '{{name}}' : '');
      }
    }
  });

  it('the fifteen literal en values are byte-identical to their inline defaultValue', () => {
    // Two paths must not diverge: with the pack present i18next answers, and
    // before this slice the inline default did — a user must not be able to tell
    // which ran. 15 keys here; `dashboard.loading` and the two families are the
    // three shapes a byte compare cannot reach, each pinned in its own case.
    //
    // ⚠️ It was SIXTEEN until objectui#9170. `kanban.columns` left this table
    // because its call site left the tree: the board-level empty state no longer
    // composes a description at all, so there is no inline default to compare
    // against. ⛔ The key itself was NOT retired here — that is the dead-key
    // gate's call, not this suite's, and the case below states what it reports.
    const EXPECTED: Array<[key: string, source: string, value: string]> = [
      ['common.done', INVITE_DIALOG, 'Done'],
      ['common.editInStudio', PAGE_VIEW, 'Edit in studio'],
      ['common.record', APP_CONTENT, 'Record'],
      ['common.retry', APP_CONTENT, 'Retry'],
      ['detail.add', RELATED_LIST, 'Add'],
      ['detail.concurrentUpdateRecordLabel', SAVE_BAR, 'this record'],
      ['detail.deleted', RECORD_DETAIL, 'Record deleted'],
      ['detail.historyEmpty', DETAIL_VIEW, 'No history yet'],
      ['empty.appNotAvailable', APP_CONTENT, 'App not available'],
      [
        // objectui#9262 retired the publishing clause: the screen asserted a
        // transient deploy state it had never measured, over seven causes only
        // one of which is a publish. What is left says nothing about why.
        'empty.appNotAvailableDescription',
        APP_CONTENT,
        'This app is not available — try again in a moment.',
      ],
      [
        'empty.interfacePageSourceMissing',
        INTERFACE_LIST,
        'This interface page references "{{name}}", which is not available.',
      ],
      ['layout.systemNav.administration', UNIFIED_SIDEBAR, 'Administration'],
      // Owned by `AppSidebar` until objectui#5817 removed it; the surviving
      // call site is `UnifiedSidebar`'s, held to the same string.
      ['layout.systemNav.datasources', UNIFIED_SIDEBAR, 'Datasources'],
      ['layout.systemNav.documentation', UNIFIED_SIDEBAR, 'Documentation'],
      ['workspace.multiOrgDisabled', CREATE_WORKSPACE, 'Creating new organizations is disabled on this instance.'],
    ];
    expect(EXPECTED).toHaveLength(15);
    // …and the sixteenth is accounted for rather than merely absent: a row that
    // silently disappears from a table like this is how a slice stops covering
    // something without anyone noticing.
    expect(MEASURED_KEYS).toContain('kanban.columns');
    expect(EXPECTED.map(([key]) => key)).not.toContain('kanban.columns');
    const cache = new Map<string, string>();
    for (const [key, rel, value] of EXPECTED) {
      if (!cache.has(rel)) cache.set(rel, sourceOf(rel));
      expect(at(builtInLocales.en, key), `en ${key}`).toBe(value);
      // the premise: the call site still passes exactly this defaultValue
      expect(cache.get(rel), `${key}'s defaultValue moved`).toContain(`defaultValue: '${value}'`);
    }
  });

  it('the five multi-site keys really are one string at every one of their sites', () => {
    // 17 keys, 23 call sites. A key used twice with two different inline defaults
    // would make the byte-equality above true at one site and false at the other,
    // and no single-site check could see it. Both spellings are asserted at both
    // files, so a divergence introduced later fails here.
    const MULTI: Array<[key: string, value: string, files: string[]]> = [
      ['common.editInStudio', 'Edit in studio', [PAGE_VIEW]],
      ['common.record', 'Record', [APP_CONTENT]],
      ['common.retry', 'Retry', [APP_CONTENT, INVITATIONS, MEMBERS]],
      ['detail.add', 'Add', [RELATED_LIST]],
      // A second site lived in `AppSidebar` until objectui#5817 removed it; the
      // row stays so the remaining site is still held to the same string.
      ['layout.systemNav.datasources', 'Datasources', [UNIFIED_SIDEBAR]],
    ];
    for (const [key, value, files] of MULTI) {
      for (const rel of files) {
        const src = sourceOf(rel);
        const occurrences = src.split(`t('${key}', { defaultValue: '${value}' })`).length - 1;
        expect(occurrences, `${key} in ${rel}`).toBeGreaterThan(0);
      }
    }
    // PageView uses it twice on the same button (title + aria-label) and
    // RelatedList twice in two different affordances — the counts are pinned so a
    // silent drop of one of them is visible.
    expect(sourceOf(PAGE_VIEW).split("t('common.editInStudio', { defaultValue: 'Edit in studio' })").length - 1).toBe(2);
    expect(sourceOf(RELATED_LIST).split("t('detail.add', { defaultValue: 'Add' })").length - 1).toBe(2);
    expect(sourceOf(APP_CONTENT).split("t('common.record', { defaultValue: 'Record' })").length - 1).toBe(2);
  });

  it('dashboard.loading matches useSafeTranslate positional fallback, not a defaultValue', () => {
    // Shape two. `useSafeTranslate()` returns `t(keyOrKeys, fallback)` — the
    // English default is the SECOND POSITIONAL ARGUMENT, so a sweep that greps
    // for `defaultValue:` would report this site as having no fallback and be
    // wrong. The equivalence is the same one: pack value === the fallback the
    // call site would otherwise have rendered.
    const src = sourceOf(DATASET_WIDGET);
    expect(src, 'the sr-only loading announcement moved').toContain("tt('dashboard.loading', 'Loading…')");
    expect(src).toContain('const tt = useSafeTranslate();');
    expect(at(builtInLocales.en, 'dashboard.loading')).toBe('Loading…');
    // …and the hook really does return the fallback per key, not per provider.
    const hook = sourceOf('packages/i18n/src/useSafeTranslation.ts');
    expect(hook).toContain('export function useSafeTranslate()');
    expect(hook).toContain('if (v && v !== key) return v;');
    // U+2026, not three ASCII dots — and this line is where objectui#3878 was
    // found. This file used to assert the OPPOSITE of what it asserts now: that
    // `dashboard.loading` (`Loading…`) and `common.loading` (`Loading...`) were
    // DIFFERENT strings, which is why slice seven could not reuse the neighbour's
    // translations and had to backfill ten packs by hand. That difference was the
    // whole defect — one dashboard rendering two ellipsis glyphs — and
    // objectui#3878 converged the pack on U+2026, so the two are now the same
    // string BY DESIGN. Kept as an equality rather than deleted: it is the only
    // place the convergence is visible from the slice-seven side, and it fails
    // loudly if either value drifts back.
    expect(at(builtInLocales.en, 'dashboard.loading')).toBe(at(builtInLocales.en, 'common.loading'));
    expect(at(builtInLocales.en, 'common.loading')).toBe('Loading…');
  });

  describe('gantt.linkEnd. — the first prefix family', () => {
    it('the key surface is exactly the closed union declared in GanttView', () => {
      // Key reachability, asserted on the KEY set — not on a value verdict. A
      // fourth endpoint kind added to `linkDrag` fails here, which is exactly the
      // job the ratchet's prefix entry used to do, moved into a test.
      const family = at(builtInLocales.en, 'gantt.linkEnd') as Record<string, string>;
      expect(Object.keys(family).sort()).toEqual([...LINK_END_MEMBERS].sort());
      const src = sourceOf(GANTT_VIEW);
      // the premise: both the state type and the label helper still say start|end
      expect(src, 'the linkDrag endpoint union moved').toContain("sourceEnd: 'start' | 'end';");
      expect(src).toContain("targetEnd: 'start' | 'end' | null;");
      expect(src, 'the template call moved').toContain(
        "const endLabel = (e: 'start' | 'end') => t(`gantt.linkEnd.${e}`);",
      );
      // `targetEnd` is nullable and the call site collapses null to 'start', so
      // the union really is two members at the call site too.
      expect(src).toContain("endLabel(linkDrag.targetEnd ?? 'start')");
      for (const lang of LANGS) {
        expect(Object.keys(at(builtInLocales[lang], 'gantt.linkEnd') as object).sort(), `${lang}`).toEqual([
          ...LINK_END_MEMBERS,
        ].sort());
      }
    });

    it('the en values are byte-identical to the hook per-key fallback map', () => {
      // Value verdict, asserted separately from the key surface (PR #3546 slice
      // five wrote this distinction down). This call site passes NO
      // `defaultValue`: `useGanttTranslation` asks the host first and falls back
      // to its own map PER KEY, so the map is what rendered before this slice and
      // i18next is what renders now. If the two disagreed, the drag hint would
      // change wording for English users, which this slice must not do.
      const hook = sourceOf(GANTT_HOOK);
      expect(hook).toContain("'gantt.linkEnd.start': 'start',");
      expect(hook).toContain("'gantt.linkEnd.end': 'end',");
      expect(at(builtInLocales.en, 'gantt.linkEnd.start')).toBe('start');
      expect(at(builtInLocales.en, 'gantt.linkEnd.end')).toBe('end');
      // the premise for "the map is what rendered": per-key, host-first.
      expect(hook).toContain('const hostValue = result.t(key, options as never) as unknown;');
      expect(hook).toContain("if (typeof hostValue === 'string' && hostValue !== key) return hostValue;");
    });

    it('the nine packs take their endpoint words from gantt own link vocabulary', () => {
      // Concept adjacency: `gantt.linkType.*` names the same two endpoints
      // ("Finish → Start"), and `de` deliberately says Anfang there rather than
      // the `gantt.column.start` label "Start" — so the link family, not the
      // column family, is the neighbour. `en` is lowercase because the words land
      // inside parentheses mid-hint; German capitalises nouns regardless, which
      // is correct German and not a copy of `en`.
      expect(at(builtInLocales.de, 'gantt.linkType.fs')).toBe('Ende → Anfang');
      expect(at(builtInLocales.de, 'gantt.linkEnd.start')).toBe('Anfang');
      expect(at(builtInLocales.de, 'gantt.linkEnd.end')).toBe('Ende');
      expect(at(builtInLocales.zh, 'gantt.linkType.fs')).toBe('完成 → 开始');
      expect(at(builtInLocales.zh, 'gantt.linkEnd.start')).toBe('开始');
      expect(at(builtInLocales.ar, 'gantt.linkType.fs')).toBe('نهاية → بداية');
      expect(at(builtInLocales.ar, 'gantt.linkEnd.start')).toBe('بداية');
      expect(at(builtInLocales.ar, 'gantt.linkEnd.end')).toBe('نهاية');
    });
  });

  describe('organization.invitations.status. — the second prefix family', () => {
    it('the key surface is exactly StatusFilter', () => {
      const family = at(builtInLocales.en, 'organization.invitations.status') as Record<string, string>;
      expect(Object.keys(family).sort()).toEqual([...STATUS_MEMBERS].sort());
      const src = sourceOf(INVITATIONS);
      // the premise: the union and the tab list still spell these five
      expect(src, 'StatusFilter moved').toContain(
        "type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'canceled';",
      );
      expect(src).toContain(
        "const tabs: StatusFilter[] = ['all', 'pending', 'accepted', 'rejected', 'canceled'];",
      );
      expect(src, 'the tab template call moved').toContain(
        "t(`organization.invitations.status.${tab}`, { defaultValue: tab })",
      );
      expect(src, 'the badge template call moved').toContain(
        "t(`organization.invitations.status.${inv.status}`, { defaultValue: inv.status })",
      );
      for (const lang of LANGS) {
        expect(
          Object.keys(at(builtInLocales[lang], 'organization.invitations.status') as object).sort(),
          `${lang}`,
        ).toEqual([...STATUS_MEMBERS].sort());
      }
    });

    it('en renders exactly what the CSS-capitalised wire value rendered', () => {
      // The equivalence that replaces a byte compare for shape three. The
      // `defaultValue` here is the enum member itself, and BOTH call sites put
      // `capitalize` on the element, so what a user saw was `Pending`, not
      // `pending`. `en` therefore has to be the capitalised member, exactly — one
      // letter of drift and this slice would have changed the English.
      for (const member of STATUS_MEMBERS) {
        expect(
          at(builtInLocales.en, `organization.invitations.status.${member}`),
          `en status.${member}`,
        ).toBe(cssCapitalize(member));
      }
      // the premise: both elements still carry `capitalize`
      const src = sourceOf(INVITATIONS);
      expect(src, 'the filter tab lost its capitalize class').toContain('transition-colors capitalize');
      expect(src, 'the status badge lost its capitalize class').toContain('className="shrink-0 capitalize"');
      // Single words, so `text-transform: capitalize` is exactly "upcase the
      // first letter" — pinned, because the CSS rule capitalises EVERY word and a
      // future two-word status would not round-trip through this model.
      for (const member of STATUS_MEMBERS) expect(member).not.toContain(' ');
    });

    it('the four invitation adjectives agree with each pack own word for "invitation"', () => {
      // Deliberately NOT reused from the `approvals*` family even though `en` has
      // byte-identical rows there, and the reason is grammatical rather than
      // stylistic: those rows agree with each pack's word for "request", and this
      // family describes an INVITATION. `ru` is the clearest case —
      // `approvalsInbox.statusRejected` is the masculine `Отклонён` (запрос),
      // while приглашение is neuter and needs `Отклонено`. Reusing would have
      // shipped a grammar error that key parity and the cognate set both pass.
      expect(at(builtInLocales.en, 'approvalsInbox.statusRejected')).toBe('Rejected');
      expect(at(builtInLocales.ru, 'approvalsInbox.statusRejected')).toBe('Отклонён');
      expect(at(builtInLocales.ru, 'organization.invitations.status.rejected')).toBe('Отклонено');
      expect(at(builtInLocales.ru, 'organization.accept.declined')).toBe('Приглашение отклонено');
      // fr/es inflect feminine (invitation / invitación), pt masculine (convite) —
      // taken from the same-namespace toasts, which is where each pack already
      // committed to a gender.
      expect(at(builtInLocales.fr, 'organization.accept.accepted')).toBe('Invitation acceptée');
      expect(at(builtInLocales.fr, 'organization.invitations.status.accepted')).toBe('Acceptée');
      expect(at(builtInLocales.es, 'organization.accept.accepted')).toBe('Invitación aceptada');
      expect(at(builtInLocales.es, 'organization.invitations.status.accepted')).toBe('Aceptada');
      expect(at(builtInLocales.pt, 'organization.accept.accepted')).toBe('Convite aceito');
      expect(at(builtInLocales.pt, 'organization.invitations.status.accepted')).toBe('Aceito');
      // …and `all`, the filter tab's own member, follows the same gender: the
      // noun it quantifies is "invitations".
      expect(at(builtInLocales.fr, 'organization.invitations.status.all')).toBe('Toutes');
      expect(at(builtInLocales.es, 'organization.invitations.status.all')).toBe('Todas');
      expect(at(builtInLocales.pt, 'organization.invitations.status.all')).toBe('Todos');
      // `canceled` is the ORG withdrawing the invitation, not the invitee
      // declining it, so de takes `zurückgezogen` from its own cancel toast
      // rather than the generic `Abgebrochen`.
      expect(at(builtInLocales.de, 'organization.invitations.canceled')).toBe('Einladung zurückgezogen');
      expect(at(builtInLocales.de, 'organization.invitations.status.canceled')).toBe('Zurückgezogen');
    });
  });

  it('reused strings are the neighbours own translations, not second renderings', () => {
    // Where this slice's `en` string already existed verbatim elsewhere AND the
    // neighbour's translation is grammatically usable here, the existing row is
    // reused rather than re-translated, so one English string never renders as
    // two different sentences in the same language. A drift on either side fails
    // here.
    const REUSED: Array<[newKey: string, neighbour: string]> = [
      ['common.done', 'view.done'],
      ['common.record', 'home.recentApps.itemType.record'],
      ['common.retry', 'lookup.retry'],
      ['dashboard.loading', 'lookup.loading'],
      // `['detail.add', 'report.editor.fieldPickerAdd']` stood here until
      // objectui#4145 retired the whole `report.editor.*` namespace. The row is
      // dropped rather than re-anchored because there is no longer anything to
      // disagree with: `detail.add` is now the ONLY key in `en` whose value is
      // "Add" (measured across the pack, not assumed), so the "one English
      // string, two renderings" failure this list guards has no second site to
      // occur at. Re-anchoring to a key with a different English string would
      // have invented a premise instead of pinning one. Its translations were
      // taken from the retired neighbour and are unchanged by that retirement.
      // The one family member that IS reused: `Pending` is rendered by a verb or
      // an invariant adjective in every pack (`ru` "Ожидает"), so unlike the
      // other four it carries no gender to disagree with.
      ['organization.invitations.status.pending', 'grid.import.jobStatus.pending'],
    ];
    for (const [newKey, neighbour] of REUSED) {
      // the premise: the two really are the same English string
      expect(at(builtInLocales.en, newKey), `en ${newKey} vs ${neighbour}`).toBe(
        at(builtInLocales.en, neighbour),
      );
      for (const lang of LANGS) {
        expect(at(builtInLocales[lang], newKey), `${lang} ${newKey} diverged from ${neighbour}`).toBe(
          at(builtInLocales[lang], neighbour),
        );
      }
    }
    // Recorded because it looks like an omission and is not: another row also
    // says `Pending` in `en` and still disagrees with the chosen neighbour in one
    // pack — `approvalsInbox.statusPending` is zh 待审批 ("awaiting approval"),
    // which is wrong for an invitation. So the repo DOES render some English
    // strings more than one way, on purpose, and picking a neighbour is a choice
    // that has to be made rather than derived.
    //
    // `Done` stood beside it as the second example until objectui#3880, which
    // adjudicated that one a typo rather than a choice: `grid.bulk.done` was es
    // "Hecho" against "Listo" at the other three sites, and all four are the same
    // dialog-footer button that finishes the surface — `grid.bulk.done` closes the
    // bulk result dialog, `view.done` closes ManageViewsDialog, `form.fullscreen.done`
    // commits and leaves the fullscreen editor, `common.done` closes the invitation
    // footer — with no grammatical divergence to carry. The nine other packs each
    // render all four identically, so no pack had found a contextual reason to
    // split them. It converged on the 3:1 majority `Listo`, which is also the value
    // this slice had already chosen for `common.done`. The four are pinned together
    // below so the outlier cannot regrow, and the `Done` family is no longer an
    // example of deliberate divergence — only `Pending` is.
    expect(at(builtInLocales.en, 'grid.bulk.done')).toBe('Done');
    for (const key of ['common.done', 'view.done', 'form.fullscreen.done', 'grid.bulk.done']) {
      expect(at(builtInLocales.es, key), `es ${key} (objectui#3880 converged these on one value)`).toBe(
        'Listo',
      );
    }
    expect(at(builtInLocales.zh, 'approvalsInbox.statusPending')).toBe('待审批');
    expect(at(builtInLocales.zh, 'organization.invitations.status.pending')).toBe('等待中');
  });

  it('the concept neighbours are the ones this slice claims, and they still say so', () => {
    // "Find the neighbour by CONCEPT, not by bytes" (slice five's blind spot,
    // slice six's rule). Each premise is asserted next to the value it justified,
    // so a neighbour that moves takes this with it.

    // `Administration` — the strongest neighbour in the whole slice: a sibling
    // key NAMES this very menu, per pack, in a sentence.
    expect(at(builtInLocales.en, 'home.welcomeAdminDescriptionNoAi')).toBe(
      'Set up your first application from the Administration menu on the left.',
    );
    expect(at(builtInLocales.zh, 'home.welcomeAdminDescriptionNoAi')).toContain('「管理」菜单');
    expect(at(builtInLocales.zh, 'layout.systemNav.administration')).toBe('管理');
    expect(at(builtInLocales.de, 'home.welcomeAdminDescriptionNoAi')).toContain('Verwaltungsmenü');
    expect(at(builtInLocales.de, 'layout.systemNav.administration')).toBe('Verwaltung');
    expect(at(builtInLocales.ru, 'home.welcomeAdminDescriptionNoAi')).toContain('«Администрирование»');
    expect(at(builtInLocales.ru, 'layout.systemNav.administration')).toBe('Администрирование');

    // `Datasources` — the plural nav label; the singular concept is already
    // translated elsewhere, and the sibling nav entries are plural.
    //
    // The singular anchor was `report.editor.objectName` until objectui#4145
    // retired that namespace. `appDesigner.dataSource` replaces it and carries
    // the premise unchanged: it is byte-identical to the retired key in all nine
    // non-`en` packs (differing in `en` only as "Data Source" vs "Data source"),
    // so the ru singular↔plural contrast this premise rests on is the same
    // contrast, read from a key that still exists.
    expect(at(builtInLocales.en, 'appDesigner.dataSource')).toBe('Data Source');
    expect(at(builtInLocales.ru, 'appDesigner.dataSource')).toBe('Источник данных');
    expect(at(builtInLocales.ru, 'layout.systemNav.datasources')).toBe('Источники данных');
    expect(at(builtInLocales.ru, 'layout.systemNav.organizations')).toBe('Организации');

    // `Documentation` — the help menu already has it, twice.
    expect(at(builtInLocales.en, 'help.onlineDocs')).toBe('Online documentation');
    expect(at(builtInLocales.ja, 'help.onlineDocs')).toBe('オンラインドキュメント');
    expect(at(builtInLocales.ja, 'layout.systemNav.documentation')).toBe('ドキュメント');

    // `Record deleted` — structural twin: "<Noun> deleted" as a success toast.
    expect(at(builtInLocales.en, 'organization.settings.deleted')).toBe('Organization deleted');
    expect(at(builtInLocales.ja, 'organization.settings.deleted')).toBe('組織を削除しました');
    expect(at(builtInLocales.ja, 'detail.deleted')).toBe('レコードを削除しました');
    expect(at(builtInLocales.ru, 'organization.settings.deleted')).toBe('Организация удалена');
    expect(at(builtInLocales.ru, 'detail.deleted')).toBe('Запись удалена');

    // `No history yet` — the "No X yet" empty-state family, plus each pack's own
    // word for History (ko says 기록, not 히스토리).
    expect(at(builtInLocales.en, 'detail.noCommentsYet')).toBe('No comments yet');
    expect(at(builtInLocales.ko, 'detail.noCommentsYet')).toBe('아직 댓글이 없습니다');
    expect(at(builtInLocales.ko, 'detail.history')).toBe('기록');
    expect(at(builtInLocales.ko, 'detail.historyEmpty')).toBe('아직 기록이 없습니다');

    // `Edit in studio` — "<verb> in Studio", with each pack's own Edit verb. The
    // product name stays Latin in all ten, which is why `Studio` shows up in the
    // loanword check above.
    expect(at(builtInLocales.en, 'topbar.designInStudio')).toBe('Design in Studio');
    expect(at(builtInLocales.zh, 'topbar.designInStudio')).toBe('在 Studio 中设计');
    expect(at(builtInLocales.zh, 'common.edit')).toBe('编辑');
    expect(at(builtInLocales.zh, 'common.editInStudio')).toBe('在 Studio 中编辑');

    // `on this instance` — ru and ar both render instance/deployment with their
    // own environment word, and have done so consistently.
    // objectui#12600 renamed the row "Local development instance"; the en word
    // is still "instance", and ru/ar still use their environment word.
    expect(at(builtInLocales.en, 'auth.login.devAdminHint.title')).toBe('Local development instance');
    expect(at(builtInLocales.ru, 'approvalsInbox.recallUnavailable')).toBe('Отзыв недоступен в этой среде.');
    expect(at(builtInLocales.ru, 'workspace.multiOrgDisabled')).toContain('в этой среде');
    expect(at(builtInLocales.ar, 'connectAgent.disabled.title')).toBe('MCP معطّل في هذا النشر');
    expect(at(builtInLocales.ar, 'workspace.multiOrgDisabled')).toContain('في هذا النشر');
    // …and the "X ist disabled" sentence shape comes from the pack's own
    // `gantt.readOnlyHint`, not from a fresh construction.
    expect(at(builtInLocales.de, 'gantt.readOnlyHint')).toBe('Die Bearbeitung ist in dieser Ansicht deaktiviert.');
    expect(at(builtInLocales.de, 'workspace.multiOrgDisabled')).toContain('ist auf dieser Instanz deaktiviert');
  });

  it('the board-level empty state carries no lane count, so no plural family is needed', () => {
    // ⭐ RE-DERIVED, ⛔ not deleted (objectui#9170). This case used to pin the
    // OPPOSITE premise, in two assertions that belong together:
    //
    //     description={\`\${boardColumns.length} \${t(<the columns key>)}\`}
    //     const isBoardEmpty = totalCardCount === 0 && boardColumns.length > 1;
    //
    // …with the reasoning written between them: the pack supplies a UNIT word,
    // `en` is plural-only, and that is SAFE because the empty state only renders
    // above one lane, so the count can never be 1.
    //
    // objectui#9169 removed that second conjunct so a zero-lane and a one-lane
    // board announce at all — that widening IS the accessibility fix — and this
    // pin fired exactly as it was written to, because the premise it named had
    // gone: the live region then read "No cards1 columns", announced aloud.
    //
    // The maintainer's ruling on objectui#9170 (2026-09-12) took the third of the
    // card's three routes: the region's job is "no cards", the lane count is
    // already visible on the board, and read aloud it is noise. ⇒ the description
    // is GONE, and "no plural family is needed" is true BY CONSTRUCTION — there
    // is no number in this region for a plural to have to agree with — rather
    // than true because a predicate happened to keep the count above one.
    //
    // ⚠️ That is a stronger guarantee than the one it replaces, and the legs
    // below are chosen so it cannot be quietly given up:
    //
    //   (1) the predicate is still lane-count-blind, so the zero- and one-lane
    //       boards still announce — ⛔ route 3 is NOT a licence to put the `> 1`
    //       guard back, which would silence them again;
    //   (2) the board-level region declares no `description` at all;
    //   (3) nothing in that file asks the pack for the columns unit word any
    //       more, in any spelling, so no count can be composed with one;
    //   (4) the region still ANNOUNCES — the title is what carries the message,
    //       and a repair that deleted the whole region would otherwise pass (1)
    //       to (3) trivially.
    //
    // The rendered half — zero, one and two lanes all reading the SAME numberless
    // string — is pinned where it can be read from the DOM, in
    // `packages/plugin-kanban/src/__tests__/emptyStateNumberlessDescription-9170.test.tsx`.
    const src = sourceOf(KANBAN);

    // (1)
    expect(
      src,
      'the lane-count blindness moved — the zero- and one-lane boards may be silent again; re-read objectui#9045',
    ).toContain('const isBoardEmpty = totalCardCount === 0;');

    // (2) — read from the element itself rather than from the whole file, so a
    // `description` prop on some future sibling cannot make this red by accident,
    // and `card.description` (a DATA field, two hundred lines up) cannot either.
    const OPEN = '<DataEmptyState';
    const openAt = src.indexOf(OPEN);
    expect(openAt, 'the board-level empty state element moved').toBeGreaterThan(-1);
    expect(src.indexOf(OPEN, openAt + 1), 'a second DataEmptyState appeared — this slice reads the first').toBe(-1);
    const element = src.slice(openAt, src.indexOf('/>', openAt));
    expect(element.length, 'RIG SELF-CHECK: the element slice must not be empty').toBeGreaterThan(0);
    expect(element, 'the board-level empty state grew a description back').not.toContain('description=');

    // (3) — the needle is held in a variable so this file can describe the thing
    // it forbids without containing it; it is proven able to fire before it is
    // trusted (AGENTS.md's rule for forensic matchers).
    const COLUMNS_CALL = "t('kanban.columns'";
    expect(
      "description={`${boardColumns.length} ${" + COLUMNS_CALL + ", { defaultValue: 'columns' })}`}",
      'POSITIVE CONTROL: the needle must match the exact call this card removed',
    ).toContain(COLUMNS_CALL);
    expect(
      src,
      'the columns unit word is being asked for again — a count in this region needs a plural family, and that decision went the other way',
    ).not.toContain(COLUMNS_CALL);
    expect(src, 'a lane count is being concatenated again').not.toMatch(/\$\{boardColumns\.length\}\s*\$\{/);

    // (4)
    expect(src, 'the region stopped announcing — that is not route 3, that is silence').toContain(
      "title={t('kanban.noCards')}",
    );
    expect(typeof at(builtInLocales.en, 'kanban.noCards')).toBe('string');

    // ⚠️ `kanban.columns` is still DEFINED in all ten packs and is now read by no
    // call site in `packages/` or `apps/`. ⛔ It is deliberately NOT retired here:
    // `scripts/check-i18n-dead-keys.mjs` owns that judgement, it is report-only by
    // design (a reverse sweep over dynamic key construction can produce false
    // positives, and a gate that cries wolf gets deleted rather than trusted), and
    // this suite is not the place to pre-empt it. What is pinned is the fact that
    // makes its verdict readable: the key resolves in every pack, and the slice
    // this file owns still covers it.
    for (const lang of LANGS) {
      expect(typeof at(builtInLocales[lang], 'kanban.columns'), `${lang}.kanban.columns`).toBe('string');
    }
    // The vocabulary the key carries, kept so a later retirement can see what it
    // would be deleting: kanban's own column word is not the table's — ja says
    // カラム here and 列 in `table.columns`, ru колонка against столбец.
    expect(at(builtInLocales.ja, 'kanban.addColumn')).toBe('カラムを追加');
    expect(at(builtInLocales.ja, 'table.columns')).toBe('列');
    expect(at(builtInLocales.ja, 'kanban.columns')).toBe('カラム');
    expect(at(builtInLocales.ru, 'kanban.addColumn')).toBe('Добавить колонку');
    expect(at(builtInLocales.ru, 'kanban.columns')).toBe('колонок');
    expect(at(builtInLocales.ko, 'kanban.columns')).toBe('열');
    // `preview.history.items` WAS the repo's other bare-unit-word call site, and
    // this comment used to offer it as evidence that the shape "still exists
    // elsewhere". ⚠️ That reading is retired by objectui#9266, and the sentence
    // is rewritten rather than left standing: pointing at a live instance of a
    // defect as proof that a ruling was narrow is how the shape propagated — the
    // next author copies the structure the comment vouches for. What the kanban
    // ruling was narrow ABOUT is stated directly instead: objectui#9170 dropped
    // the NUMBER there because a kanban's lanes are visible anyway, and that
    // reasoning does not transfer to a commit row, where the count is the only
    // thing saying how much a build changed. objectui#9266 therefore kept the
    // number and moved it INSIDE the pack value, so each pack owns the
    // agreement — the repair `fields.textarea.charactersRemaining` already
    // carries. The three values below are RE-DERIVED against that change, not
    // deleted and not copied: the old ones pinned `ru`'s bare genitive plural
    // `элементов` as correct, which rendered `1 элементов`.
    expect(at(builtInLocales.en, 'preview.history.items')).toBe('{{count}} item(s)');
    expect(at(builtInLocales.ko, 'preview.history.items')).toBe('{{count}} 항목');
    expect(at(builtInLocales.ru, 'preview.history.items')).toBe('Элементов: {{count}}');
    // The property those three strings now have and the old ones could not:
    // the pack states the count itself. `kanban.columns` above still does not —
    // it has no call site at all, which is the difference this file records.
    for (const lang of ['en', 'ko', 'ru'] as const) {
      expect(
        at(builtInLocales[lang], 'preview.history.items'),
        `${lang} preview.history.items`,
      ).toContain('{{count}}');
    }
  });

  it('detail.concurrentUpdateRecordLabel is grammatical in the sentence that embeds it', () => {
    // This value is not a label on its own: `ConcurrentUpdateDialog` splits
    // `detail.concurrentUpdateDescription` on `{{field}}` and renders it bolded in
    // the gap, so the pack value has to fit whatever case/preposition precedes
    // the hole. `de` needs the DATIVE (…Version **von** {{field}}) where its
    // sibling `detail.deleteConfirmation` uses the accusative, and `ru` needs the
    // GENITIVE (…версию {{field}}). This is why the value is not simply the
    // pack's word for "record".
    const dialog = sourceOf(OCC_DIALOG);
    expect(dialog).toContain("const descriptionTemplate = t('detail.concurrentUpdateDescription', { field: '{{field}}' });");
    expect(dialog).toContain("const [beforeField, afterField] = descriptionTemplate.split('{{field}}');");
    expect(dialog).toContain("const fieldLabel = conflict?.label || conflict?.field || '';");
    expect(sourceOf(SAVE_BAR)).toContain("label: t('detail.concurrentUpdateRecordLabel', { defaultValue: 'this record' }),");

    const composed = (lang: LocaleCode) =>
      (at(builtInLocales[lang], 'detail.concurrentUpdateDescription') as string).replace(
        '{{field}}',
        at(builtInLocales[lang], 'detail.concurrentUpdateRecordLabel') as string,
      );
    expect(composed('de')).toContain('eine neuere Version von diesem Datensatz gespeichert');
    expect(at(builtInLocales.de, 'detail.deleteConfirmation')).toContain('diesen Datensatz');
    expect(composed('ru')).toContain('более новую версию этой записи');
    expect(composed('fr')).toContain("une version plus récente de cet enregistrement");
    // `pt` WAS the one pack where the embedded phrase was not idiomatic and could
    // not be fixed from this leaf: Portuguese contracts de + este into "deste",
    // but the "de " lived in the surrounding sentence, so every spelling of the
    // leaf was wrong — `este registro` gave "de este registro", `deste registro`
    // gave "de deste registro". This file used to pin "mais recente de este
    // registro" as the current truth while objectui#3877 waited its turn.
    //
    // objectui#3877 rewrote the pt OUTER sentence instead (direction A), and it
    // deliberately does not just swap `de` for another preposition: the hole is
    // now preceded by the VERB `afeta`, so no contraction rule can apply to
    // whatever the leaf holds. `em`/`a`/`por` would each have re-created the same
    // defect with a different contraction (em+este = neste, a+aquele = àquele),
    // and this hole takes either a field label or the record label above. pt
    // alone diverges in sentence shape; `en` is unchanged, so the drift gate has
    // no event here.
    expect(composed('pt')).toContain('mais recente que afeta este registro');
    expect(composed('pt')).not.toContain('de este');
    expect(at(builtInLocales.pt, 'detail.concurrentUpdateDescription')).toContain('que afeta {{field}}');
    // The split contract the dialog depends on: exactly one hole, so
    // `split('{{field}}')` yields exactly the two halves it destructures.
    expect(
      (at(builtInLocales.pt, 'detail.concurrentUpdateDescription') as string).split('{{field}}'),
    ).toHaveLength(2);
  });

  it('each pack keeps its own typography in the one long sentence of this slice', () => {
    // The habits a copy-paste from `en` or a machine translation breaks first,
    // checked on the only multi-clause value here plus across all 24 paths where
    // the rule is pack-wide.
    const KEY = 'empty.appNotAvailableDescription';
    // en's em dash is U+2014; zh writes the doubled `——` its own pack prefers
    // (45 values against 25 single), everyone else mirrors en.
    for (const lang of LANGS) {
      const value = at(builtInLocales[lang], KEY) as string;
      expect(value.includes(lang === 'zh' ? '——' : '—'), `${lang} ${KEY} dash`).toBe(true);
    }
    // fr writes the straight apostrophe U+0027 (502 values against 21 curly) —
    // across every path, not just this one.
    for (const key of KEYS) {
      expect((at(builtInLocales.fr, key) as string).includes('’'), `fr ${key} used a curly apostrophe`).toBe(false);
    }
    expect(at(builtInLocales.fr, KEY)).toContain("n'est pas disponible");
    // ru writes ё (163 values in the pack). This read `ещё`, which lived in the
    // publishing clause objectui#9262 retired from this value; the habit is
    // pinned on the sibling the same screen gained in that pass, where the ё is
    // in `учётной записи`. Moved rather than dropped: a pack that reverts to
    // `учетной` is the regression this line exists to catch.
    expect(at(builtInLocales.ru, 'empty.appNotFoundDescription')).toContain('учётной');
    // The quote style around `{{name}}` follows the sibling empty-state value in
    // the SAME pack: zh curly, ja corner brackets, the rest ASCII.
    expect(at(builtInLocales.zh, 'empty.objectNotFoundDescription')).toContain('“{{name}}”');
    expect(at(builtInLocales.zh, 'empty.interfacePageSourceMissing')).toContain('“{{name}}”');
    expect(at(builtInLocales.ja, 'empty.objectNotFoundDescription')).toContain('「{{name}}」');
    expect(at(builtInLocales.ja, 'empty.interfacePageSourceMissing')).toContain('「{{name}}」');
    for (const lang of ['ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(at(builtInLocales[lang], 'empty.interfacePageSourceMissing'), `${lang} quotes`).toContain('"{{name}}"');
    }
    // de WAS the deliberate divergence: at slice-seven time its sibling values
    // paired the German opening low quote with an ASCII straight quote (20 keys /
    // 22 spans, measured), which was a typo rather than a convention, so this
    // slice wrote the correctly paired „…“ and filed the mismatch instead of
    // copying it. objectui#3876 then fixed the 20 siblings, and this assertion is
    // the one the card named as "the place to look back at when that lands" — so
    // it now pins the *convergence*: both values carry the same paired „…“. The
    // durable pack-wide invariant lives in `de-quote-pairing-3876.test.ts`.
    expect(at(builtInLocales.de, 'empty.objectNotFoundDescription')).toContain('„{{name}}“');
    expect(at(builtInLocales.de, 'empty.interfacePageSourceMissing')).toContain('„{{name}}“');
  });

  it('the ratchet is empty — this is the terminal state, not a partial one', () => {
    // `scripts/i18n-call-site-key-baseline.json` fails the build both ways: an
    // unfixed key missing from it, AND a fixed key still listed. With both lists
    // empty, any NEW unresolved call-site key is `unexpected` and fails — which
    // is what makes the empty file load-bearing rather than dead weight.
    const baselinePath = join(REPO_ROOT, 'scripts/i18n-call-site-key-baseline.json');
    expect(existsSync(baselinePath), `baseline not found at ${baselinePath}`).toBe(true);
    const raw = readFileSync(baselinePath, 'utf8');
    const baseline = JSON.parse(raw) as {
      note: string[];
      missingKeys: Record<string, unknown>;
      missingPrefixes: Record<string, unknown>;
    };
    // 258 keys and 4 prefix families at the start (main@a2c8f2a29), across seven
    // slices: 253 → 163 → 109 → 68 → 31 → 17 → 0, and 4 → 4 → 3 → 2 → 2 → 0.
    expect(Object.keys(baseline.missingKeys)).toEqual([]);
    expect(Object.keys(baseline.missingPrefixes)).toEqual([]);
    // Not deleted, and the file says why — a reader who finds two empty objects
    // must not conclude the ratchet is obsolete.
    expect(baseline.note.join(' ')).toContain('BOTH LISTS ARE NOW EMPTY');
    expect(baseline.note.join(' ')).toContain('fails the build');
    // Every key this slice removed now resolves, which is the other half of the
    // same statement: the entries went because the defect went.
    for (const key of KEYS) expect(typeof at(builtInLocales.en, key), `en ${key}`).toBe('string');
  });

  describe('through the real binding — provider mounted', () => {
    /** One key per owning surface. */
    const SAMPLE: Array<[key: string, owner: string]> = [
      ['common.done', 'InviteMemberDialog (invitation created footer)'],
      ['common.editInStudio', 'PageView (edit affordance title/aria-label)'],
      ['empty.appNotAvailable', 'AppContent (requested app missing)'],
      ['detail.historyEmpty', 'DetailView (history tab)'],
      // ⚠️ No owning surface any more: objectui#9170 removed the only call site
      // (the board-level empty state's description). Kept in this sample because
      // what this case checks is that the PACK answers for a slice-seven key, and
      // that is still true — and because a key with no reader is exactly the one
      // whose pack rows stop being exercised anywhere else.
      ['kanban.columns', 'no call site since objectui#9170 — pack-only'],
      ['layout.systemNav.administration', 'UnifiedSidebar (admin cluster)'],
      ['workspace.multiOrgDisabled', 'CreateWorkspaceDialog (submit guard)'],
      ['gantt.linkEnd.start', 'GanttView (link drag hint)'],
      ['organization.invitations.status.pending', 'InvitationsPage (filter tab + badge)'],
    ];

    it('every owning file still binds t the way this suite assumes', () => {
      // The premise of mounting a provider, per family of binding — asserted, not
      // assumed. Eight files take i18next directly; four go through a
      // `createSafeTranslation` hook that hands i18next's `t` over once its probe
      // key resolves (which it does, since the probe keys are in the packs); one
      // uses the per-call `useSafeTranslate`; one uses gantt's per-key wrapper.
      for (const rel of [
        INVITE_DIALOG,
        PAGE_VIEW,
        APP_CONTENT,
        INVITATIONS,
        MEMBERS,
        INTERFACE_LIST,
        UNIFIED_SIDEBAR,
        CREATE_WORKSPACE,
      ]) {
        expect(sourceOf(rel), `${rel} no longer binds the pack hook`).toContain('useObjectTranslation');
        // `t` must come out of the hook's destructuring — but it need not be the
        // ONLY thing destructured. The literal `const { t } = …` this used to
        // match broke the moment a file legitimately also took `language`, which
        // `UnifiedSidebar` now does to resolve the spec's inline per-locale
        // `I18nLabel` (widened in @objectstack/spec 17.0.0-rc.6). What this
        // suite actually depends on is that `t` is i18next's, bound from this
        // hook, so the pattern asserts exactly that and stays blind to which
        // siblings ride along.
        expect(
          /const \{[^}]*\bt\b[^}]*\} = useObjectTranslation\(/.test(sourceOf(rel)),
          `${rel} stopped destructuring t from useObjectTranslation()`,
        ).toBe(true);
      }
      // RecordDetailView takes it from @object-ui/react's re-export, with language
      // (and, since objectui#12075, the instance its flow launches read the
      // `flows` bundle from) — the same t-is-destructured pattern as above.
      expect(
        /const \{[^}]*\bt\b[^}]*\} = useObjectTranslation\(/.test(sourceOf(RECORD_DETAIL)),
        `${RECORD_DETAIL} stopped destructuring t from useObjectTranslation()`,
      ).toBe(true);
      // plugin-detail's three go through useDetailTranslation…
      for (const rel of [RELATED_LIST, SAVE_BAR, DETAIL_VIEW]) {
        expect(sourceOf(rel), `${rel}`).toContain("import { useDetailTranslation } from './useDetailTranslation'");
        expect(sourceOf(rel), `${rel}`).toContain('const { t } = useDetailTranslation();');
      }
      // …and kanban through its own createSafeTranslation, whose probe key IS in
      // the packs, so the provider path wins. Its defaults map does not list the
      // columns unit word — which used to be a live instance of the provider-LESS
      // defect objectui#3865 owns, and since objectui#9170 removed that call site
      // is merely an absence. The assertion is kept as the guard it now is: a
      // defaults row for a key nothing reads would be the first sign the
      // description had come back.
      const kanban = sourceOf(KANBAN);
      expect(kanban).toContain('const useKanbanT = createSafeTranslation(');
      expect(kanban).toContain("'kanban.noCards',");
      expect(kanban).not.toContain("'kanban.columns':");
      expect(typeof at(builtInLocales.en, 'kanban.noCards')).toBe('string');
      // gantt's wrapper is per-key rather than probe-based (see its own header).
      // The same pattern as above, and for the same reason: what this suite
      // depends on is that `t` comes out of `useGanttTranslation()`, not which
      // siblings ride along. GanttView stopped taking `language` when its dates
      // moved onto `useDisplayLocale()` (objectui#10668).
      expect(
        /const \{[^}]*\bt\b[^}]*\} = useGanttTranslation\(/.test(sourceOf(GANTT_VIEW)),
        `${GANTT_VIEW} stopped destructuring t from useGanttTranslation()`,
      ).toBe(true);
    });

    it.each(['en', 'zh'] as const)('%s resolves every sampled key from the pack', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      for (const [key, owner] of SAMPLE) {
        const value = result.current.t(key);
        expect(value, `${lang} ${owner} rendered the raw key for ${key}`).not.toBe(key);
        expect(value, `${lang}.${key}`).toBe(at(builtInLocales[lang], key));
      }
    });

    it('zh is Chinese — the half that was red before the backfill', () => {
      // Pre-fix each of these returned the inline English default in a zh session.
      // That is the whole defect, and only a non-en assertion sees it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('common.editInStudio')).toBe('在 Studio 中编辑');
      expect(t('empty.appNotAvailable')).toBe('应用不可用');
      expect(t('empty.appNotAvailableDescription')).toBe('此应用不可用 —— 请稍后重试。');
      expect(t('empty.interfacePageSourceMissing', { name: 'crm_lead' })).toBe(
        '此界面页引用了 “crm_lead”，但该来源不可用。',
      );
      expect(t('layout.systemNav.administration')).toBe('管理');
      expect(t('workspace.multiOrgDisabled')).toBe('此实例已禁用创建新组织。');
      expect(t('kanban.columns')).toBe('列');
      expect(t('detail.deleted')).toBe('记录已删除');
    });

    it('both template families render every member, in en and in zh', () => {
      // Exercised the way the call sites build the key, so a family that resolves
      // in the abstract but not through the template would still fail.
      for (const lang of ['en', 'zh'] as const) {
        window.localStorage.clear();
        const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
        for (const member of LINK_END_MEMBERS) {
          const key = `gantt.linkEnd.${member}`;
          expect(result.current.t(key), `${lang} ${key}`).toBe(at(builtInLocales[lang], key));
          expect(result.current.t(key)).not.toBe(key);
        }
        for (const member of STATUS_MEMBERS) {
          const key = `organization.invitations.status.${member}`;
          expect(result.current.t(key), `${lang} ${key}`).toBe(at(builtInLocales[lang], key));
          expect(result.current.t(key)).not.toBe(key);
        }
      }
      // The gantt drag hint, composed the way GanttView composes it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const endLabel = (e: 'start' | 'end') => result.current.t(`gantt.linkEnd.${e}`);
      expect(`设计评审 (${endLabel('end')}) → 上线 (${endLabel('start')})`).toBe('设计评审 (结束) → 上线 (开始)');
    });

    it.each([
      ['de', 'workspace.multiOrgDisabled', 'Das Erstellen neuer Organisationen ist auf dieser Instanz deaktiviert.'],
      ['fr', 'detail.historyEmpty', 'Aucun historique pour le moment'],
      ['es', 'organization.invitations.status.canceled', 'Cancelada'],
      ['pt', 'empty.appNotAvailable', 'Aplicativo indisponível'],
      ['ru', 'layout.systemNav.datasources', 'Источники данных'],
      ['ja', 'detail.deleted', 'レコードを削除しました'],
      ['ko', 'common.editInStudio', 'Studio에서 편집'],
      ['ar', 'layout.systemNav.documentation', 'الوثائق'],
    ])('%s renders a user-visible string from the pack', (lang, key, expected) => {
      // One pinned surface per remaining pack, across four writing systems, so a
      // pack that silently reverts to English is caught by name and not only by
      // the aggregate above.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      expect(result.current.t(key)).toBe(expected);
    });

    it('the ar pack does not open an RTL string with a Latin token', () => {
      // Same rule slices three through six applied. `MCP`/`Studio`-style Latin
      // runs are allowed inside a string, never at its head, and the one
      // interpolated path is checked after substitution too — a hole at position
      // zero would put the caller's Latin value first.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ar') });
      for (const key of KEYS) {
        const value = result.current.t(key, { name: 'crm_lead' });
        expect(/^[A-Za-z]/.test(value), `${key} starts with a Latin token: ${value}`).toBe(false);
      }
      expect(result.current.t('common.editInStudio')).toBe('التعديل في Studio');
      expect(result.current.t('empty.interfacePageSourceMissing', { name: 'crm_lead' })).toContain('"crm_lead"');
    });
  });
});
