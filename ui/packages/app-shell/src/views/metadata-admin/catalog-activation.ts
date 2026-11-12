// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ACTIVE switch of a Setup catalog item — a position's, a permission
 * set's or a declared sharing rule's row in the activation ledger, read and
 * written through the ledger's own doors (objectui#7611, objectstack ADR-0131
 * D3; `sharing_rule` since D6 regime C, objectui#12982).
 *
 * ## Where the switch lives
 *
 * ADR-0126 §3, as ADR-0131 D6 amends it, makes disabling one `active` bit of
 * deployment-level state in the tenant-less activation ledger,
 * `sys_metadata_activation` — one row per `(metadata_type, name)`, where
 * `metadata_type` is `permission` or `position`. The authorization resolver
 * reads that ledger and nothing else for these two types
 * (`readDisabledCatalogNames` in `@objectstack/core`): a row whose `active` is
 * `false` (or a driver's `0`) switches the item off, and no row means ACTIVE.
 * A catalog row's own `active` column (`sys_permission_set.active`,
 * `sys_position.active`) no longer decides a grant, so this module reads and
 * writes no catalog row. ⛔ There is no fallback onto that column either: the
 * cutover builds nothing for a state it removes (objectstack#22601 → B).
 *
 * - **The state shown** is the resolver's reading of the same rows, through
 *   the data door's list of `sys_metadata_activation` — the read that object
 *   declares open (`apiMethods: ['get', 'list']`) and that Setup › Packaged
 *   automation already makes for actions. The record and truncation readers
 *   are that page's (`packagedActions.ts`), imported, not copied.
 * - **The write** is the door, `POST /security/_activation/:type/:name` with
 *   `{ enabled }` (objectstack#15204 stage 2c). It writes one ledger row and
 *   nothing else.
 *
 * ## What the door refuses, and how each refusal reaches the page
 *
 * Every refusal is the server's own sentence, read by `actionErrorDetail` and
 * shown as sent — ⛔ never a silent no-op, ⛔ never re-worded here:
 *
 * - `403` — the caller lacks `manage_metadata`, a walled deployment's caller is
 *   not the platform operator, or the switch-off would leave no administrator
 *   who can sign in (the last-admin guard on `admin_full_access`);
 * - `404` — the name has no definition; `503` / `501` — the catalog or the
 *   ledger cannot be read or written here;
 * - `400` — a type without a switch, or an audience anchor. Neither is offered
 *   as a live switch: `capability` has no activation column at all
 *   ({@link hasCatalogActivation}), and the anchors render disabled with their
 *   reason ({@link audienceAnchorsOf}).
 *
 * ## A permission set two packages hold (objectstack#32537, ADR-0150 D4/D5)
 *
 * The ledger keys a permission row by `(metadata_type, package_id, name)`, and
 * the door takes the holder's package as `?package=PKG`. Where the page lists
 * more than one holder of a name, the switch it shows for one holder reads
 * that holder's state ({@link isCatalogHolderActive}, by core's
 * `ledgerRowHolders` rule) and its write names the holder's package
 * ({@link writeCatalogActivation}); a `409` naming the holders rejects with a
 * {@link PermissionSetHolderConflict} for the page to offer as a pick. A name
 * with one holder is read and written by the name, as before.
 */

import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';
import { envelopeData, envelopeRefused } from '../setup/packagedFlows.js';
import { ledgerPageTruncated, readDataRecords } from '../setup/packagedActions.js';
import { SETUP_CATALOG_TYPES } from './catalog-scope.js';
import {
  holderCandidatesOf,
  holderPackageOf,
  ledgerRowHolders,
  packageQuery,
  PermissionSetHolderConflict,
  type PermissionSetHolder,
  type PermissionSetHolding,
} from './permission-set-holder.js';

/**
 * Item name → switched on, for every item of the type the ledger holds a row
 * for. An item with no entry is ACTIVE (the ledger's own contract).
 */
export type CatalogActivation = ReadonlyMap<string, boolean>;

/** How many ledger rows one read asks for; a truncated answer is refused. */
const LEDGER_PAGE_SIZE = 1000;

const JSON_HEADERS = { Accept: 'application/json' } as const;

/** Does Setup offer an active switch for this catalog type at all? */
export function hasCatalogActivation(type: string): boolean {
  return (SETUP_CATALOG_TYPES as readonly string[]).includes(type);
}

/** Is `name` switched on, by the ledger's reading (no row ⇒ active)? */
export function isCatalogItemActive(states: CatalogActivation, name: string): boolean {
  return states.get(name) ?? true;
}

/**
 * The ledger's rows of `type`, read the way the resolver reads them: one row
 * per name, `false` / `0` is off and anything else on. Rows of every other
 * type (flows and actions share the table) are skipped.
 */
export function readCatalogActivationRows(
  records: readonly Record<string, unknown>[],
  type: string,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const row of records) {
    if (row?.metadata_type !== type) continue;
    const name = row?.name;
    if (typeof name !== 'string' || !name) continue;
    out.set(name, !(row.active === false || row.active === 0));
  }
  return out;
}

/** One `permission` row of the ledger, with the holder its `package_id` names. */
export interface PermissionLedgerRow {
  readonly name: string;
  readonly packageId: PermissionSetHolder;
  readonly active: boolean;
}

/**
 * The ledger's `permission` rows, each with its package read as the server
 * reads a stored package (empty and the overlay sentinel are no package).
 */
export function readPermissionLedgerRows(records: readonly Record<string, unknown>[]): PermissionLedgerRow[] {
  const out: PermissionLedgerRow[] = [];
  for (const row of records) {
    if (row?.metadata_type !== 'permission') continue;
    const name = row?.name;
    if (typeof name !== 'string' || !name) continue;
    out.push({ name, packageId: holderPackageOf(row.package_id), active: !(row.active === false || row.active === 0) });
  }
  return out;
}

