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

/**
 * [#8275] The outcome of {@link PackageService.delete}.
 *
 * Same CHANNEL discipline as {@link PackagePublishResult}, and for the same
 * reason — a `DELETE FROM sys_packages` that breaks is a server fault, not a
 * caller's mistake:
 *
 *  - **Returned** `{ success: false }` — the delete itself broke. The caller
 *    did nothing wrong, so the door answers a **5xx**.
 *  - **Thrown**, carrying an ADR-0112 envelope — a *refusal*. `delete` does not
 *    swallow those; they leave by the door's `sendThrownError`, where #8016's
 *    mapping answers with the producer's own status and code (a `409
 *    DESTRUCTIVE_CHANGE` stays a 409).
 *
 * ⛔ **It deliberately carries NO message field, and that absence is the
 * design.** `publish` needed `driverFault` because it had a pre-existing
 * `error?: string` limb that was carrying the raw driver line to the wire;
 * this path never had one — the producer returns a bare flag and the door
 * writes its own sentence from the request's own `:id`/`?version=`. Adding a
 * message channel here would CREATE the thing #8131 had to remove there, and
 * it would land on the wire unfiltered: the 5xx withhold (#8086) lives in the
 * door's `sendThrownError`, which a RETURNED failure never reaches at any
 * status (pinned in `package-publish-status-classification.test.ts` §3). No
 * channel, nothing to withhold — see `delete-driver-fault.test.ts` §1, which
 * asserts the returned shape has exactly one key.
 */
export interface PackageDeleteResult {
  success: boolean;
}

