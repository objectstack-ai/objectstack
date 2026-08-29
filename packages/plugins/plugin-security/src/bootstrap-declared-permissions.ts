// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredPermissions — seed stack-declared `permissions` into
 * `sys_permission_set` (ADR-0086 D5; the exact sibling of
 * `bootstrapDeclaredPositions`).
 *
 * `stack.permissions` has always been declarable and runtime-ENFORCED (the
 * evaluator resolves declared sets through the metadata registry), but it was
 * never materialized as `sys_permission_set` records — the ADR-0078
 * inert-metadata smell: the admin surface (which reads the table) can't see a
 * package's sets, uninstall is undefined, and no provenance axis exists. This
 * seeder closes that gap:
 *
 *  - each declared set is upserted by `(name, organization_id)` with `managed_by: 'package'` and
 *    `package_id` = the registering package (`_packageId` stamped by the
 *    SchemaRegistry / ADR-0010 `applyProtection`, with the spec-level
 *    `packageId` (ADR-0086 D3) as the author-declared fallback);
 *  - IDEMPOTENT + UPGRADE-AWARE: a row this seeder owns
 *    (`managed_by:'package'`, same `package_id`) is re-seeded on every boot so
 *    the record always reflects the shipped declaration (version bumps
 *    included). Rows owned by a DIFFERENT package are skipped loudly;
 *  - env-authored rows are NEVER clobbered: `managed_by` of
 *    `platform`/`user` — or absent (legacy/pre-provenance rows, including the
 *    platform defaults inserted by `bootstrapPlatformAdmin`) — is left alone.
 *
 * Runs on `kernel:ready` after `bootstrapPlatformAdmin` (so the platform
 * defaults keep their existing insert-once shape) and alongside
 * `bootstrapDeclaredPositions`.
 *
 * The ENVIRONMENT door (env-scope metadata saves, the Setup data-door
 * write-through, boot reconciliation) lives in `permission-set-projection.ts`
 * (ADR-0094) — this module is the PACKAGE door only. Both project through the
 * shared {@link permissionSetRowFields} row shape so they can never hydrate
 * differently.
 *
 * [#10103] The PACKAGE door runs ONE PASS PER ORGANIZATION when a wall is in
 * force: `sys_permission_set` spells its name index `unique: 'organization'`,
 * and an organization-less row was measured unreadable by every principal on a
 * walled deployment — Layer 0's strict `organization_id = :tenant` AND-composes
 * over the driver's compatibility arm and the conjunction is the strict equality
 * alone. `single` posture keeps exactly one organization-less pass. The
 * ENVIRONMENT door is deliberately NOT converted: its organization-less residue
 * (and `bootstrapPlatformAdmin`'s platform defaults) stays outside this change,
 * unreaped and warned about loudly. See `per-organization-catalog.ts`.
 */

import {
  genId,
  permissionSetRowFields,
  recordDiffersFromBody,
  tryInsert,
  tryUpdate,
  type PermissionSeedOutcome,
  type ProjectionLogger,
} from './permission-set-projection.js';
import {
  buildExistingByName,
  type ExistingByNameIndex,
  type ExistingLookupResult,
} from './seed-name-lookup.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import {
  createSeedWriteRefusals,
  resolveOwnOrganizationRow,
  seedCtx,
  warnOrganizationLessRows,
  reportSeedWriteRefusals,
  type SeedWriteRefusals,
} from './per-organization-catalog.js';

export type { PermissionSeedOutcome } from './permission-set-projection.js';

/**
 * The per-name existence read used when no batched oracle was supplied (the
 * ADR-0086 P2 publish materializer, which upserts exactly one set). Reports the
 * same three outcomes the batched oracle does — a failed read must not read as
 * "absent" on this path either.
 */
async function defaultLookup(ql: any, name: string, organizationId?: string): Promise<ExistingLookupResult> {
  let rows: any;
  try {
    // Limit 5, not 1, when scoped: a scoped read returns organization-less rows
    // alongside this organization's own, and one row would be whichever the
    // driver ordered first (#10103).
    rows = await ql.find(
      'sys_permission_set',
      { where: { name }, limit: organizationId ? 5 : 1 },
      { context: seedCtx(organizationId) },
    );
  } catch {
    return { status: 'unknown' };
  }
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : null;
  if (list === null) return { status: 'unknown' };
  // [#10103] This organization's own row answers; an organization-less leftover
  // is reported beside `absent` and never returned as `present`. One spelling of
  // that question for the whole catalog — see `per-organization-catalog.ts`.
  const { own, organizationLessResidue } = resolveOwnOrganizationRow(list, organizationId);
  if (own) return { status: 'present', row: own };
  return organizationLessResidue
    ? { status: 'absent', organizationLessResidue }
    : { status: 'absent' };
}

interface SeedOptions {
  logger?: ProjectionLogger;
  /**
   * Seed THIS organization's copies. Omitted = the `single`-posture pass, the
   * one place an organization-less catalog row is the correct shape.
   */
  organizationId?: string;
  /**
   * [#11532] Names that `bootstrapPlatformAdmin` still seeds organization-less
   * on every boot — the PLATFORM BUCKET. Supplied by the caller because the
   * caller is the one holding that array (`security-plugin.ts` hands the same
   * `bootstrapPermissionSets` to the platform bootstrap and to the manifest),
   * so the list is exact rather than inferred from a row's provenance.
   *
   * An organization-less row for one of these names is NOT a pre-fix leftover
   * and the pre-fix remedy is a loop for it: re-initializing the deployment
   * mints it again on the next boot. See {@link warnOrganizationLessRows}.
   *
   * Omitted falls back to the SHIPPED `defaultPermissionSets` — which is what
   * `bootstrapPlatformAdmin` seeds unless the host passed
   * `SecurityPluginOptions.defaultPermissionSets`. So the classification is
   * right for every shipped composition even if this option is never threaded,
   * and the option exists for the one case the fallback cannot know about: a
   * host that overrode the array. Pass `[]` to state that this caller's
   * deployment has no organization-less writer at all.
   */
  platformBucketNames?: readonly string[];
}

/**
 * Read declared metadata items of a type. The engine's SchemaRegistry
 * (populated by `manifest.register` from the stack's `permissions` array,
 * items provenance-stamped with `_packageId`) is the reliable source in every
 * boot path; the metadata-service facade only surfaces these once the
 * compiled-artifact loader runs (serve.ts).
 *
 * [#8378] The registered item IS the authoring document — there is no
 * `{ name, content }` envelope to unwrap, so the `i?.content ?? i` this read
 * used to carry is gone. Same measurement #7519 made for `MetadataFacade`,
 * re-taken at this seam: `registerMetadataCollections` (objectql `engine.ts`)
 * registers each stack-collection element as-is, and `loadMetaFromDb` registers
 * `convertStoredItem(JSON.parse(record.metadata))` — the parsed body, never the
 * `sys_metadata` row. Nothing in the tree produces the envelope.
 *
 * Removal is a FIX, not a tidy-up. The types read through here (`permission`,
 * `capability`, `object`) all reject `content` as an unrecognized key, so
 * whenever the key did appear the unwrap replaced a whole authoring document
 * with one of its values — and `''`, falsy but non-nullish, passed `??` and
 * then died at the `filter(Boolean)` below, dropping the item with no
 * diagnostic at all.
 */
export function readDeclared(engine: any, type: string): any[] {
  try {
    const reg = engine?.registry;
    if (reg?.listItems) {
      return (reg.listItems(type) ?? []).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

/**
 * Upsert ONE declared/published PermissionSet body into `sys_permission_set`
 * under the owning `packageId`, applying the ADR-0086 provenance rules
 * (own-row re-seed, foreign-package refuse, env-authored never clobbered).
 * Shared by the boot seeder (every declared set) and the publish-time
 * materializer (ADR-0086 P2 — a package-door set promoted from a draft). Returns
 * a one-hot outcome so callers can aggregate.
 */
export async function upsertPackagePermissionSet(
  ql: any,
  ps: any,
  packageId: string | null | undefined,
  logger?: SeedOptions['logger'],
  opts?: {
    /**
     * Existence oracle to consult instead of this function's own per-name
     * `SELECT` (#10946). The boot loop passes ONE batched read covering every
     * declared name; the publish materializer, which upserts a single set,
     * passes nothing and keeps the per-name read.
     */
    existingByName?: ExistingByNameIndex;
    /**
     * Seed THIS organization's copy (#10103). Omitted = the pre-existing
     * organization-less behaviour, which the `single`-posture pass and the
     * ADR-0086 P2 publish materializer both want.
     */
    organizationId?: string;
    /** Collects names whose pre-fix organization-less row is still standing. */
    residue?: string[];
    /**
     * Collects writes the database REFUSED, so the pass can report them once
     * instead of returning a zero that reads as "nothing to do". Passed by the
     * boot catalog loop; the ADR-0086 P2 publish materializer passes nothing
     * and keeps its own honest outcome (`success: false` with a reason when it
     * materialized nothing).
     */
    refusals?: SeedWriteRefusals;
  },
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, unchanged: 0, unreadable: 0, skippedEnvAuthored: 0, skippedForeign: 0 };
  if (!ps?.name) return out;
  // A `managed_by:'package'` row without a `package_id` would make uninstall
  // undefined again — the exact ambiguity ADR-0086 D3 exists to remove — so a
  // set with no resolvable owner is skipped rather than materialized unowned.
  if (!packageId) {
    logger?.warn?.('[security] permission set has no owning package — not materialized', { name: ps.name });
    return out;
  }

  // ⛔ Three outcomes, not two (#10946 / #3807). `unknown` — the read FAILED —
  // is not "no such row": inserting on it would re-create a set that already
  // exists, and on a batched read one failure speaks for every declared name at
  // once. Declining is the answer; the caller's warn reports it.
  const organizationId = opts?.organizationId;
  const lookup = opts?.existingByName
    ? await opts.existingByName.get(String(ps.name))
    : await defaultLookup(ql, String(ps.name), organizationId);
  if (lookup.status === 'unknown') {
    out.unreadable += 1;
    return out;
  }
  // [#10103] `absent` can still carry a PRE-FIX organization-less row that is
  // merely VISIBLE here through the driver's compatibility arm. It is not this
  // organization's row, so the copy below is created either way — the leftover
  // is only reported. Reading it as "already seeded" is the silent no-op the
  // per-organization catalog exists to prevent.
  if (lookup.status === 'absent' && lookup.organizationLessResidue && ps.name) {
    opts?.residue?.push(String(ps.name));
  }
  const existing = lookup.status === 'present' ? lookup.row : undefined;
  if (!existing?.id) {
    const row = {
      id: genId('ps'),
      name: ps.name,
      ...permissionSetRowFields(ps),
      active: true,
      package_id: packageId,
      managed_by: 'package',
    };
    const created = await tryInsert(ql, 'sys_permission_set', row, organizationId, opts?.refusals);
    if (created) {
      out.seeded += 1;
      // A batched oracle is a snapshot taken before the loop — tell it about
      // the row we just made, so a name declared twice in one batch still
      // reaches the collision branch below instead of a second insert.
      opts?.existingByName?.remember(String(ps.name), row);
    }
    return out;
  }

  if (existing.managed_by === 'package') {
    if (existing.package_id === packageId) {
      // Our own row — re-seed so the record always reflects the shipped/published
      // declaration (idempotent; covers version bumps without bookkeeping).
      //
      // [#10946] "Idempotent" was implemented as "write the same columns every
      // time", which on a remote libsql/Turso database is two HTTP round trips
      // per set on every boot to change nothing. `recordDiffersFromBody` is the
      // SAME comparison the ADR-0094 boot reconciler already trusts to decide
      // whether a record drifted, over exactly the columns
      // `permissionSetRowFields` writes — so a row it calls equal is a row this
      // UPDATE could not have changed.
      //
      // ⚠️ The skip is on EQUALITY, never on "we have seen this name". A row
      // whose stored value differs — a version bump, a hand-edit, a partially
      // applied write — still gets its UPDATE, because dropping that leg would
      // turn the loop into a no-op that reconciles nothing while showing a
      // beautiful round-trip curve.
      if (!recordDiffersFromBody(existing, ps)) {
        out.unchanged += 1;
      } else if (await tryUpdate(ql, 'sys_permission_set', { id: existing.id, ...permissionSetRowFields(ps) }, organizationId, opts?.refusals)) {
        out.updated += 1;
      }
    } else {
      // Package-namespaced object api names make set-name collisions a
      // packaging bug, not a merge case — refuse loudly (ADR-0086 D4:
      // a package never writes into a foreign record).
      out.skippedForeign += 1;
      logger?.warn?.('[security] permission set name owned by another package — skipped', {
        name: ps.name, declaredBy: packageId, ownedBy: existing.package_id,
      });
    }
    return out;
  }

  // `platform`/`user` — or absent (legacy rows, incl. bootstrapPlatformAdmin
  // defaults): env-authored config. Never clobbered by package materialization.
  out.skippedEnvAuthored += 1;
  return out;
}

/**
 * [#11532] The names the SHIPPED `bootstrapPlatformAdmin` seeds
 * organization-less on every boot. Computed once from the same declaration the
 * platform bootstrap iterates, so the two cannot drift within a release.
 */
const SHIPPED_PLATFORM_BUCKET_NAMES: readonly string[] = defaultPermissionSets
  .map((ps) => ps.name)
  .filter((n): n is string => typeof n === 'string' && n !== '');

export async function bootstrapDeclaredPermissions(
  ql: any,
  metadataService: any,
  options: SeedOptions = {},
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, unchanged: 0, unreadable: 0, skippedEnvAuthored: 0, skippedForeign: 0 };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  let sets: any[] = readDeclared(ql, 'permission');
  if (sets.length === 0) {
    try {
      const listed = metadataService?.list?.('permission');
      sets = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { sets = []; }
  }
  if (!Array.isArray(sets) || sets.length === 0) return out;

  // [#10946] ONE existence read for the whole declaration, before the loop —
  // the set of names is known in full here. See `seed-name-lookup.ts` for why
  // a read that cannot ANSWER must not be read as "none of them exist".
  const organizationId = options.organizationId;
  const existingByName = await buildExistingByName(
    ql,
    'sys_permission_set',
    sets.map((ps) => ps?.name),
    options.logger,
    organizationId,
  );
  // Names for which a PRE-FIX organization-less row is still standing. This
  // organization's own row is created regardless — the leftover is reported,
  // never treated as "already seeded" (#10103).
  const residue: string[] = [];
  // One log per pass, not per refused row: a legacy platform-wide unique index
  // refuses EVERY declared permission set, and a line each would bury the remedy.
  const refusals = createSeedWriteRefusals();

  for (const ps of sets) {
    if (!ps?.name) continue;
    // Registry provenance first (ADR-0010 `_packageId`), author-declared
    // spec `packageId` (ADR-0086 D3) as fallback.
    const packageId: string | undefined = ps._packageId ?? ps.packageId ?? undefined;
    const r = await upsertPackagePermissionSet(ql, ps, packageId, options.logger, { existingByName, organizationId, residue, refusals });
    out.seeded += r.seeded;
    out.updated += r.updated;
    out.unchanged += r.unchanged;
    out.unreadable += r.unreadable;
    out.skippedEnvAuthored += r.skippedEnvAuthored;
    out.skippedForeign += r.skippedForeign;
  }

  if (organizationId) {
    warnOrganizationLessRows(
      options.logger,
      'sys_permission_set',
      residue,
      organizationId,
      options.platformBucketNames ?? SHIPPED_PLATFORM_BUCKET_NAMES,
    );
  }
  // Before the counts, so an operator reads WHY the count is zero beside it.
  reportSeedWriteRefusals(options.logger, refusals, organizationId);
  if (out.unreadable > 0) {
    // Said once, with the count: these sets were neither seeded nor reconciled
    // because the record could not be READ. Silence here would read exactly
    // like "everything was already in order".
    options.logger?.warn?.(
      '[security] declared permission sets left untouched — their records could not be read',
      { unreadable: out.unreadable, total: sets.length, ...(organizationId ? { organization: organizationId } : {}) },
    );
  }

  options.logger?.info?.('[security] declared permission sets seeded into sys_permission_set (ADR-0086 D5)', {
    ...out, total: sets.length, ...(organizationId ? { organization: organizationId } : {}),
  });
  return out;
}
