import { describe, it, expect } from 'vitest';
import { CurrencyConfigSchema } from '@objectstack/spec/data';
import { resolveFieldCurrency } from '../index';

/**
 * `resolveFieldCurrency` now lives in `@object-ui/i18n` (co-located with
 * `useLocalization`, which supplies the tenant default). `@object-ui/fields`
 * re-exports it; this proves the canonical home resolves the precedence chain.
 */
describe('resolveFieldCurrency (i18n canonical home)', () => {
  it('prefers the field explicit currency over everything', () => {
    expect(
      resolveFieldCurrency({ currency: 'JPY', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } }, 'USD'),
    ).toBe('JPY');
  });

  it('falls back to a fixed currencyConfig.defaultCurrency, then legacy defaultCurrency', () => {
    expect(resolveFieldCurrency({ currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } }, 'USD')).toBe('EUR');
    expect(resolveFieldCurrency({ defaultCurrency: 'GBP' } as any, 'USD')).toBe('GBP');
  });

  it('falls back to the tenant default when the field omits its own (ADR-0053)', () => {
    expect(resolveFieldCurrency({}, 'CNY')).toBe('CNY');
    expect(resolveFieldCurrency(null, 'CNY')).toBe('CNY');
    expect(resolveFieldCurrency(undefined, 'CNY')).toBe('CNY');
  });

  it('returns undefined when nothing is known (renderer shows a plain number)', () => {
    expect(resolveFieldCurrency({})).toBeUndefined();
    expect(resolveFieldCurrency(undefined, undefined)).toBeUndefined();
  });
});

/**
 * objectui#10422: `currencyConfig.currencyMode` decides whether
 * `currencyConfig.defaultCurrency` is the field's currency.
 *
 * `@objectstack/spec` names two modes: `fixed` (single currency) and `dynamic`
 * (user selectable), and its `FieldSchema` guidance says a field without a
 * fixed currency "uses the tenant default at runtime". The resolver used to
 * read `defaultCurrency` in either mode, so a dynamic EUR field read `€` in a
 * USD tenant, and an EMPTY config, which the spec parses to a dynamic CNY
 * config, read `CN¥`.
 *
 * Every row runs under a USD tenant, so a row that reads anything but `USD`
 * took its code from the field.
 *
 * ── Directions on the base tree (predicted before the first run, then observed) ──
 *   fixed                                   GREEN (the base read it anyway)
 *   dynamic                                 RED   (read EUR)
 *   parsed-empty, both spellings            RED   (read CNY)
 *   no mode (the spec defaults it dynamic)  RED   (read EUR)
 *   dynamic with no tenant default          RED   (read EUR, not undefined)
 *   explicit `currency`, none               GREEN (untouched legs)
 *   legacy `defaultCurrency`                RED
 * Predicted: the legacy row GREEN. Observed: RED. Its second assertion pairs
 * the legacy key with a DYNAMIC config, whose EUR the base tree read first.
 */
describe('currencyMode decides whether currencyConfig.defaultCurrency is read (objectui#10422)', () => {
  const TENANT = 'USD';

  it('fixed: the config code is the field currency', () => {
    expect(resolveFieldCurrency({ currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } }, TENANT)).toBe('JPY');
  });

  it('dynamic: the tenant default, not the config code', () => {
    expect(resolveFieldCurrency({ currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } }, TENANT)).toBe(
      'USD',
    );
  });

  it('parsed-empty: an empty config, as the spec parses it, reads the tenant default, never CNY', () => {
    // Parsed through the installed spec rather than restated, so this row keeps
    // meaning "whatever the spec materializes for an empty config".
    const parsed = CurrencyConfigSchema.parse({});
    expect(parsed.currencyMode, 'the spec defaults an empty config to dynamic').toBe('dynamic');
    expect(parsed.defaultCurrency, 'the spec fills in a code of its own').not.toBe(TENANT);
    expect(resolveFieldCurrency({ currencyConfig: parsed }, TENANT)).toBe('USD');
  });

  it('parsed-empty: the materialized shape as a renderer receives it', () => {
    expect(
      resolveFieldCurrency({ currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' } }, TENANT),
    ).toBe('USD');
  });

  it('no mode: an authored config without currencyMode reads as dynamic, the spec default', () => {
    const authored = { defaultCurrency: 'EUR' };
    expect(CurrencyConfigSchema.parse(authored).currencyMode, 'the spec defaults an absent mode to dynamic').toBe(
      'dynamic',
    );
    expect(resolveFieldCurrency({ currencyConfig: authored }, TENANT)).toBe('USD');
  });

  it('dynamic with no tenant default: undefined (a plain number), never the config code', () => {
    expect(resolveFieldCurrency({ currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } })).toBeUndefined();
  });

  it('fixed with no code: falls through to the tenant default', () => {
    expect(resolveFieldCurrency({ currencyConfig: { currencyMode: 'fixed' } }, TENANT)).toBe('USD');
  });

  it('explicit `currency`: wins over a fixed config and over a dynamic one', () => {
    expect(
      resolveFieldCurrency({ currency: 'KWD', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } }, TENANT),
    ).toBe('KWD');
    expect(
      resolveFieldCurrency({ currency: 'KWD', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } }, TENANT),
    ).toBe('KWD');
  });

  it('legacy top-level `defaultCurrency`: after a fixed config, ahead of the tenant default', () => {
    expect(
      resolveFieldCurrency(
        { defaultCurrency: 'GBP', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
        TENANT,
      ),
    ).toBe('JPY');
    expect(
      resolveFieldCurrency(
        { defaultCurrency: 'GBP', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } },
        TENANT,
      ),
    ).toBe('GBP');
  });

  it('none: the tenant default, or undefined when there is none', () => {
    expect(resolveFieldCurrency({}, TENANT)).toBe('USD');
    expect(resolveFieldCurrency({})).toBeUndefined();
  });

  it('control: the objectstack showcase configs (all fixed USD) still read USD under a JPY tenant', () => {
    // The three `currencyConfig` authors in objectstack's showcase example, as
    // written there. Under a JPY tenant, reading USD proves the fixed leg.
    for (const currencyConfig of [
      { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
      { currencyMode: 'fixed', defaultCurrency: 'USD', precision: 2 },
    ] as const) {
      expect(resolveFieldCurrency({ currencyConfig }, 'JPY')).toBe('USD');
    }
  });
});
