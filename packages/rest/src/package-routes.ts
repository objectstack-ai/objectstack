// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { IHttpServer, shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE } from '@objectstack/core';
// [#7020] The read cohort names the READ-ONLY half of the ADR-0106 D4 exemption
// on purpose: `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` became the derived union
// (write gate ∪ read-only exemptions) under the 2026-08-10 ruling, while this
// gate's cohort was ruled separately (#7033 / #7023) and pins write-only callers
// OUT. Same value it read before — no re-ruling by side effect.
import { OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES } from '@objectstack/metadata-core';
import type { PackageService } from '@objectstack/service-package';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
import { mountDirectRoutes, type DirectMountedRoute } from './direct-mount.js';
import { readSingleQueryValue, repeatedQueryParamMessage } from './query-multiplicity.js';

/**
 * [#7033 / #7023] The authorization gate for the REST package transport.
 *
 * `/packages` had TWO HTTP transports and both were ungated: the runtime
 * dispatcher domain (`packages/runtime/src/domains/packages.ts`) AND this
 * `@objectstack/rest` direct-mount registrar — which registers FIRST in the
 * production stack (first-match-wins, see the module note above), so for the
 * three routes both declare (`GET /packages`, `GET /packages/:id`,
 * `DELETE /packages/:id`) THIS transport is the one production actually serves.
 * Gating only the dispatcher would leave those routes open — the exact
 * one-transport gap #6603/#7019 paid for on `/meta`.
 *
 * Same ruled policy as the dispatcher (maintainer, 2026-08-09): a domain-wide
 * anonymous floor, `manage_metadata` for state-changing routes
 * (`POST /packages/publish`, `DELETE /packages/:id`), and the ADR-0106 D4 read
 * set (`studio.access` / `setup.access`) for reads (`GET /packages`,
 * `GET /packages/:id`). The public MARKETPLACE browse is a different surface
 * (`/marketplace/packages`, MarketplaceProxyPlugin) — these `/api/v1/packages`
 * routes are management, so denying anonymous here strands no public browse.
 *
 * The caller context is resolved through {@link PackageRoutesOptions.resolveExecutionContext},
 * which the composition wires to the `RestServer`'s own resolver (the SAME
 * resolution the `/meta` REST gate uses). When it is absent the gate FAILS
 * CLOSED (401) rather than open — an ungated fallback is the very hole this
 * closes. `isSystem` is never settable from the wire; CORS `OPTIONS` passes.
 *
 * Returns `true` when the response was already sent (the caller must `return`).
 */
async function refusePackageRequest(
  options: PackageRoutesOptions,
  req: any,
  res: any,
  kind: 'read' | 'write',
): Promise<boolean> {
  const ctx = options.resolveExecutionContext
    ? await options.resolveExecutionContext(req).catch(() => undefined)
    : undefined;
  // Anonymous-deny floor. This direct-mount surface DECLARES the wrapped
  // BaseResponseSchema envelope — every other body here goes through
  // sendOk/sendError, and `check:route-envelope` pins this module at ZERO
  // hand-written bodies — so the 401 is emitted through the SAME shared
  // `sendError`, not the flat `ANONYMOUS_DENY_BODY` the `/data`+`/meta`
  // `enforceAuth` seam writes. The shared DECISION (`shouldDenyAnonymous`) and
  // semantics (status / code / message) are reused; only the wrapper is this
  // surface's own (ADR-0112's two live envelopes, read per the seam you called).
  // `isSystem` is never settable from the wire; CORS `OPTIONS` passes.
  if (shouldDenyAnonymous({ userId: ctx?.userId, isSystem: ctx?.isSystem, method: req?.method })) {
    sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
    return true;
  }
  const held = new Set<string>(Array.isArray(ctx?.systemPermissions) ? ctx.systemPermissions : []);
  const allowed = ctx?.isSystem || (kind === 'write'
    ? held.has('manage_metadata')
    : OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES.some((c) => held.has(c)));
  if (!allowed) {
    // Same wrapped envelope, one FORBIDDEN code, message per cohort — the sibling
    // `/meta` REST capability gate's shape, built through the shared `sendError`.
    sendError(res, 403, 'FORBIDDEN', kind === 'write'
      ? 'Managing packages requires the `manage_metadata` capability.'
      : 'Reading packages requires the `studio.access` or `setup.access` capability.');
    return true;
  }
  return false;
}

