// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { operationUserMessage } from './operation-user-message.js';
import { recordNotFoundError } from './record-not-found.js';

/**
 * [#34699] The catalog sentence a producer with no `i18n` service marks as a
 * refusal's `userMessage`, and the not-found that marks one.
 */
describe('operationUserMessage — the caller ladder', () => {
  const ZH = BUILTIN_OPERATION_MESSAGES['zh-CN'].record_not_found;
  const EN = BUILTIN_OPERATION_MESSAGES.en.record_not_found;

  it('the request locale first', () => {
    expect(operationUserMessage('record_not_found', { locale: 'zh-CN', workspaceLocale: 'en' })).toBe(ZH);
  });

  it('a request locale the catalog does not carry falls to the workspace default', () => {
    expect(operationUserMessage('record_not_found', { locale: 'xx-YY', workspaceLocale: 'zh-CN' })).toBe(ZH);
  });

  it('a base language reaches its regional catalog (zh → zh-CN)', () => {
    expect(operationUserMessage('record_not_found', { locale: 'zh' })).toBe(ZH);
  });

  it('no caller, or no rung the catalog carries: en', () => {
    expect(operationUserMessage('record_not_found')).toBe(EN);
    expect(operationUserMessage('record_not_found', null)).toBe(EN);
    expect(operationUserMessage('record_not_found', { locale: 'xx-YY', workspaceLocale: '' })).toBe(EN);
  });
});

describe('recordNotFoundError — the userMessage beside an unchanged envelope', () => {
  it('keeps code, status, object and the developer message byte for byte', () => {
    const err = recordNotFoundError('account', 'acc_1', { locale: 'zh-CN' }) as Error & Record<string, unknown>;
    expect([err.code, err.status, err.object]).toEqual(['RECORD_NOT_FOUND', 404, 'account']);
    expect(err.message).toBe('Record acc_1 not found in account');
  });

  it("marks the sentence in the caller's language, naming no id and no API name", () => {
    const err = recordNotFoundError('account', 'acc_1', { locale: 'zh-CN' }) as Error & { userMessage?: string };
    expect(err.userMessage).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].record_not_found);
    expect(err.userMessage).not.toContain('acc_1');
    expect(err.userMessage).not.toContain('account');
  });

  it('with no caller, the English sentence', () => {
    const err = recordNotFoundError('account', 'acc_1') as Error & { userMessage?: string };
    expect(err.userMessage).toBe(BUILTIN_OPERATION_MESSAGES.en.record_not_found);
  });
});
