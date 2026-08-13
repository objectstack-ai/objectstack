// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { createHash } from 'node:crypto';
import { checkProtocolCompat } from '@objectstack/metadata-core';
import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import type { IDataEngine } from '@objectstack/spec/contracts';

export interface PackageMetadata {
  objects?: any[];
  views?: any[];
  apps?: any[];
  flows?: any[];
  agents?: any[];
  tools?: any[];
  translations?: any[];
}

export interface PackageRecord {
  id: string;
  version: string;
  manifest: ObjectStackManifest;
  metadata: PackageMetadata;
  hash: string;
  created_at: string;
  updated_at: string;
}

/**
 * [#8131] The caller-facing sentence a driver-fault publish answers with.
 *
 * Deliberately a CONSTANT with no interpolation at all. The whole defect this
 * closes was `(error as Error).message` being handed back as caller-visible
 * data, so the remedy is not "interpolate something safer" — it is that this
 * producer interpolates *nothing* into the message a caller reads. Exported so
 * the door and its pins can assert the POSITIVE shape rather than the absence
 * of a driver line (an absence assertion passes for any rewrite, including a
 * worse one).
 *
 * It says the three things a caller can act on: the write did not land, the
 * detail exists but on the server, and this is not theirs to fix.
 */
export const PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE =
  'The package registry could not store this package. The failure was logged on the server; '
  + 'no package data was written.';

/**
 * [#8131] A publish that failed because the WRITE broke — a server fault.
 *
 * Its `message` is always safe to hand a caller: the driver's own text went to
 * the log and travels no further.
 */
export interface PackagePublishDriverFault {
  /** A stable sentence. NEVER interpolates driver text. */
  message: string;
}

/**
 * [#8131] The outcome of {@link PackageService.publish}.
 *
 * The discriminant is the CHANNEL, not a field to parse:
 *
 *  - **Returned** `{ success: false, driverFault }` — the write itself broke.
 *    The caller did nothing wrong, so this is a **5xx**, and the driver's text
 *    is not theirs to read.
 *  - **Thrown**, carrying an ADR-0112 envelope — a *refusal*. `publish` does
 *    not swallow those; they leave by the door's `sendThrownError`, where
 *    #8016's mapping answers them with the producer's own status and code
 *    (a `409 DESTRUCTIVE_CHANGE` stays a 409) and #8086's withhold judges
 *    their prose.
 *
 * Replaces `error?: string`, which was that leak's carrier: a bare string
 * cannot say which side is at fault, so the door had no way to answer anything
 * but one status for both, and it picked the wrong one.
 */
export interface PackagePublishResult {
  success: boolean;
  /** Present only when the write broke. Absent on success. */
  driverFault?: PackagePublishDriverFault;
}

export interface PackageService {
  publish(data: { manifest: ObjectStackManifest; metadata: PackageMetadata }): Promise<PackagePublishResult>;
  get(packageId: string, version?: string): Promise<PackageRecord | null>;
  list(): Promise<PackageRecord[]>;
  delete(packageId: string, version?: string): Promise<{ success: boolean }>;
}

/**
 * [#8131] Does this throw DECLARE an HTTP answer of its own (ADR-0112)?
 *
 * The channel is the **status**, in both spellings `resolveThrownHttpError`
 * (`@objectstack/types`, the ONE rule both package doors call since #8016)
 * reads, and for the reason that function documents: both are produced in this
 * repo (`metadata-protocol` throws `status`, `plugin-approvals` throws
 * `statusCode`), and reading only one is how a deliberate refusal became a
 * 500.
 *
 * ⛔ **`.code` is deliberately NOT a declaration here, and that is a measured
 * decision, not an omission.** Every SQL driver populates a string `code` on
 * its errors — `node:sqlite` throws `ERR_SQLITE_ERROR`, better-sqlite3
 * `SQLITE_ERROR`, Postgres the SQLSTATE `42P01`, MySQL `ER_NO_SUCH_TABLE`.
 * An earlier draft of this predicate accepted any non-empty string `code`, and
 * the real-driver cases in `publish-driver-fault.test.ts` went red at once:
 * every genuine driver fault was re-thrown as if it were a refusal, resolved
 * to `500 INTERNAL_ERROR` with the driver's own message, and — because
 * `looksLikeInternalErrorLeak` is false for `no such table: sys_packages` —
 * that message reached the wire. The exact leak this card closes, re-opened by
 * the classifier. A producer that wants a specific answer declares a
 * **status**; a bare string `code` is a channel it shares with every driver we
 * ship, so it cannot carry intent at this seam.
 *
 * The predicate is asked HERE rather than imported because
 * `@objectstack/types` resolves through `exports` to `dist/`, so
 * value-importing it would make this package's unit pins a verdict about a
 * build artifact (`check:test-source-alias`). Its agreement with the shared
 * rule is pinned at the door, where `@objectstack/types` is already a value
 * dependency — see `package-publish-status-classification.test.ts` §5.
 *
 * Note this is a test of DECLARATION, not of the status's band. A declared
 * 5xx is re-thrown too: the producer said what it was, so the door's shared
 * mapping — not this catch — is what should answer for it.
 */