/**
 * The `?version=` multiplicity rule (#6307), now shared (#6877).
 *
 * Both helpers moved to `query-multiplicity.ts` when the same rule was applied
 * to `rest-server.ts`'s read points — ONE rule and one refusal message across
 * the package, rather than a second implementation free to drift. Behaviour
 * here is unchanged; only the definitions' home moved. The module's header
 * carries the full argument for why repetition is refused rather than resolved.
 */

/**
 * Options for package route registration.
 */
export interface PackageRoutesOptions {
  /**
   * Protocol service (ObjectStackProtocol) — provides access to in-memory
   * SchemaRegistry packages loaded via defineStack()/AppPlugin at boot time,
   * and (#2747) the full `deletePackage` uninstall semantics: package
   * metadata rows, the durable `sys_packages` record, and the registered
   * data-plane cleanups (e.g. plugin-security revoking the package's
   * permission sets and bindings).
   */
  protocol?: {
    getMetaItems?(req: { type: string }): Promise<{ items: any[] }>;
    deletePackage?(req: { packageId: string; actor?: string }): Promise<{
      success: boolean;
      deletedCount: number;
      failedCount: number;
      failed: Array<{ type: string; name: string; error: string; code?: string }>;
      cleanups: Array<{ name: string; success: boolean; removed: number; error?: string }>;
    }>;
  };
  /**
   * [#7033 / #7023] Resolve the caller's execution context for a package route
   * request. Wired by the composition to the `RestServer`'s own resolver (the
   * SAME identity/RBAC resolution the `/meta` REST gate uses), so the capability
   * gate here reads the same `systemPermissions` the rest of the surface does.
   * Absent ⇒ the gate fails CLOSED (401). Never resolves an `isSystem` context
   * from inbound HTTP.
   */
  resolveExecutionContext?: (req: any) => Promise<{
    userId?: string | null;
    isSystem?: boolean;
    systemPermissions?: string[];
  } | undefined>;
}

/**
 * Register package management API routes
 *
 * Provides endpoints for publishing, retrieving, and managing packages.
 *
 * Returns the routes it mounted, so the caller can record them on the
 * `RestServer` that owns the surface (#5822) — the returned array IS the array
 * that was iterated to mount, never a second, hand-kept table. A boot without a
 * `package` service never calls this registrar, so nothing is mounted and
 * nothing is reported; see `direct-mount.ts`.
 *
 * Routes:
 * - POST /api/v1/packages/publish - Publish a package to the marketplace registry
 * - GET /api/v1/packages - List all packages (merges registry + database)
 * - GET /api/v1/packages/:id - Get a specific package
 * - DELETE /api/v1/packages/:id - Delete a package
 *
 * Marketplace publish lives at `/packages/publish`, NOT at the bare
 * `POST /packages` (#3610): that verb+path is the dispatcher packages
 * domain's *install* route, and this registrar registers first in the
 * production stack (first-match-wins), so claiming it here silently
 * swallowed every `client.packages.install` call with a 400. The
 * dispatcher's own `POST /packages/:id/publish` (ADR-0033 draft publish)
 * is two segments — different shape, no clash.
 *
 * ## Where this module's error codes came from
 *
 * This was the *partially* converted module when #3843 was filed, which is
 * arguably worse than untouched: 3 of its 16 bodies carried `success: true`, so
 * the same registrar answered two shapes depending on which route you hit. Its
 * error bodies were the pre-#3675 `{ error: '<string>' }` throughout — and the
 * string was a human `message`, not a code:
 *
 *     res.status(400).json({ error: 'Missing required fields: manifest, metadata' });
 *
 * Two of them carried no error at all, only a bare `{ success: false }`, so a
 * caller was told it failed and never told why.
 *
 * Because there were no codes here to preserve, these had to be MINTED. They
 * follow ADR-0112 (#3841, settled while this was in review): SCREAMING_SNAKE, and
 * registered in `ERROR_CODE_LEDGER` under `@objectstack/rest`. That union is now
 * the `code` parameter's TYPE — `sendError` takes `ErrorCode`, not `string`
 * (#3973) — so an unregistered code fails to compile rather than waiting for a
 * conformance suite to parse a driven body.
 *
 * Generic conditions reuse the STANDARD catalog rather than becoming registered
 * synonyms of it: a missing request field is `MISSING_REQUIRED_FIELD`, an absent
 * package is `RESOURCE_NOT_FOUND`, a request whose own parameters are
 * self-contradictory is `VALIDATION_ERROR` (the catalog's generic validation
 * failure, and what `HttpStatusErrorCodeMap` already names a bare 400 — see
 * `readSingleQueryValue`), an unexpected throw is `INTERNAL_ERROR`. Only
 * the package-specific outcomes are registered — `PACKAGE_MANIFEST_INVALID`,
 * `PACKAGE_PUBLISH_FAILED`, `PACKAGE_DELETE_PARTIAL`, `PACKAGE_DELETE_FAILED`.
 */
