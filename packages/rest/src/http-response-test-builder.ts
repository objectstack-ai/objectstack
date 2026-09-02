// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one place this package builds an `IHttpResponse` for a test (#13454).
 *
 * Test layer only — nothing in `src/index.ts` reaches it, so tsup (entry:
 * `src/index.ts`) never emits it into `dist` and it is not published. Same
 * placement, and for the same reason, as `src/http-request-test-builder.ts`
 * and `src/xlsx-test-loader.ts`.
 *
 * ## The defect, stated once
 *
 * `IHttpResponse` (`packages/spec/src/contracts/http-server.ts`) declares FOUR
 * required members — `json`, `send`, `status`, `header` — and a route handler's
 * SECOND parameter IS that interface. So a test that hands a handler an object
 * literal owes all four. This package hands it two:
 *
 * ```
 * src/rest.test.ts(2065,7): error TS2345: Argument of type
 *   '{ json: Mock<Procedure>; status: Mock<Procedure>; }'
 *   is not assignable to parameter of type 'IHttpResponse'.
 *   Type '{ json: Mock<Procedure>; status: Mock<Procedure>; }' is missing the
 *   following properties from type 'IHttpResponse': send, header
 * ```
 *
 * ⚠️ Those two errors were never absent — they were MASKED. `tsc` reports at
 * most one argument-assignability error per call expression, so while argument
 * 1 was a non-conforming request literal it hid argument 2 entirely; repairing
 * the request half (#13377) is what made them visible, at the very same two
 * sites and with the per-file ledger count unmoved at 2. That mechanism has not
 * gone away and is why the repair here is one builder rather than two edits:
 * the decision about what a mock response IS belongs in a place a reader can
 * find, not spread across the 28 literals of this shape that this file holds.
 *
 * ## Why each decision is the decision
 *
 * **All four required members are present, always — including the two the
 * literals omit.** `send` and `header` are absent from those literals not
 * because a fixture means "this response cannot do that", but because whoever
 * wrote it stopped at the members the handler happened to call. Supplying them
 * is strictly better-formed than omitting them: had a handler reached
 * `res.header(...)`, the literal would have THROWN, and the test would have
 * failed for a reason unrelated to the thing it names. Same argument as
 * `headers: {}` in the request builder.
 *
 * **`status` and `header` return the double, and are TYPED as returning the
 * interface.** The contract declares `status(code: number): IHttpResponse`, and
 * that return is load-bearing rather than decorative — it is what makes
 * `res.status(404).json(...)` chain, which is how `src/rest-server.ts` writes
 * essentially every response it sends (138 `.status(` call sites). The literals
 * spell this `vi.fn().mockReturnThis()`, which is right at runtime only while
 * the member is invoked as a method on the response, and is typed
 * `Mock<Procedure>` — returning `any` — either way. Returning `double`
 * explicitly is true under any call shape, and it means a chained `.json(...)`
 * lands on the SAME spy the test asserts on whether the handler chained or not.
 *
 * **`write` and `end` are deliberately ABSENT, and have no default at all.**
 * This is the `remoteAddress` argument of the request builder, and it is the
 * one default here that could silently change what a test measures. Both are
 * optional AND feature-detected: the contract on `write` (#3607, ADR-0076
 * OQ#10) says consumers emitting streaming results "feature-detect this member
 * and fall back to buffered `send()` when absent". A double that supplied them
 * by default would therefore route every streaming handler down its streaming
 * path — no test edited, every such test now measuring something else. Absent
 * is both legal and true; a test that is ABOUT streaming says so, by stating
 * them.
 *
 * **The double records through its spies and nowhere else.** This is the design
 * question the card raised — what a mock response records, and what a test may
 * assert on it — and the answer is that it already has exactly one record:
 * `res.status.mock.calls` IS the status record, `res.json.mock.calls` IS the
 * body record, and both are what the existing assertions read
 * (`expect(res.json).toHaveBeenCalledWith(...)`,
 * `res.json.mock.calls.at(-1)![0]`). A mirrored `statusCode` / `body` pair
 * would be a SECOND, derived record of the same call, and the two can disagree:
 * a mirror keeps only the last status where `mock.calls` keeps every one, and
 * `mockClear()` empties one and not the other. One record, not two.
 *
 * ⚠️ Three other files in this package — `analytics-dataset-dimension-gate`,
 * `meta-public-book-grant`, `rest-batch-size-cap` — assert on a mirrored
 * `res.statusCode` / `res.body` built by a local `makeRes()` typed `any`. They
 * are green for the forbidden reason rather than conforming, but they cannot
 * adopt this builder by substitution: converting those reads into spy reads
 * CHANGES the assertion, so it is a decision of its own rather than a mechanical
 * edit. Recorded here so the omission is not read as an oversight.
 *
 * **It takes no parameters.** `httpRequestForRoute` needs them because a
 * request carries fixture DATA that differs per test. A response double carries
 * none — it is a pure recorder — so there is nothing per-site to state, and an
 * options bag would be surface with no caller.
 */

import { vi, type Mock } from 'vitest';
import type { RouteHandler } from '@objectstack/core';

/**
 * The response type a handler is actually handed, read off the handler's own
 * signature instead of spelled by hand — the discipline `xlsx-test-loader.ts`
 * applies to its dependency and `http-request-test-builder.ts` applies to the
 * request half. It resolves to `IHttpResponse`.
 */
type HandlerResponse = Parameters<RouteHandler>[1];

/** Any callable — `Mock<T>` demands `T` be one, and this states it locally. */
type AnyProcedure = (...args: any[]) => any;

/**
 * The members the contract REQUIRES, computed from the contract rather than
 * listed. A required member added to `IHttpResponse` therefore fails HERE,
 * loudly, in one file — the double below stops satisfying its own type — rather
 * than leaving a helper that still compiles and lies.
 */
type RequiredResponseMember = {
    [K in keyof HandlerResponse]-?: undefined extends HandlerResponse[K] ? never : K;
}[keyof HandlerResponse];

/**
 * A complete `IHttpResponse` whose required members are vitest spies, so a test
 * can pass it to a handler AND assert on what the handler did with it. The
 * optional `write` / `end` stay optional and absent — see the header.
 */
export type HttpResponseTestDouble = HandlerResponse & {
    [K in RequiredResponseMember]: Mock<Extract<HandlerResponse[K], AnyProcedure>>;
};

/**
 * Build a conforming response double for a handler under test.
 *
 * @returns a response satisfying every required member of `IHttpResponse`,
 *          recording each call on the corresponding spy, with `status` and
 *          `header` returning the same double so handler chains land on the
 *          spies the test reads.
 */
export function httpResponseTestDouble(): HttpResponseTestDouble {
    const double: HttpResponseTestDouble = {
        json: vi.fn<HandlerResponse['json']>(),
        send: vi.fn<HandlerResponse['send']>(),
        status: vi.fn<HandlerResponse['status']>(() => double),
        header: vi.fn<HandlerResponse['header']>(() => double),
    };
    return double;
}
