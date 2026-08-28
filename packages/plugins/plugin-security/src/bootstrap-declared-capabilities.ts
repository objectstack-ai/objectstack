// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredCapabilities — seed stack-declared `capabilities` into
 * `sys_capability` with PACKAGE provenance (ADR-0066 D1; the exact sibling of
 * `bootstrapDeclaredPermissions`).
 *
 * A package's authorization capabilities used to reach the registry only
 * IMPLICITLY: `bootstrapSystemCapabilities` derived an untitled placeholder for
 * any capability string a permission set happened to reference in
 * `systemPermissions[]`, seeded `managed_by:'platform'` with a humanized label.
 * That back-door gave the registry no way to attribute a capability to the
 * package that owns it, nor to carry a real label/description.
 *
 * `defineCapability` + `stack.capabilities` is the EXPLICIT declaration entry
 * point (ADR-0066 D1: "packages DEFINE capabilities"). This seeder materializes
 * those declarations:
 *
 *  - each declared capability is upserted by `name` with `managed_by:'package'`
 *    and `package_id` = the registering package (`_packageId` stamped by the
 *    SchemaRegistry / ADR-0010, with the spec-level `packageId` (ADR-0086 D3)
 *    as the author-declared fallback);
 *  - a name that collides with a CURATED platform capability
 *    (`PLATFORM_CAPABILITY_NAMES`) is refused loudly — those are platform-owned
 *    and a package must not hijack them;
 *  - a pre-existing `managed_by:'platform'` row for a NON-curated name is a
 *    derived-from-systemPermissions placeholder — the explicit declaration
 *    CLAIMS it (upgrades it to package provenance with the authored metadata),
 *    which is the whole point: retire the implicit back-door;
 *  - IDEMPOTENT + UPGRADE-AWARE: a row this seeder owns (`managed_by:'package'`,
 *    same `package_id`) is re-seeded on every boot so the record always
 *    reflects the shipped declaration. Rows owned by a DIFFERENT package are
 *    skipped loudly;
 *  - admin-authored rows (`managed_by:'admin'`) are NEVER clobbered.
 *
 * Runs on `kernel:ready` in `@objectstack/plugin-security` alongside the other
 * declared-metadata seeders. {@link CapabilitySeedOutcome.materializedNames} is
 * returned so the caller can tell `bootstrapSystemCapabilities` to SKIP
 * re-deriving (and thus clobbering) a capability that already has a row.
 *
 * ## Cost shape (#11096)
 *
 * This pass is a read-then-write reconciler over a set known IN FULL before its
 * loop starts, so it pays ONE batched existence read for the whole declaration
 * (`buildExistingByName`, added by #10946) and writes only where the stored row
 * actually differs. It used to issue a `SELECT … WHERE name = ? LIMIT 1` per
 * declared capability plus an `UPDATE` that fired whether or not anything had
 * changed — the same shape whose cost was measured at 4.0000 round trips per
 * item (R² = 1.000000) on the two sibling loops in #10946. That is a COUNT, and
 * the count is what `bootstrap-seed-round-trips.test.ts` pins; the hosted
 * latency rig lives in `objectstack-ai/cloud` and this axis' own slope has
 * never been measured.
 *
 * ⛔ The write-skip is an EQUALITY test and must stay one. A reconciler that
 * skipped writes outright would show a perfect round-trip curve while
 * reconciling nothing at all, which is why every counting test in that file is
 * paired one-for-one with a drift test over the same fixture.
 *
 * [#4967 Part 1] That list reports names this pass CONFIRMED have a row — NOT
 * every name it read. The two are different facts, and conflating them turned a
 * REFUSED declaration into a hole: the refusal writes no row, the reported name
 * suppressed the back-compat derivation too, and the capability then existed in
 * no row at all, leaving every `systemPermissions` grant naming it inert. Adding
 * an explicit declaration was therefore strictly WORSE than omitting one. The
 * suppression rule is now uniform and stated per refusal path in
 * {@link upsertPackageCapability}: a name suppresses the derivation IFF
 * `sys_capability` holds a row for it after this pass — protecting an authored
 * row from a humanized placeholder is the whole purpose of the list, and a
 * refusal with no row is not an authored row there is anything to protect.
 */

import {
  genId,
  tryInsert,
  tryUpdate,
  type ProjectionLogger,
} from './permission-set-projection.js';
import {
  createSeedWriteRefusals,
  warnSeedWriteRefusals,
  type SeedWriteRefusals,
} from './per-organization-catalog.js';
import { buildExistingByName, type ExistingByNameIndex } from './seed-name-lookup.js';
import { readDeclared } from './bootstrap-declared-permissions.js';
import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';

/** The only shape this seeder reads off a permission set: who grants what. */
type GrantingPermissionSet = { name?: string; systemPermissions?: readonly string[] };

interface SeedOptions {
  logger?: ProjectionLogger;
  /**
   * [#4967 Part 3] The bootstrap permission sets that GRANT capabilities via
   * `systemPermissions[]` — the SAME array `bootstrapSystemCapabilities` derives
   * its placeholders from, so "granted by X" and "will be derived" are read off
   * one source. Used only to name the grantor(s) in the refusal diagnostics: a
   * seeder-side warn that names the capability but not the permission set(s)
   * that grant it does not tell the reader the consequence. Threaded as an
   * argument on every call — never module-level state.
   */
  permissionSets?: readonly GrantingPermissionSet[];
}

/** Aggregated outcome of a declared-capability seeding pass. */
export interface CapabilitySeedOutcome {
  seeded: number;
  updated: number;
  claimed: number;
  skippedAdmin: number;
  skippedForeign: number;
  skippedPlatform: number;
  /**
   * [#4967 Part 1] Declarations refused for want of an owning package
   * (`_packageId`/`packageId` both absent) — previously the one refusal path
   * with no counter at all, which is why `declaredNames` and the counters could
   * not be reconciled.
   */
  skippedUnowned: number;
  /**
   * [#11096] Rows this seeder OWNS whose stored `label`/`description`/`scope`
   * already equalled what a re-seed would write, so no `UPDATE` was issued.
   *
   * ⚠️ Read together with {@link updated}, never instead of it — "the row now
   * reflects the declaration" is `seeded + updated + claimed + unchanged`, while
   * `updated` alone means "a write was needed AND landed". The unconditional
   * re-write this counter replaces made the two questions accidentally
   * identical; they are not.
   */
  unchanged: number;
  /**
   * [#11096] Declarations this pass DECLINED to touch because `sys_capability`
   * could not be READ for them. Distinct from every other counter here:
   * nothing was compared, nothing was written, and whether a row exists is
   * simply unknown — which is why such a name is also kept OUT of
   * {@link materializedNames} (suppressing the derivation for a name that may
   * have no row is the #4967 hole).
   *
   * ⛔ It is NOT a variety of `skippedUnowned`. Before the batched read, a
   * declaration whose read failed fell through to an INSERT that the `name`
   * unique index refused — a database constraint standing in for a decision
   * this seeder should be making. It now declines on its own; on a deployment
   * where that index is absent the old shape DUPLICATED rows instead.
   */
  unreadable: number;
  /**
   * [#4967 Part 1] Names this pass CONFIRMED are materialized in
   * `sys_capability`, i.e. the names `bootstrapSystemCapabilities` must NOT
   * re-derive a placeholder for. A name lands here when this pass wrote its row
   * (seeded / updated / claimed) or found a row it must not clobber
   * (admin-authored, another package's, or a curated platform name the curated
   * pass owns) — and NOT when a refusal left the name with no row anywhere.
   *
   * Accounting: every named declaration falls into exactly one counter, so
   * `seeded + updated + claimed + unchanged + skippedAdmin + skippedForeign +
   * skippedPlatform + skippedUnowned + unreadable` is the number of named
   * declarations read,
   * and `materializedNames` is that same set minus the refusals that found no
   * row. (Pre-existing caveat, unchanged: a write the engine rejects increments
   * no counter — and a rejected INSERT deliberately keeps its name out of this
   * list, so the derivation gets its own attempt.)
   */
  materializedNames: string[];
}

function humanize(name: string): string {
  return name.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize a declaration body into the `sys_capability` platform-owned fields. */
function capabilityRowFields(cap: any): { label: string; description: string; scope: 'platform' | 'org' } {
  return {
    label: typeof cap.label === 'string' && cap.label ? cap.label : humanize(cap.name),
    description: typeof cap.description === 'string' && cap.description ? cap.description : `Capability ${cap.name}.`,
    scope: cap.scope === 'org' ? 'org' : 'platform',
  };
}

/**
 * [#11096] True when the stored row differs from what a re-seed would write.
 *
 * ⚠️ EQUALITY decides, not presence: a capability whose stored label,
 * description or scope drifted from the declaration STILL gets its `UPDATE`.
 * The comparison covers exactly the columns {@link capabilityRowFields}
 * writes and no others — `active`, `managed_by` and `package_id` are never
 * touched by an own-row re-seed, so they can neither cause nor suppress one.
 * Widening this set without widening the write (or the reverse) is how a
 * "batched" reconciler turns into one that reconciles nothing.
 */
function capabilityRecordDiffers(row: any, fields: ReturnType<typeof capabilityRowFields>): boolean {
  return (row?.label ?? null) !== (fields.label ?? null)
    || (row?.description ?? null) !== (fields.description ?? null)
    || (row?.scope ?? null) !== (fields.scope ?? null);
}

/**
 * [#4967 Part 3] Index `capability name → granting permission set name(s)` over
 * the bootstrap permission sets, so a refusal can name the grantor(s) — and,
 * because this is the same array the back-compat derivation reads, can state
 * the ACTUAL consequence rather than a generic "not materialized".
 */
function indexGrantors(sets: readonly GrantingPermissionSet[] = []): Map<string, string[]> {
  const byCapability = new Map<string, string[]>();
  for (const ps of sets) {
    const setName = typeof ps?.name === 'string' && ps.name ? ps.name : '(unnamed permission set)';
    for (const cap of ps?.systemPermissions ?? []) {
      if (typeof cap !== 'string' || !cap) continue;
      const grantors = byCapability.get(cap);
      if (!grantors) byCapability.set(cap, [setName]);
      else if (!grantors.includes(setName)) grantors.push(setName);
    }
  }
  return byCapability;
}

/**
 * [#4967 Part 3] The unowned-declaration diagnostic. Stays at `warn` per the
 * #4632 rule — this is FUNCTIONAL degradation (a declaration that does not
 * carry its provenance), not a durability failure. What changes is the payload:
 * it names the permission set(s) that GRANT the capability, and the real
 * consequence of the refusal, which differs by whether a row already exists and
 * whether anything grants the name at all.
 */
function unownedRefusalMessage(name: string, grantors: readonly string[], hasRow: boolean): string {
  const granted = grantors.length > 0
    ? `granted by ${grantors.join(', ')}`
    : 'granted by no bootstrap permission set';
  const consequence = hasRow
    ? 'an existing sys_capability row already resolves it and is left as-is — the declaration adds no package provenance'
    : grantors.length > 0
      ? 'falls back to the back-compat derived placeholder — the grant resolves, but with no package provenance (ADR-0086 D3: uninstall undefined)'
      : 'nothing derives it either — the capability is materialized nowhere';
  return `[security] declared capability "${name}" has no owning package (${granted}): ${consequence}`;
}

/**
 * Upsert ONE declared capability into `sys_capability` under the owning
 * `packageId`, applying the ADR-0066 D1 provenance rules (own-row re-seed,
 * derived-platform-row claim, curated/foreign/admin refuse-or-skip).
 *
 * Returns whether the name is MATERIALIZED — i.e. whether `sys_capability`
 * holds a row for it after this call, and so whether the caller must suppress
 * the back-compat derived placeholder for it (#4967 Part 1). The three refusal
 * paths differ, and the difference is the whole bug:
 *
 *  - CURATED platform name → `true`. The curated pass of
 *    `bootstrapSystemCapabilities` seeds every curated name unconditionally, so
 *    the row exists regardless of this refusal; the derived path cannot reach a
 *    curated name in the first place (it is already in the curated map), which
 *    makes the answer a no-op here — but a truthful one.
 *  - FOREIGN owner (and admin-authored rows) → `true`. A row exists and its
 *    label/description are AUTHORED; re-deriving would overwrite them with a
 *    humanized placeholder, which is exactly what the suppression list is for.
 *  - NO OWNING PACKAGE → `true` only if a row already exists. With no row this
 *    is the #4967 hole: suppressing the derivation left the capability existing
 *    nowhere, so it falls through and the placeholder is derived as it would
 *    have been had the declaration never been written.
 */
async function upsertPackageCapability(
  ql: any,
  cap: any,
  packageId: string | null | undefined,
  out: CapabilitySeedOutcome,
  grantors: readonly string[],
  /**
   * [#11096] The ONE batched existence read for the whole declaration, built
   * before the loop. Replaces this function's own per-item `SELECT`; see
   * `seed-name-lookup.ts` for why its third outcome (`unknown`) exists and must
   * never be collapsed into `absent`.
   */
  existingByName: ExistingByNameIndex,
  logger?: ProjectionLogger,
  /**
   * Collects writes the database REFUSED, so the pass reports them once
   * instead of returning a zero that reads as "nothing to do".
   */
  refusals?: SeedWriteRefusals,
): Promise<boolean> {
  if (!cap?.name) return false;

  // Curated platform capabilities are platform-owned — a package must never
  // claim one (that would let it silently redefine `manage_users`, `setup.access`, …).
  if (PLATFORM_CAPABILITY_NAMES.has(cap.name)) {
    out.skippedPlatform += 1;
    logger?.warn?.('[security] capability name is a curated platform capability — not materialized as package', { name: cap.name });
    return true;
  }

  const fields = capabilityRowFields(cap);
  // [#11096] ⛔ THREE outcomes, not two. `unknown` is the absence of any fact —
  // the read did not answer — and is not the fact "no such capability". The
  // provenance branches below every one of them turn on WHETHER A ROW WAS
  // FOUND (the refusal messages state a different consequence for each), so a
  // batched read that reported "not found" for a read it never got an answer
  // to would make every one of those diagnostics lie.
  const lookup = await existingByName.get(String(cap.name));
  if (lookup.status === 'unknown') {
    out.unreadable += 1;
    return false;
  }
  const existing = lookup.status === 'present' ? lookup.row : undefined;

  // A `managed_by:'package'` row without a `package_id` makes uninstall
  // undefined (the ambiguity ADR-0086 D3 removes) — skip an unowned declaration.
  //
  // ⚠️ The `hasRow` argument below is why the lookup happens BEFORE this
  // refusal rather than after it: the diagnostic's consequence clause differs
  // by whether a row already resolves the name. It is a definite answer here,
  // never a swallowed failure — `unknown` returned above.
  if (!packageId) {
    out.skippedUnowned += 1;
    logger?.warn?.(unownedRefusalMessage(cap.name, grantors, Boolean(existing?.id)), {
      name: cap.name,
      grantedBy: [...grantors],
    });
    return Boolean(existing?.id);
  }

  if (!existing?.id) {
    const row = {
      id: genId('cap'),
      name: cap.name,
      ...fields,
      managed_by: 'package',
      package_id: packageId,
      active: true,
    };
    const created = await tryInsert(ql, 'sys_capability', row, undefined, refusals);
    if (created) {
      out.seeded += 1;
      // [#11096] The oracle is a SNAPSHOT taken before the loop, so it cannot
      // see this insert. The per-item read could, and a name declared twice in
      // one batch therefore resolved as present on the second pass and took the
      // loud `skippedForeign` refusal below. Without this write-back the second
      // declaration would attempt its own insert, the `name` unique index would
      // refuse it, and a refusal that used to be REPORTED would become a silent
      // nothing.
      existingByName.remember(String(cap.name), row);
    }
    // A rejected insert leaves no row — fall through so the derivation gets its
    // own attempt rather than the name landing in a hole.
    return Boolean(created);
  }

  if (existing.managed_by === 'package') {
    if (existing.package_id === packageId) {
      // Our own row — re-seed so it always reflects the shipped declaration.
      //
      // [#11096] ⚠️ Only when the stored row ACTUALLY DIFFERS. An unconditional
      // UPDATE here cost one remote round trip per declared capability on every
      // boot to store the values already there — and the capability set is the
      // union of every capability every package declares, so it is typically
      // the largest of the identity axes.
      //
      // ⛔ The skip is an EQUALITY test, never a presence test. Deleting the
      // `else if` and always taking the `unchanged` arm would produce a
      // perfect round-trip count while this seeder silently stopped
      // reconciling anything — the failure shape the paired drift tests in
      // `bootstrap-seed-round-trips.test.ts` exist to make impossible.
      if (!capabilityRecordDiffers(existing, fields)) {
        out.unchanged += 1;
      } else if (await tryUpdate(ql, 'sys_capability', { id: existing.id, ...fields }, undefined, refusals)) {
        out.updated += 1;
      }
    } else {
      out.skippedForeign += 1;
      logger?.warn?.('[security] capability name owned by another package — skipped', {
        name: cap.name, declaredBy: packageId, ownedBy: existing.package_id,
      });
    }
    // Either way a package-authored row exists and must not be re-derived over.
    return true;
  }

  if (existing.managed_by === 'platform') {
    // Non-curated (curated excluded above) platform row = a derived-from-
    // systemPermissions placeholder. The explicit declaration CLAIMS it:
    // upgrade to package provenance with the authored label/description/scope.
    if (await tryUpdate(ql, 'sys_capability', { id: existing.id, ...fields, managed_by: 'package', package_id: packageId }, undefined, refusals)) {
      out.claimed += 1;
    }
    return true;
  }

  // `admin` (or any other) — environment/admin-authored. Never clobbered.
  out.skippedAdmin += 1;
  return true;
}

export async function bootstrapDeclaredCapabilities(
  ql: any,
  metadataService: any,
  options: SeedOptions = {},
): Promise<CapabilitySeedOutcome> {
  const out: CapabilitySeedOutcome = {
    seeded: 0, updated: 0, claimed: 0, unchanged: 0, unreadable: 0,
    skippedAdmin: 0, skippedForeign: 0, skippedPlatform: 0, skippedUnowned: 0,
    materializedNames: [],
  };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  let caps: any[] = readDeclared(ql, 'capability');
  if (caps.length === 0) {
    try {
      const listed = metadataService?.list?.('capability');
      caps = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { caps = []; }
  }
  if (!Array.isArray(caps) || caps.length === 0) return out;

  const grantorsByCapability = indexGrantors(options.permissionSets);

  // One log per pass, not per refused row: a legacy platform-wide unique index
  // refuses EVERY declared capability, and a line each would bury the remedy.
  const refusals = createSeedWriteRefusals();

  // [#11096] ONE existence read for the whole declaration, hoisted out of the
  // loop below. Each declared capability used to cost its own sequential
  // `SELECT … WHERE name = ? LIMIT 1` — invisible on a local file database, one
  // separate awaited HTTP request per name on the remote libsql/Turso database
  // every hosted environment runs, competing for the same request budget as the
  // rest of boot.
  //
  // ⚠️ NOT threaded with an organization, deliberately: this seeder's read, its
  // insert and its update are all organization-less today (unlike the position
  // and permission-set doors), so an unscoped lookup is EXACTLY the question the
  // per-item read asked — `resolveOwnOrganizationRow` returns the first row when
  // no organization is given, which is what `tryFind(…, 1)[0]` returned. Making
  // this catalog per-organization is a separate change with its own migration,
  // not a rider on a round-trip fix.
  const existingByName = await buildExistingByName(
    ql,
    'sys_capability',
    caps.map((c) => c?.name),
    options.logger,
  );

  for (const cap of caps) {
    if (!cap?.name) continue;
    // Registry provenance first (ADR-0010 `_packageId`), author-declared
    // spec `packageId` (ADR-0086 D3) as fallback.
    const packageId: string | undefined = cap._packageId ?? cap.packageId ?? undefined;
    const grantors = grantorsByCapability.get(cap.name) ?? [];
    const materialized = await upsertPackageCapability(ql, cap, packageId, out, grantors, existingByName, options.logger, refusals);
    // [#4967 Part 1] Report the name ONLY once this pass knows a row exists for
    // it. Reporting it before the upsert decided anything is what let a refused
    // declaration suppress the derivation it needed.
    if (materialized) out.materializedNames.push(cap.name);
  }

  // Before the counts, so an operator reads WHY the count is zero beside it.
  // This seeder is organization-less today (see the lookup note above), so the
  // report carries no organization either.
  warnSeedWriteRefusals(options.logger, refusals);
  if (out.unreadable > 0) {
    // [#11096] Said ONCE with the count, like the sibling seeders: a per-name
    // warn on a database that is down is a log flood that buries its own
    // meaning. The consequence is spelled out because "unreadable" alone does
    // not state one — these names were left ENTIRELY alone, so a genuinely new
    // declaration among them has not been created and a drifted one has not
    // been healed; the next boot with a readable database does both.
    options.logger?.warn?.(
      '[security] declared capabilities left untouched — their sys_capability rows could not be read',
      { unreadable: out.unreadable, total: caps.length },
    );
  }
  options.logger?.info?.('[security] declared capabilities seeded into sys_capability (ADR-0066 D1)', {
    ...out, total: caps.length,
  });
  return out;
}
