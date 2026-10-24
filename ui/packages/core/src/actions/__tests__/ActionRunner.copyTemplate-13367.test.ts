/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13367 — `confirmText`, `successMessage` and `errorMessage` read the
 * `template` envelope and fill `{{ }}` holes (the renderer half of
 * objectstack#24814, ruling A).
 *
 * The spec card types the three slots as `template` slots, so a served value
 * becomes `{ dialect: 'template', source }` where it was a string. Measured
 * before this card: the runner filled `${…}` in `confirmText` and
 * `${result.*}` in `successMessage`, skipped a non-string success copy (the
 * toast fell back to the default text) and interpolated nothing in
 * `errorMessage`; no `{{ }}` hole was filled anywhere. So with the spec first,
 * an authored success or error toast would silently become the default.
 *
 * What these pin, through the real runner and `@objectstack/formula`'s
 * `templateEngine`:
 *  - a plain string, and an envelope, for each key;
 *  - each declared root: `confirmText` → `record`, `params`;
 *    `successMessage` → `result`, `record`; `errorMessage` → none (verbatim);
 *  - the transition: a `${…}` sentence is still filled as before;
 *  - one dialect per sentence: a value filled into a `{{ }}` hole is never
 *    read again as `${…}`;
 *  - a non-string never reaches the confirm handler or the toast.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ActionRunner, type ActionDef, type ToastHandler } from '../ActionRunner';
import { actionCopySource, fillTemplateHoles, hasTemplateHoles, isActionCopyEnvelope } from '../actionCopyTemplate';

const ROW = { id: 'lead_1', name: 'Acme', amount: 1250 };
const envelope = (source?: string) => ({ dialect: 'template' as const, ...(source === undefined ? {} : { source }) });

/** The confirm handler's argument, for one run that is then cancelled. */
async function confirmTextFor(runner: ActionRunner, def: ActionDef): Promise<unknown> {
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  const result = await runner.execute(def);
  expect(result).toMatchObject({ success: false, error: 'Action cancelled by user' });
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0][0];
}

