// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DATE_MACRO_TOKENS,
  DATE_MACRO_PARAM_RE,
  DATE_MACRO_UNITS,
  DATE_MACRO_DESCRIPTIONS,
  DateMacroPlaceholderSchema,
  DateMacroTokenSchema,
  isDateMacroToken,
  isPeriodKeyToken,
  parseDateMacroParam,
  PERIOD_KEY_TOKENS,
  PERIOD_KEY_TOKEN_DESCRIPTIONS,
} from './date-macros.zod';

describe('date macro contract', () => {
  it('every fixed token has a description', () => {
    for (const t of DATE_MACRO_TOKENS) {
      expect(DATE_MACRO_DESCRIPTIONS[t]).toBeTypeOf('string');
    }
  });

  it('fixed tokens pass the token schema', () => {
    for (const t of DATE_MACRO_TOKENS) {
      expect(() => DateMacroTokenSchema.parse(t)).not.toThrow();
    }
  });

  it('parameterised tokens are accepted for every unit and direction', () => {
    for (const unit of DATE_MACRO_UNITS) {
      for (const direction of ['ago', 'from_now'] as const) {
        const token = `7_${unit}s_${direction}`;
        expect(isDateMacroToken(token)).toBe(true);
        const parsed = parseDateMacroParam(token);
        expect(parsed).toEqual({ n: 7, unit, direction });
      }
    }
  });

  it('singular unit form is accepted (1_day_ago, 1_year_from_now)', () => {
    expect(isDateMacroToken('1_day_ago')).toBe(true);
    expect(isDateMacroToken('1_year_from_now')).toBe(true);
  });

  it('rejects unknown tokens', () => {
    for (const bad of [
      '90_days', '90 days ago', 'days_ago_30', 'foo', '{today}',
      'last_century_start', 'now()', '30_decades_ago',
    ]) {
      expect(isDateMacroToken(bad), bad).toBe(false);
    }
  });

  it('placeholder schema accepts {token} and ${token}', () => {
    expect(() => DateMacroPlaceholderSchema.parse('{today}')).not.toThrow();
    expect(() => DateMacroPlaceholderSchema.parse('${30_days_ago}')).not.toThrow();
    expect(() => DateMacroPlaceholderSchema.parse('today')).toThrow();
    expect(() => DateMacroPlaceholderSchema.parse('{not_a_macro}')).toThrow();
  });

  it('regex anchors prevent partial matches', () => {
    expect(DATE_MACRO_PARAM_RE.test('prefix_30_days_ago')).toBe(false);
    expect(DATE_MACRO_PARAM_RE.test('30_days_ago_suffix')).toBe(false);
  });
});

describe('period-key tokens — a sibling list, never a date macro', () => {
  it('is the one token the ruling admits, with a description', () => {
    expect([...PERIOD_KEY_TOKENS]).toEqual(['current_iso_week']);
    for (const t of PERIOD_KEY_TOKENS) {
      expect(isPeriodKeyToken(t)).toBe(true);
      expect(PERIOD_KEY_TOKEN_DESCRIPTIONS[t]).toBeTypeOf('string');
    }
  });

  it('is disjoint from the date macros, so every date-only surface refuses it', () => {
    for (const t of PERIOD_KEY_TOKENS) {
      expect((DATE_MACRO_TOKENS as readonly string[]).includes(t), t).toBe(false);
      expect(isDateMacroToken(t), t).toBe(false);
      expect(DateMacroTokenSchema.safeParse(t).success, t).toBe(false);
      expect(DateMacroPlaceholderSchema.safeParse(`{${t}}`).success, t).toBe(false);
    }
    // Lit control: the same two schemas accept a real date macro.
    expect(DateMacroPlaceholderSchema.safeParse('{current_week_start}').success).toBe(true);
    for (const t of DATE_MACRO_TOKENS) expect(isPeriodKeyToken(t), t).toBe(false);
  });

  it('answers false for near spellings', () => {
    for (const t of ['currentIsoWeek', 'current_week', 'iso_week', 'last_iso_week', 'CURRENT_ISO_WEEK']) {
      expect(isPeriodKeyToken(t), t).toBe(false);
    }
  });
});
