/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27948 (ruling A, step 2) — the param dialog's `description`,
 * each param's `helpText` and an `outcomeMessages` entry become ADR-0032
 * `template` slots, so a parsed action carries
 * `{ dialect: 'template', source }` where it carried a string.
 *
 * The runner read all three as strings: the dialog drew `[object Object]`
 * (or the host's `String(…)` of it) and the outcome toast fell back to the
 * generic success copy — the objectui#13367 trap. Pinned here: an envelope
 * reads exactly as the bare string it stands for, through the real runner and
 * the template engine, on what the host is HANDED — the action and params the
 * param-collection handler receives (each slot already its text) and the text
 * of the success toast.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef, type ActionResult } from '../ActionRunner';

const ROW = { id: 'acct_1', display_name: 'Acme' };
const envelope = (source: string) => ({ dialect: 'template' as const, source });

const withDialogCopy = (wrap: (s: string) => unknown): ActionDef => ({
  name: 'pause_account',
  label: 'Pause',
  description: wrap('Pause {{ record.display_name }}?') as ActionDef['description'],
  actionParams: [{ name: 'reason', label: 'Reason', type: 'text', helpText: wrap('Why pause ${record.display_name}?') as string }],
  onClick: () => {},
});

/** What the param-collection handler is handed, and what it draws through `interpolate`. */
async function handed(def: ActionDef) {
  const runner = new ActionRunner({ objectName: 'crm_account', record: { ...ROW } });
  let seen: { description: unknown; helpText: unknown; drawn: { description: string; helpText: string } } | undefined;
  runner.setParamCollectionHandler(async (params, action, interpolate) => {
    seen = {
      description: action?.description,
      helpText: params[0].helpText,
      drawn: {
        description: interpolate!(String(action?.description)),
        helpText: interpolate!(String(params[0].helpText)),
      },
    };
    return null;
  });
  await runner.execute(def);
  expect(seen).toBeDefined();
  return seen!;
}

describe('param dialog copy written as the template envelope (objectstack#27948)', () => {
  it('the handler receives each slot as its text, and draws what the bare string draws', async () => {
    const fromEnvelope = await handed(withDialogCopy(envelope));
    expect(fromEnvelope.description).toBe('Pause {{ record.display_name }}?');
    expect(fromEnvelope.helpText).toBe('Why pause ${record.display_name}?');
    expect(fromEnvelope.drawn).toEqual({ description: 'Pause Acme?', helpText: 'Why pause Acme?' });
    expect(fromEnvelope).toEqual(await handed(withDialogCopy((s) => s)));
  });

  it('CONTROL: a locale-map description reaches the handler unchanged, for the host to localize', async () => {
    const map = { en: 'Pause it?', 'zh-CN': '暂停？' };
    const seen = await handed({ ...withDialogCopy((s) => s), description: map as unknown as string });
    expect(seen.description).toBe(map);
  });
});

describe('an outcomeMessages entry written as the template envelope (objectstack#27948)', () => {
  const answer: ActionResult = { success: true, data: { outcome: 'paused', name: 'prod' } };
  const toastFor = async (paused: unknown): Promise<string> => {
    const runner = new ActionRunner({ objectName: 'crm_account' });
    const toast = vi.fn();
    runner.setToastHandler(toast);
    runner.registerHandler('custom', async () => answer);
    await runner.execute({ name: 'pause_environment', type: 'custom' as never, outcomeMessages: { paused } } as ActionDef);
    const calls = toast.mock.calls.filter(([, options]) => options?.type === 'success');
    expect(calls).toHaveLength(1);
    return calls[0][0] as string;
  };

  it('fills the envelope\'s holes exactly as the bare string\'s', async () => {
    expect(await toastFor(envelope('Environment {{ result.name }} paused'))).toBe('Environment prod paused');
    expect(await toastFor(envelope('Environment ${result.name} paused'))).toBe('Environment prod paused');
  });

  it('an envelope with no source falls through to the next rung, as a blank entry does', async () => {
    expect(await toastFor({ dialect: 'template' })).toBe(await toastFor(''));
  });
});
