/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26232 — a copy template's formatters render in the viewer's
 * display locale, and a root named `locale` never sets it.
 *
 * Measured before this card: `fillTemplateHoles` passed its roots as the
 * template engine's `extra`, and the engine read its formatter locale from
 * `extra.locale`. So a param named `locale` set the locale of every formatted
 * value in the sentence, and with no such param every viewer read `en-US`.
 * The locale now rides the engine's reserved channel: the host installs its
 * display locale on the runner (`setDisplayLocale`), and the filler passes it
 * apart from the roots.
 *
 * Expected strings come from `Intl` itself, so a newer ICU cannot drift them.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { fillTemplateHoles } from '../actionCopyTemplate';

const AMOUNT = 1234567.5;
const money = (tag: string) => new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(AMOUNT);

async function confirmTextFor(runner: ActionRunner, def: ActionDef, callContext?: object): Promise<unknown> {
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  await runner.execute(def, callContext);
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0][0];
}

describe('fillTemplateHoles keeps the formatter locale apart from the roots (objectstack#26232)', () => {
  it('a root named `locale` is a value a hole prints, not the formatter locale', () => {
    expect(money('de-DE')).not.toBe(money('en-US'));
    expect(fillTemplateHoles('{{ amount | currency:EUR }} ({{ locale }})', { amount: AMOUNT, locale: 'de-DE' }))
      .toBe(`${money('en-US')} (de-DE)`);
  });

  it('formats in the locale the caller passes', () => {
    expect(fillTemplateHoles('{{ amount | currency:EUR }}', { amount: AMOUNT }, 'de-DE')).toBe(money('de-DE'));
  });
});

describe('the runner fills its copy templates in the display locale it was given (objectstack#26232)', () => {
  const CONFIRM: ActionDef = {
    name: 'reprice',
    onClick: () => {},
    confirmText: 'Set {{ record.amount | currency:EUR }} ({{ params.locale }})?',
    params: { locale: 'fr-FR' },
  };
  const runner = () => new ActionRunner({ objectName: 'crm_deal', record: { amount: AMOUNT } });

  it('CONTROL: with no display locale installed, the formatters render en-US as before', async () => {
    expect(await confirmTextFor(runner(), CONFIRM)).toBe(`Set ${money('en-US')} (fr-FR)?`);
  });

  it('confirmText: the installed display locale is the formatter locale', async () => {
    const r = runner();
    r.setDisplayLocale(() => 'de-DE');
    expect(await confirmTextFor(r, CONFIRM)).toBe(`Set ${money('de-DE')} (fr-FR)?`);
  });

  it('the display locale is read per fill, so a switch reaches a runner built before it', async () => {
    const r = runner();
    let current = 'de-DE';
    r.setDisplayLocale(() => current);
    expect(await confirmTextFor(r, CONFIRM)).toBe(`Set ${money('de-DE')} (fr-FR)?`);
    current = 'ja-JP';
    expect(await confirmTextFor(r, CONFIRM)).toBe(`Set ${money('ja-JP')} (fr-FR)?`);
  });

  it('a dispatch with a callContext keeps the display locale', async () => {
    const r = new ActionRunner({ objectName: 'crm_deal' });
    r.setDisplayLocale(() => 'de-DE');
    expect(await confirmTextFor(r, CONFIRM, { record: { amount: AMOUNT } })).toBe(`Set ${money('de-DE')} (fr-FR)?`);
  });

  it('successMessage: formats `result` in the display locale', async () => {
    const r = runner();
    const toast = vi.fn();
    r.setToastHandler(toast);
    r.setDisplayLocale(() => 'de-DE');
    r.registerHandler('script', async () => ({ success: true, data: { total: AMOUNT, locale: 'fr-FR' } }));
    await r.execute({
      type: 'script',
      name: 'reprice',
      successMessage: { dialect: 'template', source: 'Total {{ result.total | currency:EUR }} ({{ result.locale }})' },
    });
    expect(toast.mock.calls[0][0]).toBe(`Total ${money('de-DE')} (fr-FR)`);
  });
});
