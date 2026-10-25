/**
 * Full key parity across all ten locale packs (objectui#2872 P3).
 *
 * This replaces the four-namespace ratchet added in objectui#2905. That one was
 * deliberately scoped because the eight non-Chinese packs were still ~277 keys
 * behind, and a full assertion would have been a permanently red build rather
 * than a guard. With the backfill complete, the scope restriction is gone and
 * the invariant is simply: **every pack defines every `en` key, and no pack
 * defines a key `en` lacks** — save one computed exception: the plural slot of
 * an `en` family for a CLDR category the pack's OWN language selects and `en`'s
 * does not (`ru` `_few`, `ar` `_two`, …; objectui#11432, the third section below).
 *
 * Why this needs a test at all: `fallbackLng: 'en'` makes both failure modes
 * invisible at runtime.
 *
 *   - A key missing from `de` renders English. That reads as "not translated
 *     yet", not "we lost this" — and the missing-key handler is dev-only, so CI
 *     never sees it.
 *   - A key added to one pack but never to `en` cannot be translated by anyone
 *     else and drifts silently. objectui#2872 part (b) was exactly this, 74 keys
 *     deep, hidden behind a component-private fallback that made English
 *     "happen to" render.
 *
 * The only permitted exception is the outbound-message set below.
 *
 * ## What this test does NOT own
 *
 * Key sets and placeholder shape, and nothing about what a value SAYS. Two
 * sibling gates split the rest, and the boundaries are load-bearing:
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) — a key a `t()`
 *     call site asks for that NO pack defines. Ten packs identically missing it
 *     is full parity, so this file is green on it by construction.
 *   - `scripts/check-i18n-en-drift.mjs` (objectui#3650) — when an `en` VALUE
 *     changes, the nine translations must change in the same PR. This file was
 *     green through objectui#3582 and objectui#3625, correctly: neither touched
 *     a key set or a placeholder. Trying to make it red on those would be asking
 *     a key-set test to judge meaning.
 *
 * That gate skips any key a pack does not define — including the four
 * `OUTBOUND_KEYS` below — precisely because their key sets are this file's
 * business, so the two cannot contradict each other on the same fact.
 *
 * ## The second invariant here: a plural family carries a base key (objectui#3863)
 *
 * Parity across packs is necessary and NOT sufficient, and `detail.showEmptyRelated`
 * was the proof: ten packs, identical key sets, `_one` and `_other` in every one of
 * them — full parity, green — and `ru` still rendered ENGLISH at counts 2-20 and `ar`
 * at 2-99. The mechanism is one level below key sets. i18next asks
 * `Intl.PluralRules` for the ONE suffix a language needs for that number and, when
 * the pack has no such slot, walks `fallbackLng` to `en`. `ru` has four categories
 * (`one/few/many/other`) and `ar` six (`+ zero/two`); no pack in this repo defines
 * `_few`/`_many`/`_two`/`_zero`, so those categories resolved nothing locally.
 *
 * The BASE key (no suffix) was the fix that composed with strict parity then: it is
 * always in i18next's lookup chain, so every category a pack did not enumerate
 * landed on it, in the pack's own language. It kept `ru` and `ar` out of English but
 * not in grammar — one string cannot agree with every count, so `ru` read
 * "Сброс через 3 часов" where Russian needs "часа" (objectui#11432). The third
 * section below therefore requires the explicit slot; the base key stays, for a
 * call made without a count.
 *
 * So this file owns the rule "a plural family must carry a base key" for a measured
 * reason rather than by convenience — the two candidate homes were compared:
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` reads exactly ONE pack
 *     (`collectEnKeys`, `packages/i18n/src/locales/en.ts`). Slot coverage is a
 *     per-pack fact about `ru` and `ar`; an `en`-only instrument cannot state it, and
 *     it only sees families reached from a statically parsable `t()` literal — a
 *     family added to the packs before its call site lands (the objectui#3546
 *     transition, which ran for months) would be invisible. Tightening its
 *     `resolvesLeaf` would also make it report a complete-but-baseless family as
 *     `missing-key`, whose remediation text reads "The key exists in no locale pack" —
 *     false for a family nine packs define.
 *   - Here, the rule is pack-intrinsic: it walks all ten packs' own key sets, needs no
 *     call site to exist, and fails in `pnpm test` at PR time.
 *
 * ## The third invariant: every family carries every category its language selects (objectui#11432)
 *
 * For each pack, the expected slot set of a plural family is COMPUTED, never listed:
 * `Intl.PluralRules(<pack code>).resolvedOptions().pluralCategories` — the same
 * resolver i18next asks — mapped to `_<category>`. Every one of those slots must be a
 * real, non-empty leaf of that pack. A base key standing in for a category does not
 * count; the explicit suffix is required, because a count-invariant string is the
 * only thing a base can hold and the language has a form for that number.
 *
 * What a "family" is, here and in the base-key rule above: any leaf whose name ends
 * in one of i18next's six CLDR suffixes makes its stem a family — exactly how
 * i18next reads the pack, so the rule cannot miss a family by its spelling, and it
 * needs no call site. Families are taken as the union over `en` and the pack, so a
 * new pack or a new family that misses a category goes red here at PR time.
 *
 * ⛔ Out of this rule's reach, by construction: a count label that is NOT a family —
 * one selected in code (`xxxCountOne` / `xxxCountPlural`), or one string at every
 * count — has no category slot to judge. objectui#11445 converted every such label
 * that agrees a word with its number into a family, and
 * `count-families-11445.test.ts` keeps it that way: no `…Plural` key, and every
 * `{{count}}` leaf in a family or named on its count-neutral list with a reason.
 *
 * The rendering half — that i18next really selects each slot written here, through a
 * real instance over the shipped packs — is `plural-categories-11432.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

/**
 * Text the console SENDS to the agent rather than displays. These are absent
 * from the eight non-gate packs ON PURPOSE: the console resolves them from the
 * `en`/`zh` packs by the CONVERSATION's language (objectui#3896), so a value in
 * any other pack is unreachable, and the cloud confirm gate only recognises
 * those two languages anyway — see `outbound-agent-messages.test.ts`, which owns
 * that invariant and asserts it in both directions. Excluded here so the two
 * guards cannot contradict each other.
 */
