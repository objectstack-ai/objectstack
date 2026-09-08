// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15169] The host door: mount the framework's storage routes on an HTTP
 * surface the HOST owns, over a kernel that has no `http-server` service.
 *
 * ## Why this exists
 *
 * `StorageServicePlugin` mounts `/api/v1/storage/*` itself, at `kernel:ready`,
 * on the kernel's `http-server` service. A hosted per-environment tenant kernel
 * (cloud) registers no such service, so that branch logs "no HTTP server
 * available" and the storage service is up with no HTTP door: `sys_file`,
 * the lifecycle hooks and the reap guards are all present, and every
 * `/api/v1/storage/*` request answers 404 — an app with an attachment field
 * cannot upload. The settings service already has a working answer to the
 * same shape: the host mounts `registerSettingsRoutes` on its raw app and
 * dispatches into the environment kernel's route table. Storage could not be
 * bridged the same way, because `registerStorageRoutes` needs three seams —
 * the upload session resolver, the ADR-0104 D3 download authorizer and the
 * tombstone holder predicate — that are, deliberately, package-internal.
 *
 * ## The shape, and what it exposes
 *
 * ONE entry point that takes the host's `IHttpServer`-shaped surface plus the
 * kernel to compose from, and binds the three seams inside the package —
 * the narrow half of #15169 option A, preferred over publishing the three
 * builders because a narrower public surface is easier to walk back. What a
 * consumer gets is the door; what it never gets is a handle on any gate:
 *
 * - {@link MountStorageRoutesOptions} carries the wire knobs only (`basePath`,
 *   the three TTLs, a logger). It has no `resolveSession`, no
 *   `authorizeFileRead`, no `resolveFileHolder` — the three option keys of
 *   `registerStorageRoutes` this door exists to keep off the host's side.
 *   An object literal naming one of them is a type error, and a widened
 *   object carrying one is ignored: the composition reads named fields, never
 *   the options bag through.
 * - The gates are built from the kernel the host hands over — its `auth`
 *   service and its data engine — by the same `composeStorageRoutes` the
 *   plugin's own `kernel:ready` mount calls. One composition, two callers, so
 *   the platform keeps exactly one definition of the download gate, which is
 *   the property that made the settings bridge safe and the property option C
 *   (a consumer re-implementing the authorizer) would have broken.
 * - The return value is a {@link StorageRoutesMountReport}: booleans saying
 *   which gates bound, for the host's boot log. Never the functions.
 *
 * ## Preconditions, loudly
 *
 * Call it once per kernel, after that kernel has bootstrapped: the gates
 * resolve `auth` / `objectql` at mount time, exactly as the plugin does at
 * `kernel:ready`, so a kernel still filling its registry would bind a gate
 * against an absence the boot later contradicts. A kernel with no `storage`
 * service THROWS (nothing to mount — mount `StorageServicePlugin` first).
 * A kernel with no `auth` service or no data engine mounts with the matching
 * gate off — the declared bare-kernel behaviour — and says so at `warn`,
 * naming what stays open and the composition that closes it.
 */

import type { IHttpServer, IDataEngine, IStorageService } from '@objectstack/spec/contracts';
import {
  composeStorageRoutes,
  toGateRegistry,
  type StorageRouteKernel,
  type StorageRoutesMountReport,
} from './storage-service-plugin.js';

export type { StorageRouteKernel, StorageRoutesMountReport } from './storage-service-plugin.js';

/**
 * The wire knobs of a host mount. Deliberately NOT `StorageRoutesOptions`: the
 * three gate seams that type carries are bound by the package (see the module
 * header), and are not accepted here in any form.
 */
export interface MountStorageRoutesOptions {
  /** Wire prefix. @default '/api/v1/storage' */
  basePath?: string;
  /** Default presigned upload URL TTL in seconds. @default 3600 */
  presignedTtl?: number;
  /** Default chunked upload session TTL in seconds. @default 86400 */
  sessionTtl?: number;
  /** TTL of the signed URL minted on a GATED download. @default 300 */
  downloadTtl?: number;
  /** Receives the door's one-time notices (open upload mode, unbound gates). */
  logger?: { info(msg: string): void; warn(msg: string): void };
}

/**
 * Mount `/api/v1/storage/*` on `http`, composed from `kernel`.
 *
 * `http` is whatever the host registers routes on — a real `IHttpServer`
 * adapter, or the host's own route-collecting shim that later dispatches into
 * the kernel this was composed from (the settings bridge's shape). Only the
 * registration half (`get` / `post` / `put`) is called.
 *
 * `kernel` is the environment kernel — an `ObjectKernel`, a `LiteKernel`, or a
 * `PluginContext` on one; see {@link StorageRouteKernel}. Its `storage` service
 * is what the routes serve, its `objectql` engine is where `sys_file` lives,
 * and its `auth` service is what the upload and download gates authenticate
 * against.
 *
 * @throws when `kernel` has no `storage` service — there is nothing to mount.
 */
export function mountStorageRoutes(
  http: IHttpServer,
  kernel: StorageRouteKernel,
  opts: MountStorageRoutesOptions = {},
): StorageRoutesMountReport {
  let storage: IStorageService | undefined;
  try {
    storage = kernel.getService<IStorageService>('storage');
  } catch {
    storage = undefined;
  }
  if (!storage) {
    throw new Error(
      'mountStorageRoutes: the kernel has no `storage` service, so there are no storage routes to ' +
        'mount. Mount `StorageServicePlugin` on that kernel (it registers `storage` in init()) and ' +
        'call mountStorageRoutes after the kernel has bootstrapped.',
    );
  }

  let engine: IDataEngine | null = null;
  try {
    engine = kernel.getService<IDataEngine>('objectql');
  } catch {
    // No data engine: `sys_file` metadata is held in memory and the two
    // parent-governed gates cannot be built — reported below, not hidden.
    engine = null;
  }

  const report = composeStorageRoutes(http, toGateRegistry(kernel), {
    storage,
    engine,
    basePath: opts.basePath,
    presignedTtl: opts.presignedTtl,
    sessionTtl: opts.sessionTtl,
    downloadTtl: opts.downloadTtl,
    logger: opts.logger,
  });

  const unbound: string[] = [];
  if (!report.sessionResolver) {
    unbound.push('upload routes accept anonymous requests (no `auth` service on the kernel)');
  }
  if (!report.downloadAuthorizer) {
    unbound.push(
      'parent-governed downloads are NOT authorized (the kernel lacks an `auth` service or a data engine)',
    );
  }
  if (report.metadataStore === 'memory') {
    unbound.push('`sys_file` metadata is in-memory (no `objectql` engine on the kernel) and is lost on restart');
  }
  if (unbound.length > 0) {
    opts.logger?.warn(
      `mountStorageRoutes: storage routes mounted at ${report.basePath} with gates unbound — ` +
        unbound.join('; ') +
        '. This is the declared bare-kernel posture; on a hosted kernel, register `auth` and the ' +
        'data engine on it BEFORE mounting so the same gates the plugin binds are bound here.',
    );
  }
  return report;
}
