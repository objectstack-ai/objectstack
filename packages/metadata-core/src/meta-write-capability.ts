// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12702 · ADR-0131 D6] Which CALLERS a `/meta` item write door admits.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 *
 * `manage_metadata` (ADR-0066 D1) is the metadata-authoring capability, and
 * `isSystem` bypasses it, matching every other capability gate on the
 * platform. Nothing else admits a `/meta` item write.
 *
 * ── What retired here (ADR-0131 D6, C5 stage S3) ──────────────────────────
 *
 * This predicate used to admit a second, org-scoped capability,
 * `manage_org_presentation`: an organization admin's write of an
 * org-overridable type (view / dashboard / report / translation /
 * email_template), threaded into the admin's own organization's overlay.
 * ADR-0131 D6 retires the per-organization overlay axis: the `/meta` doors no
 * longer carry an organization into a metadata write, so every admitted write
 * lands environment-wide. Keeping that arm would have handed its holders
 * environment-wide authoring of those five types, which is a wider reach than
 * the capability ever granted. So the arm and the capability retire together
 * (its ADR-0087 entry is `manage-org-presentation-retired`), and an
 * organization admin's metadata write is refused here like any other
 * caller's without `manage_metadata`.
 *
 * ── Why the predicate lives HERE ──────────────────────────────────────────
 *
 * The doors live in `@objectstack/runtime` (dispatcher `/meta` PUT) and
 * `@objectstack/rest` (PUT / DELETE / publish / rollback); `runtime` depends
 * on `rest`, so neither can import from the other, and this package is the
 * one both already depend on. One predicate for every door on both
 * transports, never a door-local restatement of it.
 *
 * ── What deliberately does NOT consult this predicate ─────────────────────
 *
 *   - `POST /meta/_migrate-stored` (both transports): an install-wide stored-
 *     metadata rewrite, gated on `manage_metadata` by its own door.
 *   - Every non-`/meta` `manage_metadata` gate (automation flow authoring,
 *     package management, activation toggles, datasource admin).
 *   - The read path, which carries no capability gate (ADR-0106 masking is
 *     the read-side posture).
 *
 * ── Refusal messages (#7450) ──────────────────────────────────────────────
 *
 * A refusal names the capability that would admit ANY caller and says nothing
 * about this one; the sentence varies only on the door's verb.
 */

import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { canonicalMetaUrlType } from '@objectstack/spec/meta-spelling';

/** ADR-0066 D1's platform-wide metadata authoring capability. */
export const METADATA_AUTHORING_CAPABILITY = 'manage_metadata';

/**
 * The `/meta` item write doors, by verb family. A closed set on purpose: the
 * refusal sentence's subject is derived from it, so a new door states its verb
 * here rather than minting free-form prose at the call site.
 */
export type MetaWriteOperation = 'save' | 'reset' | 'publish' | 'rollback';

/** The refusal sentence's subject, per door. */
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
 */
export function metaWriteCapabilityVerdict(input: {
    isSystem?: boolean;
    /** The caller's `systemPermissions`; tolerant of a non-array (treated as none held). */
    systemPermissions?: unknown;
    operation: MetaWriteOperation;
}): MetaWriteCapabilityVerdict {
    if (input.isSystem === true) return { allowed: true };
    const held = Array.isArray(input.systemPermissions)
        && input.systemPermissions.includes(METADATA_AUTHORING_CAPABILITY);
    if (held) return { allowed: true };
    return {
        allowed: false,
        message: `${OPERATION_SUBJECT[input.operation]} requires the \`manage_metadata\` capability.`,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// [ADR-0131 D3] The walled catalog refusal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The security catalog (ADR-0131 D3): the three metadata types whose items are
 * definitions every organization resolves BY NAME, from the one environment
 * registry. A walled deployment's organizations share them, so a write to one
 * reaches every organization that holds it.
 */
export const SECURITY_CATALOG_TYPES: readonly string[] = Object.freeze(['position', 'permission', 'capability']);

/**
 * Is `type` — in any URL spelling `saveMetaItem` accepts — a security catalog
 * type? A door asks this before it pays for the tenancy posture read that
 * {@link walledCatalogWriteVerdict} needs, so a write of any other type reads
 * no posture at all.
 */
export function isSecurityCatalogType(type: string): boolean {
    return SECURITY_CATALOG_TYPES.includes(canonicalMetaUrlType(type));
}

/** The noun the refusal names, per catalog type. */
const CATALOG_NOUN: Readonly<Record<string, string>> = {
    position: 'a position',
    permission: 'a permission set',
    capability: 'a capability',
};

/**
 * The ADR-0095 D2/D3 posture rung that IS the platform operator (ADR-0068 D2:
 * "Platform operator (SaaS admin). NOT a tenant user role"). The activation
 * gate (`@objectstack/runtime` `domains/activation-gate.ts`) reads the same
 * rung for the same reason: it is derived from the platform-admin anchors and
 * never from a held capability or a position name, so a tenant holding
 * `manage_metadata` inside its organization does not reach it.
 */
export const PLATFORM_OPERATOR_POSTURE = 'PLATFORM_ADMIN';

/**
 * [ADR-0131 D3] May this caller write this item of the security catalog, on a
 * deployment running this tenancy posture?
 *
 * ADR-0131 D3, verbatim: "Shared-DB multi-tenant (`group` / `isolated`): tenant
 * admins cannot create or edit catalog items; the operator defines the catalog
 * for every tenant (managed packages, Studio). Creation through Setup or the
 * API is refused with a message naming the posture and the capability." The
 * catalog is environment-level and organizations resolve it by name, so under
 * a wall a write by one organization's principal changes what every other
 * organization's members resolve. That was measured, not argued: an
 * organization-scoped `manage_metadata` holder edited a permission set another
 * organization's member holds, and that member's next resolution carried the
 * edit (`wall-catalog-refusal.dogfood.test.ts`).
 *
 * This is the ONE predicate for that refusal. Every door that writes a catalog
 * item asks it, after its own capability gate: the `/meta` item write doors on
 * both transports (save, reset, publish, rollback) and the security plugin's
 * data door on the catalog objects. Under `single` it is inert: the
 * organization is the environment, and the capability gate decides alone
 * (#22621 → A: catalog writes stay with `manage_metadata` holders).
 *
 * Admitted under a wall: `isSystem` (the engine's own writes: seeders,
 * installers, migrations) and the platform operator rung. Refused: everyone
 * else, whatever they hold. An ABSENT posture (no `tenancy` service) is inert,
 * as at the activation gate: ADR-0093 D4/D5 resolve a requested-but-absent wall
 * to `single`, so absent and `single` are the same deployment shape.
 *
 * Assignments are not catalog writes and never reach this predicate:
 * `sys_user_position` and `sys_user_permission_set` rows are organization rows
 * (ADR-0131 D3, "Assignments are organization rows, in every posture").
 */
export function walledCatalogWriteVerdict(input: {
    /** The metadata type written. A type outside {@link SECURITY_CATALOG_TYPES} is always admitted. */
    type: string;
    /** The deployment's EFFECTIVE tenancy posture; `undefined` when no `tenancy` service answers. */
    tenancyPosture: TenancyPosture | undefined;
    isSystem?: boolean;
    /** The caller's ADR-0095 posture rung, off its execution context. */
    callerPosture?: unknown;
}): MetaWriteCapabilityVerdict {
    // The fold `saveMetaItem` applies at its own request boundary, so a URL
    // spelling the protocol accepts (a plural) is judged as the type it writes.
    if (!isSecurityCatalogType(input.type)) return { allowed: true };
    const type = canonicalMetaUrlType(input.type);
    if (!input.tenancyPosture || !postureEnforcesWall(input.tenancyPosture)) return { allowed: true };
    if (input.isSystem === true) return { allowed: true };
    if (input.callerPosture === PLATFORM_OPERATOR_POSTURE) return { allowed: true };
    return {
        allowed: false,
        message:
            `Creating, changing or deleting ${CATALOG_NOUN[type]} requires the platform operator: this ` +
            `deployment runs the '${input.tenancyPosture}' tenancy posture, where the security catalog is shared ` +
            `by every organization (ADR-0131 D3). Holding the \`manage_metadata\` capability inside an ` +
            `organization does not admit it. An organization's administrators assign the catalog's positions ` +
            `and permission sets to their own members instead.`,
    };
}
