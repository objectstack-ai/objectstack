// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The stored row's own binding, carried on the body the registry holds (#28412)
 *
 * A stored `sys_metadata` row is bound to a package by its `package_id`
 * COLUMN. The body the protocol hydrates into the SchemaRegistry for it
 * (`hydrateOverlayIntoRegistry`) states it as `_packageId` since #28594
 * (`storedOverlayEntries` serves the column and drops a body's own stamp),
 * but `_packageId` is still no proof of the column: it is an ordinary JSON
 * key, so a stored body, a request body or an import can carry one copied
 * from a read of the base package (the shape #28238 measured), and every
 * writer that does not go through that reader keeps it (`withRowBinding`
 * keeps a body's own stamp).
 *
 * ADR-0146 D9 item 1 arms a flow over the code package's name only when the
 * row that declares it is bound to the base's paired `<base>.custom` — by the
 * column, ⛔ never by the body. The automation boot pull reads the registry,
 * not the store, so the column has to travel with the body: the hydrator
 * records it here, and the reader asks {@link storedRowBindingOf}, then
 * judges the row with the one served-override predicate
 * (`isServedOverrideRowOf`, `served-override.ts`).
 *
 * ## Why a symbol, and why non-enumerable
 *
 *  - **It cannot be authored.** A stored body is JSON: no parse of stored
 *    bytes, no request body and no import produces a symbol-keyed property, so
 *    a body cannot claim a binding the way it can claim a `_packageId`. Only
 *    the code that read the column writes it.
 *  - **It never leaves the process.** `JSON.stringify` drops it, so no
 *    response, export, checksum or history row carries it, and the shape of
 *    the served document is unchanged.
 *  - **It does not travel on a copy.** It is non-enumerable, so an object
 *    spread or a clone does not carry it: a body rebuilt from another (the
 *    list read's merges, a decorated copy) answers `undefined` — "no binding
 *    known", which admits nothing — rather than a binding a different object
 *    was read with.
 *
 * `Symbol.for`, so a second evaluation of this module (the dual ESM/CJS
 * builds) reads the binding the first one wrote.
 */

const STORED_ROW_BINDING: unique symbol = Symbol.for('objectstack.metadata-protocol.storedRowBinding') as never;

/**
 * Record on `body` the `package_id` column of the stored row it was read
 * from: a package id, or `null` for a row bound to no package. Mutates and
 * returns `body`; a body that is not a plain object is returned unchanged.
 *
 * Only a reader of the stored row calls this — the registry hydration
 * (`hydrateOverlayIntoRegistry`) — and a test standing in for it.
 */
export function bindStoredRow<T>(body: T, packageId: unknown): T {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
    const binding = typeof packageId === 'string' && packageId !== '' ? packageId : null;
    Object.defineProperty(body, STORED_ROW_BINDING, {
        value: binding,
        enumerable: false,
        writable: false,
        configurable: true,
    });
    return body;
}

/**
 * The `package_id` column of the stored row `item` was read from, as
 * {@link bindStoredRow} recorded it: a package id, `null` for a package-less
 * row, or `undefined` when `item` carries no recorded binding — a code
 * artifact, a body no reader of the store bound, or a copy of one. ⛔ Never
 * the body's `_packageId`.
 */
export function storedRowBindingOf(item: unknown): string | null | undefined {
    if (item === null || typeof item !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(item, STORED_ROW_BINDING)) return undefined;
    const binding = (item as { [STORED_ROW_BINDING]?: unknown })[STORED_ROW_BINDING];
    return typeof binding === 'string' && binding !== '' ? binding : null;
}
