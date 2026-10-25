/**
 * `gantt.quickFilter.*` exists in all ten packs, with the SINGLE-brace
 * placeholder spelling (objectstack#5427).
 *
 * `all-locales-key-parity` already enforces en↔pack key parity generically, so
 * this file is deliberately narrow: it pins the two things that guard could not
 * express on its own.
 *
 *  1. The keys exist in `en` at all. Full parity is symmetric — deleting the
 *     block from *every* pack keeps that suite green while the gantt bar
 *     silently reverts to raw keys.
 *  2. `resultSummary` keeps SINGLE braces. The call site in `ObjectGantt.tsx`
 *     does a literal `.replace('{shown}', …)` rather than i18next
 *     interpolation, so a pack respelled to `{{shown}}` would render the raw
 *     placeholder to the user. The parity guard compares placeholder *shape*
 *     between packs, which stays consistent if someone converts all ten at
 *     once — this asserts the absolute form.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const KEYS = ['all', 'clear', 'empty', 'resultSummary'] as const;

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` would be an implicit-`any`
// index into a `const` map (TS7053) — the `as any` on the pack is about reaching
// an untyped namespace inside it, and could never have covered the index itself.
// Same convention as `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const quickFilterOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as any)?.gantt?.quickFilter as Record<string, string> | undefined;

describe('gantt.quickFilter.* locale coverage (objectstack#5427)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s defines every quick-filter label as a non-empty string', (lang) => {
    const block = quickFilterOf(lang);
    expect(block, `${lang} has no gantt.quickFilter block`).toBeTruthy();
    for (const key of KEYS) {
      expect(typeof block![key], `${lang}.gantt.quickFilter.${key}`).toBe('string');
      expect(block![key].trim().length, `${lang}.gantt.quickFilter.${key} is empty`).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)('%s spells resultSummary with SINGLE braces, not i18next interpolation', (lang) => {
    const summary = quickFilterOf(lang)!.resultSummary;
    expect(summary).toContain('{shown}');
    expect(summary).toContain('{total}');
    expect(summary).not.toContain('{{');
  });

  it('the English pack is the source of the bundled defaults', () => {
    // Guards against the en pack drifting from plugin-gantt's standalone
    // fallback map, which would make a provider-less embed disagree with an
    // `en` session.
    expect(quickFilterOf('en')).toEqual({
      all: 'All',
      clear: 'Clear filters',
      empty: 'No options',
      resultSummary: 'Showing {shown} / {total} tasks',
    });
  });

  it('no pack but zh serves the Chinese copy this issue removed', () => {
    // The defect was Chinese copy served to every locale. A blanket CJK-range
    // scan would false-red on `ja` (its summary is legitimately kanji:
    // "件のタスクを表示"), so this pins the four
    // exact literals that used to be hardcoded in ObjectGantt.tsx instead.
    const REMOVED = ['全部', '清除筛选', '无可选项', '项任务'];
    const leaked = LANGS.filter(
      (l) => l !== 'zh' && KEYS.some((k) => REMOVED.some((s) => quickFilterOf(l)![k].includes(s))),
    );
    expect(leaked).toEqual([]);
  });
});
