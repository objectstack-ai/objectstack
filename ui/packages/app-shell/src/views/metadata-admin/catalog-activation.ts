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
 */

import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';
import { envelopeData, envelopeRefused } from '../setup/packagedFlows.js';
import { ledgerPageTruncated, readDataRecords } from '../setup/packagedActions.js';
import { SETUP_CATALOG_TYPES } from './catalog-scope.js';

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

/**
 * The activation state of `type`'s items, from `sys_metadata_activation`. An
 * empty map for a type without a switch, and no request. A refused read, or a
 * page the server reports as truncated (a missing row reads as ACTIVE, so a
 * partial page would show a switched-off item as on), rejects: the caller
 * shows the state as unknown, never as "active".
 */
export async function readCatalogActivation(type: string, signal?: AbortSignal): Promise<CatalogActivation> {
  if (!hasCatalogActivation(type)) return new Map();
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
  return readCatalogActivationRows(readDataRecords(json), type);
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
 */
export async function writeCatalogActivation(type: string, name: string, enabled: boolean): Promise<boolean> {
  if (!hasCatalogActivation(type)) throw new Error(`No activation for metadata type '${type}'`);
  const res = await fetch(
    `${apiBase()}/security/_activation/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
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
  if (!res.ok || envelopeRefused(json)) throw new Error(actionErrorDetail(json, `HTTP ${res.status}`));
  const reported = envelopeData(json).enabled;
  return typeof reported === 'boolean' ? reported : enabled;
}
