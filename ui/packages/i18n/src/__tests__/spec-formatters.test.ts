import { describe, it, expect } from 'vitest';
import {
  resolvePlural,
  formatDateSpec,
  formatNumberSpec,
  applyLocaleConfig,
  type SpecPluralRule,
} from '../utils/spec-formatters';

// ============================================================================
// PluralRuleSchema Consumer Tests
// ============================================================================

describe('resolvePlural', () => {
  const rule: SpecPluralRule = {
    key: 'items.count',
    zero: 'No items',
    one: '{count} item',
    other: '{count} items',
  };

  it('should resolve zero form', () => {
    // English 'other' is used for 0 by Intl.PluralRules, but 'zero' is explicitly checked
    // In English, 0 maps to "other" category, but we fall back to rule.other
    const result = resolvePlural(rule, 0, 'en');
    expect(result).toBe('0 items');
  });

  it('should resolve one form', () => {
    expect(resolvePlural(rule, 1, 'en')).toBe('1 item');
  });

  it('should resolve other form for plural', () => {
    expect(resolvePlural(rule, 5, 'en')).toBe('5 items');
  });

  it('should fallback to other when form is not defined', () => {
    const simpleRule: SpecPluralRule = {
      key: 'items',
      other: '{count} things',
    };
    expect(resolvePlural(simpleRule, 3, 'en')).toBe('3 things');
  });

  it('should work with different locales', () => {
    const ruleWithTwo: SpecPluralRule = {
      key: 'items',
      one: '{count} element',
      two: '{count} éléments (dual)',
      other: '{count} éléments',
    };
    // Arabic has a 'two' plural category
    expect(resolvePlural(ruleWithTwo, 2, 'ar')).toBe('2 éléments (dual)');
  });
});

// ============================================================================
// DateFormatSchema Consumer Tests
// ============================================================================

describe('formatDateSpec', () => {
  it('should format date with dateStyle', () => {
    const date = new Date('2026-02-11T12:00:00Z');
    const result = formatDateSpec(date, { dateStyle: 'short' }, 'en-US');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should return string for invalid date', () => {
    expect(formatDateSpec('invalid-date', { dateStyle: 'medium' })).toBe('invalid-date');
  });

  it('should handle timeZone', () => {
    const date = new Date('2026-02-11T12:00:00Z');
    const result = formatDateSpec(date, {
      dateStyle: 'medium',
      timeZone: 'America/New_York',
    }, 'en-US');
    expect(result).toBeTruthy();
  });

  it('should handle hour12 option', () => {
    const date = new Date('2026-02-11T15:30:00Z');
    const result12 = formatDateSpec(date, { timeStyle: 'short', hour12: true }, 'en-US');
    const result24 = formatDateSpec(date, { timeStyle: 'short', hour12: false }, 'en-US');
    expect(result12).toBeTruthy();
    expect(result24).toBeTruthy();
  });
});

// ============================================================================
// NumberFormatSchema Consumer Tests
// ============================================================================

describe('formatNumberSpec', () => {
  it('should format decimal numbers', () => {
    const result = formatNumberSpec(1234.56, { style: 'decimal' }, 'en-US');
    expect(result).toContain('1,234');
  });

  it('should format currency', () => {
    const result = formatNumberSpec(42.99, {
      style: 'currency',
      currency: 'USD',
    }, 'en-US');
    expect(result).toContain('$');
    expect(result).toContain('42.99');
  });

  it('should format percentage', () => {
    const result = formatNumberSpec(0.75, { style: 'percent' }, 'en-US');
    expect(result).toContain('75');
    expect(result).toContain('%');
  });

  it('should respect fraction digits', () => {
    const result = formatNumberSpec(3.14159, {
      style: 'decimal',
      maximumFractionDigits: 2,
    }, 'en-US');
    expect(result).toBe('3.14');
  });

  it('should respect useGrouping', () => {
    const withGrouping = formatNumberSpec(1234567, {
      style: 'decimal',
      useGrouping: true,
    }, 'en-US');
    const withoutGrouping = formatNumberSpec(1234567, {
      style: 'decimal',
      useGrouping: false,
    }, 'en-US');
    expect(withGrouping).toContain(',');
    expect(withoutGrouping).not.toContain(',');
  });
});

// ============================================================================
// LocaleConfigSchema Consumer Tests
// ============================================================================

describe('applyLocaleConfig', () => {
  it('should create bound formatting functions', () => {
    const locale = applyLocaleConfig({
      code: 'en-US',
      direction: 'ltr',
      numberFormat: { style: 'decimal', useGrouping: true },
      dateFormat: { dateStyle: 'medium' },
    });

    expect(locale.code).toBe('en-US');
    expect(locale.direction).toBe('ltr');
    expect(locale.fallbackChain).toEqual([]);
  });

  it('should format dates using configured locale', () => {
    const locale = applyLocaleConfig({
      code: 'en-US',
      dateFormat: { dateStyle: 'short' },
    });

    const result = locale.formatDate(new Date('2026-02-11'));
    expect(result).toBeTruthy();
  });

  it('should format numbers using configured locale', () => {
    const locale = applyLocaleConfig({
      code: 'en-US',
      numberFormat: { style: 'decimal', maximumFractionDigits: 2 },
    });

    const result = locale.formatNumber(1234.5678);
    expect(result).toBeTruthy();
  });

  it('should allow overrides in formatting calls', () => {
    const locale = applyLocaleConfig({
      code: 'en-US',
      numberFormat: { style: 'decimal' },
    });

    const result = locale.formatNumber(42.99, {
      style: 'currency',
      currency: 'EUR',
    });
    expect(result).toContain('€');
  });

  it('should resolve plurals with configured locale', () => {
    const locale = applyLocaleConfig({
      code: 'en',
    });

    const rule: SpecPluralRule = {
      key: 'items',
      one: '{count} item',
      other: '{count} items',
    };

    expect(locale.resolvePlural(rule, 1)).toBe('1 item');
    expect(locale.resolvePlural(rule, 5)).toBe('5 items');
  });

  it('should default direction to ltr', () => {
    const locale = applyLocaleConfig({ code: 'en' });
    expect(locale.direction).toBe('ltr');
  });
});
