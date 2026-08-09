// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { IHttpServer } from '@objectstack/core';
import type { PackageService } from '@objectstack/service-package';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
import { mountDirectRoutes, type DirectMountedRoute } from './direct-mount.js';

/**
 * The outcome of reading a query parameter that this API declares as
 * single-valued. `ok: false` carries the multiplicity so the refusal can say
 * what it saw rather than only that it refused.
 */
type SingleQueryRead =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly count: number };

/**
 * Read a query parameter the route declares single-valued out of the shape the
 * transport contract actually declares (#6307).
 *
 * `IHttpRequest.query` is `Record<string, string | string[]>` — a repeated
 * parameter is an ARRAY, and that is not a hypothetical arm of the union: the
 * `node:http` adapter (`@objectstack/http-conformance`'s `NodeHttpServer`)
 * hands `?version=a&version=b` through as `['a','b']`, measured over a socket.
 * The Hono adapter happens to collapse it to the first value before a handler
 * ever sees it, so the two adapters answer one contract-legal request
 * differently — which is precisely why the CONSUMER has to handle the shape it
 * was told to expect rather than lean on whichever server booted.
 *
 * ## Why repetition is refused rather than resolved
 *
 * `?version=1.0.0&version=2.0.0` is a well-formed request carrying two
 * conflicting intents. Picking one silently is a wrong answer delivered as a
 * success, and on `DELETE` it silently changes the OPERATION'S SCOPE: any
 * truthy `version` skips the `protocol.deletePackage` full-uninstall branch, so
 * a repeated parameter degraded a full uninstall into a narrow version-delete
 * and answered `200`. The server does not get to choose which of a caller's two
 * versions it meant; it says so.
 *
 * The rule is deliberately about MULTIPLICITY, not about shape: the parameter
 * may be supplied at most once. A one-element array is one occurrence encoded
 * differently by an adapter and is accepted; an empty array is no occurrence.
 * Two identical values (`?version=1.0.0&version=1.0.0`) are still two
 * occurrences and are still refused — "at most one *distinct* value" would be a
 * de-duplication rule no caller can predict, while "supply it at most once" is
 * checkable client-side without knowing anything about our semantics.
 *
 * This is NOT tolerance for off-spec input: the contract already declares the
 * array. It is the consumer finally handling a declared shape.
 */
function readSingleQueryValue(raw: string | string[] | undefined): SingleQueryRead {
  if (Array.isArray(raw)) {
    // length 0 → the parameter was not supplied; length 1 → supplied once.
    return raw.length > 1 ? { ok: false, count: raw.length } : { ok: true, value: raw[0] };
  }
  return { ok: true, value: raw };
}

/**
 * The one refusal message for a repeated single-valued parameter, so `GET` and
 * `DELETE` answer the SAME rule identically — two different answers for one
 * parameter would just be a new inconsistency.
 */
function repeatedQueryParamMessage(name: string, count: number): string {
  return `The "${name}" query parameter was supplied ${count} times. Supply it at most once — `
    + `this endpoint will not choose between conflicting values.`;
}

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
