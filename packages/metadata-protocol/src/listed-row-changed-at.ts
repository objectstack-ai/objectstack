// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # When the stored row each listed item serves last changed (#36894)
 *
 * The metadata LIST response answers `changedAt` beside its items
 * (`GetMetaItemsResponseSchema.changedAt`): for each listed item whose content
 * is a stored `sys_metadata` row, that row's `updated_at`, keyed by the item's
 * `name`. It is the list's counterpart of the by-name read's served-row time
 * (`served-row-changed-at.ts`), and keeps its rule: an item the registry or the
 * MetadataService serves (a code-shipped or file-loaded definition) has no
 * recorded change time, so it gets no entry. ⛔ Never a stand-in: not the read
 * time, not the boot time.
 *
 * ## Which row: the one whose content the list serves
 *
 * One item can have several stored layers in scope (its package's own row, the
 * package-less row, the pair's declared override, a pending draft). The list's
 * merges pick ONE contribution per slot ({@link mergePackageAwareOverlay}), and
 * the time travels with the contribution: each stored row's body enters the
 * merge stamped with its own row's time, so the body the merge serves carries
 * the time of the row it came from and no other. A slot the registry or the
 * MetadataService wins carries none; a draft that wins its slot on
 * `?preview=draft` carries the draft row's time, since the draft is the content
 * served there.
 *
 * ## Why an enumerable symbol, and why it is taken off before serving
 *
 * The list rebuilds items by spread at several steps (the package stamp, a
 * stand-in's copy, the MetadataService merge, the artifact envelope), and an
 * object spread copies an enumerable symbol member, so the time survives each
 * of those copies of the body it belongs to. A body built from something else
 * (a view container's expansion, a code item) carries none. The served-row-name
 * mark (`SERVED_ROW_NAME`) travels the same way.
 *
 * ⛔ A copy that is NOT a spread loses it: `structuredClone` copies string keys
 * only. The one such step on the list is the app nav fold
 * (`applyNavContributions`, which clones an app that has contributions), so
 * the list takes the time off before it and puts it back on what it answers. A
 * step added later that copies an item any other way than by spread owes the
 * same.
 *
 * The time is taken off each item ({@link takeListedRowChangedAt}) where the
 * list assembles its answer, on every face, so no item it returns carries it:
 * the execution face's consumers hold the bodies, and a deep-equality check
 * compares enumerable symbol members. The registry never sees it either: the
 * rows the list hydrates into it are the parsed entries, never the stamped
 * merge contributions.
 */

import { canonicalIsoInstant } from './sys-metadata-repository.js';

const LISTED_ROW_CHANGED_AT: unique symbol = Symbol('metadata-protocol.listedRowChangedAt') as never;

/**
 * A stored `sys_metadata` row's change time, as an ISO-8601 instant in UTC
 * written with `Z` (the form `toISOString()` produces): its `updated_at`, else
 * its `created_at` (the by-name read's rule). `undefined` when the row recorded
 * neither, or recorded a value that is not a time: never a stand-in.
 */
export function storedRowChangedAt(row: unknown): string | undefined {
    if (row === null || typeof row !== 'object') return undefined;
    const stamped = row as { updated_at?: unknown; created_at?: unknown };
    const text = canonicalIsoInstant(stamped.updated_at ?? stamped.created_at);
    if (text === undefined || text === '') return undefined;
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * A copy of the merge contribution `item` carrying `changedAt`, the time of the
 * stored row it was parsed from. `item` itself is never written (a parsed row's
 * body is shared with the registry hydration and the view expansion). With no
 * time, or a body that is not a plain object, `item` unchanged.
 */
export function withListedRowChangedAt<T>(item: T, changedAt: string | undefined): T {
    if (changedAt === undefined || item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return { ...(item as object), [LISTED_ROW_CHANGED_AT]: changedAt } as T;
}

/**
 * The listed item without its row time, and the time. An item that carries
 * none is answered as it is (no copy).
 */
export function takeListedRowChangedAt(item: unknown): { item: unknown; changedAt: string | undefined } {
    if (item === null || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, LISTED_ROW_CHANGED_AT)) {
        return { item, changedAt: undefined };
    }
    const { [LISTED_ROW_CHANGED_AT]: changedAt, ...rest } = item as Record<PropertyKey, unknown>;
    return { item: rest, changedAt: typeof changedAt === 'string' && changedAt !== '' ? changedAt : undefined };
}

/**
 * The list's `changedAt`, from each listed item's `name` and row time: one
 * entry per name at least one listed item of which is served from a stored
 * row. Where several listed items share a name (a name two or more packages
 * ship, the members of a bundle), the latest of their times. Absent when no
 * listed item has one.
 */
export function listedChangedAt(
    timed: Iterable<readonly [name: string, changedAt: string]>,
): { changedAt?: Record<string, string> } {
    const latest = new Map<string, string>();
    for (const [name, changedAt] of timed) {
        const held = latest.get(name);
        if (held === undefined || Date.parse(changedAt) > Date.parse(held)) latest.set(name, changedAt);
    }
    return latest.size === 0 ? {} : { changedAt: Object.fromEntries(latest) };
}

/**
 * Pair each parsed stored-row entry with its row's change time. `entries` is
 * `records` parsed one-to-one and in order (`storedOverlayEntries`); a length
 * that differs pairs nothing, so no item is given another row's time.
 */
export function storedEntryChangedAt<E extends object>(
    records: readonly unknown[],
    entries: readonly E[],
): (entry: E) => string | undefined {
    if (records.length !== entries.length) return () => undefined;
    const times = new Map<E, string>();
    entries.forEach((entry, i) => {
        const changedAt = storedRowChangedAt(records[i]);
        if (changedAt !== undefined) times.set(entry, changedAt);
    });
    return (entry) => times.get(entry);
}
