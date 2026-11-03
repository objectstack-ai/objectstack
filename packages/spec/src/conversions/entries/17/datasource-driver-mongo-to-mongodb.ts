// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `datasource-driver-mongo-to-mongodb` conversion
// (`toMajor: 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `datasourceDriverMongoToMongodb` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapDatasources } from '../../walk.js';

/**
 * All conversions, keyed by the protocol major that introduced the canonical
 * shape. Newest majors last; ordering within a major is application order.
 */

/**
 * `datasource.driver: 'mongo'` → `'mongodb'` (protocol 17, commit e2798fab7;
 * retired from the load path at 18, #23543 F1).
 *
 * ## Why a stored value has to move at all
 *
 * `mongo` and `mongodb` were both accepted spellings from #4410 through 17 —
 * this conversion never rescued a broken boot, and a stored row it has not
 * reached still resolves the same contract and builds the same driver. What moved is the
 * CANONICAL id: commit e2798fab7 landed the ruling that renamed it to `mongodb`, the spelling both boot
 * hosts, the driver package (`@objectstack/driver-mongodb`) and every URL scheme
 * already used, so that the id which selects a driver and the id which selects
 * its config contract are one string with no mapping layer between them.
 *
 * That rename is visible in data because the canonical id is PUBLISHED as
 * `DRIVER_CATALOG.id` (`@objectstack/service-datasource`), documented as "used
 * as `datasource.driver`" — it is literally what Studio's connection form writes
 * into a datasource row. After the rename the form emits `mongodb`, while every
 * row written before it carries `mongo`. Left alone, one deployment's datasource
 * list holds two spellings of one driver, and any surface that matches a stored
 * `driver` against the published catalog id (a form pre-selecting the current
 * driver, a grouped list, an equality filter) silently fails to match the older
 * rows. So the stored value converges here rather than each reader learning to
 * accept both.
 *
 * ## Why the data repair is D2
 *
 * There is a concrete stored value with a lossless, behaviour-preserving
 * rewrite, which is the D2 test exactly. `mongo` and `mongodb` resolve to the
 * same contract and build the same driver, before and after, so replaying this
 * cannot change where any data lives — contrast the retired
 * `datasource-config-driver-key-aliases` (#25767), whose scope guard existed
 * because rewriting a sqlite `path:` WOULD have moved a database.
 *
 * Losslessness decides only that the data repair is D2. It does not decide
 * whether the family ALSO owes a D3 entry — every retirement family does
 * (`SemanticMigration`, `migrations/types.ts`). The rename into protocol 17
 * shipped before that rule and was not back-filled; the value's retirement at
 * 18 is a family of its own, and its D3 entry is
 * `datasource-driver-mongo-alias-retired`.
 *
 * ## Retired from the load path at 18 (#23543, ruling F1 A)
 *
 * Through 17 it stayed live because `mongo` was still a legal alias, so there
 * was no refusal for a retirement to hand the author to (the verdict #23487
 * recorded). The ruling retired the value: `mongo` left the selection face, and
 * `DriverType` refuses an authored `datasource.driver: 'mongo'` by name with
 * the prescription naming `mongodb` (`DriverVocabularyEntry.retiredAliases`,
 * `data/driver/config-registry.zod.ts`). So the authoring funnel no longer
 * replays this entry, and an author is taught the canonical id instead of
 * being rewritten. Stored rows are the `includeRetired` seams: stored-row
 * rehydration (`applyConversionsToStoredItem`) and the artifact door still
 * rewrite them, and `os migrate meta --from 16` lists the edit for existing
 * sources, as step 17's mechanical member. The spelling keeps resolving the
 * mongodb CONTRACT, which is what let the retired
 * `datasource-config-driver-key-aliases` — ordered ahead of this entry while
 * it existed (#25767) — reach a stored `driver: 'mongo'` row's legacy config
 * keys. That D3
 * entry names what the chain cannot reach: an environment variable, a REST
 * caller, a script.
 */
const datasourceDriverMongoToMongodb: MetadataConversion = {
  id: 'datasource-driver-mongo-to-mongodb',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'datasource.driver',
  summary:
    "datasource driver id 'mongo' → 'mongodb' — the canonical id both boot hosts, the driver "
    + 'package and the published DRIVER_CATALOG already used, so the id that selects a driver '
    + 'and the id that selects its config contract are one string with no mapping between them',
  apply(stack, emit) {
    return mapDatasources(stack, (ds, path) => {
      // Only the exact legacy canon, trimmed and lower-cased the same way
      // `resolveDriverId` reads it. `mongodb` is already canonical, and any other
      // spelling (a plugin driver, a typo) is not this conversion's business.
      if (typeof ds.driver !== 'string' || ds.driver.trim().toLowerCase() !== 'mongo') return ds;
      emit({ from: 'mongo', to: 'mongodb', path: `${path}.driver` });
      return { ...ds, driver: 'mongodb' };
    });
  },
  fixture: {
    before: {
      datasources: [
        { name: 'events', driver: 'mongo', config: { url: 'mongodb://mongo.internal:27017/events' } },
        // Already canonical — untouched, and emits nothing.
        { name: 'audit', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/audit' } },
        // A different driver whose id merely CONTAINS the string: never rewritten.
        { name: 'cache', driver: 'com.vendor.mongolike', config: { url: 'x://y' } },
      ],
    },
    after: {
      datasources: [
        { name: 'events', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/events' } },
        { name: 'audit', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/audit' } },
        { name: 'cache', driver: 'com.vendor.mongolike', config: { url: 'x://y' } },
      ],
    },
    expectedNotices: 1,
  },
};

export { datasourceDriverMongoToMongodb };
