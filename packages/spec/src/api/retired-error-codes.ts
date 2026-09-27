// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Retired `StandardErrorCode` members that still answer with a prescription
 *
 * A member removed from the closed `StandardErrorCode` catalogue (`errors.zod.ts`)
 * stops parsing at once — but zod's own enum message only lists the legal codes,
 * which tells a caller still branching on the old spelling THAT it failed and
 * nothing about what to do instead. This table is the "what to do instead" half,
 * keyed by the exact spelling that used to be legal.
 *
 * ## Three doors, one table
 *
 * The catalogue is parsed at three places, and each builds its own `z.enum` — the
 * last two from `StandardErrorCode.options`, which carries the MEMBERS but not the
 * error map, so a prescription declared on the first alone would be silent at the
 * other two:
 *
 * 1. `StandardErrorCode` itself (`errors.zod.ts`) — and through it
 *    `EnhancedApiErrorSchema.code` and the ledger waiver's `shadows`;
 * 2. `ErrorCode` (`error-code-ledger.zod.ts`) — the catalogue ∪ the framework
 *    ledger, which is what `ApiErrorSchema.code` parses against;
 * 3. `makeApiErrorSchema(extraCodes)` (`contract.zod.ts`) — the catalogue ∪ a
 *    downstream product's own ledger.
 *
 * Each passes {@link retiredStandardErrorCodeMessage} as its `error` map. Only a
 * spelling in this table gets the prescription: telling the author of a typo that
 * their code "was removed" would misinform, so everything else keeps zod's own
 * enum message (the `HookBodyCapability` / `object.managedBy: 'system'` shape).
 *
 * ## Package-internal on purpose — NOT re-exported by `api/index.ts`
 *
 * The retirement narrows the accepted set and moves nothing else observable: the
 * package's public API surface (`check:api-surface`) does not gain a name for the
 * machinery that words the refusal.
 */

/**
 * `CONCURRENT_LIMIT_EXCEEDED` — retired under ADR-0049 enforce-or-remove on the
 * ruling recorded on #17707 (A, narrowed to this code alone). Its catalogue
 * sibling `QUOTA_EXCEEDED` stays: a hosted AI agent route emits it and the
 * console's chatbot plugin reads it.
 */
const CONCURRENT_LIMIT_EXCEEDED_RETIRED =
  '`CONCURRENT_LIMIT_EXCEEDED` was removed from `StandardErrorCode` in @objectstack/spec 17.5.0 '
  + '(ADR-0049 enforce-or-remove, ADR-0112 catalogue) — a catalogue code with no producer teaches a '
  + 'branch that cannot fire. Delete any branch on it. For request pacing, branch on '
  + '`RATE_LIMIT_EXCEEDED` (HTTP 429; wait `retryAfterSeconds` before retrying); a service that '
  + 'enforces its own concurrency limit registers a code for it in its own error-code ledger.';

const RETIRED_STANDARD_ERROR_CODES: ReadonlyMap<string, string> = new Map([
  ['CONCURRENT_LIMIT_EXCEEDED', CONCURRENT_LIMIT_EXCEEDED_RETIRED],
]);

/**
 * The `error` map every catalogue door passes to its `z.enum`: the prescription
 * for a retired spelling, `undefined` (zod's own enum message) for anything else.
 */
export function retiredStandardErrorCodeMessage(issue: { input?: unknown }): string | undefined {
  return typeof issue.input === 'string' ? RETIRED_STANDARD_ERROR_CODES.get(issue.input) : undefined;
}
