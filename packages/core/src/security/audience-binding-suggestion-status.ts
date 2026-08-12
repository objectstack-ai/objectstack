// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7678] The `?status=` vocabulary of the audience-binding suggestion list
 * (ADR-0090 D5/D9) — ONE owner for a rule that had exactly one implementation
 * and two seams needing it.
 *
 * The predicate was written for the runtime dispatcher's `/security` domain and
 * lived there, private. The **live** REST route
 * (`rest-server.ts` → `registerSecurityEndpoints`) is a second seam onto the
 * same service call and never had it, so `?status=garbage` reached the service,
 * matched no row, and answered **200 with an empty list** — which reads as
 * "there are no suggestions", a plausible and actionable-looking answer, rather
 * than "your filter was not a status". That silent arm is the defect; the two
 * seams disagreeing about one contract is the cause.
 *
 * So this module is the convergence, not a copy: `domains/security.ts` and
 * `rest-server.ts` both import from here, and the vocabulary — including the
 * refusal wording — exists once.
 *
 * The record is keyed BY the contract type on purpose (carried over from the
 * original): adding a status to `AudienceBindingSuggestionFilter` leaves a key
 * missing here and renaming one leaves a key excess, and either way this fails
 * to compile. A plain `['pending', …]` array would silently drift.
 */

import type { AudienceBindingSuggestionFilter } from '@objectstack/spec/contracts';

/** The `status` arm of {@link AudienceBindingSuggestionFilter}, named. */
export type AudienceBindingSuggestionStatus = NonNullable<AudienceBindingSuggestionFilter['status']>;

/** The accepted `?status=` values, keyed by the contract type (see module note). */
export const AUDIENCE_BINDING_SUGGESTION_STATUSES: Record<AudienceBindingSuggestionStatus, true> = {
    pending: true,
    confirmed: true,
    dismissed: true,
};

/**
 * The same vocabulary as a list — for refusal messages, and for tests that must
 * enumerate every valid value FROM the type rather than hand-picking one.
 */
export const AUDIENCE_BINDING_SUGGESTION_STATUS_VALUES = Object.keys(
    AUDIENCE_BINDING_SUGGESTION_STATUSES,
) as readonly AudienceBindingSuggestionStatus[];

/**
 * Is `value` one of the three statuses the contract declares? Case-sensitive on
 * purpose — the contract's values are lowercase, so `PENDING` is not a status
 * and gets the same refusal as `garbage`.
 */
export const isAudienceBindingSuggestionStatus = (
    value: string,
): value is AudienceBindingSuggestionStatus =>
    Object.prototype.hasOwnProperty.call(AUDIENCE_BINDING_SUGGESTION_STATUSES, value);

/** The refusal wording, shared so both seams answer an unknown status identically. */
export const unknownAudienceBindingSuggestionStatusMessage = (value: string): string =>
    `Unknown status filter '${value}' — expected one of: ${AUDIENCE_BINDING_SUGGESTION_STATUS_VALUES.join(', ')}`;
