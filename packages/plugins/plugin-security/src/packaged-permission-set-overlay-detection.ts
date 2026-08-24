// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DETECTION READING for permission sets that were already silently forked
 * before the lock existed — item 3 of the maintainer ruling of 2026-08-24
 * (「同意 第一步(创业阶段,Salesforce 式)」), quoted from the ruling comment:
 *
 *   > **Existing silent overlays** (already-forked rows in live deployments):
 *   > implementation includes a detection reading (count + names, reported
 *   > loudly — e.g. a boot warning or diagnostic listing), but ⛔ no automatic
 *   > reap/merge — disposition of existing forks is a follow-up reading for the
 *   > maintainer, not a silent migration.
 *
 * ⛔ So this module READS. It has no write verb, takes no `update`/`delete`
 * path, and its test double deliberately exposes none either — a reap added
 * here would fail with a `TypeError` rather than pass quietly. The disposition
 * of an existing fork is the maintainer's call, and the sanctioned per-set
 * remedy already exists as an explicit, audited operator action
 * (`permission-set-overlay-discard.ts`), invoked one set at a time by a human.
 *
 * ## Why this is not `permission-set-drift.ts`
 *
 * The drift diagnostic (#9952) reports a package-declared set whose ENFORCED
 * grants currently DIFFER from the shipped artifact, and attributes the cause.
 * That is a different question, and it is strictly narrower: an overlay taken
 * at a moment when it happened to equal the artifact is invisible to it —
 * `recordDiffersFromBody` says "no difference", so nothing is reported — while
 * the fork is entirely real and will freeze the set the instant the package
 * ships its next version. This reading answers the ruling's question instead:
 * WHICH package-declared sets carry an environment overlay at all, whether or
 * not it has diverged yet.
 *
 * ## ⛔ It does not consult `customized`, and that is measured, not stylistic
 *
 * `upsertEnvPermissionSet` computes the flag as
 * `existing.managed_by === 'package' ? !!customized : false`. On the exact
 * field-reported shape — a genuinely package-declared set whose row's
 * `managed_by` predates provenance tracking (`permission-set-drift.ts`'s
 * `provenance_skip`) — that forces it FALSE while an overlay really is
 * shadowing the row. The card measured it reading `0` for two weeks while the
 * overlay froze the set. A reading built on it would have reported zero forks
 * on the one environment that had one. `sys_metadata` is therefore read
 * directly, exactly as #9952's `drift_status` overlay-shadow branch does.
 *
 * ⛔ Making `customized` itself correct is NOT chartered by this ruling — the
 * card lists it among its *candidates* and the ruling did not take it up.
 * Nothing here reads or writes that column.
 *
 * ## Scope, stated rather than assumed
 *
 *  - ENV-WIDE overlays only (`sys_metadata.organization_id IS NULL`), the same
 *    boundary `reconcilePermissionSetProjection` and `permission-set-drift.ts`
 *    draw (#10103 residue, deliberately out of scope). A reading that answered
 *    a different question from the reconciler it reports on would send an
 *    operator to a row the reconciler never touches;
 *  - "package-declared" is decided by {@link classifyPackagedPermissionSet} —
 *    the engine SchemaRegistry, the same source the write-door lock uses, so
 *    the reading and the lock can never disagree about which sets are locked;
 *  - ⚠️ the overlay sweep is a page capped at {@link OVERLAY_PAGE_LIMIT}, the
 *    same cap and the same read the reconciler and the drift diagnostic
 *    already perform. A truncation there UNDER-reports this listing. That is a
 *    real limit and it is stated here rather than left to be discovered: it is
 *    tolerable because this is a diagnostic reading — under-reporting costs an
 *    operator a name, where the same truncation on the write door would cost a
 *    silent fork, which is why the LOCK's provenance read is not a page at all.
 */

import { tryFind, type ProjectionLogger } from './permission-set-projection.js';
import { classifyPackagedPermissionSet } from './packaged-permission-set-lock.js';

/**
 * Page cap for the `sys_metadata` overlay sweep — the same value
 * `reconcilePermissionSetProjection` and `computePermissionSetDriftDiagnostics`
 * use for the identical read. Shared deliberately: three readings of the same
 * rows answering under three different caps would disagree about the same
 * environment.
 */
export const OVERLAY_PAGE_LIMIT = 1000;

/** One package-declared set that an environment overlay has forked. */
export interface PackagedPermissionSetOverlayFinding {
  /** The permission set's machine name — the identity an operator acts on. */
  name: string;
  /** The package that declares it. */
  packageId: string;
  /** The `sys_metadata` row id(s) carrying the overlay. Never acted on here. */
  overlayIds: string[];
}

/** The reading: how many, and — the part that matters — WHICH. */
export interface PackagedPermissionSetOverlayReading {
  count: number;
  /** Sorted, so two boots of the same environment produce the same listing. */
  names: string[];
  findings: PackagedPermissionSetOverlayFinding[];
}

export interface OverlayDetectionOptions {
  logger?: ProjectionLogger;
}

/**
 * Compute (never write) the listing of package-declared permission sets that
 * an environment overlay is currently forking.
 */
export async function detectPackagedPermissionSetOverlays(
  ql: any,
  _opts: OverlayDetectionOptions = {},
): Promise<PackagedPermissionSetOverlayReading> {
  if (!ql || typeof ql.find !== 'function') return { count: 0, names: [], findings: [] };

  // Both type spellings, same as the reconciler and the drift diagnostic.
  const overlayIdsByName = new Map<string, string[]>();
  for (const type of ['permission', 'permissions']) {
    const rows = await tryFind(ql, 'sys_metadata', { type, state: 'active' }, OVERLAY_PAGE_LIMIT);
    for (const r of rows) {
      if ((r?.organization_id ?? null) !== null || !r?.name) continue; // env-wide only
      const name = String(r.name);
      const ids = overlayIdsByName.get(name);
      if (ids) ids.push(String(r.id)); else overlayIdsByName.set(name, [String(r.id)]);
    }
  }

  const findings: PackagedPermissionSetOverlayFinding[] = [];
  for (const [name, overlayIds] of overlayIdsByName) {
    const verdict = classifyPackagedPermissionSet(name, ql);
    // ⚠️ `packaged` ONLY. The fail-safe direction for a READING is the opposite
    // of the write door's: naming a set this environment cannot PROVE is
    // package-declared would send an operator after somebody's env-authored
    // work, so `org` and `unknown` are both silent here. The write door refuses
    // on `unknown` for the mirror-image reason — there, silence would mint the
    // fork this whole feature exists to prevent.
    if (verdict.status !== 'packaged') continue;
    findings.push({ name, packageId: verdict.packageId, overlayIds });
  }

  findings.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { count: findings.length, names: findings.map((f) => f.name), findings };
}

/**
 * Compute + report. What boot wiring calls.
 *
 * Loud when there is something to say, and SILENT when there is not: a boot
 * line that fires unconditionally is a line operators learn to skip, which is
 * indistinguishable from having no detector at all (the same rule
 * `persistPermissionSetDriftDiagnostics` follows by writing `null` for an
 * in-sync set rather than a quiet "ok" badge).
 *
 * `warn`, not `error`: nothing is broken and nothing failed — the environment
 * is in a state the maintainer has to decide about. And the line says outright
 * that nothing was reaped, so no one reads it as "handled".
 */
export async function reportPackagedPermissionSetOverlays(
  ql: any,
  opts: OverlayDetectionOptions = {},
): Promise<PackagedPermissionSetOverlayReading> {
  const reading = await detectPackagedPermissionSetOverlays(ql, opts);
  if (reading.count === 0) return reading;
  opts.logger?.warn?.(
    `[security] ${reading.count} package-declared permission set(s) are being shadowed by an environment ` +
    'overlay — each one was forked from its package before the save door was locked, so its grants are ' +
    'frozen at the overlay and every future package upgrade of that set will be ignored, silently. ' +
    'DETECTION ONLY: nothing was reaped, removed or changed by this reading. To resync one set to its ' +
    'shipped artifact, use the audited "Discard Overlay" action on it; to keep the customization, clone the ' +
    'set and reassign to the clone.',
    { count: reading.count, names: reading.names, findings: reading.findings },
  );
  return reading;
}
