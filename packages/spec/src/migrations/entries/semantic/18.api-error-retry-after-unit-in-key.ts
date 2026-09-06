// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'api-error-retry-after-unit-in-key',
  surface: 'EnhancedApiError.retryAfter (api/errors.zod.ts) — the ADR-0112 error envelope on the wire',
  replacement: 'retryAfterSeconds — rename the key; the value (seconds) is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'BREAKING ON THE WIRE, and ruled in deliberately: the ruling puts the ~16 runtime-emitted '
    + 'measurements in scope because they are read by humans and agents even if nobody authors '
    + 'them, and names ApiError.retryAfter explicitly, with its own BREAKING note. The ambiguity '
    + 'here is sharper than the usual bare duration. A consumer meets TWO retry-after values on '
    + 'the same 429 response: this envelope field, which has always been delta-seconds, and the '
    + 'HTTP Retry-After header, which per RFC 9110 section 10.2.3 may carry EITHER delta-seconds '
    + 'OR an HTTP-date. Spelled identically, they read as one value in two places; spelled '
    + 'retryAfterSeconds, the envelope states its own unit and the header keeps its own rules. '
    + 'THE HTTP HEADER IS A SEPARATE, UNCHANGED SURFACE — its name is fixed outside this repo and '
    + 'nothing in this rename touches it. Do not "fix" the header to match, and do not read a '
    + 'green grep for `retry-after` in transport code as leftover work. A SEMANTIC entry rather '
    + 'than a D2 conversion because an error envelope is emitted, never stored: it is not a stack '
    + 'collection member and never a sys_metadata row, so the conversion chain has no seam that '
    + 'would see one. #15677, #14478, ADR-0087, ADR-0112.',
  acceptanceCriteria:
    'No producer emits `retryAfter` on an ApiError envelope and no consumer reads it; the old '
    + 'spelling is a retiredKey() tombstone that fails tsc at the construction site and fails the '
    + 'parse with the rename prescription. Concretely, check three things. (1) Code building a '
    + 'rate-limit error body: rename the key to `retryAfterSeconds`, value unchanged. (2) Client '
    + 'code backing off on a 429: read `error.retryAfterSeconds`. (3) The transport layer is NOT '
    + 'part of this change — a handler setting the `Retry-After` response header, and a client '
    + 'reading it (including the HTTP-date branch), keep the RFC 9110 spelling and are correct as '
    + 'they stand. A local rate-limiter decision object of the shape { allowed, retryAfter } is '
    + 'not this key either: it is not an ApiError envelope and is untouched.',
};
