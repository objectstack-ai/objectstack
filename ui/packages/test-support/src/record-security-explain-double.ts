/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A recording double for `POST /api/v1/security/explain`.
 *
 * ## Why any test needs it
 *
 * `DetailView` asks whether the record may be updated and deleted through
 * `useRecordEditable`, which reads the host's authenticated `apiFetch` off
 * `SchemaRendererContext` and — with no host supplying one — degrades to the
 * GLOBAL `fetch` by design, so a standalone embed keeps rendering rather than
 * crashing. Under happy-dom that global is a real HTTP client and the document
 * URL defaults to `http://localhost:3000`, so the relative path resolves to a
 * live request and the repo's network-escape guard fails the file.
 *
 * The read is best-effort (a network or parse failure leaves the record
 * editable — fail open), which is why such a test can stay green while the
 * request always fails: the escape is the finding, not the verdict.
 *
 * ⚠️ objectui#9299 made this reach two renderers that had never made the call:
 * `ObjectGrid` and `ObjectTree` render the shared record payload now, so any
 * test of theirs that OPENS the record overlay needs this double.
 *
 * ## What it is, and what it deliberately is not
 *
 * ⛔ NOT a blanket network stub. It records every URL it is handed and answers
 * only the explain route; {@link assertNoOtherNetworkEscape} then fails the
 * test when anything else was requested, so an escape to somewhere else reds
 * where it happened instead of vanishing into `useRecordEditable`'s `catch`.
 *
 * It answers the permissive verdict in the two response shapes the two explain
 * hooks read — `{ record: { visible } }` for a single `recordId`, and
 * `{ records: [{ recordId, visible }] }` for a batched `recordIds`.
 * `useRecordEditable` initialises `allowed` to `true` and its failure path
 * leaves it there, so `true` and the absent verdict an escaping request
 * produced are the same value at every read site — installing this changes no
 * assertion, it only stops the socket.
 *
 * ## Usage
 *
 * ⚠️ The block below is fenced `text`, not `ts`, deliberately:
 * `check:doc-examples` compiles every ts-fenced `@example` on an exported
 * symbol against the BUILT declarations, and this package is `private: true`
 * with no build — `@object-ui/test-support` resolves only through the
 * repository root manifest, which that gate refuses by design. A ts fence here
 * would be a block the gate can never judge rather than one it judges green.
 *
 * ```text
 * import {
 *   assertNoOtherNetworkEscape,
 *   installRecordSecurityExplainDouble,
 * } from '@object-ui/test-support';
 *
 * beforeEach(() => installRecordSecurityExplainDouble(vi));
 * afterEach(() => {
 *   assertNoOtherNetworkEscape(expect);
 *   // Unmount BEFORE restoring the real `fetch` — vitest runs `afterEach`
 *   // hooks in reverse registration order, so this file's teardown runs
 *   // before the root setup's RTL cleanup, and unstubbing first would leave
 *   // the tree mounted with the real global back in place (objectui#7439).
 *   cleanup();
 *   vi.unstubAllGlobals();
 * });
 * ```
 */

/** The one route this double answers. */
export const SECURITY_EXPLAIN_ROUTE = '/api/v1/security/explain';

/** Every URL the installed double was handed, in request order. */
let requestedUrls: string[] = [];

/** The URLs recorded since the last install — read by the assertion below. */
export function recordedExplainRequests(): readonly string[] {
  return requestedUrls;
}

/**
 * Minimal surface of vitest's `vi` this helper needs, declared structurally so
 * this module does not import vitest (it is imported BY test files, which have
 * their own `vi` in scope).
 */
export interface StubGlobalCapable {
  stubGlobal: (name: string, value: unknown) => unknown;
  fn: <T extends (...args: never[]) => unknown>(impl: T) => T;
}

/** Install the double and reset the recording. Call from `beforeEach`. */
export function installRecordSecurityExplainDouble(vi: StubGlobalCapable): void {
  requestedUrls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input
          ? (input as { url: unknown }).url
          : input,
      );
      requestedUrls.push(url);
      if (url !== SECURITY_EXPLAIN_ROUTE) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      let body: { recordId?: unknown; recordIds?: unknown } = {};
      try {
        body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      } catch {
        /* a non-JSON body is not a request this route can answer */
      }
      const recordIds = Array.isArray(body.recordIds) ? body.recordIds : null;
      return {
        ok: true,
        status: 200,
        json: async () =>
          recordIds
            ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
            : { record: { visible: true } },
      };
    }) as never),
  );
}

/** Minimal surface of vitest's `expect` this helper needs. */
export type ExpectCapable = (actual: unknown) => { toEqual: (expected: unknown) => void };

/**
 * Fail when the render reached any URL other than the explain route. Call from
 * `afterEach`, BEFORE `vi.unstubAllGlobals()`.
 */
export function assertNoOtherNetworkEscape(expect: ExpectCapable): void {
  expect(requestedUrls.filter((url) => url !== SECURITY_EXPLAIN_ROUTE)).toEqual([]);
}
