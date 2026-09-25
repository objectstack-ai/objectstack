// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/spec/api-assembled` — the API-protocol declarations whose
 * payload embeds the ASSEMBLED package body.
 *
 * A packaging split, not a new protocol: every name here is an API-protocol
 * declaration (`../api/package-api-assembled.zod.ts`, documented and published
 * as JSON Schema under the `api` category). It is served from its own entry
 * because the assembled body links the whole metadata vocabulary plus the
 * datasource and driver-config validators, and `@objectstack/spec/api` — which
 * browser code imports — must not (maintainer ruling on #18576, letter B).
 *
 * Import from here when you need the installed-package rows at the assembled
 * stage, the two package READ responses bound to them, or the package route
 * map; import every other API contract from `@objectstack/spec/api`.
 */
export * from '../api/package-api-assembled.zod';
