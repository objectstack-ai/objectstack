// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12702] Which CALLERS a `/meta` item write door admits — the capability
 * half of the decision whose SCOPE half lives next door in
 * `meta-write-org-scope.ts`.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * `manage_metadata` (ADR-0066 D1) was the only metadata-authoring capability,
 * and it is `scope: 'platform'`: the one key that unlocks a tenant org admin's
 * per-org tier-A overlays (view / dashboard / report / translation /
 * email_template — ADR-0005) ALSO unlocks env-wide tier-B authoring (flows,
 * objects — cross-tenant reach). So a single-DB SaaS operator in a walled
 * posture could not let tenants customize presentation at all, even though the
 * per-org overlay mechanism under the door is complete. Maintainer direction
 * (2026-08-27, quoted verbatim in #12701): tenant org admins get org-scoped
 * authoring of exactly the org-overridable types via a dedicated org-scoped
 * capability; platform `manage_metadata` behaviour unchanged.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 *
 * `manage_org_presentation` (declared `scope: 'org'` in `PLATFORM_CAPABILITIES`,
 * `@objectstack/spec/security`) is a SUBSET key, not a re-keying:
 *
 *   - `isSystem` and `manage_metadata` behave exactly as before — first, and
 *     unconditionally.
 *   - `manage_org_presentation` admits a write ONLY when BOTH hold:
 *       1. the target type's registry entry declares `allowOrgOverride: true`
 *          ({@link declaresOrgOverride} — the SAME registry-derived predicate
 *          that decides the write's organization scope, so "the types this
 *          capability reaches" and "the types whose writes carry the caller's
 *          org" cannot drift; Prime Directive #8: never a hand-written list);
 *       2. the session HAS an active organization — which is the organization
 *          the door will thread via {@link organizationIdForMetaWrite}. No
 *          active org ⇒ the write would land env-wide (`organization_id NULL`,
 *          visible to every tenant) ⇒ refused. A foreign organization is not
 *          expressible on these doors at all: both transports derive the
 *          organization from the caller's own session (REST `ctx.tenantId`,
 *          dispatcher `resolveActiveOrganizationId`), never from the request,
 *          and the save request is built field by field so the body cannot
 *          smuggle one.
 *
 * ── Why the predicate lives HERE ──────────────────────────────────────────
 *
 * Same criterion as `meta-write-org-scope.ts` one module over (#8805): the
 * doors live in `@objectstack/runtime` (dispatcher `/meta` PUT) and
 * `@objectstack/rest` (PUT / DELETE / publish / rollback), `runtime` depends on
 * `rest` so neither can import from the other, and a second copy of a
 * registry-coupled predicate is exactly what Prime Directive #8 forbids. This
 * package is the one both already depend on.
 *
 * ── What deliberately does NOT consult this predicate ─────────────────────
 *
 *   - `POST /meta/_migrate-stored` (both transports): an install-wide stored-
 *     metadata rewrite is env-wide by definition, so condition 2 can never
 *     hold — it stays `manage_metadata`-only.
 *   - Every non-`/meta` `manage_metadata` gate (automation flow authoring,
 *     package management, activation toggles, datasource admin): those are
 *     tier-B / platform surfaces; the org capability must not reach them.
 *   - The read path: org-overlay reads are scoped by
 *     `organizationIdForMetaRead` for EVERY caller class already and carry no
 *     capability gate (ADR-0106 masking is the read-side posture).
 *
 * ── Refusal messages (#7450) ──────────────────────────────────────────────
 *
 * A refusal names the capability that would admit ANY caller and says nothing
 * about this one — the message varies only on REQUEST-derived facts (the
 * type's registry tier) and the session's scope (active organization present
 * or not), never on what the caller holds. For a type with no per-org channel
 * the sentence is byte-identical to the pre-#12702 one: `manage_metadata` is
 * the whole sanctioned path there, and the common refusal stays stable.
 */

import { declaresOrgOverride } from './meta-write-org-scope.js';

/** ADR-0066 D1's platform-wide metadata authoring capability. */
export const METADATA_AUTHORING_CAPABILITY = 'manage_metadata';

/**
 * [#12702] The org-scoped presentation-authoring capability. Declared in
 * `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`, `scope: 'org'`);
 * `meta-write-capability.test.ts` pins this spelling to that declaration so
 * the two cannot drift.
 */
export const ORG_PRESENTATION_AUTHORING_CAPABILITY = 'manage_org_presentation';

/**
 * The `/meta` item write doors, by verb family. A closed set on purpose: the
 * refusal sentence's subject is derived from it, so a new door states its verb
 * here rather than minting free-form prose at the call site.
 */
export type MetaWriteOperation = 'save' | 'reset' | 'publish' | 'rollback';

/** The refusal sentence's subject, per door. Matches the pre-#12702 wording. */
const OPERATION_SUBJECT: Record<MetaWriteOperation, string> = {
    save: 'Saving a metadata item',
    reset: 'Resetting a metadata item',
    publish: 'Publishing a metadata item',
    rollback: 'Rolling back a metadata item',
};

export type MetaWriteCapabilityVerdict =
    | { allowed: true }
    | { allowed: false; message: string };

/**
 * May this caller take this `/meta` item write? Returns the verdict and, on
 * refusal, the message the door should answer with (the door supplies its own
 * transport's status/code envelope: REST answers `403 FORBIDDEN`, the
 * dispatcher `403 PERMISSION_DENIED` — both pre-existing spellings, pinned in
 * their own gate suites).
 *
 * `canonicalType` MUST be the URL segment folded through
 * `canonicalMetaUrlType` — the boundary folds, the layers below read the
 * canonical singular (`metadata-url-spelling.ts`; the #10340 measurement in
 * `meta-write-org-scope.ts` is why this is not optional).
 *
 * `activeOrganizationId` MUST be the same value the door threads into
 * {@link organizationIdForMetaWrite} (REST `ctx.tenantId`, dispatcher
 * `resolveActiveOrganizationId`) — one resolution feeding authorization AND
 * scope, the single-resolution shape the REST doors already carry (#8919).
 */
export function metaWriteCapabilityVerdict(input: {
    isSystem?: boolean;
    /** The caller's `systemPermissions`; tolerant of a non-array (treated as none held). */
    systemPermissions?: unknown;
    /** CANONICAL singular metadata type — fold the URL segment BEFORE asking. */
    canonicalType: string;
    /** The caller's own active organization — the org the door will thread. */
    activeOrganizationId: string | undefined;
    operation: MetaWriteOperation;
}): MetaWriteCapabilityVerdict {
    if (input.isSystem === true) return { allowed: true };
    const held = new Set<string>(
        Array.isArray(input.systemPermissions)
            ? input.systemPermissions.filter((p): p is string => typeof p === 'string')
            : [],
    );
    if (held.has(METADATA_AUTHORING_CAPABILITY)) return { allowed: true };

    const orgOverridable = declaresOrgOverride(input.canonicalType);
    // '' is treated as absent, exactly as `orgScopedWriteRefusal`'s falsy check
    // reads it — the conservative direction (refuse rather than admit).
    const scopedToOwnOrg = typeof input.activeOrganizationId === 'string'
        && input.activeOrganizationId.length > 0;

    if (held.has(ORG_PRESENTATION_AUTHORING_CAPABILITY) && orgOverridable && scopedToOwnOrg) {
        return { allowed: true };
    }

    const subject = OPERATION_SUBJECT[input.operation];
    if (!orgOverridable) {
        // Byte-identical to the pre-#12702 sentence: for a type with no
        // per-org overlay channel, `manage_metadata` IS the whole sanctioned
        // path, and the platform's most common metadata refusal stays stable.
        return {
            allowed: false,
            message: `${subject} requires the \`manage_metadata\` capability.`,
        };
    }
    if (!scopedToOwnOrg) {
        return {
            allowed: false,
            message: `${subject} requires the \`manage_metadata\` capability. `
                + `\`manage_org_presentation\` admits only a write scoped to the session's active organization, `
                + `and this session has none — the write would land environment-wide.`,
        };
    }
    return {
        allowed: false,
        message: `${subject} requires the \`manage_metadata\` capability, or \`manage_org_presentation\` `
            + `for an org-overridable type written org-scoped to the session's active organization.`,
    };
}
