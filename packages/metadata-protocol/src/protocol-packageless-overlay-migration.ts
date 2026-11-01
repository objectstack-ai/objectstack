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
 *    formed from (`customizationPackageId` refuses it): listed, not moved.
 *
 * "Ships" counts read-only code packages only, as the write gate does: a
 * writable package's item is edited in place (ADR-0070), and the pair itself
 * is writable.
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
    customizationPackageId,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { storedRowDocument } from './item-lock.js';
import { OVERLAY_MEMBER_COLUMN } from './migrations/overlay-index.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { readOnlyShippingPackages } from './protocol-environment-rows.js';
import { isServedOverrideRowOf } from './served-override.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';

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
}

/** How the ceremony classified one package-less row (module header, "The population"). */
export type PackagelessOverlayDisposition =
    | 'movable'
    | 'multi_shipped'
    | 'no_pair'
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
    | { readonly id: string; readonly outcome: 'moved' | 'declaration_completed'; readonly packageId: string; readonly basedOn: string }
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
        if (!isUnbound(row)) continue;
        const type = PLURAL_TO_SINGULAR[row.type] ?? row.type;
        const name = String(row.name);
        const state = stateOf(row)!;
        const member = memberOf(row);
        // The read-only code packages that ship the name: a writable package's
        // item is edited in place (ADR-0070) and has no pair (ADR-0146 D3), and
        // the pair itself is writable — the write gate's own narrowing.
        const shippers = readOnlyShippingPackages(this.shippedArtifactsOf(type, name), (id) => this.isWritablePackage(id));
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
        if (shippers.length > 1) {
            listed.push({ ...common, disposition: 'multi_shipped' });
            continue;
        }
        const base = shippers[0]!;
        const pairId = customizationPackageId(base);
        if (!pairId.ok) {
            listed.push({ ...common, base, disposition: 'no_pair' });
            continue;
        }
        const pair = pairId.value;
        const declared = (bodyOf(row) as { overrides?: unknown } | undefined)?.overrides;
        if (declared !== undefined && (declared === null || typeof declared !== 'object'
            || (declared as { package?: unknown }).package !== base)) {
            listed.push({ ...common, base, pair, disposition: 'foreign_declaration' });
            continue;
        }
        const shadow = shadowOf(pair, type, name, member, state);
        if (shadow !== undefined) {
            listed.push({ ...common, base, pair, disposition: 'shadowed', shadowDeclares: isServedOverrideRowOf(shadow, base) });
            continue;
        }
        listed.push({ ...common, base, pair, disposition: 'movable' });
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
    const repository = new SysMetadataRepository({ engine: this.engine as never, orgLabel: 'env' });
    const rowsById = new Map<string, any>();
    for (const row of await overlayRows.call(this)) rowsById.set(String(row.id), row);
    if (census.incompleteDeclarations.length > 0) {
        for (const row of await environmentRowsOfTypes.call(this, OVERRIDABLE_TYPE_SPELLINGS)) rowsById.set(String(row.id), row);
    }

    for (const row of census.rows) {
        if (row.disposition !== 'movable' || row.base === undefined || row.pair === undefined) continue;
        const line = lineOf(row.base, row.pair);
        const fail = (error: string) => {
            line.failed += 1;
            outcomes.push({ id: row.id, outcome: 'failed', error });
        };
        const ensuredPair = await ensure(row.base, row.pair);
        if (!ensuredPair.ok) { fail(ensuredPair.error); continue; }
        const basedOn = baseVersionOf(this, row.base);
        if (basedOn === undefined) { fail(`The installed package '${row.base}' declares no version, so no basedOn can be recorded.`); continue; }
        const stored = rowsById.get(row.id);
        const body = stored === undefined ? undefined : bodyOf(stored);
        if (body === undefined) { fail('The stored body could not be read as a document.'); continue; }
        try {
            // Step 2: the declared body, saved into the pair through the save door.
            await this.saveMetaItem({
                type: row.type,
                name: row.name,
                item: { ...body, overrides: { package: row.base, basedOn } },
                packageId: row.pair,
                mode: row.state === 'draft' ? 'draft' : 'publish',
                actor: request.actor,
            } as never);
            // Step 3: read back — the pair's row must be the served override.
            const written = await storedPairRow(this, row, row.pair);
            if (!isServedOverrideRowOf(written, row.base)) {
                fail(`The row saved into '${row.pair}' does not read back as the declared override of '${row.base}'; the unbound row is kept.`);
                continue;
            }
            // Step 4: only now, the unbound row, by its own address.
            await repository.delete(
                { type: row.storedType, name: row.name, org: 'env' } as never,
                {
                    parentVersion: (typeof stored.checksum === 'string' ? stored.checksum : null) as string,
                    actor: request.actor,
                    source: request.actor,
                    message: `Moved into '${row.pair}' as a declared override of '${row.base}' (ADR-0146 D11)`,
                    intent: 'override-artifact',
                    state: row.state,
                    packageId: null,
                    ...(row.member !== undefined ? { member: row.member } : {}),
                } as never,
            );
            line.moved += 1;
            outcomes.push({ id: row.id, outcome: 'moved', packageId: row.pair, basedOn });
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
