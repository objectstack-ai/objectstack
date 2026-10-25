/**
 * `view.readonlyTooltip` carries `en`'s CURRENT read-only meaning in all ten
 * packs — not the retired "duplicate to customize" workflow (objectui#3625).
 *
 * ## Why this needs its own criterion
 *
 * objectui#3582 was the same stale sentence in a neighbouring namespace, and
 * two cheap criteria could see it: the eight packs stored the *English*
 * string, so "value equals en" and "non-Latin pack holds pure ASCII" both
 * fired. Neither can see this key. The eight values were **idiomatic
 * translations** — ja in Japanese, ru in Cyrillic, ar in Arabic — of a
 * sentence `en` had already abandoned. Nothing about their *form* was wrong;
 * their *meaning* was. So the assertions below test meaning, in two
 * directions at once:
 *
 *   - RETIRED: no pack may name the duplicate/copy workflow, in that pack's
 *     own language (stems measured from the values that were actually there
 *     before this fix, not guessed — es/pt spell it `duplique`, so the stem is
 *     `dupliqu`; a `duplic` stem would have missed both).
 *   - ANCHORS: every pack must positively carry all three pieces of `en`'s
 *     sentence — "system view", "defined in code", "read-only". Without this
 *     half the RETIRED check passes trivially on an empty or gutted string.
 *
 * ## What this file does NOT claim
 *
 * The distinctness and native-script checks below were **green before this
 * fix too** — the eight stale values were already distinct, already in their
 * own scripts. They are kept because they guard a different failure (pasting
 * one language into another), not because they detect this defect. Saying so
 * plainly is the point: the reason objectui#3625 survived objectui#3582's
 * sweep is precisely that every form-level criterion was green.
 *
 * ## Scope, and why it is narrow
 *
 * The RETIRED scan is scoped to this one key on purpose, exactly as
 * objectui#3582's file scoped its own. `view.duplicateView` ("Duplicar
 * vista" in es) is a legitimate Duplicate-view action in the SAME namespace;
 * a pack-wide stem scan would red on it. The stale-copy invariant is per-key
 * by nature and cannot be generalised into a repo-wide gate — see
 * objectui#3625's closing note on what the missing gate actually is
 * ("when `en` is reworded, the nine translation packs follow in the same PR").
 *
 * Companion file: `objectView-value-language-3582.test.ts` pins
 * `console.objectView.systemViewReadonly` / `.expandToPage`. It is left
 * untouched — its comment already names this key as objectui#3625's, and
 * keeping the two pin surfaces in separate files means a red tells you which
 * of the two defects came back.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const tooltipOf = (lang: LocaleCode) => (builtInLocales[lang] as any)?.view?.readonlyTooltip as string;
const sysViewOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as any)?.console?.objectView?.systemViewReadonly as string;

/** `en`'s current copy, and the sentence it retired. Neither may appear elsewhere. */
const EN_CURRENT = 'System view — defined in code, read-only.';
const EN_RETIRED_SPELLINGS = [
  'System view — duplicate to customize.',
  'System view - duplicate to customize.',
];

/**
 * The retired workflow, per pack, in that pack's own language. Every stem here
 * was read off the value the pack actually held on `origin/main` before this
 * fix; the ones for en/zh are defensive (those two were already correct).
 */
const RETIRED: Record<string, RegExp> = {
  en: /duplicate|copy/i,
  zh: /复制|复刻|拷贝/,
  ja: /複製|コピー/,
  ko: /복제|복사/,
  de: /duplizier|kopier/i,
  fr: /dupliqu|duplic|copi/i,
  es: /dupliqu|duplic|copi/i,
  pt: /dupliqu|duplic|copi/i,
  ru: /копир|скопир/i,
  ar: /نسخ|انسخ/,
};

/**
 * The three semantic pieces of `en`'s sentence, in each pack's own words.
 * Every term is lifted from a neighbouring key in the SAME pack — see the PR's
 * sourcing table — so this doubles as a check that the translation stayed
 * inside the vocabulary the pack already uses for these concepts.
 */
const ANCHORS: Record<string, { systemView: RegExp; inCode: RegExp; readOnly: RegExp }> = {
  en: { systemView: /System view/i, inCode: /code/i, readOnly: /read-only/i },
  zh: { systemView: /系统视图/, inCode: /代码/, readOnly: /只读/ },
  ja: { systemView: /システムビュー/, inCode: /コード/, readOnly: /読み取り専用/ },
  ko: { systemView: /시스템 보기/, inCode: /코드/, readOnly: /읽기 전용/ },
  de: { systemView: /Systemansicht/i, inCode: /Code/i, readOnly: /schreibgeschützt/i },
  fr: { systemView: /Vue système/i, inCode: /code/i, readOnly: /lecture seule/i },
  es: { systemView: /Vista del sistema/i, inCode: /código/i, readOnly: /solo lectura/i },
  pt: { systemView: /Exibição do sistema/i, inCode: /código/i, readOnly: /somente leitura/i },
  ru: { systemView: /Системное представление/i, inCode: /код/i, readOnly: /чтени/i },
  ar: { systemView: /عرض النظام/, inCode: /كود/, readOnly: /قراءة/ },
};

