// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredPositions — seed stack-declared `positions` into `sys_position`
 * (ADR-0057 D6, closes #2077).
 *
 * Reads the declared `position` metadata through the security catalog read
 * (`createSecurityCatalogReader`, `@objectstack/core` — the engine registry and
 * the metadata service, in its one read order; see {@link readDeclaredPositions})
 * and idempotently upserts each into
 * `sys_position` by `(name, organization_id)`, so the runtime position→permission-set resolution
 * (`resolveExecutionContext` → `sys_position` → `sys_position_permission_set`) and
 * sharing-rule position recipients stop being decorative. Runs on `kernel:ready`
 * alongside the platform-admin bootstrap.
 *
 * Pre-launch posture (ADR-0057): upsert only — no prune. Position visibility
 * HIERARCHY is NOT seeded here: per ADR-0057 D5 the position is a capability
 * bundle, and "manager sees subordinates" lives on the `sys_business_unit`
 * tree, not `sys_position.parent`.
 *
 * [#10103] ONE PASS PER ORGANIZATION under a walled posture: the object spells
 * its name index `unique: 'organization'`, and a row belonging to no
 * organization is invalid state there — it was measured unreadable by every
 * principal, because Layer 0's strict `organization_id = :tenant` AND-composes
 * over the driver's compatibility arm and leaves the strict equality alone.
 * `single` posture keeps exactly one organization-less pass. Doctrine, and the
 * loud guard that stands in place of a reap: `per-organization-catalog.ts`.
 *
 * [#22360] PROVENANCE: the row of a position a code package holds is stamped
 * `managed_by: 'package'` — on insert, and on an existing row that lacks a
 * managed value — so the system-row write gate refuses an admin-door edit of
 * its definition, or a delete of it, as the metadata door already refuses one
 * (ADR-0131 D6). Its row state (`active`, `is_default`) stays switchable, as a
 * packaged permission set's does — carve-out (d) of the gate in
 * `security-plugin.ts`. See {@link packageProvenanceStamp}.
 */

import { createSecurityCatalogReader } from '@objectstack/core';
import { buildExistingByName } from './seed-name-lookup.js';
import { isBuiltinPositionName } from './builtin-positions.js';
import {
  createSeedWriteRefusals,
  seedCtx,
  warnOrganizationLessRows,
  reportSeedWriteRefusals,
  type SeedLogger,
  type SeedWriteRefusals,
} from './per-organization-catalog.js';

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

// ⛔ The `catch` RECORDS before it answers. Answering `null`/`false` alone is
// what made a refused INSERT indistinguishable from "nothing to do": `seeded`
// never increments, the pass returns normally, and the boot logs a successful
// seed of zero rows. The refusal log is what carries the signal past this
// frame — see `reportSeedWriteRefusals`. Still no rethrow: the pass reports and
// continues, it does not decide whether the deployment boots.
async function tryInsert(
  ql: any, object: string, data: any, organizationId?: string, refusals?: SeedWriteRefusals,
): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: seedCtx(organizationId) });
  } catch (e) { refusals?.record(object, e); return null; }
}
async function tryUpdate(
  ql: any, object: string, data: any, organizationId?: string, refusals?: SeedWriteRefusals,
): Promise<boolean> {
  try {
    await ql.update(object, data, { context: seedCtx(organizationId) }); return true;
  } catch (e) { refusals?.record(object, e); return false; }
}

interface SeedOptions {
  logger?: {
    info: (m: string, meta?: Record<string, any>) => void;
    warn: (m: string, meta?: Record<string, any>) => void;
    /**
     * Durability channel for a catalog write that was refused — see
     * {@link SeedLogger.error} for the signature and why it is optional.
     * Declared here so the level this seeder reaches for is visible in its
     * own options rather than only inside the reporter; absent, the report
     * falls back to `warn` and is never dropped.
     */
    error?: SeedLogger['error'];
  };
  /**
   * Seed THIS organization's copies. Omitted = the `single`-posture pass, the
   * one place an organization-less catalog row is the correct shape.
   */
  organizationId?: string;
}

/** A declared position this seeder owns: any name but the six built-ins. */
function isSeededHere(item: { name?: unknown } | undefined): boolean {
  return !isBuiltinPositionName(item?.name);
}

