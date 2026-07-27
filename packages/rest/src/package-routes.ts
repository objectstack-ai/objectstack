// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { IHttpServer } from '@objectstack/core';
import type { PackageService } from '@objectstack/service-package';

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
 */
export function registerPackageRoutes(
  server: IHttpServer,
  packageService: PackageService,
  basePath: string = '/api/v1',
  options: PackageRoutesOptions = {},
) {
  const packagesPath = `${basePath}/packages`;

  // POST /api/v1/packages/publish - Publish a package to the marketplace
  server.post(`${packagesPath}/publish`, async (req, res) => {
    try {
      const { manifest, metadata } = req.body || {};

      if (!manifest || !metadata) {
        res.status(400).json({ error: 'Missing required fields: manifest, metadata' });
        return;
      }

      if (!manifest.id || !manifest.version) {
        res.status(400).json({ error: 'Invalid manifest: id and version are required' });
        return;
      }

      const result = await packageService.publish({ manifest, metadata });

      if (result.success) {
        res.json({
          success: true,
          message: `Published ${manifest.id}@${manifest.version}`,
          package: {
            id: manifest.id,
            version: manifest.version,
          },
        });
        return;
      }

      res.status(400).json({ success: false, error: result.error });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /api/v1/packages - List all packages (merges registry + database)
  server.get(packagesPath, async (_req, res) => {
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
      res.json({ packages, total: packages.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /api/v1/packages/:id - Get a specific package
  server.get(`${packagesPath}/:id`, async (req, res) => {
    try {
      const packageId = req.params.id;
      const version = req.query?.version || 'latest';

      // Try database first (richer data from publish)
      const pkg = await packageService.get(packageId, version);
      if (pkg) {
        res.json({ package: { ...pkg, source: 'database' } });
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
            res.json({ package: { ...match, source: 'registry' } });
            return;
          }
        } catch {
          // Protocol unavailable
        }
      }

      res.status(404).json({ error: 'Package not found' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // DELETE /api/v1/packages/:id - Delete a package
  server.delete(`${packagesPath}/:id`, async (req, res) => {
    try {
      const packageId = req.params.id;
      const version = req.query?.version;

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
          res.json({
            success: true,
            message: `Deleted ${packageId}`,
            deletedCount: result.deletedCount,
            cleanups: result.cleanups,
          });
          return;
        }
        res.status(400).json({ success: false, failed: result.failed, cleanups: result.cleanups });
        return;
      }

      const result = await packageService.delete(packageId, version);

      if (result.success) {
        res.json({
          success: true,
          message: `Deleted ${packageId}${version ? `@${version}` : ''}`,
        });
        return;
      }

      res.status(400).json({ success: false });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
