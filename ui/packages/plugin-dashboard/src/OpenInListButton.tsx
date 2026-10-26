/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * OpenInListButton — the drill "escape hatch".
 *
 * Rendered in a drill drawer's header, it lets the user escalate from the
 * in-place record peek to the object's full list page (sort / bulk-select /
 * export / shareable URL) — the Looker / Power BI "see records → open in
 * Explore/page" pattern. It delegates the console-specific URL building + SPA
 * routing to the host via {@link useDrillNavigation}; when no host provided a
 * handler (or no object is known) it renders nothing, so the drawer simply
 * stays a self-contained peek.
 */

import React from 'react';
import { useDrillNavigation } from '@object-ui/react';
import { Button } from '@object-ui/components';
import { useSafeTranslate } from '@object-ui/i18n';
import { ArrowUpRight } from 'lucide-react';

export interface OpenInListButtonProps {
  /** Object whose list page to open. */
  objectName?: string;
  /** Filter (object FIELD name → raw value) scoping the list. */
  filter?: Record<string, unknown>;
  /** Invoked after navigation is triggered (e.g. to close the drawer). */
  onNavigate?: () => void;
  className?: string;
}

export const OpenInListButton: React.FC<OpenInListButtonProps> = ({
  objectName,
  filter,
  onNavigate,
  className,
}) => {
  const { openRecordList } = useDrillNavigation();
  const tt = useSafeTranslate();

  // No host navigation handler, or nothing to open → no escape hatch.
  if (!openRecordList || !objectName) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      data-testid="drill-open-in-list"
      onClick={() => {
        openRecordList(objectName, filter);
        onNavigate?.();
      }}
    >
      {tt('dashboard.openInList', 'Open in list')}
      <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
};