/**
 * The positions this seeder projects into rows: every position the security
 * catalog read lists, minus the six built-ins (ADR-0131 C2 stage S2b).
 *
 * ## One read, both sources (ADR-0131 D3)
 *
 * The catalog read (`createSecurityCatalogReader`, `@objectstack/core`) is the
 * union of the engine registry and the metadata service, in its one read
 * order: a name the registry serves is answered by the registry's own by-name
 * precedence (a stored definition in the bare slot first, else the
 * first-registered package's), and the metadata service answers only the names
 * the registry does not serve. Neither source holds the whole catalog — the
 * stack-declared positions live in the metadata service, a definition a
 * metadata author saved through the door is hydrated into the registry — so
 * this seeder reads both, every pass.
 *
 * It replaces an either-or: the registry alone whenever it held any position
 * besides the six, else the metadata service. One door-authored position was
 * then enough to make the registry answer alone, and every organization
 * created afterwards was seeded with that position and none of the stack's.
 * For a name both sources hold, the answer is unchanged: the either-or took
 * the registry's body for it, and so does the catalog read.
 *
 * ## Why the six are taken out
 *
 * Their rows are `bootstrapBuiltinRoles`'s, seeded from the declaration list
 * (`builtin-positions.ts`) with the `platform` provenance this seeder never
 * writes. The catalog read lists them — the plugin registers them with the
 * engine registry on every boot — so taking them here would put a copy without
 * that provenance ahead of the built-in pass on a fresh organization (refused
 * outright for a reserved identity name), which the built-in pass then
 * restamps: a second writer for six rows that have one. The exclusion is by
 * NAME, never by package: an environment-stored definition saved under a
 * built-in name before the six were declared is hydrated into the registry's
 * bare slot with no package of this plugin's, and shadows the declaration at
 * read. It is skipped here like the declaration it shadows, so its body never
 * reaches a row.
 *
 * ## A read that did not happen is not "nothing declared"
 *
 * The catalog read refuses to be built over a source that lacks a member it
 * calls (`TypeError`) and raises `AuthzStoreUnavailableError` for a source that
 * threw or a metadata list that lost a loader. Both propagate: this seeder
 * writes nothing for the pass rather than seeding a partial catalog as a whole
 * one, and the caller reports the failure.
 *
 * [#8378] No `{ name, content }` unwrap: the catalog entry's `definition` IS the
 * authoring document — see `bootstrap-declared-permissions.ts`. It is the
 * reader's own object, shared with every other reader, and is only read here.
 *
 * [#22360] Each definition comes back with whether a code package holds its
 * name ({@link packageHoldsName}), asked here, before the pass writes
 * anything, so a registry that cannot answer fails the pass the way an
 * unreadable catalog does instead of failing it half-way through.
 */
async function readDeclaredPositions(
  engine: any,
  metadataService: any,
): Promise<Array<{ definition: any; packageHeld: boolean }>> {
  const catalog = createSecurityCatalogReader({ registry: engine?.registry, metadata: metadataService });
  const listed = await catalog.list('position');
  return listed.filter(isSeededHere).map((entry) => ({
    definition: entry.definition,
    packageHeld: packageHoldsName(engine?.registry, entry),
  }));
}

/**
 * The columns a re-seed writes. Position IDENTITY + display only: the record
 * side (bindings, `active`, `is_default`, `delegatable`) belongs to the
 * runtime and is never projected from the declaration (#2909 T2).
 *
 * `managed_by` is not projected either — a position declaration has no such
 * key. It is written separately, by {@link packageProvenanceStamp}, and only
 * to record WHO holds the name.
 */
function positionRowFields(r: any): { label: any; description: any } {
  return { label: r.label ?? r.name, description: r.description ?? null };
}

/**
 * The provenance value this seeder stamps on the row of a position a package
 * holds — the value the permission-set and capability seeders stamp on their
 * declared rows, and one the system-row write gate refuses an admin-door
 * update or delete of (`SYSTEM_ROW_PROVENANCE`, security-plugin.ts).
 */
const PACKAGE_PROVENANCE = 'package';

/**
 * The `managed_by` values the system-row write gate already treats as managed
 * on `sys_position` — `SYSTEM_ROW_PROVENANCE` in security-plugin.ts, canonical
 * and legacy spellings both. Keep the two in lockstep (see the same note in
 * `normalize-managed-by.ts`). A row carrying one of these is never re-stamped:
 * `platform`/`system` are the built-in seeder's, and a legacy `config` row is
 * already guarded and is healed to `package` by the boot normalizer.
 */
const GATE_MANAGED_VALUES: ReadonlySet<string> = new Set(['platform', 'package', 'system', 'config']);

