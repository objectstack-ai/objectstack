/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27520 row 11 — a refused action that names
 * required fields says what to do next.
 *
 * Measured on the showcase: Submit for Sign-off on a draft invoice answered
 * `Issued On is required` and nothing else, so the user had no hint that the
 * invoice needed editing first. The console's action dispatch now follows the
 * server's sentence with "Fill in Issued On, then run “Submit for Sign-off”
 * again." The server's text stays first and whole, whatever it says.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ActionDef, ServerActionFetch } from '@object-ui/core';
import { createConsoleServerActionHandler } from '../consoleServerAction';

const SUBMIT = { type: 'script', name: 'showcase_submit_signoff', label: 'Submit for Sign-off', objectName: 'showcase_invoice', recordId: 'inv_1' } as ActionDef;

function refusing(message: string, fields: unknown[]) {
  return vi.fn(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ success: false, error: { code: 'VALIDATION_FAILED', message, details: { fields } } }),
  })) as unknown as ServerActionFetch;
}

function handlerOver(fetch: ServerActionFetch, t?: (key: string, englishDefault: string, values?: Record<string, string>) => string) {
  return createConsoleServerActionHandler({
    fetch,
    baseUrl: () => '',
    resolveObject: () => 'showcase_invoice',
    onRefresh: () => {},
    t,
  });
}

describe('a required-field refusal names what to fill in (objectstack#27520 row 11)', () => {
  it('follows the server’s sentence with the field and the action to run again', async () => {
    const res = await handlerOver(refusing('Issued On is required', [
      { field: 'issued_on', code: 'required', message: 'Issued On is required', label: 'Issued On' },
    ]))(SUBMIT);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Issued On is required. Fill in Issued On, then run “Submit for Sign-off” again.');
  });

  it('joins several required fields with the pack’s list punctuation, each once', async () => {
    const fields = [
      { field: 'issued_on', code: 'required', label: 'Issued On' },
      { field: 'due_on', code: 'required', label: 'Due On' },
      { field: 'issued_on', code: 'required', label: 'Issued On' },
    ];
    const en = await handlerOver(refusing('Two fields are required', fields))(SUBMIT);
    expect(en.error).toBe('Two fields are required. Fill in Issued On, Due On, then run “Submit for Sign-off” again.');
    const zhJoiner = (key: string, englishDefault: string, values?: Record<string, string>) =>
      key === 'validation.formInvalidJoiner' ? '、' : englishDefault.replace(/\{\{(\w+)\}\}/g, (_h, n: string) => values?.[n] ?? '');
    const zh = await handlerOver(refusing('两个字段为必填项', fields), zhJoiner)(SUBMIT);
    expect(zh.error).toContain('Fill in Issued On、Due On,');
  });

  it('keeps the server’s own stop, and ends a CJK sentence with its own', async () => {
    const fields = [{ field: 'issued_on', code: 'required', label: '开具日期' }];
    const stopped = await handlerOver(refusing('Issued On is required.', fields))(SUBMIT);
    expect(stopped.error?.startsWith('Issued On is required. Fill in')).toBe(true);
    const zh = await handlerOver(refusing('开具日期为必填项', fields))(SUBMIT);
    expect(zh.error?.startsWith('开具日期为必填项。Fill in 开具日期')).toBe(true);
  });

  it('names the field by its key when the server sent no label, and asks plainly when the action has none', async () => {
    const res = await handlerOver(refusing('due_on is required', [{ field: 'due_on', code: 'required' }]))(
      { ...SUBMIT, label: undefined } as ActionDef,
    );
    expect(res.error).toBe('due_on is required. Fill in due_on first.');
  });

  it('leaves every other refusal as the server said it', async () => {
    const res = await handlerOver(refusing('Amount must be at least 0', [
      { field: 'amount', code: 'min', message: 'Amount must be at least 0' },
      { field: '_record', code: 'required', message: 'A contact is required' },
    ]))(SUBMIT);
    expect(res.error).toBe('Amount must be at least 0');
  });

  it('translates the hint through the host’s t, holes filled from its values', async () => {
    const t = vi.fn((key: string, englishDefault: string, values?: Record<string, string>) =>
      key === 'console.serverAction.fillRequiredThenRetry' ? `[${values?.fields}|${values?.action}]` : englishDefault);
    const handler = createConsoleServerActionHandler({
      fetch: refusing('Issued On is required', [{ field: 'issued_on', code: 'required', label: 'Issued On' }]),
      baseUrl: () => '',
      resolveObject: () => 'showcase_invoice',
      onRefresh: () => {},
      t,
    });
    const res = await handler(SUBMIT);
    expect(res.error).toBe('Issued On is required. [Issued On|Submit for Sign-off]');
  });
});
