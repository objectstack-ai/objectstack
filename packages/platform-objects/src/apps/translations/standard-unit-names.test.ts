// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { STANDARD_UNITS, STANDARD_UNIT_NAMES } from '@objectstack/spec/data';
import { STANDARD_UNIT_NAME_TRANSLATIONS, standardUnitMessageKey, standardUnitMessages } from './standard-unit-names';
import { en, zhCN, jaJP, esES, zhHant, ar, fr, ptBR, ru, de, ko } from './index';

/**
 * ADR-0158 L2 (2A): the platform serves a name for every standard unit code in
 * every bundle locale (objectstack#35490), as `messages.standardUnit<CODE>`.
 */
const BUNDLES = { en, 'zh-CN': zhCN, 'ja-JP': jaJP, 'es-ES': esES, 'zh-Hant': zhHant, ar, fr, 'pt-BR': ptBR, ru, de, ko };
const codes = Object.keys(STANDARD_UNITS);

describe('standard unit names in the platform bundles (ADR-0158 L2, objectstack#35490)', () => {
  it('translates exactly the codes of STANDARD_UNITS in every non-English locale', () => {
    for (const [locale, names] of Object.entries(STANDARD_UNIT_NAME_TRANSLATIONS)) {
      expect(Object.keys(names), locale).toEqual(codes);
      for (const [code, name] of Object.entries(names)) expect(name.trim(), `${locale} ${code}`).not.toBe('');
    }
    expect(Object.keys(STANDARD_UNIT_NAME_TRANSLATIONS).sort()).toEqual(Object.keys(BUNDLES).filter((l) => l !== 'en').sort());
  });

  it('serves every code in every bundle, under a single-segment message key', () => {
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      const messages = bundle.messages ?? {};
      for (const code of codes) {
        const key = standardUnitMessageKey(code);
        expect(key).not.toContain('.');
        expect(messages[key], `${locale} ${code}`).toBeTruthy();
      }
    }
  });

  it('copies the English bundle from the spec base, never re-typed', () => {
    for (const code of codes) expect(en.messages?.[standardUnitMessageKey(code)]).toBe(STANDARD_UNIT_NAMES[code]);
    expect(standardUnitMessages('zh-CN')[standardUnitMessageKey('KGM')]).toBe('千克');
  });
});
