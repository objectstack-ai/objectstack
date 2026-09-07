// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B, which put this key explicitly
// IN scope with its own BREAKING note: the ~16 runtime-emitted measurements are
// read by humans and agents even if nobody authors them, `ApiError.retryAfter`
// on the wire envelope included. `retryAfter` bare, beside an HTTP `Retry-After`
// header that may carry EITHER delta-seconds OR an HTTP-date, is precisely the
// ambiguity the rule removes. Renamed to `retryAfterSeconds`; the value is
// unchanged. ⚠️ The HTTP `Retry-After` RESPONSE HEADER is a SEPARATE, UNCHANGED
// surface — its name is fixed by RFC 9110 §10.2.3 and nothing here touches it.
// Tombstoned with `retiredKey()`. No D2 conversion: an ADR-0112 error envelope
// is emitted on the wire, never stored as a metadata row, so the chain has no
// seam; the semantic entry `api-error-retry-after-unit-in-key` carries the
// prescription.
export const entry = 'api/EnhancedApiError:retryAfter';
