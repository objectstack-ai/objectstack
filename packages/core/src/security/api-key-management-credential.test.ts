// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  apiKeyManagementCredentialRefusal,
  API_KEY_MANAGEMENT_READ_OPERATIONS,
} from './api-key-management-credential.js';

/**
 * The one rule both data doors ask: a write to `sys_api_key` from a principal
 * an API key admitted is refused; everything else keeps today's answer.
 */
describe('apiKeyManagementCredentialRefusal', () => {
  const WRITES = ['create', 'update', 'delete', 'bulk', 'import'];

  it.each(WRITES)('refuses `%s` on sys_api_key from an API-key-admitted caller, on the ADR-0112 envelope', (operation) => {
    const refusal = apiKeyManagementCredentialRefusal({ object: 'sys_api_key', operation, credential: 'api_key' });
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, statusCode: 403, object: 'sys_api_key' });
  });

  it('refuses a write verb it has never heard of: only the declared reads pass', () => {
    const refusal = apiKeyManagementCredentialRefusal({ object: 'sys_api_key', operation: 'upsert', credential: 'api_key' });
    expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it.each([...API_KEY_MANAGEMENT_READ_OPERATIONS])('leaves the read `%s` alone', (operation) => {
    expect(apiKeyManagementCredentialRefusal({ object: 'sys_api_key', operation, credential: 'api_key' })).toBeUndefined();
  });

  it.each(WRITES)('leaves `%s` alone for a session-admitted caller', (operation) => {
    expect(apiKeyManagementCredentialRefusal({ object: 'sys_api_key', operation, credential: 'session' })).toBeUndefined();
  });

  it('leaves a caller whose door was told no credential alone (positive rule)', () => {
    expect(apiKeyManagementCredentialRefusal({ object: 'sys_api_key', operation: 'update', credential: undefined })).toBeUndefined();
  });

  it('leaves every other object alone for an API-key-admitted caller', () => {
    for (const object of ['crm_account', 'sys_user', 'sys_session', undefined, '']) {
      expect(apiKeyManagementCredentialRefusal({ object, operation: 'update', credential: 'api_key' })).toBeUndefined();
    }
  });
});
