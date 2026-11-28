// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The App Studio list's header (objectstack#37918, the maintainer's decision 7
 * on epic objectstack#37424, "List page"): a title row with the type's icon,
 * its name, the page's actions ("New X" last) and help, and under it the
 * toolbar the page hands in — the source dropdown and the search box.
 *
 * No breadcrumb, no stat tiles, no refresh: the package switcher above names
 * where the list is, and the table's own footer counts its rows. Only the
 * Studio area draws this header; Setup draws its own (`PageHeader`) and the
 * list outside both keeps `PageShell`'s.
 */

import * as React from 'react';
import { HelpMenu } from '../../layout/HelpMenu.js';
import { StudioTitleRowEnd } from '../studio-design/studioTitleRow.js';

export interface StudioListHeaderProps {
  /** The type's icon, already drawn. */
  icon: React.ReactNode;
  /** The type's name in the reader's locale. */
  title: string;
  /** Beside the title: what the reader should not miss (the invalid / warning counts). */
  badge?: React.ReactNode;
  /** The page's actions, "New X" last. */
  actions?: React.ReactNode;
  /** The toolbar row under the title. */
  toolbar: React.ReactNode;
}

export function StudioListHeader({ icon, title, badge, actions, toolbar }: StudioListHeaderProps): React.ReactElement {
  return (
    <div className="bg-background px-6 pt-4 pb-3 space-y-3" data-testid="studio-list-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground"
        >
          {icon}
        </span>
        <h1 className="min-w-0 truncate text-lg font-semibold" data-testid="studio-list-title">
          {title}
        </h1>
        {badge}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {actions}
          <HelpMenu inApp={false} triggerTestId="studio-list-help" />
          <StudioTitleRowEnd divider />
        </div>
      </div>
      {toolbar}
    </div>
  );
}
