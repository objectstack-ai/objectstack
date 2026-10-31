// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 35] The environment's own `sys_metadata` rows (ADR-0131
 * D6/D7), from `ObjectStackProtocolImplementation`, moved out of
 * `protocol.ts` whole:
 *
 *  - `findEnvironmentRows` — the family read, without a legacy
 *    organization's rows;
 *  - `findEnvironmentRow` — the same for one row;
 *  - `findServedOverlayRow` — the stored row a by-name read serves;
 *  - `packagelessAddress` — the package a write that names none addresses.
 *
 * [#28238] Beside them, `packagelessContentPackage`: the package a by-name
 * read that names none takes its stored content from, given that address and
 * the code packages that ship the name. Not a moved body: the rule the two
 * by-name reads share.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link EnvironmentRowsHost} members it reads, plus a `.call`. The `engine`
 * field is handed over as a getter, so each read reaches the class field as
 * it stands at call time; each call to another member is a closure, so it
 * still reaches the class method.
 * Every caller keeps calling the class methods.
 *
 * The read-seam census follows both directions of this shape (its
 * `HOST_SPLIT` note in `scripts/check-durability-degradation-log-level.mjs`),
 * so the storage reads below are still counted as the seams they were.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import type { StoredOverlayRow } from './item-lock.js';
import { overlayMemberWhere } from './migrations/overlay-index.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { rowMatchesOverlayWhere, servedOverlayRowCandidates } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface EnvironmentRowsHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly findEnvironmentRow: ObjectStackProtocolImplementation['findEnvironmentRow'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly legacyOrganizationRowsOf: ObjectStackProtocolImplementation['legacyOrganizationRowsOf'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    readonly withoutLegacyOrganizationRows: ObjectStackProtocolImplementation['withoutLegacyOrganizationRows'];
}

/** The body of `ObjectStackProtocolImplementation#findEnvironmentRows`; the method's docblock there is its contract. */
export async function findEnvironmentRows(this: Pick<EnvironmentRowsHost, 'engine' | 'legacyOrganizationRowsOf' | 'withoutLegacyOrganizationRows'>, table: string, query: { where: Record<string, unknown>; context?: unknown; [key: string]: unknown }): Promise<any[]> {
    const rows = (await this.engine.find(table, query as never)) as any[] | null | undefined;
    if (query.limit === undefined && query.offset === undefined) {
        return this.withoutLegacyOrganizationRows(table, rows, query.context);
    }
    // An offset counts rows before the page, so any legacy row can shift
    // it; a limit alone, only one the page itself holds.
    if ((!rows || rows.length === 0) && query.offset === undefined) return rows ?? [];
    const legacy = await this.legacyOrganizationRowsOf(table, query.context);
    if (legacy.size === 0) return rows ?? [];
    if (query.offset === undefined && !(rows ?? []).some((row) => legacy.has(String(row?.id)))) return rows ?? [];
    const where = { $and: [query.where, { id: { $nin: [...legacy.keys()] } }] };
    return ((await this.engine.find(table, { ...query, where } as never)) as any[] | null | undefined) ?? [];
}

/** The body of `ObjectStackProtocolImplementation#findEnvironmentRow`; the method's docblock there is its contract. */
export async function findEnvironmentRow(this: Pick<EnvironmentRowsHost, 'engine' | 'legacyOrganizationRowsOf'>, table: string, query: { where: Record<string, unknown>; context?: unknown; [key: string]: unknown }): Promise<any> {
    const row = await this.engine.findOne(table, query as never);
    if (!row) return row ?? null;
    const legacy = await this.legacyOrganizationRowsOf(table, query.context);
    if (!legacy.has(String((row as { id?: unknown }).id))) return row;
    const rows = (await this.engine.find(table, query as never)) as any[] | null | undefined;
    return (rows ?? []).find((r) => !legacy.has(String(r?.id))) ?? null;
}