/**
 * Does a code package hold this position name?
 *
 * Asked of the engine registry's artifact lookup (`getArtifactItem`), which
 * answers only an item a code package registered — an environment definition
 * saved through the metadata door carries no package there. It is the same
 * lookup the metadata door refuses a save of the name from (`403
 * NOT_OVERRIDABLE`), so the data door now refuses what the metadata door
 * refuses, and no more: a position the environment authored keeps an
 * unmanaged row, editable as before.
 *
 * A registry without that lookup is asked the way the metadata door asks one
 * (`lookupArtifactItem`, metadata-protocol): the definition must name a
 * package, and not the `sys_metadata` rehydration sentinel.
 */
function packageHoldsName(registry: any, entry: { name: string; packageId?: string }): boolean {
  if (typeof registry?.getArtifactItem === 'function') {
    return registry.getArtifactItem('position', entry.name) !== undefined;
  }
  return typeof entry.packageId === 'string' && entry.packageId !== '' && entry.packageId !== 'sys_metadata';
}

/**
 * [#22360] The provenance a pass writes on a declared position's row: the
 * `package` stamp when a package holds the name and the row does not already
 * carry a managed value, nothing otherwise.
 *
 * ## Why the row needs it
 *
 * Before this, a declared position's row carried the object default
 * (`admin`), so the system-row write gate did not protect it: a data-door edit
 * of its label answered `200`, and the next boot wrote the declaration's label
 * back over it with no message. The metadata door refused the same edit
 * (`403 NOT_OVERRIDABLE`). ADR-0131 D6: no door edits a managed definition;
 * D3: managed items are read-only and clonable. With the stamp, the data door
 * refuses a definition edit or a delete through the gate that already protects
 * the six built-ins; a row-state-only patch passes its carve-out (d).
 *
 * ## Why this is not a #2909 T2 projection
 *
 * T2 locks that a re-seed never writes the record-authoritative columns from
 * the declaration (bindings, `delegatable`, `active`, `is_default`). The stamp
 * is not declaration content — a position declaration has no `managed_by` —
 * and it overwrites no admin edit: `managed_by` is `readonly`, and the gate
 * refuses an admin-door payload naming `platform`/`package`, so the `admin`
 * on a declared row was only ever the object default. It records which door
 * owns the name, the fact the metadata door already reads.
 *
 * ## The existing row of an upgraded deployment
 *
 * A declared row written before this carries `admin`. The pass corrects the
 * stamp in place — `managed_by` and nothing else beyond the label and
 * description refresh it always made — so a definition edit is refused there
 * too, and the columns an administrator set before the upgrade stay as they
 * are.
 * ⚠️ That row is matched by NAME, as the label refresh always matched it: a
 * Setup-created position whose name a package declares later is taken over by
 * the package here, and from then on its definition is refused at the data
 * door like any other package position's.
 */
function packageProvenanceStamp(packageHeld: boolean, existing?: any): { managed_by?: string } {
  if (!packageHeld) return {};
  if (existing && GATE_MANAGED_VALUES.has(String(existing.managed_by ?? ''))) return {};
  return { managed_by: PACKAGE_PROVENANCE };
}

/** True when the stored row differs from what a re-seed would write (#10946). */
function positionRecordDiffers(row: any, fields: { label: any; description: any }): boolean {
  return (row?.label ?? null) !== (fields.label ?? null)
    || (row?.description ?? null) !== (fields.description ?? null);
}

