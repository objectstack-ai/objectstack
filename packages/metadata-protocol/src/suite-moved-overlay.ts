// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # A tenant's edit follows its item across the packages of one App
 *
 * ADR-0130 D4 lets a product ship as one App and the modules its artifact
 * delivers, and a later version may move an item from one of those packages
 * to another: HotCRM's flat `app.objectstack.hotcrm` ships `x_case.open`,
 * its composed version ships it from the module
 * `app.objectstack.hotcrm.service`, and a rollback moves it back. A tenant's
 * edit of the item is stored against the package that shipped it at the time
 * of the edit, so after the move every read looked for it under the new owner,
 * found nothing, and served the vendor's item: the edit was still stored and
 * no longer served, in both directions.
 *
 * The customization unit is the App (ADR-0146 D3 as amended, ruling record
 * 6691022506), and this module reads the move at that grain. A stored row of
 * the item that names a package of the same App, which no longer ships the
 * item, is served at the address of the package that ships it now. Two row
 * shapes carry such an edit:
 *
 *  - **A declared override in the App's pair** ({@link isMovedOverrideRowOf}).
 *    Since ADR-0146 D11 a tenant's edit is saved into the App's paired
 *    `<app>.custom` package, declaring `overrides: { package, basedOn }` with
 *    `package` the item's owner at the time. The binding is the App's pair
 *    whichever package of the App owned the item, so after the move only the
 *    declaration still names the old owner.
 *  - **A row bound to the old owner itself** ({@link isMovedBaseRowOf}): the
 *    shape a Regime O save (ADR-0126) stored before the D11 close, served at
 *    the base's address until `os migrate packageless-overlays` moves it into
 *    the pair. That ceremony only moves a row whose binding still ships the
 *    name, so after the move nothing else would ever serve it.
 *
 * ## Same App, read from what the install recorded
 *
 * ⛔ Never from an id or a name prefix. Two installed packages are of one App
 * when {@link appOf} answers the same App for both over the registry's
 * installed manifests: an App is its own App, and a module's App is the
 * installed `type: 'app'` package its manifest declares. That reading needs
 * both packages installed. The one case where the old owner is not installed
 * is a module a later version (or a rollback) no longer delivers, and there
 * the record is the row's own binding: the row sits in the pair of the App
 * that carries the item's current owner ({@link pairsOf}), and the save door
 * only lets a pair declare a package of its own App (ADR-0146 D2, the write
 * gate's `isPairOf`), so a row there names a package of that App. A row bound
 * to another App's pair, or a declaration naming an installed package of
 * another App, never applies.
 *
 * ## What it never does
 *
 *  - It moves nothing and writes nothing: the row keeps its binding and its
 *    body. The next save of the item writes the current owner's address as
 *    every save does, so the move is a read-time fact, and a rollback needs no
 *    reverse step.
 *  - It never takes an item from a package that still ships it: the old owner
 *    must not ship the name and the address's package must. A row the old
 *    owner still ships is that owner's own edit, served at its address only.
 *  - It never reaches a type a tenant does not edit in place: the type must be
 *    one a declared override applies to (`isOverridableMetadataType`, the
 *    closed `OVERRIDE_TYPE_CLASSIFICATION`). An `object` is extended, never
 *    replaced, so an object still takes no overlay (`ITEM_LOCKED`).
 *  - It never decides between two old owners: when two rows bound to two
 *    other packages of the App could follow the item, neither is served
 *    ({@link findServedOverlayRow}, the list's merge), as a name several
 *    packages ship is never guessed.
 *
 * Pure, synchronous and total: no I/O, and `false` for any input it cannot
 * read. Which packages ship the name is the caller's reading of the registry
 * it serves ({@link ShipsName}).
 */

import { isOverridableMetadataType } from '@objectstack/spec/kernel';
import { isCustomizationPackage } from '@objectstack/spec/kernel';
import { appOf, type InstalledManifestLookup } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { storedRowDocument } from './item-lock.js';
import { isServedOverrideRowOf, type ServedOverrideRow } from './served-override.js';

/**
 * Whether a code package ships the item being read (its type, name and
 * bundle member) in the registry the read serves: the caller's reading,
 * from the shipped artifacts it already weighs for the address.
 */
export type ShipsName = (packageId: string) => boolean;

/** The row's body as a plain object, or `undefined` when it is not one. */
function documentOf(row: ServedOverrideRow): Record<string, unknown> | undefined {
    let body: unknown;
    try {
        body = storedRowDocument(row);
    } catch {
        // A body that is not JSON declares nothing; the read that serves the
        // row parses it the same way and answers that failure itself.
        return undefined;
    }
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
}

function overridableType(type: unknown): boolean {
    return typeof type === 'string' && isOverridableMetadataType(PLURAL_TO_SINGULAR[type] ?? type);
}

/** Whether two INSTALLED packages are of one App, read through {@link appOf}. */
function ofOneApp(a: string, b: string, installed: InstalledManifestLookup): boolean {
    if (installed(a) === undefined || installed(b) === undefined) return false;
    const app = appOf(a, installed);
    return app !== undefined && app === appOf(b, installed);
}

/**
 * Whether `row` is a declared override, in `base`'s App's pair, of an item a
 * package of that App shipped before it moved to `base`: the body declares
 * `overrides.package` = another package that no longer ships the name, while
 * `base` ships it; that package is an installed package of `base`'s App, or
 * is no longer installed (the row's binding to the App's pair is then the
 * record, module header). Every other check is {@link isServedOverrideRowOf}'s
 * own, asked of the row as if it named `base`: the binding is one of `base`'s
 * pairs and the type is one a declared override applies to.
 *
 * | row (in `app.custom`) declares | base | installed | ships | answer |
 * |:--|:--|:--|:--|:--|
 * | `app` | `app.service` | both, `app.service` declares `app` | `app.service` only | `true` (flat → composed) |
 * | `app.service` | `app` | `app` only | `app` | `true` (composed → flat) |
 * | `app` | `app` | — | — | `false` — `isServedOverrideRowOf`'s own row |
 * | `app` | `app.service` | both | both | `false` — `app` still ships it |
 * | `partner.ext` (installed, its own App) | `app.service` | … | `app.service` | `false` — another App |
 * | `app`, row in `other.custom` | `app.service` | … | `app.service` | `false` — not `base`'s pair |
 */
export function isMovedOverrideRowOf(
    row: ServedOverrideRow | null | undefined,
    base: unknown,
    installed: InstalledManifestLookup,
    ships: ShipsName,
): boolean {
    if (row === null || row === undefined || typeof row !== 'object') return false;
    if (typeof base !== 'string' || base === '') return false;
    const body = documentOf(row);
    const declaration = body?.overrides;
    if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) return false;
    const former = (declaration as { package?: unknown }).package;
    if (typeof former !== 'string' || former === '' || former === base) return false;
    if (!ships(base) || ships(former)) return false;
    if (installed(former) !== undefined && !ofOneApp(former, base, installed)) return false;
    // THE predicate, asked of the row as if its declaration named `base`.
    const asBase = { ...body, overrides: { ...(declaration as object), package: base } };
    return isServedOverrideRowOf({ type: row.type, package_id: row.package_id, metadata: asBase }, base, installed);
}

/**
 * Whether `row` is a tenant's edit bound to a package of `base`'s App that
 * shipped the item before it moved to `base` (the pre-D11 Regime O shape,
 * module header): bound to another INSTALLED package of `base`'s App, not a
 * pair, which no longer ships the name while `base` ships it, of a type a
 * tenant edits, declaring no override.
 *
 * | row bound to | base | ships | answer |
 * |:--|:--|:--|:--|
 * | `app` (installed) | `app.service` (declares `app`) | `app.service` only | `true` |
 * | `app` | `app.service` | both | `false` — `app` still ships it |
 * | `partner.ext` (installed, its own App) | `app.service` | `app.service` | `false` — another App |
 * | `app.old` (not installed) | `app` | `app` | `false` — no install record names its App |
 * | `app.custom` | `app.service` | `app.service` | `false` — a pair's row is {@link isMovedOverrideRowOf}'s |
 */
export function isMovedBaseRowOf(
    row: ServedOverrideRow | null | undefined,
    base: unknown,
    installed: InstalledManifestLookup,
    ships: ShipsName,
): boolean {
    if (row === null || row === undefined || typeof row !== 'object') return false;
    if (typeof base !== 'string' || base === '') return false;
    const former = row.package_id;
    if (typeof former !== 'string' || former === '' || former === base || isCustomizationPackage(former)) return false;
    if (!overridableType(row.type)) return false;
    if (!ships(base) || ships(former)) return false;
    if (!ofOneApp(former, base, installed)) return false;
    const body = documentOf(row);
    return body !== undefined && !('overrides' in body);
}
