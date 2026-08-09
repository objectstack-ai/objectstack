// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7018 — the #6190 ruling's runtime half] Which metadata WRITES carry the
 * session's active organization, and which land env-wide.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * The dispatcher used to thread `resolveActiveOrganizationId` into
 * `protocol.saveMetaItem` **unconditionally**, and
 * `SysMetadataRepository.put` stamps `organization_id: this.organizationId`
 * whatever the type is. So a session with an active organization minted an
 * org-scoped `sys_metadata` row for EVERY type — including the ones the
 * registry declares NOT per-org overridable.
 *
 * Cold boot walks past exactly those rows: `loadMetaFromDb` hydrates
 * `organization_id IS NULL` only, and for `allowOrgOverride: true` types that
 * is the ADR-0005 design (their overlays are loaded on demand by
 * `getMetaItem`/`getMetaItems`). For every other type there is no per-org read
 * channel at all, so the row is a **phantom write**: it works for the life of
 * the process and is silently absent after the next restart. The measured
 * specimens are `flow` (binds its triggers until the restart, then stops
 * firing — `@objectstack/metadata-protocol`'s `reportUnhydratableOrgScopedRows`
 * warns about precisely this) and `object` (every record 404s).
 *
 * The maintainer ruling on #6190 (2026-08-09, Option A) is that the runtime
 * stops minting them: thread the org only for types that declare
 * `allowOrgOverride: true`; otherwise the write lands env-wide — the same row
 * a no-active-org session already produces today.
 *
 * ── Why the STATIC registry flag, and not `isOverlayAllowed` ──────────────
 *
 * `@objectstack/metadata-protocol` gates the *write authorization* through
 * `isOverlayAllowed`, which additionally consults the `OS_METADATA_WRITABLE`
 * escape hatch. This predicate deliberately does NOT: it must agree with the
 * predicate that decides whether the row is readable again, and boot hydration
 * keys off the static registry flag alone. `reportUnhydratableOrgScopedRows`
 * already settled the same question on the read side, in its own words:
 *
 *   "Derived from `DEFAULT_METADATA_TYPE_REGISTRY` and NOT from
 *    `isOverlayAllowed`, because the `OS_METADATA_WRITABLE` escape hatch only
 *    unlocks the WRITE — an env-unlocked type's org rows are hydrated no more
 *    than any other's".
 *
 * An env-unlocked `object` written org-scoped would be the same phantom, so
 * the escape hatch unlocks the write and the write still lands env-wide.
 *
 * ⛔ Registry-derived, never a hand-written list (Prime Directive #8): the set
 * below is computed from `DEFAULT_METADATA_TYPE_REGISTRY` — the very export
 * `ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES` derives from — so a
 * registry entry flipping `allowOrgOverride` moves this predicate with it and
 * there is nothing to keep in sync by hand.
 */

import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';

/**
 * Metadata types whose registry entry declares `allowOrgOverride: true`,
 * augmented with each one's plural spelling so a REST-conventional URL
 * (`/api/v1/meta/views/...`) is judged identically to the singular form —
 * the same normalization the protocol's own allow-list does.
 */
const ORG_OVERRIDABLE_TYPES: ReadonlySet<string> = (() => {
    const out = new Set<string>();
    for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
        if (!entry.allowOrgOverride) continue;
        out.add(entry.type);
        const plural = SINGULAR_TO_PLURAL[entry.type];
        if (plural) out.add(plural);
    }
    return out;
})();

/**
 * Does the registry declare this metadata type per-org overridable?
 *
 * Accepts either spelling of the type (`view` / `views`). A type with no
 * registry entry at all — runtime-registered plugin types — answers `false`:
 * boot hydration has no per-org channel for them either, so an org-scoped row
 * would be the same phantom.
 */
export function declaresOrgOverride(type: string): boolean {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    return ORG_OVERRIDABLE_TYPES.has(singular) || ORG_OVERRIDABLE_TYPES.has(type);
}

/**
 * The `organizationId` a metadata write of `type` should carry, given the
 * session's active organization.
 *
 * Returns the active org for a type the registry declares per-org overridable
 * (today's behaviour, unchanged), and `undefined` — env-wide, the same row a
 * no-active-org session produces — for every other type.
 */
export function organizationIdForMetaWrite(
    type: string,
    activeOrganizationId: string | undefined,
): string | undefined {
    if (activeOrganizationId === undefined) return undefined;
    return declaresOrgOverride(type) ? activeOrganizationId : undefined;
}
