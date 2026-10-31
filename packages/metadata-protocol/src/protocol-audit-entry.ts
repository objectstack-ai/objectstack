// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the metadata audit entry, the pending-audit carrier and the preflight violation codes.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import {
    type MetadataLock,
} from '@objectstack/spec/kernel';

/**
 * One `sys_metadata_audit` row as a VALUE — exactly the entry
 * `recordMetadataAudit` writes, named so a refusal can hand its row to whoever
 * is in a position to make it durable instead of writing it where it stands.
 *
 * [#8594] Why the entry became a value. `promoteDraftForPublish` used to audit
 * its own denials inline, and it has two callers standing on opposite sides of
 * a transaction boundary: `publishMetaItem` runs it in no transaction of its
 * own, `publishPackageDrafts` runs it inside ONE `engine.transaction()` for the
 * whole batch (ADR-0067 D2). A denial row written inline therefore landed on
 * the single-item route and ROLLED BACK on the batch route — destroyed by the
 * very rollback its own refusal had caused, which is the defect #7748 exists to
 * close. Making the row data lets the helper stay ignorant of whose transaction
 * it is inside (it cannot know, and guessing is what broke) and puts the
 * placement decision where the transaction actually is: in the caller.
 */
export interface MetadataAuditEntry {
    type: string;
    name: string;
    /**
     * [ADR-0131 D6/D7] Always environment-wide: the audit ledger is
     * deployment-level, and no metadata write is organization-scoped any more.
     * Typed `null` so an organization cannot be recorded by accident.
     */
    organizationId?: null;
    operation: 'save' | 'publish' | 'rollback' | 'delete' | 'reset';
    outcome: 'allowed' | 'denied' | 'forced';
    code: string;
    lockState?: MetadataLock;
    lockOverridden?: boolean;
    actor?: string;
    source?: string;
    requestId?: string;
    note?: string;
}

/** Attach the denial row `err` owes, and return `err` so call sites read as one `throw`. */
function withPendingAudit<E extends Error>(err: E, audit: MetadataAuditEntry): E {
    (err as E & { __pendingAudit?: MetadataAuditEntry }).__pendingAudit = audit;
    return err;
}

/**
 * [#8595] The PRE-FLIGHT gate's refusal vocabulary — the closed set of codes
 * `publishPackageDrafts` can refuse a batch with BEFORE it opens its
 * transaction, and the spelling each one takes in `sys_metadata_audit.code`.
 *
 * Why a declared map and not `code.toLowerCase()`. `batch_aborted` (#8400)
 * deliberately took ONE fixed value because its causal code is whatever the
 * error catalog threw, and lower-casing that would turn this column's
 * documented closed set into an open one that grows with the catalog. The
 * pre-flight codes are a different animal — they are minted in
 * `publishPackageDrafts`'s own pre-flight block, not caught from below — so the
 * violation's own code CAN be carried honestly, which is what a compliance
 * query filters on ("show me every publish refused by the namespace rule").
 *
 * The precedent's principle still binds, though: the column must not drift
 * silently. Hence `Record<PreflightViolationCode, …>` over an index signature —
 * a new pre-flight gate (ADR-0121's endpoint gates, should #2657 Part B bring
 * them back) cannot reach this column without failing to compile until its
 * audit spelling is declared here AND added to the column's documented set in
 * `sys-metadata-audit.object.ts`. A mechanical lower-case would have let it
 * land silently; a runtime fallback would have put an unreachable value in a
 * documented closed set. The compiler is the enforcement.
 */
type PreflightViolationCode = 'NAMESPACE_PREFIX' | 'STORED_TYPE_NOT_CANONICAL';

const PREFLIGHT_AUDIT_CODE: Record<PreflightViolationCode, string> = {
    // adr0112-ok: D6b — persisted audit column, its own lowercase vocabulary
    NAMESPACE_PREFIX: 'namespace_prefix',
    // adr0112-ok: D6b — persisted audit column, its own lowercase vocabulary
    STORED_TYPE_NOT_CANONICAL: 'stored_type_not_canonical',
};

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { PREFLIGHT_AUDIT_CODE, withPendingAudit };
export type { PreflightViolationCode };
