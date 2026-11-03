// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29163 — recognition is narrow: only a listed sentence, on its own door, as
 * an uncoded 400 `APIError`, is re-thrown with a code. The wire behaviour is
 * pinned in `change-email-delete-user-wiring.test.ts`; this file holds the
 * answers the stamp must leave alone.
 */

import { describe, it, expect } from 'vitest';
import { APIError } from 'better-auth/api';
import { codeSelfServiceRefusal, SELF_SERVICE_UNCODED_REFUSALS } from './account-self-service-refusal-code.js';

const ctxFor = (path: string, returned: unknown) => ({ path, context: { returned } });

const thrownBy = async (ctx: unknown): Promise<unknown> => {
  try {
    await codeSelfServiceRefusal(ctx);
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('codeSelfServiceRefusal (#29163)', () => {
  it('stamps each listed sentence on its own door, keeping status and message', async () => {
    for (const [path, sentences] of Object.entries(SELF_SERVICE_UNCODED_REFUSALS)) {
      for (const [message, code] of Object.entries(sentences)) {
        const thrown = await thrownBy(ctxFor(path, APIError.fromStatus('BAD_REQUEST', { message })));
        expect(thrown, `${path}: ${message}`).toBeInstanceOf(APIError);
        expect((thrown as APIError).statusCode).toBe(400);
        expect((thrown as APIError).body).toEqual({ code, message });
      }
    }
  });

  it('leaves every other answer alone', async () => {
    const untouched: Array<[string, unknown]> = [
      // a listed sentence on the OTHER door
      ['/update-user', APIError.fromStatus('BAD_REQUEST', { message: 'Email is the same' })],
      // a path the module does not cover
      ['/sign-up/email', APIError.fromStatus('BAD_REQUEST', { message: 'Email is the same' })],
      // an unlisted sentence
      ['/change-email', APIError.fromStatus('BAD_REQUEST', { message: 'Something else' })],
      // already coded by the vendor
      ['/change-email', new APIError('BAD_REQUEST', { message: 'Email is the same', code: 'VENDOR_CODE' })],
      // not a 400
      ['/change-email', APIError.fromStatus('FORBIDDEN', { message: 'Email is the same' })],
      // a success
      ['/change-email', { status: true }],
      // an inherited key is not a door
      ['toString', APIError.fromStatus('BAD_REQUEST', { message: 'Email is the same' })],
    ];
    for (const [path, returned] of untouched) {
      expect(await thrownBy(ctxFor(path, returned)), path).toBeUndefined();
    }
  });
});
