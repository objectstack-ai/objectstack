/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';

import { normaliseClientError } from './index';
import { DataApiValidationError } from './errors';

/**
 * The server has always sent per-field rejection detail; the adapter used to
 * hand callers the raw client error, so `fields[]` had no typed home and every
 * form fell back to one undirected toast.
 */
describe('normaliseClientError — VALIDATION_FAILED', () => {
  // `@objectstack/rest` serves a thrown validation failure as 400 with `fields[]`
  // verbatim; `@objectstack/client` sets `error.details` to the parsed body's
  // `details` OR — as here, since the envelope has no such key — the whole body.
  const upstream = () =>
    Object.assign(new Error('Name is required; Stage is not a valid option'), {
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      details: {
        error: 'Name is required; Stage is not a valid option',
        code: 'VALIDATION_FAILED',
        fields: [
          { field: 'name', code: 'required', message: 'Name is required' },
          { field: 'stage', code: 'invalid_option', message: 'Stage is not a valid option' },
        ],
        object: 'crm_opportunity',
      },
    });

  it('wraps it into a typed DataApiValidationError', () => {
    const normalised = normaliseClientError(upstream());
    expect(normalised).toBeInstanceOf(DataApiValidationError);
  });

  it('carries every field entry through', () => {
    const normalised = normaliseClientError(upstream()) as DataApiValidationError;
    expect(normalised.validationErrors).toEqual([
      { field: 'name', message: 'Name is required' },
      { field: 'stage', message: 'Stage is not a valid option' },
    ]);
  });

  it('keeps the server message verbatim — it names every field', () => {
    const normalised = normaliseClientError(upstream()) as DataApiValidationError;
    expect(normalised.message).toBe('Name is required; Stage is not a valid option');
  });

  it('exposes the first offending field on `.field`', () => {
    const normalised = normaliseClientError(upstream()) as DataApiValidationError;
    expect(normalised.field).toBe('name');
  });

  it('falls back to the machine code when an entry has no message', () => {
    const err = Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      details: { fields: [{ field: 'name', code: 'required' }] },
    });
    const normalised = normaliseClientError(err) as DataApiValidationError;
    expect(normalised.validationErrors).toEqual([{ field: 'name', message: 'required' }]);
  });

  it('drops entries with no field rather than inventing one', () => {
    const err = Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      details: { fields: [{ message: 'something is wrong' }] },
    });
    const normalised = normaliseClientError(err) as DataApiValidationError;
    expect(normalised.validationErrors).toEqual([]);
  });

  it('still wraps when the error carries `fields` directly (hand-rolled shape)', () => {
    // The server duck-types on `code`/`name`, so a hook throwing the bare shape
    // is served identically — the client must not be pickier than the server.
    const err = Object.assign(new Error('nope'), {
      name: 'ValidationError',
      fields: [{ field: 'amount', message: 'Amount must be positive' }],
    });
    const normalised = normaliseClientError(err) as DataApiValidationError;
    expect(normalised.validationErrors).toEqual([{ field: 'amount', message: 'Amount must be positive' }]);
  });

  it('leaves an unrelated 400 untouched', () => {
    const err = Object.assign(new Error('bad request'), { code: 'BAD_REQUEST', httpStatus: 400 });
    expect(normaliseClientError(err)).toBe(err);
  });
});
