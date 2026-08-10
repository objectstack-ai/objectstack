// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7270] `PermissionDeniedError` / `isPermissionDeniedError` — ONE declaration.
 *
 * `security/resolve-execution-context.ts` used to re-declare both symbols
 * character-for-character from `@objectstack/plugin-security`, with nothing
 * enforcing the identity. Two hand-maintained copies of an ADR-0112 denial
 * envelope (`code: 'PERMISSION_DENIED'`, `statusCode: 403`) are free to drift:
 * edit one `statusCode` and every test still passes while the dispatcher starts
 * answering a denial with the wrong HTTP status on one path only.
 *
 * The duplicate is gone — the runtime module re-exports the plugin's
 * declaration. These tests pin BOTH halves of why that is safe:
 *
 *  1. the two import paths reach the SAME declaration (the assertion that would
 *     have failed while the copy existed), and
 *  2. the matcher is duck-typed, NOT `instanceof`-based — so an instance built
 *     from a *distinct* class object (what dual CJS/ESM output or a bundler
 *     duplicating the module actually produces at runtime) is still recognized.
 *
 * (2) is what makes the re-export sound: it holds whether or not the two sides
 * ever collapse to one class object in a given deployment's module graph.
 */

import { describe, it, expect } from 'vitest';

import {
  PermissionDeniedError as PluginPermissionDeniedError,
  isPermissionDeniedError as pluginIsPermissionDeniedError,
} from '@objectstack/plugin-security';

import {
  PermissionDeniedError as RuntimePermissionDeniedError,
  isPermissionDeniedError as runtimeIsPermissionDeniedError,
} from './resolve-execution-context.js';

/**
 * A stand-in for "the same class, loaded twice" — a second class object with the
 * identical shape, exactly what a CJS/ESM dual load or a bundled second copy of
 * `plugin-security` hands the other side of the boundary. Declared locally on
 * purpose: it must NOT be either package's class, or it proves nothing.
 */
class ForeignPermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly statusCode = 403;
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PermissionDeniedError';
    this.details = details;
  }
}

describe('PermissionDeniedError — single declaration across packages', () => {
  it('runtime re-exports the plugin declaration rather than re-declaring it', () => {
    expect(RuntimePermissionDeniedError).toBe(PluginPermissionDeniedError);
    expect(runtimeIsPermissionDeniedError).toBe(pluginIsPermissionDeniedError);
  });

  it('carries the ADR-0112 denial envelope', () => {
    const e = new PluginPermissionDeniedError('[Security] Access denied: nope', { reason: 'rls' });

    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('PermissionDeniedError');
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.statusCode).toBe(403);
    expect(e.message).toBe('[Security] Access denied: nope');
    expect(e.details).toEqual({ reason: 'rls' });
  });

  it('omits `details` when none is supplied', () => {
    expect(new PluginPermissionDeniedError('denied').details).toBeUndefined();
  });
});

describe('isPermissionDeniedError — cross-package recognition', () => {
  const matchers: Array<[string, (e: unknown) => boolean]> = [
    ['@objectstack/plugin-security', pluginIsPermissionDeniedError],
    ['@objectstack/runtime', runtimeIsPermissionDeniedError],
  ];

  for (const [owner, isPermissionDenied] of matchers) {
    describe(`matcher from ${owner}`, () => {
      it("matches an instance of the plugin's own class", () => {
        expect(isPermissionDenied(new PluginPermissionDeniedError('denied'))).toBe(true);
      });

      it('matches an instance of a DISTINCT class object of the same shape', () => {
        const foreign = new ForeignPermissionDeniedError('denied');

        // The point of the assertion: not the same class, still recognized.
        expect(foreign).not.toBeInstanceOf(PluginPermissionDeniedError);
        expect(isPermissionDenied(foreign)).toBe(true);
      });

      it('matches on `name` alone', () => {
        expect(isPermissionDenied({ name: 'PermissionDeniedError' })).toBe(true);
      });

      it('matches on `code` alone', () => {
        expect(isPermissionDenied({ code: 'PERMISSION_DENIED' })).toBe(true);
      });

      it('rejects unrelated errors and non-objects', () => {
        expect(isPermissionDenied(new Error('boom'))).toBe(false);
        expect(isPermissionDenied({ name: 'NotFoundError', code: 'NOT_FOUND' })).toBe(false);
        expect(isPermissionDenied(null)).toBe(false);
        expect(isPermissionDenied(undefined)).toBe(false);
        expect(isPermissionDenied('PermissionDeniedError')).toBe(false);
      });
    });
  }
});
