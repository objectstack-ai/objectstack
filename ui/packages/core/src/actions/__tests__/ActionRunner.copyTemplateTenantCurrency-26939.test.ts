/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26939 — a copy template's `{{ amount | currency }}` hole with no
 * argument formats in the tenant default currency (`localization.currency`),
 * which the host installs on the runner (`setTenantCurrency`) and the filler
 * passes on the engine's reserved currency channel, apart from the roots.
 * With none, the engine refuses the sentence and it is shown as written: the
 * amount is never formatted in USD.
 *
 * Expected strings come from `Intl` itself, so a newer ICU cannot drift them.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { fillTemplateHoles } from '../actionCopyTemplate';

const AMOUNT = 1234.5;
const money = (tag: string, currency: string) => new Intl.NumberFormat(tag, { style: 'currency', currency }).format(AMOUNT);

async function confirmTextFor(runner: ActionRunner, def: ActionDef): Promise<unknown> {
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  await runner.execute(def);
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0][0];
}

describe('fillTemplateHoles: a no-argument currency hole reads the tenant default it is passed', () => {
  it('formats in the tenant default, in the display locale', () => {
    expect(fillTemplateHoles('{{ amount | currency }}', { amount: AMOUNT }, 'de-DE', 'CNY')).toBe(money('de-DE', 'CNY'));
  });

  it('a root named `currency` is a value, never the tenant default', () => {
    const source = '{{ amount | currency }} ({{ currency }})';
    expect(fillTemplateHoles(source, { amount: AMOUNT, currency: 'EUR' })).toBe(source);
  });

  it('with no tenant default the sentence is returned as written, never in USD', () => {
    const source = 'Set {{ amount | currency }}?';
    expect(fillTemplateHoles(source, { amount: AMOUNT }, 'en-US')).toBe(source);
  });

  it('a refused sentence logs the refusal, naming the hole and the remedy, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = 'Logged {{ amount | currency }}?';
      expect(fillTemplateHoles(source, { amount: AMOUNT }, 'en-US')).toBe(source);
      expect(fillTemplateHoles(source, { amount: AMOUNT }, 'en-US')).toBe(source);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain(source);
      expect(line).toContain('{{ amount | currency }}');
      expect(line).toContain('localization.currency');
      expect(line).toContain('currency:EUR');
    } finally {
      warn.mockRestore();
    }
  });

  it('a hole that names its code needs no tenant default', () => {
    expect(fillTemplateHoles('{{ amount | currency:EUR }}', { amount: AMOUNT }, 'en-US')).toBe(money('en-US', 'EUR'));
  });
});

describe('the runner fills its copy templates in the tenant default currency it was given', () => {
  const CONFIRM: ActionDef = { name: 'reprice', onClick: () => {}, confirmText: 'Set {{ record.amount | currency }}?' };
  const runner = () => new ActionRunner({ objectName: 'crm_deal', record: { amount: AMOUNT } });

  it('confirmText: the installed tenant default is the currency', async () => {
    const r = runner();
    r.setTenantCurrency(() => 'CNY');
    expect(await confirmTextFor(r, CONFIRM)).toBe(`Set ${money('en-US', 'CNY')}?`);
  });

  it('read per fill, so a settings change reaches a runner built before it', async () => {
    const r = runner();
    let current: string | undefined = 'CNY';
    r.setTenantCurrency(() => current);
    expect(await confirmTextFor(r, CONFIRM)).toBe(`Set ${money('en-US', 'CNY')}?`);
    current = 'JPY';
    expect(await confirmTextFor(r, CONFIRM)).toBe(`Set ${money('en-US', 'JPY')}?`);
  });

  it('with none installed the sentence is shown as written', async () => {
    expect(await confirmTextFor(runner(), CONFIRM)).toBe('Set {{ record.amount | currency }}?');
  });

  it('successMessage: formats `result` in the tenant default', async () => {
    const r = runner();
    const toast = vi.fn();
    r.setToastHandler(toast);
    r.setTenantCurrency(() => 'EUR');
    r.registerHandler('script', async () => ({ success: true, data: { total: AMOUNT } }));
    await r.execute({
      type: 'script',
      name: 'reprice',
      successMessage: { dialect: 'template', source: 'Total {{ result.total | currency }}' },
    });
    expect(toast.mock.calls[0][0]).toBe(`Total ${money('en-US', 'EUR')}`);
  });
});
