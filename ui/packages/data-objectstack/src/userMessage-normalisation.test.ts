/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';

import { normaliseClientError, ConcurrentUpdateError } from './index';
import { DataApiValidationError } from './errors';

/**
 * `userMessage` (`ApiErrorSchema.userMessage`, objectstack#9934) is the
 * producer-side marking: an application author sets it at throw time to say
 * "this text is for the end user". The contract states it status-agnostic —
 * any refusal status may carry it.
 *
 * `normaliseClientError` re-wraps two shapes into typed errors, and both
 * re-wraps used to drop the marking: the constructed error was otherwise
 * correct, nothing threw, and the user simply got a generic string. These pins
 * hold the marking across both re-wraps, in the form the shared reader
 * (`declaredUserMessage` in `@object-ui/react`) actually looks for — the
 * end-to-end leg through that reader is pinned in
 * `packages/react/src/utils/error-message.normalisation-boundary.test.ts`,
 * the only place the two halves may meet without a dependency cycle.
 */
describe('normaliseClientError — userMessage marking', () => {
  describe('VALIDATION_FAILED re-wrap', () => {
    // The client sets `details` to the parsed body's `details` OR — as here,
    // since the validation envelope has no such key — the whole body.
    const markedInBody = () =>
      Object.assign(new Error('Amount is not allowed'), {
        code: 'VALIDATION_FAILED',
        httpStatus: 400,
        details: {
          error: 'Amount is not allowed',
          code: 'VALIDATION_FAILED',
          userMessage: 'Amounts over 10k need finance approval.',
          fields: [{ field: 'amount', code: 'not_allowed', message: 'Amount is not allowed' }],
        },
      });

    it('carries a marking parked on the response body', () => {
      const normalised = normaliseClientError(markedInBody()) as DataApiValidationError;
      expect(normalised).toBeInstanceOf(DataApiValidationError);
      expect(normalised.details?.userMessage).toBe('Amounts over 10k need finance approval.');
    });

    it('carries a marking the client already lifted onto the error', () => {
      const err = Object.assign(new Error('nope'), {
        code: 'VALIDATION_FAILED',
        userMessage: 'Pick a close date inside the open quarter.',
        details: { fields: [{ field: 'close_date', message: 'out of range' }] },
      });
      const normalised = normaliseClientError(err) as DataApiValidationError;
      expect(normalised.details?.userMessage).toBe('Pick a close date inside the open quarter.');
    });

    it('preserves the per-field entries alongside the marking', () => {
      // The marking is additive: the per-field detail a form draws on each
      // input must survive untouched next to it.
      const normalised = normaliseClientError(markedInBody()) as DataApiValidationError;
      expect(normalised.validationErrors).toEqual([
        { field: 'amount', message: 'Amount is not allowed' },
      ]);
      expect(normalised.field).toBe('amount');
      expect(normalised.details?.fields).toHaveLength(1);
      expect(normalised.details?.userMessage).toBe('Amounts over 10k need finance approval.');
    });

    it('adds no key at all when the producer marked nothing', () => {
      const err = Object.assign(new Error('Validation failed'), {
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'name', message: 'Name is required' }] },
      });
      const normalised = normaliseClientError(err) as DataApiValidationError;
      expect(normalised.details).not.toHaveProperty('userMessage');
    });

    it('ignores a blank marking rather than carrying an empty channel', () => {
      const err = Object.assign(new Error('Validation failed'), {
        code: 'VALIDATION_FAILED',
        details: { userMessage: '   ', fields: [{ field: 'name', message: 'required' }] },
      });
      const normalised = normaliseClientError(err) as DataApiValidationError;
      expect(normalised.details).not.toHaveProperty('userMessage');
    });
  });

  describe('CONCURRENT_UPDATE re-wrap', () => {
    it('carries a marking parked on the response body', () => {
      const err = Object.assign(new Error('Record was modified by another user'), {
        code: 'CONCURRENT_UPDATE',
        httpStatus: 409,
        details: {
          currentVersion: '2026-05-22T07:14:00.000Z',
          currentRecord: { id: 'rec_1' },
          userMessage: 'Someone in your team saved this first — reload before retrying.',
        },
      });
      const normalised = normaliseClientError(err) as ConcurrentUpdateError;
      expect(normalised).toBeInstanceOf(ConcurrentUpdateError);
      expect(normalised.userMessage).toBe(
        'Someone in your team saved this first — reload before retrying.',
      );
      // …without disturbing what the conflict dialog already reads.
      expect(normalised.currentVersion).toBe('2026-05-22T07:14:00.000Z');
      expect((normalised.currentRecord as { id: string }).id).toBe('rec_1');
    });

    it('carries a marking the client already lifted onto the error', () => {
      const err = Object.assign(new Error('stale write'), {
        code: 'CONCURRENT_UPDATE',
        httpStatus: 409,
        userMessage: 'This quote was re-priced while you were editing.',
      });
      const normalised = normaliseClientError(err) as ConcurrentUpdateError;
      expect(normalised.userMessage).toBe('This quote was re-priced while you were editing.');
    });

    it('answers null when the producer marked nothing', () => {
      const err = Object.assign(new Error('stale'), {
        code: 'CONCURRENT_UPDATE',
        httpStatus: 409,
      });
      const normalised = normaliseClientError(err) as ConcurrentUpdateError;
      expect(normalised.userMessage).toBeNull();
    });

    it('ignores a blank marking rather than carrying an empty channel', () => {
      const err = Object.assign(new Error('stale'), {
        code: 'CONCURRENT_UPDATE',
        httpStatus: 409,
        details: { userMessage: '' },
      });
      const normalised = normaliseClientError(err) as ConcurrentUpdateError;
      expect(normalised.userMessage).toBeNull();
    });
  });
});
