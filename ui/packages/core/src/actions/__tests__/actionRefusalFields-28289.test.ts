/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack-ai/objectstack#28289 — a refusal that names its fields on
 * `error.fields` keeps them, as one that names them on `error.details.fields`
 * always has.
 *
 * Both members are the spec's `EnhancedApiErrorSchema`: the data and action
 * doors put a thrown validation failure under `details.fields`, and a door
 * that builds its own refusal names the list `fields` beside `code`. The body
 * below is plugin-auth's Create User answer for an empty email, as the action
 * door relays it whole.
 */

import { describe, it, expect } from 'vitest';
import { interpretActionResponse, refusalFieldErrors } from '../actionResponse';

const CREATE_USER_REFUSAL = {
  success: false,
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Email is required',
    httpStatus: 400,
    fields: [{ field: 'email', code: 'required', message: 'Email is required' }],
  },
};

describe('a refusal naming its fields on error.fields keeps them (objectstack#28289)', () => {
  it('reads the entries off error.fields', () => {
    expect(refusalFieldErrors(CREATE_USER_REFUSAL)).toEqual([
      { field: 'email', code: 'required', message: 'Email is required' },
    ]);
  });

  it('an /actions refusal carrying them answers them as fieldErrors beside its text', () => {
    const out = interpretActionResponse({ ok: false, status: 400 }, CREATE_USER_REFUSAL, 'Action "create_user"');
    expect(out).toMatchObject({ ok: false, error: 'Email is required' });
    expect(out.fieldErrors).toEqual([{ field: 'email', code: 'required', message: 'Email is required' }]);
  });

  it('control: error.details.fields is still read', () => {
    const body = {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Issued On is required', details: { fields: [{ field: 'issued_on', code: 'required' }] } },
    };
    expect(refusalFieldErrors(body)).toEqual([{ field: 'issued_on', code: 'required' }]);
  });

  it('control: a refusal naming no field answers none', () => {
    expect(refusalFieldErrors({ success: false, error: { code: 'INVALID_REQUEST', message: 'A valid email is required' } })).toBeUndefined();
  });
});
