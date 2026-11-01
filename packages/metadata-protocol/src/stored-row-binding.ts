// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The stored row's own binding, carried on the body the registry holds (#28412)
 *
 * A stored `sys_metadata` row is bound to a package by its `package_id`
 * COLUMN. The body the protocol hydrates into the SchemaRegistry for it
 * (`hydrateOverlayIntoRegistry`) carries no trustworthy copy of that column:
 * `_packageId` on such a body is whatever the stored bytes said, or the column
 * when they said nothing (`withRowBinding` keeps a body's own stamp). A body
 * can carry a `_packageId` copied from a read of the base package, so a stamp
 * names the base while the row belongs to another package (the shape #28238
 * measured), and a package-less row can carry a stamp naming a package it is
 * not bound to.
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
