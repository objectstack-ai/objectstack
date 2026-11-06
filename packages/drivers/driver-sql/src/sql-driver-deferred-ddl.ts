// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Deferred schema DDL (#3917)" section of `SqlDriver`:
 * the bodies of `setDeferredDdl`, `getSchemaSyncStats`,
 * `flushDeferredSchemaDdl` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link DeferredDdlFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link DeferredDdlHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `deferredDdlHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { isRefusedSchemaWork, type PendingSchemaWork } from './schema-drift.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link DeferredDdlFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface DeferredDdlHost {
  deferredDdl: SqlDriver['deferredDdl'];
  readonly deferredSchemaObjects: SqlDriver['deferredSchemaObjects'];
  flushingDeferredDdl: SqlDriver['flushingDeferredDdl'];
  initObjects: SqlDriver['initObjects'];
  previewDeferredSchemaWork: SqlDriver['previewDeferredSchemaWork'];
  readonly tablesCreatedHere: SqlDriver['tablesCreatedHere'];
  readonly tablesFoundExisting: SqlDriver['tablesFoundExisting'];
}

/** The bodies of the "Deferred schema DDL (#3917)" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class DeferredDdlFacet {
  /** The body of `SqlDriver#setDeferredDdl`; the method's docblock there is its contract. */
  static setDeferredDdl(this: Pick<DeferredDdlHost, 'deferredDdl'>, deferred: boolean): void {
    this.deferredDdl = deferred;
  }

  /** The body of `SqlDriver#getSchemaSyncStats`; the method's docblock there is its contract. */
  static getSchemaSyncStats(this: Pick<DeferredDdlHost, 'tablesCreatedHere' | 'tablesFoundExisting'>): { created: number; existing: number } {
    return { created: this.tablesCreatedHere.size, existing: this.tablesFoundExisting.size };
  }

  /** The body of `SqlDriver#flushDeferredSchemaDdl`; the method's docblock there is its contract. */
  static async flushDeferredSchemaDdl(this: Pick<DeferredDdlHost, 'deferredDdl' | 'deferredSchemaObjects' | 'flushingDeferredDdl' | 'initObjects' | 'previewDeferredSchemaWork'>): Promise<PendingSchemaWork[]> {
    const pending = [...this.deferredSchemaObjects.values()];
    if (pending.length === 0) {
      this.deferredDdl = false;
      return [];
    }
    const performed = await this.previewDeferredSchemaWork();
    // [#30636] A table the preview refused (`refuse_table`: keyed by `_id`, no
    // `id`, holding rows) is left out of the re-entry below, so its refusal
    // stops nothing: every other deferred object still gets its DDL, and the
    // refusal comes back as its entry in the returned list rather than as a
    // throw that took that list with it. The entry stays in that list: the
    // caller reports it, and a refused table is never read as performed work.
    // The sync's own refusal (`initObjects`) still guards the rows should the
    // table fill between the preview and the DDL.
    const refused = new Set(performed.filter((w) => isRefusedSchemaWork(w.kind)).map((w) => w.table));
    this.deferredSchemaObjects.clear();
    this.deferredDdl = false;
    // Re-entering initObjects re-registers the same metadata (idempotent) and
    // this time takes the DDL path, so create/alter/index/rotation handling
    // stays in exactly one place.
    //
    // #9354: armed across that re-entry, and cleared in a `finally` so a refusal
    // thrown out of the widening cannot leave the flag set on a driver the
    // caller goes on using (`os migrate apply` keeps the stack alive to shut it
    // down). It is the only thing distinguishing this path from boot sync.
    this.flushingDeferredDdl = true;
    try {
      await this.initObjects(refused.size === 0 ? pending : pending.filter((obj) => !refused.has(obj.name)));
    } finally {
      this.flushingDeferredDdl = false;
    }
    return performed;
  }
}
