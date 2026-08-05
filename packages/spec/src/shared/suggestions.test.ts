import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  findClosestMatches,
  suggestFieldType,
  formatSuggestion,
} from './suggestions.zod';

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('text', 'text')).toBe(0);
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('should return length of other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('should compute correct distances', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('text', 'textarea')).toBe(4);
    expect(levenshteinDistance('select', 'selct')).toBe(1);
  });

  it('should handle single character differences', () => {
    expect(levenshteinDistance('text', 'test')).toBe(1);
    expect(levenshteinDistance('date', 'data')).toBe(1);
  });
});

describe('findClosestMatches', () => {
  const candidates = ['text', 'textarea', 'number', 'boolean', 'select', 'lookup'];

  it('should find close matches', () => {
    const matches = findClosestMatches('texta', candidates);
    expect(matches).toContain('text');
  });

  it('should return empty array for very different strings', () => {
    const matches = findClosestMatches('xyzzy_completely_different', candidates, 3);
    expect(matches).toEqual([]);
  });

  it('should normalize input (lowercase, hyphens to underscores)', () => {
    const matches = findClosestMatches('Texta', candidates);
    expect(matches).toContain('text');
  });

  it('should respect maxResults', () => {
    const matches = findClosestMatches('te', candidates, 5, 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('should sort by distance (closest first)', () => {
    const matches = findClosestMatches('selec', candidates);
    expect(matches[0]).toBe('select');
  });
});

describe('camelCase parity in the distance fallback (#4990)', () => {
  // The budget `strictUnknownKeyError` actually spends. Reproduced rather than
  // imported because the point of these tests is the INTERACTION between the
  // budget and the scoring — a test that shared the constant could not show it.
  const budget = (key: string) => Math.max(2, Math.floor(key.length / 3));
  const suggest = (input: string, cands: readonly string[]): string | undefined =>
    findClosestMatches(input, cands, budget(input), 1)[0];

  it('re-measures the four rows the issue tabled, at their real budgets', () => {
    // Before the fix, row 1 was `[]`: `hideOn` scored 3 against a budget of 2,
    // because `hiddenOn`'s capital O was charged to the author as an edit.
    expect(suggest('hideOn', ['hiddenOn'])).toBe('hiddenOn');
    expect(suggest('hiddenon', ['hiddenOn'])).toBe('hiddenOn');
    expect(suggest('hiddenOnn', ['hiddenOn'])).toBe('hiddenOn');
    expect(suggest('maxLenght', ['maxLength'])).toBe('maxLength');
  });

  // THE INVARIANT, and the substance of #4990.
  //
  // Stating it took one correction worth recording. The issue phrases it as
  // "the all-lowercase form must not get a better suggestion than the correctly
  // cased one", and the obvious encoding — compare `suggest(T)` with
  // `suggest(T.toLowerCase())` — is VACUOUS against the buggy code, which
  // lowercased the input as its first act: both calls collapsed to the same
  // one and agreed trivially, on 462 probes, while the bug was fully present.
  //
  // The asymmetry is not between two spellings of the INPUT. It is between two
  // spellings of the DECLARED KEY: the identical typo was judged one way
  // against `hiddenOn` and another against `hiddenon`, because only the
  // candidate kept its capitals and each one cost the author an edit. That is
  // the title's "systematically weak on camelCase keys", and it is what this
  // pins: a key's capitalisation must not change the verdict on a typo.
  //
  // Measured against the pre-fix implementation, this corpus breaks parity 55
  // times in 462 probes — in BOTH directions (`bordeRradius` resolved against
  // camelCase `borderRadius` but not against flat `borderradius`, the capital
  // paying off by luck). Case must decide nothing either way.
  it('judges a typo the same whether the declared key is camelCase or flat', () => {
    const corpus = [
      'hiddenOn', 'maxLength', 'iteratorVariable', 'primaryField', 'defaultValue',
      'borderRadius', 'customVars', 'referenceTo', 'maxIterations', 'displayName',
      'onDelete', 'sortOrder', 'isRequired', 'allowedPaths', 'triggerPhrases',
      'xAxis', 'viewName', 'pluginId',
    ];
    const failures: string[] = [];
    for (const key of corpus) {
      const flat = key.toLowerCase();
      // How an author actually mistypes: dropped character, swapped pair,
      // dropped pair — spelled with the camelCase they were aiming for.
      const variants = new Set<string>();
      for (let i = 1; i < key.length; i++) variants.add(key.slice(0, i) + key.slice(i + 1));
      for (let i = 1; i < key.length - 1; i++) {
        variants.add(key.slice(0, i) + key[i + 1] + key[i] + key.slice(i + 2));
        variants.add(key.slice(0, i) + key.slice(i + 2));
      }
      variants.delete(key);
      for (const typo of variants) {
        // Skip the degenerate comparison: when the typo lowercases to the flat
        // key itself (`bordeRradius` → `borderradius`), the flat side is the
        // author echoing their own string and is correctly refused, while the
        // camelCase side is a real — and maximally confident — suggestion.
        // That asymmetry is the self-match rule, not a case-parity break.
        if (typo.toLowerCase() === flat) continue;
        const againstCamel = suggest(typo, [key]) === key;
        const againstFlat = suggest(typo.toLowerCase(), [flat]) === flat;
        if (againstCamel !== againstFlat) {
          failures.push(
            `${key}: '${typo}' resolves=${againstCamel} but flat '${flat}' resolves=${againstFlat}`,
          );
        }
      }
    }
    expect(
      failures,
      `a declared key's capitalisation changed the verdict:\n${failures.join('\n')}`,
    ).toEqual([]);
  });

  // The issue's own headline comparison, kept as a named case because it is the
  // sentence the bug was reported in: the author who wrote the key ALL LOWERCASE
  // was served better than the author who cased it right and slipped two letters.
  it('serves the correctly-cased author no worse than the all-lowercase one', () => {
    expect(suggest('hiddenon', ['hiddenOn'])).toBe('hiddenOn'); // was already fine
    expect(suggest('hideOn', ['hiddenOn'])).toBe('hiddenOn');   // was `undefined`
  });

  it('suggests a candidate that differs from the input ONLY in case', () => {
    // Folding both sides makes such a candidate distance 0, and the old
    // `distance > 0` filter discarded it along with the true self-match. It is
    // the single most confident suggestion the fallback can make.
    expect(suggest('hiddenon', ['hiddenOn'])).toBe('hiddenOn');
    expect(suggest('MAXLENGTH', ['maxLength'])).toBe('maxLength');
    expect(suggest('reference_to', ['referenceTo'])).toBe('referenceTo');
  });

  it('still refuses to echo back the exact string the author typed', () => {
    expect(findClosestMatches('maxLength', ['maxLength', 'minLength'], 3, 3))
      .not.toContain('maxLength');
  });

  it('breaks a folded tie on the author\'s own capitalisation', () => {
    // `allowedaPths` is equidistant from `allowedPaths` and `allowedAPIs` once
    // case is folded away. The capitals the author did type are the only
    // evidence left, and they point at `allowedPaths`.
    expect(suggest('allowedaPths', ['allowedAPIs', 'allowedPaths'])).toBe('allowedPaths');
  });

  it('leaves genuinely unrelated keys unsuggested — the fold is not a widening', () => {
    const keys = ['hiddenOn', 'columns', 'order', 'breakpoint'];
    expect(suggest('workflows', keys)).toBeUndefined();
    expect(suggest('responsiveStyles', keys)).toBeUndefined();
  });
});

describe('suggestFieldType', () => {
  it('should suggest via alias map for common alternatives', () => {
    expect(suggestFieldType('string')).toEqual(['text']);
    expect(suggestFieldType('String')).toEqual(['text']);
    expect(suggestFieldType('int')).toEqual(['number']);
    expect(suggestFieldType('integer')).toEqual(['number']);
    expect(suggestFieldType('bool')).toEqual(['boolean']);
    expect(suggestFieldType('checkbox')).toEqual(['boolean']);
    expect(suggestFieldType('dropdown')).toEqual(['select']);
    expect(suggestFieldType('picklist')).toEqual(['select']);
    expect(suggestFieldType('reference')).toEqual(['lookup']);
    expect(suggestFieldType('timestamp')).toEqual(['datetime']);
  });

  it('should suggest via alias for common typos', () => {
    expect(suggestFieldType('text_area')).toEqual(['textarea']);
    expect(suggestFieldType('rich_text')).toEqual(['richtext']);
    expect(suggestFieldType('multi_select')).toEqual(['multiselect']);
    expect(suggestFieldType('auto_number')).toEqual(['autonumber']);
  });

  it('should suggest via alias for abbreviations', () => {
    expect(suggestFieldType('md')).toEqual(['markdown']);
    expect(suggestFieldType('img')).toEqual(['image']);
    expect(suggestFieldType('fk')).toEqual(['lookup']);
    expect(suggestFieldType('ref')).toEqual(['lookup']);
  });

  it('should fall back to fuzzy matching for unknown typos', () => {
    const suggestions = suggestFieldType('textt');
    expect(suggestions).toContain('text');
  });

  it('should return empty for completely unrelated input', () => {
    const suggestions = suggestFieldType('xyzzy_absolutely_nothing');
    expect(suggestions).toEqual([]);
  });

  it('should handle hyphenated input', () => {
    expect(suggestFieldType('text-area')).toEqual(['textarea']);
  });

  it('should handle space-separated input', () => {
    expect(suggestFieldType('text area')).toEqual(['textarea']);
  });
});

describe('formatSuggestion', () => {
  it('should return empty string for no suggestions', () => {
    expect(formatSuggestion([])).toBe('');
  });

  it('should format single suggestion', () => {
    expect(formatSuggestion(['text'])).toBe("Did you mean 'text'?");
  });

  it('should format multiple suggestions', () => {
    const result = formatSuggestion(['text', 'textarea']);
    expect(result).toBe("Did you mean one of: 'text', 'textarea'?");
  });
});
