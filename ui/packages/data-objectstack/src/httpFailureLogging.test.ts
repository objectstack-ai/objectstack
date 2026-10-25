/**
 * objectui#4042 half 2 — a request failure must SAY which request failed.
 *
 * `@objectstack/client` reports every non-2xx as
 * `logger.error("HTTP request failed", undefined, { method, url, status, error })`.
 * The console's logger used to forward that verbatim, so the identifying
 * fields lived only in the third argument: anything that flattens a console
 * record to text rendered them `[object Object]` / `Object`, and a screenful of
 * failures told you nothing about which URL or which status. These tests pin
 * that the message string itself now carries method + url + status (+ code).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatHttpFailureMessage, createQuietHttpLogger } from './index';

const META_401 = {
  method: 'GET',
  url: '/api/v1/meta/object',
  status: 401,
  error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
};

describe('formatHttpFailureMessage', () => {
  it('folds method, url and status into the message', () => {
    expect(formatHttpFailureMessage('HTTP request failed', META_401)).toBe(
      'HTTP request failed: GET /api/v1/meta/object -> 401 [UNAUTHORIZED]',
    );
  });

  it('omits the code when the body carries none', () => {
    expect(
      formatHttpFailureMessage('HTTP request failed', {
        method: 'POST',
        url: '/api/v1/data/task',
        status: 500,
      }),
    ).toBe('HTTP request failed: POST /api/v1/data/task -> 500');
  });

  it('reads the `statusCode` spelling too', () => {
    expect(
      formatHttpFailureMessage('HTTP request failed', { url: '/api/v1/meta/app', statusCode: 403 }),
    ).toBe('HTTP request failed: GET /api/v1/meta/app -> 403');
  });

  it('returns null — not a husk — when meta identifies nothing', () => {
    expect(formatHttpFailureMessage('HTTP request failed', undefined)).toBeNull();
    expect(formatHttpFailureMessage('HTTP request failed', {})).toBeNull();
    expect(formatHttpFailureMessage('HTTP request failed', { error: { message: 'boom' } })).toBeNull();
  });

  it('never yields the un-diagnosable string the card reported', () => {
    const line = formatHttpFailureMessage('HTTP request failed', META_401)!;
    expect(line).not.toContain('[object Object]');
    expect(line).toContain('/api/v1/meta/object');
    expect(line).toContain('401');
  });
});

describe('createQuietHttpLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a 401 as an error whose FIRST argument identifies the request', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createQuietHttpLogger().error('HTTP request failed', undefined, META_401);

    expect(spy).toHaveBeenCalledTimes(1);
    const [message, , meta] = spy.mock.calls[0];
    expect(message).toBe('HTTP request failed: GET /api/v1/meta/object -> 401 [UNAUTHORIZED]');
    // The structured bag is still handed over for DevTools to expand — the
    // string is added alongside it, not instead of it.
    expect(meta).toEqual(META_401);
  });

  it('keeps demoting an expected 404, and identifies it in the demoted line too', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    createQuietHttpLogger().error('HTTP request failed', undefined, {
      method: 'GET',
      url: '/api/v1/data/sys_presence',
      status: 404,
      error: { code: 'OBJECT_NOT_FOUND' },
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0][0]).toContain('/api/v1/data/sys_presence -> 404');
  });

  it('does NOT silence a 401 — only 404-on-an-optional-collection is demoted', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // Session expiry mid-use: the console gates doomed requests, it does not
    // hide the ones that still fail.
    createQuietHttpLogger().error('HTTP request failed', undefined, META_401);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('falls back to the bare message when there is nothing to identify', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createQuietHttpLogger().error('Something broke', undefined, undefined);

    expect(spy.mock.calls[0][0]).toBe('Something broke');
  });
});