export interface PackageService {
  publish(data: { manifest: ObjectStackManifest; metadata: PackageMetadata }): Promise<PackagePublishResult>;
  get(packageId: string, version?: string): Promise<PackageRecord | null>;
  list(): Promise<PackageRecord[]>;
  delete(packageId: string, version?: string): Promise<PackageDeleteResult>;
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
 *
 * [#8275] Now consumed by BOTH swallowing catches in this service — `publish`
 * and `delete`. It stays ONE predicate rather than a second copy next to
 * `delete`: the two catches ask the same question, and the `.code` regression
 * above is exactly the kind a second implementation re-introduces on its own
 * schedule. Each caller's per-dialect pin is in its own suite.
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
 *
 * ⚠️ [#10965] It returns `[]` for EVERYTHING else too, and that is the whole
 * defect this file's seam guard exists for — see {@link isResultSet}. Flatten
 * with this only AFTER the result has been established as an answer.
 */
function normalizeRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

/**
 * ── The seam that ACCEPTS a query but never ANSWERS one (#10965) ───────────
 *
 * {@link normalizeRows} flattens the result-set shapes a raw SELECT comes back
 * as. A seam can hand back one more thing, and it means something else
 * entirely: `null` — "I did not run your query". `InMemoryDriver.execute()` is
 * the measured case; it logs `Raw execution not supported in InMemory driver`
 * and returns `null`. It neither throws nor is absent, so `start()`'s
 * `objectql.execute` shape test is satisfied, and `normalizeRows(null)` is `[]`
 * — which is also what a real driver returns for a SELECT that matched nothing.
 *
 * Both read paths in this service then reported that emptiness as a fact about
 * the data, and unlike its two siblings (#10677 / PR #10788 for
 * `os migrate duplicates`, #10789 / PR #10964 for `backfillSeedTenancy`) what
 * they hand back is a PRODUCT ANSWER a caller acts on:
 *
 *   - `get()` returned `null` ⇒ "this package is not installed".
 *   - `list()` returned `[]`  ⇒ "no packages are installed".
 *
 * Measured on a real booted stack (LiteKernel + ObjectQLPlugin +
 * `InMemoryDriver`), `start()`'s own rehydration reaches `list()`: the three
 * statements it issues (CREATE TABLE, CREATE INDEX, the latest-per-id SELECT)
 * each return `null`, `list()` answers `[]`, and the hydration loop iterates
 * zero times — a SILENT skip, because its only log is behind `hydrated > 0`.
 * Nothing downstream WRITES on that reading (the loop's only write is
 * per-row; `installPackage`/`updatePackage`/`deletePackage` in
 * `metadata-protocol` call `publish`/`delete` unconditionally, never gated on
 * this read), so the blast radius is a silent hydration skip plus two false
 * answers on the HTTP read doors — not a re-install.
 *
 * ⭐ **A seam that cannot ANSWER is absent, not empty.** The separation keys on
 * the only thing that distinguishes them: a driver that answers returns a
 * RESULT SET. Nothing here names a driver, so any host with the same no-op
 * shape is covered without an allowlist to maintain.
 */

/**
 * Is `result` one of the result-set shapes a raw SELECT can come back as?
 *
 * The shapes {@link normalizeRows} accepts, asked as a yes/no: a bare row array
 * (better-sqlite3 through knex, and the mysql2 `[rows, fields]` tuple, which is
 * an array too) and `{ rows }` (pg). An empty result set in any of those
 * spellings is still a result set, and still `true` — that is what keeps a
 * legitimately-empty install answering "not installed" / "nothing installed",
 * and it is the half of this change that stops it being a rename.
 *
 * This cannot lose a row {@link normalizeRows} would have found: every shape it
 * rejects is one that flattener already maps to `[]`, so the only change is
 * "refused as unreadable" replacing "reported as zero rows".
 *
 * ⛔ A LOCAL copy, deliberately. `metadata-protocol` does not publish its own
 * from the package index, the CLI keeps a third for its probes, and
 * `@objectstack/metadata-protocol` is not a dependency of this package at all.
 * Unifying the three is its own decision, not a rider on this fix.
 */
function isResultSet(result: unknown): boolean {
  if (Array.isArray(result)) return true;
  if (typeof result === 'object' && result !== null) {
    return Array.isArray((result as { rows?: unknown }).rows);
  }
  return false;
}

/**
 * [#10965] The caller-facing sentence a read over a non-answering seam gets.
 *
 * Like {@link PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE}, a CONSTANT that
 * interpolates nothing: no driver text, no statement, no table name. It says
 * the one thing a caller can act on — the answer is UNKNOWN, not "no".
 *
 * Exported so the doors and their pins assert the POSITIVE shape rather than
 * the absence of the old empty answer (an absence assertion passes for any
 * rewrite, including a worse one).
 */
export const PACKAGE_SEAM_UNREADABLE_MESSAGE =
  'The package registry could not be read: the storage seam accepted the query but returned no '
  + 'result set. Whether this package is installed is UNKNOWN — this is not an answer of "no".';

/** Brand for the refusal below, so only IT is re-thrown out of the read catches. */
const SEAM_UNREADABLE = Symbol.for('objectstack.service-package.seam-unreadable');

/**
 * [#10965] The refusal a read raises when the seam did not answer.
 *
 * ADR-0112 envelope: a `status` AND a `code`, both declared, so it leaves by
 * the door's shared `errorFromThrown` mapping as the producer's own answer
 * rather than a 500 catch-all. `SERVICE_UNAVAILABLE` / 503 is the standard
 * catalog's own pairing and the spelling `metadata-protocol` already uses for
 * exactly this condition (`metadataStoreUnavailableError`: the store is
 * unreachable, so existence is unknown) — no new code is registered, and
 * nothing in `packages/spec` is touched.
 */
function packageSeamUnreadableError(): Error {
  const err = new Error(PACKAGE_SEAM_UNREADABLE_MESSAGE) as Error & {
    code?: string;
    status?: number;
    [SEAM_UNREADABLE]?: true;
  };
  err.code = 'SERVICE_UNAVAILABLE';
  err.status = 503;
  err[SEAM_UNREADABLE] = true;
  return err;
}

/**
 * [#10965] Is this the seam refusal above?
 *
 * ⛔ Deliberately NOT {@link declaresHttpAnswer}. That predicate asks the much
 * broader "did this throw declare an envelope?", and widening the two READ
 * catches to re-throw every such error would change how this service answers
 * driver faults it has always swallowed — a behaviour change this card did not
 * measure and does not need. Only the refusal this file raises escapes.
 */
function isSeamUnreadable(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as Record<symbol, unknown>)[SEAM_UNREADABLE] === true
  );
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
          // status. `sendError` consults no predicate, so correct
          // classification alone leaves the text on the wire — measured
          // against the POST-#8132 predicate, which recognises
          // `no such table: sys_packages` perfectly and is never asked.
          // A smarter heuristic does not make this redundant; nothing on this
          // path calls one.
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

          // [#10965] Before reading emptiness as a fact, establish that there
          // was an answer to read. A seam that did not run the SELECT hands
          // back no result set, and `normalizeRows` maps that to `[]` — the
          // same value a real driver returns when the package genuinely is not
          // installed. Refusing here is what makes those two distinguishable;
          // a result set with zero rows still falls through to `null` below.
          if (!isResultSet(result)) throw packageSeamUnreadableError();

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
          // [#10965] The seam refusal is the ONE throw this catch must not
          // swallow: swallowing it would restore the exact `null` the refusal
          // exists to replace, and the caller would be back to reading "not
          // installed" off a query that never ran. Everything else keeps the
          // behaviour it has always had.
          if (isSeamUnreadable(error)) {
            logger.error(`Cannot answer whether package '${packageId}' is installed`, error as Error);
            throw error;
          }
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

          // [#10965] Same separation as `get()`: a seam that never ran this
          // SELECT must not be reported as "no packages are installed". An
          // answering seam with zero rows still returns `[]` below.
          if (!isResultSet(result)) throw packageSeamUnreadableError();

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
          // [#10965] As in `get()`: only the seam refusal escapes, because
          // swallowing it would answer "nothing installed" over a driver this
          // method never queried.
          if (isSeamUnreadable(error)) {
            logger.error('Cannot answer which packages are installed', error as Error);
            throw error;
          }
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
          // [#8275] ① The raw driver text goes to the LOG, and only there.
          // Unchanged — it already went here, and nothing about the operator's
          // diagnostics changes.
          logger.error('Failed to delete package', error as Error);

          // ② A throw that DECLARES its own envelope is a REFUSAL, and a
          // refusal is not this method's to swallow. Re-thrown so it leaves by
          // the door's catch-all, where #8016's shared mapping answers it with
          // the producer's own status and code. Swallowing them flattened every
          // coded refusal reachable from this call path into one
          // `400 PACKAGE_DELETE_FAILED`, losing both.
          //
          // ⛔ The discriminant is the **status** channel, never `.code`: every
          // SQL driver populates a string `code` on its errors, so reading it
          // would re-throw genuine driver faults as if they were refusals —
          // straight back into a 500 whose message the leak heuristic does not
          // withhold. `declaresHttpAnswer`'s note carries the full argument and
          // `delete-driver-fault.test.ts` pins it per dialect.
          if (declaresHttpAnswer(error)) throw error;

          // ③ Everything else is a DRIVER FAULT: the `DELETE FROM sys_packages`
          // broke — a missing table, a lock timeout, a foreign-key restriction
          // — and the caller's request was never the problem. The bare flag is
          // all that goes back (see `PackageDeleteResult`: no message channel,
          // deliberately), and the door answers it 5xx.
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
      // [#10965] The measured consequence of the conflation, and the half that
      // made it invisible. `list()` used to answer `[]` over a seam that never
      // ran the SELECT, so this loop iterated zero times and said nothing —
      // its only log sits behind `hydrated > 0`. A durable package was then
      // absent from the registry for the whole process lifetime, with no line
      // anywhere distinguishing that from an environment with no packages.
      //
      // Now `list()` refuses, and the refusal is reported at WARN naming what
      // is unknown. Boot still continues: an unreadable seam must not brick the
      // environment, exactly as a stale package does not (above).
      if (isSeamUnreadable(error)) {
        logger.warn(
          'Package hydration from sys_packages SKIPPED — the storage seam accepted the query but '
          + 'returned no result set, so durable packages could NOT be read. Any package persisted in '
          + 'sys_packages is absent from the registry for this process. This is not "no packages installed".',
        );
      } else {
        logger.debug(`Package hydration from sys_packages skipped: ${(error as Error)?.message}`);
      }
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