describe('confirmText reads the envelope and fills {{ }} over record and params (objectui#13367)', () => {
  const header = () => new ActionRunner({ objectName: 'crm_lead', record: { ...ROW } });
  const list = () => new ActionRunner({ objectName: 'crm_lead' });
  const BASE: ActionDef = { name: 'archive', onClick: () => {} };

  it('a plain string with no hole is shown as written', async () => {
    expect(await confirmTextFor(header(), { ...BASE, confirmText: 'Archive this lead?' })).toBe('Archive this lead?');
  });

  it('an envelope: its source, with the `record` hole filled from the record header', async () => {
    const def = { ...BASE, confirmText: envelope('Archive {{ record.name }}?') };
    expect(await confirmTextFor(header(), def)).toBe('Archive Acme?');
  });

  it('a list row is `record` for the template too, as it is for `${…}` (objectui#12967)', async () => {
    const def = { ...BASE, confirmText: envelope('Archive {{record.name}}?'), params: { _rowRecord: { ...ROW } } };
    expect(await confirmTextFor(list(), def)).toBe('Archive Acme?');
  });

  it('a plain string carrying a `{{ }}` hole is filled the same way (a bundle entry is a string)', async () => {
    expect(await confirmTextFor(header(), { ...BASE, confirmText: '归档 {{ record.name }}？' })).toBe('归档 Acme？');
  });

  it('`params`: the action\'s static params object, without the stashed row', async () => {
    const def = {
      ...BASE,
      confirmText: envelope('Move {{ record.name }} to {{ params.stage }}?{{ params._rowRecord.id }}'),
      params: { stage: 'Qualified', _rowRecord: { ...ROW } },
    };
    expect(await confirmTextFor(list(), def)).toBe('Move Acme to Qualified?');
  });

  it('a whitelisted formatter applies', async () => {
    const def = { ...BASE, confirmText: envelope('Close at {{ record.amount | number:2 }}?') };
    expect(await confirmTextFor(header(), def)).toBe('Close at 1,250.00?');
  });

  it('a root the slot does not declare prints empty — the runner context is not a root', async () => {
    const runner = new ActionRunner({ record: { ...ROW }, user: { id: 'u1', name: 'Ann' } });
    expect(await confirmTextFor(runner, { ...BASE, confirmText: envelope('By {{ user.name }}{{ result.id }}.') })).toBe('By .');
  });

  it('transition: a `${…}` sentence is still read through the expression evaluator', async () => {
    expect(await confirmTextFor(header(), { ...BASE, confirmText: 'Archive ${record.name}?' })).toBe('Archive Acme?');
  });

  it('one dialect per sentence: a record value is never evaluated as `${…}` after filling a hole', async () => {
    const runner = new ActionRunner({ record: { name: '${record.secret}', secret: 'leaked' } });
    expect(await confirmTextFor(runner, { ...BASE, confirmText: envelope('Archive {{ record.name }}?') }))
      .toBe('Archive ${record.secret}?');
  });

  it('a source the engine refuses (logic in a hole) is shown as written, never thrown', async () => {
    const def = { ...BASE, confirmText: envelope('Archive {{ record.amount * 2 }}?') };
    expect(await confirmTextFor(header(), def)).toBe('Archive {{ record.amount * 2 }}?');
  });

  it('an envelope with no string source still gates the run, with a string body, never the object', async () => {
    const shown = await confirmTextFor(header(), { ...BASE, confirmText: envelope() as ActionDef['confirmText'] });
    expect(shown).toBe('');
    expect(typeof shown).toBe('string');
  });

  it('CONTROL: no confirmText, no confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const runner = header();
    runner.setConfirmHandler(confirm);
    const result = await runner.execute({ ...BASE });
    expect(confirm).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe('successMessage reads the envelope and fills {{ }} over result and record (objectui#13367)', () => {
  let runner: ActionRunner;
  let toast: Mock<ToastHandler>;
  const ANSWER = async () => ({ success: true, data: { email: 'ann@example.com', id: 'inv_9' } });

  beforeEach(() => {
    runner = new ActionRunner({ objectName: 'sys_invitation', record: { name: 'Acme' } });
    toast = vi.fn();
    runner.setToastHandler(toast);
    runner.registerHandler('script', ANSWER);
  });

  const toastText = () => {
    expect(toast).toHaveBeenCalledTimes(1);
    return toast.mock.calls[0][0];
  };

  it('a plain string with no hole is shown as written', async () => {
    await runner.execute({ type: 'script', name: 'invite', successMessage: 'Invitation sent' });
    expect(toastText()).toBe('Invitation sent');
  });

  it('an envelope: its source, with `result` and `record` holes filled', async () => {
    await runner.execute({
      type: 'script',
      name: 'invite',
      successMessage: envelope('Invited {{ result.email }} to {{ record.name }}'),
    });
    expect(toastText()).toBe('Invited ann@example.com to Acme');
  });

  it('the row a dispatch carries is `record`', async () => {
    await runner.execute({
      type: 'script',
      name: 'invite',
      params: { _rowRecord: { name: 'Globex' } },
      successMessage: envelope('Invited {{ result.email }} to {{ record.name }}'),
    });
    expect(toastText()).toBe('Invited ann@example.com to Globex');
  });

  it('an envelope is no longer dropped to the default text (the pre-card failure)', async () => {
    await runner.execute({ type: 'script', name: 'invite', successMessage: envelope('Invitation sent') });
    expect(toastText()).toBe('Invitation sent');
  });

  it('transition: the platform objects\' `${result.email}` sentence is still filled', async () => {
    await runner.execute({ type: 'script', name: 'invite', successMessage: 'Invitation sent to ${result.email}' });
    expect(toastText()).toBe('Invitation sent to ann@example.com');
  });

  it('one dialect per sentence: a filled value is not read again as `${result.*}`', async () => {
    runner.registerHandler('script', async () => ({ success: true, data: { email: '${result.id}', id: 'inv_9' } }));
    await runner.execute({ type: 'script', name: 'invite', successMessage: envelope('Invited {{ result.email }}') });
    expect(toastText()).toBe('Invited ${result.id}');
  });

  it('an envelope with no string source falls to the default text, as a string', async () => {
    await runner.execute({ type: 'script', name: 'invite', successMessage: envelope() as ActionDef['successMessage'] });
    expect(toastText()).toBe('Action completed successfully');
  });

  it('an outcomeMessages entry still outranks the envelope', async () => {
    runner.registerHandler('script', async () => ({ success: true, data: { outcome: 'resent', email: 'ann@example.com' } }));
    await runner.execute({
      type: 'script',
      name: 'invite',
      outcomeMessages: { resent: 'Resent to ${result.email}' },
      successMessage: envelope('Invited {{ result.email }}'),
    });
    expect(toastText()).toBe('Resent to ann@example.com');
  });

  it('an envelope counts as declared copy for a navigation (objectui#12755)', async () => {
    const nav = vi.fn();
    runner.setNavigationHandler(nav);
    await runner.execute({ type: 'url', name: 'open', target: '/x', successMessage: envelope('Opened') });
    expect(nav).toHaveBeenCalled();
    expect(toastText()).toBe('Opened');
  });
});

describe('errorMessage reads the envelope and is shown as written (objectui#13367)', () => {
  let runner: ActionRunner;
  let toast: Mock<ToastHandler>;

  beforeEach(() => {
    runner = new ActionRunner({ record: { name: 'Acme' } });
    toast = vi.fn();
    runner.setToastHandler(toast);
    runner.registerHandler('script', async () => ({ success: false, error: 'HTTP 500' }));
  });

  const toastText = () => {
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1]).toMatchObject({ type: 'error' });
    return toast.mock.calls[0][0];
  };

  it('a plain string is shown as written', async () => {
    await runner.execute({ type: 'script', name: 'sync', errorMessage: 'Sync failed' });
    expect(toastText()).toBe('Sync failed');
  });

  it('an envelope: its source, verbatim — no root is declared, so no hole is filled', async () => {
    await runner.execute({ type: 'script', name: 'sync', errorMessage: envelope('Could not sync {{ record.name }}') });
    expect(toastText()).toBe('Could not sync {{ record.name }}');
  });

  it('an envelope with no string source falls to the action\'s own error, never the object', async () => {
    await runner.execute({ type: 'script', name: 'sync', errorMessage: envelope() as ActionDef['errorMessage'] });
    expect(toastText()).toBe('HTTP 500');
  });
});

describe('the copy reader (objectui#13367)', () => {
  it('reads a string, an envelope\'s source, and nothing else', () => {
    expect(actionCopySource('Hi')).toBe('Hi');
    expect(actionCopySource({ dialect: 'template', source: 'Hi {{ record.name }}' })).toBe('Hi {{ record.name }}');
    expect(actionCopySource({ source: 'Hi' })).toBe('Hi');
    expect(actionCopySource({ dialect: 'template' })).toBeUndefined();
    expect(actionCopySource({ en: 'Hi', 'zh-CN': '你好' })).toBeUndefined();
    expect(actionCopySource(42)).toBeUndefined();
    expect(actionCopySource(undefined)).toBeUndefined();
  });

  it('tells the envelope from an I18nLabel map', () => {
    expect(isActionCopyEnvelope({ dialect: 'template', source: 'x' })).toBe(true);
    expect(isActionCopyEnvelope({ dialect: 'template' })).toBe(true);
    expect(isActionCopyEnvelope({ en: 'x', 'zh-CN': 'y' })).toBe(false);
    expect(isActionCopyEnvelope('x')).toBe(false);
    expect(isActionCopyEnvelope(['x'])).toBe(false);
  });

  it('a sentence is a template only when it carries a `{{ }}` hole', () => {
    expect(hasTemplateHoles('Hi {{ record.name }}')).toBe(true);
    expect(hasTemplateHoles('Hi ${record.name}')).toBe(false);
    expect(hasTemplateHoles('Hi {name}')).toBe(false);
  });

  it('fills through the formula template engine', () => {
    expect(fillTemplateHoles('{{ result.email | upper }}', { result: { email: 'a@b.c' } })).toBe('A@B.C');
  });
});
