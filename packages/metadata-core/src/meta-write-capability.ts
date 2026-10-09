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
