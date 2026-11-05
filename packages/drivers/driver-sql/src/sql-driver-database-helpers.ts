// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Database helpers" section of `SqlDriver`: the bodies of
 * `sqliteFilename`, `setFileColumnsMovedResolver`,
 * `setTenantKeyCertifiedResolver`, `isTenantKeyCertified`,
 * `resolveFileColumnsMoved`, `mediaColumnIsJson`, `isJsonField` moved out of
 * `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link DatabaseHelpersFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link DatabaseHelpersHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `databaseHelpersHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * Values that stayed in `sql-driver.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import { PRE_DDL_QUESTION_SCOPE, isMultiValuedColumn } from './sql-driver-top-level.js';
import { JSON_COLUMN_TYPES } from './sql-driver.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link DatabaseHelpersFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface DatabaseHelpersHost {
  readonly config: SqlDriver['config'];
  fileColumnsMoved: SqlDriver['fileColumnsMoved'];
  fileColumnsMovedAsked: SqlDriver['fileColumnsMovedAsked'];
  readonly fileColumnsMovedDeclared: SqlDriver['fileColumnsMovedDeclared'];
  fileColumnsMovedResolver: SqlDriver['fileColumnsMovedResolver'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly logger: SqlDriver['logger'];
  mediaColumnIsJson: SqlDriver['mediaColumnIsJson'];
  readonly openedEmptyInMemory: SqlDriver['openedEmptyInMemory'];
  tenantKeyCertified: SqlDriver['tenantKeyCertified'];
  tenantKeyCertifiedReadFailureReported: SqlDriver['tenantKeyCertifiedReadFailureReported'];
  tenantKeyCertifiedResolver: SqlDriver['tenantKeyCertifiedResolver'];
}

/** The bodies of the "Database helpers" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class DatabaseHelpersFacet {
  /** The body of `SqlDriver#sqliteFilename`; the method's docblock there is its contract. */
  static sqliteFilename(this: Pick<DatabaseHelpersHost, 'config' | 'isSqlite' | 'openedEmptyInMemory'>): string | null {
    if (!this.isSqlite) return null;
    // Redirected to `:memory:` because the declared file did not exist and the
    // host asked not to create one (#6743). `this.config` still names the
    // declared target — on purpose, so the CLI can print it — but NO on-disk
    // file backs this connection, which is precisely what this method reports.
    // Both callers depend on that reading: `ensureDatabaseExists` would
    // otherwise `mkdir` the state directory this mode exists to avoid, and
    // `applySqliteJournalMode` would try to put an in-memory database in WAL.
    if (this.openedEmptyInMemory) return null;
    const conn = (this.config as any).connection;
    const filename = typeof conn === 'string' ? conn : conn?.filename;
    if (typeof filename !== 'string' || filename === '') return null;
    return filename.startsWith(':') ? null : filename;
  }

  /** The body of `SqlDriver#setFileColumnsMovedResolver`; the method's docblock there is its contract. */
  static setFileColumnsMovedResolver(this: Pick<DatabaseHelpersHost, 'fileColumnsMovedAsked' | 'fileColumnsMovedDeclared' | 'fileColumnsMovedResolver'>, resolve: () => boolean | Promise<boolean>): boolean {
    if (this.fileColumnsMovedDeclared) return false;
    if (this.fileColumnsMovedAsked) return false;
    this.fileColumnsMovedResolver = resolve;
    return true;
  }

  /** The body of `SqlDriver#setTenantKeyCertifiedResolver`; the method's docblock there is its contract. */
  static setTenantKeyCertifiedResolver(this: Pick<DatabaseHelpersHost, 'tenantKeyCertified' | 'tenantKeyCertifiedResolver'>, resolve: () => boolean | Promise<boolean>): void {
    this.tenantKeyCertifiedResolver = resolve;
    this.tenantKeyCertified = undefined;
  }

  /** The body of `SqlDriver#isTenantKeyCertified`; the method's docblock there is its contract. */
  static async isTenantKeyCertified(this: Pick<DatabaseHelpersHost, 'logger' | 'tenantKeyCertified' | 'tenantKeyCertifiedReadFailureReported' | 'tenantKeyCertifiedResolver'>): Promise<boolean> {
    if (this.tenantKeyCertified) return true;
    const resolver = this.tenantKeyCertifiedResolver;
    if (!resolver) return false;
    try {
      // Asked inside the pre-DDL scope: a store whose ledger does not exist
      // yet answers with a refused read, which is not a fault (see
      // {@link PRE_DDL_QUESTION_SCOPE}).
      if ((await PRE_DDL_QUESTION_SCOPE.run(true, resolver)) !== true) return false;
    } catch (e: any) {
      // Not knowing reads as "not certified": the forms stay distinct and an
      // 18.0 index is reported as a destructive recreate_index, which nothing
      // applies unattended (safe-only boot reconcile, the artifact gate,
      // `--allow-destructive`). Said once, so that report is not taken for a
      // verdict on a certified store.
      if (!this.tenantKeyCertifiedReadFailureReported) {
        this.tenantKeyCertifiedReadFailureReported = true;
        this.logger.warn(
          `[schema-drift] could not read whether this database is certified for the organization-ownership shape ` +
            `(${e?.message ?? e}); an index keyed COALESCE(<tenant>, …) on a nullable tenant column is compared ` +
            `as a different constraint from the plain key until it can be read.`,
        );
      }
      return false;
    }
    this.tenantKeyCertified = true;
    return true;
  }

  /** The body of `SqlDriver#resolveFileColumnsMoved`; the method's docblock there is its contract. */
  static async resolveFileColumnsMoved(this: Pick<DatabaseHelpersHost, 'fileColumnsMoved' | 'fileColumnsMovedAsked' | 'fileColumnsMovedResolver'>): Promise<void> {
    const resolver = this.fileColumnsMovedResolver;
    if (!resolver) {
      // A driver with nothing to ask has still settled its arm: `false`, the
      // JSON encoding, which is what it will keep for the rest of its life.
      // Recorded so a resolver supplied AFTER the first `initObjects` is
      // refused rather than silently changing an already-frozen answer.
      this.fileColumnsMovedAsked = true;
      return;
    }
    this.fileColumnsMovedAsked = true;
    this.fileColumnsMovedResolver = undefined;
    try {
      // [#20768] Asked inside the pre-DDL scope. On a new database the ledger
      // the resolver reads does not exist yet, and that refusal is not a
      // fault. The answer is unchanged — see {@link PRE_DDL_QUESTION_SCOPE}.
      this.fileColumnsMoved = (await PRE_DDL_QUESTION_SCOPE.run(true, resolver)) === true;
    } catch {
      this.fileColumnsMoved = false;
    }
  }

  /** The body of `SqlDriver#mediaColumnIsJson`; the method's docblock there is its contract. */
  static mediaColumnIsJson(this: Pick<DatabaseHelpersHost, 'fileColumnsMoved'>): boolean {
    return !this.fileColumnsMoved;
  }

  /** The body of `SqlDriver#isJsonField`; the method's docblock there is its contract. */
  static isJsonField(this: Pick<DatabaseHelpersHost, 'mediaColumnIsJson'>, type: string, field: any): boolean {
    if (!isMultiValuedColumn(type, field) && FILE_REFERENCE_TYPES.has(type)) return this.mediaColumnIsJson();
    return JSON_COLUMN_TYPES.has(type) || isMultiValuedColumn(type, field);
  }
}
