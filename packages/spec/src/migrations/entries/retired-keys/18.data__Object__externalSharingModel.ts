// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23268 — ADR-0049 enforce-or-remove; ruling of record 6159300530, letter A.
// `Object.externalSharingModel` was ADR-0090 D11's external org-wide default.
// Measured before removal: no row-pipeline reader in any package (the only
// readers were the publish linter's alias / wider-than-internal branches and the
// posture gate's env-tighten comparison, all authoring checks of the key against
// itself), and no runtime principal is external (`audience: undefined`). The
// kernel's `EXTERNAL` rung (ADR-0095 / ADR-0099) is explicitly shared rows only.
// `retiredKey()` on the strict object shape, for the prescription and the `tsc`
// channel. D2: `object-external-sharing-model-removed`; D3:
// `object-external-sharing-model-retired`.
export const entry = 'data/Object:externalSharingModel';
