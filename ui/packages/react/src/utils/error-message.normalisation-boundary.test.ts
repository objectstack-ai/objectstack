/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';

import { normaliseClientError } from '@object-ui/data-objectstack';
import { declaredUserMessage } from './error-message';

/**
 * The two halves of the `userMessage` channel, pinned where they meet.
 *
 * `@object-ui/data-objectstack` parks the producer's marking on the typed
 * error it constructs; `declaredUserMessage` here lifts it back off. Neither
 * half can pin the pair alone — the adapter cannot import this reader (this
 * package depends on THAT one, so the symbol cannot travel upstream), and the
 * reader's own unit tests build their inputs by hand and so never exercise the
 * adapter's re-wrap.
 *
 * That gap is exactly where the defect lived: both re-wraps dropped the
 * marking, every unit test on both sides stayed green, and the only visible
 * symptom was a user reading a generic string instead of the sentence their
 * administrator wrote. These pins fail if either half stops holding up its end.
 */
describe('userMessage survives the adapter boundary', () => {
  it('survives the VALIDATION_FAILED re-wrap', () => {
    const raw = Object.assign(new Error('Amount is not allowed'), {
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      details: {
        code: 'VALIDATION_FAILED',
        userMessage: 'Amounts over 10k need finance approval.',
        fields: [{ field: 'amount', message: 'Amount is not allowed' }],
      },
    });
    // The marking is readable before the boundary…
    expect(declaredUserMessage(raw)).toBe('Amounts over 10k need finance approval.');
    // …and must still be readable after it.
    expect(declaredUserMessage(normaliseClientError(raw))).toBe(
      'Amounts over 10k need finance approval.',
    );
  });

  it('survives the CONCURRENT_UPDATE re-wrap', () => {
    const raw = Object.assign(new Error('Record was modified by another user'), {
      code: 'CONCURRENT_UPDATE',
      httpStatus: 409,
      details: {
        currentVersion: '2026-05-22T07:14:00.000Z',
        currentRecord: { id: 'rec_1' },
        userMessage: 'Someone in your team saved this first — reload before retrying.',
      },
    });
    expect(declaredUserMessage(raw)).toBe(
      'Someone in your team saved this first — reload before retrying.',
    );
    expect(declaredUserMessage(normaliseClientError(raw))).toBe(
      'Someone in your team saved this first — reload before retrying.',
    );
  });

  it('leaves the untouched passthrough arm exactly as it was', () => {
    // A 403 is returned unchanged by `normaliseClientError` — it is neither of
    // the two re-wrapped shapes. Pinned as the control: it reads the same
    // before and after, so a failure in the two above is about the re-wraps
    // and not about the reader.
    const raw = Object.assign(new Error('FORBIDDEN: insufficient privileges'), {
      code: 'FORBIDDEN',
      httpStatus: 403,
      userMessage: 'Ask finance to approve this record first.',
    });
    expect(normaliseClientError(raw)).toBe(raw);
    expect(declaredUserMessage(normaliseClientError(raw))).toBe(
      'Ask finance to approve this record first.',
    );
  });

  it('still answers null for an unmarked refusal on both re-wrapped shapes', () => {
    // objectstack#3821 holds by construction: nothing the producer did not
    // opt into can reach the user through this channel.
    const validation = Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      details: { fields: [{ field: 'name', message: 'Name is required' }] },
    });
    const conflict = Object.assign(new Error('stale'), {
      code: 'CONCURRENT_UPDATE',
      httpStatus: 409,
    });
    expect(declaredUserMessage(normaliseClientError(validation))).toBeNull();
    expect(declaredUserMessage(normaliseClientError(conflict))).toBeNull();
  });
});