export async function bootstrapDeclaredPositions(
  ql: any,
  metadataService: any,
  options: SeedOptions = {},
): Promise<{ seeded: number; updated: number; unchanged: number; unreadable: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0, unchanged: 0, unreadable: 0 };
  }
  const declared = await readDeclaredPositions(ql, metadataService);
  if (declared.length === 0) return { seeded: 0, updated: 0, unchanged: 0, unreadable: 0 };
  const positions = declared.map((d) => d.definition);
  const packageHeld = new Map(declared.map((d) => [String(d.definition?.name), d.packageHeld]));

  // [#10946] ONE existence read for the whole declaration, before the loop.
  // See `seed-name-lookup.ts` for why a read that cannot ANSWER must never be
  // read as "none of them exist" — that conflation would re-create every
  // position on every boot.
  const organizationId = options.organizationId;
  const existingByName = await buildExistingByName(
    ql,
    'sys_position',
    positions.map((r) => r?.name),
    options.logger,
    organizationId,
  );
  // Names for which a PRE-FIX organization-less row is still standing. This
  // organization's own row is created regardless — the leftover is reported,
  // never treated as "already seeded" (#10103).
  const residue: string[] = [];

  let seeded = 0;
  let updated = 0;
  let unchanged = 0;
  let unreadable = 0;
  // [#22360] Existing rows whose provenance this pass corrected to `package` —
  // counted inside `updated` as well, and named in the pass's info line.
  let restamped = 0;
  // One log per pass, not per refused row: a legacy platform-wide unique index
  // refuses EVERY declared position, and a line each would bury the remedy.
  const refusals = createSeedWriteRefusals();
  for (const r of positions) {
    if (!r?.name) continue;
    const fields = positionRowFields(r);
    // ⛔ Three outcomes, not two (#10946 / #3807): a read that FAILED is not
    // "no such position". Inserting on it would re-create every position on
    // every boot the database is briefly unreachable.
    const lookup = await existingByName.get(String(r.name));
    if (lookup.status === 'unknown') { unreadable += 1; continue; }
    // [#10103] `absent` can still carry a PRE-FIX organization-less row that is
    // merely VISIBLE here through the driver's compatibility arm. It is not
    // this organization's row, so the copy below is created either way — the
    // leftover is only reported. Reading it as "already seeded" is the silent
    // no-op the per-organization catalog exists to prevent.
    if (lookup.status === 'absent' && lookup.organizationLessResidue) residue.push(String(r.name));
    const existing = lookup.status === 'present' ? lookup.row : undefined;
    const heldByPackage = packageHeld.get(String(r.name)) === true;
    if (existing?.id) {
      // [#10946] Only write when the stored row actually differs. An
      // unconditional UPDATE here cost two remote round trips per position on
      // every boot to store the values already there.
      //
      // ⚠️ EQUALITY decides, not presence: a position whose stored label or
      // description drifted from the declaration still gets its UPDATE. Only
      // the display fields are compared because only the display fields are
      // written — the record-authoritative columns (`active`, `is_default`,
      // `delegatable`) are deliberately never touched by a re-seed (#2909 T2),
      // so they can neither cause nor suppress one.
      //
      // [#22360] The one other column a pass writes is the provenance stamp,
      // and only where it is missing (`packageProvenanceStamp`): an upgraded
      // deployment's declared row, stamped `admin` by the object default.
      const display = positionRecordDiffers(existing, fields) ? fields : {};
      const stamp = packageProvenanceStamp(heldByPackage, existing);
      if (Object.keys(display).length === 0 && Object.keys(stamp).length === 0) {
        unchanged += 1;
      } else if (await tryUpdate(ql, 'sys_position', { id: existing.id, ...display, ...stamp }, organizationId, refusals)) {
        updated += 1;
        if (stamp.managed_by) restamped += 1;
      }
    } else {
      const row = {
        id: genId('position'), name: r.name, ...fields, active: true, is_default: false,
        ...packageProvenanceStamp(heldByPackage),
      };
      const created = await tryInsert(ql, 'sys_position', row, organizationId, refusals);
      if (created) {
        seeded += 1;
        // The batched oracle is a snapshot taken before the loop; a name
        // declared twice in one batch must resolve to the row we just made
        // rather than attempting a second insert the unique index refuses.
        existingByName.remember(String(r.name), row);
      }
    }
  }
  if (organizationId) {
    // No `platformBucketNames`: nothing mints an organization-less `sys_position`
    // row any more, so every leftover here really is pre-fix residue (#11532).
    warnOrganizationLessRows(options.logger, 'sys_position', residue, organizationId);
  }
  // Before the counts are reported, so an operator reads WHY the count is zero
  // in the same place they read the zero.
  reportSeedWriteRefusals(options.logger, refusals, organizationId);
  if (unreadable > 0) {
    // Said once, with the count — see the sibling warn in
    // `bootstrap-declared-permissions.ts`.
    options.logger?.warn?.(
      '[security] declared positions left untouched — their records could not be read',
      { unreadable, total: positions.length, ...(organizationId ? { organization: organizationId } : {}) },
    );
  }
  options.logger?.info?.('[security] declared positions seeded into sys_position', {
    seeded, updated, unchanged, unreadable, total: positions.length,
    // Present only when a row was corrected, so a routine boot's line is unchanged.
    ...(restamped > 0 ? { restampedPackageProvenance: restamped } : {}),
    ...(organizationId ? { organization: organizationId } : {}),
  });
  return { seeded, updated, unchanged, unreadable };
}
