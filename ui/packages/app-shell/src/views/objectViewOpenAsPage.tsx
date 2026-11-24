/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The name cell's 「在侧边打开」 icon on the Console object list
 * (objectstack#35854, maintainer 2026-11-20: 「鼠标滑到…行，右侧显示一个右侧打开
 * 的图标，点击才从右侧打开，否则都是进全屏打开。这样就不需要任何设置」).
 *
 * The record's name opens the full page; this icon, drawn inside the name
 * cell after the name through the grid's host channel (`recordLinkAdornment`),
 * opens the record in the side drawer over the list, which stays. It takes no
 * column of its own.
 *
 * Hidden by OPACITY until the row is hovered or holds focus, so it keeps its
 * Tab stop and its name. A coarse pointer (touch), which has no hover, gets no
 * icon at all: there the name opens the page and that is the one way
 * (objectstack#35854 item 7). This is deliberately NOT the row ⋯ menu's
 * treatment: that trigger (`RowActionMenu`, `data-table`'s row actions) is
 * drawn at rest in a muted tone because an `Actions` header over
 * empty-looking cells reads as "no actions" (objectstack#28871, #28923). This
 * icon is an extra beside the name, under no header of its own, and drawn on
 * every row it would crowd the name column, so it stays hover-revealed.
 */

import { PanelRight } from 'lucide-react';

const OPEN_IN_PANEL_CLASS =
    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground '
    + 'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 '
    + 'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:hidden';

export function OpenInSidePanelButton({
    recordId,
    label,
    onOpen,
}: {
    recordId: string | number;
    /** The tooltip and accessible name: 「在侧边打开」. */
    label: string;
    /** Open the record in the side drawer over the list. */
    onOpen: (recordId: string | number) => void;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            className={OPEN_IN_PANEL_CLASS}
            data-testid="record-open-in-panel"
            onClick={(e) => {
                // The name beside it opens the page on a click, and the row
                // under it selects: this click is the icon's alone.
                e.stopPropagation();
                e.preventDefault();
                onOpen(recordId);
            }}
            onKeyDown={(e) => {
                // Enter and Space are the button's own activation. The grid
                // cell around it reads Enter as "edit this cell" in inline-edit
                // mode and would cancel that click, so the key stops here.
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
        >
            <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
    );
}