function declaresHttpAnswer(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  return typeof status === 'number' || typeof statusCode === 'number';
}

/**
 * Normalize the result of `objectql.execute()` into a row array.
 *
 * Different drivers return different shapes for raw SELECT statements:
 *   - SQL driver (knex/SQLite) and Turso remote transport return rows
 *     directly as an array.
 *   - PostgreSQL (knex/pg) returns `{ rows, rowCount, ... }`.
 *   - Some drivers may return `{ rows: [...] }` wrappers in other contexts.
 *
 * This helper accepts any of those shapes and always returns an array.
 */
function normalizeRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

/**
 * Package Management Service Plugin
 *
 * Provides package publishing, retrieval, and management capabilities.
 * Stores package metadata in the sys.packages table for dynamic loading.
 */
export class PackageServicePlugin implements Plugin {
  name = 'package-service';

  async init(ctx: PluginContext): Promise<void> {
    // Service will be registered in start() after ObjectQL is available
    ctx.logger.debug('Package service plugin initialized');
  }

  async start(ctx: PluginContext): Promise<void> {
    const logger = ctx.logger;

    // Get ObjectQL service (available in start() hook after dependencies are initialized)
    const objectql = ctx.getService<IDataEngine>('objectql');
    if (!objectql || !objectql.execute) {
      throw new Error('ObjectQL service with execute() support is required for PackageService');
    }

    // Create sys_packages table if it doesn't exist
    try {
      await this.ensureTable(objectql, logger);
    } catch (error) {
      logger.error('Failed to create sys_packages table', error as Error);
      throw error;
    }

    // Create the package service
    const packageService: PackageService = {
      async publish(data: { manifest: ObjectStackManifest; metadata: PackageMetadata }) {
        try {
          const hash = createHash('sha256')
            .update(JSON.stringify({ manifest: data.manifest, metadata: data.metadata }))
            .digest('hex');

          await objectql.execute!({
            sql: `
              INSERT INTO sys_packages (id, version, manifest, metadata, hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT(id, version) DO UPDATE SET
                manifest = excluded.manifest,
                metadata = excluded.metadata,
                hash = excluded.hash,
                updated_at = CURRENT_TIMESTAMP
            `,
            args: [
              data.manifest.id,
              data.manifest.version,
              JSON.stringify(data.manifest),
              JSON.stringify(data.metadata),
              hash,
            ],
          });

          logger.info(`Published package: ${data.manifest.id}@${data.manifest.version}`);
          return { success: true };
        } catch (error) {
          // [#8131] ① The raw driver text goes to the LOG — the one place it
          // belongs, and where it already went. Nothing about the operator's
          // diagnostics changes here; what changes is that this is now the
          // ONLY place it goes.
          logger.error('Failed to publish package', error as Error);

          // ② A throw that DECLARES its own envelope is a REFUSAL, and a
          // refusal is not this method's to swallow. Re-thrown so it leaves by
          // the door's catch-all, where #8016's shared mapping answers it with
          // the producer's own status and code. Swallowing these is what
          // flattened every coded refusal reachable from this call path into
          // one `400 PACKAGE_PUBLISH_FAILED` — the mirror of the defect #8016
          // fixed for the throw path, and the reason a caller error and a
          // server fault were indistinguishable on this route.
          if (declaresHttpAnswer(error)) throw error;

          // ③ Everything else is a DRIVER FAULT: the `INSERT INTO
          // sys_packages` broke, the caller's request was never the problem,
          // and the driver's line — a constraint dump naming physical columns,
          // a `SQLITE_ERROR`, an `SQLSTATE` — is not theirs to read. A stable
          // sentence goes back instead.
          //
          // ⚠️ This is the half that actually closes the disclosure, and it
          // has to be: the 5xx withhold (#8086) lives in the door's
          // `sendThrownError`, which a RETURNED failure never reaches at any
          // status — and even reached, `looksLikeInternalErrorLeak` is
          // measured FALSE for `no such table: sys_packages`, the commonest
          // real failure of this very statement. Correct classification alone
          // would have left the text on the wire.
          return {
            success: false,
            driverFault: { message: PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE },
          };
        }
      },

      async get(packageId: string, version: string = 'latest') {
        try {
          const sql = version === 'latest'
            ? `SELECT * FROM sys_packages WHERE id = ? ORDER BY created_at DESC LIMIT 1`
            : `SELECT * FROM sys_packages WHERE id = ? AND version = ?`;

          const args = version === 'latest' ? [packageId] : [packageId, version];
          const result = await objectql.execute!({ sql, args });
          const rows = normalizeRows(result);

          if (rows.length === 0) {
            return null;
          }

          const row = rows[0];
          return {
            id: row.id,
            version: row.version,
            manifest: JSON.parse(row.manifest),
            metadata: JSON.parse(row.metadata),
            hash: row.hash,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        } catch (error) {
          logger.error(`Failed to get package: ${packageId}`, error as Error);
          return null;
        }
      },

      async list() {
        try {
          const result = await objectql.execute!({
            sql: `
              SELECT * FROM sys_packages
              WHERE (id, created_at) IN (
                SELECT id, MAX(created_at) FROM sys_packages GROUP BY id
              )
              ORDER BY created_at DESC
            `,
          });

          return normalizeRows(result).map((row: any) => ({
            id: row.id,
            version: row.version,
            manifest: JSON.parse(row.manifest),
            metadata: JSON.parse(row.metadata),
            hash: row.hash,
            created_at: row.created_at,
            updated_at: row.updated_at,
          }));
        } catch (error) {
          logger.error('Failed to list packages', error as Error);
          return [];
        }
      },

      async delete(packageId: string, version?: string) {
        try {
          const sql = version
            ? `DELETE FROM sys_packages WHERE id = ? AND version = ?`
            : `DELETE FROM sys_packages WHERE id = ?`;

          const args = version ? [packageId, version] : [packageId];
          await objectql.execute!({ sql, args });

          logger.info(`Deleted package: ${packageId}${version ? `@${version}` : ''}`);
          return { success: true };
        } catch (error) {
          logger.error('Failed to delete package', error as Error);
          return { success: false };
        }
      },
    };

    ctx.registerService('package', packageService);
    logger.info('Package service initialized');

    // Reconcile durable packages back into the in-memory registry (ADR-0033
    // consolidation). Packages persisted to `sys_packages` — AI-authored app
    // packages, or anything HTTP-installed in a previous run — must survive a
    // restart and surface in the registry-backed read paths (the dispatcher's
    // `/api/v1/packages` list/detail and `getMetaItems({type:'package'})`, i.e.
    // Studio's package selector). Never clobber a package already registered
    // from the filesystem. Best-effort and non-fatal.
    try {
      const registry = (objectql as unknown as { registry?: any }).registry;
      if (registry?.installPackage && registry?.getPackage) {
        let hydrated = 0;
        for (const rec of await packageService.list()) {
          const id = rec?.manifest?.id;
          if (id && !registry.getPackage(id)) {
            // ADR-0087 D1 — protocol handshake on the boot-time rehydration
            // path (the LOAD seam; the install seam already checks in
            // metadata-protocol). A durable package persisted under an older
            // runtime whose declared `engines.protocol` excludes this runtime's
            // major is REFUSED here with the structured diagnostic — skipped,
            // never loaded — instead of resurfacing later as a deep schema or
            // renderer crash. Boot itself continues: one stale package must not
            // brick the environment. Absent/unparsable ranges are admitted
            // (grandfathering; never a false rejection).
            const compat = checkProtocolCompat(rec.manifest);
            if (compat.status === 'incompatible') {
              logger.error(
                `[protocol] refusing to rehydrate package '${id}' from sys_packages: ` +
                  `${compat.diagnostic.message} ` +
                  JSON.stringify(compat.diagnostic),
              );
              continue;
            }
            if (compat.status === 'no-range') {
              logger.warn(
                `[protocol] package '${id}' declares no engines.protocol range; ` +
                  `rehydrating without a compatibility check (ADR-0087).`,
              );
            } else if (compat.status === 'unparsed-range') {
              logger.warn(
                `[protocol] package '${id}' declares an unrecognized ${compat.source} range ` +
                  `'${compat.requiredRange}'; skipping the protocol handshake (ADR-0087).`,
              );
            }
            registry.installPackage(rec.manifest);
            hydrated++;
          }
        }
        if (hydrated > 0) {
          logger.info(`Hydrated ${hydrated} package(s) from sys_packages into registry`);
        }
      }
    } catch (error) {
      logger.debug(`Package hydration from sys_packages skipped: ${(error as Error)?.message}`);
    }
  }

  private async ensureTable(objectql: IDataEngine, logger: any): Promise<void> {
    try {
      // Create the sys_packages table
      await objectql.execute!({
        sql: `
          CREATE TABLE IF NOT EXISTS sys_packages (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            manifest TEXT NOT NULL,
            metadata TEXT NOT NULL,
            hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id, version)
          )
        `,
      });

      // Create index for faster latest version queries
      await objectql.execute!({
        sql: `
          CREATE INDEX IF NOT EXISTS idx_packages_latest
          ON sys_packages(id, created_at DESC)
        `,
      });

      logger.debug('sys_packages table ensured');
    } catch (error) {
      // Table might already exist, log and continue
      logger.debug('sys_packages table creation skipped (may already exist)');
    }
  }
}

export { PackageServicePlugin as default };