/** The body of `ObjectStackProtocolImplementation#findServedOverlayRow`; the method's docblock there is its contract. */
export async function findServedOverlayRow(
    this: Pick<EnvironmentRowsHost, 'findEnvironmentRow'>,
    args: {
    type: string;
    name: string;
    state: 'active' | 'draft';
    /** [#23715] `null`: the package-unbound row alone (see {@link servedOverlayRowCandidates}). */
    packageId?: string | null;
    /** [#22877] The bundle member a by-name door's selector named; omitted, the canonical one. */
    member?: string;
},
    activeRows?: readonly StoredOverlayRow[],
): Promise<{ row: any } | undefined> {
    // [#21804] The order is {@link servedOverlayRowCandidates}, the one
    // the list's merge takes over the rows it read: the canonical
    // spelling then the other, and within each, the package's
    // own row then the package-less row (never another package's, or a
    // collision would serve package B's customization for a package A
    // read); with no package context (legacy/runtime reader), any row.
    const other = PLURAL_TO_SINGULAR[args.type] ?? SINGULAR_TO_PLURAL[args.type];
    for (const candidate of servedOverlayRowCandidates({ packageId: args.packageId })) {
        const type = candidate.spelling === 'canonical' ? args.type : other;
        if (type === undefined) continue;
        const where: Record<string, unknown> = {
            type, name: args.name, state: args.state,
            // [#22877] A by-name read of a bundled type answers the member
            // its selector named, else its CANONICAL member, as the
            // registry's bare-name read does; nothing for every other type.
            ...overlayMemberWhere(type, args.member),
        };
        if (candidate.packageId !== undefined) where.package_id = candidate.packageId;
        // [#21911, ADR-0096] The explicit system opt-in: a platform store
        // read, which no caller's grants scope — the door that asked
        // already authorized the caller, and the protocol scopes the row
        // itself ({@link findEnvironmentRow}: the environment's rows only).
        // It no longer reaches the data engine as a principal-less context.
        const row = activeRows !== undefined && args.state === 'active'
            ? activeRows.find((stored) => rowMatchesOverlayWhere(stored, where))
            : await this.findEnvironmentRow('sys_metadata', { where, context: { isSystem: true } });
        if (row) return { row };
    }
    return undefined;
}

/** The body of `ObjectStackProtocolImplementation#packagelessAddress`; the method's docblock there is its contract. */
export async function packagelessAddress(
    this: Pick<EnvironmentRowsHost, 'findEnvironmentRows' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    type: string,
    name: string,
    member?: string,
    state: 'active' | 'draft' = 'active',
    activeRows?: readonly StoredOverlayRow[],
): Promise<{ packageId: string | null; candidates: readonly string[]; unbound: boolean }> {
    let rows: Array<{ package_id?: unknown }> | null | undefined;
    const where = { type, name, state, ...overlayMemberWhere(type, member) };
    try {
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        rows = activeRows !== undefined && state === 'active'
            ? activeRows.filter((row) => rowMatchesOverlayWhere(row, where))
            : await this.findEnvironmentRows('sys_metadata', { where, context: { isSystem: true } });
    } catch (error) {
        // [#5532] An unprovisioned store holds no row, so no binding; any
        // other failure is a read that did not happen, never "no binding".
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    const bindings = new Set<string>();
    let unbound = false;
    for (const row of rows ?? []) {
        if (typeof row?.package_id === 'string' && row.package_id !== '') bindings.add(row.package_id);
        else unbound = true;
    }
    const candidates = [...bindings].sort();
    return { packageId: candidates.length === 1 ? candidates[0] ?? null : null, candidates, unbound };
}

/**
 * [#28238, ADR-0048 §3.3] The package a by-name read that names no package
 * takes its stored CONTENT from: {@link findServedOverlayRow}'s `packageId`
 * for {@link ObjectStackProtocolImplementation.getMetaItem} and
 * {@link ObjectStackProtocolImplementation.getMetaItemLayered}, so the plain
 * read and the layered read's `effective` serve one row.
 *
 * `address` is the item's package-less write address
 * ({@link packagelessAddress}, at `active`); `shipped` is every artifact an
 * installed code package registered under the name
 * (`ObjectStackProtocolImplementation#shippedArtifactsOf`). The code packages
 * that ship the name are candidates of the address beside the stored rows'
 * bindings:
 *
 *  - no code package ships the name, or the one package the stored rows are
 *    bound to ships it: the write address's package, as before (#23291) —
 *    else `undefined`, any row, the best-effort first match;
 *  - exactly one code package ships it: that package. Its own stored row,
 *    else the package-unbound row (ADR-0005), else its code item. A row bound
 *    to another package, the only stored row of a dependent package that saved
 *    the same name, is never served for it: that row stood in for the base's
 *    item on every read naming no package and in the base's own app;
 *  - several ship it, and no stored row is bound to one of them: `null`, the
 *    package-unbound row alone, else the code item the registry answers;
 *    several ship it and a row is bound to one: `undefined`, as before.
 *
 * Content only, and the read's alone. The write address does not move: a
 * save, a delete and the read's `version` still resolve
 * {@link packagelessAddress}'s `packageId`.
 */
export function packagelessContentPackage(
    address: { readonly packageId: string | null; readonly candidates: readonly string[] },
    shipped: readonly unknown[],
): string | null | undefined {
    const shippers = new Set<string>();
    for (const artifact of shipped) {
        const id = (artifact as { _packageId?: unknown } | null | undefined)?._packageId;
        if (typeof id === 'string' && id !== '' && id !== 'sys_metadata') shippers.add(id);
    }
    if (shippers.size === 0 || (address.packageId !== null && shippers.has(address.packageId))) {
        return address.packageId ?? undefined;
    }
    if (shippers.size === 1) return [...shippers][0];
    return address.candidates.some((id) => shippers.has(id)) ? undefined : null;
}
