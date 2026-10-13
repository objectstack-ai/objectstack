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
 *    a position it is "no artifact in the engine registry declares the name".
 *  - `_packageId` (#23233): the package the stored row is bound to, as the
 *    protocol's by-name read serves it. The catalog takes an item's owner
 *    from `_packageId` alone, and the suggestion collector skips an unowned
 *    `isDefault: true` set (ADR-0090 D5: packages suggest, admins confirm).
 *    The owner is carried, never derived.
 *
 * When the overlay is gone, an echo of ours is healed back to the declared
 * body the engine registry holds, or dropped.
 */

import { isTenantAuthored } from '@objectstack/metadata-core';
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
  /** The kernel `metadata` service the catalog reads (`registerInMemory`, `get`, `unregister`). */
  metadata?: any;
  logger?: SecurityCatalogEchoLogger;
}

/** What one echo did. */
export type SecurityCatalogEchoOutcome = 'registered' | 'healed' | 'dropped' | 'skipped';

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
 * The declared (artifact) body for `name` in the engine registry, or `null`.
 * Echoes and stored rows are not artifacts: a registry heal can re-register
 * the metadata service's view (our marked copy) as a plain item, and a host
 * kernel's hydrator registers stored rows wearing `_provenance: 'org'`.
 */
function readDeclaredBody(ql: any, type: SecurityCatalogEchoType, name: string): any {
  try {
    const items = ql?.registry?.listItems?.(type) ?? [];
    for (const body of items) {
      if (body?.name !== name || body?._packageId === 'sys_metadata') continue;
      if (isProjectionEcho(body) || isTenantAuthored(body)) continue;
      return body;
    }
  } catch { /* no readable registry: nothing declared */ }
  return null;
}

/**
 * The package the stored row a by-name read SERVES for `name` is bound to:
 * the `_packageId` the protocol's single-item read states from that row's
 * `package_id` column. `undefined` when the row is bound to no package, or the
 * protocol has no single-item read. A read that fails is not caught here.
 */
export async function readServedPackageBinding(
  protocol: any,
  name: string,
  type: SecurityCatalogEchoType = 'permission',
): Promise<string | undefined> {
  if (typeof protocol?.getMetaItem !== 'function') return undefined;
  const served = await protocol.getMetaItem({ type, name });
  const packageId = served?.item?._packageId;
  return typeof packageId === 'string' && packageId !== '' ? packageId : undefined;
}

/**
 * Echo one landed mutation. Reads the environment-wide overlay through the
 * protocol's layered read (ADR-0131 D6: no organization is part of a metadata
 * read) and registers it, or heals/drops our echo when there is none.
 */
export async function echoSecurityCatalogMutation(
  protocol: any,
  deps: SecurityCatalogEchoDeps,
  evt: { type?: string; name?: string; state?: string } | null | undefined,
): Promise<SecurityCatalogEchoOutcome> {
  const type = evt?.type;
  const name = evt?.name;
  if (!isEchoType(type) || !name || evt?.state === 'draft') return 'skipped';
  const { ql, metadata, logger } = deps;
  if (!metadata || typeof metadata.registerInMemory !== 'function') return 'skipped';
  if (typeof protocol?.getMetaItemLayered !== 'function') return 'skipped';

  let overlay: any = null;
  let envelope: unknown;
  if (evt?.state !== 'deleted') {
    const layered = await protocol.getMetaItemLayered({ type, name });
    // An envelope is told by its layer keys; anything else carries no overlay
    // this module can tell apart from an artifact, so it is not echoed.
    if (layered && typeof layered === 'object'
      && ('effective' in layered || 'overlay' in layered || 'code' in layered)) {
      envelope = layered;
      overlay = layered.overlay ?? null;
    }
  }

  if (!overlay?.name) {
    // Overlay gone: heal an echo of ours back to the declared body, or drop it.
    const current = typeof metadata.get === 'function' ? await metadata.get(type, name) : undefined;
    if (!isProjectionEcho(current)) return 'skipped';
    const declared = readDeclaredBody(ql, type, name);
    if (declared) {
      metadata.registerInMemory(type, name, stripDecorations(declared));
      return 'healed';
    }
    if (typeof metadata.unregister === 'function') {
      // unregister() also asks writable loaders to delete — the stored row is
      // already gone, so this is an in-memory removal.
      await metadata.unregister(type, name);
    }
    return 'dropped';
  }

  const tenantAuthored = type === 'permission'
    ? classifyPackagedPermissionSet(name, ql, { status: 'read', envelope }).status === 'org'
    : readDeclaredBody(ql, type, name) === null;
  let ownerPackageId: string | undefined;
  if (tenantAuthored) {
    try {
      ownerPackageId = await readServedPackageBinding(protocol, name, type);
    } catch (e) {
      // Functional, not durability: nothing persisted is lost and nothing
      // grants differently — the echo is registered unowned, so it still
      // resolves and enforces the stored body. What is missing is said once,
      // with what restores it.
      logger?.warn(
        `[security] the package binding of this ${type} could not be read, so its security-catalog echo ` +
          'names no owning package: the catalog serves it as unowned, and an `isDefault: true` permission ' +
          'set records no audience-binding suggestion (ADR-0090 D5), until the name is echoed again — ' +
          'the next save, publish or boot re-reads the binding. Enforcement is unaffected.',
        { type, name, error: String((e as Error)?.message ?? e) },
      );
    }
  }
  metadata.registerInMemory(type, name, {
    ...stripDecorations(overlay),
    ...(tenantAuthored ? { _provenance: 'org' } : {}),
    ...(tenantAuthored && ownerPackageId !== undefined ? { _packageId: ownerPackageId } : {}),
    [ENV_PROJECTION_MARKER]: true,
  });
  return 'registered';
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
    const names = new Set<string>();
    // The plural spelling is a legacy `type` column value the protocol still reads.
    for (const stored of [type, `${type}s`]) {
      let rows: any[];
      try {
        const found = await ql.find('sys_metadata', { where: { type: stored, state: 'active' } }, { context: seedCtx() });
        rows = Array.isArray(found) ? found : [];
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
        if ((row?.organization_id ?? null) !== null || !row?.name) continue; // env-wide overlays only
        names.add(String(row.name));
      }
    }
    for (const name of names) {
      try {
        if (await echoSecurityCatalogMutation(protocol, deps, { type, name, state: 'active' }) === 'registered') {
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
