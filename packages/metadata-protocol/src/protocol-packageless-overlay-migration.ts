// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Package-less overlay rows become declared overrides (ADR-0146 D11, N-16a)
 *
 * Before ADR-0146, a Setup "customize" of a view, dashboard, report,
 * translation or email template a code package ships was stored as a
 * `sys_metadata` row bound to no package (`package_id` NULL, ADR-0005's
 * environment layer, open for the five `allowEnvironmentOverlay` types). Such
 * a row never exports and never reaches another environment. ADR-0146 D11
 * moves each one into the base's paired `<base>.custom` package as a DECLARED
 * override — `overrides: { package: <base>, basedOn: <base manifest.version> }`
 * (D2, as amended by #28486) — on the administrator's command: the
 * `os migrate packageless-overlays` ceremony (`@objectstack/cli`), which calls
 * {@link listPackagelessOverlays} and {@link migratePackagelessOverlays}.
 * ⛔ Not a boot step.
 *
 * ## The population, and what is left alone
 *
 * Every environment row (a legacy organization's rows are left out,
 * {@link ObjectStackProtocolImplementation.findEnvironmentRows}) of one of the
 * five overlay types, either spelling, `active` or `draft`, bound to no package.
 * Each is classified against the code packages that ship its name — the
 * protocol's own reading (`shippedArtifactsOf`, the one the by-name reads and
 * the write gate take), ⛔ never a second one:
 *
 *  - `environment` — no package ships the name: environment metadata, not an
 *    overlay (ADR-0146 D11; ADR-0070 D5 keeps its own treatment). Not listed.
 *  - `multi_shipped` — several packages ship it: listed for the administrator,
 *    never guessed.
 *  - `no_pair` — the one package that ships it has an id no pair can be
 *    formed from (`pairOf` refuses it): listed, not moved.
 *
 * "Ships" counts read-only code packages only, as the write gate does: a
 * writable package's item is edited in place (ADR-0070), and the pair itself
 * is writable.
 *  - `cannot_declare` (#30261) — the body's shape cannot carry the override
 *    declaration: the schema the save door judges it by refuses an `overrides`
 *    key on it ({@link overrideDeclarationRefusedByShape}). Of the five overlay
 *    types, that is a view CONTAINER (`list` / `listViews` / `form` /
 *    `formViews`): only a single view declares an override. Listed with the
 *    way out — each of its views saved into the pair as a single view, then
 *    the container deleted naming no package — and never attempted, so no run
 *    fails it.
 *  - `foreign_declaration` — the body already carries an `overrides` key that
 *    does not name the base: listed, never rewritten.
 *  - `shadowed` — the pair already holds a row of that item, in EITHER state
 *    (a Studio customization made first, N-17): listed with the two ways out,
 *    never merged or deleted. Per item, not per state — an unbound draft moved
 *    in beside the pair's active override would replace it on its publish.
 *  - `movable` — everything else. `--apply` moves it.
 *
 * Permission sets, positions and capabilities are not overlay types, so they
 * are never in the population (ADR-0146 D6; their own ceremony is
 * `os migrate security-catalog-overlays`).
 *
 * ## …and the rows bound to a read-only base (#29392)
 *
 * Before #28905 closed it, a save naming the read-only code package itself
 * (`?package=<base>`) stored the customization as a row bound to the base,
 * declaring nothing, served at the base's address in place of its document.
 * Such a row is in the population too: a row of one of the five overlay types
 * whose `package_id` is a READ-ONLY code package that ships the name — the
 * reading the #28905 close names "packaged" (`readOnlyShippingPackages` over
 * `shippedArtifactsOf`, its `overlayBaseShippers`), the one this census reads
 * for a package-less row too. The binding names the base, so a name several
 * packages ship is never `multi_shipped` here: the row is classified by the
 * same {@link classifyPackagelessRow} with its binding as the one shipper,
 * and carries `boundToBase`. It moves as a package-less row does, with the
 * same outcomes (`moved`, or `moved` + `addedMember`), the delete of step 4
 * addressing it by its own binding. A row bound to a writable package (the
 * pair included) is that package's own item, edited in place (ADR-0070), and
 * a row bound to a read-only package that does not ship the name is not a
 * customization of it: neither is listed.
 *
 * Two rows of one item from different bindings — a package-less one and one
 * bound to the base — would both land on the pair's one row. The move takes
 * the package-less rows first; a row of an item this run has already moved a
 * row of another binding into the pair is kept, its outcome `failed`, and the
 * next run lists it `shadowed` (the pair holds the item now), with that
 * disposition's two ways out. Nothing is overwritten.
 *
 * ## The move, one row at a time
 *
 *  1. The pair is ensured through the ensure door,
 *     {@link ObjectStackProtocolImplementation.ensureCustomizationPackage} —
 *     the only creation path (D3). One call per base.
 *  2. The row's body gains `overrides: { package, basedOn }`, `basedOn` the
 *     installed base's `manifest.version` now, and is saved into the pair
 *     through {@link ObjectStackProtocolImplementation.saveMetaItem} — the
 *     override write gate (N-09) judges it like any other save — in the row's
 *     own state (`draft` stays a draft).
 *  3. The pair's row is read back and must be the served override of the base
 *     ({@link isServedOverrideRowOf}, N-10's one predicate).
 *  4. Only then is the unbound row deleted, by its own address — `package_id`
 *     NULL, through the repository beneath the delete door (the door naming no
 *     package now addresses the pair's row: `packagelessAddress`, sole binding).
 *     The delete writes its history tombstone in the same transaction.
 *
 * A failure at any step leaves the unbound row where it is and is that row's
 * `failed` outcome; the next row is still tried. A second run finds nothing to
 * move (idempotent).
 *
 * ## …a bundle member the base does not ship (#28904)
 *
 * For a type whose identity is a pair (`ITEM_KEY_DISCRIMINATORS`: an
 * `email_template` is one item per `(name, locale)`), the base may ship the
 * name and not the row's member — a `zh-CN` translation of a template shipped
 * `en-US` only. Such a row overrides nothing the base ships: the pair holds it
 * as its OWN member, declaring nothing (ADR-0146 D2; a declared override of it
 * is refused, `declared_package_ships_no_such_item`, #28777), and the base's
 * address serves it as the pair's addition (#28802). The census names that
 * member on the `movable` row (`addedMember`), from the shipped artifacts at
 * that member as the write gate counts them ({@link addedMemberOf}), and
 * the move differs in steps 2 and 3 only: the body is saved into the pair
 * WITHOUT `overrides` (one it carries naming the base is dropped), so no
 * `basedOn` is recorded and none is needed; the pair's row read back must be
 * that member's own row, declaring nothing. Its outcome is `moved`, naming
 * the `addedMember` in place of a `basedOn`.
 *
 * ## …and the stored declarations missing `basedOn`
 *
 * A row of a pair whose body declares `overrides: { package: <base> }` with no
 * `basedOn` is counted as a declaration by the read ({@link isServedOverrideRowOf}
 * does not judge `basedOn`) and refused on its next save by the write gate
 * (`OverrideDeclarationSchema` requires it). The same ceremony completes it:
 * `basedOn` = the installed base's version now, saved through the same door.
 * Its population is every type a declaration applies to
 * (`isOverridableMetadataType`), as the read counts one — not only the five
 * overlay types the move acts on. A type whose declared write the gate does
 * not yet open (`flow`, `action`: ADR-0146 D9) is refused by that save, and the
 * row is that refusal's `failed` outcome, its sentence the reason.
 */

import {
    OVERRIDABLE_METADATA_TYPES,
    customizationBasePackageId,
} from '@objectstack/spec/kernel';
import { pairOf } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { storedRowDocument } from './item-lock.js';
import { OVERLAY_MEMBER_COLUMN, overlayMemberOfBody, overlayMemberValue } from './migrations/overlay-index.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import {
    overlayPairFixAdmits,
    overlayPairFixOf,
    overrideDeclarationRefusedByShape,
    overrideWriteMemberOf,
    type OverrideWriteVerdictAsk,
} from './protocol-packaged-base-refusal.js';
import { readOnlyShippingPackages, shippingPackageIds } from './protocol-environment-rows.js';
import { isServedOverrideRowOf } from './served-override.js';

/** The class members this module reads, typed as the class declares them. */
export interface PackagelessOverlayMigrationHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    /** The five `allowEnvironmentOverlay` types, both spellings (the class's static set). */
    readonly overlayTypes: ReadonlySet<string>;
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    readonly shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
    readonly isWritablePackage: ObjectStackProtocolImplementation['isWritablePackage'];
    readonly ensureCustomizationPackage: ObjectStackProtocolImplementation['ensureCustomizationPackage'];
    readonly saveMetaItem: ObjectStackProtocolImplementation['saveMetaItem'];
    /** [#30000] THE repository every `sys_metadata` write goes through; step 4's delete takes it. */
    readonly getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    /** [#30000] The delete door's heal, run after step 4 removes an active row. */
    readonly restoreArtifactRegistryView: ObjectStackProtocolImplementation['restoreArtifactRegistryView'];
}

/** How the ceremony classified one package-less row (module header, "The population"). */
export type PackagelessOverlayDisposition =
    | 'movable'
    | 'multi_shipped'
    | 'no_pair'
    | 'cannot_declare'
    | 'foreign_declaration'
    | 'shadowed';

/** One listed package-less row. `environment` rows are counted, not listed. */
export interface PackagelessOverlayRow {
    /** The `sys_metadata` row id. */
    readonly id: string;
    /** The type as stored (either spelling). */
    readonly storedType: string;
    /** The canonical singular type. */
    readonly type: string;
    readonly name: string;
    readonly state: 'active' | 'draft';
    /** The bundle member, for a type whose identity is a pair; absent otherwise. */
    readonly member?: string;
    readonly disposition: PackagelessOverlayDisposition;
    /** The code packages that ship the name, sorted. */
    readonly shippers: readonly string[];
    /** The base the row overlays — the one shipper — when there is exactly one. */
    readonly base?: string;
    /** The base's paired package, when the base has one. */
    readonly pair?: string;
    /** `shadowed` only: whether the pair's row declares the override of the base. */
    readonly shadowDeclares?: boolean;
    /**
     * [#28904] `movable` only, for a type whose identity is a pair: the bundle
     * member (the row's discriminator value, e.g. its locale) the base does
     * not ship. The row moves in as the pair's own member at it, declaring no
     * override (module header, "a bundle member the base does not ship").
     */
    readonly addedMember?: string;
    /**
     * [#29392] The row is bound to `base`, a read-only code package that ships
     * the name — stored by a save naming the base before the #28905 close —
     * rather than to no package (module header, "the rows bound to a read-only
     * base"). Absent for a package-less row.
     */
    readonly boundToBase?: true;
}

/** One pair row whose declaration lacks `basedOn` (module header, last section). */
export interface IncompleteOverrideDeclarationRow {
    readonly id: string;
    readonly storedType: string;
    readonly type: string;
    readonly name: string;
    readonly state: 'active' | 'draft';
    readonly member?: string;
    readonly base: string;
    readonly pair: string;
}

/** The census {@link listPackagelessOverlays} answers. */
export interface PackagelessOverlayCensus {
    /** Every listed package-less row, ordered by type, name, member, state. */
    readonly rows: readonly PackagelessOverlayRow[];
    /** How many package-less rows of a name no package ships were left as environment metadata. */
    readonly environmentRows: number;
    /** Every pair row declaring an override with no `basedOn`. */
    readonly incompleteDeclarations: readonly IncompleteOverrideDeclarationRow[];
}

/** What {@link migratePackagelessOverlays} did with one movable row or one incomplete declaration. */
export type PackagelessOverlayOutcome =
    | { readonly id: string; readonly outcome: 'moved' | 'declaration_completed'; readonly packageId: string; readonly basedOn: string; readonly addedMember?: undefined }
    /** [#28904] Moved as the pair's own member the base does not ship: no declaration, so no `basedOn`. */
    | { readonly id: string; readonly outcome: 'moved'; readonly packageId: string; readonly addedMember: string; readonly basedOn?: undefined }
    | { readonly id: string; readonly outcome: 'failed'; readonly error: string };

/** One base's line of the report. */
export interface PackagelessOverlayBaseReport {
    readonly base: string;
    readonly pair: string;
    /** Whether this run created the pair (the ensure door's `created`). */
    readonly pairCreated: boolean;
    readonly moved: number;
    readonly declarationsCompleted: number;
    readonly failed: number;
    readonly shadowed: number;
}

/** The answer of {@link migratePackagelessOverlays}: the census it acted on, and what it did. */
export interface PackagelessOverlayMigration extends PackagelessOverlayCensus {
    readonly outcomes: readonly PackagelessOverlayOutcome[];
    readonly bases: readonly PackagelessOverlayBaseReport[];
}

const SYSTEM = { isSystem: true } as const;

function memberOf(row: any): string | undefined {
    const member = row?.[OVERLAY_MEMBER_COLUMN];
    return typeof member === 'string' && member !== '' ? member : undefined;
}

function stateOf(row: any): 'active' | 'draft' | undefined {
    return row?.state === 'active' || row?.state === 'draft' ? row.state : undefined;
}

function isUnbound(row: any): boolean {
    return row?.package_id === null || row?.package_id === undefined || row?.package_id === '';
}

function bodyOf(row: any): Record<string, unknown> | undefined {
    try {
        const body = storedRowDocument(row);
        return body !== null && typeof body === 'object' && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** One item's identity across spellings and packages: `type|name|member|state`. */
const identityKey = (type: string, name: string, member: string | undefined, state: string): string =>
    `${type}\u0000${name}\u0000${member ?? ''}\u0000${state}`;

/**
 * Every type a declared override applies to (`isOverridableMetadataType`),
 * both spellings: the population of the `basedOn` completion, which reads a
 * declaration wherever `isServedOverrideRowOf` counts one — not only on the
 * five overlay types the move acts on.
 */
const OVERRIDABLE_TYPE_SPELLINGS: readonly string[] = Object.freeze(
    [...new Set(OVERRIDABLE_METADATA_TYPES.flatMap((type) => [type, SINGULAR_TO_PLURAL[type] ?? type]))].sort(),
);

/** The rows of the five overlay types, either spelling, the environment's only. */
function overlayRows(this: Pick<PackagelessOverlayMigrationHost, 'overlayTypes' | 'findEnvironmentRows' | 'rethrowUnlessMetadataStoreUnprovisioned'>): Promise<any[]> {
    return environmentRowsOfTypes.call(this, [...this.overlayTypes].sort());
}

/** The environment's `sys_metadata` rows of the given stored type spellings. */
async function environmentRowsOfTypes(
    this: Pick<PackagelessOverlayMigrationHost, 'findEnvironmentRows' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    types: readonly string[],
): Promise<any[]> {
    let rows: any[] = [];
    try {
        rows = await this.findEnvironmentRows('sys_metadata', {
            where: { type: { $in: [...types] } },
            context: SYSTEM,
        });
    } catch (error) {
        // [#5532] An unprovisioned store holds no row; any other failure is a
        // read that did not happen, never "nothing to migrate".
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    return (rows ?? []).filter((row) => typeof row?.name === 'string' && row.name !== '' && stateOf(row) !== undefined);
}

/** The base version a declaration records: the installed base's `manifest.version`, or `undefined`. */
function baseVersionOf(host: Pick<PackagelessOverlayMigrationHost, 'engine'>, base: string): string | undefined {
    const pkg = (host.engine?.registry as { getPackage?: (id: string) => any } | undefined)?.getPackage?.(base);
    const version = pkg?.manifest?.version;
    return typeof version === 'string' && version !== '' ? version : undefined;
}

/**
 * [#28904, ADR-0146 D2] The bundle member `body` is, when `base` ships the
 * name `name` but not that member — the member the row adds to the pair; `undefined` for a type whose identity is
 * its name alone, and for a member `base` ships. Counted as the override
 * write gate counts a shipper (`overrideWriteVerdict`): the artifacts at that
 * member, less any another member answers (a registry that ignores `member`
 * can answer one), bound to `base` — ⛔ never a second reading.
 */
function addedMemberOf(
    host: Pick<PackagelessOverlayMigrationHost, 'shippedArtifactsOf'>,
    type: string,
    name: string,
    base: string,
    body: unknown,
): string | undefined {
    const member = overrideWriteMemberOf(type, body);
    if (member === undefined) return undefined;
    const atMember = host.shippedArtifactsOf(type, name, undefined, member)
        .filter((artifact) => overrideWriteMemberOf(type, artifact) === member);
    return shippingPackageIds(atMember).has(base) ? undefined : member;
}

/**
 * [#28576] How the census classifies ONE package-less row of a name some
 * read-only code package ships (module header, "The population"), from the
 * shippers ({@link readOnlyShippingPackages}), the row's body and the pair's
 * row of the same item, in either state (`shadowOf`). The one classification:
 * {@link listPackagelessOverlays} lists by it, and the close of the
 * package-less write ({@link packagelessCloseSubject}) refuses only a row it
 * answers `movable` — ⛔ never a second copy.
 *
 * `type` is the canonical singular type: `cannot_declare` reads the schema the
 * save door judges the body by. It is asked before `foreign_declaration` and
 * `shadowed`, whose ways out end in this ceremony moving the row; with no body
 * (a write of an unstored item that carries none) there is no shape to judge.
 */
export function classifyPackagelessRow(
    type: string,
    shippers: readonly string[],
    body: Record<string, unknown> | undefined,
    shadowOf: (pair: string) => unknown,
): Pick<PackagelessOverlayRow, 'disposition' | 'base' | 'pair' | 'shadowDeclares'> {
    if (shippers.length > 1) return { disposition: 'multi_shipped' };
    const base = shippers[0]!;
    const pairId = pairOf(base);
    if (!pairId.ok) return { base, disposition: 'no_pair' };
    const pair = pairId.value;
    if (body !== undefined && overrideDeclarationRefusedByShape(type, body)) return { base, pair, disposition: 'cannot_declare' };
    const declared = (body as { overrides?: unknown } | undefined)?.overrides;
    if (declared !== undefined && (declared === null || typeof declared !== 'object'
        || (declared as { package?: unknown }).package !== base)) {
        return { base, pair, disposition: 'foreign_declaration' };
    }
    const shadow = shadowOf(pair);
    if (shadow !== undefined) {
        return { base, pair, disposition: 'shadowed', shadowDeclares: isServedOverrideRowOf(shadow, base) };
    }
    return { base, pair, disposition: 'movable' };
}

/**
 * The census (module header, "The population"): every package-less overlay
 * row classified, and every pair row whose declaration lacks `basedOn`.
 * Writes nothing.
 *
 * @throws the `sys_metadata` read failure, classified as every overlay read
 *         classifies it; an unprovisioned table answers an empty census.
 */
export async function listPackagelessOverlays(
    this: Pick<PackagelessOverlayMigrationHost, 'overlayTypes' | 'findEnvironmentRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'shippedArtifactsOf' | 'isWritablePackage'>,
): Promise<PackagelessOverlayCensus> {
    const rows = await overlayRows.call(this);
    // What every pair holds, per item identity and state.
    const pairRows = new Map<string, any>();
    for (const row of rows) {
        if (isUnbound(row) || customizationBasePackageId(row.package_id) === null) continue;
        const type = PLURAL_TO_SINGULAR[row.type] ?? row.type;
        pairRows.set(`${row.package_id}\u0000${identityKey(type, row.name, memberOf(row), row.state)}`, row);
    }
    // The pair's row of an item that shadows an unbound row in `state`: the
    // pair's override is per ITEM, not per state, so a row of the pair in
    // EITHER state shadows it — the one in the same state when there is one.
    // (An unbound draft beside the pair's active override, moved in as the
    // pair's draft, would replace that override on its publish: the merge
    // the census exists to refuse.)
    const shadowOf = (pair: string, type: string, name: string, member: string | undefined, state: 'active' | 'draft') =>
        pairRows.get(`${pair}\u0000${identityKey(type, name, member, state)}`)
        ?? pairRows.get(`${pair}\u0000${identityKey(type, name, member, state === 'active' ? 'draft' : 'active')}`);

    const listed: PackagelessOverlayRow[] = [];
    let environmentRows = 0;
    for (const row of rows) {
        const type = PLURAL_TO_SINGULAR[row.type] ?? row.type;
        const name = String(row.name);
        const state = stateOf(row)!;
        const member = memberOf(row);
        // The read-only code packages that ship the name: a writable package's
        // item is edited in place (ADR-0070) and has no pair (ADR-0146 D3), and
        // the pair itself is writable — the write gate's own narrowing.
        const shippers = readOnlyShippingPackages(this.shippedArtifactsOf(type, name), (id) => this.isWritablePackage(id));
        // [#29392] A bound row is in the population only when its binding is
        // one of those read-only shippers: a row bound to the base itself.
        const binding = isUnbound(row) ? undefined : String(row.package_id);
        if (binding !== undefined && !shippers.includes(binding)) continue;
        if (shippers.length === 0) {
            environmentRows += 1;
            continue;
        }
        const common = {
            id: String(row.id),
            storedType: String(row.type),
            type,
            name,
            state,
            ...(member !== undefined ? { member } : {}),
            shippers,
        };
        const body = bodyOf(row);
        // A row bound to the base names its base: the binding is its one shipper.
        const classified = classifyPackagelessRow(type, binding !== undefined ? [binding] : shippers, body,
            (pair) => shadowOf(pair, type, name, member, state));
        const addedMember = classified.disposition === 'movable' && classified.base !== undefined
            ? addedMemberOf(this, type, name, classified.base, body)
            : undefined;
        listed.push({
            ...common,
            ...classified,
            ...(addedMember !== undefined ? { addedMember } : {}),
            ...(binding !== undefined ? { boundToBase: true as const } : {}),
        });
    }

    // Every type a declaration applies to, not only the five the move acts on.
    const incompleteDeclarations: IncompleteOverrideDeclarationRow[] = [];
    for (const row of await environmentRowsOfTypes.call(this, OVERRIDABLE_TYPE_SPELLINGS)) {
        if (isUnbound(row)) continue;
        const base = customizationBasePackageId(row.package_id);
        if (base === null || !isServedOverrideRowOf(row, base)) continue;
        const basedOn = (bodyOf(row) as { overrides?: { basedOn?: unknown } } | undefined)?.overrides?.basedOn;
        if (typeof basedOn === 'string' && basedOn !== '') continue;
        const member = memberOf(row);
        incompleteDeclarations.push({
            id: String(row.id),
            storedType: String(row.type),
            type: PLURAL_TO_SINGULAR[row.type] ?? row.type,
            name: String(row.name),
            state: stateOf(row)!,
            ...(member !== undefined ? { member } : {}),
            base,
            pair: String(row.package_id),
        });
    }

    const order = (a: { type: string; name: string; member?: string; state: string; id: string }, b: typeof a) =>
        a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
        || (a.member ?? '').localeCompare(b.member ?? '') || a.state.localeCompare(b.state) || a.id.localeCompare(b.id);
    return {
        rows: listed.sort(order),
        environmentRows,
        incompleteDeclarations: incompleteDeclarations.sort(order),
    };
}

/** The pair's row of an item, as stored now (read back after a write). */
async function storedPairRow(
    host: Pick<PackagelessOverlayMigrationHost, 'findEnvironmentRows'>,
    item: { type: string; name: string; state: string; member?: string },
    pair: string,
): Promise<any | undefined> {
    const rows = await host.findEnvironmentRows('sys_metadata', {
        where: { type: item.type, name: item.name, state: item.state, package_id: pair },
        context: SYSTEM,
    });
    return (rows ?? []).find((row) => memberOf(row) === item.member);
}

/** [#28904] Whether a pair's stored row is its own item: a document that declares no override. */
function isOwnMemberRow(row: unknown): boolean {
    const body = row === undefined ? undefined : bodyOf(row);
    return body !== undefined && !('overrides' in body);
}

/**
 * Move every `movable` row of the census into its base's pair, and complete
 * every declaration missing `basedOn` (module header, "The move"). One outcome
 * per acted-on row; never throws for a row.
 *
 * @param request.actor recorded on every write (the ceremony's own name).
 */
export async function migratePackagelessOverlays(
    this: PackagelessOverlayMigrationHost,
    request: { actor: string },
): Promise<PackagelessOverlayMigration> {
    const census = await listPackagelessOverlays.call(this);
    const outcomes: PackagelessOverlayOutcome[] = [];
    const bases = new Map<string, { pair: string; pairCreated: boolean; moved: number; declarationsCompleted: number; failed: number; shadowed: number }>();
    const lineOf = (base: string, pair: string) => {
        let line = bases.get(base);
        if (line === undefined) {
            line = { pair, pairCreated: false, moved: 0, declarationsCompleted: 0, failed: 0, shadowed: 0 };
            bases.set(base, line);
        }
        return line;
    };
    for (const row of census.rows) {
        if (row.disposition === 'shadowed' && row.base && row.pair) lineOf(row.base, row.pair).shadowed += 1;
    }

    // Step 1, once per base: the ensure door. A refusal fails that base's rows.
    const ensured = new Map<string, { ok: true } | { ok: false; error: string }>();
    const ensure = async (base: string, pair: string) => {
        let answer = ensured.get(base);
        if (answer === undefined) {
            try {
                const result = await this.ensureCustomizationPackage({ basePackageId: base });
                if (result.created) lineOf(base, pair).pairCreated = true;
                answer = { ok: true };
            } catch (error) {
                answer = { ok: false, error: `The customization package '${pair}' could not be ensured: ${messageOf(error)}` };
            }
            ensured.set(base, answer);
        }
        return answer;
    };
    const repo = this.getOverlayRepo();
    const rowsById = new Map<string, any>();
    for (const row of await overlayRows.call(this)) rowsById.set(String(row.id), row);
    if (census.incompleteDeclarations.length > 0) {
        for (const row of await environmentRowsOfTypes.call(this, OVERRIDABLE_TYPE_SPELLINGS)) rowsById.set(String(row.id), row);
    }

    // [#29392] The package-less rows first, then the rows bound to a base; an
    // item this run moved a row of one binding into keeps a row of the other
    // (module header, "the rows bound to a read-only base").
    const movedFrom = new Map<string, boolean>();
    const toMove = census.rows.filter((row) => row.disposition === 'movable' && row.base !== undefined && row.pair !== undefined);
    for (const row of [...toMove.filter((r) => !r.boundToBase), ...toMove.filter((r) => r.boundToBase)]) {
        if (row.base === undefined || row.pair === undefined) continue;
        const line = lineOf(row.base, row.pair);
        const fail = (error: string) => {
            line.failed += 1;
            outcomes.push({ id: row.id, outcome: 'failed', error });
        };
        const itemKey = `${row.pair}\u0000${row.type}\u0000${row.name}\u0000${row.member ?? ''}`;
        const bound = row.boundToBase === true;
        if (movedFrom.has(itemKey) && movedFrom.get(itemKey) !== bound) {
            fail(`'${row.pair}' now holds this item: this run moved its ${bound ? 'package-less row' : `row bound to '${row.base}'`} `
                + 'there, and the row is kept beside it, never merged. Re-run the preview for the ways out.');
            continue;
        }
        const ensuredPair = await ensure(row.base, row.pair);
        if (!ensuredPair.ok) { fail(ensuredPair.error); continue; }
        // [#28904] A member the base does not ship is the pair's own: no
        // declaration, so no `basedOn` to record.
        const { addedMember } = row;
        const basedOn = addedMember === undefined ? baseVersionOf(this, row.base) : undefined;
        if (addedMember === undefined && basedOn === undefined) { fail(`The installed package '${row.base}' declares no version, so no basedOn can be recorded.`); continue; }
        const stored = rowsById.get(row.id);
        const body = stored === undefined ? undefined : bodyOf(stored);
        if (body === undefined) { fail('The stored body could not be read as a document.'); continue; }
        try {
            // Step 2: the declared body — or, for an added member, the body
            // with no `overrides` — saved into the pair through the save door.
            const { overrides: _declared, ...undeclared } = body;
            await this.saveMetaItem({
                type: row.type,
                name: row.name,
                item: addedMember === undefined ? { ...body, overrides: { package: row.base, basedOn } } : undeclared,
                packageId: row.pair,
                mode: row.state === 'draft' ? 'draft' : 'publish',
                actor: request.actor,
            } as never);
            // Step 3: read back — the pair's row must be the served override,
            // or, for an added member, that member's own row declaring nothing.
            const written = await storedPairRow(this, row, row.pair);
            if (addedMember === undefined ? !isServedOverrideRowOf(written, row.base) : !isOwnMemberRow(written)) {
                const kept = bound ? `the row bound to '${row.base}' is kept` : 'the unbound row is kept';
                fail(addedMember === undefined
                    ? `The row saved into '${row.pair}' does not read back as the declared override of '${row.base}'; ${kept}.`
                    : `The row saved into '${row.pair}' does not read back as its own member '${addedMember}', declaring no override; ${kept}.`);
                continue;
            }
            // Step 4: only now, the unbound row (or the row bound to the
            // base), by its own address.
            await repo.delete(
                { type: row.storedType, name: row.name, org: 'env' } as never,
                {
                    parentVersion: (typeof stored.checksum === 'string' ? stored.checksum : null) as string,
                    actor: request.actor,
                    source: request.actor,
                    message: addedMember === undefined
                        ? `Moved into '${row.pair}' as a declared override of '${row.base}' (ADR-0146 D11)`
                        : `Moved into '${row.pair}' as its own member '${addedMember}', which '${row.base}' does not ship (ADR-0146 D2, D11)`,
                    intent: 'override-artifact',
                    state: row.state,
                    // [#29392] A row bound to the base is deleted by that binding.
                    packageId: bound ? row.base : null,
                    ...(row.member !== undefined ? { member: row.member } : {}),
                } as never,
            );
            // [#30000] The registry follows the removed row, as the delete
            // door's heal makes it follow: the row's registration and the
            // record of what a view container expanded to leave with it, and
            // the pair's row saved in step 2 is registered again. A draft never
            // hydrated, so its removal heals nothing.
            if (row.state === 'active') await this.restoreArtifactRegistryView(row.type, row.name, null, row.member);
            movedFrom.set(itemKey, bound);
            line.moved += 1;
            outcomes.push(addedMember === undefined
                ? { id: row.id, outcome: 'moved', packageId: row.pair, basedOn: basedOn! }
                : { id: row.id, outcome: 'moved', packageId: row.pair, addedMember });
        } catch (error) {
            fail(messageOf(error));
        }
    }

    for (const decl of census.incompleteDeclarations) {
        const line = lineOf(decl.base, decl.pair);
        const fail = (error: string) => {
            line.failed += 1;
            outcomes.push({ id: decl.id, outcome: 'failed', error });
        };
        const basedOn = baseVersionOf(this, decl.base);
        if (basedOn === undefined) { fail(`The installed package '${decl.base}' declares no version, so no basedOn can be recorded.`); continue; }
        const stored = rowsById.get(decl.id);
        const body = stored === undefined ? undefined : bodyOf(stored);
        if (body === undefined) { fail('The stored body could not be read as a document.'); continue; }
        try {
            await this.saveMetaItem({
                type: decl.type,
                name: decl.name,
                item: { ...body, overrides: { ...(body.overrides as Record<string, unknown>), basedOn } },
                packageId: decl.pair,
                mode: decl.state === 'draft' ? 'draft' : 'publish',
                actor: request.actor,
            } as never);
            const written = await storedPairRow(this, decl, decl.pair);
            const recorded = (bodyOf(written) as { overrides?: { basedOn?: unknown } } | undefined)?.overrides?.basedOn;
            if (!isServedOverrideRowOf(written, decl.base) || recorded !== basedOn) {
                fail(`The row of '${decl.pair}' does not read back with basedOn '${basedOn}'.`);
                continue;
            }
            line.declarationsCompleted += 1;
            outcomes.push({ id: decl.id, outcome: 'declaration_completed', packageId: decl.pair, basedOn });
        } catch (error) {
            fail(messageOf(error));
        }
    }

    return {
        ...census,
        outcomes,
        bases: [...bases.entries()]
            .map(([base, line]) => ({ base, ...line }))
            .sort((a, b) => a.base.localeCompare(b.base)),
    };
}

// ─────────────────────────────────────────────────────────────────────────
// [#28576] The close reads this ceremony: only what it would move is closed
// ─────────────────────────────────────────────────────────────────────────

/** The class members {@link packagelessCloseSubject} reads, typed as the class declares them. */
export interface PackagelessCloseHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    /** The read-only code packages that ship a name of an overlay type ([] for any other type). */
    readonly overlayBaseShippers: (type: string, name: string) => string[];
    /**
     * The override write gate, as the ceremony's step 2 meets it through the
     * save door: on a pair step 1 has not ensured yet, with the closure the
     * ensure door gives it (`OverlayPairFix.pendingPairScope`).
     */
    readonly overrideWriteVerdict: OverrideWriteVerdictAsk;
}

/** The package-less write {@link packagelessCloseSubject} judges, and the row it would write. */
export interface PackagelessWriteSubject {
    readonly type: string;
    readonly name: string;
    /** The package the write names; a non-empty string means the write is not package-less. */
    readonly packageId?: string | null;
    /** The row's state: a draft save or a publish's draft is `draft`, everything else `active`. */
    readonly state: 'active' | 'draft';
    /** The bundle member as a caller names it (absent: the canonical one). */
    readonly member?: string;
    /** A save's body: the row a first write of the name would store. */
    readonly item?: unknown;
}

/**
 * [ADR-0146 D11, #28576 ruling 2] The base and pair a package-less write is
 * closed onto, or `null` when it stays open. A package-less write is closed
 * exactly where `os migrate packageless-overlays` would move its row and the
 * move can succeed — so every customization the close reaches has a door
 * after the upgrade (the ceremony, then `?package=<base>.custom`), and every
 * one the ceremony leaves keeps the package-less write it has on `main`:
 *
 *  - the row the write addresses is the stored package-less row of that item,
 *    member and state, or — when there is none — the row a save would store
 *    (its body), or none at all (a delete or rollback of an unstored item);
 *  - it is classified by the census's own {@link classifyPackagelessRow}:
 *    only `movable` is closed (`multi_shipped`, `no_pair`, `cannot_declare`,
 *    `foreign_declaration` and `shadowed` stay open, and so does a name no
 *    read-only package ships). `shadowed` applies to a stored row only: a
 *    first write has nothing in the pair to be shadowed by. `cannot_declare`
 *    (a view container, #30261) has no declared write into the pair at all,
 *    so its package-less write is the one door it keeps;
 *  - its move must be able to succeed, read from the steps the ceremony
 *    takes: `overlayPairFixOf` and `overlayPairFixAdmits`
 *    (`protocol-packaged-base-refusal.ts`), the predicate the close of the
 *    write naming the base asks too — the ensure door would ensure the pair,
 *    the base records a version (`basedOn`), and the override write gate
 *    admits the declared body into the pair. An `email_template` member at a
 *    locale the base does not ship is refused there (#28777) and stays open:
 *    the ceremony moves such a row as the pair's own member, declaring
 *    nothing (#28904), and the close reaches only the declared-override
 *    moves, so its package-less write is the one it had before the close.
 *
 * Registry reads first; the one store read (the item's rows) only for a name
 * the registry has not already left open.
 */
export async function packagelessCloseSubject(
    this: PackagelessCloseHost,
    request: PackagelessWriteSubject,
): Promise<{ base: string; pair: string } | null> {
    if (typeof request.packageId === 'string' && request.packageId.length > 0) return null;
    const type = PLURAL_TO_SINGULAR[request.type] ?? request.type;
    const shippers = this.overlayBaseShippers(request.type, request.name);
    if (shippers.length !== 1) return null; // environment metadata, or `multi_shipped`
    const base = shippers[0]!;
    // `no_pair`, a pair step 1 cannot ensure, or no `basedOn` to record.
    const fix = overlayPairFixOf(this, base);
    if (fix === null) return null;

    // The item's stored rows, both spellings, every package: the census's read.
    const spellings = [...new Set([type, SINGULAR_TO_PLURAL[type] ?? type])];
    let rows: any[] = [];
    try {
        rows = (await this.findEnvironmentRows('sys_metadata', {
            where: { type: { $in: spellings }, name: request.name },
            context: SYSTEM,
        })) ?? [];
    } catch (error) {
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    const member = request.item !== undefined && request.member === undefined
        ? overlayMemberOfBody(type, request.item)
        : overlayMemberValue(type, request.member);
    const sameMember = (row: any) => member === undefined || ((row?.[OVERLAY_MEMBER_COLUMN] ?? null) === member);
    const ofItem = rows.filter((row) => sameMember(row) && stateOf(row) !== undefined);
    const stored = ofItem.find((row) => isUnbound(row) && stateOf(row) === request.state);
    const storedBody = stored === undefined ? undefined : bodyOf(stored);
    const writtenBody = request.item !== null && typeof request.item === 'object' && !Array.isArray(request.item)
        ? (request.item as Record<string, unknown>) : undefined;
    const body = stored !== undefined ? storedBody : writtenBody;
    const classified = classifyPackagelessRow(type, shippers, body, (p) => (stored === undefined
        ? undefined
        : ofItem.find((row) => row.package_id === p && stateOf(row) === request.state)
            ?? ofItem.find((row) => row.package_id === p)));
    if (classified.disposition !== 'movable') return null;

    // Step 2's gate: the declared body, into the pair.
    if (!overlayPairFixAdmits(this, fix, { type, name: request.name, body, member })) return null;
    return { base, pair: fix.pair };
}
