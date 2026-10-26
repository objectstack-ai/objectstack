/**
 * The `marketplace` and `preview` namespaces — objectui#3546 slice five —
 * resolve **from the locale packs, with a provider mounted**.
 *
 * ## What was broken, precisely
 *
 * `scripts/check-i18n-call-site-keys.mjs` (#3530's gate) measured **37 distinct
 * keys at 37 call sites** under `marketplace.*` / `preview.*` that a `t()` call
 * site asks for and that NO pack defined, plus **one** `missing-prefix` family
 * (`marketplace.disclosure.runtime.`, whose static head matched no `en` key at
 * all so every expansion missed). Unlike slices two through four this slice has
 * no multi-site key: the denominator is 1:1 — still measured, never counted by
 * hand, because slice two predicted 90 and the truth was 93.
 *
 * All 37 carried an inline `t(key, { defaultValue: 'English' })`, so this is the
 * milder objectui#3517 class: English rendered correctly and **all ten
 * languages were stuck on it**. Nothing rendered a raw key here — slice one
 * (PR #3583) held the sites that did — and an AST sweep of the whole
 * `marketplace.*`/`preview.*` call-site surface (172 sites in 11 files, not just
 * this slice's 37) found 16 dead `t(key) || 'English'` fallbacks, every one of
 * them on a key that already resolves in `en` and NOT in this slice, so this
 * slice touches no component. (They are filed; see the PR body.)
 *
 * Consequence for test design, same as slices two through four: `en` output was
 * already correct before the change, so **an `en` assertion cannot discriminate
 * before from after**. Every assertion that pins the fix is a non-`en` one; the
 * `en` cases only prove the key is reachable through the real binding.
 *
 * ## The template-key family
 *
 * `marketplace.disclosure.runtime.` is the plugin trust tier badge in
 * `PluginDisclosure.tsx:70`:
 *
 *     t(`marketplace.disclosure.runtime.${version.runtime}`, {
 *       defaultValue: RUNTIME_FALLBACK[version.runtime],
 *     })
 *
 * Its value surface is a CLOSED enumeration — `PluginRuntimeSchema` in
 * objectstack `packages/spec/src/kernel/manifest.zod.ts` is
 * `z.enum(['node', 'sandbox', 'worker'])` (ADR-0025 §3.6) — so the repair is an
 * enumeration of three members, not a wildcard, and the family leaves
 * `missingPrefixes` (3 → 2). The in-repo authority this test reads is the
 * component's own `RUNTIME_FALLBACK` map, which is what `defaultValue` reads; a
 * fourth tier added to either side fails the test, which is the job the prefix
 * entry used to do.
 *
 * **Repointed by objectui#3846.** When this file was written the map was a
 * `Record< string, string >` and the spec — living in a sibling repo — was
 * unreadable from here, so "the component's own map" was the only authority
 * available. The map is keyed by the spec's `PluginRuntime` now, and the
 * value-level comparison against `PluginRuntimeSchema.options` itself lives in
 * `packages/app-shell/src/console/marketplace/__tests__/plugin-runtime-tier-3846.test.tsx`
 * — app-shell depends on `@objectstack/spec`, `@object-ui/i18n` deliberately does
 * not (its dependencies are `@object-ui/core` + i18next, and a test-only spec
 * dependency would be the first). So this file keeps doing what it can prove
 * from here — that the PACKS and the label map agree, member for member — and
 * additionally pins that the map is keyed by the spec's type rather than by
 * `string`, which is what makes the two files one chain instead of two truths.
 *
 * ## Why a provider is mounted
 *
 * All five components behind these keys — `MarketplacePage`,
 * `MarketplacePackagePage`, `PluginDisclosure`, `CommitTimeline` and
 * `UnpublishedAppBar` — bind `t` from a bare `useObjectTranslation()`. None sits
 * behind a `createSafeTranslation` defaults map, so there is no provider-less
 * path to be green on: without `I18nProvider`, i18next is not the thing
 * answering and the test would describe a binding the console never uses.
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


/** The 40 keys this slice backfilled, grouped as the packs group them. */
const KEYS = [
  // marketplace.action / marketplace.install — the package page's buttons (3)
  'marketplace.action.updateTo',
  'marketplace.install.updateTo',
  'marketplace.install.installedVersion',
  // marketplace.org — MarketplacePage's "Your organization" strip (5)
  'marketplace.org.heading',
  'marketplace.org.install',
  'marketplace.org.installed',
  'marketplace.org.installedBadge',
  'marketplace.org.installing',
  // marketplace.disclosure — the ADR-0025 PD4 pre-install consent panel (11)
  'marketplace.disclosure.containsCode',
  'marketplace.disclosure.reviewed',
  'marketplace.disclosure.unreviewed',
  'marketplace.disclosure.signed',
  'marketplace.disclosure.grantsIntro',
  'marketplace.disclosure.services',
  'marketplace.disclosure.hooks',
  'marketplace.disclosure.network',
  'marketplace.disclosure.fs',
  'marketplace.disclosure.noPermissions',
  'marketplace.disclosure.acknowledge',
  // marketplace.disclosure.runtime — the template-key FAMILY, enumerated (3)
  'marketplace.disclosure.runtime.node',
  'marketplace.disclosure.runtime.sandbox',
  'marketplace.disclosure.runtime.worker',
  // preview.unpublishedBar — the ADR-0045 banner (5)
  'preview.unpublishedBar.message',
  'preview.unpublishedBar.publish',
  'preview.unpublishedBar.publishing',
  'preview.unpublishedBar.published',
  'preview.unpublishedBar.publishFailed',
  // preview.history — the ADR-0067 commit timeline (13)
  'preview.history.button',
  'preview.history.title',
  'preview.history.description',
  'preview.history.loadFailed',
  'preview.history.loading',
  'preview.history.empty',
  'preview.history.revertLabel',
  'preview.history.applyLabel',
  'preview.history.revert',
  'preview.history.items',
  'preview.history.revertAction',
  'preview.history.reverted',
  'preview.history.revertFailed',
] as const;

