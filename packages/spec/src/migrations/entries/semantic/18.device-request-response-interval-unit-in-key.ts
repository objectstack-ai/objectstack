// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'device-request-response-interval-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'DeviceRequestResponse.interval (api/auth-endpoints.zod.ts) — the polling cadence '
    + 'in the device-flow response body',
  replacement: 'intervalSeconds — rename the key; the value (seconds, default 2) is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'This key was ATTRIBUTED to RFC 8628 by the campaign card and reached this card only after '
    + 'the attribution failed verification, so the evidence is recorded here rather than left in a '
    + 'PR body. Ruling B exempts a key that mirrors a name fixed outside this repo, declared on the '
    + 'schema as .meta({ externalVocabulary }) — and DeviceRequestResponseSchema does not mirror '
    + 'RFC 8628 as a SET: `code` is not `device_code`, `verificationUrl` is not '
    + '`verification_uri`, and `expiresAt` is not `expires_in` — a different name AND a different '
    + 'type, an ISO-8601 instant where the RFC carries a relative lifetime. A schema that has '
    + 'already renamed every RFC field it carries into house style cannot claim the standard fixes '
    + 'the one name it left bare. So it is a rename, and deliberately NOT a marker: a wrongly '
    + 'marked key is exempted permanently and silently, while a wrongly renamed one is visible. '
    + 'A SEMANTIC entry rather than a D2 conversion because the shape is RUNTIME-EMITTED — the '
    + 'body of POST /api/v1/auth/device/request, never a stack collection member and never a '
    + 'sys_metadata row, so the conversion chain has no seam that would see one. #15677, #14478, '
    + 'ADR-0087.',
  acceptanceCriteria:
    'No producer emits `interval` and no consumer reads it. The old spelling is a retiredKey() '
    + 'tombstone, so authoring it fails tsc (the key types never) and fails the parse with the '
    + 'rename prescription. Concretely: a CLI or client polling the device-token endpoint reads '
    + '`intervalSeconds` off the request response and waits that many seconds between polls, '
    + 'exactly as `interval` did — the value and its unit are unchanged, only the key name moves.',
};