const OUTBOUND_KEYS = new Set([
  'console.ai.planApproveMessage',
  'console.ai.planApproveDefaultsMessage',
  'console.ai.planAnswerMessage',
  'console.ai.changesConfirmMessage',
]);

function keyPaths(node: unknown, prefix = ''): string[] {
  return node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        keyPaths(v, prefix ? `${prefix}.${k}` : k),
      )
    : [prefix];
}

const keysOf = (pack: unknown) => new Set(keyPaths(pack).filter((k) => !OUTBOUND_KEYS.has(k)));

/**
 * `Object.keys` erases which keys it enumerated, so `builtInLocales[lang]` on a
 * plain `string` is an implicit-`any` index into a `const` map (TS7053) — the
 * suite would then be comparing packs the compiler never confirmed exist. The
 * assertion is derived from the map itself, so a locale added to (or removed
 * from) `builtInLocales` reaches these cases for free, while a typo'd code is a
 * compile error. Same convention as `authRemediation-locale-parity.test.ts` and
 * `inboxBadgeBreakdown-i18n-7233.test.ts` next door.
 */
type LocaleCode = keyof typeof builtInLocales;

/**
 * i18next's plural suffixes, CLDR order. Deliberately the same list as
 * `scripts/check-i18n-call-site-keys.mjs`'s `PLURAL_SUFFIXES`, and asserted equal to
 * `Intl.PluralRules`' own vocabulary below so the two cannot drift apart silently.
 */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

/** Every leaf path of a pack — no `OUTBOUND_KEYS` subtraction: a base key must be a
 *  real leaf of the SAME pack, whatever the parity exemptions are. */
const leavesOf = (pack: unknown) => new Set(keyPaths(pack));

/**
 * The plural families of one pack: base path → the suffixes it defines.
 * A leaf whose name merely ends in one of the suffixes IS a family member — that is
 * exactly how i18next reads it, so a key accidentally named `foo_one` is a real
 * defect here and not a false positive.
 */
function familiesOf(pack: unknown): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const path of leavesOf(pack)) {
    const suffix = PLURAL_SUFFIXES.find((s) => path.endsWith(s) && path.length > s.length);
    if (suffix === undefined) continue;
    const base = path.slice(0, -suffix.length);
    families.set(base, [...(families.get(base) ?? []), suffix]);
  }
  return families;
}

