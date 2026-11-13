// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32983, ruling A1 (record 6841971722); ADR-0150 D7 addendum] A declared
 * position rename carries its HOLDERS — at boot, as the system, in every
 * organization.
 *
 * ## Why
 *
 * ADR-0150 D7 makes a position one slot per name in the environment, and a
 * second package that ships a name another holder holds is refused. So an
 * app may have to rename its positions after go-live (HotCRM renamed all
 * twelve for 18.4.0). A holder is a `sys_user_position` row naming the
 * position by its bare NAME (D8 row R2), so after such an upgrade every
 * installed organization's holders name a position that no longer exists,
 * and silently lose every permission set it grants until an administrator
 * edits each assignment. A position now declares its earlier names in
 * `renamedFrom` (`PositionSchema`, the field `renamedFrom` precedent of epic
 * cloud#3652 D3), and this pass moves the holders.
 *
 * ## What it does
 *
 * At `kernel:bootstrapped` — every code, package and environment position
 * this boot registers is in the catalog — it reads every position's
 * `renamedFrom` from the security catalog and judges each old name. An old
 * name it may carry has each holder row moved to the new name: only the
 * `position` column is written, so the user, organization, business unit,
 * validity window, reason and delegation columns stay as they were. A holder
 * who already holds the new name in the same organization keeps both rows:
 * the row on the old name is left and named, never deleted.
 *
 * Idempotent: once carried, no row names the old name, so the next boot
 * reads nothing to move. A row an administrator already re-pointed by hand is
 * not on the old name either, so it is not touched.
 *
 * ## What it refuses to carry (each named at `warn`, holders left as they are)
 *
 * The ruling's conditions, judged over every position the environment holds
 * — the catalog it serves AND every position of an installed package that is
 * disabled, since a disabled package is still installed and still holds its
 * names (the registry's one-holder rule) although the catalog hides it — as
 * `PositionSchema` and the `positions` collection can only see one package
 * body:
 *
 *  - `claimed-twice` — two positions claim one old name: whose holders they
 *    are is not decidable, so neither carries (condition 3);
 *  - `claimant-disabled` — the one position claiming the old name belongs to a
 *    disabled package: nothing is carried onto a position that is switched
 *    off with its package; the next boot after the package is enabled
 *    carries;
 *  - `still-declared` — the old name is still a position of the same holder:
 *    the name is in use, so nothing was renamed away from it (condition 3;
 *    a cycle is this case, since every name in a cycle is a current one);
 *  - `held-by-other` — the old name is a position another package (enabled
 *    or disabled), or the environment, holds: a package never claims another
 *    holder's people (condition 2);
 *  - `owned-by-other` — the old name is no position now, but the activation
 *    ledger records it under ANOTHER package (or, for a position the
 *    environment authored, under any package): the only stored record of an
 *    old name's owner says it was not this one's (condition 2). A ledger row
 *    naming no package is no evidence either way (it may predate the column);
 *    a row carrying the environment's sentinel (`sys_metadata`) records the
 *    environment as the owner, so a package's claim is refused and an
 *    environment position's is not. With no current holder and no such record, the old name is carried
 *    for its one claimant, whichever package that is: the platform keeps no
 *    other record of who owned a name that is no position now, and a package
 *    may already declare such a name outright (D7, one slot per name);
 *  - `switched-off` — the old name is switched off in the activation ledger
 *    (`readDisabledCatalogNames`, the resolver's own read): its holders hold
 *    nothing today, and the new name is active by default, so moving them
 *    would bring a position an administrator switched off back to life
 *    (condition 1). An administrator decides: switch the new position off
 *    too, or move the holders in Setup.
 *
 * ## What it names and never writes
 *
 * Holders only (ruling A1). Every other stored reference to an old name stays
 * as it is and is listed by table, so an administrator can re-point it in
 * Setup: sharing-rule, queue-member and record-share recipients of type
 * `position`; pending approver slots `position:NAME` in
 * `sys_approval_approver` and in `sys_approval_request.pending_approvers`;
 * pending invitations whose `positions` name it; and activation-ledger rows.
 * A table this composition does not register is skipped; a read that fails
 * is reported as not read, never as "none".
 *
 * ## What it is not
 *
 * Not a downgrade path: a version that drops the rename does not carry the
 * holders back. Not a metadata rewrite: Setup-authored bodies that name an
 * old position are not read. Not run on a hot install: a package installed or
 * upgraded into a running kernel is carried at the next boot. It never fails
 * the boot. A row whose write fails is named and skipped, so the rows after it
 * still move; a read that fails ends that claim only, and the rows it moved
 * are said. The other claims always run.
 *
 * ## Its one limit
 *
 * It judges the positions this boot LOADED. An installed package that did not
 * load at all this boot (a marketplace entry whose rehydrate the engine
 * refused, or whose protocol range this runtime does not meet) holds no name
 * the registry or the ledger can show, so a standing claim on one of its
 * position names is carried. A package that loaded and then failed a later
 * step is loaded, and is judged.
 */

import { catalogEntryAddress, readDisabledCatalogNames, type SecurityCatalogEntry, type SecurityCatalogReader } from '@objectstack/core';
import { isUniqueViolationError, keysetWalk } from '@objectstack/types';
import { POSITION_ASSIGNMENT_OBJECT } from './catalog-reference-report.js';

/** The column of `sys_user_position` naming the position (ADR-0150 D8 row R2: a bare name). */
const POSITION_COLUMN = 'position';
const HOLDER_COLUMN = 'user_id';
const ORGANIZATION_COLUMN = 'organization_id';

/** The activation ledger (ADR-0126 §4), read for an old name's recorded owner. */
const ACTIVATION_LEDGER_OBJECT = 'sys_metadata_activation';

/** The `package_id` the activation door stores for an item the environment authored (`catalogEntryAddress`'s sentinel). */
const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/** How a recorded owner that is the environment is keyed beside package ids (no package id is empty). */
const ENVIRONMENT_OWNER = '';

/** The position-name grammar (`PositionSchema.name`, `SnakeCaseIdentifierSchema`): two characters or more. */
const POSITION_NAME_GRAMMAR = /^[a-z][a-z0-9_]+$/;

/** Infrastructure rows, written and read the way the platform's own boot passes do. */
const SYSTEM_CTX = { isSystem: true } as const;

/** Rows per page of each walk. */
const PAGE_SIZE = 500;

/** Ids printed per list; every count is complete. */
const LOGGED_LIMIT = 20;

/** Why an old name is not carried (module doc). */
export type PositionRenameRefusal = 'claimed-twice' | 'claimant-disabled' | 'still-declared' | 'held-by-other' | 'owned-by-other' | 'switched-off';

/** One position's claim on one old name. */
export interface PositionRenameClaim {
  readonly from: string;
  readonly to: string;
  /** The package that declares the renamed position; `null` for a position the environment authored. */
  readonly packageId: string | null;
  /** The declaring package is installed and disabled. */
  readonly disabled?: boolean;
}

/** An old name moved to its new one. */
export interface CarriedPositionRename extends PositionRenameClaim {
  /** Rows moved, per organization (`''`: a row with no organization). */
  readonly byOrganization: Readonly<Record<string, number>>;
  readonly rows: number;
  /** Rows left on the old name because their holder already holds the new one in that organization. */
  readonly alreadyHolds: ReadonlyArray<{ readonly id: string; readonly organization: string }>;
}

/** An old name not carried, and why (module doc). */
export interface RefusedPositionRename extends PositionRenameClaim {
  readonly reason: PositionRenameRefusal;
  /** Who else is involved: the other claimants, the holder of the name, or the package the ledger records. */
  readonly detail: string;
}

/** The stored references to an old name this pass names and never writes. */
export interface LeftBehindReferences {
  /** The table the references live in. */
  readonly object: string;
  /** What in it names the old position. */
  readonly column: string;
  /** Per old name: rows, and the organizations they belong to where the table has one. */
  readonly byName: Readonly<Record<string, { readonly rows: number; readonly organizations: readonly string[] }>>;
}

/** A claim whose carry did not finish: what it moved stays moved; each row whose write failed is named. */
export interface FailedPositionRename extends PositionRenameClaim {
  /** The read's error, or the first failed row's. */
  readonly error: string;
  readonly rows: number;
  readonly byOrganization: Readonly<Record<string, number>>;
  readonly failedRows: ReadonlyArray<{ readonly id: string; readonly organization: string; readonly error: string }>;
}

export interface PositionRenameCarryReport {
  readonly carried: readonly CarriedPositionRename[];
  readonly refused: readonly RefusedPositionRename[];
  /** Claims whose carry failed; the next boot reads what is left on the old name. */
  readonly failed: readonly FailedPositionRename[];
  readonly leftBehind: readonly LeftBehindReferences[];
  /** Tables that exist here and could not be read: no answer, never "none". */
  readonly notRead: ReadonlyArray<{ readonly object: string; readonly error: string }>;
}

/** The engine slice the pass reads and writes through — ObjectQL satisfies it as it stands. */
export interface PositionRenameCarryEngine {
  find(object: string, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  /**
   * The registry, asked which objects this composition registers, and which
   * positions a disabled package holds (`listItems` with
   * `includeDisabledPackages`; ObjectQL's `SchemaRegistry` answers both).
   */
  readonly registry?: {
    getObject?(name: string): unknown;
    listItems?(type: string, packageId?: string, options?: { includeDisabledPackages?: boolean }): readonly unknown[];
    isPackageDisabled?(packageId?: string): boolean;
  };
}

export interface PositionRenameCarryDeps {
  /** The security catalog every position is read from. */
  readonly catalog: Pick<SecurityCatalogReader, 'list'>;
  /**
   * Which of `names` are switched off in the activation ledger. Defaults to
   * the authorization resolver's own read (`readDisabledCatalogNames`), so
   * this pass and enforcement cannot disagree about deactivation.
   */
  readonly switchedOff?: (names: readonly string[]) => Promise<ReadonlySet<string>>;
}

export interface PositionRenameCarryLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
}

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);

/** Does this composition register `object`? A registry that cannot answer is read as "no". */
function registers(engine: PositionRenameCarryEngine, object: string): boolean {
  try {
    return Boolean(engine.registry?.getObject?.(object));
  } catch {
    return false;
  }
}

/** Does registered `object` declare `field`? */
function declares(engine: PositionRenameCarryEngine, object: string, field: string): boolean {
  try {
    const def = engine.registry?.getObject?.(object) as { fields?: Record<string, unknown> } | undefined;
    return Boolean(def?.fields && Object.prototype.hasOwnProperty.call(def.fields, field));
  } catch {
    return false;
  }
}

/** The rows of `object` matching `where`, one keyset page at a time, as the system. */
function pagesOf(engine: PositionRenameCarryEngine, object: string, where: Row, fields: string[]): AsyncIterable<Row[]> {
  return keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(object, { ...query, fields, context: SYSTEM_CTX });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where, pageSize: PAGE_SIZE },
  ).pages();
}

