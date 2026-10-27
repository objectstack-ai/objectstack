// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 23] The read-side conversion of a stored metadata item by
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: the
 * ADR-0087 conversion chain over a stored body with its notices and TODOs
 * handed back (`convertStoredItemDetailed`, #4327/#17321/#25279), and the
 * read every stored row goes through, which warns once per conversion, row
 * and process and fills a page's declared `type` default
 * (`convertStoredItem`, #20101).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same `flow` exemption,
 * the same chain call, the same warn-once key and text, and the same page
 * default.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps both methods — the published `dist/*.d.ts` lists their
 * names, docblocks and declared signatures. `convertStoredItemDetailed`
 * reads no member, so its stub calls the plain function directly.
 * `convertStoredItem`'s stub is one literal of exactly the
 * {@link StoredItemConversionHost} members it reads, plus a `.call`: the
 * `convertStoredItemDetailed` method as a closure, and the
 * `storedConversionWarned` field as a getter, so the warn-once set the body
 * reads and adds to is the protocol's own. Every other reader of either
 * method keeps calling the class method.
 *
 * What the bodies read of `protocol.ts`'s own module-level declarations they
 * import from it; what they import from elsewhere, they import from where
 * `protocol.ts` imported it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import { applyConversionsToStoredItem, type ConversionNotice, type ConversionTodoNotice } from '@objectstack/spec';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { withDeclaredPageTypeDefault } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; a function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface StoredItemConversionHost {
    readonly convertStoredItemDetailed: ObjectStackProtocolImplementation['convertStoredItemDetailed'];
    readonly storedConversionWarned: ObjectStackProtocolImplementation['storedConversionWarned'];
}

/** The body of `ObjectStackProtocolImplementation#convertStoredItem`; the method's docblock there is its contract. */
export function convertStoredItem(
    this: Pick<StoredItemConversionHost, 'convertStoredItemDetailed' | 'storedConversionWarned'>,
    type: string,
    data: unknown,
): unknown {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    const converted = this.convertStoredItemDetailed(type, data, (n) => {
        const name = (data as { name?: unknown } | null | undefined)?.name;
        const key = `${n.conversionId}|${singular}|${String(name ?? '')}`;
        if (this.storedConversionWarned.has(key)) return;
        this.storedConversionWarned.add(key);
        console.warn(
            `[Protocol] stored ${singular}/${String(name ?? '<unnamed>')} carries a pre-protocol shape; ` +
            `${n.message} The row itself is unchanged — re-save it (Studio edit → save, or run ` +
            `"os migrate meta --stored --apply") to persist the canonical shape.`,
        );
    }).item;
    return withDeclaredPageTypeDefault(singular, converted);
}

/** The body of `ObjectStackProtocolImplementation#convertStoredItemDetailed`; the method's docblock there is its contract. */
export function convertStoredItemDetailed(
    type: string,
    data: unknown,
    onNotice?: (notice: ConversionNotice) => void,
    knownDatasources?: ReadonlyMap<string, { readonly schemaMode?: unknown }>,
): { item: unknown; notices: ConversionNotice[]; todos: ConversionTodoNotice[] } {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (singular === 'flow') return { item: data, notices: [], todos: [] };
    const notices: ConversionNotice[] = [];
    const todos: ConversionTodoNotice[] = [];
    const item = applyConversionsToStoredItem(singular, data, {
        onNotice: (n) => {
            notices.push(n);
            onNotice?.(n);
        },
        onTodo: (t) => {
            todos.push(t);
        },
        ...(knownDatasources ? { knownDatasources } : {}),
    });
    return { item, notices, todos };
}
