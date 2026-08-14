// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapSystemCapabilities — back-compat seed the capability registry
 * (ADR-0066 D1).
 *
 * Promotes the platform's authorization capabilities from bare strings to
 * first-class `sys_capability` records. Idempotently upserts (by `name`):
 *   1. a CURATED set of well-known platform capabilities (label/description/
 *      scope), and
 *   2. any capability referenced by the seeded permission sets'
 *      `systemPermissions[]` that isn't in the curated set (derived defaults),
 * so every string a default grant references resolves to a definition record
 * while existing string references keep working unchanged (no migration).
 *
 * Pre-launch posture: upsert only — never prune (admins may add their own
 * capabilities in Setup; package-declared capabilities arrive via their own
 * seeding). Platform-seeded rows are `managed_by: 'platform'` so they are not
 * presented as admin-deletable. Runs on `kernel:ready` alongside the other
 * security bootstraps.
 *
 * [#5876] The two halves have DIFFERENT authority over an existing row's
 * display fields, because they have different claims to authorship:
 *   - CURATED — the platform authored `label`/`description`, and a new version
 *     may ship new copy, so the row it finds is refreshed;
 *   - DERIVED — there is no authored copy at all, only `humanize(name)` and
 *     `Capability <name>.` generated from a granted string, so it refreshes
 *     only its OWN placeholder (`managed_by:'platform'` on a non-curated name)
 *     and never a row an admin or a package authored.
 * The seed loop used to refresh both alike while the comment in front of it
 * claimed admin edits were preserved — what #2909 T3 actually made seed-once is
 * `scope`, and only `scope`.
 *
 * [#8470] The CURATED half looks up THE ROW THE PLATFORM OWNS, not the first row
 * that happens to share the name.
 *
 * `tryFind` runs under `SYSTEM_CTX`, which carries no `tenantId`: the security
 * middleware short-circuits on `isSystem` before Layer 0 is composed, and the
 * engine's `buildDriverOptions` sets a driver tenant scope only when
 * `execCtx.tenantId !== undefined`. The lookup therefore reads ACROSS
 * organizations by construction — which is correct for a seeder, and is exactly
 * why the predicate has to say which row it means.
 *
 * Since #8461 made `sys_capability.name` unique per ORGANIZATION rather than per
 * installation (ADR-0120 D1, the cross-tenant existence oracle #8323 reports), an
 * admin may author `manage_users` inside their organization while the platform
 * holds its own row in the NULL-organization bucket. A lookup on `{ name }` alone
 * then has two candidates and picks between them on grounds unrelated to
 * ownership, with two harms: an organization's authored copy is overwritten with
 * the platform's at every boot, and — when the org row is the one selected before
 * the platform's row exists — the curated row is NEVER INSERTED, in any bucket,
 * installation-wide.
 *
 * Note what the remedy is NOT. "Give the lookup an ORDER BY" was already true and
 * did not help: #4363's pagination tie-breaker appends `ORDER BY id ASC` to any
 * paged read of a driver-managed table, and `limit: 1` counts as paged on both
 * `SqlDriver` and `MongoDBDriver` (only `findOne` opts out via
 * `singleRowLookup`). So this lookup was already DETERMINISTIC on the shipped
 * drivers — deterministic on `id`, a key with no relationship whatsoever to who
 * owns the row, and stable per installation, so a boot that reconciles the wrong
 * row keeps reconciling it forever rather than self-healing. Determinism was
 * never the missing property; OWNERSHIP was.
 *
 * The predicate is therefore `managed_by: 'platform'` AND `organization_id: null`
 * — the two facts that jointly define "the platform's own row". They also make
 * the result set provably a singleton, which is what retires the ordering
 * question rather than answering it: the post-#8461 unique key is
 * `(COALESCE(organization_id, …), name)`, so the NULL-organization bucket admits
 * at most ONE row per name, and `limit: 1` over a set of size ≤ 1 cannot be
 * arbitrary. `managed_by` alone would not carry that guarantee (a platform-marked
 * row sitting inside an organization — from seed data or a legacy import — would
 * restore the two-candidate state), and `organization_id` alone would not
 * distinguish the platform's row from an admin's in a single-organization
 * deployment, where both live in the same bucket.
 *
 * The DERIVED half's lookup is deliberately UNCHANGED (its own guard, #5876,
 * already refuses to touch a row it does not own).
 *
 * [#8751] …and that guard now spells "a row it does not own" with the SAME
 * conjunction. The lookup stays cross-organization; the OWNERSHIP TEST is what
 * changes, from `managed_by === 'platform'` to
 * `managed_by === 'platform' AND organization_id == null`.
 *
 * The paragraph four blocks up already stated why, for the curated half:
 * `managed_by` alone "would not carry that guarantee (a platform-marked row
 * sitting inside an organization — from seed data or a legacy import — would
 * restore the two-candidate state)". The derived half kept the single-condition
 * test, so post-#8461 it ADMITTED exactly that row: the guard passed, and the
 * update below rewrote an organization's `label`/`description` with
 * `humanize(name)` — the precise harm #5876 exists to prevent — while the
 * platform bucket was never written. No counter moved and nothing was logged,
 * because both #5876's counter and #8536's live on the branch where the guard
 * DECLINES.
 *
 * This restores a declared invariant; it does not widen an accept set. What the
 * derived half may refresh is narrowed to the rows it provably owns, and the
 * newly-declined row flows through the #8536 skip branch unchanged — counted in
 * `skippedAuthored`, its bucket read once, warned only where the platform's own
 * placeholder is genuinely absent. The misplaced stamp gets its OWN signal
 * ({@link CapabilitySeedResult.platformStampedInOrg}) rather than being folded
 * into `unseededDerived`: "the platform's definition is missing" and "a row is
 * wearing the platform's stamp where the platform never writes" are different
 * facts, and #8536's counter is left meaning exactly what it was defined to
 * mean.
 *
 * REACHABILITY, measured (the filing declined to guess, and this is the answer).
 * The platform's own artifacts do NOT produce such a row: both capability
 * seeders run under `SYSTEM_CTX` with no `tenantId` and never write
 * `organization_id`; `normalizeManagedByVocab` does not touch this object; and
 * the admin door refuses the stamp outright — `assertSystemRowWriteGate` (a)
 * rejects any payload CLAIMING platform/package provenance on `sys_capability`.
 * No `sys_capability` seed dataset exists anywhere in this repository.
 *
 * The ROUTE, however, is live and needs no unsupported step. `SeedLoaderService`
 * writes as `isSystem` precisely "so seeds can target system tables like
 * `sys_*`", which short-circuits the write gate above; `defineSeed(SysCapability,
 * …)` type-checks `managed_by: 'platform'` because the column is a plain
 * authorable select; and on the per-organization replay the loader's tenant stamp
 * is `config.organizationId ?? (/^(sys_|cloud_|ai_)/.test(objectName) ? undefined
 * : fallbackOrgId)` — the pinned organization SHORT-CIRCUITS the `sys_` exemption,
 * so a replayed `sys_capability` seed lands stamped with that organization's id.
 * `applyPublishedSeeds` pins that `organizationId` from the caller's ACTIVE
 * organization, so an app seeding a capability with platform provenance produces
 * this row in every organization its seeds are applied into.
 *
 * That last link is MEASURED, not traced — against the real `SeedLoaderService`
 * (harness shaped like objectql's `seed-loader-org-stamp.test.ts`). A
 * `sys_capability` seed carrying `managed_by: 'platform'` inserted
 * `organization_id: 'org_msbubm8g3j35rgx0'` with an organization pinned, and
 * inserted the same row UNSTAMPED with none pinned — the control that shows the
 * `sys_` exemption is otherwise intact, so the stamp is the pin's doing and not
 * the harness's. What is deliberately NOT claimed: how many organizations a given
 * deployment replays seeds into is a provisioning question this repository cannot
 * answer.
 *
 * VERDICT — a DORMANT asymmetry with a LIVE route, not a live defect. Dormant
 * because nothing shipped here walks the route; live-routed because walking it
 * takes ordinary authoring and no unsupported step. The fix lands on that basis:
 * it removes a trap and restores a declared invariant, and the severity claim
 * stays exactly that size. The trap is worth removing because the mistake would be
 * invisible — the resulting row is one ADR-0066 asset ownership forbids the
 * organization's own admin from editing or deleting through Setup.
 *
 * [#8536] The DERIVED half's skip is REPORTED. The guard stays exactly as #5876
 * wrote it — it keeps declining, and #8552 settled the posture on an occupied
 * platform bucket: keep declining, LOUDLY, with no adoption and no backfill.
 * Only the observability changes here.
 *
 * What made the silence wrong is again #8461. "A row resolves this name" and
 * "the platform holds a row for this name" used to be ONE statement, which is
 * what #5876's reasoning rests on ("the capability resolves and the authored
 * copy is the better one"). Per-organization uniqueness split them: the derived
 * lookup reads across organizations, so an organization's row satisfies it while
 * the NULL-organization bucket is never written at all — and `continue` runs
 * before any insert is attempted, so nothing anywhere reports the empty bucket.
 *
 * So the skip branch reads the platform bucket once — on that branch only, the
 * same cost the curated half accepted — and warns with the same provenance-
 * naming shape. It warns only where the platform's OWN placeholder is genuinely
 * absent: a skip that declines a mere REFRESH (the placeholder is present, it
 * simply was not the row the cross-organization lookup selected) stays
 * summary-only. That keeps the warning meaning exactly one thing — the
 * platform's definition for this name is missing from sys_capability — instead
 * of firing on every authored row, which is the state #4632 declined to alarm
 * about and which remains counted in `skippedAuthored`.
 */

import { PLATFORM_CAPABILITIES, type PlatformCapability } from '@objectstack/spec/security';

const SYSTEM_CTX = { isSystem: true };

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

async function tryFind(ql: any, object: string, where: any, limit = 1): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try { return await ql.insert(object, data, { context: SYSTEM_CTX }); } catch { return null; }
}
async function tryUpdate(ql: any, object: string, data: any): Promise<boolean> {
  try { await ql.update(object, data, { context: SYSTEM_CTX }); return true; } catch { return false; }
}

type CapabilityDef = PlatformCapability;

/**
 * Well-known platform capabilities. Re-exported from the canonical spec registry
 * (`@objectstack/spec/security` `PLATFORM_CAPABILITIES`) so the seeder and the
 * authoring lint (ADR-0066 ⑨) share ONE source of truth. `managed_by` is always
 * `'platform'` for these. Kept as a named export for back-compat consumers/tests.
 */
export const KNOWN_CAPABILITIES: readonly CapabilityDef[] = PLATFORM_CAPABILITIES;

function humanize(name: string): string {
  return name
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface SeedOptions {
  logger?: { info?: (m: string, meta?: Record<string, any>) => void; warn?: (m: string, meta?: Record<string, any>) => void };
  /**
   * [ADR-0066 D1] Capability names that `bootstrapDeclaredCapabilities` has
   * confirmed ALREADY HAVE a `sys_capability` row
   * ({@link CapabilitySeedOutcome.materializedNames}). The implicit
   * derived-defaults path SKIPS these so it never overwrites an authored
   * capability's label/description (or its package provenance) with a humanized
   * placeholder. Curated platform capabilities are unaffected.
   *
   * [#4967 Part 1] "Materialized", NOT "declared": a declaration the seeder
   * REFUSED (no owning package) writes no row, so suppressing the derivation
   * for it left the capability existing in no row at all and every
   * `systemPermissions` grant naming it inert. Such a name is deliberately
   * absent from this list and derives its placeholder as it always did.
   */
  materializedCapabilityNames?: Iterable<string>;
}

/** Aggregated outcome of a back-compat capability seeding pass. */
export interface CapabilitySeedResult {
  /** Rows inserted (curated definitions + derived placeholders). */
  seeded: number;
  /** Rows whose platform display fields were reconciled. */
  updated: number;
  /**
   * [#5876] Derived names whose existing row is NOT the platform's own, so its
   * `label`/`description` were left as their author wrote them. Not a
   * degradation where the platform's own placeholder exists — the capability
   * resolves and the authored copy is the better one — so THAT case is reported
   * in the boot summary rather than warned about (#4632).
   *
   * [#8751] "The platform's own" is the #8470 conjunction — `managed_by:
   * 'platform'` AND `organization_id: null`. This doc used to read "`managed_by`
   * anything but `'platform'`", which is what the guard actually tested; the
   * text is corrected in step with the guard, not repurposed. The concept is
   * untouched (a row this pass does not own was left alone); what changed is
   * that a platform-STAMPED row inside an organization now falls inside it,
   * instead of being silently reconciled as though the platform had written it.
   *
   * [#8536] Counts EVERY such skip, unchanged. The subset where the skip also
   * leaves the platform bucket without a platform-owned row is the degradation
   * #4632 never had to consider, and is counted again — and warned — as
   * {@link CapabilitySeedResult.unseededDerived}.
   */
  skippedAuthored: number;
  /**
   * [#8536] The subset of {@link CapabilitySeedResult.skippedAuthored} whose
   * skip leaves the platform (NULL-organization) bucket with NO platform-owned
   * row: the derived placeholder exists nowhere the platform owns, installation-
   * wide. The derived counterpart of {@link CapabilitySeedResult.blockedCurated}
   * — same harm, reached by a different route (the #5876 guard `continue`s
   * before an insert is ever attempted, so there is no refusal to observe).
   *
   * A SUBSET rather than a split, deliberately: `skippedAuthored` keeps its
   * meaning and its value, because "an authored row was left alone" and "the
   * platform's definition is missing" are different facts and #8461 is what made
   * them separable. Both are reported; neither is inferred from the other.
   */
  unseededDerived: number;
  /**
   * [#8751] The subset of {@link CapabilitySeedResult.skippedAuthored} whose
   * skipped row carries the platform's OWN provenance stamp
   * (`managed_by: 'platform'`) while sitting INSIDE an organization — the shape
   * the header contemplates ("from seed data or a legacy import"), and the one
   * the derived guard used to ADMIT and overwrite.
   *
   * Its own signal, deliberately, and NOT a re-scoping of
   * {@link CapabilitySeedResult.unseededDerived}. The two answer different
   * questions and neither implies the other: `unseededDerived` says the
   * platform's definition is missing installation-wide; this says a row is
   * wearing the platform's stamp somewhere no platform writer writes. They
   * co-occur on the headline fixture, but this one is counted even when the
   * platform bucket IS properly occupied and nothing is missing — a state that
   * stays summary-only (#4632) and warns nothing, yet is still an anomaly worth
   * seeing in the boot summary, because a platform-stamped row is one ADR-0066
   * asset ownership refuses to let the organization's own admin edit or delete.
   *
   * Reported, never acted on: adoption and backfill were both rejected in
   * #8552, and re-stamping somebody else's row is a data migration either way.
   */
  platformStampedInOrg: number;
  /**
   * [#8470] Curated definitions whose platform row is ABSENT and could not be
   * written, because a row this pass does not own already holds the name in the
   * NULL-organization bucket (a Setup-authored row on a single-organization
   * deployment, or a package row that claimed a curated name).
   *
   * This counter exists because the alternative is silence in both directions.
   * Before the ownership-scoped lookup the seeder resolved that collision by
   * OVERWRITING the other author's row; now it correctly declines to — but
   * `tryInsert` swallows the engine's unique-constraint refusal, so declining
   * would otherwise look exactly like a clean boot while a curated capability is
   * missing from the registry installation-wide. Counted and warned, never
   * silent.
   */
  blockedCurated: number;
  /** Definitions considered this pass (curated + derived). */
  total: number;
}

export async function bootstrapSystemCapabilities(
  ql: any,
  permissionSets: Array<{ systemPermissions?: string[] }> = [],
  options: SeedOptions = {},
): Promise<CapabilitySeedResult> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return {
      seeded: 0, updated: 0, skippedAuthored: 0, unseededDerived: 0,
      platformStampedInOrg: 0, blockedCurated: 0, total: 0,
    };
  }

  const materialized = new Set<string>(options.materializedCapabilityNames ?? []);

  // Build the full definition set: curated first, then any extra capability
  // string referenced by the seeded permission sets (derived defaults) — EXCEPT
  // ones that already have a row, which the declared seeder owns.
  const byName = new Map<string, CapabilityDef>();
  for (const c of KNOWN_CAPABILITIES) byName.set(c.name, c);
  // [#5876] Which names came from the DERIVED half. The two halves carry
  // different authority over an existing row's display fields (see the
  // reconcile guard below), and after this loop `byName` cannot tell them
  // apart on its own.
  const derivedNames = new Set<string>();
  for (const ps of permissionSets) {
    for (const cap of ps?.systemPermissions ?? []) {
      if (typeof cap === 'string' && cap && !byName.has(cap) && !materialized.has(cap)) {
        byName.set(cap, { name: cap, label: humanize(cap), description: `Capability ${cap}.`, scope: 'platform' });
        derivedNames.add(cap);
      }
    }
  }

  let seeded = 0;
  let updated = 0;
  let skippedAuthored = 0;
  let unseededDerived = 0;
  let platformStampedInOrg = 0;
  let blockedCurated = 0;
  for (const def of byName.values()) {
    const isDerived = derivedNames.has(def.name);
    // [#8470] CURATED: address the platform's OWN row. DERIVED: unchanged — its
    // own `managed_by` guard below is what keeps it off rows it does not own
    // (#5876), and narrowing its lookup here would change a half this card
    // deliberately leaves alone.
    const lookup = isDerived
      ? { name: def.name }
      : { name: def.name, managed_by: 'platform', organization_id: null };
    const existing = await tryFind(ql, 'sys_capability', lookup, 1);
    const row = existing[0];
    if (row?.id) {
      // [#5876] Reconcile display fields only where THIS pass owns the copy.
      //
      // A DERIVED name has no authored copy to ship: `label` is `humanize(name)`
      // and `description` is `Capability <name>.`, both generated from the
      // string a permission set happened to grant. Refreshing those onto a row
      // somebody else authored is not reconciliation, it is overwriting an
      // author with a placeholder — every boot, silently. For a non-curated
      // name a `managed_by:'platform'` row can only be this same derivation's
      // placeholder from an earlier boot, so that is exactly the set of rows
      // the derived half may refresh; `admin` (Setup-authored), `package`
      // (declared by its owning package) and anything else are left alone.
      //
      // The CURATED half is unchanged: those definitions are authored by the
      // platform and a new version legitimately ships new copy, so a curated
      // name still refreshes the row it finds.
      //
      // NOTE this is the WRITE-side enforcement of the same rule
      // `materializedCapabilityNames` states at the CALL site (#4967 Part 1):
      // the caller says which names another pass already materialized, and
      // this guard holds even when nothing said so — an admin row for a name
      // no package ever declared is invisible to that list.
      // [#8751] "Ours" is the #8470 conjunction, applied to the row the
      // cross-organization lookup returned. `managed_by` alone was the #5876
      // test, and it was sufficient only while `name` was unique
      // installation-wide; since #8461 it admits a platform-STAMPED row an
      // organization holds, which this half would then rewrite with
      // `humanize(name)` — the one thing #5876 exists to prevent.
      //
      // `== null` covers null AND absent, on purpose. A driver or projection
      // that does not return `organization_id` at all leaves ownership
      // undecidable, and the historical answer there is "this is our row" —
      // which is also the only answer that cannot invent a skip out of a
      // missing column.
      const derivedRowIsOurs = row.managed_by === 'platform' && row.organization_id == null;
      if (isDerived && !derivedRowIsOurs) {
        skippedAuthored += 1;
        // Counted for the CLASS, before the bucket read below decides whether
        // anything is missing: a misplaced stamp is an anomaly whether or not
        // the platform's placeholder happens to exist elsewhere.
        if (row.managed_by === 'platform') platformStampedInOrg += 1;
        // [#8536] Declining is the ruled behaviour (#5876, reaffirmed by #8552);
        // being SILENT about what the decline leaves behind is not. The lookup
        // above reads across organizations, so the row just skipped says nothing
        // about the platform's own bucket: it may be an organization's row while
        // the NULL-organization bucket sits empty, or the bucket's own occupant,
        // or neither — the platform's placeholder may be present and simply not
        // have been the row selected. Those are different facts, so read the
        // bucket rather than infer it, once, on this branch only.
        //
        // The unique key `(COALESCE(organization_id, …), name)` admits one row
        // per name there, so this read returns THE occupant or nothing.
        const platformRow = (
          await tryFind(ql, 'sys_capability', { name: def.name, organization_id: null }, 1)
        )[0];
        if (platformRow?.managed_by === 'platform') {
          // The placeholder exists; only a refresh of somebody else's row was
          // declined. Nothing is missing, so this stays summary-only (#4632) —
          // and warning here would make the warning mean nothing in particular.
          continue;
        }
        unseededDerived += 1;
        // Name the provenance READ, never an ownership verdict: on a row
        // carrying some other `managed_by` a sentence like "a row this pass does
        // not own" would be false, printed every boot (the curated half's rule,
        // applied to the row THIS half actually skipped).
        const provenance = row.managed_by == null
          ? 'a row carrying no managed_by value'
          : `a row with managed_by='${String(row.managed_by)}'`;
        const locality = row.organization_id == null
          ? 'in the platform (NULL-organization) bucket itself'
          : `inside organization '${String(row.organization_id)}'`;
        // THREE outcomes for the bucket, as on the curated side — and here a
        // fourth is impossible by construction: a platform-owned occupant
        // returned above.
        const bucket = platformRow === undefined
          ? 'NO row holds the name in that bucket at all — it is free, and nothing was written to it ' +
            'because the guard declines before any insert is attempted'
          : platformRow.id === row.id
            ? 'that row is itself the one holder the bucket admits for this name'
            : platformRow.managed_by == null
              ? 'a row carrying no managed_by value already holds the name there, and was left exactly as it is'
              : `a row with managed_by='${String(platformRow.managed_by)}' already holds the name there, ` +
                'and was left exactly as it is';
        // [#8552] The ruling leaves a colliding row to the OPERATOR, so where one
        // blocks the platform bucket the warning owes them the line that says how
        // to clear it by hand. Where the bucket is FREE there is nothing of theirs
        // to clear: what stands in the way is an organization's row, which
        // ADR-0066 D1 explicitly supports ("admins EXTEND the registry"), so
        // saying "rename it" would be advising the removal of a legitimate row.
        //
        // [#8751] …and a THIRD shape reaches this branch now that the guard
        // spells ownership as the conjunction: a row wearing the platform's own
        // stamp inside an organization. The organization-row sentence below must
        // NOT print for it — "a supported extension (admins EXTEND the registry)"
        // is true of `managed_by:'admin'` and false of this one, and "there is
        // nothing for an operator to remove" would be the wrong advice about the
        // one row here that nobody can remove through Setup at all.
        const remediation = platformRow !== undefined
          ? ' To resolve by hand: rename the row that holds the name in the platform bucket (or delete ' +
            'it) — through Setup for an admin-authored row, or by editing and re-publishing the owning ' +
            "package for a package-declared one — then restart; the seeder will then derive the platform's " +
            'placeholder.'
          : row.organization_id == null
            ? ''
            : row.managed_by === 'platform'
              ? " That row wears the platform's OWN provenance stamp while sitting inside an organization — " +
                'a shape no platform writer produces (both capability seeders write the NULL-organization ' +
                'bucket and never set organization_id, and the admin door refuses to stamp a platform value ' +
                'at all), so it most likely arrived as app seed data replayed per organization, or a legacy ' +
                'import. Fix it AT ITS SOURCE: Setup cannot, because ADR-0066 asset ownership refuses every ' +
                'admin-door edit and delete on a platform-stamped row. Note the platform bucket stays empty ' +
                "either way — that is the #8552 posture for an occupied name, not a consequence of the stamp."
              : " The organization's row is a supported extension (ADR-0066 D1 — admins EXTEND the " +
                'registry), so there is nothing for an operator to remove; the platform bucket is left empty ' +
                'deliberately, and adopting or backfilling it was rejected in #8552.';
        options.logger?.warn?.(
          `[security] derived capability "${def.name}" has no platform placeholder and none was seeded. ` +
            `The row this pass found for the name is ${provenance} ${locality}, and its label and ` +
            'description were left as their author wrote them (#5876 — unchanged). In the platform ' +
            `(NULL-organization) bucket, where the declared unique key admits one row per name: ${bucket}. ` +
            "The platform's own derived placeholder is therefore missing from sys_capability " +
            'installation-wide. Grants and requiredPermissions referencing the name are unaffected — ' +
            `they resolve by name, not by row.${remediation}`,
          {
            name: def.name,
            blockingRowId: row.id,
            blockingManagedBy: row.managed_by ?? null,
            blockingOrganizationId: row.organization_id ?? null,
            platformRowId: platformRow?.id,
          },
        );
        continue;
      }
      // Keep label/description fresh from the platform's own definition.
      // `scope` is an admin-editable classification face (plain select on
      // sys_capability), so it is seed-once: written on insert, never
      // refreshed (#2909 T3). A curated scope change in a new platform version
      // needs a data migration — recorded in the ADR-0094 addendum.
      if (await tryUpdate(ql, 'sys_capability', { id: row.id, label: def.label, description: def.description })) {
        updated += 1;
      }
    } else {
      const created = await tryInsert(ql, 'sys_capability', {
        id: genId('cap'),
        name: def.name,
        label: def.label,
        description: def.description,
        scope: def.scope,
        managed_by: 'platform',
        active: true,
      });
      if (created) seeded += 1;
      else if (!isDerived) {
        // [#8470] The curated row is absent AND could not be written — the
        // NULL-organization bucket already holds the name under a row the
        // scoped lookup did not match. Report it: a curated capability missing
        // from the registry is the harm this card is about, and an unreported
        // one is indistinguishable from a clean boot (`tryInsert` swallows the
        // engine's unique-constraint refusal).
        //
        // The diagnostic states what was OBSERVED, and it costs one extra read
        // — on this branch only — to be able to. The seeder knows two things:
        // no row matched `managed_by:'platform' AND organization_id IS NULL`,
        // and the insert was refused. It does NOT know who authored the row
        // that blocked it, so it must not say "a row this pass does not own":
        // that is an ownership verdict, and on a hypothetical platform row
        // carrying some other `managed_by` the sentence would be false, printed
        // every boot. Read the blocking row's provenance and name it instead.
        //
        // Note this REPORTS the distinction; it deliberately does not ACT on
        // it. Adopting a differently-stamped row into the platform's identity
        // would reverse the #5876 ruling that "not provably ours" resolves to
        // leave-it-alone, and backfilling a stamp is a data migration. Both are
        // maintainer calls, and neither is made here.
        blockedCurated += 1;
        // THREE outcomes, not two. "No row came back" and "a row came back
        // carrying no managed_by" are different observations, and collapsing
        // them would repeat this branch's own defect one level down: the insert
        // WAS refused, so something blocked it, and a follow-up read that finds
        // nothing is a genuinely interesting state (a racing writer, or a
        // refusal that was never the unique key) — not an ordinary unstamped
        // row. Say which one was seen.
        const blocking = (await tryFind(ql, 'sys_capability', { name: def.name, organization_id: null }, 1))[0];
        const observation = blocking === undefined
          ? 'NO blocking row is visible there at all — so the refusal was not the unique key, or the ' +
            'row has gone since. That is not an ordinary collision and is worth investigating'
          : blocking.managed_by == null
            ? 'a row carrying no managed_by value already holds the name, and was left exactly as it is'
            : `a row with managed_by='${String(blocking.managed_by)}' already holds the name, and was ` +
              'left exactly as it is';
        // [#8552] The maintainer's ruling deliberately leaves an existing
        // colliding row to the OPERATOR (option 1: no adoption, no backfill),
        // so the warning that reports the collision owes them the one line
        // that says how to resolve it by hand. Only when a blocking row was
        // actually observed — telling an operator to rename a row the read
        // just failed to find would be asserting what was not seen.
        const remediation = blocking === undefined
          ? ''
          : ' To resolve by hand: rename the blocking row to a name outside the curated set (or delete ' +
            'it) — through Setup for an admin-authored row, or by editing and re-publishing the owning ' +
            "package for a package-declared one — then restart; the seeder will then seed the platform's " +
            'definition. (New Setup rows can no longer take a curated name — refused at the write door.)';
        options.logger?.warn?.(
          `[security] curated capability "${def.name}" has no platform row and could not be seeded. ` +
            'In the platform (NULL-organization) bucket, where the declared unique key admits one row ' +
            `per name: ${observation}. The platform definition is therefore missing from sys_capability ` +
            'installation-wide. Grants and requiredPermissions referencing the name are unaffected — ' +
            `they resolve by name, not by row.${remediation}`,
          { name: def.name, blockingRowId: blocking?.id, blockingManagedBy: blocking?.managed_by ?? null },
        );
      }
    }
  }
  options.logger?.info?.('[security] system capabilities seeded into sys_capability (ADR-0066 D1)', {
    seeded, updated, skippedAuthored, unseededDerived, platformStampedInOrg, blockedCurated,
    total: byName.size,
  });
  return {
    seeded, updated, skippedAuthored, unseededDerived, platformStampedInOrg, blockedCurated,
    total: byName.size,
  };
}
