/**
 * Locks the fallback semantics of the safe-translation hooks AFTER the
 * try/catch-around-hook removal (rules-of-hooks, objectui#2595/#2596 class):
 * with no I18nProvider mounted, consumers must still get English defaults —
 * via the testKey probe / per-key detection, not via a caught throw.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import i18next from 'i18next';
import { createSafeTranslation, useSafeTranslate } from '../useSafeTranslation';
// objectui#3865's control block mounts a real provider to show the i18next path
// is untouched. `children` goes IN the props object (see provider.test.tsx's
// note on #4040) — the variadic form never satisfies the required prop.
import { I18nProvider } from '../provider';

const DEFAULTS = {
  'detail.test': 'Test Anchor',
  'detail.greeting': 'Hello {{name}}',
  // objectui#3418: the same placeholder twice in one sentence — natural in
  // many locales, and sometimes forced by RTL / agglutinative word order.
  // This is the shape the fallback used to interpolate only once.
  'detail.selection': 'Selected {{count}} of {{count}} items',
  'detail.pair': '{{a}}/{{b}} — {{a}} again, {{b}} again',
};

describe('createSafeTranslation (no I18nProvider)', () => {
  it('falls back to defaults with placeholder interpolation', () => {
    const useT = createSafeTranslation(DEFAULTS, 'detail.test');
    const { result } = renderHook(() => useT());
    expect(result.current.t('detail.greeting', { name: 'Ada' })).toBe('Hello Ada');
    expect(result.current.t('detail.test')).toBe('Test Anchor');
    // Unknown keys pass through as-is (historical contract).
    expect(result.current.t('detail.missing')).toBe('detail.missing');
  });

  // objectui#3418 — the fallback interpolator must agree with i18next, the
  // engine that serves the *provider* path. Every assertion below was checked
  // against a real i18next instance configured the way `createI18n` configures
  // it (`interpolation: { escapeValue: false }`); the expected strings are
  // i18next's own output, not a guess.
  describe('interpolation matches i18next semantics', () => {
    const useT = createSafeTranslation(DEFAULTS, 'detail.test');

    it('replaces EVERY occurrence of a repeated placeholder', () => {
      const { result } = renderHook(() => useT());
      // Was 'Selected 3 of {{count}} items' while the fallback used
      // `String.prototype.replace` with a string needle (first match only),
      // leaking literal braces to users on provider-less hosts.
      expect(result.current.t('detail.selection', { count: 3 })).toBe(
        'Selected 3 of 3 items',
      );
      // Counts are interpolated as strings elsewhere in this repo too — the
      // `String(v)` coercion must keep serving both spellings identically.
      expect(result.current.t('detail.selection', { count: '3' })).toBe(
        'Selected 3 of 3 items',
      );
    });

    it('replaces every occurrence of each of several repeated placeholders', () => {
      const { result } = renderHook(() => useT());
      expect(result.current.t('detail.pair', { a: 'A', b: 'B' })).toBe(
        'A/B — A again, B again',
      );
    });

    it('still replaces a single occurrence exactly once', () => {
      const { result } = renderHook(() => useT());
      expect(result.current.t('detail.greeting', { name: 'Ada' })).toBe('Hello Ada');
    });

    it('leaves a placeholder literal when no matching option is supplied', () => {
      const { result } = renderHook(() => useT());
      // Unchanged behaviour, pinned so the widened replace scope cannot start
      // inventing empty strings. i18next does the same.
      expect(result.current.t('detail.greeting')).toBe('Hello {{name}}');
      expect(result.current.t('detail.greeting', {})).toBe('Hello {{name}}');
      expect(result.current.t('detail.greeting', { other: 'x' })).toBe('Hello {{name}}');
      expect(result.current.t('detail.selection', { unrelated: 1 })).toBe(
        'Selected {{count}} of {{count}} items',
      );
    });

    it('treats the interpolated value literally, including $-patterns', () => {
      const { result } = renderHook(() => useT());
      // `replace`/`replaceAll` interpret `$&`, `` $` ``, `$'` and `$$` in the
      // *replacement* string; i18next does not, and neither does split/join.
      // A record label carrying one of these is reachable today, unlike the
      // repeated-placeholder case.
      expect(result.current.t('detail.greeting', { name: '$& raw' })).toBe(
        'Hello $& raw',
      );
      expect(result.current.t('detail.greeting', { name: 'a$`b' })).toBe('Hello a$`b');
      expect(result.current.t('detail.selection', { count: '$$' })).toBe(
        'Selected $$ of $$ items',
      );
    });
  });

  it('returns a STABLE fallback t across renders (memo-dep friendly)', () => {
    const useT = createSafeTranslation(DEFAULTS, 'detail.test');
    const { result, rerender } = renderHook(() => useT());
    const first = result.current.t;
    rerender();
    expect(result.current.t).toBe(first);
  });
});

// objectui#3865 — the provider-less fallback never read the call site's inline
// `defaultValue`. It looked the key up in its own hand-written defaults table
// and, on a miss, rendered the RAW KEY to the user; `{ defaultValue: 'None' }`
// was then run through the interpolation loop as if it were a `{{defaultValue}}`
// variable, so the English the call site supplied was dropped on the floor.
//
// Measured on `origin/main` @ d2e2caf40 (AST census over all 26
// `createSafeTranslation` hooks): 27 distinct keys reach a hook whose table
// lacks them, 21 of those carrying an inline `defaultValue` — 16 keys in
// `plugin-detail` alone, which is the count the issue reports.
//
// The lookup order below (`defaults[key]` -> `defaultValue` -> `key`) is
// i18next's, verified against a real i18next 26.3.6 instance configured the way
// `createI18n` configures it: a pack value beats an inline `defaultValue`
// (`t('anchor', { defaultValue: 'INLINE' })` === `'Anchor value'`), a miss with
// an inline default returns it (`'INLINE'`), and a miss without one returns the
// key. The defaults table is the pack value's stand-in on this path, so it takes
// the pack's position in that order.
describe('createSafeTranslation honours an inline defaultValue (objectui#3865)', () => {
  const DEFAULTS_3865 = {
    'detail.test': 'Test Anchor',
    'detail.tabled': 'Table value',
    'detail.greeting': 'Hello {{name}}',
    // A value that spells the reserved name as a hole. No string in the repo
    // does this today (grepped: zero `{{defaultValue` in packages/apps/examples),
    // which is what makes the reserved-name rule below cost-free — the pin is
    // here so a future one cannot silently start eating the fallback text.
    'detail.holed': 'Fallback: {{defaultValue}}',
  };
  const useT = createSafeTranslation(DEFAULTS_3865, 'detail.test');

  it('renders a string defaultValue when the key is absent from the table', () => {
    // The issue's exact fixture: `perm.facet.none` is not in plugin-detail's
    // 146-entry table, so a provider-less host used to show `perm.facet.none`.
    const { result } = renderHook(() => useT());
    expect(result.current.t('perm.facet.none', { defaultValue: 'None' })).toBe('None');
  });

  it('prefers the defaults table over an inline defaultValue (order pin)', () => {
    // The table stands in for the pack value on this path, and i18next lets a
    // pack value beat `defaultValue` — measured, not assumed. Reversing these
    // two would make a provider-less host disagree with a provider-mounted one
    // for every key that has both.
    const { result } = renderHook(() => useT());
    expect(result.current.t('detail.tabled', { defaultValue: 'Inline' })).toBe('Table value');
  });

  it('still falls back to the key when neither answers', () => {
    const { result } = renderHook(() => useT());
    // Unchanged historical contract.
    expect(result.current.t('detail.missing')).toBe('detail.missing');
    expect(result.current.t('detail.missing', {})).toBe('detail.missing');
    expect(result.current.t('detail.missing', { name: 'Ada' })).toBe('detail.missing');
    // Non-string defaults are ignored rather than coerced: this function's
    // return type is `string`, and i18next itself declines a `null` default.
    expect(result.current.t('detail.missing', { defaultValue: 42 })).toBe('detail.missing');
    expect(result.current.t('detail.missing', { defaultValue: null })).toBe('detail.missing');
    expect(result.current.t('detail.missing', { defaultValue: undefined })).toBe(
      'detail.missing',
    );
    expect(result.current.t('detail.missing', { defaultValue: { a: 1 } })).toBe(
      'detail.missing',
    );
  });

  it('never splices the fallback into a {{defaultValue}} hole (reserved name)', () => {
    const { result } = renderHook(() => useT());
    // `defaultValue` selects the string; it is not data that fills holes in one.
    expect(result.current.t('detail.holed', { defaultValue: 'Inline' })).toBe(
      'Fallback: {{defaultValue}}',
    );
    // Reserved regardless of type — a non-string default is ignored by the
    // lookup, and must not re-enter through the interpolation loop either.
    expect(result.current.t('detail.holed', { defaultValue: 42 })).toBe(
      'Fallback: {{defaultValue}}',
    );
    // …and when the defaultValue is the string being rendered, it does not
    // substitute into itself.
    expect(result.current.t('detail.missing', { defaultValue: 'x {{defaultValue}} y' })).toBe(
      'x {{defaultValue}} y',
    );
  });

  it('interpolates every OTHER option, including holes inside the defaultValue', () => {
    const { result } = renderHook(() => useT());
    // Control: the interpolation loop still runs, and still runs over the
    // chosen value whichever position of the chain produced it. i18next agrees
    // — `t('missing', { defaultValue: 'Hi {{name}}', name: 'Ada' })` is `'Hi Ada'`.
    expect(
      result.current.t('detail.missing', { defaultValue: 'Hi {{name}}', name: 'Ada' }),
    ).toBe('Hi Ada');
    expect(result.current.t('detail.greeting', { name: 'Ada', defaultValue: 'unused' })).toBe(
      'Hello Ada',
    );
    // objectui#3418's every-occurrence rule is unaffected by the new option.
    expect(
      result.current.t('detail.missing', {
        defaultValue: '{{count}} of {{count}}',
        count: 3,
      }),
    ).toBe('3 of 3');
  });

  it('leaves single-brace placeholders alone (objectui#3512 control)', () => {
    // A different defect of the same helper, deliberately NOT changed here.
    const { result } = renderHook(() => useT());
    expect(result.current.t('detail.missing', { defaultValue: 'Hi {name}', name: 'Ada' })).toBe(
      'Hi {name}',
    );
  });

  it('keeps the fallback t stable across renders', () => {
    const { result, rerender } = renderHook(() => useT());
    const first = result.current.t;
    rerender();
    expect(result.current.t).toBe(first);
  });
});

// Control for objectui#3865: with a provider mounted the helper hands over to
// i18next's own `t` and this change touches nothing. The probe key must be one
// the packs actually define, otherwise the hook stays on the fallback and the
// test would be measuring the branch above.
describe('createSafeTranslation with an I18nProvider (objectui#3865 control)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false, warnMissingKeys: false },
      children,
    });
  const useT = createSafeTranslation({ 'common.save': 'Table value' }, 'common.save');

  it('serves the pack value, not the defaults table', () => {
    const { result } = renderHook(() => useT(), { wrapper });
    expect(result.current.t('common.save')).toBe('Save');
  });

  it('already honoured an inline defaultValue, and still does', () => {
    const { result } = renderHook(() => useT(), { wrapper });
    expect(result.current.t('objectui3865.absentFromEveryPack', { defaultValue: 'Inline' })).toBe(
      'Inline',
    );
  });
});

// objectui#11445 — a count family's `_one` / `_other` rows answer on the
// provider-less path, in i18next's own order. Before that card `fallbackT`
// read `defaults[key]` literally, so a family's suffixed rows were dead and a
// provider-less host could render "1 reply" only through a code-selected
// `xxxCountOne` pair; the card converted those pairs into families. Every
// expectation below is compared against a real i18next instance holding the
// same rows as an `en` pack, so the two paths cannot drift apart unseen.
describe('createSafeTranslation reads a count family the way i18next does (objectui#11445)', () => {
  const FAMILY = {
    'detail.test': 'Test Anchor',
    'detail.replyCount': '{{count}} reply',
    'detail.replyCount_one': '{{count}} reply',
    'detail.replyCount_other': '{{count}} replies',
    // A family with no rows in the table: the base answers, as i18next's would.
    'detail.flat': '{{count}} things',
  };
  const useT = createSafeTranslation(FAMILY, 'detail.test');
  const reference = i18next.createInstance();
  void reference.init({
    resources: { en: { translation: FAMILY } },
    lng: 'en',
    keySeparator: false,
    initAsync: false,
    interpolation: { escapeValue: false },
  });

  it.each([0, 1, 2, 21, 1.5])('count %s selects the slot i18next selects', (count) => {
    const { result } = renderHook(() => useT());
    const want = reference.t('detail.replyCount', { count });
    expect(result.current.t('detail.replyCount', { count })).toBe(want);
  });

  it('one and other read different rows — the matrix above is not vacuous', () => {
    const { result } = renderHook(() => useT());
    expect(result.current.t('detail.replyCount', { count: 1 })).toBe('1 reply');
    expect(result.current.t('detail.replyCount', { count: 3 })).toBe('3 replies');
  });

  it('a string count reads the base row on both paths (i18next selects only for a number)', () => {
    const { result } = renderHook(() => useT());
    expect(reference.t('detail.replyCount', { count: '3' })).toBe('3 reply');
    expect(result.current.t('detail.replyCount', { count: '3' })).toBe('3 reply');
  });

  it('no count, or a key without suffixed rows, reads the base row', () => {
    const { result } = renderHook(() => useT());
    expect(result.current.t('detail.replyCount')).toBe('{{count}} reply');
    expect(result.current.t('detail.flat', { count: 1 })).toBe(reference.t('detail.flat', { count: 1 }));
    expect(result.current.t('detail.flat', { count: 1 })).toBe('1 things');
  });
});

describe('useSafeTranslate (no I18nProvider)', () => {
  it('returns the call-site fallback and supports key-chain form', () => {
    const { result } = renderHook(() => useSafeTranslate());
    expect(result.current('common.total', 'Total')).toBe('Total');
    expect(result.current(['common.total', 'dashboard.total'], 'Total')).toBe('Total');
  });
});