/** Every row of `object` matching `where`, as the system. */
async function readAll(engine: PositionRenameCarryEngine, object: string, where: Row, fields: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for await (const page of pagesOf(engine, object, where, fields)) out.push(...page);
  return out;
}

/** The package an entry is held by, the environment's sentinel read as no package (`catalogEntryAddress`). */
const holderOf = (e: { name: string; packageId?: string }): string | null => catalogEntryAddress(e).packageId;

/**
 * Every position a DISABLED package holds. The catalog hides them (a disabled
 * package serves nothing), but the package is still installed and still holds
 * its names, so a rename may neither take those names nor count without them.
 */
function disabledPackagePositions(engine: PositionRenameCarryEngine): SecurityCatalogEntry[] {
  const registry = engine.registry;
  if (typeof registry?.listItems !== 'function' || typeof registry.isPackageDisabled !== 'function') return [];
  const out: SecurityCatalogEntry[] = [];
  for (const item of registry.listItems('position', undefined, { includeDisabledPackages: true }) ?? []) {
    if (typeof item !== 'object' || item === null) continue;
    const def = item as Record<string, unknown>;
    const owner = typeof def._packageId === 'string' && def._packageId !== '' ? def._packageId : undefined;
    if (owner === undefined || typeof def.name !== 'string' || !registry.isPackageDisabled(owner)) continue;
    out.push({ type: 'position', name: def.name, definition: def, source: 'registry', packageId: owner } as SecurityCatalogEntry);
  }
  return out;
}

