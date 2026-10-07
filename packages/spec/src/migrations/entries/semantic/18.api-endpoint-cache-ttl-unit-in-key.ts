// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15677 (stack card 2/6 of #14478, maintainer ruling B: a duration key
// carries its unit in its NAME) — the D3 entry of the
// `api-endpoint-cache-ttl-to-cache-ttl-seconds` family (ruling B on #17152:
// one D3 entry per retirement family, even when D2 is lossless). The card's
// other eleven keys have no conversion and carry their own D3 entries; this
// one has both.
export const entry: SemanticMigration = {
  id: 'api-endpoint-cache-ttl-unit-in-key',
  surface: 'apis[].cacheTtl — the response-cache lifetime of a declared API endpoint',
  replacement: '`cacheTtlSeconds` — the same lifetime, in seconds, with the unit in the key name. It '
    + 'still applies to GET endpoints only.',
  reason: 'The D2 conversion `api-endpoint-cache-ttl-to-cache-ttl-seconds` renames `cacheTtl` to '
    + '`cacheTtlSeconds` in the `apis` collection and on stored endpoint rows, keeping the value, '
    + 'and the rename is lossless: the key always meant seconds. The judgment is whether the '
    + 'author knew that. The unit lived only in the description, on the same endpoint surface '
    + 'where `rateLimit.windowMs` spells its unit in milliseconds, so a value written in '
    + 'milliseconds — `cacheTtl: 60000` meant as one minute — cached responses for almost '
    + 'seventeen hours, and the rename carries 60000 over unchanged. A cache that lives a '
    + 'thousand times longer than intended serves stale data long after the underlying records '
    + 'change, with no error anywhere. Only the author can say which unit each value was written '
    + 'in.',
  acceptanceCriteria: 'No endpoint carries `cacheTtl`; the parse refuses it with the rename. Every '
    + '`cacheTtlSeconds` value is the cache lifetime the author intends in seconds — an endpoint '
    + 'meant to cache for one minute reads `cacheTtlSeconds: 60`. A GET to the endpoint repeated '
    + 'inside that window is answered from the cache, and one repeated after it reflects a record '
    + 'changed in between.',
  relevantWhen: { kind: 'stack-declares', keys: ['apis'] },
};
