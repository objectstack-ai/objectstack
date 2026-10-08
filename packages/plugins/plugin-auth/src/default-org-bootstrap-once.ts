// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The default-organization bootstrap with its owner bind decided ONCE
 * (ADR-0093 D7: membership is decided at creation, never re-decided).
 *
 * `ensureDefaultOrganization` binds the platform admin as owner whenever the
 * admin holds no membership, and its wirings run it on every `kernel:ready`
 * and on every `sys_user` write that can move the platform-admin answer. On
 * its own that re-binds an admin whose membership was removed. This wrapper
 * is the ONE gate both wirings call — the single-org `AuthPlugin` and the
 * walled `@objectstack/organizations` plugin — so the two postures cannot
 * disagree about it:
 *
 *  - the decision is recorded in the `sys_migration` ledger
 *    ({@link DEFAULT_ORG_OWNER_BIND_MIGRATION_ID}) the first time the
 *    bootstrap binds the admin, or finds the admin already holding a
 *    membership;
 *  - once recorded — or once acted on in this process, whether or not the
 *    record landed — the bootstrap still (re)creates a missing default
 *    organization but binds nobody and hands over no seed ownership;
 *  - with no ledger on the kernel it binds only on the call that CREATES the
 *    default organization — or, now that `single` creates it at boot
 *    (ADR-0131 D3), when this process created it — so a fresh install still
 *    gets its owner and an existing organization is never re-bound;
 *  - with a ledger that failed to answer it binds nobody on that call (it may
 *    still create the organization) and leaves the decision to the next
 *    trigger.
 */

import {
  ensureDefaultOrganization,
  type EnsureDefaultOrganizationOptions,
  type EnsureDefaultOrganizationResult,
} from './ensure-default-organization.js';
import {
  buildLedgerDecisionRecord,
  DEFAULT_ORG_OWNER_BIND_MIGRATION_ID,
  readLedgerDecision,
  recordLedgerDecision,
  type LedgerLogger,
} from './membership-backfill-ledger.js';

export interface EnsureDefaultOrganizationOnceOptions {
  logger?: LedgerLogger & EnsureDefaultOrganizationOptions['logger'];
  /** Injected seed-ownership handoff (the walled wiring passes its own). */
  claimSeedOwnership?: EnsureDefaultOrganizationOptions['claimSeedOwnership'];
  /** The bootstrap to gate — the plugin-auth helper unless a test injects one. */
  ensure?: typeof ensureDefaultOrganization;
  /**
   * [ADR-0131 D3] Did THIS process create the Default Organization at boot
   * (`ensureDefaultOrganizationExists`, `default-organization-invariant.ts`)?
   * Under `single` the organization no longer waits for the admin, so the call
   * that creates it is no longer this gate's — and a kernel with no ledger
   * binds "only on the call that CREATES the default organization". An
   * organization this process created is that fresh install, so the bind is
   * admitted for it; one that predates the process is still never re-bound.
   */
  organizationCreatedByThisProcess?: () => boolean;
}

/**
 * Build the gated bootstrap. The returned function carries the in-process
 * latch, so a wiring creates ONE and calls it from every trigger.
 */
export function createEnsureDefaultOrganizationOnce(
  options: EnsureDefaultOrganizationOnceOptions = {},
): (ql: any) => Promise<EnsureDefaultOrganizationResult> {
  const ensure = options.ensure ?? ensureDefaultOrganization;
  // Latched once the owner bind is decided in this process — read from the
  // ledger, or acted on now. A record that failed to land does not unlatch
  // it: the next trigger in this process must not bind again.
  let decided = false;

  return async (ql: any): Promise<EnsureDefaultOrganizationResult> => {
    const base: EnsureDefaultOrganizationOptions = {
      logger: options.logger,
      ...(options.claimSeedOwnership ? { claimSeedOwnership: options.claimSeedOwnership } : {}),
    };
    if (decided) return ensure(ql, { ...base, bindOwner: false });

    const reading = await readLedgerDecision(ql, DEFAULT_ORG_OWNER_BIND_MIGRATION_ID);
    if (reading === 'recorded') {
      decided = true;
      return ensure(ql, { ...base, bindOwner: false });
    }

    // `unavailable` (this kernel has no ledger) binds only on the call that
    // CREATES the default organization, so a fresh install without a ledger
    // still gets its owner. `unreadable` is a ledger that exists but failed to
    // answer: the decision may well be recorded, so this call binds nobody —
    // it can still (re)create the organization — and the next trigger, with a
    // readable ledger, decides.
    const bindOnlyOnCreate =
      reading === 'unavailable' && options.organizationCreatedByThisProcess?.() !== true;
    const res =
      reading === 'unreadable'
        ? await ensure(ql, { ...base, bindOwner: false })
        : await ensure(ql, { ...base, bindOnlyOnCreate });
    // Decided: the admin was bound now, promoted from the reconciler's own
    // `member` row (ADR-0131 D3), or already held a membership. `no_admin` and
    // the failed writes leave it open for the next trigger.
    const actedOn = res.memberCreated || res.ownerPromoted === true || res.reason === 'admin_already_in_org';
    if (!actedOn) return res;
    decided = true;
    if (reading === 'absent') {
      await recordLedgerDecision(
        ql,
        buildLedgerDecisionRecord(
          DEFAULT_ORG_OWNER_BIND_MIGRATION_ID,
          {
            outcome: res.memberCreated ? 'bound' : res.ownerPromoted ? 'promoted' : 'admin-already-member',
            ...(res.defaultOrgId ? { organizationId: res.defaultOrgId } : {}),
          },
          new Date().toISOString(),
        ),
        'default organization owner bind',
        options.logger,
      );
    }
    return res;
  };
}
