/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3529 — a failed commit-store call must carry its KIND, not a number.
 *
 * The classes below are the ones whose operator dispositions differ, and the
 * point of every case is that they stay TELLABLE APART. Two properties are
 * pinned on every error path because losing either is the failure this surface
 * cannot afford (ADR-0110 D3 / objectstack#5980):
 *
 *   - it never swallows — the promise rejects, it does not resolve;
 *   - it never resolves to `[]`, which the panel would render as "no history".
 *
 * The 503 cases also pin the thing the issue body got wrong: the envelope's
 * `message` for this class is the WITHHELD generic string, so a fix that
 * rendered the envelope message would have shipped `Internal server error`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommitStoreError,
  fetchCommits,
  isCommitStoreUnreachable,
  revertCommit,
} from '../commitHistory';

afterEach(() => {
  vi.restoreAllMocks();
  // `vi.restoreAllMocks()` does NOT undo a global replaced by hand, and this
  // file runs in the `unit` project, which is `isolate: false` — a `fetch` left
  // behind here is inherited by every later file in the worker (objectui#8500).
  // So the doubles below go in through `vi.stubGlobal` and come back out here.
  vi.unstubAllGlobals();
});

/** A response whose body is JSON. */
function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * A response with NO parseable body — a proxy shedding load answers 503 with
 * HTML, so `json()` rejects. The classification must survive it.
 */
function unparseableResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };
}

function mockFetch(response: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => response) as unknown as typeof fetch);
}

/**
 * The real 503 envelope for this route, reproduced from the producer rather
 * than imagined: `HttpDispatcher.errorFromThrown` parks the thrown error's
 * `.code` in `details`, `buildApiError`/`splitSemanticCode` lift it to
 * `error.code` and drop `details`, and `declaresServerFault` (status >= 500 with
 * a string code — true here) replaces the prose with `INTERNAL_ERROR_MESSAGE`.
 */
const OUTAGE_ENVELOPE = {
  success: false,
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Internal server error',
    httpStatus: 503,
  },
};

describe('fetchCommits — 503 / SERVICE_UNAVAILABLE is the retryable class', () => {
  it('classifies the real outage envelope as retryable, with status and code intact', async () => {
    mockFetch(jsonResponse(503, OUTAGE_ENVELOPE));

    const err = await fetchCommits('com.x').then(
      () => {
        throw new Error('fetchCommits resolved on a 503 — it must reject');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CommitStoreError);
    expect(isCommitStoreUnreachable(err)).toBe(true);
    expect((err as CommitStoreError).status).toBe(503);
    expect((err as CommitStoreError).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('does NOT render the withheld envelope prose — the whole point of the card', async () => {
    mockFetch(jsonResponse(503, OUTAGE_ENVELOPE));

    const err = (await fetchCommits('com.x').catch((e: unknown) => e)) as CommitStoreError;

    // The producer withholds the sentence for this class; echoing it would show
    // the operator `Internal server error` and lose the status as well.
    expect(err.message).not.toContain('Internal server error');
    expect(err.message).toContain('unreachable');
    // And it is no longer the bare status code the card was filed about.
    expect(err.message).not.toBe('commits HTTP 503');
  });

  it('a BARE 503 (proxy HTML, no envelope) is still retryable — status alone decides', async () => {
    mockFetch(unparseableResponse(503));

    const err = (await fetchCommits('com.x').catch((e: unknown) => e)) as CommitStoreError;

    expect(isCommitStoreUnreachable(err)).toBe(true);
    expect(err.status).toBe(503);
    expect(err.code).toBeNull();
    expect(err.message).toContain('unreachable');
  });
});

describe('fetchCommits — the non-retryable classes stay distinguishable', () => {
  it('404 is not retryable and keeps the store’s own answer', async () => {
    mockFetch(
      jsonResponse(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Package not found', httpStatus: 404 },
      }),
    );

    const err = (await fetchCommits('com.x').catch((e: unknown) => e)) as CommitStoreError;

    expect(isCommitStoreUnreachable(err)).toBe(false);
    expect(err.status).toBe(404);
    // A 4xx message is NOT withheld by the producer, so it is worth showing.
    expect(err.message).toBe('Package not found');
  });

  it('404 without an envelope keeps the pre-existing text verbatim', async () => {
    mockFetch(unparseableResponse(404));

    const err = (await fetchCommits('com.x').catch((e: unknown) => e)) as CommitStoreError;

    expect(isCommitStoreUnreachable(err)).toBe(false);
    expect(err.message).toBe('commits HTTP 404');
  });

  it('500 is NOT retryable — "any 5xx" would erase the distinction the card asks for', async () => {
    mockFetch(unparseableResponse(500));

    const err = (await fetchCommits('com.x').catch((e: unknown) => e)) as CommitStoreError;

    expect(isCommitStoreUnreachable(err)).toBe(false);
    expect(err.status).toBe(500);
    expect(err.message).toBe('commits HTTP 500');
  });

  it('404, 500 and 503 produce three different messages', async () => {
    const messages: string[] = [];
    for (const status of [404, 500, 503]) {
      mockFetch(unparseableResponse(status));
      const err = (await fetchCommits('com.x').catch((e: unknown) => e)) as CommitStoreError;
      messages.push(err.message);
    }
    expect(new Set(messages).size).toBe(3);
  });
});

describe('fetchCommits — fail-loud, on every failing path', () => {
  it.each([
    ['503 with envelope', () => mockFetch(jsonResponse(503, OUTAGE_ENVELOPE))],
    ['503 bare', () => mockFetch(unparseableResponse(503))],
    ['404', () => mockFetch(unparseableResponse(404))],
    ['500', () => mockFetch(unparseableResponse(500))],
    [
      'network rejection',
      () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => {
            throw new TypeError('Failed to fetch');
          }) as unknown as typeof fetch,
        );
      },
    ],
  ])('%s never resolves, and never resolves to an empty history', async (_label, arrange) => {
    arrange();

    const outcome = await fetchCommits('com.x').then(
      (v) => ({ resolved: true as const, value: v }),
      () => ({ resolved: false as const }),
    );

    expect(outcome.resolved).toBe(false);
  });

  it('a rejected fetch is NOT dressed up as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );

    const err = await fetchCommits('com.x').catch((e: unknown) => e);

    // A transport failure is not the same claim as "the store said 503", and
    // promising a retry we cannot justify is how a fail-loud surface starts lying.
    expect(isCommitStoreUnreachable(err)).toBe(false);
    expect(err).toBeInstanceOf(TypeError);
  });
});

