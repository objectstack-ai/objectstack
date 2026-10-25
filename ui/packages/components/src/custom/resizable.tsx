/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use client';

/**
 * The public `Resizable*` export site.
 *
 * This module used to wrap `ResizableHandle` to re-key its stacked-group styles
 * from the dead `data-[panel-group-direction=vertical]` onto the
 * `aria-orientation` attribute react-resizable-panels v4 actually emits (#3024).
 * That fix now lives in `../ui/resizable` itself, so there is nothing left to
 * wrap and all three components pass straight through.
 *
 * Editing `ui/` is normally off-limits (AGENTS.md #7), but that file is no
 * longer upstream-synced: it is hand-migrated to v4 and listed under
 * `customComponents` in `shadcn-components.json`, because upstream still ships
 * the v3 file and re-syncing would break the build. See its header.
 *
 * This module stays as the single public export site rather than folding into
 * `ui/index.ts`: `src/index.ts` star-exports `./ui` and `./custom` side by side,
 * so exporting `Resizable*` from both would collide (TS2308).
 */
import type * as React from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';

/** Kept on the public surface (it is exported from the package root) even though
 *  the wrapper it was introduced for is gone. */
export type ResizableHandleProps = React.ComponentProps<typeof ResizableHandle>;

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