export function registerPackageRoutes(
  server: IHttpServer,
  packageService: PackageService,
  basePath: string = '/api/v1',
  options: PackageRoutesOptions = {},
): readonly DirectMountedRoute[] {
  const packagesPath = `${basePath}/packages`;

  /**
   * ONE declaration of this registrar's surface (#5822): the array below is
   * what gets mounted on the host server AND what is handed back as the
   * description of what was mounted. There is no second table to keep in sync —
   * see `direct-mount.ts` for why that identity is the whole point.
   */
  const routes: readonly DirectMountedRoute[] = [
  // POST /api/v1/packages/publish - Publish a package to the marketplace
  {
    method: 'POST',
    path: `${packagesPath}/publish`,
    metadata: { summary: 'Publish a package to the marketplace registry', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res, 'write')) return;
      const { manifest, metadata } = req.body || {};

      if (!manifest || !metadata) {
        sendError(res, 400, 'MISSING_REQUIRED_FIELD', 'Missing required fields: manifest, metadata');
        return;
      }

      if (!manifest.id || !manifest.version) {
        sendError(res, 400, 'PACKAGE_MANIFEST_INVALID', 'Invalid manifest: id and version are required');
        return;
      }

      const result = await packageService.publish({ manifest, metadata });

      if (result.success) {
        sendOk(res, {
          message: `Published ${manifest.id}@${manifest.version}`,
          package: {
            id: manifest.id,
            version: manifest.version,
          },
        });
        return;
      }

      sendError(res, 400, 'PACKAGE_PUBLISH_FAILED', result.error ?? `Failed to publish ${manifest.id}.`);
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', (error as Error).message);
    }
    },
  },

  // GET /api/v1/packages - List all packages (merges registry + database)
  {
    method: 'GET',
    path: packagesPath,
    metadata: { summary: 'List packages (registry + published)', tags: ['packages'] },
    handler: async (_req, res) => {
    try {
      if (await refusePackageRequest(options, _req, res, 'read')) return;
      // Merge two sources:
      // 1. Registry packages (in-memory, loaded at boot via defineStack/AppPlugin)
      // 2. Database packages (published via POST /packages)
      const packagesMap = new Map<string, any>();

      // Registry packages (via protocol service → SchemaRegistry)
      if (options.protocol && typeof options.protocol.getMetaItems === 'function') {
        try {
          const result = await options.protocol.getMetaItems({ type: 'package' });
          if (result?.items) {
            for (const item of result.items) {
              const id = item.manifest?.id || item.id;
              if (id) {
                packagesMap.set(id, {
                  ...item,
                  source: 'registry',
                });
              }
            }
          }
        } catch {
          // Protocol unavailable — continue with database only
        }
      }

      // Database packages (published artifacts)
      try {
        const dbPackages = await packageService.list();
        for (const pkg of dbPackages) {
          const id = pkg.manifest?.id || pkg.id;
          if (id) {
            // Database entry takes precedence (has richer metadata from publish)
            packagesMap.set(id, {
              ...packagesMap.get(id),
              ...pkg,
              source: packagesMap.has(id) ? 'both' : 'database',
            });
          }
        }
      } catch {
        // Database query failed — continue with registry-only packages
      }

      const packages = Array.from(packagesMap.values());
      sendOk(res, { packages, total: packages.length });
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', (error as Error).message);
    }
    },
  },

  // GET /api/v1/packages/:id - Get a specific package
  {
    method: 'GET',
    path: `${packagesPath}/:id`,
    metadata: { summary: 'Get a package by id', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res, 'read')) return;
      const packageId = req.params.id;
      const requested = readSingleQueryValue(req.query?.version);
      if (!requested.ok) {
        sendError(res, 400, 'VALIDATION_ERROR', repeatedQueryParamMessage('version', requested.count));
        return;
      }
      const version = requested.value || 'latest';

      // Try database first (richer data from publish)
      const pkg = await packageService.get(packageId, version);
      if (pkg) {
        sendOk(res, { package: { ...pkg, source: 'database' } });
        return;
      }

      // Fall back to registry (in-memory loaded packages)
      if (options.protocol && typeof options.protocol.getMetaItems === 'function') {
        try {
          const result = await options.protocol.getMetaItems({ type: 'package' });
          const match = result?.items?.find((item: any) =>
            (item.manifest?.id || item.id) === packageId
          );
          if (match) {
            sendOk(res, { package: { ...match, source: 'registry' } });
            return;
          }
        } catch {
          // Protocol unavailable
        }
      }

      sendError(res, 404, 'RESOURCE_NOT_FOUND', `Package "${packageId}" was not found.`);
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', (error as Error).message);
    }
    },
  },

  // DELETE /api/v1/packages/:id - Delete a package
  {
    method: 'DELETE',
    path: `${packagesPath}/:id`,
    metadata: { summary: 'Delete a package', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res, 'write')) return;
      const packageId = req.params.id;
      // Refused BEFORE the branch below, because the branch below is exactly
      // what a repeated `?version=` silently changed (#6307): the truthiness of
      // `version` is what decides full uninstall vs version-scoped delete.
      const requested = readSingleQueryValue(req.query?.version);
      if (!requested.ok) {
        sendError(res, 400, 'VALIDATION_ERROR', repeatedQueryParamMessage('version', requested.count));
        return;
      }
      const version = requested.value;

      // [#2747] A FULL uninstall (no version pin) goes through
      // protocol.deletePackage — one uninstall semantic, not three dialects:
      // it removes the package's metadata rows, drops the durable
      // sys_packages record, and runs the registered data-plane cleanups
      // (plugin-security revokes the package's permission sets/bindings —
      // no ghost grants). A version-scoped delete keeps the narrow durable
      // registry semantics, as does a deployment without the protocol.
      if (!version && typeof options.protocol?.deletePackage === 'function') {
        const result = await options.protocol.deletePackage({ packageId });
        // Zero metadata rows is still a successful uninstall (e.g. a
        // runtime-registered package that never published metadata) —
        // only per-item failures make it a failure.
        if (result.failedCount === 0) {
          sendOk(res, {
            message: `Deleted ${packageId}`,
            deletedCount: result.deletedCount,
            cleanups: result.cleanups,
          });
          return;
        }
        // Was a bare `{ success: false, failed, cleanups }` — a failure with no
        // `error` at all, so a caller learned that it failed but never why. The
        // per-item detail is preserved under the declared `error.details`.
        sendError(
          res,
          400,
          'PACKAGE_DELETE_PARTIAL',
          `Deleting ${packageId} left ${result.failedCount} item(s) behind.`,
          { details: { failed: result.failed, cleanups: result.cleanups } },
        );
        return;
      }

      const result = await packageService.delete(packageId, version);

      if (result.success) {
        sendOk(res, {
          message: `Deleted ${packageId}${version ? `@${version}` : ''}`,
        });
        return;
      }

      // The other bare `{ success: false }`.
      sendError(
        res,
        400,
        'PACKAGE_DELETE_FAILED',
        `Failed to delete ${packageId}${version ? `@${version}` : ''}.`,
      );
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', (error as Error).message);
    }
    },
  },
  ];

  return mountDirectRoutes(server, routes);
}