/** One ledger read of a type: the states by name, and the permission rows by holder. */
export interface CatalogLedgerRead {
  states: CatalogActivation;
  permissionRows: readonly PermissionLedgerRow[];
}

/**
 * Is the held set of `name` switched on? A name the page lists one holder
 * of (or no holder for) is read by the name ({@link isCatalogItemActive}), as
 * before. Under more than one holder, every switched-off row is read as core's
 * `readDisabledCatalogNames` reads it (`ledgerRowHolders`): it switches off the
 * holders it reaches, so a row naming no package can keep every holder off.
 */
export function isCatalogHolderActive(
  ledger: CatalogLedgerRead,
  name: string,
  holding: PermissionSetHolding | undefined,
): boolean {
  if (!holding || holding.holders.length <= 1) return isCatalogItemActive(ledger.states, name);
  return !ledger.permissionRows.some(
    (row) => row.name === name && !row.active && ledgerRowHolders(row.packageId, holding.holders).includes(holding.packageId),
  );
}

/**
 * The activation state of `type`'s items, from `sys_metadata_activation`, and
 * — for `permission` — every row with the holder it names. Empty for a type
 * without a switch, and no request. A refused read, or a page the server
 * reports as truncated (a missing row reads as ACTIVE, so a partial page would
 * show a switched-off item as on), rejects: the caller shows the state as
 * unknown, never as "active".
 */
export async function readCatalogLedger(type: string, signal?: AbortSignal): Promise<CatalogLedgerRead> {
  if (!hasCatalogActivation(type)) return { states: new Map(), permissionRows: [] };
  const res = await fetch(`${apiBase()}/data/sys_metadata_activation?top=${LEDGER_PAGE_SIZE}`, {
    credentials: 'include',
    headers: JSON_HEADERS,
    cache: 'no-store',
    signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || envelopeRefused(json)) throw new Error(actionErrorDetail(json, `HTTP ${res.status}`));
  if (ledgerPageTruncated(json)) {
    throw new Error(`the activation ledger answered more than ${LEDGER_PAGE_SIZE} rows`);
  }
  const records = readDataRecords(json);
  return {
    states: readCatalogActivationRows(records, type),
    permissionRows: type === 'permission' ? readPermissionLedgerRows(records) : [],
  };
}

/** The activation state of `type`'s items by name ({@link readCatalogLedger}'s `states`). */
export async function readCatalogActivation(type: string, signal?: AbortSignal): Promise<CatalogActivation> {
  return (await readCatalogLedger(type, signal)).states;
}

/**
 * The names of `type` the door refuses to switch in either direction: the
 * audience anchors `everyone` and `guest` (ADR-0090 D5/D9), which carry the
 * authenticated and the anonymous baseline of every principal. The list is the
 * spec's own `AUDIENCE_ANCHOR_POSITIONS`, the constant the door itself reads.
 * Imported lazily, as `clientValidation.ts` imports the same module: this file
 * is in the console's eager closure and that module is not.
 */
export async function audienceAnchorsOf(type: string): Promise<ReadonlySet<string>> {
  if (type !== 'position') return new Set();
  const { AUDIENCE_ANCHOR_POSITIONS } = await import('@objectstack/spec/identity');
  return new Set<string>(AUDIENCE_ANCHOR_POSITIONS);
}

/**
 * Switch one item on or off through the door. Resolves to the state the server
 * reports (the requested one when it reports none). A refusal rejects with the
 * server's own sentence; a type without a switch is refused before any request.
 *
 * `packageId` names which package's permission set (`?package=PKG`, the one
 * query the door takes, for `permission` only); omitted, the request is the
 * name alone. A `409` naming the holders rejects with a
 * {@link PermissionSetHolderConflict}; ⛔ no holder is chosen here.
 */
export async function writeCatalogActivation(
  type: string,
  name: string,
  enabled: boolean,
  packageId?: string,
): Promise<boolean> {
  if (!hasCatalogActivation(type)) throw new Error(`No activation for metadata type '${type}'`);
  const query = type === 'permission' ? packageQuery(packageId) : '';
  const res = await fetch(
    `${apiBase()}/security/_activation/${encodeURIComponent(type)}/${encodeURIComponent(name)}${query}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
      // ⛔ Exactly the one key the activation body declares; the door refuses
      // any other by name.
      body: JSON.stringify({ enabled }),
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || envelopeRefused(json)) {
    const message = actionErrorDetail(json, `HTTP ${res.status}`);
    const candidates = res.status === 409 && type === 'permission' ? holderCandidatesOf(json) : null;
    throw candidates ? new PermissionSetHolderConflict(message, candidates) : new Error(message);
  }
  const reported = envelopeData(json).enabled;
  return typeof reported === 'boolean' ? reported : enabled;
}

/**
 * The ledger as it reads once `name` of `holder` was switched to `now`: the
 * by-name state, and — where the page lists more than one holder of the name —
 * that holder's own row (the door writes the row naming the holder's package,
 * ADR-0150 D4). `holder` omitted: the by-name state, as before.
 */
export function ledgerAfterSwitch<L extends CatalogLedgerRead>(
  ledger: L,
  name: string,
  now: boolean,
  holder?: PermissionSetHolder,
): L {
  if (holder === undefined) {
    const states = new Map(ledger.states);
    states.set(name, now);
    return { ...ledger, states };
  }
  const permissionRows = [
    ...ledger.permissionRows.filter((row) => !(row.name === name && row.packageId === holder)),
    { name, packageId: holder, active: now },
  ];
  return { ...ledger, permissionRows };
}
