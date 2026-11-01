// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 16] The stored-overlay row reads of
 * `ObjectStackProtocolImplementation`: a type's active `sys_metadata` rows
 * through the cross-request overlay cache (`readActiveOverlayRows`), each row
 * parsed as the list read parses it (`storedOverlayEntries`), the names that
 * have a stored row of their own (`namesWithOwnStoredRow`), and one item's
 * active rows (`readItemActiveRows`), moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, the same
 * cache key, epoch and TTL readings in the same order, and the same parse.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link StoredOverlayReadHost} members that method reads, plus a
 * `.call`. The engine is handed over as a getter, so the body reads the
 * protocol's engine at call time (the overlay cache keys its bucket on it); a
 * method is handed over as a closure that calls it on the protocol at call
 * time, so a test double or spy set on the instance is still the one the body
 * reaches. `namesWithOwnStoredRow` reads no member at all, so its method calls
 * it directly, as `orderByFieldNames` does (cut 3). Every other reader of
 * these four methods, `protocol-save-door-refusals.ts` among them, keeps
 * calling the class method.
 *
 * What the bodies read of `protocol.ts`'s own module-level declarations they
 * import from it; what they import from elsewhere, they import from where
 * `protocol.ts` imported it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import type { StoredOverlayRow } from './item-lock.js';
import {
    metaOverlayCacheTtlMs,
    readMetaOverlayCache,
    readOverlayCacheGeneration,
    writeMetaOverlayCache,
    type MetaOverlayCacheKey,
} from './meta-overlay-cache.js';
import type { ObjectStackProtocolImplementation, StoredOverlayEntry } from './protocol.js';
import { addressPackages } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface StoredOverlayReadHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    convertStoredItem: ObjectStackProtocolImplementation['convertStoredItem'];
}

/** The body of `ObjectStackProtocolImplementation#readActiveOverlayRows`; the method's docblock there is its contract. */
export async function readActiveOverlayRows(
    this: Pick<StoredOverlayReadHost, 'engine' | 'findEnvironmentRows'>,
    request: { type: string; packageId?: string },
): Promise<any[]> {
    const { packageId } = request;
    const queryActive = async (): Promise<any[]> => {
        const whereClause: Record<string, unknown> = {
            type: request.type,
            state: 'active',
        };
        if (packageId) whereClause.package_id = packageId;
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        // [ADR-0131 D6/D7] The environment's rows only, on every find —
        // see {@link findEnvironmentRows}.
        let rs = await this.findEnvironmentRows('sys_metadata', { where: whereClause, context: { isSystem: true } });
        if ((!rs || rs.length === 0)) {
            const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
            if (alt) {
                const altWhere: Record<string, unknown> = { type: alt, state: 'active' };
                if (packageId) altWhere.package_id = packageId;
                rs = await this.findEnvironmentRows('sys_metadata', { where: altWhere, context: { isSystem: true } });
            }
        }
        return rs ?? [];
    };
    // ── Leg D of #11633 (#11967): the cross-request overlay cache ──
    //
    // ⭐ The cache sits HERE, and its position IS the resolution of the
    // SchemaRegistry-hydration trap #11633 §4 names. What is cached is
    // the ROW SET — the value the `queryActive` call produces —
    // never the merged answer below it. Everything downstream of this
    // point still runs on every call, hit or miss: the overlay parse,
    // the package-aware merge, `hydrateOverlayIntoRegistry`, the
    // MetadataService merge, the disabled-package filter, the nav
    // contributions, the decorations. A hit changes where the rows came
    // from and nothing about what is done with them, so the read-side
    // registry hydration cannot be skipped by one.
    //
    // ⛔ Do NOT move this below the merge. That is precisely the naive
    // shape the trap describes, and it would additionally serve three
    // mutable sources — the SchemaRegistry, the MetadataService and the
    // artifact table — whose changes nothing in this key can observe.
    // See `meta-overlay-cache.ts` for the measured four-source table.
    //
    // ⭐ The epoch reading is taken BEFORE the read, and it is this
    // pre-read value that is stored with the rows. A write landing
    // WHILE this read is in flight therefore moves the epoch past what
    // the entry records, so the entry is already dead when it is
    // written — the safe direction. Reading it afterwards would stamp
    // pre-write rows with a post-write epoch and make that staleness
    // permanent: the clear-then-repopulate-from-a-stale-read failure
    // #11633 §7 pin 2 names.
    const overlayCacheKey: MetaOverlayCacheKey = {
        type: request.type,
        packageId,
    };
    const overlayCacheTtlMs = metaOverlayCacheTtlMs();
    const overlayCacheEpoch = overlayCacheTtlMs > 0 ? readOverlayCacheGeneration(this.engine) : undefined;
    const overlayCacheNow = Date.now();
    const cachedRecords = readMetaOverlayCache(
        this.engine, overlayCacheKey, overlayCacheEpoch, overlayCacheTtlMs, overlayCacheNow,
    );

    let records: any[];
    if (cachedRecords !== undefined) {
        records = cachedRecords as any[];
    } else {
        records = await queryActive();
        // ⭐ An EMPTY row set is cached too, and that is the main point
        // rather than an edge case: the empty result is what triggers the
        // alt-type retry above, so "no overlay rows for this type" is the
        // answer whose caching removes BOTH reads. #11633 §1 measured that
        // an app whose objects are all code-authored pays the doubled read
        // on every request; this is the line that stops it.
        writeMetaOverlayCache(
            this.engine, overlayCacheKey, overlayCacheEpoch, records, overlayCacheTtlMs, overlayCacheNow,
        );
    }
    return records;
}

