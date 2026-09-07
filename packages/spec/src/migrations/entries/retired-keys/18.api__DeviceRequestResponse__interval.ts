// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B: the unit lives in the key NAME.
// `DeviceRequestResponse.interval` named seconds only in its describe. Renamed
// to `intervalSeconds`; the value is unchanged. Checked against ruling B's
// SECOND exemption before renaming — a key mirroring a name fixed outside this
// repo carries `.meta({ externalVocabulary })` — and it does not qualify:
// `DeviceRequestResponseSchema` does not mirror RFC 8628 as a set (`code` is
// not `device_code`, `verificationUrl` is not `verification_uri`, `expiresAt`
// is not `expires_in` and holds an ISO-8601 string where the RFC has a relative
// lifetime), so a schema that already renames every RFC field it carries cannot
// claim the standard fixes this one. Tombstoned with `retiredKey()`. No D2
// conversion: this is a RUNTIME-EMITTED device-flow response body, never a
// stored row; the semantic entry `device-request-response-interval-unit-in-key`
// carries the prescription.
export const entry = 'api/DeviceRequestResponse:interval';
