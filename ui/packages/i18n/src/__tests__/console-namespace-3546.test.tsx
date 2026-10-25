/**
 * The `console` namespace — objectui#3546 slice four — resolves **from the
 * locale packs, with a provider mounted**.
 *
 * ## What was broken, precisely
 *
 * `scripts/check-i18n-call-site-keys.mjs` measured **41 distinct keys at 47
 * call sites** under `console.*` that a `t()` call site asks for and that NO
 * pack defined (five keys have more than one site — `collapseToDock`, `newApp`,
 * `dock.title`, `dock.open` twice each and `dock.maximize` three times — which
 * is why the denominator is measured and never counted by hand; slice two
 * predicted 90 and the truth was 93).
 *
 * All 47 carried an inline `t(key, { defaultValue: 'English' })`, so this is the
 * milder objectui#3517 class: English rendered correctly and **all ten
 * languages were stuck on it**. Nothing rendered a raw key here — slice one
 * (PR #3583) held the sites that did — and an AST sweep of all **172**
 * `console.*` call sites in the five owning files found **zero** dead
 * `t(key) || 'English'` fallbacks, which is why this slice touches no component.
 *
 * Consequence for test design, same as slices two and three: `en` output was
 * already correct before the change, so **an `en` assertion cannot discriminate
 * before from after**. Every assertion that pins the fix is a non-`en` one; the
 * `en` cases only prove the key is reachable through the real binding.
 *
 * ## The template-key family
 *
 * `console.ai.group.` was one of the four `missingPrefixes` — a template key
 * (`` t(`console.ai.group.${group.key}`) `` in `ConversationsSidebar.tsx:277`)
 * whose static head matched no `en` key at all, so every expansion missed. Its
 * value surface is the CLOSED union `ConversationGroupKey`, so the repair is an
 * enumeration, not a wildcard: all five members are backfilled and the family
 * leaves `missingPrefixes` (4 → 3). The test below reads the component's own
 * union and label map and fails if a sixth bucket is ever added without a key,
 * which is the failure the prefix entry used to catch.
 *
 * ## Why a provider is mounted
 *
 * All five components behind these keys — `AiChatPage`, `ChatDock`,
 * `ConversationsSidebar`, `AppContent`'s `RouteNotFound` and
 * `KeyboardShortcutsDialog` — bind `t` from a bare `useObjectTranslation()`.
 * None sits behind a `createSafeTranslation` defaults map, so there is no
 * provider-less path to be green on: without `I18nProvider`, i18next is not the
 * thing answering and the test would describe a binding the console never uses.
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


/** The 46 keys this slice backfilled, grouped as the packs group them. */
const KEYS = [
  // console.shortcuts — the AI group of the ?-shortcuts dialog (3)
  'console.shortcuts.groups.aiChat',
  'console.shortcuts.newChat',
  'console.shortcuts.toggleChatsList',
  // console.notFound — the console's catch-all route (3)
  'console.notFound.title',
  'console.notFound.description',
  'console.notFound.back',
  // console.ai — the /ai chat page chrome (9)
  'console.ai.collapseToDock',
  'console.ai.switchApp',
  'console.ai.switchAppLabel',
  'console.ai.newApp',
  'console.ai.connectionWaiting',
  'console.ai.connectionStalled',
  'console.ai.connectionOffline',
  'console.ai.designingPlan',
  'console.ai.planReady',
  // console.ai.designingPlanHint — the rotating propose_blueprint hints (10)
  'console.ai.designingPlanHint.data',
  'console.ai.designingPlanHint.objects',
  'console.ai.designingPlanHint.relations',
  'console.ai.designingPlanHint.lookups',
  'console.ai.designingPlanHint.views',
  'console.ai.designingPlanHint.forms',
  'console.ai.designingPlanHint.defaults',
  'console.ai.designingPlanHint.dashboard',
  'console.ai.designingPlanHint.review',
  'console.ai.designingPlanHint.finalize',
  // console.ai — the plan / publish confirm-gate card (5)
  'console.ai.planBuilding',
  'console.ai.planBuilt',
  'console.ai.planDeferred',
  'console.ai.published',
  'console.ai.publishFailed',
  // console.ai — the "no AI in this deployment" dead end (5)
  'console.ai.unavailableTitle',
  'console.ai.unavailableDescription',
  'console.ai.unavailableError',
  'console.ai.unavailableRetry',
  'console.ai.unavailableHome',
  // console.ai.dock — the ChatDock chrome (6)
  'console.ai.dock.title',
  'console.ai.dock.description',
  'console.ai.dock.resize',
  'console.ai.dock.collapse',
  'console.ai.dock.maximize',
  'console.ai.dock.open',
  // console.ai.group — the template-key FAMILY, enumerated (5)
  'console.ai.group.today',
  'console.ai.group.yesterday',
  'console.ai.group.previous7Days',
  'console.ai.group.previous30Days',
  'console.ai.group.older',
] as const;

