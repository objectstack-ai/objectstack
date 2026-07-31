// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE answer to "which columns does the registry inject on (almost) every
 * object without them appearing in authored `fields`?" (#4330).
 *
 * Every field-resolving rule in this package needs that answer: a reference to
 * `created_at` or `owner_id` is authored against a real, addressable column
 * even though no object declares it, so flagging it would be the false finding
 * that makes authors stop trusting the linter (ADR-0072 D1). Before this
 * module, five rules each carried their own hand-copied list and had already
 * drifted from one another — the exact shape #3786 removed from the
 * audit-provenance family, rebuilt one package over.
 *
 * DERIVED from the spec's two declarations, so it cannot drift from them:
 *
 * - {@link FIELD_GROUP_SYSTEM_FIELDS} (`@objectstack/spec/data`) — audit
 *   provenance plus `organization_id` / `tenant_id` / `is_deleted` /
 *   `deleted_at`;
 * - {@link SystemFieldName} (`@objectstack/spec/system`) — the protocol-level
 *   ids: `id`, `owner_id`, `user_id` and the timestamp/tenant columns.
 *
 * The union is deliberately generous, because the cost asymmetry is the same
 * in every consumer: over-inclusion costs at worst a missed finding on a
 * `systemFields: false` object (rare); under-inclusion costs a false one.
 *
 * What does NOT belong here: names that are ordinary AUTHORED fields on most
 * objects (`name`, `owner`, `record_type`) or legacy physical spellings
 * (`_id`, `space`). A rule that deliberately exempts those keeps them in a
 * rule-local extension next to its reason — adding them here would silently
 * stop every other rule from catching a reference to a field the object
 * genuinely does not have.
 */

import { FIELD_GROUP_SYSTEM_FIELDS } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

/**
 * Registry-injected columns addressable at runtime without being authored in
 * `fields` — the union of the spec's two system-field declarations.
 */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set<string>([
  ...FIELD_GROUP_SYSTEM_FIELDS,
  ...Object.values(SystemFieldName),
]);
