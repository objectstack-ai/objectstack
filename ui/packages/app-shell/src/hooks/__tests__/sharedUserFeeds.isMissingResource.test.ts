/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #4225 rider — one `isMissingResource`, not three.
 *
 * `sharedUserFeeds`, `AppHeader`'s inbox poller and `useHomeInbox` each carried
 * their own copy of this predicate. It is not a formatting detail that they
 * did: the predicate decides which of two OPPOSITE things a failed read means —
 *
 *   - true  ⇒ this deployment does not have the object. Nothing is waiting on
 *             the user, the feed degrades to empty, the poll retires, and the
 *             affirmative empty copy is honest ("You're all caught up").
 *   - false ⇒ the read of a present object failed. The empty value is the
 *             ABSENCE of an answer and the surface must say so (#4235).
 *
 * Three copies of that split is three chances for one of them to drift, and the
 * drift is silent in the worst direction: a denial re-classified as "missing"
 * reproduces exactly the objectstack#7344 lie #4235 was filed to kill. These
 * pin both polarities on the one surviving definition.
 */
import { describe, it, expect } from 'vitest';
import { isMissingResource } from '../sharedUserFeeds';

/** The ObjectStack client's rejection shape: `httpStatus`, plus an error code. */
function clientError(over: { httpStatus?: number; status?: number; code?: string }): Error {
  return Object.assign(new Error('read failed'), over);
}

describe('isMissingResource — the 404-is-an-answer split (#4225 rider)', () => {
  it('is true for the client\'s `httpStatus` 404', () => {
    // The spelling that matters: the ObjectStack client throws `httpStatus`,
    // NOT `status`, and a copy that only checked `status` would classify every
    // genuinely-missing object as a failure.
    expect(isMissingResource(clientError({ httpStatus: 404 }))).toBe(true);
  });

  it('is true for a plain `status` 404 as well', () => {
    expect(isMissingResource(clientError({ status: 404 }))).toBe(true);
  });

  it('is true for an OBJECT_NOT_FOUND error code without any status', () => {
    expect(isMissingResource(clientError({ code: 'OBJECT_NOT_FOUND' }))).toBe(true);
  });

  it('is FALSE for the objectstack#7344 permission denial', () => {
    // The case the whole split exists for. A 403 is a present object this
    // caller may not read — an error, never "you have no inbox".
    expect(isMissingResource(clientError({ httpStatus: 403, code: 'PERMISSION_DENIED' }))).toBe(
      false,
    );
  });

  it('is FALSE for a server error, a network throw and a non-error value', () => {
    expect(isMissingResource(clientError({ httpStatus: 500 }))).toBe(false);
    expect(isMissingResource(new TypeError('Failed to fetch'))).toBe(false);
    expect(isMissingResource(null)).toBe(false);
    expect(isMissingResource(undefined)).toBe(false);
  });
});