/** The 41 of those that the guard measured; the other 5 are the prefix family. */
const MEASURED_KEYS = KEYS.filter((k) => !k.startsWith('console.ai.group.'));

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/**
 * `lang :: key` pairs whose value is legitimately byte-identical to `en`.
 *
 * Exactly one, and for one reason: `Assistant` is spelled identically in French.
 * It is a true cognate, not an untranslated string — the same class slice two
 * pinned with 12 pairs and slice three with 18. Every other French value in this
 * slice differs from `en`, including the two that merely CONTAIN the word
 * (`dock.description`, `shortcuts.groups.aiChat`), which is what proves the
 * exemption is about this one word and not about the French pack being lazy.
 *
 * Set equality, not a subset: a second identical value fails, and localising
 * this one fails too and forces the line out.
 */
const UNTRANSLATED_COGNATES = ['fr :: console.ai.dock.title'];

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

beforeEach(() => {
  // The provider persists the last language (objectstack#5406); without this a
  // stale locale leaks into the `en` cases.
  window.localStorage.clear();
});

describe('objectui#3546 slice four — the console namespace', () => {
  it('covers all ten packs and all forty-six keys (guards the loops from emptying)', () => {
    expect(LANGS).toHaveLength(10);
    expect(KEYS).toHaveLength(46);
    expect(new Set(KEYS).size).toBe(46);
    // 41 measured missing keys + 5 that came from the prefix family. Splitting the
    // two apart here is what stops a later reader reading "46" off the ratchet.
    expect(MEASURED_KEYS).toHaveLength(41);
    const perArea = KEYS.reduce<Record<string, number>>((acc, k) => {
      const area = k.startsWith('console.ai.') ? 'console.ai' : k.split('.').slice(0, 2).join('.');
      acc[area] = (acc[area] ?? 0) + 1;
      return acc;
    }, {});
    expect(perArea).toEqual({ 'console.shortcuts': 3, 'console.notFound': 3, 'console.ai': 40 });
  });

  it.each(LANGS)('%s defines every console key as a non-empty string', (lang) => {
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
    // sets and never looks at a value.
    const identical: string[] = [];
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      for (const key of KEYS) {
        if (at(builtInLocales[lang], key) === at(builtInLocales.en, key)) identical.push(`${lang} :: ${key}`);
      }
    }
    expect(identical.sort()).toEqual(UNTRANSLATED_COGNATES);
    // 1 permitted pair out of 414 — i.e. every key is translated in every pack
    // except the French cognate. The set equality above is vacuous if the packs
    // were empty, so pin the facts it rests on separately: the exempt value
    // really is the cognate, and the two French neighbours that embed the same
    // word really are NOT identical to en.
    expect(UNTRANSLATED_COGNATES).toHaveLength(1);
    expect(at(builtInLocales.fr, 'console.ai.dock.title')).toBe('Assistant');
    expect(at(builtInLocales.fr, 'console.ai.dock.description')).not.toBe(
      at(builtInLocales.en, 'console.ai.dock.description'),
    );
    expect(at(builtInLocales.fr, 'console.shortcuts.groups.aiChat')).not.toBe(
      at(builtInLocales.en, 'console.shortcuts.groups.aiChat'),
    );
  });

  it('no key in this slice interpolates — so no pack may invent a placeholder', () => {
    // Unlike slice three, not one of these 46 strings takes an option: every
    // measured call site passes `defaultValue` and nothing else. A translator
    // adding `{{name}}` would render the braces to the user verbatim, and a
    // single-brace `{seconds}`-style hole would be read by nothing at all.
    const PLACEHOLDER = /\{\{?\w+\}?\}/;
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(PLACEHOLDER.test(at(builtInLocales[lang], key) as string), `${lang}.${key}`).toBe(false);
      }
    }
  });

  it('the ellipsis character follows en in every pack', () => {
    // The packs mirror `en`'s ellipsis byte rather than picking their own: where
    // en writes U+2026 they write U+2026, where en writes "..." they write "...".
    // 15 of these keys end in an ellipsis (the three connection banners, the
    // designingPlan lead-in plus its ten hints, and planBuilding), and a pack that
    // swapped in three dots would read as a different typographic register on the
    // same card as its neighbours.
    const ellipsised = KEYS.filter((k) => (at(builtInLocales.en, k) as string).endsWith('…'));
    expect(ellipsised).toHaveLength(15);
    for (const lang of LANGS) {
      for (const key of ellipsised) {
        const value = at(builtInLocales[lang], key) as string;
        expect(value.endsWith('…'), `${lang}.${key} = ${value}`).toBe(true);
        expect(value.includes('...'), `${lang}.${key} mixes "..." into an … string`).toBe(false);
      }
    }
  });

  describe('the console.ai.group. template-key family', () => {
    const SIDEBAR = 'packages/app-shell/src/console/ai/ConversationsSidebar.tsx';

    it('is enumerated from the ConversationGroupKey union, not guessed', () => {
      // The family left `missingPrefixes` because all five members now exist. If a
      // sixth bucket is added to the union, this fails — which is exactly the job
      // the prefix entry used to do, moved from the ratchet into a test.
      const src = sourceOf(SIDEBAR);
      const union = src.match(/export type ConversationGroupKey =([^;]+);/);
      expect(union, 'ConversationGroupKey union not found — did the type move?').not.toBeNull();
      const members = [...union![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(members).toHaveLength(5);
      const packMembers = Object.keys(at(builtInLocales.en, 'console.ai.group') as object);
      expect(packMembers.sort()).toEqual([...members].sort());
      // And the call site really is the template shape this family describes.
      expect(src).toContain('t(`console.ai.group.${group.key}`');
    });

    it("each en value is byte-identical to the component's own fallback label", () => {
      // `CONVERSATION_GROUP_LABELS` is the map i18next's `defaultValue` reads. The
      // two paths must not diverge: with the pack present i18next answers, without
      // it the map does, and a user must not be able to tell which one ran.
      const src = sourceOf(SIDEBAR);
      const block = src.match(
        /export const CONVERSATION_GROUP_LABELS: Record<ConversationGroupKey, string> = \{([^}]+)\}/,
      );
      expect(block, 'CONVERSATION_GROUP_LABELS not found').not.toBeNull();
      const labels = Object.fromEntries(
        [...block![1].matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
      );
      expect(Object.keys(labels)).toHaveLength(5);
      for (const [key, label] of Object.entries(labels)) {
        expect(at(builtInLocales.en, `console.ai.group.${key}`), `en console.ai.group.${key}`).toBe(label);
      }
    });

    it.each(['en', 'zh'] as const)('%s renders every bucket through the real template call', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      for (const key of ['today', 'yesterday', 'previous7Days', 'previous30Days', 'older']) {
        const full = `console.ai.group.${key}`;
        const value = result.current.t(full);
        expect(value, `${lang} rendered the raw key for ${full}`).not.toBe(full);
        expect(value, `${lang}.${full}`).toBe(at(builtInLocales[lang], full));
      }
    });

    it('zh buckets are Chinese — the half that was red before the backfill', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('console.ai.group.today')).toBe('今天');
      expect(t('console.ai.group.previous7Days')).toBe('过去 7 天');
      expect(t('console.ai.group.older')).toBe('更早');
    });
  });

  it('zh planBuilding is REACHABLE — no conversation-language gate shadows the pack (#3837)', () => {
    // Slice four measured `planBuildingLabel` in `AiChatPage.tsx` gated on
    // `convZh` (the CONVERSATION's language, #772/#2884) handing back a literal
    // '正在搭建…' instead of the pack, which made the zh value below DEAD for every
    // Chinese conversation — the pack could be re-worded and no zh reader would
    // see it. That was filed as #3837 and fixed there; this assertion used to pin
    // the literal and the pack byte-identical (the containment measure while the
    // defect stood) and now pins its removal, which is the state that makes the
    // pack the single source of the badge's text.
    const src = sourceOf('packages/app-shell/src/console/ai/AiChatPage.tsx');
    expect(
      src,
      'the convZh gate is back over planBuildingLabel — the zh pack value is dead again (#3837)',
    ).not.toMatch(/convZh \? '[^']*' : t\('console\.ai\.planBuilding'/);
    expect(src, 'planBuildingLabel no longer reads the pack directly (#3837)').toMatch(
      /planBuildingLabel=\{t\('console\.ai\.planBuilding'/,
    );
    // Same invariant one step wider, so the next label to drift in is caught too:
    // `convZh` may gate OUTBOUND message text only — the cloud confirm gate reads
    // those two languages (see outbound-agent-messages.test.ts) — never anything
    // RENDERED. Whole-line comments are stripped first so prose naming the
    // identifier (there is some, right above it) can't be counted as a read.
    //
    // Shape as of #3896: the four outbound messages no longer inline
    // `convZh ? '<zh literal>' : t(key)` — they go through
    // `resolveOutboundAgentText`, which reads the `zh`/`en` packs by conversation
    // language. So `convZh` now has exactly ONE consumer, and that consumer is
    // the resolver bridge; anything else reading it is a label drifting back in.
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    const convZhLines = code.split('\n').filter((line) => /\bconvZh\b/.test(line));
    expect(
      convZhLines,
      'a convZh read appeared outside the outbound-text resolver — if it feeds anything rendered, it follows the UI locale instead (#3837/#3896)',
    ).toHaveLength(3);
    expect(convZhLines[0], 'the convZh memo itself').toMatch(/const convZh = useMemo\(/);
    expect(convZhLines[1], 'its only consumer is the outbound-text resolver').toMatch(
      /resolveOutboundAgentText\(\s*convZh\s*,/,
    );
    expect(convZhLines[2], "the bridge's dep array").toMatch(/^\s*\[convZh\],\s*$/);
    // And the resolver is asked for outbound MESSAGES only — the same list the
    // i18n guard owns (`outbound-agent-messages.test.ts` OUTBOUND_KEYS). A
    // `*Label` appearing here would be #3837 all over again, one indirection out.
    const resolved = [...code.matchAll(/outboundText\('(\w+)'/g)].map((m) => m[1]).sort();
    expect(resolved).toEqual([
      'changesConfirmMessage',
      'planAnswerMessage',
      'planApproveDefaultsMessage',
      'planApproveMessage',
    ]);
    // #3896's headline defect in one line: an outbound message read through
    // `t()` is read from the UI pack, which is how a zh console sent Chinese
    // into an English thread. No outbound `*Message` key may go through `t()`.
    expect(
      code,
      'an outbound *Message is being read from the UI pack again (#3896)',
    ).not.toMatch(/t\('console\.ai\.\w*Message'/);
    // And zh still spells the badge the way the deleted literal did, so the fix
    // changed WHICH source answers a zh-UI reader, not what they read.
    expect(at(builtInLocales.zh, 'console.ai.planBuilding')).toBe('正在搭建…');
  });

  it('the ratchet actually shrank — no console key is still baselined', () => {
    // `scripts/i18n-call-site-key-baseline.json` fails the build both ways: an
    // unfixed key missing from it, AND a fixed key still listed. Pinning the
    // absence here means a revert of the packs cannot quietly restore the entries
    // and go green again.
    const baselinePath = join(REPO_ROOT, 'scripts/i18n-call-site-key-baseline.json');
    expect(existsSync(baselinePath), `baseline not found at ${baselinePath}`).toBe(true);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      missingKeys: Record<string, unknown>;
      missingPrefixes: Record<string, unknown>;
    };
    expect(Object.keys(baseline.missingKeys).filter((k) => k.startsWith('console.'))).toEqual([]);
    // 109 before this slice, 41 removed — then slice five (marketplace + preview,
    // 37 keys) took it to 31, slice six (perm + home, 14 keys) to 17 and slice
    // seven (the 17-key residue) to ZERO. The counter moved once per slice and
    // only downwards; at zero it stops being "how much is left" and becomes
    // "nothing may be added back".
    expect(Object.keys(baseline.missingKeys).length).toBe(0);
    // The prefix family this slice handled is GONE from the ratchet. Slice five
    // then took `marketplace.disclosure.runtime.` and slice seven the last two
    // (`gantt.linkEnd.`, `organization.invitations.status.`), so the list is empty.
    // The `not.toContain('console.ai.group.')` that used to sit here was dropped
    // rather than kept: against an empty list it passes because nothing is
    // produced, not because the logic holds. The set equality above is the
    // stronger statement and it is not vacuous.
    expect(Object.keys(baseline.missingPrefixes).sort()).toEqual([]);
  });

  describe('through the real binding — bare useObjectTranslation, provider mounted', () => {
    /** One key per component that owns a group of these keys. */
    const SAMPLE: Array<[key: string, owner: string]> = [
      ['console.ai.collapseToDock', 'AiChatPage'],
      ['console.ai.designingPlanHint.objects', 'AiChatPage (propose_blueprint wait)'],
      ['console.ai.unavailableTitle', 'AiChatPage (AiUnavailable)'],
      ['console.ai.dock.maximize', 'ChatDock'],
      ['console.notFound.title', 'AppContent RouteNotFound'],
      ['console.shortcuts.newChat', 'KeyboardShortcutsDialog'],
    ];

    it.each(['en', 'zh'] as const)('%s resolves every sampled key from the pack', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      for (const [key, owner] of SAMPLE) {
        const value = result.current.t(key);
        expect(value, `${lang} ${owner} rendered the raw key for ${key}`).not.toBe(key);
        expect(value, `${lang}.${key}`).toBe(at(builtInLocales[lang], key));
      }
    });

    it('zh is Chinese — the half that was red before the backfill', () => {
      // Pre-fix each of these returned the inline English `defaultValue`, in a zh
      // session. That is the whole defect, and only a non-en assertion sees it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('console.ai.unavailableTitle')).toBe('AI 助手不可用');
      expect(t('console.ai.dock.maximize')).toBe('以完整页面打开');
      expect(t('console.notFound.title')).toBe('页面不存在');
      expect(t('console.shortcuts.toggleChatsList')).toBe('切换对话列表');
    });

    it.each([
      ['fr', 'console.ai.unavailableRetry', 'Réessayer'],
      ['de', 'console.ai.planDeferred', 'Noch nicht erstellt'],
      ['es', 'console.notFound.description', 'La URL que siguió no coincide con ninguna vista de esta aplicación.'],
      ['pt', 'console.ai.dock.collapse', 'Recolher a conversa'],
      ['ru', 'console.ai.connectionStalled', 'Всё ещё выполняется…'],
      ['ja', 'console.ai.designingPlanHint.finalize', 'プランをまとめています…'],
      ['ko', 'console.shortcuts.groups.aiChat', 'AI 어시스턴트'],
      ['ar', 'console.ai.published', 'تم النشر'],
    ])('%s renders a user-visible console string from the pack', (lang, key, expected) => {
      // One pinned surface per remaining pack, across four writing systems, so a
      // pack that silently reverts to English is caught by name and not only by
      // the aggregate above.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      expect(result.current.t(key)).toBe(expected);
    });

    it('the ru pack keeps ё, matching its own console neighbours', () => {
      // `console.ai.emptyDescription` already writes «о чём угодно»: this pack
      // spells ё rather than collapsing it to е, and these two strings are where
      // a backfill would most easily have dropped it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ru') });
      expect(result.current.t('console.ai.planDeferred')).toContain('Ещё');
      expect(result.current.t('console.ai.unavailableDescription')).toContain('включён');
    });

    it('the ar pack does not open an RTL sentence with a Latin token', () => {
      // Same rule slice three applied to `oauth.consent.title`: the AI strings
      // mention "AI", and an Arabic sentence that STARTS with a Latin run renders
      // with the bidi boundary in the wrong place. This pack spells it out
      // (الذكاء الاصطناعي) instead of embedding the Latin acronym.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ar') });
      for (const key of ['console.ai.unavailableTitle', 'console.ai.dock.description', 'console.shortcuts.groups.aiChat']) {
        const value = result.current.t(key);
        expect(/^[A-Za-z]/.test(value), `${key} starts with a Latin token: ${value}`).toBe(false);
        expect(value).toContain('الذكاء الاصطناعي');
      }
    });
  });
});