/** The slots a family needs in one pack, computed from the language's own CLDR rules
 *  (objectui#11432) — ⛔ never a hand-kept list. */
const requiredSuffixes = (lang: string): string[] =>
  new Intl.PluralRules(lang).resolvedOptions().pluralCategories.map((c) => `_${c}`);

const EN = keysOf(builtInLocales.en);
const OTHER_LOCALES = (Object.keys(builtInLocales) as LocaleCode[]).filter((l) => l !== 'en');
const EN_FAMILIES = familiesOf(builtInLocales.en);

/**
 * The one kind of key a pack may hold that `en` lacks: the slot of an `en` plural
 * family for a category the pack's OWN language selects (objectui#11432) — `ru`
 * `_few`, `ar` `_two`. Anything else is still a key `en` lacks: a `de` `_many` (de
 * selects no `many`), a `ru` `_two`, or a suffix on a stem that is no `en` family.
 */
function isLocalPluralSlot(lang: LocaleCode, key: string): boolean {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s) && key.length > s.length);
  if (suffix === undefined) return false;
  return EN_FAMILIES.has(key.slice(0, -suffix.length)) && requiredSuffixes(lang).includes(suffix);
}

describe('all locale packs are at full key parity with en (objectui#2872)', () => {
  it('the comparison covers the whole pack — not an empty assertion', () => {
    // If a refactor breaks `keyPaths`, every diff below becomes trivially empty
    // and the suite would pass while asserting nothing.
    expect(EN.size).toBeGreaterThan(2000);
    expect(OTHER_LOCALES).toHaveLength(9);
  });

  it.each(OTHER_LOCALES)('%s defines every en key', (lang) => {
    // Build the pack's key set ONCE. Calling `keysOf` inside the predicate
    // re-walks the whole locale tree per `en` key (~2.5k keys x a full
    // recursive walk), which made this quadratic: ~850-2200ms per locale
    // isolated, and >15s — a timeout, not a parity failure — once full-suite
    // contention slowed each walk down. The sibling assertion below always
    // hoisted it; this one didn't.
    const packKeys = keysOf(builtInLocales[lang]);
    const missing = [...EN].filter((k) => !packKeys.has(k)).sort();
    expect(missing, `${lang} is missing ${missing.length} key(s)`).toEqual([]);
  });

  it.each(OTHER_LOCALES)('%s defines no key that en lacks', (lang) => {
    // The one computed exception is `isLocalPluralSlot` (objectui#11432): the slot of
    // an `en` plural family for a category THIS pack's language selects. It is not a
    // list — `ru` may hold `_few`, `de` may not, and a stem `en` does not pluralise
    // gets no exception at all.
    const extra = [...keysOf(builtInLocales[lang])]
      .filter((k) => !EN.has(k) && !isLocalPluralSlot(lang, k))
      .sort();
    expect(extra, `${lang} has ${extra.length} key(s) absent from en`).toEqual([]);
  });

  it('placeholders match en in every pack', () => {
    // A translation that drops `{{count}}` renders a sentence with a hole in it
    // and no error. `gantt.quickFilter.resultSummary` uses SINGLE braces on
    // purpose — its call site does a literal `.replace('{shown}', …)` instead
    // of i18next interpolation — so both forms are compared.
    //
    // NOTE this comparison is RELATIVE (en vs pack) and cannot see the defect
    // in objectui#4157: every pack agreed with `en` on `{{count}}` while the
    // render call site still did `.replace('{count}', …)`, so the shapes
    // matched and this stayed green while the dialog showed a literal `{2}`.
    // The absolute pack-vs-call-site form is pinned in
    // `gantt-count-interpolation-4157.test.ts`.
    const DOUBLE = /\{\{\w+\}\}/g;
    const SINGLE = /(?<!\{)\{\w+\}(?!\})/g;
    const shape = (v: unknown) =>
      typeof v === 'string'
        ? [...(v.match(DOUBLE) ?? []), ...(v.match(SINGLE) ?? [])].sort().join(',')
        : null;
    const at = (pack: unknown, dotted: string) =>
      dotted.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], pack);

    const mismatches: string[] = [];
    for (const lang of OTHER_LOCALES) {
      for (const key of EN) {
        const a = shape(at(builtInLocales.en, key));
        const b = shape(at(builtInLocales[lang], key));
        if (a !== null && b !== null && a !== b) {
          mismatches.push(`${lang} ${key}: en[${a}] vs ${lang}[${b}]`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

const ALL_LOCALES = Object.keys(builtInLocales) as LocaleCode[];

describe('every plural family carries a base key (objectui#3863)', () => {
  it('the walk finds the families it is meant to judge — not an empty assertion', () => {
    // Without this, deleting every plural family (or breaking `familiesOf`) would
    // make the rule below trivially green. The count is `en`'s and parity carries it
    // to the other nine; it is a floor, not a pin, so a new family does not have to
    // edit this line — only a family DISAPPEARING has to be explained.
    expect(familiesOf(builtInLocales.en).size).toBeGreaterThanOrEqual(5);
    expect(ALL_LOCALES).toHaveLength(10);
    // The suffix list is i18next's, which takes it from `Intl.PluralRules`. Compared
    // as sets against the union of all ten packs' languages so a CLDR category this
    // repo can actually meet cannot be missing from the list above.
    const categories = new Set(
      ALL_LOCALES.flatMap((l) => new Intl.PluralRules(l).resolvedOptions().pluralCategories),
    );
    expect([...categories].map((c) => `_${c}`).sort()).toEqual([...PLURAL_SUFFIXES].sort());
  });

  it.each(ALL_LOCALES)('%s defines the base key of every plural family it has', (lang) => {
    // THE rule. i18next resolves `key_<category>` for the one category the number
    // needs and falls back to the base key, IN THIS PACK, before `fallbackLng`. Since
    // objectui#11432 every category has its own slot (the section below), so with a
    // count the base no longer answers; it stays as the answer to a call made without
    // one, and as the in-language floor a family keeps if a slot is ever lost. Before
    // either rule, a family leaked English at exactly the counts its language meets
    // first (objectui#3863: `ru` 2-20, `ar` 2-99).
    const leaves = leavesOf(builtInLocales[lang]);
    const baseless = [...familiesOf(builtInLocales[lang])]
      .filter(([base]) => !leaves.has(base))
      .map(([base, suffixes]) => `${base} [${suffixes.sort().join(',')}] has no base key`)
      .sort();
    expect(baseless, `${lang}: ${baseless.length} plural family/families with no base key`).toEqual(
      [],
    );
  });

  it('the rule bites — five of the ten packs select categories beyond one/other', () => {
    // Why the per-language slots are not cosmetic, stated as data rather than prose.
    // `en`/`de` and `zh`/`ja`/`ko` are fully served by `_one`/`_other`; these five
    // are the packs that need the extra slots the section below requires, and that
    // the base key alone served — in-language but in one form — before objectui#11432.
    const reachable = ALL_LOCALES.filter((l) =>
      new Intl.PluralRules(l)
        .resolvedOptions()
        .pluralCategories.some((c) => c !== 'one' && c !== 'other'),
    );
    expect(reachable.sort()).toEqual(['ar', 'es', 'fr', 'pt', 'ru']);
    // …and `ru`/`ar` meet them at everyday counts, which is what made the
    // one-form base a user-visible defect rather than a theoretical one:
    // `fr`/`es`/`pt` only use `many` at exact millions.
    expect(new Intl.PluralRules('ru').select(3)).toBe('few');
    expect(new Intl.PluralRules('ru').select(7)).toBe('many');
    expect(new Intl.PluralRules('ar').select(2)).toBe('two');
    expect(new Intl.PluralRules('ar').select(30)).toBe('many');
    expect(new Intl.PluralRules('fr').select(100)).toBe('other');
    expect(new Intl.PluralRules('fr').select(1_000_000)).toBe('many');
  });
});

describe('every plural family carries every CLDR category its language selects (objectui#11432)', () => {
  /** The families judged in one pack: the union of `en`'s and the pack's own. */
  const familiesFor = (lang: LocaleCode) =>
    new Set([...EN_FAMILIES.keys(), ...familiesOf(builtInLocales[lang]).keys()]);

  it('the walk judges real families and real slots — not an empty assertion', () => {
    // Floors, not pins: a new family raises them for free; only a family or a pack
    // DISAPPEARING has to be explained.
    expect(EN_FAMILIES.size).toBeGreaterThanOrEqual(5);
    expect(ALL_LOCALES).toHaveLength(10);
    const judged = ALL_LOCALES.reduce(
      (n, l) => n + familiesFor(l).size * requiredSuffixes(l).length,
      0,
    );
    expect(judged).toBeGreaterThan(EN_FAMILIES.size * ALL_LOCALES.length);
    // The expectation really is computed per language: `ru` and `ar` need more slots
    // than `en`, `zh` fewer. A `requiredSuffixes` that returned a constant would make
    // this file a hand-kept list in disguise.
    expect(requiredSuffixes('en')).toEqual(['_one', '_other']);
    expect(requiredSuffixes('zh')).toEqual(['_other']);
    expect(requiredSuffixes('ru').sort()).toEqual(['_few', '_many', '_one', '_other']);
    expect(requiredSuffixes('ar')).toHaveLength(6);
    // i18next ordinal families (`_ordinal_one`, …) follow `{ type: 'ordinal' }` rules,
    // which this walk does not compute. None exists; the first one must extend the
    // rule rather than be judged by cardinal categories.
    for (const lang of ALL_LOCALES) {
      expect([...leavesOf(builtInLocales[lang])].filter((k) => k.includes('_ordinal_'))).toEqual([]);
    }
  });

  it.each(ALL_LOCALES)('%s spells out every category its language selects, in every family', (lang) => {
    // THE rule. The base key does not count: it holds one string, and the language
    // has a form for each category. So the explicit suffix is required — a family
    // that relies on its base for a category goes red here and names the slot.
    const leaves = leavesOf(builtInLocales[lang]);
    const pack = builtInLocales[lang] as unknown;
    const at = (dotted: string) =>
      dotted.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], pack);
    const missing: string[] = [];
    for (const base of familiesFor(lang)) {
      for (const suffix of requiredSuffixes(lang)) {
        const slot = `${base}${suffix}`;
        const value = at(slot);
        if (!leaves.has(slot) || typeof value !== 'string' || value.trim() === '') missing.push(slot);
      }
    }
    expect(missing.sort(), `${lang}: ${missing.length} plural slot(s) missing`).toEqual([]);
  });

  it('every slot a pack adds beyond en interpolates the family\'s en placeholders', () => {
    // The parity placeholder check walks `en`'s keys, so it never reads a `ru` `_few`
    // or an `ar` `_two`. This is that check for the slots only a pack holds: same
    // holes as the family's `en` `_other` — a form that drops `{{count}}` renders a
    // sentence with the number missing, one that invents a hole renders braces.
    const HOLES = /\{\{\w+\}\}/g;
    const shape = (v: unknown) => (typeof v === 'string' ? (v.match(HOLES) ?? []).sort().join(',') : null);
    const at = (pack: unknown, dotted: string) =>
      dotted.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], pack);
    const mismatches: string[] = [];
    let compared = 0;
    for (const lang of OTHER_LOCALES) {
      for (const key of leavesOf(builtInLocales[lang])) {
        if (EN.has(key) || !isLocalPluralSlot(lang, key)) continue;
        const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s))!;
        const want = shape(at(builtInLocales.en, `${key.slice(0, -suffix.length)}_other`));
        const got = shape(at(builtInLocales[lang], key));
        compared += 1;
        if (want !== got) mismatches.push(`${lang} ${key}: en _other[${want}] vs ${lang}[${got}]`);
      }
    }
    expect(compared, 'no pack-only plural slot was compared').toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });

  it('the exemption is computed, not open — a slot the language does not select stays an extra', () => {
    // The parity exception above must not widen into "any plural suffix is fine".
    // `de` selects no `many`, `ru` no `two`, and `perm.facet.none` is no family.
    expect(isLocalPluralSlot('ru', 'console.ai.usage.resetsWeeklyHours_few')).toBe(true);
    expect(isLocalPluralSlot('ar', 'detail.fileCount_two')).toBe(true);
    expect(isLocalPluralSlot('de', 'detail.fileCount_many')).toBe(false);
    expect(isLocalPluralSlot('ru', 'detail.fileCount_two')).toBe(false);
    expect(isLocalPluralSlot('ru', 'perm.facet.none_few')).toBe(false);
  });
});
