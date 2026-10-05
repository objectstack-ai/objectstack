// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SECRET_MASK } from '@objectstack/spec/data';
import {
  collectCredentialWriteResponseFields,
  maskCredentialFieldsInWriteResponse,
  omitInternalFieldsFromWriteResponse,
} from './internal-write-response.js';

const STORED_PASSWORD = 'stored-password-value-never-returned';
const STORED_REF = 'secret:handle-never-returned';

const SCHEMA = {
  name: 'cred_holder',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    login_password: { type: 'password' },
    api_token: { type: 'secret' },
    hidden_hash: { type: 'text', internal: true },
    both: { type: 'secret', internal: true },
  },
};

const row = () => ({
  id: 'r1',
  name: 'visible',
  login_password: STORED_PASSWORD,
  api_token: STORED_REF,
  hidden_hash: 'h',
  both: 'secret:x',
});

describe('write-response credential mask', () => {
  it('collects the read-mask set: secret always, password outside the exempt bucket', () => {
    expect(collectCredentialWriteResponseFields(SCHEMA).sort()).toEqual(['api_token', 'both', 'login_password']);
    expect(collectCredentialWriteResponseFields({ ...SCHEMA, managedBy: 'better-auth' }).sort())
      .toEqual(['api_token', 'both']);
    expect(collectCredentialWriteResponseFields(undefined)).toEqual([]);
    expect(collectCredentialWriteResponseFields({ name: 'x' })).toEqual([]);
  });

  it('masks a set credential, keeps an unset one null, never adds a key', () => {
    const r: Record<string, unknown> = { id: 'r1', login_password: STORED_PASSWORD, api_token: null };
    maskCredentialFieldsInWriteResponse(SCHEMA, r);
    expect(r).toEqual({ id: 'r1', login_password: SECRET_MASK, api_token: null });
    // Idempotent.
    maskCredentialFieldsInWriteResponse(SCHEMA, r);
    expect(r).toEqual({ id: 'r1', login_password: SECRET_MASK, api_token: null });
  });

  it('the shared write-response helper masks credentials and omits internal fields, on every row', () => {
    const rows = [row(), null, 7, row()];
    omitInternalFieldsFromWriteResponse(SCHEMA, rows);
    for (const r of [rows[0], rows[3]] as Array<Record<string, unknown>>) {
      expect(r).toEqual({ id: 'r1', name: 'visible', login_password: SECRET_MASK, api_token: SECRET_MASK });
    }
    const wire = JSON.stringify(rows);
    expect(wire.includes(STORED_PASSWORD)).toBe(false);
    expect(wire.includes('secret:')).toBe(false);
  });

  it('a field removed upstream (field-level security) stays absent', () => {
    const r: Record<string, unknown> = { id: 'r1', name: 'visible' };
    omitInternalFieldsFromWriteResponse(SCHEMA, r);
    expect(r).toEqual({ id: 'r1', name: 'visible' });
  });

  it('a better-auth object keeps its password column, still masks its secret column', () => {
    const r = row();
    omitInternalFieldsFromWriteResponse({ ...SCHEMA, managedBy: 'better-auth' }, r);
    expect(r.login_password).toBe(STORED_PASSWORD);
    expect(r.api_token).toBe(SECRET_MASK);
  });
});
