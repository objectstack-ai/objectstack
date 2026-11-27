// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page controls of a page that draws no title row (objectstack#37456,
 * the area's scope note on the card). The AI assistant and the right-hand
 * panel's toggle live at the right end of each page's title row
 * (objectstack#37455, `studioTitleRow.tsx`); a page with none — the package is
 * still loading, the package is not there — would otherwise draw no control
 * at all once the top bar is gone, and the assistant would be unreachable but
 * for ⌘.
 *
 * It is a title row of its own, registered last: the surface mounts it after
 * the page in document order, and the title-row registry hands the controls to
 * the first row in that order. So the page's own title row wins whenever it is
 * drawn, and this one draws them only while the page has none. It sits at the
 * top right of the content pane, where a title row's end would be.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { useStudioTitleRowControls } from './studioTitleRow.js';

export function StudioTitleRowFallback(): React.ReactElement {
  const anchor = React.useRef<HTMLDivElement | null>(null);
  const controls = useStudioTitleRowControls(anchor);
  const save = controls?.save ?? null;
  const assistant = controls?.assistant ?? null;
  const drawn = save !== null || assistant !== null;
  return (
    <div
      ref={anchor}
      data-testid="studio-title-row-fallback"
      data-drawn={drawn ? 'true' : undefined}
      hidden={!drawn}
      className={cn('absolute right-3 top-2.5 z-10 items-center gap-2', drawn && 'flex')}
    >
      {save}
      {assistant}
    </div>
  );
}
