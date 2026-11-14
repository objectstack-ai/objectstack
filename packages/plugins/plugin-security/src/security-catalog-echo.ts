// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The security catalog's echo: an environment-wide `permission` or `position`
 * overlay registered in the kernel's metadata service, so the security
 * catalog (ADR-0131 D3, `createSecurityCatalogReader`) finds it on an
 * ENVIRONMENT kernel.
 *
 * ## Why it exists
 *
 * The catalog reads the engine registry first, then the metadata service. On
 * a host kernel the metadata door hydrates every stored row into the engine
 * registry, so a set or position saved there is found. On an environment
 * kernel it does not: `applyRegistryWriteThrough` returns before the hydrator
 * when the kernel has an `environmentId` (project rows never enter the
 * process-wide registry). The metadata service is then the only place the
 * catalog can find a stored row's body, and nothing in the metadata door puts
 * it there. Until C3 stage 8 the permission-set projector did, as the
 * by-product of projecting a `sys_permission_set` row; stage 8 unwired the
 * projector and the echo went with it, so every metadata-door permission set
 * on an environment kernel resolved to nothing, granted nothing and recorded
 * no `everyone` suggestion. Positions never had an echo at all.
 *
 * This module keeps the echo and nothing else: no row is written, and no
 * authorization decision is made here — the catalog, the resolver and the
 * suggestion collector read what this registers exactly as they read any
 * other metadata-service item.
 *
 * ## The two entry points
 *
 *  - {@link registerSecurityCatalogEcho}: the protocol's AWAITED mutation
 *    projector for both types (ADR-0094), so a save, publish or delete has
 *    been echoed when it returns — before the post-persistence listeners run,
 *    which is where the suggestion reconcile reads the catalog.
 *  - {@link echoStoredSecurityCatalogOverlays}: one pass at `kernel:ready`
 *    over every stored env-wide overlay of both types, because the metadata
 *    service is in memory and a restart starts it empty.
 *
 * ## What an echo carries
 *
 * The overlay body, stripped of layered-read decorations, stamped with
 * {@link ENV_PROJECTION_MARKER} so it never reads as a shipped artifact
 * (`packaged-permission-set-lock.ts` skips marked items). When the item is
 * tenant-authored it also carries:
 *
 *  - `_provenance: 'org'` (#21789). The protocol's layered read serves the
 *    echo as the item's `code` layer, and an unstamped code layer is how a
 *    client reads "a code package ships this". For a permission set the
 *    verdict is the packaged-permission-set lock's, the classifier both write
 *    doors ask, so the reported and the enforced state are one judgment. For
 *    a position it is "no declaration of the name is served": the echo is
 *    only registered when neither the engine registry nor the metadata
 *    service holds one (below), and a stored position row is otherwise
 *    tenant-authored, as a host kernel's hydrator stamps every stored row.
 *  - `_packageId` (#23233): the package the stored row is bound to, as the
 *    protocol's by-name read serves it. The catalog takes an item's owner
 *    from `_packageId` alone, and the suggestion collector skips an unowned
 *    `isDefault: true` set (ADR-0090 D5: packages suggest, admins confirm).
 *    The owner is carried, never derived.
 *
 * ## What is not echoed
 *
 *  - A name the engine registry already serves: every stored row on a host
 *    kernel (its metadata door hydrates them there), and a package's declared
 *    artifact on any kernel. The catalog reads the registry first, so an echo
 *    of those would never be read — and a second copy is what a delete's
 *    registry heal would strand.
 *  - A name the metadata service already holds as something other than our
 *    echo: a STACK-declared position (or set), which `AppPlugin` registers in
 *    the metadata service only, so the registry check cannot see it. An echo
 *    would overwrite that declaration with the stored row, and the overlay's
 *    delete would then remove the declaration until restart.
 *
 * When the overlay is gone our echo is dropped; a package uninstall deletes
 * each of its rows through `deleteMetaItem`, so the same projector drops
 * those. [ADR-0150 D4, #31698] A `permission` echo is kept per `(package,
 * name)`: each echo slot is judged by its OWN stored row, at its own package's
 * address, and dropped once that row is gone or bound elsewhere (a re-bind) —
 * never because another package's row of the name moved. The removal is the
 * service's in-memory one (`unregisterInMemory`), announced so each cluster
 * peer drops the same slot. ⛔ Never `unregister`: it deletes the stored row
 * of the slot first, and an echo is only a copy of a row.
 */

import { readLegacyOrganizationRows } from '@objectstack/metadata-core';
import { seedCtx } from './organization-scope.js';
import {
  ENV_PROJECTION_MARKER,
  classifyPackagedPermissionSet,
} from './packaged-permission-set-lock.js';

/** The security-catalog types whose stored rows this module echoes. */
export const SECURITY_CATALOG_ECHO_TYPES = ['permission', 'position'] as const;
export type SecurityCatalogEchoType = (typeof SECURITY_CATALOG_ECHO_TYPES)[number];

export interface SecurityCatalogEchoLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
}

export interface SecurityCatalogEchoDeps {
  /** The engine: its `registry` holds the declared artifacts; `find` reads `sys_metadata` at boot. */
  ql: any;
  /** The kernel `metadata` service the catalog reads (`registerInMemory`, `get`, `unregisterInMemory`). */
  metadata?: any;
  logger?: SecurityCatalogEchoLogger;
}

/**
 * One item the metadata service holds under `name`: the item, and the package
 * whose slot it fills (`undefined` for the name's bare slot, or for the one
 * item of a type stored by name). `only` marks the one item a read naming no
 * package served: it is the name's only slot, whatever its stamp says.
 */
interface ServedSlot {
  readonly item: any;
  readonly packageId: string | undefined;
  readonly only: boolean;
}

/**
 * The packages a by-name refusal names (ADR-0150 D5, `409 RESOURCE_CONFLICT`):
 * what the metadata service throws for a read naming no package of a name two
 * packages' slots hold. `undefined` for any other error.
 */
function refusedPackageHolders(error: unknown): string[] | undefined {
  const candidates = (error as { refusal?: { candidates?: unknown } } | null)?.refusal?.candidates;
  if ((error as { code?: unknown } | null)?.code !== 'RESOURCE_CONFLICT' || !Array.isArray(candidates)) return undefined;
  const packages = candidates
    .filter((c): c is { kind: 'package'; packageId: string } =>
      !!c && typeof c === 'object' && (c as any).kind === 'package' && typeof (c as any).packageId === 'string')
    .map((c) => c.packageId);
  return packages.length > 0 ? packages : undefined;
}

/** Whether `error` is a package-scoped refusal (ADR-0150 D3/D5): the read named a package that holds nothing of the name. */
const isPackageScopedRefusal = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 'RESOURCE_CONFLICT'
  && !!(error as { refusal?: unknown } | null)?.refusal;

/**
 * [ADR-0150 D3/D4, #32162] Every item the metadata service holds under `name`.
 *
 * `permission` is stored per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`
 * in `@objectstack/metadata`), and our echo carries its owner as `_packageId`,
 * so it fills that package's slot. A read naming no package serves the one
 * item while one slot holds the name; with two it is refused naming each
 * holder, and each holder's slot is then read by its package. `position` is
 * stored by name and answers the bare read alone.
 */
async function servedSlotsOf(metadata: any, type: SecurityCatalogEchoType, name: string): Promise<ServedSlot[]> {
  if (typeof metadata?.get !== 'function') return [];
  let item: any;
  try {
    item = await metadata.get(type, name);
  } catch (error) {
    const holders = refusedPackageHolders(error);
    if (!holders) throw error;
    const slots: ServedSlot[] = [];
    for (const packageId of holders) {
      const held = await metadata.get(type, name, packageId);
      if (held !== undefined && held !== null) slots.push({ item: held, packageId, only: false });
    }
    return slots;
  }
  if (item === undefined || item === null) return [];
  const stamped = item && typeof item === 'object' ? item._packageId : undefined;
  return [{ item, packageId: typeof stamped === 'string' && stamped !== '' ? stamped : undefined, only: true }];
}

/** The metadata services already told they cannot drop an echo, so each is told once. */
const toldCannotDrop = new WeakSet<object>();

/**
 * [ADR-0150 D4, #31698] Remove one echo slot of `name` from the metadata
 * service's MEMORY (`unregisterInMemory`), naming the slot's package — or the
 * name's package-less slot, or, for an unstamped only item of the name, none.
 * Announced, so each cluster peer drops the same slot.
 *
 * ⛔ Never `unregister`: that is the removal of the ITEM, and it deletes the
 * stored row of the slot first. An echo is a copy of a row; removing the copy
 * never removes a row, and a service without the in-memory removal keeps the
 * slot (said once) rather than risk one.
 */
function removeEchoSlot(
  metadata: any,
  type: SecurityCatalogEchoType,
  name: string,
  slot: ServedSlot,
  logger: SecurityCatalogEchoLogger | undefined,
): boolean {
  if (typeof metadata?.unregisterInMemory !== 'function') {
    if (metadata && typeof metadata === 'object' && !toldCannotDrop.has(metadata)) {
      toldCannotDrop.add(metadata);
      logger?.warn(
        `[security] the metadata service has no in-memory removal, so a security-catalog echo whose stored ${type} ` +
          'is gone stays served until restart. Nothing stored is touched; the next boot echoes only the rows that exist.',
        { type, name },
      );
    }
    return false;
  }
  // By the package the slot names; an unstamped slot that is the name's only
  // one, by name (the store may hold it in a package's slot).
  metadata.unregisterInMemory(type, name, slot.packageId !== undefined ? { packageId: slot.packageId } : slot.only ? {} : { packageId: null });
  return true;
}

/** What one echo did. */
export type SecurityCatalogEchoOutcome = 'registered' | 'dropped' | 'skipped';

const isEchoType = (type: unknown): type is SecurityCatalogEchoType =>
  type === 'permission' || type === 'position';

/** Strip layered-read / registry decorations so an echoed body is clean. */
export function stripDecorations(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const { _packageId, _provenance, _diagnostics, _lock, _lockReason, _lockSource, [ENV_PROJECTION_MARKER]: _mark, ...clean } = body;
  return clean;
}

/** True when a layered-read layer or a metadata-service item is our own echo, not a real artifact. */
export const isProjectionEcho = (v: any): boolean =>
  !!(v && typeof v === 'object' && (v as any)[ENV_PROJECTION_MARKER]);

/**
 * The package the stored row a by-name read SERVES for `name` is bound to:
 * the protection envelope's `packageId`, which the protocol's single-item read
 * states from the served document's `_packageId` (that row's `package_id`
 * column). `undefined` when the row is bound to no package, or the protocol
 * has no single-item read. A read that fails is not caught here.
 *
 * [#7557, #24210] The envelope, not `item._packageId`: this is a resolution
 * read, and the by-name read withholds the item of a disabled package while
 * keeping its envelope. Read off the item, a disabled package's set echoed
 * unowned, and stayed unowned after the package was re-enabled.
 *
 * [ADR-0150 D4, #31698] `packageId` reads at that package's address.
 */
export async function readServedPackageBinding(
  protocol: any,
  name: string,
  type: SecurityCatalogEchoType = 'permission',
  packageId?: string,
): Promise<string | undefined> {
  if (typeof protocol?.getMetaItem !== 'function') return undefined;
  const served = await protocol.getMetaItem({ type, name, ...(packageId !== undefined ? { packageId } : {}) });
  const binding = served?.packageId;
  return typeof binding === 'string' && binding !== '' ? binding : undefined;
}

/**
 * [ADR-0150 D4, #31698] The address a mutation names: the package its row is
 * bound to, `null` for the package-unbound row, `undefined` when the event
 * does not say (an emitter that predates the field). Only `permission` is
 * stored per `(package, name)`; a `position` is read by name.
 */
function mutationAddressOf(type: SecurityCatalogEchoType, evt: { packageId?: unknown }): string | null | undefined {
  if (type !== 'permission') return undefined;
  const packageId = evt.packageId;
  if (packageId === null || packageId === '') return null;
  return typeof packageId === 'string' ? packageId : undefined;
}

/**
 * The engine registry serves `name` at `address`, unless what it serves is our
 * own echo (a registry heal can re-register the metadata service's view
 * there). A package's address asks that package's item only.
 */
function registryServesAt(ql: any, type: SecurityCatalogEchoType, name: string, address: string | null | undefined): boolean {
  try {
    const registry = ql?.registry;
    const item = typeof address === 'string' && typeof registry?.getPackageScopedItem === 'function'
      ? registry.getPackageScopedItem(type, name, address)
      : registry?.getItem?.(type, name);
    return !!item && typeof item === 'object' && !isProjectionEcho(item);
  } catch {
    return false;
  }
}

/**
 * Echo the stored row at one address: read its environment-wide overlay
 * through the protocol's layered read (ADR-0131 D6: no organization is part of
 * a metadata read) and register it. Answers the slot it registered, or
 * `undefined` when it registered nothing. Removes nothing: an echo whose row is
 * gone is the stale pass's ({@link dropGoneEchoSlots}).
 */
async function echoRowAt(
  protocol: any,
  deps: SecurityCatalogEchoDeps,
  type: SecurityCatalogEchoType,
  name: string,
  address: string | null | undefined,
): Promise<{ slot: string | null } | undefined> {
  const { ql, metadata, logger } = deps;
  const atPackage = typeof address === 'string' ? address : undefined;
  const layered = await protocol.getMetaItemLayered({ type, name, ...(atPackage !== undefined ? { packageId: atPackage } : {}) });
  // An envelope is told by its layer keys; anything else carries no overlay
  // this module can tell apart from an artifact, so it is not echoed.
  if (!layered || typeof layered !== 'object' || !('effective' in layered || 'overlay' in layered || 'code' in layered)) return undefined;
  const overlay = layered.overlay ?? null;
  if (!overlay?.name) return undefined;

  // The engine registry already serves this name — a host kernel hydrates
  // every stored row there, and a package's artifact is there on every
  // kernel — so the catalog never reaches the metadata service for it. Skip,
  // and leave an echo of ours (registered before the artifact arrived) in
  // place: it is not read. The stale pass drops it once its row is gone.
  if (registryServesAt(ql, type, name, address)) return undefined;

  const slots = await servedSlotsOf(metadata, type, name);

  // No declaration of the name is served. A permission set asks the lock,
  // which also reads the layered read's `code` layer and answers `unknown`
  // when it cannot tell; a stored position is tenant-authored.
  const tenantAuthored = type === 'permission'
    ? classifyPackagedPermissionSet(name, ql, { status: 'read', envelope: layered }).status === 'org'
    : true;
  let ownerPackageId: string | undefined;
  if (tenantAuthored) {
    try {
      ownerPackageId = await readServedPackageBinding(protocol, name, type, atPackage);
    } catch (e) {
      // [#31698] A binding read that failed is not a moved binding: the
      // echo already in this address's slot keeps the package it names, so
      // the re-echo fills that slot again. With none there, it is
      // registered unowned, as before.
      const kept = slots.filter((slot) => isProjectionEcho(slot.item)
        && (atPackage === undefined ? slots.length === 1 : slot.packageId === atPackage));
      ownerPackageId = kept.length === 1 ? kept[0]!.packageId : undefined;
      // Functional, not durability: nothing persisted is lost and nothing
      // grants differently — the echo still resolves and enforces the stored
      // body. What may be missing is said once, with what restores it.
      if (ownerPackageId === undefined) {
        logger?.warn(
          `[security] the package binding of this ${type} could not be read, so its security-catalog echo ` +
            'names no owning package: the catalog serves it as unowned, and an `isDefault: true` permission ' +
            'set records no audience-binding suggestion (ADR-0090 D5), until the name is echoed again — ' +
            'the next save, publish or boot re-reads the binding. Enforcement is unaffected.',
          { type, name, error: String((e as Error)?.message ?? e) },
        );
      }
    }
  }

  // The metadata service holds a declaration of this name — a stack-declared
  // position lives only there. Never echo over it: see the module doc. [#31698]
  // An echo with an owner fills that package's slot alone, so only a
  // declaration there is in its way.
  const inTheWay = type === 'permission' && ownerPackageId !== undefined
    ? slots.filter((slot) => slot.packageId === ownerPackageId)
    : slots;
  if (inTheWay.some((slot) => !isProjectionEcho(slot.item))) return undefined;

  metadata.registerInMemory(type, name, {
    ...stripDecorations(overlay),
    ...(tenantAuthored ? { _provenance: 'org' } : {}),
    ...(ownerPackageId !== undefined ? { _packageId: ownerPackageId } : {}),
    [ENV_PROJECTION_MARKER]: true,
  });
  return { slot: ownerPackageId ?? null };
}

/**
 * Whether the stored row an echo slot copies is still there, at the slot's own
 * address: the layered read at that package (or naming none, for an unowned
 * slot) serves an overlay, and — for a set — the row served is bound to that
 * slot's package. A read refused because the package holds nothing of the name
 * is a row that is gone. Any other failed read is thrown: the caller keeps the
 * slot.
 */
async function echoRowIsServed(protocol: any, type: SecurityCatalogEchoType, name: string, slot: ServedSlot): Promise<boolean> {
  const atPackage = type === 'permission' ? slot.packageId : undefined;
  let layered: any;
  try {
    layered = await protocol.getMetaItemLayered({ type, name, ...(atPackage !== undefined ? { packageId: atPackage } : {}) });
  } catch (error) {
    if (atPackage !== undefined && isPackageScopedRefusal(error)) return false;
    throw error;
  }
  if (!layered?.overlay?.name) return false;
  if (type !== 'permission') return true;
  return (await readServedPackageBinding(protocol, name, type, atPackage)) === atPackage;
}

/**
 * [ADR-0150 D4, #31698] Drop every echo of `name` whose own stored row is gone
 * — deleted, or bound elsewhere now (a namespace rename, a stamp, a re-bind) —
 * each judged at its own address, never by another slot's row. `keep` are the
 * slots this pass just registered. A slot whose row cannot be read is kept,
 * and a declaration that is not our echo is never touched. Removal is from
 * memory only ({@link removeEchoSlot}). Answers how many were dropped.
 */
async function dropGoneEchoSlots(
  protocol: any,
  deps: SecurityCatalogEchoDeps,
  type: SecurityCatalogEchoType,
  name: string,
  keep: ReadonlySet<string | null>,
): Promise<number> {
  const { ql, metadata, logger } = deps;
  let dropped = 0;
  for (const slot of await servedSlotsOf(metadata, type, name)) {
    if (!isProjectionEcho(slot.item) || keep.has(slot.packageId ?? null)) continue;
    let served: boolean;
    try {
      served = await echoRowIsServed(protocol, type, name, slot);
    } catch {
      continue; // unread is not gone: the slot stays until a read answers
    }
    if (!served && removeEchoSlot(metadata, type, name, slot, logger)) dropped += 1;
  }
  if (dropped > 0) {
    // A copy of our echo leaked into the engine registry goes with it.
    try {
      const leaked = ql?.registry?.getItem?.(type, name);
      if (isProjectionEcho(leaked) && typeof ql?.registry?.unregisterItem === 'function') {
        ql.registry.unregisterItem(type, name);
      }
    } catch { /* nothing leaked, or nothing to remove it from */ }
  }
  return dropped;
}

/**
 * Echo one landed mutation. A save, publish or restore registers the row's
 * overlay at the address the event names; then every echo of the name whose
 * own row is gone is dropped (a delete, a re-bind).
 *
 * [ADR-0150 D4, #31698] A set is stored per `(package, name)`: the event names
 * the package of its row (`packageId`), the overlay and its binding are read
 * at that address, and each other echo slot is judged by its own row — a save
 * of one package's set never moves or drops another package's echo of the
 * name. An event naming no package reads the name with no package; refused
 * because two packages hold it, it echoes each holder's row by its package.
 */
export async function echoSecurityCatalogMutation(
  protocol: any,
  deps: SecurityCatalogEchoDeps,
  evt: { type?: string; name?: string; state?: string; packageId?: string | null } | null | undefined,
): Promise<SecurityCatalogEchoOutcome> {
  const type = evt?.type;
  const name = evt?.name;
  if (!isEchoType(type) || !name || evt?.state === 'draft') return 'skipped';
  const { metadata } = deps;
  if (!metadata || typeof metadata.registerInMemory !== 'function') return 'skipped';
  if (typeof protocol?.getMetaItemLayered !== 'function') return 'skipped';

  const address = mutationAddressOf(type, evt ?? {});
  const registered = new Set<string | null>();
  if (evt?.state !== 'deleted') {
    try {
      const echoed = await echoRowAt(protocol, deps, type, name, address);
      if (echoed) registered.add(echoed.slot);
    } catch (error) {
      const holders = address === undefined && type === 'permission' ? refusedPackageHolders(error) : undefined;
      if (!holders) throw error;
      for (const holder of holders) {
        const echoed = await echoRowAt(protocol, deps, type, name, holder);
        if (echoed) registered.add(echoed.slot);
      }
    }
  }
  const dropped = await dropGoneEchoSlots(protocol, deps, type, name, registered);
  return registered.size > 0 ? 'registered' : dropped > 0 ? 'dropped' : 'skipped';
}

/**
 * Register the echo as the protocol's awaited mutation projector for
 * `permission` and `position`. Returns `true` when wired; `false` on a
 * protocol without the seam (no environment door to echo).
 *
 * ⚠️ One projector per type on the protocol: a second registration replaces
 * the first. No other plugin registers one for these two types.
 */
export function registerSecurityCatalogEcho(protocol: any, deps: SecurityCatalogEchoDeps): boolean {
  if (typeof protocol?.registerMutationProjector !== 'function') return false;
  for (const type of SECURITY_CATALOG_ECHO_TYPES) {
    protocol.registerMutationProjector(type, async (evt: any) => {
      await echoSecurityCatalogMutation(protocol, deps, evt);
    });
  }
  return true;
}

/**
 * The boot pass: echo every stored, active, environment-wide overlay of both
 * types. The metadata service is in memory, so without this a restart serves
 * none of them until each is saved again. Returns the number registered.
 */
export async function echoStoredSecurityCatalogOverlays(
  protocol: any,
  deps: SecurityCatalogEchoDeps,
): Promise<number> {
  const { ql, logger } = deps;
  if (typeof ql?.find !== 'function' || typeof protocol?.getMetaItemLayered !== 'function') return 0;
  let registered = 0;
  for (const type of SECURITY_CATALOG_ECHO_TYPES) {
    // [ADR-0150 D4, #31698] Each row by its address: a set two packages hold
    // is echoed once per package, never read by name alone.
    const addresses = new Map<string, string | null>();
    // The plural spelling is a legacy `type` column value the protocol still reads.
    for (const stored of [type, `${type}s`]) {
      let rows: any[];
      // [ADR-0131 D6/D7] Env-wide overlays only. The family declares no
      // organization column, so the engine row never carries one: a legacy
      // organization's row is told apart off the physical column, on a
      // database the ceremony has not migrated. A read that cannot answer is a
      // failed read, below.
      let legacy: ReadonlyMap<string, string> = new Map();
      try {
        const found = await ql.find('sys_metadata', { where: { type: stored, state: 'active' } }, { context: seedCtx() });
        rows = Array.isArray(found) ? found : [];
        if (rows.length > 0) {
          legacy = await readLegacyOrganizationRows(
            typeof ql.getDriverForObject === 'function' ? ql.getDriverForObject('sys_metadata') : undefined,
          );
        }
      } catch (e) {
        logger?.warn(
          `[security] stored ${type} overlays could not be read at boot, so none is echoed into the security ` +
            'catalog: on an environment kernel each one stays unresolved — it grants nothing — until it is ' +
            'saved again or the kernel restarts with a readable metadata table.',
          { type: stored, error: String((e as Error)?.message ?? e) },
        );
        continue;
      }
      for (const row of rows) {
        if (!row?.name || legacy.has(String(row.id))) continue; // env-wide overlays only
        const bound = typeof row.package_id === 'string' && row.package_id !== '' ? row.package_id : null;
        addresses.set(`${String(row.name)}\u0000${bound ?? ''}`, bound);
      }
    }
    for (const [key, packageId] of addresses) {
      const name = key.slice(0, key.indexOf('\u0000'));
      try {
        if (await echoSecurityCatalogMutation(protocol, deps, { type, name, state: 'active', packageId }) === 'registered') {
          registered += 1;
        }
      } catch (e) {
        logger?.warn(`[security] the security-catalog echo of a stored ${type} failed at boot; it stays unresolved until it is saved again`, {
          type, name, error: String((e as Error)?.message ?? e),
        });
      }
    }
  }
  return registered;
}