/** The body of `ObjectStackProtocolImplementation#storedOverlayEntries`; the method's docblock there is its contract. */
export function storedOverlayEntries(
    this: Pick<StoredOverlayReadHost, 'convertStoredItem'>,
    request: { type: string },
    records: any[],
): StoredOverlayEntry[] {
    // Parse each overlay body once — replaying the stored-row
    // conversion chain (#3903) so every consumer of this list sees
    // the canonical protocol shape — and surface its persisted
    // software-package binding so the sidebar package filter and
    // provenance classification see overlay rows the way they see
    // registry items.
    return records.map((record) => {
        const parsed = this.convertStoredItem(
            String(record.type ?? request.type),
            typeof record.metadata === 'string'
                ? JSON.parse(record.metadata)
                : record.metadata,
        ) as any;
        const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
        // [#28594] The row's package is its COLUMN's, and only the column's: a
        // `_packageId` the stored body carries is not served (dropped when the
        // row is bound to no package, replaced when it is bound to another).
        // The save door already strips a body's stamp (`stripDerivedProvenance`
        // in `protocol.ts`: the server states provenance, a caller never does),
        // but a row at rest can still carry one, and every reader of this list
        // asks an item's owner of `_packageId` — the connector materializer
        // deciding whose root a file ref reads among them. A copy, so a cached
        // row's body is never written.
        let data = parsed;
        if (data && typeof data === 'object' && !Array.isArray(data) && (data as any)._packageId !== recPkg) {
            const bound: Record<string, unknown> = { ...(data as Record<string, unknown>) };
            if (recPkg) bound._packageId = recPkg;
            else delete bound._packageId;
            data = bound;
        }
        // [ADR-0131 D6/D7] Every row is the environment's: the family
        // declares no organization column, and the reads that feed this
        // ({@link readActiveOverlayRows}) leave a legacy organization's
        // rows out off the physical column. (The form doors' legacy layer
        // that once needed the row's own scope here is deleted.)
        return {
            name: String(record.name), data, packageId: recPkg, organizationId: null,
            type: String(record.type ?? request.type),
        };
    });
}

/** The body of `ObjectStackProtocolImplementation#namesWithOwnStoredRow`; the method's docblock there is its contract. */
export function namesWithOwnStoredRow(records: readonly any[], packageId?: string): ReadonlySet<string> {
    const packages = addressPackages(packageId);
    const names = new Set<string>();
    for (const record of records) {
        if (typeof record?.name !== 'string') continue;
        if (packages.some((pkg) => pkg === undefined || (record?.package_id ?? null) === pkg)) names.add(record.name);
    }
    return names;
}

/** The body of `ObjectStackProtocolImplementation#readItemActiveRows`; the method's docblock there is its contract. */
export async function readItemActiveRows(
    this: Pick<StoredOverlayReadHost, 'engine' | 'findEnvironmentRows'>,
    type: string, name: string, cached = false,
): Promise<StoredOverlayRow[]> {
    const other = PLURAL_TO_SINGULAR[type] ?? SINGULAR_TO_PLURAL[type];
    const read = async (): Promise<StoredOverlayRow[]> => {
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        const rows: StoredOverlayRow[] | null | undefined = await this.findEnvironmentRows('sys_metadata', {
            where: { type: other === undefined ? type : { $in: [type, other] }, name, state: 'active' },
            context: { isSystem: true },
        });
        return rows ?? [];
    };
    if (!cached) return read();
    // ⭐ The epoch is read BEFORE the read and stored with its rows, as the
    // list read's is (see `readActiveOverlayRows`): a write landing while
    // this read is in flight leaves the entry dead on arrival.
    const key: MetaOverlayCacheKey = { type, name };
    const ttlMs = metaOverlayCacheTtlMs();
    const epoch = ttlMs > 0 ? readOverlayCacheGeneration(this.engine) : undefined;
    const now = Date.now();
    const hit = readMetaOverlayCache(this.engine, key, epoch, ttlMs, now);
    if (hit !== undefined) return hit as StoredOverlayRow[];
    const rows = await read();
    writeMetaOverlayCache(this.engine, key, epoch, rows, ttlMs, now);
    return rows;
}
