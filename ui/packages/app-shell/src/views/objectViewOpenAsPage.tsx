/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The name cell's ↗ on the Console object list (objectstack#26681): open this
 * row's record as the full page, whatever the reader's drawer | split
 * preference, without changing it.
 *
 * A row of an object that opens its records in the drawer opens the drawer
 * (or the pane beside the list, by the reader's preference); the record page
 * itself is one ↗ away. It is drawn beside the row's title through the grid's
 * host channel (`rowAdornment`), and only for a drawer-mode object: a row of a
 * `page` object already opens the page, and a `none` list opens nothing.
 *
 * **The URL is not built here.** The list page publishes its record builder on
 * `RelatedRecordActionsContext` (`listRecordActionsValue`): `recordHref` is the
 * anchor's href and `openRecord` the SPA navigation a plain left click takes —
 * the record route, with the list as the record's origin, the destination the
 * drawer's own "open as full page" reaches. A host that cannot route to the
 * record answers `null`, and nothing is drawn.
 *
 * Hidden by OPACITY until the row is hovered or holds focus, as the row's ⋮
 * menu is (`RowActionMenu`), so it keeps its Tab stop and its name; a coarse
 * pointer, which has no hover, always shows it.
 */

import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useRelatedRecordActions } from '@object-ui/react';

const OPEN_AS_PAGE_CLASS =
    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground '
    + 'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 '
    + 'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:opacity-100';

export function OpenAsPageLink({
    objectName,
    recordId,
    label,
}: {
    objectName: string;
    recordId: string | number;
    /** The tooltip and accessible name: 「整页打开」. */
    label: string;
}) {
    const host = useRelatedRecordActions();
    const href = host?.recordHref?.(objectName, recordId) ?? null;
    if (href === null || !host?.openRecord) return null;
    const openRecord = host.openRecord;
    return (
        <a
            href={href}
            aria-label={label}
            title={label}
            className={OPEN_AS_PAGE_CLASS}
            data-testid="record-open-as-page"
            onClick={(e) => {
                // The row under it opens the drawer on a click: following this
                // link must never also do that.
                e.stopPropagation();
                // A modifier or non-primary click belongs to the browser (a new
                // tab of the same record page), as on the name's own link.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                openRecord(objectName, recordId);
            }}
            onKeyDown={(e) => {
                // Enter is the anchor's own activation (the browser turns it into
                // the click above). The grid cell around it reads Enter as "edit
                // this cell" in inline-edit mode and would cancel that click, so
                // the key stops here.
                if (e.key === 'Enter') e.stopPropagation();
            }}
        >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
    );
}

/** A row's primary key, as the grid's own link cell reads it (`rowRecordId`). */
function rowId(row: Record<string, unknown>): string | number | null {
    const id = row?.id ?? row?._id;
    return (typeof id === 'string' && id !== '') || typeof id === 'number' ? id : null;
}

/**
 * The row adornment the list hands the grid: the ↗ for a drawer-mode object,
 * after any adornment the page already draws (the managed-environment Users
 * marker). `undefined` when there is nothing to draw on any row, so the grid
 * keeps its title cells exactly as they were.
 */
export function composeRowAdornment(
    own: ((row: Record<string, unknown>) => React.ReactNode) | undefined,
    openAsPage: { objectName: string; label: string } | null,
): ((row: Record<string, unknown>) => React.ReactNode) | undefined {
    if (!openAsPage) return own;
    return (row) => {
        const id = rowId(row);
        const link = id === null
            ? null
            : <OpenAsPageLink objectName={openAsPage.objectName} recordId={id} label={openAsPage.label} />;
        const before = own ? own(row) : null;
        if (before === null || before === undefined || before === false) return link;
        return <>{before}{link}</>;
    };
}