/** Packs where "is this value written in the pack's language?" is decidable. */
// Keyed by locale, not by bare `string`: these five packs are the non-Latin
// subset, and `Partial` says so — while `Object.keys` below is asserted back to
// `LocaleCode[]`, which `entries`/`keys` erase by design. A typo'd pack name is
// now a compile error rather than a case that silently never runs.
const NATIVE_SCRIPT: Partial<Record<LocaleCode, RegExp>> = {
  zh: /\p{Script=Han}/u,
  ja: /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
};

describe('view.readonlyTooltip semantic coverage (objectui#3625)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
    expect(Object.keys(RETIRED).sort()).toEqual([...LANGS].sort());
    expect(Object.keys(ANCHORS).sort()).toEqual([...LANGS].sort());
  });

  it.each(LANGS)('%s defines view.readonlyTooltip as a non-empty string', (lang) => {
    const value = tooltipOf(lang);
    expect(typeof value, `${lang}.view.readonlyTooltip`).toBe('string');
    expect(value.trim().length, `${lang}.view.readonlyTooltip is empty`).toBeGreaterThan(0);
  });

  it('the en pack still says read-only — the meaning the nine were translated against', () => {
    // The tripwire objectui#3625 was missing. `en` was reworded once already
    // and nine packs kept the old sentence for releases. If this literal
    // changes again this line goes red in the SAME PR that reworded it, which
    // forces the nine to be revisited then rather than discovered later by
    // someone reading a tooltip in Japanese.
    expect(tooltipOf('en')).toBe(EN_CURRENT);
  });

  it('no pack but en serves any English spelling of the tooltip', () => {
    // The objectui#3582 failure mode applied to this key: current copy pasted
    // verbatim, or the retired English sentence resurrected.
    const english = LANGS.filter(
      (l) => l !== 'en' && [EN_CURRENT, ...EN_RETIRED_SPELLINGS].includes(tooltipOf(l)),
    );
    expect(english, `packs serving English: ${english.join(', ')}`).toEqual([]);
  });

  it('no pack names the retired duplicate-to-customize workflow', () => {
    // THE assertion for objectui#3625. Red on all eight before the fix; the
    // form-level checks in this file were green on all eight.
    const leaked = LANGS.filter((l) => RETIRED[l].test(tooltipOf(l)));
    expect(leaked, `packs still offering duplicate-to-customize: ${leaked.join(', ')}`).toEqual([]);
  });

  it.each(LANGS)('%s carries all three pieces of the read-only sentence', (lang) => {
    // Guards the empty green: without this, deleting a value outright would
    // satisfy the negative check above.
    const value = tooltipOf(lang);
    const { systemView, inCode, readOnly } = ANCHORS[lang];
    expect(systemView.test(value), `${lang} tooltip lost "system view": ${value}`).toBe(true);
    expect(inCode.test(value), `${lang} tooltip lost "defined in code": ${value}`).toBe(true);
    expect(readOnly.test(value), `${lang} tooltip lost "read-only": ${value}`).toBe(true);
  });

  it.each(Object.keys(NATIVE_SCRIPT) as LocaleCode[])('%s writes the tooltip in its own script', (lang) => {
    // Green before this fix as well — the stale values were properly
    // translated Japanese/Korean/Russian/Arabic. Kept as a guard against a
    // future paste, not as evidence for objectui#3625.
    expect(
      NATIVE_SCRIPT[lang]!.test(tooltipOf(lang)),
      `${lang} tooltip has no native script`,
    ).toBe(true);
  });

  it('all ten packs differ from one another', () => {
    // Also green before this fix (10/10 distinct even while eight were stale),
    // for the same reason: eight idiomatic translations of a wrong sentence
    // are still ten different strings. It guards cross-pack copy-paste only.
    const values = LANGS.map(tooltipOf);
    expect(new Set(values).size, 'view.readonlyTooltip has duplicate values across packs').toBe(
      LANGS.length,
    );
  });

  it('de is the only pack where this tooltip reads identically to console.objectView.systemViewReadonly', () => {
    // A record of fact, not a rule. `en` distinguishes the two keys only by
    // where the dash falls ("System view — defined in code, read-only." vs
    // "System view defined in code — read-only."), which is a distinction most
    // languages cannot carry. German lands on one sentence for both, and that
    // is fine — objectui#3582's PR set the same precedent deliberately by
    // aligning `console.objectView.expandToPage` byte-for-byte with
    // `detail.openAsFullPage` in every pack. Pinned so that a future
    // translation edit which changes WHICH packs collide surfaces for a human
    // to look at; relax this line with a note if that happens legitimately.
    const collide = LANGS.filter((l) => tooltipOf(l) === sysViewOf(l));
    expect(collide).toEqual(['de']);
  });
});
