/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `validation.formInvalidJoiner` — objectstack#5407.
 *
 * `all-locales-key-parity` guarantees every pack DEFINES the key. It cannot
 * catch the defect this key exists to fix, which was about the VALUE: the
 * renderer hardcoded `、` (U+3001) for every locale, so the English toast read
 * "Subject、Account、Status". A pack that back-fills the entry by copying en's
 * `", "` into zh would satisfy parity and re-break Chinese, so the script
 * families are asserted here by hand.
 *
 * `Intl.ListFormat` would have needed no entries at all and was measured
 * first — it is rejected because its `unit` styles emit an EMPTY separator for
 * zh and ru (worse than the bug) and its `conjunction` styles splice in
 * "and"/"和"/"y", which does not belong in a truncated "A, B, C…" list.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const JOINER = 'formInvalidJoiner';
/** U+3001 IDEOGRAPHIC COMMA — the CJK list separator. */
const CJK_COMMA = '、';
/** U+060C ARABIC COMMA. */
const ARABIC_COMMA = '،';

const validationOf = (lang: string) =>
  (builtInLocales as Record<string, any>)[lang].validation as Record<string, string>;

describe('validation.formInvalidJoiner is declared per locale (objectstack#5407)', () => {
  it('every built-in pack declares a non-empty joiner', () => {
    const langs = Object.keys(builtInLocales);
    expect(langs.length).toBeGreaterThanOrEqual(10);
    for (const lang of langs) {
      const joiner = validationOf(lang)[JOINER];
      expect(typeof joiner, `${lang} joiner type`).toBe('string');
      expect(joiner.length, `${lang} joiner is empty`).toBeGreaterThan(0);
    }
  });

  it('CJK packs enumerate with U+3001', () => {
    for (const lang of ['zh', 'ja']) {
      expect(validationOf(lang)[JOINER], lang).toBe(CJK_COMMA);
    }
  });

  it('Latin-script and Korean packs enumerate with a comma + space', () => {
    // Korean sits here rather than with zh/ja: it uses the ASCII comma.
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ru', 'ko']) {
      expect(validationOf(lang)[JOINER], lang).toBe(', ');
    }
  });

  it('the Arabic pack enumerates with U+060C', () => {
    expect(validationOf('ar')[JOINER]).toBe(`${ARABIC_COMMA} `);
  });

  it('no pack outside zh/ja carries the CJK comma — the exact shipped defect', () => {
    const offenders = Object.keys(builtInLocales).filter(
      (lang) => !['zh', 'ja'].includes(lang) && validationOf(lang)[JOINER].includes(CJK_COMMA),
    );
    expect(offenders).toEqual([]);
  });
});

describe('es validation templates agree in gender (objectstack#5407)', () => {
  // "{{field}} es obligatorio" only agreed when the field label was masculine —
  // "Cuenta es obligatorio" is wrong. The template now supplies its own
  // masculine head noun so the adjective agrees with THAT, whatever the label.
  it('required and unique carry their own head noun', () => {
    const es = validationOf('es');
    expect(es.required).toBe('El campo {{field}} es obligatorio');
    expect(es.unique).toBe('El campo {{field}} debe ser único');
  });

  it('neither template starts with the bare interpolation', () => {
    const es = validationOf('es');
    for (const key of ['required', 'unique']) {
      expect(es[key].startsWith('{{field}}'), `es.validation.${key}`).toBe(false);
    }
  });
});