/** The 37 the guard measured; the other 3 are the prefix family. */
const MEASURED_KEYS = KEYS.filter((k) => !k.startsWith('marketplace.disclosure.runtime.'));

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const DISCLOSURE = 'packages/app-shell/src/console/marketplace/PluginDisclosure.tsx';
const PACKAGE_PAGE = 'packages/app-shell/src/console/marketplace/MarketplacePackagePage.tsx';
const ORG_PAGE = 'packages/app-shell/src/console/marketplace/MarketplacePage.tsx';

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

describe('objectui#3546 slice five — the marketplace and preview namespaces', () => {
  it('covers all ten packs and all forty keys (guards the loops from emptying)', () => {
    expect(LANGS).toHaveLength(10);
    expect(KEYS).toHaveLength(40);
    expect(new Set(KEYS).size).toBe(40);
    // 37 measured missing keys + 3 that came from the prefix family. Splitting
    // the two apart here is what stops a later reader reading "40" off the
    // ratchet, which only ever held 37 + one prefix line.
    expect(MEASURED_KEYS).toHaveLength(37);
    const perArea = KEYS.reduce<Record<string, number>>((acc, k) => {
      const area = k.split('.').slice(0, 2).join('.');
      acc[area] = (acc[area] ?? 0) + 1;
      return acc;
    }, {});
    expect(perArea).toEqual({
      'marketplace.action': 1,
      'marketplace.install': 2,
      'marketplace.org': 5,
      'marketplace.disclosure': 14,
      'preview.unpublishedBar': 5,
      'preview.history': 13,
    });
  });

  it.each(LANGS)('%s defines every key in this slice as a non-empty string', (lang) => {
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
    // sets and placeholder shape, and never looks at what a value SAYS.
    //
    // Set equality against the EMPTY set, not a subset: unlike slice two (12
    // pairs), three (18) and four (1 — French "Assistant"), this slice has no
    // legitimate cognate at all. 0 of 360 pairs is identical to `en`. A first
    // identical pair fails here and must be justified on the line below, the way
    // those slices justified theirs.
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
    // emptiness; this one covers the other way the set could be empty for the
    // wrong reason — a pack that dodged every English-looking word. These four
    // DO embed the loanword and are still not byte-identical to `en`, which is
    // what shows the zero is a real zero and not an avoidance.
    expect(at(builtInLocales.de, 'marketplace.disclosure.hooks')).toBe('Lifecycle-Hooks');
    expect(at(builtInLocales.fr, 'marketplace.disclosure.hooks')).toBe('Hooks de cycle de vie');
    expect(at(builtInLocales.es, 'marketplace.disclosure.runtime.sandbox')).toBe('En sandbox');
    expect(at(builtInLocales.pt, 'marketplace.disclosure.runtime.sandbox')).toBe('Em sandbox');
    for (const [lang, key] of [
      ['de', 'marketplace.disclosure.hooks'],
      ['fr', 'marketplace.disclosure.hooks'],
      ['es', 'marketplace.disclosure.runtime.sandbox'],
      ['pt', 'marketplace.disclosure.runtime.sandbox'],
    ] as const) {
      expect(at(builtInLocales[lang], key)).not.toBe(at(builtInLocales.en, key));
    }
  });

  it('exactly four keys interpolate, and every pack carries the same holes', () => {
    // Unlike slice four (where not one of the 46 strings took an option), four
    // of these do, and the rest must NOT: a translator who invents `{{name}}`
    // renders the braces to the user verbatim, and one who drops `{{version}}`
    // from `install.updateTo` leaves the dropdown saying "Update →" with no
    // version. `all-locales-key-parity` compares placeholder shape too — this
    // states the intended shape by name so a wrong one is legible here.
    //
    // `preview.history.items` is the fourth, and it was the THIRD until
    // objectui#9266: it used to be a bare unit word that `CommitTimeline`
    // preceded with a number of its own, which is why it took no hole. Its
    // `{{count}}` arriving here is that repair, seen from the placeholder side.
    // Deliberately two regexes: a `/g` one is stateful, and reusing it for
    // `.test()` inside a `filter` silently skips every other match through
    // `lastIndex`. (It did, on the first run of this file.)
    const HOLES = /\{\{?\w+\}?\}/g;
    const HAS_HOLE = /\{\{?\w+\}?\}/;
    const INTERPOLATED: Record<string, string> = {
      'marketplace.install.updateTo': '{{version}}',
      'marketplace.install.installedVersion': '{{version}}',
      'marketplace.org.installed': '{{name}}',
      'preview.history.items': '{{count}}',
    };
    expect(KEYS.filter((k) => HAS_HOLE.test(at(builtInLocales.en, k) as string)).sort()).toEqual(
      Object.keys(INTERPOLATED).sort(),
    );
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const holes = ((at(builtInLocales[lang], key) as string).match(HOLES) ?? []).join(',');
        expect(holes, `${lang}.${key}`).toBe(INTERPOLATED[key] ?? '');
      }
    }
  });

  it('the ellipsis, middle-dot and arrow characters follow en in every pack', () => {
    // The packs mirror `en`'s typographic bytes rather than picking their own.
    // Three keys end in U+2026 (the two "…ing" progress labels and the history
    // loader); one carries U+00B7 (following `marketplace.detail.installedV`,
    // "Installed · v{{version}}"); one carries U+2192 (following
    // `marketplace.browseLink`, which every pack including `ar` keeps as "→").
    const ellipsised = KEYS.filter((k) => (at(builtInLocales.en, k) as string).endsWith('…'));
    expect(ellipsised.sort()).toEqual([
      'marketplace.org.installing',
      'preview.history.loading',
      'preview.unpublishedBar.publishing',
    ]);
    for (const lang of LANGS) {
      for (const key of ellipsised) {
        const value = at(builtInLocales[lang], key) as string;
        expect(value.endsWith('…'), `${lang}.${key} = ${value}`).toBe(true);
        expect(value.includes('...'), `${lang}.${key} mixes "..." into an … string`).toBe(false);
      }
      expect(
        (at(builtInLocales[lang], 'marketplace.disclosure.runtime.node') as string).includes(' · '),
        `${lang} runtime.node lost the middle dot`,
      ).toBe(true);
      expect(
        (at(builtInLocales[lang], 'marketplace.install.updateTo') as string).includes(' → '),
        `${lang} install.updateTo lost the arrow`,
      ).toBe(true);
    }
  });

  it('the ja trailing colon follows that pack\'s predicate/noun split, not en', () => {
    // The ja pack is not inconsistent here, it is conditioned: a value that ends
    // in a PREDICATE takes the halfwidth ":" (10 of 12 — the five connectAgent
    // bodies, oauth.consent.willAllow, preview.changes.loadFailed, …), and one
    // that ends in a NOUN label takes the fullwidth "：" (4 of 5 —
    // grid.import.mappingTemplate, auth.verifyEmail.sentTo,
    // preview.changes.detailChangedKeys, …).
    //
    // Both of this slice's ja colons end in a predicate (`要求します`,
    // `読み込めませんでした`), so both are halfwidth. `loadFailed` additionally
    // matches its same-name sibling `preview.changes.loadFailed` byte for byte;
    // `grantsIntro` has no sibling and is decided by the split alone. Written
    // down because the first draft of this file got `grantsIntro` wrong (it had
    // the fullwidth form) and only the census caught it.
    // [objectstack#17147] The sentence changed — "will be granted" became
    // "requests", because the runtime does not yet restrict the package to this
    // list — but the CONDITION this case pins did not: the ja value is still
    // predicate-final (`要求します`), so it still takes the halfwidth colon. ⛔ A
    // future reword that ends this value on a NOUN must flip it to `：` and move
    // it to the other side of the split, not keep the byte and lose the rule.
    expect(at(builtInLocales.ja, 'marketplace.disclosure.grantsIntro')).toBe(
      'このパッケージは次の権限を要求します:',
    );
    expect(at(builtInLocales.ja, 'preview.history.loadFailed')).toBe('履歴を読み込めませんでした:');
    for (const key of ['marketplace.disclosure.grantsIntro', 'preview.history.loadFailed']) {
      expect((at(builtInLocales.ja, key) as string).endsWith('：'), `ja ${key} used the fullwidth colon`).toBe(false);
    }
    // zh goes the other way on the same two strings: that pack writes fullwidth
    // punctuation throughout (165 fullwidth commas, 13 fullwidth trailing colons
    // against 6 halfwidth), and preview.changes.loadFailed zh is fullwidth too.
    for (const key of ['marketplace.disclosure.grantsIntro', 'preview.history.loadFailed']) {
      expect((at(builtInLocales.zh, key) as string).endsWith('：'), `zh ${key} lost the fullwidth colon`).toBe(true);
    }
    // ko has no fullwidth trailing colon anywhere in the pack (16 halfwidth, 0).
    expect((at(builtInLocales.ko, 'marketplace.disclosure.grantsIntro') as string).endsWith(':')).toBe(true);
  });

  describe('the marketplace.disclosure.runtime. template-key family', () => {
    it('is enumerated from the trust-tier enum, not guessed', () => {
      // The family left `missingPrefixes` because all three members now exist.
      // The canonical enum is objectstack spec `PluginRuntimeSchema`
      // (z.enum(['node','sandbox','worker']), ADR-0025 §3.6); since objectui#3846
      // the component's map is KEYED by that enum's type, so this file's job is
      // pack-vs-map parity plus proving the map still answers to the spec, and a
      // fourth tier on either side fails here — the job the prefix entry did.
      const src = sourceOf(DISCLOSURE);
      const block = src.match(/const RUNTIME_FALLBACK: Record<PluginRuntime, string> = \{([^}]+)\}/);
      expect(block, 'RUNTIME_FALLBACK not found — did the map move?').not.toBeNull();
      // The authority, asserted rather than assumed: keyed by the spec's type,
      // imported from the spec (via marketplaceApi's re-export). A local
      // `Record<string, …>` or a hand-written union here would be the drift this
      // family exists to catch.
      expect(src, 'the tier map stopped answering to the spec type').toMatch(
        /import type \{[^}]*\bPluginRuntime\b[^}]*\} from '\.\/marketplaceApi\.js'/,
      );
      const members = [...block![1].matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => m[1]);
      expect(members.sort()).toEqual(['node', 'sandbox', 'worker']);
      const packMembers = Object.keys(at(builtInLocales.en, 'marketplace.disclosure.runtime') as object);
      expect(packMembers.sort()).toEqual(['node', 'sandbox', 'worker']);
      // And the call site really is the template shape this family describes.
      expect(src).toContain('t(`marketplace.disclosure.runtime.${version.runtime}`');
    });

    it("each en value is byte-identical to the component's own fallback label", () => {
      // `RUNTIME_FALLBACK` is the map i18next's `defaultValue` reads. The two
      // paths must not diverge: with the pack present i18next answers, without it
      // the map does, and a user must not be able to tell which one ran.
      const block = sourceOf(DISCLOSURE).match(
        /const RUNTIME_FALLBACK: Record<PluginRuntime, string> = \{([^}]+)\}/,
      );
      const labels = Object.fromEntries(
        [...block![1].matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
      );
      expect(Object.keys(labels)).toHaveLength(3);
      for (const [tier, label] of Object.entries(labels)) {
        expect(
          at(builtInLocales.en, `marketplace.disclosure.runtime.${tier}`),
          `en marketplace.disclosure.runtime.${tier}`,
        ).toBe(label);
      }
    });

    it.each(['en', 'zh'] as const)('%s renders every tier through the real template call', (lang) => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      for (const tier of ['node', 'sandbox', 'worker']) {
        const full = `marketplace.disclosure.runtime.${tier}`;
        const value = result.current.t(full);
        expect(value, `${lang} rendered the raw key for ${full}`).not.toBe(full);
        expect(value, `${lang}.${full}`).toBe(at(builtInLocales[lang], full));
      }
    });

    it('zh tiers are Chinese — the half that was red before the backfill', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('marketplace.disclosure.runtime.node')).toBe('进程内 · 完全信任');
      expect(t('marketplace.disclosure.runtime.sandbox')).toBe('沙箱隔离');
      expect(t('marketplace.disclosure.runtime.worker')).toBe('进程外');
    });
  });

  it("marketplace.org.installed's en value is the template literal's sentence, hole for hole", () => {
    // The one call site whose `defaultValue` is not a static string:
    // `` t('marketplace.org.installed', { defaultValue: `Installed ${pkg.display_name}`, name: pkg.display_name }) ``.
    // A byte comparison is structurally impossible against a template literal, so
    // the equivalence pinned instead is: the literal's static head plus the
    // interpolated identifier === the pack's head plus i18next's hole, driven by
    // the `name` option the site ALREADY passes. Anything else and the toast
    // changes wording the moment the pack starts answering.
    const src = sourceOf(ORG_PAGE);
    const call = src.match(
      /t\('marketplace\.org\.installed',\s*\{\s*defaultValue:\s*`([^`]*)`,\s*name:\s*([\w.]+)\s*\}\)/,
    );
    expect(call, 'the marketplace.org.installed call site moved — recheck the mapping').not.toBeNull();
    const [, template, option] = call!;
    expect(template).toBe('Installed ${pkg.display_name}');
    expect(option).toBe('pkg.display_name');
    expect(at(builtInLocales.en, 'marketplace.org.installed')).toBe('Installed {{name}}');
  });

  it("marketplace.action.updateTo takes no `version` option, because no pack has a hole for one", () => {
    // THE DECISION THIS ASSERTION USED TO FORCE HAS BEEN MADE (objectui#3845).
    //
    // Slice five landed with `MarketplacePackagePage.tsx` passing `version` next
    // to a `defaultValue` of `Update`, which has no hole for it: i18next dropped
    // the argument in silence and the primary button has only ever read a bare
    // "Update". Its sibling `marketplace.install.updateTo` (the environment
    // dropdown, same file) DOES render the version, which is what made the
    // asymmetry legible. The assertion here pinned the inert argument in place
    // so the next reader would have to decide rather than "fix" it silently.
    //
    // The decision was **delete the argument**, not give `en` a `{{version}}`
    // hole: the second would change a string users see today and oblige nine
    // more packs through `scripts/check-i18n-en-drift.mjs`, which is a copy
    // decision about the three-state button (Update / Installed / Installing…)
    // and its width — not something a dead-argument cleanup gets to smuggle in.
    // If that copy decision is ever taken, this assertion is the one to revisit,
    // and `interpolation-parity` in `scripts/check-i18n-call-site-keys.mjs`
    // accepts either resolution as long as the two ends agree.
    //
    // So this now pins the CHOSEN state, both halves of it: the argument is gone
    // from the call site, and no pack pretends there was ever a hole.
    const src = sourceOf(PACKAGE_PAGE);
    expect(src).toContain("t('marketplace.action.updateTo', { defaultValue: 'Update' })");
    expect(src).not.toContain("t('marketplace.action.updateTo', { defaultValue: 'Update', version");
    for (const lang of LANGS) {
      expect(at(builtInLocales[lang], 'marketplace.action.updateTo')).not.toContain('{{');
    }
    // The sister key is untouched, so the asymmetry that made this legible is
    // still visible to whoever takes the copy decision later.
    expect(at(builtInLocales.en, 'marketplace.install.updateTo')).toContain('{{version}}');
    expect(src).toContain("t('marketplace.install.updateTo', { defaultValue: 'Update \\u2192 v{{version}}', version: latestVersion })");
  });

  it('the two revert labels collapse only in the packs with no letter case', () => {
    // `en` distinguishes the row's KIND chip ('revert', lowercase) from the
    // button ('Revert') by case alone. Packs with a bicameral script keep that
    // contrast; `zh` and `ar` have no case and necessarily render one string for
    // both. `ja`/`ko` have no case either and still contrast, because their words
    // differ in kind (noun vs verb) rather than in case. Pinning the exact set
    // stops a reviewer reading the zh/ar duplication as a copy-paste slip.
    const collapsed = LANGS.filter(
      (l) => at(builtInLocales[l], 'preview.history.revert') === at(builtInLocales[l], 'preview.history.revertAction'),
    );
    expect(collapsed.sort()).toEqual(['ar', 'zh']);
    expect(at(builtInLocales.ja, 'preview.history.revert')).toBe('取り消し');
    expect(at(builtInLocales.ja, 'preview.history.revertAction')).toBe('取り消す');
    expect(at(builtInLocales.ko, 'preview.history.revert')).toBe('되돌림');
    expect(at(builtInLocales.ko, 'preview.history.revertAction')).toBe('되돌리기');
  });

  it('the register split between the two namespaces is deliberate, per pack neighbourhood', () => {
    // "Same rule, different answer" (slice two's es ruling). Measured on the
    // packs as they stood before this slice:
    //   zh marketplace uses 你 (3 strings, 0 with 您) — marketplace.subtitle;
    //   zh preview     uses 您 (2 strings, 0 with 你) — preview.draftBar.*.
    //   es marketplace is unanimously usted (9 / 0).
    // So the two namespaces get DIFFERENT second persons in zh, on purpose. The
    // es `preview` neighbourhood is genuinely split before this slice
    // (draftBar.message is tú while draftBar.messageClean / sampleDataBody are
    // usted — filed as a finding), and the tie-break taken is usted, on the
    // strength of home.pendingDrafts.published ("¡Publicado! Sus cambios…"), the
    // structural twin of preview.unpublishedBar.published.
    expect(at(builtInLocales.zh, 'marketplace.org.heading')).toBe('你的组织');
    expect(at(builtInLocales.zh, 'preview.unpublishedBar.message')).toContain('您的用户');
    expect(at(builtInLocales.zh, 'preview.unpublishedBar.published')).toContain('您的用户');
    expect(at(builtInLocales.es, 'marketplace.org.heading')).toBe('Su organización');
    expect(at(builtInLocales.es, 'preview.unpublishedBar.published')).toContain('sus usuarios');
    expect(at(builtInLocales.es, 'preview.unpublishedBar.message')).toContain('Publíquela');
    // ...and the neighbours that ruling was read off are still what it claims.
    expect(at(builtInLocales.zh, 'marketplace.subtitle')).toContain('你的');
    expect(at(builtInLocales.zh, 'preview.draftBar.sampleDataBody')).toContain('您');
    expect(at(builtInLocales.es, 'home.pendingDrafts.published')).toBe('¡Publicado! Sus cambios están activos.');
  });

  it('reused strings are the neighbours own translations, not second renderings', () => {
    // Where this slice's `en` string already existed verbatim elsewhere, the
    // existing row is reused rather than re-translated, so one English string
    // never renders as two different sentences in the same language. These are
    // the pairs; a drift on either side fails here.
    const REUSED: Array<[newKey: string, neighbour: string]> = [
      ['marketplace.action.updateTo', 'form.update'],
      ['marketplace.install.installedVersion', 'marketplace.installedBadge'],
      ['marketplace.org.install', 'marketplace.action.install'],
      ['marketplace.org.installedBadge', 'marketplace.installed'],
      ['marketplace.org.installing', 'marketplace.action.installing'],
      ['preview.unpublishedBar.publish', 'preview.draftBar.publish'],
      ['preview.unpublishedBar.publishing', 'preview.draftBar.publishing'],
      ['preview.unpublishedBar.publishFailed', 'home.pendingDrafts.publishFailed'],
      ['preview.history.button', 'detail.history'],
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
    // The two rows deliberately NOT reused, and why: `marketplace.action.installed`
    // carries the feminine/diacritised agreement with "aplicación" ("Instalada" /
    // "مثبَّت") while the org badge labels a package, and
    // `home.pendingDrafts.publishing` differs from the same-namespace
    // `preview.draftBar.publishing` in ja/ko.
    expect(at(builtInLocales.es, 'marketplace.action.installed')).toBe('Instalada');
    expect(at(builtInLocales.es, 'marketplace.org.installedBadge')).toBe('Instalado');
    expect(at(builtInLocales.ja, 'home.pendingDrafts.publishing')).not.toBe(
      at(builtInLocales.ja, 'preview.unpublishedBar.publishing'),
    );
  });

  it("revertAction borrows the packs' undo VERB even though its en string differs", () => {
    // A different and weaker claim than the table above, stated separately
    // rather than smuggled into it: `en` says "Revert" where `grid.bulk.undo`
    // says "Undo", so these are NOT the same English string and the reuse rule
    // does not apply automatically. What is reused is each pack's existing verb
    // for this user action (撤销 / 取り消す / 되돌리기 / Rückgängig / Annuler /
    // Deshacer / Desfazer / Отменить / تراجع), because no pack has a distinct
    // word for git-style "revert" and coining a second verb for the same button
    // would teach the user two names for one thing. If `en` ever gains a real
    // revert/undo distinction, this assertion is the place that has to be
    // revisited — which is why it says so out loud.
    expect(at(builtInLocales.en, 'preview.history.revertAction')).toBe('Revert');
    expect(at(builtInLocales.en, 'grid.bulk.undo')).toBe('Undo');
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      expect(at(builtInLocales[lang], 'preview.history.revertAction'), `${lang} revertAction`).toBe(
        at(builtInLocales[lang], 'grid.bulk.undo'),
      );
    }
  });

  it('preview.history.items carries its own count, in each pack\'s idiom (objectui#9266)', () => {
    // ## What this assertion used to pin, and why it could not be carried forward
    //
    // It pinned a BARE UNIT WORD per pack — `Elemente`, `элементов`, `عناصر` —
    // reused from `common.itemCount`, because the call site rendered
    // `{c.itemCount}` and then `t('preview.history.items')` beside it and the
    // pack supplied only the noun. That adjacency WAS the defect: the number
    // lived in the component and the noun in the pack, so no translator could
    // make the two agree from the leaf they owned. Measured through a real
    // render — `CommitTimeline.itemCountAgreement-9266` in `app-shell` owns that
    // measurement — six of the ten packs read `1 Elemente` / `1 éléments` /
    // `1 elementos` / `1 itens` / `1 элементов` / `1 عناصر` at a single item,
    // and this pin was green the whole time. ⭐ A pin grown around a defect is
    // indistinguishable from a healthy one, because it is green.
    //
    // ⚠️ It is therefore RE-DERIVED against the new values — not deleted, which
    // would leave the next regression unwatched, and not copied forward, which
    // would nail the defect down a second time.
    //
    // ## What is pinned now
    //
    // Each pack owns the WHOLE phrase, the number's position included. That is
    // the property the old shape could not have, so it is asserted as a
    // property and not only as ten strings.
    const PHRASE: Record<LocaleCode, string> = {
      en: '{{count}} item(s)',
      zh: '{{count}} 项',
      ja: '{{count}} 件',
      ko: '{{count}} 항목',
      de: 'Elemente: {{count}}',
      fr: 'Éléments : {{count}}',
      es: 'Elementos: {{count}}',
      pt: 'Itens: {{count}}',
      ru: 'Элементов: {{count}}',
      ar: 'العناصر: {{count}}',
    };
    for (const lang of LANGS) {
      const value = at(builtInLocales[lang], 'preview.history.items') as string;
      expect(value, `${lang} items`).toBe(PHRASE[lang]);
      expect(value, `${lang} items no longer states its own count`).toContain('{{count}}');
    }

    // The VOCABULARY did not change hands — only the word order did, which is
    // what the old assertion was really protecting. Each pack still uses the
    // noun `common.itemCount` uses; the comparison is case-folded because five
    // packs now OPEN the phrase with that noun, and `ar` takes the definite
    // article a label needs, so there the pack's word is a suffix of it.
    const UNIT: Partial<Record<LocaleCode, string>> = {
      zh: '项',
      ja: '件',
      de: 'Elemente',
      fr: 'éléments',
      es: 'elementos',
      pt: 'itens',
      ru: 'элементов',
      ar: 'عناصر',
    };
    // `ru` and `ar` state that noun inside a count label since objectui#10242,
    // because their `common.itemCount` half serves every count but 1.
    const ITEM_COUNT_LABEL: Partial<Record<LocaleCode, string>> = {
      ru: 'Элементов: {{count}}',
      ar: 'عدد العناصر: {{count}}',
    };
    for (const [lang, unit] of Object.entries(UNIT) as [LocaleCode, string][]) {
      // the premise: that unit really is what common.itemCount uses
      expect(at(builtInLocales[lang], 'common.itemCount'), `${lang} common.itemCount`).toBe(
        ITEM_COUNT_LABEL[lang] ?? `{{count}} ${unit}`,
      );
      expect(
        (at(builtInLocales[lang], 'preview.history.items') as string).toLowerCase(),
        `${lang} stopped using its own word for an item`,
      ).toContain(unit.toLowerCase());
    }
    // `ko` stays the deliberate departure it always was, for a reason that has
    // now EXPIRED and is kept anyway: `common.itemCount` ko is `{{count}}개 항목`
    // — the counter 개 binds to the numeral with no space — and the old call site
    // emitted count + space + unit, so carrying 개 across would have rendered
    // `3 개 항목`. The pack owns the spacing now, so 개 could be adopted; it is
    // not, because `ko` was never one of the broken packs and objectui#9266 does
    // not rewrite copy that reads correctly. A later card may take it.
    expect(at(builtInLocales.ko, 'preview.history.items')).toBe('{{count}} 항목');
    expect(at(builtInLocales.ko, 'common.itemCount')).toBe('{{count}}개 항목');

    // And no pack reintroduced a parenthesised plural marker here. The class is
    // Unicode-aware on purpose (objectui#3866): JS `\w` is [A-Za-z0-9_] with or
    // without `u`, so the ASCII formulation this replaces could not match a
    // Cyrillic, Arabic or CJK letter — the loop was constant-false for zh/ja/ko/
    // ru/ar and only ever guarded de/fr/es/pt. That is inverted from what it is
    // for: ru is a pack that DOES use the notation elsewhere (its app-designer
    // field-count label reads `{{count}} поле(й)`), so the five packs the guard
    // could not see are exactly the five it was written to watch.
    const MARKER = /\([\p{L}]{1,4}\)/u;
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      expect(
        MARKER.test(at(builtInLocales[lang], 'preview.history.items') as string),
        `${lang} items reintroduced a "(s)" marker`,
      ).toBe(false);
    }
    // The counter-example, recorded so the ASCII form cannot come back looking
    // equivalent: the same marker scores present under the class above and
    // absent under the one it replaced.
    expect(MARKER.test('поле(й)')).toBe(true);
    expect(/\(\w{1,4}\)/.test('поле(й)')).toBe(false);
    // Declared boundary, not a gap in the fix: `\p{L}` is letters only and `\(`
    // is the ASCII paren, so a numeric parenthetical (de's own `(Pos1)` key-name
    // gloss) and a full-width pair (U+FF08/U+FF09, ordinary punctuation in 15 zh
    // and 19 ja values) both sit outside this census. Neither spells a plural
    // marker, and this key uses neither in any pack but `en`.
    // `en` is exempt from that loop and still carries `(s)` on purpose: it was
    // not one of the six broken packs, and the marker is the count-invariant
    // device English already had here.
    expect(at(builtInLocales.en, 'preview.history.items')).toBe('{{count}} item(s)');

    // ⛔ NOT a plural family, and that is a measurement rather than a taste.
    // `all-locales-key-parity.test.ts` requires identical key sets across the
    // ten packs, so a family here could only ever be base + `_one` + `_other`:
    // `ru` could have no `_few` and `ar` no `_two`/`_many`, and every category a
    // pack does not spell out falls through to the base key. Against a real
    // i18next instance that shape renders `ru` `2 элементов` and `ar`
    // `11 عناصر` — wrong at the counts a build history shows most often, which
    // is why the phrase above is count-INVARIANT instead. These assertions fail
    // if someone "upgrades" this key and reintroduces that.
    for (const lang of LANGS) {
      for (const suffix of ['_zero', '_one', '_two', '_few', '_many', '_other']) {
        expect(
          at(builtInLocales[lang], `preview.history.items${suffix}`),
          `${lang} items${suffix}`,
        ).toBeUndefined();
      }
    }
    // The categories that make the paragraph above true rather than asserted.
    expect(new Intl.PluralRules('ru').select(2)).toBe('few');
    expect(new Intl.PluralRules('ar').select(11)).toBe('many');
  });

  it('the ratchet actually shrank — no marketplace/preview key is still baselined', () => {
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
    expect(
      Object.keys(baseline.missingKeys).filter(
        (k) => k.startsWith('marketplace.') || k.startsWith('preview.'),
      ),
    ).toEqual([]);
    // 68 before this slice, 37 removed — then slice six (perm + home, 14 keys)
    // took it to 17 and slice seven (the 17-key residue) to ZERO. The counter
    // moved once per slice and only downwards; at zero it stops being "how much
    // is left" and becomes "nothing may be added back".
    expect(Object.keys(baseline.missingKeys).length).toBe(0);
    // The prefix family this slice handled is GONE from the ratchet, and slice
    // seven took the last two (`gantt.linkEnd.`,
    // `organization.invitations.status.`). The `not.toContain(…)` that used to sit
    // below this line was dropped rather than kept: against an empty list it
    // passes because nothing is produced, not because the logic holds. The set
    // equality is the stronger statement and it is not vacuous.
    expect(Object.keys(baseline.missingPrefixes).sort()).toEqual([]);
  });

  describe('through the real binding — bare useObjectTranslation, provider mounted', () => {
    /** One key per component that owns a group of these keys. */
    const SAMPLE: Array<[key: string, owner: string]> = [
      ['marketplace.org.heading', 'MarketplacePage (org strip)'],
      ['marketplace.action.updateTo', 'MarketplacePackagePage (primary button)'],
      ['marketplace.disclosure.containsCode', 'PluginDisclosure'],
      ['marketplace.disclosure.grantsIntro', 'PluginDisclosure (permission groups)'],
      ['preview.unpublishedBar.message', 'UnpublishedAppBar'],
      ['preview.history.title', 'CommitTimeline'],
    ];

    /**
     * A named import from `@object-ui/i18n` whose list carries the bare
     * `useObjectTranslation` — alone or beside other names from the same package
     * (`MarketplacePage` also takes `useDisplayLocale` there, objectui#10331), on
     * one line or several. The name must stand whole and un-aliased: a longer
     * identifier, an `as` rename, a type-only import or another package does not
     * count. The control below pins both directions.
     */
    const IMPORTS_BARE_HOOK =
      /import\s*\{[^}]*(?<![\w$])useObjectTranslation(?![\w$])(?!\s+as\b)[^}]*\}\s*from\s*'@object-ui\/i18n'/;

    it('the import matcher accepts the hook in any named list, and nothing that dropped it', () => {
      for (const ok of [
        "import { useObjectTranslation } from '@object-ui/i18n';",
        "import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';",
        "import {\n  useObjectTranslation,\n  useDisplayLocale,\n} from '@object-ui/i18n';",
      ]) {
        expect(IMPORTS_BARE_HOOK.test(ok), `should accept: ${ok}`).toBe(true);
      }
      for (const dropped of [
        "import { useDisplayLocale } from '@object-ui/i18n';",
        "import { useObjectTranslationSafe } from '@object-ui/i18n';",
        "import { useObjectTranslation as useT } from '@object-ui/i18n';",
        "import type { useObjectTranslation } from '@object-ui/i18n';",
        "import { useObjectTranslation } from '@object-ui/i18n-extra';",
        "import { useObjectTranslation } from './i18n';",
      ]) {
        expect(IMPORTS_BARE_HOOK.test(dropped), `should refuse: ${dropped}`).toBe(false);
      }
    });

    it('all five owning components bind t from a bare useObjectTranslation', () => {
      // The premise of mounting a provider at all. If one of them ever moves
      // behind a `createSafeTranslation` defaults map, the map would answer in
      // provider-less tests and this suite would stop describing the console's
      // path — so assert the binding, do not assume it.
      for (const rel of [
        ORG_PAGE,
        PACKAGE_PAGE,
        DISCLOSURE,
        'packages/app-shell/src/preview/CommitTimeline.tsx',
        'packages/app-shell/src/preview/UnpublishedAppBar.tsx',
      ]) {
        const src = sourceOf(rel);
        const i18nImports = src.match(/import[^;]*from\s*'@object-ui\/i18n'/g) ?? [];
        expect(
          IMPORTS_BARE_HOOK.test(src),
          `${rel} no longer imports a bare useObjectTranslation from '@object-ui/i18n' — its imports from that package: ${JSON.stringify(i18nImports)}`,
        ).toBe(true);
        expect(src, `${rel} gained a defaults-map translator`).not.toContain('createSafeTranslation');
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
      // Pre-fix each of these returned the inline English `defaultValue`, in a zh
      // session. That is the whole defect, and only a non-en assertion sees it.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('marketplace.disclosure.containsCode')).toBe('此软件包包含代码');
      expect(t('marketplace.disclosure.acknowledge')).toBe('我了解此软件包会运行代码，并将获得上述权限。');
      expect(t('preview.history.title')).toBe('构建历史');
      expect(t('preview.unpublishedBar.published')).toBe('已发布！应用现在对您的用户可见。');
    });

    it('en interpolates the version and name holes through the real binding', () => {
      // The three interpolating keys, exercised the way their call sites call
      // them — a pack value with the hole spelled wrongly renders the braces.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('en') });
      const { t } = result.current;
      expect(t('marketplace.install.updateTo', { version: '2.1.0' })).toBe('Update → v2.1.0');
      expect(t('marketplace.install.installedVersion', { version: '1.4.2' })).toBe('Installed v1.4.2');
      expect(t('marketplace.org.installed', { name: 'Acme CRM' })).toBe('Installed Acme CRM');
    });

    it('zh interpolates the same holes — the nine packs kept them', () => {
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('zh') });
      const { t } = result.current;
      expect(t('marketplace.install.updateTo', { version: '2.1.0' })).toBe('更新 → v2.1.0');
      expect(t('marketplace.org.installed', { name: 'Acme CRM' })).toBe('已安装 Acme CRM');
    });

    it.each([
      ['fr', 'preview.history.title', 'Historique des générations'],
      ['de', 'marketplace.disclosure.noPermissions', 'Fordert keine besonderen Berechtigungen an.'],
      ['es', 'preview.history.empty', 'Aún no hay historial para esta aplicación.'],
      ['pt', 'marketplace.disclosure.fs', 'Acesso ao sistema de arquivos'],
      ['ru', 'marketplace.disclosure.unreviewed', 'Ещё не проверено'],
      ['ja', 'preview.history.revertFailed', '取り消しに失敗しました'],
      ['ko', 'marketplace.disclosure.grantsIntro', '이 패키지가 요청하는 권한:'],
      ['ar', 'preview.unpublishedBar.published', 'تم النشر! التطبيق مرئي الآن لمستخدميك.'],
    ])('%s renders a user-visible string from the pack', (lang, key, expected) => {
      // One pinned surface per remaining pack, across four writing systems, so a
      // pack that silently reverts to English is caught by name and not only by
      // the aggregate above.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      expect(result.current.t(key)).toBe(expected);
    });

    it('the ru pack keeps ё, matching its own neighbours', () => {
      // The pack writes ё throughout (`grid.import.undoConfirm` has
      // «обновлённые»), and "Ещё не проверено" is exactly where a backfill
      // would collapse it to е.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ru') });
      expect(result.current.t('marketplace.disclosure.unreviewed')).toContain('Ещё');
    });

    it('the ar pack does not open an RTL sentence with a Latin token', () => {
      // Same rule slices three and four applied. These strings are about code,
      // sandboxes and processes — the places a Latin technical token would most
      // easily have led the sentence and put the bidi boundary in the wrong place.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ar') });
      for (const key of KEYS) {
        const value = result.current.t(key);
        expect(/^[A-Za-z]/.test(value), `${key} starts with a Latin token: ${value}`).toBe(false);
      }
      // The one place a Latin run is unavoidable is the interpolated version, and
      // it stays inside the string rather than leading it.
      expect(result.current.t('marketplace.install.updateTo', { version: '2.1.0' })).toBe('تحديث → v2.1.0');
    });

    it('fr keeps its straight apostrophe and its space before punctuation', () => {
      // The pack writes U+0027 (502 occurrences against 21 U+2019) and puts a
      // narrow space before `:` and `!` (6/0 and 49/0), which is where a
      // copy-paste from `en` shows up first.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('fr') });
      const { t } = result.current;
      expect(t('preview.history.loadFailed')).toBe("Impossible de charger l'historique :");
      expect(t('preview.unpublishedBar.published')).toBe(
        "Publié ! L'application est maintenant visible par vos utilisateurs.",
      );
      for (const key of KEYS) {
        expect((t(key) as string).includes('’'), `fr ${key} used a curly apostrophe`).toBe(false);
      }
    });
  });
});
