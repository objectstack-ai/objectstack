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
 *
 * ── Why this lives in `metadata-core` and not in the dispatcher [#8805] ────
 *
 * Because the decision belongs to the CALLER, and there is more than one.
 * `@objectstack/metadata-protocol` deliberately does not make it: an org-scoped
 * write of a non-overridable type is REFUSED (`NOT_OVERRIDABLE`, 403) rather
 * than coerced to env-wide, because option B of the #6190 ruling — silently
 * rewriting the tenancy statement the author made — was rejected. So each door
 * that writes metadata must decide, before it calls, which organization the
 * write carries. The dispatcher was the only door that did; the REST `/meta`
 * write doors passed nothing and stamped every `sys_metadata_audit` row
 * env-wide, which is #8805. `@objectstack/rest` cannot import the dispatcher's
 * copy — `runtime` depends on `rest`, so that edge is a cycle — and a second
 * copy of a registry-derived predicate is precisely what the ⛔ above forbids.
 * This package is the one both already depend on and that depends on neither.
 */

import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';

/**
 * Metadata types whose registry entry declares `allowOrgOverride: true`,
 * augmented with each one's MANIFEST plural spelling (`SINGULAR_TO_PLURAL`).
 *
 * ⚠️ [#10340] That augmentation is NOT the protocol's URL fold, and the doc
 * that used to stand here — "judged identically to the singular form — the
 * same normalization the protocol's own allow-list does" — was measured
 * false. The protocol folds through `META_URL_TO_SINGULAR`, the COMPLETE
 * spelling map; `SINGULAR_TO_PLURAL` is the manifest-collection map, which is
 * incomplete by design (`translation` and `email_template` have no manifest
 * key, so `translations` / `email_templates` are not in this set). Handed a
 * raw URL segment this predicate therefore answered env-wide for those two
 * spellings while storage folded them into an org-scoped type — one item,
 * two partitions, addressed by spelling.
 *
 * The correction landed at the boundary, not here: the REST `/meta` doors
 * fold the segment through `canonicalMetaUrlType` BEFORE the scope decision,
 * exactly as `metadata-url-spelling.ts` mandates ("folding happens at the
 * boundary and only there; the layers below keep reading the single
 * canonical singular"). ⛔ Do not "complete" this set with the URL map — a
 * predicate below the boundary consuming the URL spelling contract is the
 * repair that module's header forbids, and #7894 already refused once.
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
 * Expects the CANONICAL singular type. It additionally tolerates the
 * manifest-collection spellings (`views`, `emailTemplates`, …) — kept for the
 * dispatcher-era callers — but ⚠️ [#10340] that tolerance is NOT the URL
 * fold: URL-only spellings (`translations`, `email_templates`) answer
 * `false` here. A caller holding a raw `/meta/:type` segment must fold it
 * through `canonicalMetaUrlType` BEFORE asking, as the REST doors do; see
 * `ORG_OVERRIDABLE_TYPES` above for the measurement and for why this
 * predicate must not grow the URL map itself.
 *
 * A type with no registry entry at all — runtime-registered plugin types —
 * answers `false`: boot hydration has no per-org channel for them either, so
 * an org-scoped row would be the same phantom.
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

/**
 * [#9454] The read-side twin: the `organizationId` a metadata READ of `type`
 * should carry, given the session's active organization.
 *
 * ── Why a read door has to ask this at all ────────────────────────────────
 *
 * `organizationIdForMetaWrite` above stops the runtime MINTING org-scoped rows
 * for types that have no per-org read channel. It says nothing about serving
 * the rows that types WITH such a channel legitimately produce — and the REST
 * `/meta` read doors were never told. A `PUT` of an org-overridable type
 * (`view`, `dashboard`, `report`, `translation`, `email_template`) landed an
 * org-scoped row, answered `200 state:'active'`, and then every REST read door
 * asked for the row WITHOUT naming an organization. `getMetaItem` resolves
 * `(orgId ? findOverlay(orgId) : undefined) ?? findOverlay(null)`, so an
 * org-less read resolves the env-wide row only: the author's work was
 * persisted, receipted as live, and served by nothing. That is #9454.
 *
 * ── Why it is registry-derived and NOT a bare `ctx?.tenantId` ─────────────
 *
 * ⛔ The tempting shorter fix — pass the active org at every read site — is
 * wrong in a way that only shows on databases with history. Deployments that
 * ran before the #6190 ruling contain PHANTOM org-scoped rows for types the
 * registry declares non-overridable (`object`, `flow`, … — the runtime used to
 * stamp `organization_id` on every type; `reportUnhydratableOrgScopedRows` is
 * the audit that warns about the survivors). Boot hydration walks past those
 * rows deliberately, so they are dead. A read door that named the org for
 * EVERY type would resolve them again — resurrecting, on the read side, exactly
 * the phantom writes #6190 stopped minting, and serving a document that
 * vanishes at the next restart. Gating the read on the same static registry
 * flag keeps the two sides answering one question.
 *
 * ⇒ This is deliberately the same predicate as the write side, not a parallel
 * one: read scope and write scope CANNOT drift, because both are
 * {@link declaresOrgOverride}. If a registry entry flips `allowOrgOverride`,
 * both doors move together and there is nothing to keep in sync by hand.
 *
 * Returns the active org for a type the registry declares per-org overridable,
 * and `undefined` — env-wide, today's behaviour for every read — otherwise.
 * An anonymous or org-less caller reads exactly what it reads today.
 */
export function organizationIdForMetaRead(
    type: string,
    activeOrganizationId: string | undefined,
): string | undefined {
    if (activeOrganizationId === undefined) return undefined;
    return declaresOrgOverride(type) ? activeOrganizationId : undefined;
}
