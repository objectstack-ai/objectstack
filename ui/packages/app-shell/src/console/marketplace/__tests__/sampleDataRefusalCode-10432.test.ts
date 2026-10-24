/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `reseedSampleData` / `purgeSampleData` hand the refusal CODE back, not only
 * its text (objectui#10432).
 *
 * ## The defect
 *
 * Both calls returned `{ ok: false, error: readApiError(payload, res).message }`.
 * `readApiError` reads the code as well, but these two call sites kept only the
 * message, so the code never reached the page.
 *
 * In the 5xx band that loss is total. The control plane withholds the
 * producer's sentence there (cloud#1145), so `message` is the generic constant
 * on every 500. The code is the one member that still says which fault
 * occurred, and cloud#2072 relies on it: a control plane with no environment
 * kernels refuses re-seed / purge with HTTP 500 and
 * `ENVIRONMENT_KERNEL_UNAVAILABLE` (a composition fact, never worth a retry),
 * while `INTERNAL_ERROR` stays the retryable fault. Without the code, the two
 * read as one sentence.
 *
 * ## What the cases pin
 *
 * The status stays 500 in every case. That is the producer's contract, and this
 * consumer does not branch on it. Both code dialects `readApiError` reads are
 * pinned (the nested envelope and the `failWithCode()` sibling `code`), because
 * `readApiError.test.ts` shows these routes answer in both. The INTERNAL_ERROR
 * case shows the code is carried as sent, not special-cased.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgeSampleData, reseedSampleData } from '../marketplaceApi';

/** The withheld 5xx sentence: what `message` holds on every 500. */
const WITHHELD = 'Internal server error';

/** Stub the one request the action makes with a response of `status` and `body`. */
function answer(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 500 ? 'Internal Server Error' : 'OK',
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACTIONS = [
  ['reseedSampleData', reseedSampleData],
  ['purgeSampleData', purgeSampleData],
] as const;

describe.each(ACTIONS)('%s: a refused call keeps its code', (_name, action) => {
  it('a 500 with the declared envelope hands ENVIRONMENT_KERNEL_UNAVAILABLE back beside the withheld sentence', async () => {
    answer(500, { success: false, error: { code: 'ENVIRONMENT_KERNEL_UNAVAILABLE', message: WITHHELD } });

    expect(await action('inst_1')).toEqual({
      ok: false,
      error: WITHHELD,
      code: 'ENVIRONMENT_KERNEL_UNAVAILABLE',
    });
  });

  it('a 500 with the sibling-code dialect hands ENVIRONMENT_KERNEL_UNAVAILABLE back too', async () => {
    answer(500, { success: false, error: WITHHELD, code: 'ENVIRONMENT_KERNEL_UNAVAILABLE' });

    expect(await action('inst_1')).toEqual({
      ok: false,
      error: WITHHELD,
      code: 'ENVIRONMENT_KERNEL_UNAVAILABLE',
    });
  });

  it('a 500 carrying INTERNAL_ERROR hands back INTERNAL_ERROR: the code is carried as sent', async () => {
    answer(500, { success: false, error: { code: 'INTERNAL_ERROR', message: WITHHELD } });

    expect(await action('inst_1')).toEqual({
      ok: false,
      error: WITHHELD,
      code: 'INTERNAL_ERROR',
    });
  });
});
