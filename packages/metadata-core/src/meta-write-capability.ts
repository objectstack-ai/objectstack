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
 *     metadata rewrite, gated on `manage_metadata` by its own door (and, under
 *     a wall, by the walled predicate below).
 *   - Every non-`/meta` `manage_metadata` gate (automation flow authoring,
 *     package management, activation toggles, datasource admin).
 *   - The read path, which carries no capability gate (ADR-0106 masking is
 *     the read-side posture).
 *
 * Under a wall, the doors that write the environment's metadata ask a second
 * predicate after their capability gate, {@link walledCatalogWriteVerdict}:
 * the `/meta` item write doors, `POST /meta/_migrate-stored`, the `/packages`
 * write doors, the `/automation` definition writes and `install-local`.
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
// [ADR-0131 D3 · D12 items 7–8 · D11] The walled environment-metadata refusal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The security catalog (ADR-0131 D3): the three metadata types whose items are
 * definitions every organization resolves BY NAME, from the one environment
 * registry. A walled deployment's organizations share them, so a write to one
 * reaches every organization that holds it.
 *
 * [#23231] The walled refusal no longer narrows to these three: under a wall
 * every environment-metadata write is the platform operator's
 * ({@link walledCatalogWriteVerdict}). The list still names the refusal's
 * subject for a catalog type.
 */
export const SECURITY_CATALOG_TYPES: readonly string[] = Object.freeze(['position', 'permission', 'capability']);

/**
 * Is `type` — in any URL spelling `saveMetaItem` accepts — a security catalog
 * type? It decides no refusal: {@link walledCatalogWriteVerdict} judges every
 * type alike, and a door asks that verdict for every write rather than
 * pre-filtering on this predicate.
 */
export function isSecurityCatalogType(type: string): boolean {
    return SECURITY_CATALOG_TYPES.includes(canonicalMetaUrlType(type));
}

/**
 * The subject the refusal names, per written type: the catalog's own nouns, a
 * package for the package doors (which act on a package's items, whatever
 * their types), the whole stored ledger for the install-wide rewrite
 * (`POST /meta/_migrate-stored`, which rewrites every `sys_metadata` row), and
 * any other metadata type by its name.
 */
const WRITTEN_SUBJECT: Readonly<Record<string, string>> = {
    position: 'a position',
    permission: 'a permission set',
    capability: 'a capability',
    package: 'a package',
    sys_metadata: 'the environment\'s stored metadata',
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
 * [ADR-0131 D3 · D12 items 7–8 · D11] May this caller write the environment's
 * metadata, on a deployment running this tenancy posture?
 *
 * ADR-0131 D12 item 7: a walled deployment is "one environment, one schema, one
 * catalog … The metadata-authoring capability (`manage_metadata` /
 * `studio.access`) is what headquarters IT holds and plant admins do not."
 * Item 8: a plant "cannot create a position, a permission set, a capability, a
 * template or any metadata … A plant that needs its own catalog is given its
 * own environment." D11: the rules are identical in every posture, and only
 * whether the wall is enforced differs. The environment definition ledger
 * carries no organization column (D6/D7), so under a wall a write by one
 * organization's principal changes what every other organization resolves.
 * That was measured, not argued, for every type and every door this predicate
 * guards: an organization-scoped `manage_metadata` holder created an object, a
 * view and a flow, edited, published, rolled back and reset the operator's
 * items, and installed, upgraded and removed packages, and another
 * organization's member read each result
 * (`wall-environment-metadata-refusal.dogfood.test.ts`). The security catalog
 * (D3) was the first case refused (`wall-catalog-refusal.dogfood.test.ts`);
 * ruling A on #23231 (record 6145019463) stops special-casing it.
 *
 * This is the ONE predicate for that refusal, and it judges every type alike:
 * no door pre-filters on the written type before asking it. Every door that
 * writes the environment's metadata asks it after its own capability gate: the
 * `/meta` item write doors on both transports (save, reset, publish,
 * rollback), `POST /meta/_migrate-stored` on both transports, the `/packages`
 * write doors, the `/automation` definition writes,
 * `install-local` (install, upgrade, uninstall) and the permission-set clone
 * door. (The security plugin's data door on the catalog objects asked it too,
 * until those objects retired — ADR-0131 D3, C3 stage 8: no `sys_position`,
 * `sys_permission_set` or `sys_capability` write reaches the engine, so a
 * position, set or capability is written through the `/meta` doors above.)
 * Under `single` it is inert: the organization is the environment, and the
 * capability gate decides alone.
 *
 * Admitted under a wall: `isSystem` (the engine's own writes: seeders,
 * installers, migrations) and the platform operator rung. Refused: everyone
 * else, whatever they hold. An ABSENT posture (no `tenancy` service) is inert,
 * as at the activation gate: ADR-0093 D4/D5 resolve a requested-but-absent wall
 * to `single`, so absent and `single` are the same deployment shape.
 *
 * Assignments are not metadata writes and never reach this predicate:
 * `sys_user_position` and `sys_user_permission_set` rows are organization rows
 * (ADR-0131 D3, "Assignments are organization rows, in every posture").
 *
 * The name keeps "catalog": the security catalog was the refusal's first
 * scope, and the export is read under this name.
 */
export function walledCatalogWriteVerdict(input: {
    /**
     * The metadata type written (`package` at the package doors,
     * `sys_metadata` at the stored-metadata rewrite). It names the refusal's
     * subject and never decides the verdict.
     */
    type: string;
    /** The deployment's EFFECTIVE tenancy posture; `undefined` when no `tenancy` service answers. */
    tenancyPosture: TenancyPosture | undefined;
    isSystem?: boolean;
    /** The caller's ADR-0095 posture rung, off its execution context. */
    callerPosture?: unknown;
}): MetaWriteCapabilityVerdict {
    if (!input.tenancyPosture || !postureEnforcesWall(input.tenancyPosture)) return { allowed: true };
    if (input.isSystem === true) return { allowed: true };
    if (input.callerPosture === PLATFORM_OPERATOR_POSTURE) return { allowed: true };
    // The fold `saveMetaItem` applies at its own request boundary, so a URL
    // spelling the protocol accepts (a plural) is named as the type it writes.
    const type = canonicalMetaUrlType(input.type);
    const subject = WRITTEN_SUBJECT[type] ?? `a '${type}' metadata item`;
    return {
        allowed: false,
        message:
            `Creating, changing or deleting ${subject} requires the platform operator: this deployment runs the ` +
            `'${input.tenancyPosture}' tenancy posture, where every organization shares the environment's metadata, ` +
            `the security catalog included (ADR-0131 D3, D12 items 7–8, D11). Holding the \`manage_metadata\` ` +
            `capability inside an organization does not admit it. An organization's administrators assign the ` +
            `catalog's positions and permission sets to their own members; an organization that needs metadata of ` +
            `its own is given an environment of its own.`,
    };
}
