/**
 * The `home` namespace — objectui#3546 slice six — resolves **from the locale
 * packs, with a provider mounted**.
 *
 * ## What was broken, precisely
 *
 * `scripts/check-i18n-call-site-keys.mjs` (#3530's gate) measured **14 distinct
 * keys at 14 call sites** under `perm.*` / `home.*` that a `t()` call site asks
 * for and that NO pack defined. Measured, never hand-counted: slice two
 * predicted 90 and the truth was 93.
 *
 * Two files owned all 14. The nine `perm.facet.*` keys belonged to
 * `PermissionFacetLink.tsx`, the read-only facet summary on the
 * `sys_permission_set` object page; that renderer and its keys were deleted
 * when ADR-0131 retired the catalog objects (a permission set is edited on its
 * registry-backed metadata page), so this file pins the surviving five:
 *
 *   - `usePublishAllDrafts.ts` — the rest of the publish-everything toasts
 *     (ADR-0038 L3 probe health, seed health, the ADR-0066 ⑨ capability lint).
 *     5 keys, shared by Home's pending-drafts banner and the draft preview bar.
 *
 * All of them carried an inline `t(key, { defaultValue: … })`, so with a
 * provider mounted this is the milder objectui#3517 class: English rendered and
 * all ten languages were stuck on it. Consequence for test design, as in slices
 * two through five: **`en` output was already correct before the change**, so
 * an `en` assertion cannot discriminate before from after. Every assertion that
 * pins the fix is a non-`en` one; the `en` cases prove reachability and prove
 * the wording did not move.
 *
 * ## Why a provider is mounted
 *
 * `usePublishAllDrafts` receives `t` from a bare `useObjectTranslation()` (Home
 * and the draft bar both pass it in), so i18next is the thing answering.
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


/** The five surviving keys of the 14 the guard measured. */
const KEYS = [
  // home.pendingDrafts — usePublishAllDrafts (5)
  'home.pendingDrafts.nothing',
  'home.pendingDrafts.probeWarn',
  'home.pendingDrafts.seedWarn',
  'home.pendingDrafts.publishedVerified',
  'home.pendingDrafts.capabilityWarn',
] as const;

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const PUBLISH = 'packages/app-shell/src/preview/usePublishAllDrafts.ts';

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

