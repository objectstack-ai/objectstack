// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # When the stored row a by-name read served last changed (#31196)
 *
 * The cached `/meta` item read (`getMetaItemCached`) answers `lastModified`,
 * which the REST door renders as `Last-Modified`. It used to be the time of
 * the READ (`new Date()`), so two reads of one unchanged item a second apart
 * answered two different values under one ETag, and the header carried no
 * information about the item.
 *
 * The item's own change time is known in exactly one place: the
 * `sys_metadata` row the by-name read ({@link readMetaItem}) adopts as the
 * item's content. Its `updated_at` is stamped by every write of that row, a
 * save and a publish alike (`SysMetadataRepository`). An item served from the
 * registry or the MetadataService (a code-shipped or file-loaded definition)
 * has no recorded change time, so it carries none, and the header is
 * omitted. ⛔ Never a stand-in: not the read time, not the boot time.
 *
 * The read records the row's time on the envelope it returns, and the cached
 * read asks {@link servedRowChangedAtOf}.
 *
 * ## Why a symbol, and why non-enumerable
 *
 *  - **It never leaves the process.** `JSON.stringify` drops it, so the
 *    by-name read's published envelope (`GetMetaItemResponseSchema`), its REST
 *    and MCP answers, and every pin of them are unchanged.
 *  - **It does not travel on a copy.** An object spread does not carry it, so
 *    an envelope rebuilt elsewhere (the disabled-package withholding, a
 *    wrapper) answers `undefined`, "no change time known", which omits the
 *    header: the safe direction.
 *
 * `Symbol.for`, so a second evaluation of this module (the dual ESM/CJS
 * builds) reads what the first one wrote.
 */

const SERVED_ROW_CHANGED_AT: unique symbol = Symbol.for('objectstack.metadata-protocol.servedRowChangedAt') as never;

/**
 * Record on `envelope` the change time of the stored row whose content it
 * serves (canonical ISO-8601 text). Mutates and returns `envelope`; with no
 * time (`undefined`) nothing is recorded.
 *
 * Only {@link readMetaItem} calls this, on its active-state answer.
 */
export function withServedRowChangedAt<T extends object>(envelope: T, changedAt: string | undefined): T {
    if (changedAt === undefined) return envelope;
    Object.defineProperty(envelope, SERVED_ROW_CHANGED_AT, {
        value: changedAt,
        enumerable: false,
        writable: false,
        configurable: true,
    });
    return envelope;
}

/**
 * The change time {@link withServedRowChangedAt} recorded on a by-name read's
 * envelope, or `undefined` when the item was not served from a stored row, or
 * the envelope is a copy.
 */
export function servedRowChangedAtOf(envelope: unknown): string | undefined {
    if (envelope === null || typeof envelope !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(envelope, SERVED_ROW_CHANGED_AT)) return undefined;
    const value = (envelope as { [SERVED_ROW_CHANGED_AT]?: unknown })[SERVED_ROW_CHANGED_AT];
    return typeof value === 'string' && value !== '' ? value : undefined;
}