/** The old names a position's `renamedFrom` claims, each once, grammar-valid and not its own name. */
function claimedNamesOf(entry: SecurityCatalogEntry): string[] {
  const list = (entry.definition as { renamedFrom?: unknown }).renamedFrom;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const old of list) {
    if (typeof old !== 'string' || !POSITION_NAME_GRAMMAR.test(old) || old === entry.name || out.includes(old)) continue;
    out.push(old);
  }
  return out;
}

const holderLabel = (packageId: string | null | undefined, disabled?: boolean): string =>
  packageId ? `package "${packageId}"${disabled ? ' (disabled)' : ''}` : 'the environment';

/** What one claim's carry has done so far — kept by the caller, so a failure part-way still says it. */
interface CarryProgress {
  readonly byOrganization: Record<string, number>;
  readonly alreadyHolds: Array<{ id: string; organization: string }>;
  /** Rows whose write failed; the walk goes on past each, so one row never holds back the rows after it. */
  readonly failedRows: Array<{ id: string; organization: string; error: string }>;
  rows: number;
}

/** Move every holder row of `claim.from` to `claim.to` (module doc), recording each move in `progress`. */
async function carryHolders(engine: PositionRenameCarryEngine, claim: PositionRenameClaim, progress: CarryProgress): Promise<void> {
  const fields = ['id', POSITION_COLUMN, HOLDER_COLUMN, ORGANIZATION_COLUMN];
  // Read the whole set first: each write takes its row out of the filter.
  const holders = await readAll(engine, POSITION_ASSIGNMENT_OBJECT, { [POSITION_COLUMN]: claim.from }, fields);
  for (const row of holders) {
    const id = text(row.id);
    // The driver filters; this re-check keeps a loose driver from moving another row.
    if (id === null || row[POSITION_COLUMN] !== claim.from) continue;
    const organization = text(row[ORGANIZATION_COLUMN]) ?? '';
    const user = text(row[HOLDER_COLUMN]);
    if (user !== null) {
      const twin = await engine.find(POSITION_ASSIGNMENT_OBJECT, {
        where: { [HOLDER_COLUMN]: user, [POSITION_COLUMN]: claim.to, [ORGANIZATION_COLUMN]: organization === '' ? null : organization },
        fields: ['id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const twinId = Array.isArray(twin) && twin.length > 0 ? text((twin[0] as Row).id) : null;
      // The row itself, already on the new name: a replica booting beside this
      // one moved it after the read above. Nothing to move, nothing to name.
      if (twinId === id) continue;
      if (twinId !== null) {
        progress.alreadyHolds.push({ id, organization });
        continue;
      }
    }
    try {
      // Spelled as a literal (`POSITION_ASSIGNMENT_OBJECT`), so the tenant-audit census reads the object this writes.
      await engine.update('sys_user_position', { id, [POSITION_COLUMN]: claim.to }, { context: SYSTEM_CTX });
    } catch (e: unknown) {
      // The unique key (user, position, organization) answered for a twin the
      // read above did not see: the same case, reported the same way.
      if (!isUniqueViolationError(e)) {
        progress.failedRows.push({ id, organization, error: e instanceof Error ? e.message : String(e) });
        continue;
      }
      progress.alreadyHolds.push({ id, organization });
      continue;
    }
    progress.byOrganization[organization] = (progress.byOrganization[organization] ?? 0) + 1;
    progress.rows += 1;
  }
}

/** One table of stored references this pass names (module doc). */
interface ReferenceSource {
  readonly object: string;
  readonly column: string;
  /** The rows to read, for these old names. */
  where(olds: readonly string[]): Row;
  /** The old names one row names. */
  names(row: Row, olds: ReadonlySet<string>): string[];
}

const recipientSource = (object: string): ReferenceSource => ({
  object,
  column: 'recipient_id (recipient_type position)',
  where: (olds) => ({ recipient_type: 'position', recipient_id: { $in: [...olds] } }),
  names: (row, olds) => (typeof row.recipient_id === 'string' && olds.has(row.recipient_id) ? [row.recipient_id] : []),
});

/** `position:NAME` → NAME, for the approval slot spelling. */
const slotName = (slot: string): string | null => (slot.startsWith('position:') ? slot.slice('position:'.length) : null);

const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  recipientSource('sys_sharing_rule'),
  recipientSource('sys_queue_member'),
  recipientSource('sys_record_share'),
  {
    object: 'sys_approval_approver',
    column: 'approver (position:NAME)',
    where: (olds) => ({ approver: { $in: [...olds].map((o) => `position:${o}`) } }),
    names: (row, olds) => {
      const n = typeof row.approver === 'string' ? slotName(row.approver) : null;
      return n !== null && olds.has(n) ? [n] : [];
    },
  },
  {
    object: 'sys_approval_request',
    column: 'pending_approvers (position:NAME)',
    where: () => ({ status: 'pending' }),
    names: (row, olds) =>
      typeof row.pending_approvers === 'string'
        ? row.pending_approvers.split(',').map((s) => slotName(s.trim())).filter((n): n is string => n !== null && olds.has(n))
        : [],
  },
  {
    object: 'sys_invitation',
    column: 'positions (pending invitations)',
    where: () => ({ status: 'pending' }),
    names: (row, olds) => {
      let list: unknown = row.positions;
      if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch { list = []; }
      }
      return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string' && olds.has(n)) : [];
    },
  },
  {
    object: ACTIVATION_LEDGER_OBJECT,
    column: 'name (metadata_type position)',
    where: (olds) => ({ metadata_type: 'position', name: { $in: [...olds] } }),
    names: (row, olds) => (typeof row.name === 'string' && olds.has(row.name) ? [row.name] : []),
  },
];

/** The fields to read from `source`: the ones it filters and names on, plus the organization where there is one. */
function fieldsOf(engine: PositionRenameCarryEngine, source: ReferenceSource): string[] {
  const named: Record<string, string[]> = {
    sys_approval_approver: ['approver'],
    sys_approval_request: ['pending_approvers'],
    sys_invitation: ['positions'],
    [ACTIVATION_LEDGER_OBJECT]: ['name'],
  };
  return ['id', ...(named[source.object] ?? ['recipient_id']), ...(declares(engine, source.object, ORGANIZATION_COLUMN) ? [ORGANIZATION_COLUMN] : [])];
}

/** The stored references to `olds` beside the holders, by table (module doc). Never writes. */
async function readLeftBehind(
  engine: PositionRenameCarryEngine,
  olds: ReadonlySet<string>,
  notRead: Array<{ object: string; error: string }>,
): Promise<LeftBehindReferences[]> {
  const out: LeftBehindReferences[] = [];
  for (const source of REFERENCE_SOURCES) {
    if (!registers(engine, source.object)) continue;
    // Counted a page at a time: a table read in full (pending requests and
    // invitations are filtered by status only) is never held in memory.
    const byName: Record<string, { rows: number; organizations: string[] }> = {};
    try {
      for await (const page of pagesOf(engine, source.object, source.where([...olds]), fieldsOf(engine, source))) {
        for (const row of page) {
          for (const name of source.names(row, olds)) {
            const at = (byName[name] ??= { rows: 0, organizations: [] });
            at.rows += 1;
            const org = text(row[ORGANIZATION_COLUMN]);
            if (org !== null && !at.organizations.includes(org)) at.organizations.push(org);
          }
        }
      }
    } catch (e: unknown) {
      notRead.push({ object: source.object, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (Object.keys(byName).length > 0) out.push({ object: source.object, column: source.column, byName });
  }
  return out;
}

/**
 * Judge every declared position rename and carry the holders of each old
 * name the rules allow (module doc). Reads nothing when no position declares
 * `renamedFrom`.
 */
export async function carryRenamedPositionHolders(
  engine: PositionRenameCarryEngine,
  deps: PositionRenameCarryDeps,
): Promise<PositionRenameCarryReport> {
  const served = await deps.catalog.list('position');
  // [condition 2] A disabled package still holds its names: judge them too.
  const servedNames = new Set(served.map((e) => e.name));
  const disabled = disabledPackagePositions(engine).filter((e) => !servedNames.has(e.name));
  const current = new Map<string, { entry: SecurityCatalogEntry; disabled: boolean }>();
  for (const e of served) current.set(e.name, { entry: e, disabled: false });
  for (const e of disabled) current.set(e.name, { entry: e, disabled: true });
  const claimsByOld = new Map<string, PositionRenameClaim[]>();
  for (const { entry: e, disabled: off } of current.values()) {
    for (const from of claimedNamesOf(e)) {
      const list = claimsByOld.get(from) ?? [];
      list.push({ from, to: e.name, packageId: holderOf(e), ...(off ? { disabled: true } : {}) });
      claimsByOld.set(from, list);
    }
  }
  const carried: CarriedPositionRename[] = [];
  const refused: RefusedPositionRename[] = [];
  const failed: FailedPositionRename[] = [];
  const notRead: Array<{ object: string; error: string }> = [];
  if (claimsByOld.size === 0) return { carried, refused, failed, leftBehind: [], notRead };

  const olds = [...claimsByOld.keys()];
  const switchedOff = deps.switchedOff
    ? await deps.switchedOff(olds)
    : (await readDisabledCatalogNames(engine, olds, [])).positions;
  // [condition 2] The only stored record of who owned a name that is no position
  // now: the activation ledger's `package_id` (ADR-0150 D8 row R4).
  const recordedOwners = new Map<string, Set<string>>();
  if (registers(engine, ACTIVATION_LEDGER_OBJECT)) {
    const rows = await readAll(engine, ACTIVATION_LEDGER_OBJECT, { metadata_type: 'position', name: { $in: olds } }, ['id', 'name', 'package_id']);
    for (const row of rows) {
      const name = text(row.name);
      const raw = text(row.package_id);
      // A row naming no package is no evidence (it may predate the column). A
      // row carrying the environment's sentinel is: the environment authored
      // the old name, so no package may claim it.
      const pkg = raw === null ? null : raw === OVERLAY_PROVENANCE_SENTINEL ? ENVIRONMENT_OWNER : raw;
      if (name === null || pkg === null) continue;
      const at = recordedOwners.get(name) ?? new Set<string>();
      at.add(pkg);
      recordedOwners.set(name, at);
    }
  }

  // The old names a carry ran for: the only ones whose other references are left behind by it.
  const carriedOlds = new Set<string>();
  for (const [from, claims] of claimsByOld) {
    if (claims.length > 1) {
      for (const c of claims) {
        refused.push({
          ...c,
          reason: 'claimed-twice',
          detail: `claimed by ${claims.map((o) => `'${o.to}' (${holderLabel(o.packageId, o.disabled)})`).join(' and ')}`,
        });
      }
      continue;
    }
    const [claim] = claims;
    const holder = current.get(from);
    if (holder) {
      const holderPackage = holderOf(holder.entry);
      refused.push({
        ...claim,
        reason: holderPackage === claim.packageId ? 'still-declared' : 'held-by-other',
        detail: `'${from}' is a position ${holderLabel(holderPackage, holder.disabled)} declares`,
      });
      continue;
    }
    if (claim.disabled) {
      refused.push({ ...claim, reason: 'claimant-disabled', detail: `${holderLabel(claim.packageId)} is disabled` });
      continue;
    }
    const others = [...(recordedOwners.get(from) ?? [])].filter((pkg) => pkg !== (claim.packageId ?? ENVIRONMENT_OWNER));
    if (others.length > 0) {
      refused.push({ ...claim, reason: 'owned-by-other', detail: `the activation ledger records '${from}' under ${others.map((p) => (p === ENVIRONMENT_OWNER ? 'the environment' : `package "${p}"`)).join(', ')}` });
      continue;
    }
    if (switchedOff.has(from)) {
      refused.push({ ...claim, reason: 'switched-off', detail: `'${from}' is switched off in the activation ledger` });
      continue;
    }
    if (!registers(engine, POSITION_ASSIGNMENT_OBJECT)) continue;
    carriedOlds.add(from);
    const progress: CarryProgress = { byOrganization: {}, alreadyHolds: [], failedRows: [], rows: 0 };
    try {
      await carryHolders(engine, claim, progress);
    } catch (e: unknown) {
      // A read that fails ends this claim only: the other claims still run.
      failed.push({ ...claim, error: e instanceof Error ? e.message : String(e), rows: progress.rows, byOrganization: progress.byOrganization, failedRows: progress.failedRows });
      continue;
    }
    if (progress.failedRows.length > 0) {
      failed.push({ ...claim, error: progress.failedRows[0].error, rows: progress.rows, byOrganization: progress.byOrganization, failedRows: progress.failedRows });
    } else {
      carried.push({ ...claim, byOrganization: progress.byOrganization, rows: progress.rows, alreadyHolds: progress.alreadyHolds });
    }
  }
  const leftBehind = carriedOlds.size > 0 ? await readLeftBehind(engine, carriedOlds, notRead) : [];
  return { carried, refused, failed, leftBehind, notRead };
}

const listIds = (ids: readonly string[]): string =>
  ids.slice(0, LOGGED_LIMIT).join(', ') + (ids.length > LOGGED_LIMIT ? ` and ${ids.length - LOGGED_LIMIT} more` : '');

const REFUSAL_SENTENCE: Record<PositionRenameRefusal, string> = {
  'claimed-twice': 'two positions claim it, so whose holders they are is not decidable',
  'claimant-disabled': 'the renamed position\'s package is disabled; the first boot after it is enabled carries them',
  'still-declared': 'it is still a position of the same holder, so nothing was renamed away from it',
  'held-by-other': 'it is a position another holder declares, and a package never claims another holder\'s people',
  'owned-by-other': 'it was another package\'s position, and a package never claims another holder\'s people',
  'switched-off': 'it is switched off, and its holders would come back active under the new name; switch the new position off too, or move them in Setup',
};

/** What a run says: moves at `info`, every refusal, twin row and left-behind reference at `warn`. */
export function logPositionRenameCarry(report: PositionRenameCarryReport, logger: PositionRenameCarryLogger): void {
  const moved = report.carried.filter((c) => c.rows > 0);
  if (moved.length > 0) {
    logger.info?.(
      '[security] position renames: holders moved to the renamed position, as the system (ADR-0150 D7 addendum) — '
        + moved.map((c) => `'${c.from}' → '${c.to}' (${c.rows} row(s) in ${Object.keys(c.byOrganization).length} organization(s))`).join(', ') + '.',
      { carried: moved },
    );
  }
  for (const c of report.carried) {
    if (c.alreadyHolds.length === 0) continue;
    logger.warn(
      `[security] position rename '${c.from}' → '${c.to}': ${c.alreadyHolds.length} holder row(s) were left on '${c.from}' because the same `
        + `user already holds '${c.to}' in that organization; each grants nothing now. Review them in Setup before removing either row: `
        + `when the row on '${c.to}' is a time-boxed delegation, the old row is the lasting assignment and is the one to re-point: ${listIds(c.alreadyHolds.map((r) => r.id))}.`,
      { alreadyHolds: c.alreadyHolds },
    );
  }
  for (const f of report.failed) {
    logger.warn(
      `[security] position rename '${f.from}' → '${f.to}' (${holderLabel(f.packageId)}) did not finish: ${f.rows} holder row(s) were moved `
        + `(${Object.entries(f.byOrganization).map(([org, n]) => `${org || '(no organization)'}: ${n}`).join(', ') || 'none'})`
        + (f.failedRows.length > 0 ? `, and ${f.failedRows.length} row(s) could not be written (${f.error}): ${listIds(f.failedRows.map((r) => r.id))}` : `, then a read failed (${f.error})`)
        + `; what is left stays on '${f.from}' until the next boot tries again.`,
      { failed: f },
    );
  }
  for (const r of report.refused) {
    logger.warn(
      `[security] position rename '${r.from}' → '${r.to}' (${holderLabel(r.packageId)}) was not carried: ${REFUSAL_SENTENCE[r.reason]} (${r.detail}). `
        + `Holders of '${r.from}' were left as they are.`,
      { refused: r },
    );
  }
  for (const l of report.leftBehind) {
    logger.warn(
      `[security] position renames are carried for holders only: ${l.object}.${l.column} still names an old position — `
        + Object.entries(l.byName).map(([name, at]) => `'${name}' (${at.rows} row(s)${at.organizations.length > 0 ? ` in ${at.organizations.length} organization(s)` : ''})`).join(', ')
        + '. Re-point each in Setup to the renamed position.',
      { object: l.object, byName: l.byName },
    );
  }
  for (const n of report.notRead) {
    logger.warn(`[security] position renames: ${n.object} could not be read, so what in it still names an old position is not known for this boot.`, { error: n.error });
  }
}

/**
 * The boot wiring: run, log, never throw past here — a failure is said once
 * and the next boot tries again.
 */
export async function carryRenamedPositionHoldersAtBoot(
  engine: Partial<PositionRenameCarryEngine> | undefined,
  deps: PositionRenameCarryDeps,
  logger: PositionRenameCarryLogger,
): Promise<PositionRenameCarryReport | undefined> {
  if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') return undefined;
  try {
    const report = await carryRenamedPositionHolders(engine as PositionRenameCarryEngine, deps);
    logPositionRenameCarry(report, logger);
    return report;
  } catch (e: unknown) {
    logger.warn(
      '[security] position renames: the holder carry did not finish — holders still on an old name keep it until the next boot tries again.',
      { error: e instanceof Error ? e.message : String(e) },
    );
    return undefined;
  }
}
