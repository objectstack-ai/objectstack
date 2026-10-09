// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The registry-derived "does this type declare a per-organization overlay?"
 * predicate, and the organization a metadata READ inside the protocol carries.
 *
 * ── ADR-0131 D6: the doors carry no organization (C5 stage S3) ────────────
 *
 * The per-organization overlay axis is retired. Neither transport's `/meta`
 * doors (`@objectstack/rest`, and the runtime dispatcher's `/meta` branch)
 * carry an organization into a metadata write or read any more: every
 * Studio-authored write lands environment-wide (`organization_id` NULL), and
 * every door read resolves environment → code. The write-side twin that used
 * to decide which writes carried the session's organization,
 * `organizationIdForMetaWrite`, therefore had no caller left and was deleted.
 *
 * What stays, and why. `@objectstack/metadata-protocol` still gates the reads
 * an in-process caller hands an organization (`getMetaItem`, `getMetaItems`,
 * the layered read, history and diff) through {@link organizationIdForMetaRead}.
 * The one door that still names an organization is the anonymous form door,
 * whose read of the Default Organization's withdrawals stays, fail-closed,
 * until the promotion ceremony carries those rows to the environment layer
 * (ADR-0131 C7). The protocol's own read narrowing (environment → code
 * everywhere) is a later stage of the same retirement, and deletes this
 * module with it.
 *
 * ⛔ Registry-derived, never a hand-written list (Prime Directive #8): the set
 * below is computed from `DEFAULT_METADATA_TYPE_REGISTRY`, so a registry entry
 * flipping `allowOrgOverride` moves this predicate with it.
 */

import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';

/**
 * Metadata types whose registry entry declares `allowOrgOverride: true`,
 * augmented with each one's MANIFEST plural spelling (`SINGULAR_TO_PLURAL`).
 *
 * ⚠️ [commit 26f3588fb] That augmentation is NOT the protocol's URL fold, and the doc
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
 * The correction landed at the boundary, not here: a caller folds the
 * segment through `canonicalMetaUrlType` BEFORE the scope decision,
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
 * dispatcher-era callers — but ⚠️ [commit 26f3588fb] that tolerance is NOT the URL
 * fold: URL-only spellings (`translations`, `email_templates`) answer
 * `false` here. A caller holding a raw `/meta/:type` segment must fold it
 * through `canonicalMetaUrlType` BEFORE asking; see
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
 * [#9454] The `organizationId` a metadata READ of `type` should carry, given
 * the caller's organization.
 *
 * ── Why a read door has to ask this at all ────────────────────────────────
 *
 * The (since retired) write-side twin stopped the runtime MINTING org-scoped
 * rows for types that have no per-org read channel. It says nothing about serving
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
 * Since ADR-0131 D6 the `/meta` doors hand the protocol no organization, so
 * this gate answers `undefined` for every door read; see the module header for
 * the in-process callers that still name one.
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
