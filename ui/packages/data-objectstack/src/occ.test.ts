/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  ConcurrentUpdateError,
  isConcurrentUpdateError,
  normaliseClientError,
} from './index';

describe('Optimistic Concurrency Control errors', () => {
  describe('ConcurrentUpdateError', () => {
    it('carries currentVersion + currentRecord and a stable shape', () => {
      const e = new ConcurrentUpdateError({
        currentVersion: '2026-05-22T07:14:00.000Z',
        currentRecord: { id: 'rec_1', name: 'Acme', updated_at: '2026-05-22T07:14:00.000Z' },
        message: 'stale write',
      });
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('ConcurrentUpdateError');
      expect(e.code).toBe('CONCURRENT_UPDATE');
      expect(e.httpStatus).toBe(409);
      expect(e.currentVersion).toBe('2026-05-22T07:14:00.000Z');
      expect((e.currentRecord as any).name).toBe('Acme');
      expect(e.message).toBe('stale write');
    });

    it('defaults to a generic message when none is supplied', () => {
      const e = new ConcurrentUpdateError({ currentVersion: null, currentRecord: null });
      expect(e.message).toMatch(/modified/i);
    });
  });

  describe('isConcurrentUpdateError', () => {
    it('returns true for our typed instances', () => {
      const e = new ConcurrentUpdateError({ currentVersion: null, currentRecord: null });
      expect(isConcurrentUpdateError(e)).toBe(true);
    });

    it('returns true for plain objects with the canonical code', () => {
      expect(isConcurrentUpdateError({ code: 'CONCURRENT_UPDATE' })).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isConcurrentUpdateError(new Error('boom'))).toBe(false);
      expect(isConcurrentUpdateError({ code: 'NOT_FOUND' })).toBe(false);
      expect(isConcurrentUpdateError(null)).toBe(false);
      expect(isConcurrentUpdateError(undefined)).toBe(false);
      expect(isConcurrentUpdateError('CONCURRENT_UPDATE')).toBe(false);
    });
  });

  describe('normaliseClientError', () => {
    it('returns the original error when it is not a 409 CONCURRENT_UPDATE', () => {
      const generic = Object.assign(new Error('not found'), {
        code: 'NOT_FOUND',
        httpStatus: 404,
      });
      expect(normaliseClientError(generic)).toBe(generic);
    });

    it('returns the original error for non-object inputs', () => {
      expect(normaliseClientError(null)).toBe(null);
      expect(normaliseClientError(undefined)).toBe(undefined);
      expect(normaliseClientError('boom')).toBe('boom');
    });

    it('wraps an upstream 409 CONCURRENT_UPDATE into a typed ConcurrentUpdateError', () => {
      const upstream = Object.assign(new Error('Record was modified by another user'), {
        code: 'CONCURRENT_UPDATE',
        httpStatus: 409,
        details: {
          currentVersion: '2026-05-22T07:14:00.000Z',
          currentRecord: { id: 'rec_1', name: 'Acme' },
        },
      });
      const normalised = normaliseClientError(upstream);
      expect(isConcurrentUpdateError(normalised)).toBe(true);
      const typed = normalised as ConcurrentUpdateError;
      expect(typed.currentVersion).toBe('2026-05-22T07:14:00.000Z');
      expect((typed.currentRecord as any).name).toBe('Acme');
      expect(typed.message).toBe('Record was modified by another user');
    });

    it('tolerates a missing details payload', () => {
      const upstream = Object.assign(new Error('stale'), {
        code: 'CONCURRENT_UPDATE',
        httpStatus: 409,
      });
      const normalised = normaliseClientError(upstream) as ConcurrentUpdateError;
      expect(isConcurrentUpdateError(normalised)).toBe(true);
      expect(normalised.currentVersion).toBeNull();
      expect(normalised.currentRecord).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // objectui#6375 — the discriminator truth table, one row per input class.
  //
  // `normaliseClientError`'s re-wrap is decided by the wire `code` ALONE;
  // `httpStatus` participates in no outcome. That was already true before
  // objectui#6375 deleted the subsumed `code !== ... && httpStatus !== 409`
  // guard, and it is still true after — the deletion is a no-op by
  // construction, so "behaviour unchanged" on its own would pin nothing.
  //
  // What earns these rows their keep is the ASYMMETRY: the two 409-carrying
  // passthrough rows below go RED under the *other* possible deletion (drop
  // the `code !== 'CONCURRENT_UPDATE'` line and keep the conjunction), under
  // which a 409 whose code is something else would fall through and be
  // re-wrapped as a ConcurrentUpdateError it never was. So this block is
  // about which line was deleted, not about the function existing.
  // ---------------------------------------------------------------------
  describe('normaliseClientError: the wire code alone decides the re-wrap', () => {
    /** A client error carrying exactly the fields under test (`name` stays `Error`). */
    const clientError = (props: Record<string, unknown>) =>
      Object.assign(new Error('upstream'), props);

    it('passes through an error with neither the code nor a 409', () => {
      const e = clientError({ code: 'NOT_FOUND', httpStatus: 404 });
      expect(normaliseClientError(e)).toBe(e);
    });

    // ASYMMETRY ROW: red under the wrong deletion, green under this one.
    it('passes through a 409 whose code is NOT CONCURRENT_UPDATE', () => {
      const e = clientError({ code: 'PRECONDITION_FAILED', httpStatus: 409 });
      expect(normaliseClientError(e)).toBe(e);
      expect(normaliseClientError(e)).not.toBeInstanceOf(ConcurrentUpdateError);
    });

    // ASYMMETRY ROW: red under the wrong deletion, green under this one.
    it('passes through a bare 409 carrying no code at all', () => {
      const e = clientError({ httpStatus: 409 });
      expect(normaliseClientError(e)).toBe(e);
      expect(normaliseClientError(e)).not.toBeInstanceOf(ConcurrentUpdateError);
    });

    it('re-wraps the canonical 409 + CONCURRENT_UPDATE', () => {
      const e = clientError({ code: 'CONCURRENT_UPDATE', httpStatus: 409 });
      expect(normaliseClientError(e)).toBeInstanceOf(ConcurrentUpdateError);
    });

    // The two rows that show `httpStatus` decides nothing on the accepting
    // side either: the code re-wraps with a wrong status, and with none.
    it('re-wraps CONCURRENT_UPDATE carrying no httpStatus', () => {
      const e = clientError({ code: 'CONCURRENT_UPDATE' });
      expect(normaliseClientError(e)).toBeInstanceOf(ConcurrentUpdateError);
    });

    it('re-wraps CONCURRENT_UPDATE carrying a non-409 httpStatus', () => {
      const e = clientError({ code: 'CONCURRENT_UPDATE', httpStatus: 500 });
      expect(normaliseClientError(e)).toBeInstanceOf(ConcurrentUpdateError);
    });
  });

  // The accepted set of the exported predicate, pinned because objectui#6375
  // DECIDED to keep its `name === 'ConcurrentUpdateError'` limb rather than
  // narrow it to the code. The limb is the cross-realm discriminator — see
  // the rationale stated in the doc comment above `isConcurrentUpdateError`.
  // A future reader who removes it as drift meets this row first.
  describe('isConcurrentUpdateError: code OR class name, and never the status', () => {
    it('accepts the class name with no wire code — the cross-realm limb', () => {
      expect(isConcurrentUpdateError({ name: 'ConcurrentUpdateError' })).toBe(true);
    });

    it('rejects a bare 409: the status is not a discriminator here either', () => {
      expect(isConcurrentUpdateError({ httpStatus: 409 })).toBe(false);
    });

    it('rejects a different class name', () => {
      expect(isConcurrentUpdateError({ name: 'ValidationError' })).toBe(false);
    });
  });
});
