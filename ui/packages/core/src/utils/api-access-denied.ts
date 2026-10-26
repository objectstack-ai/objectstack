/**
 * ObjectUI — the `enable`-block API denial predicate
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { errorCodeIsAnyOf } from '@object-ui/types';

// Homed in core rather than in `@object-ui/data-objectstack`: the predicate is
// a pure read of the ADR-0112 `code`, and `@object-ui/react` asks it
// (`classifyLoadError`) without depending on any one adapter. The adapter
// re-exports both names unchanged.

/**
 * The two denials the server derives from an object's `enable` block —
 * `apiAccessDenialFromEnable` (objectstack `packages/rest/src/rest-server.ts`).
 *
 *   - `OBJECT_API_DISABLED` (404) — `enable.apiEnabled: false`; the object is
 *     not exposed over the data API at all.
 *   - `OBJECT_API_METHOD_NOT_ALLOWED` (405) — the operation is absent from the
 *     `enable.apiMethods` whitelist.
 *
 * Both are **pure functions of the object's metadata**: no user, no permission,
 * no context, no request body. So neither is transient and neither is
 * per-user — when one happens it is a permanent property of that object, and
 * every retry of every persona gets the identical answer.
 *
 * That is exactly why they must not be degraded into "no data". A 404 from a
 * missing collection means *this backend doesn't have that table*, which the
 * optional-collection probes below legitimately read as "feature unavailable";
 * a 404 from `OBJECT_API_DISABLED` means *this page can never work*. Answering
 * the second with an empty result set renders "you have no records" over a
 * surface that is not allowed to have any (objectui#4408 — it also hid the
 * upstream defect objectstack#7544 for its entire life, because a merely
 * unpopulated page invites nobody to click through).
 */
export const API_ACCESS_DENIED_CODES = [
  'OBJECT_API_DISABLED',
  'OBJECT_API_METHOD_NOT_ALLOWED',
] as const;

/**
 * True when `error` is an `enable`-block API denial (see
 * {@link API_ACCESS_DENIED_CODES}).
 *
 * Discriminates on the ADR-0112 `code`, never on the status: 404 alone cannot
 * separate a disabled object from a missing collection, and 405 alone cannot
 * separate a withheld method from any other method rejection. The code survives
 * the transport — `@objectstack/client`'s fetch wrapper stamps `error.code`
 * from the response envelope, and both spellings are declared members of the
 * spec's `StandardErrorCode` — so no heuristic on status is needed or wanted.
 */
export function isApiAccessDeniedError(error: unknown): boolean {
  return errorCodeIsAnyOf(error, API_ACCESS_DENIED_CODES);
}