describe('objectui#3546 slice six — the home namespace', () => {
  it('covers all ten packs and all five paths (guards the loops from emptying)', () => {
    expect(LANGS).toHaveLength(10);
    expect(KEYS).toHaveLength(5);
    expect(new Set(KEYS).size).toBe(5);
    // The retired facet keys stay retired: no pack defines a `perm.facet` branch.
    for (const lang of LANGS) {
      expect(at(builtInLocales[lang], 'perm.facet'), `${lang}.perm.facet`).toBeUndefined();
    }
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
    // Set equality against the EMPTY set: no pair is identical to `en`,
    // as in slice five and unlike slices two (12 cognates), three (18) and four
    // (1). A first identical pair fails here and must be justified on the line
    // below, the way those slices justified theirs.
    const identical: string[] = [];
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      for (const key of KEYS) {
        if (at(builtInLocales[lang], key) === at(builtInLocales.en, key)) identical.push(`${lang} :: ${key}`);
      }
    }
    expect(identical.sort()).toEqual([]);
  });

  it('the empty cognate set is not vacuous — the loanwords are there and still differ', () => {
    // An empty set-equality is green when the packs are green AND when they are
    // empty (slice two's B1 lesson). The presence assertion above covers
    // emptiness; this one covers the other way it could be empty for the wrong
    // reason — packs that dodged every English-looking token. `Capability` is
    // carried through, and the value is not byte-identical to `en`.
    expect(at(builtInLocales.de, 'home.pendingDrafts.capabilityWarn')).toContain('Capability-Verweis(e)');
    expect(at(builtInLocales.de, 'home.pendingDrafts.capabilityWarn')).not.toBe(
      at(builtInLocales.en, 'home.pendingDrafts.capabilityWarn'),
    );
  });

  it('exactly the counting paths interpolate, and every pack carries the same hole', () => {
    // A translator who drops `{{count}}` renders a sentence with the number
    // missing; one who invents a second hole renders braces verbatim.
    // `all-locales-key-parity` compares placeholder shape too — this states the
    // intended shape BY NAME so a wrong one is legible here.
    // Deliberately two regexes: a `/g` one is stateful, and reusing it for
    // `.test()` inside a `filter` silently skips every other match through
    // `lastIndex` (slice five's own bug).
    const HOLES = /\{\{\w+\}\}/g;
    const HAS_HOLE = /\{\{\w+\}\}/;
    const INTERPOLATED: string[] = [
      'home.pendingDrafts.publishedVerified',
      'home.pendingDrafts.capabilityWarn',
    ].sort();
    expect(KEYS.filter((k) => HAS_HOLE.test(at(builtInLocales.en, k) as string)).sort()).toEqual(INTERPOLATED);
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const holes = ((at(builtInLocales[lang], key) as string).match(HOLES) ?? []).join(',');
        expect(holes, `${lang}.${key}`).toBe(INTERPOLATED.includes(key) ? '{{count}}' : '');
      }
    }
  });

  it('the five en values are byte-identical to their inline defaultValue', () => {
    // The call sites whose `defaultValue` is a static literal. Two paths must
    // not diverge: with the pack present i18next answers, and before this slice
    // the inline default did — a user must not be able to tell which ran.
    const EXPECTED: Array<[key: string, value: string]> = [
      ['home.pendingDrafts.nothing', 'Nothing to publish.'],
      ['home.pendingDrafts.probeWarn', 'Published, but verification found problems.'],
      ['home.pendingDrafts.seedWarn', 'Published, but some sample data failed to load.'],
      ['home.pendingDrafts.publishedVerified', 'Published & verified — {{count}} sample row(s) live.'],
      ['home.pendingDrafts.capabilityWarn', 'Authoring check: {{count}} capability reference(s) resolve nowhere.'],
    ];
    expect(EXPECTED).toHaveLength(5);
    const source = sourceOf(PUBLISH);
    for (const [key, value] of EXPECTED) {
      expect(at(builtInLocales.en, key), `en ${key}`).toBe(value);
      // the premise: the call site still passes exactly this defaultValue
      expect(source, `${key}'s defaultValue moved`).toContain(`defaultValue: '${value}'`);
    }
  });

  it('reused strings are the neighbours own translations, not second renderings', () => {
    // Where this slice's `en` string already existed verbatim elsewhere, the
    // existing row is reused rather than re-translated, so one English string
    // never renders as two different sentences in the same language. A drift on
    // either side fails here.
    const REUSED: Array<[newKey: string, neighbour: string]> = [
      ['home.pendingDrafts.seedWarn', 'console.ai.seedWarn'],
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
  });

  it('the two counting home strings follow their own family on the (s) marker', () => {
    // `home.pendingDrafts.title` (the drafts row's count since objectui#12602,
    // `home.pendingDrafts.message` before it) is the same family, the same row and the
    // same `{{count}} … (s)` shape, so each pack's answer there is the answer
    // here: de/fr/es/pt keep a parenthesised marker, zh/ja/ko use a counter, and
    // ru/ar restructure. Copying `en`'s "(s)" into ru is the mistake this pins.
    expect(at(builtInLocales.en, 'home.pendingDrafts.title')).toContain('change(s)');
    const MARKER = /\([\p{L}]{1,4}\)/u;
    for (const lang of ['de', 'fr', 'es', 'pt'] as const) {
      expect(
        MARKER.test(at(builtInLocales[lang], 'home.pendingDrafts.title') as string),
        `${lang} title lost its marker`,
      ).toBe(true);
      expect(
        MARKER.test(at(builtInLocales[lang], 'home.pendingDrafts.publishedVerified') as string),
        `${lang} publishedVerified should carry the same marker`,
      ).toBe(true);
    }
    for (const lang of ['zh', 'ja', 'ko', 'ru'] as const) {
      expect(
        MARKER.test(at(builtInLocales[lang], 'home.pendingDrafts.publishedVerified') as string),
        `${lang} publishedVerified imported a "(s)" marker it does not use`,
      ).toBe(false);
    }
    // The regex is Unicode-aware on purpose: an ASCII `\w` cannot match
    // «поле(й)» or «صف(صفوف)», so it would pass vacuously on the four packs the
    // assertion is actually about.
    expect(MARKER.test('поле(й)')).toBe(true);
    expect(/\(\w{1,4}\)/.test('поле(й)')).toBe(false);
  });

  it('the ampersand and the em dash follow en in every pack', () => {
    for (const lang of LANGS) {
      // The em dash in `Published & verified — …` is U+2014 everywhere, except zh
      // which writes the doubled `——` its own pack used in the retired home.pendingDrafts.message.
      const verified = at(builtInLocales[lang], 'home.pendingDrafts.publishedVerified') as string;
      expect(verified.includes(lang === 'zh' ? '——' : '—'), `${lang} publishedVerified dash`).toBe(true);
      expect(verified.includes('&'), `${lang} kept en's ampersand`).toBe(lang === 'en');
    }
  });

  it('ja, zh and ko each answer the mid-sentence colon their own way', () => {
    // Three packs, three correct answers to one `en` colon
    // (`Authoring check: …`). ja is genuinely split mid-string — 24 halfwidth
    // against 28 fullwidth — and the split tracks what FOLLOWS: a single token
    // or value takes `: ` (console.ai.usage.ariaLabel `AI 使用状況: {{status}}`),
    // a Japanese sentence takes `：` (approvalsInbox.whyDisabled
    // `現在の承認待ち：{{who}}。`). This one is followed by a sentence.
    expect(at(builtInLocales.ja, 'console.ai.usage.ariaLabel')).toBe('AI 使用状況: {{status}}');
    expect(at(builtInLocales.ja, 'home.pendingDrafts.capabilityWarn')).toContain('作成時チェック：');
    // zh writes fullwidth punctuation throughout.
    expect(at(builtInLocales.zh, 'home.pendingDrafts.capabilityWarn')).toContain('编写检查：');
    // ko has no fullwidth colon anywhere in the pack.
    expect(at(builtInLocales.ko, 'home.pendingDrafts.capabilityWarn')).toContain('작성 검사: ');
    expect(at(builtInLocales.ko, 'home.pendingDrafts.capabilityWarn')).not.toContain('：');
    // fr puts a space before the colon (6:0 in this pack).
    expect(at(builtInLocales.fr, 'home.pendingDrafts.capabilityWarn')).toContain('conception : ');
  });

  it('fr keeps its straight apostrophe', () => {
    // The typographic habit a copy-paste from `en` or from a machine
    // translation breaks first: fr writes U+0027, not U+2019.
    for (const key of KEYS) {
      expect(
        (at(builtInLocales.fr, key) as string).includes('’'),
        `fr ${key} used a curly apostrophe`,
      ).toBe(false);
    }
  });

  it('the ratchet actually shrank — no perm/home key is still baselined', () => {
    // `scripts/i18n-call-site-key-baseline.json` fails the build both ways: an
    // unfixed key missing from it, AND a fixed key still listed. Pinning the
    // absence here means a revert of the packs cannot quietly restore the
    // entries and go green again.
    const baselinePath = join(REPO_ROOT, 'scripts/i18n-call-site-key-baseline.json');
    expect(existsSync(baselinePath), `baseline not found at ${baselinePath}`).toBe(true);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      missingKeys: Record<string, unknown>;
      missingPrefixes: Record<string, unknown>;
    };
    expect(
      Object.keys(baseline.missingKeys).filter((k) => k.startsWith('perm.') || k.startsWith('home.')),
    ).toEqual([]);
    // 31 before this slice, 14 removed, leaving 17 — which slice seven (the
    // residue: 17 keys plus both remaining prefix families) took to ZERO. The
    // counter moved once per slice and only downwards; at zero it stops being
    // "how much is left" and becomes "nothing may be added back".
    expect(Object.keys(baseline.missingKeys).length).toBe(0);
    // This slice owned NO prefix family — the two left belonged to slice seven,
    // which enumerated both, so the list is now empty.
    expect(Object.keys(baseline.missingPrefixes).sort()).toEqual([]);
  });

  describe('through the real binding — provider mounted', () => {
    /** One key per surface that owns a group of these keys. */
    const SAMPLE: Array<[key: string, owner: string]> = [
      ['home.pendingDrafts.nothing', 'usePublishAllDrafts (no drafts)'],
      ['home.pendingDrafts.probeWarn', 'usePublishAllDrafts (L3 probes)'],
      ['home.pendingDrafts.seedWarn', 'usePublishAllDrafts (seed health)'],
    ];

    it('the owning file still binds t the way this suite assumes', () => {
      // The premise of mounting a provider. `usePublishAllDrafts` takes `t` as an
      // argument, so assert its two callers pass the pack-backed one.
      const publish = sourceOf(PUBLISH);
      expect(publish).toContain('export function usePublishAllDrafts(t: TranslateFn)');
      for (const caller of [
        'packages/app-shell/src/console/home/HomePage.tsx',
        'packages/app-shell/src/preview/DraftPreviewBar.tsx',
      ]) {
        const src = sourceOf(caller);
        expect(src, `${caller} no longer binds the pack hook`).toContain(
          "import { useObjectTranslation } from '@object-ui/i18n'",
        );
        expect(src, `${caller} stopped passing t into usePublishAllDrafts`).toContain('usePublishAllDrafts(t)');
      }
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
      // Pre-fix each of these returned the inline English `defaultValue` in a zh
      // session. That is the whole defect, and only a non-en assertion sees it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('home.pendingDrafts.nothing')).toBe('没有需要发布的内容。');
      expect(t('home.pendingDrafts.publishedVerified', { count: 12 })).toBe(
        '已发布并验证 —— 12 行示例数据已生效。',
      );
      expect(t('home.pendingDrafts.capabilityWarn', { count: 2 })).toBe('编写检查：2 个能力引用无法解析。');
    });

    it.each([
      ['de', 'home.pendingDrafts.nothing', 'Nichts zu veröffentlichen.'],
      ['fr', 'home.pendingDrafts.nothing', 'Rien à publier.'],
      ['es', 'home.pendingDrafts.probeWarn', 'Publicado, pero la verificación encontró problemas.'],
      ['pt', 'home.pendingDrafts.probeWarn', 'Publicado, mas a verificação encontrou problemas.'],
      ['ru', 'home.pendingDrafts.nothing', 'Публиковать нечего.'],
      ['ja', 'home.pendingDrafts.nothing', '公開するものはありません。'],
      ['ko', 'home.pendingDrafts.probeWarn', '게시했지만 검증에서 문제를 발견했습니다.'],
      ['ar', 'home.pendingDrafts.probeWarn', 'تم النشر، لكن التحقق وجد مشكلات.'],
    ])('%s renders a user-visible string from the pack', (lang, key, expected) => {
      // One pinned surface per remaining pack, across four writing systems, so a
      // pack that silently reverts to English is caught by name and not only by
      // the aggregate above.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      expect(result.current.t(key)).toBe(expected);
    });

    it('the ar pack does not open an RTL string with a Latin token', () => {
      // Same rule slices three through five applied: a Latin run stays inside
      // the string instead of leading it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ar') });
      for (const key of KEYS) {
        const value = result.current.t(key, { count: 3 });
        expect(/^[A-Za-z]/.test(value), `${key} starts with a Latin token: ${value}`).toBe(false);
      }
    });
  });
});