describe('fetchCommits — the success path is untouched', () => {
  it('still maps the `{ commits: [...] }` envelope', async () => {
    mockFetch(
      jsonResponse(200, {
        commits: [
          { id: 'c1', operation: 'apply', itemCount: 3, actor: 'ada' },
          { id: 'c2', operation: 'revert', itemCount: 1 },
        ],
      }),
    );

    const commits = await fetchCommits('com.x');

    expect(commits).toEqual([
      { id: 'c1', operation: 'apply', itemCount: 3, actor: 'ada', message: undefined, aiModel: undefined, createdAt: undefined },
      { id: 'c2', operation: 'revert', itemCount: 1, message: undefined, actor: undefined, aiModel: undefined, createdAt: undefined },
    ]);
  });
});

describe('revertCommit — the WRITE half gets the same classification', () => {
  it('503 is retryable, and does not echo the withheld prose', async () => {
    mockFetch(jsonResponse(503, OUTAGE_ENVELOPE));

    const err = await revertCommit('com.x', 'c1').then(
      () => {
        throw new Error('revertCommit resolved on a 503 — it must reject');
      },
      (e: unknown) => e as CommitStoreError,
    );

    expect(isCommitStoreUnreachable(err)).toBe(true);
    expect(err.status).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.message).not.toContain('Internal server error');
  });

  it('a bare 503 is retryable here too', async () => {
    mockFetch(unparseableResponse(503));

    const err = (await revertCommit('com.x', 'c1').catch((e: unknown) => e)) as CommitStoreError;

    expect(isCommitStoreUnreachable(err)).toBe(true);
  });

  it('404 keeps the endpoint’s own message and is not retryable', async () => {
    mockFetch(
      jsonResponse(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Commit not found', httpStatus: 404 },
      }),
    );

    const err = (await revertCommit('com.x', 'c1').catch((e: unknown) => e)) as CommitStoreError;

    expect(isCommitStoreUnreachable(err)).toBe(false);
    expect(err.message).toBe('Commit not found');
  });

  it('the legacy `error: "text"` string form still reads (pre-existing behaviour)', async () => {
    mockFetch(jsonResponse(400, { success: false, error: 'commitId is required' }));

    const err = (await revertCommit('com.x', 'c1').catch((e: unknown) => e)) as CommitStoreError;

    expect(err.message).toBe('commitId is required');
    expect(isCommitStoreUnreachable(err)).toBe(false);
  });

  it('a 200 that answers `success: false` still throws', async () => {
    mockFetch(jsonResponse(200, { success: false, error: { message: 'nothing to revert' } }));

    const err = (await revertCommit('com.x', 'c1').catch((e: unknown) => e)) as CommitStoreError;

    expect(err.message).toBe('nothing to revert');
  });

  it('resolves on success', async () => {
    mockFetch(jsonResponse(200, { success: true, data: { success: true } }));

    await expect(revertCommit('com.x', 'c1')).resolves.toBeUndefined();
  });
});

describe('isCommitStoreUnreachable', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain Error', new Error('boom')],
    ['a string', 'SERVICE_UNAVAILABLE'],
    ['an object with retryable: false', { retryable: false }],
    ['an object with a truthy non-true retryable', { retryable: 1 }],
  ])('is false for %s', (_label, value) => {
    expect(isCommitStoreUnreachable(value)).toBe(false);
  });

  it('is true for the error this module throws', () => {
    expect(
      isCommitStoreUnreachable(new CommitStoreError('x', { status: 503, retryable: true })),
    ).toBe(true);
  });
});
