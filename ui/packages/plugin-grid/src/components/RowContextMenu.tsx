/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  LazyIcon,
  toKebabIconName,
} from '@object-ui/components';
import { ExternalLink, PanelRightOpen, Trash2, X } from 'lucide-react';
import type { BulkActionDef } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/react';
import {
  RowActionMenuItems,
  formatActionLabel,
  useRowActionPlan,
  type RowActionMenuProps,
} from './RowActionMenu';
import { isDestructiveBulkDef, useBulkActionItems } from './BulkActionBar';

/**
 * The items of a list row's context menu (objectstack#28434) — the second way
 * to reach what the row's "⋮" cell offers. `data-table` owns the menu itself
 * (where it opens, Esc, focus, the cases that keep the browser's menu); this
 * file draws what goes in it, from the same resolvers as the "⋮" cell and the
 * bulk action bar, so neither menu can offer what the other does not honour.
 */

const CONTEXT_MENU_FALLBACKS: Record<string, string> = {
  'table.open': 'Open',
  'detail.openInNewTab': 'Open in new tab',
};

function useContextMenuTranslation() {
  const { t } = useObjectTranslation();
  return (key: string, options?: { count?: number; defaultValue?: string }): string => {
    const v = String(options ? t(key, options) : t(key));
    return v === key ? (CONTEXT_MENU_FALLBACKS[key] ?? key) : v;
  };
}

/**
 * ONE row's context menu: Open, Open in new tab, then every action the row's
 * cell offers — the "⋮" items and the inline primaries the cell's width budget
 * keeps out of the "⋮". Same resolver ({@link useRowActionPlan}), same items
 * ({@link RowActionMenuItems}), same handlers (so the same confirm dialogs);
 * the only input read differently is the inline budget, `0` here.
 */
export const RowContextMenuItems: React.FC<{
  /** Exactly the props the row's "⋮" cell renders with. */
  menu: RowActionMenuProps;
  /** Open the record the way a click on the row does. Absent ⇒ no Open item. */
  onOpen?: () => void;
  /** The record URL the row links to. Absent ⇒ no Open in new tab item. */
  newTabHref?: string | null;
}> = ({ menu, onOpen, newTabHref }) => {
  const t = useContextMenuTranslation();
  const plan = useRowActionPlan(menu, 0);
  const hasOpen = !!onOpen || !!newTabHref;
  return (
    <>
      {onOpen && (
        <DropdownMenuItem onClick={() => onOpen()} data-testid="row-context-open">
          <PanelRightOpen className="mr-2 h-4 w-4" />
          {t('table.open')}
        </DropdownMenuItem>
      )}
      {newTabHref && (
        <DropdownMenuItem asChild data-testid="row-context-open-new-tab">
          <a href={newTabHref} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('detail.openInNewTab')}
          </a>
        </DropdownMenuItem>
      )}
      {hasOpen && plan.menuCount > 0 && <DropdownMenuSeparator />}
      <RowActionMenuItems plan={plan} props={menu} />
    </>
  );
};

/**
 * The context menu of a row inside a selection of two or more: the selection's
 * count, the bulk actions {@link useBulkActionItems} offers it — the bar's own
 * resolver, so the same items and gates as `BulkActionBar` — and Clear, as the
 * bar has. Never a single-record action: a selection is a bulk act.
 */
export const SelectionContextMenuItems: React.FC<{
  selectedRows: any[];
  actions: string[];
  actionDefs?: BulkActionDef[];
  objectFields?: unknown;
  allMatchingSelected?: boolean;
  totalMatching?: number;
  onAction?: (action: string, selectedRows: any[]) => void;
  onActionDef?: (def: BulkActionDef, selectedRows: any[]) => void;
  onClearSelection?: () => void;
}> = ({
  selectedRows,
  actions,
  actionDefs,
  objectFields,
  allMatchingSelected,
  totalMatching,
  onAction,
  onActionDef,
  onClearSelection,
}) => {
  const t = useContextMenuTranslation();
  const items = useBulkActionItems({ selectedRows, actions, actionDefs, objectFields });
  const hasActions = items.defs.length > 0 || items.legacy.length > 0;
  return (
    <>
      <DropdownMenuLabel className="text-xs font-medium tabular-nums text-muted-foreground" data-testid="row-context-selection-count">
        {allMatchingSelected
          ? t('grid.bulkSelectedAllMatches', { count: totalMatching, defaultValue: '{{count}} selected (all matches)' })
          : t('grid.bulkSelected', { count: selectedRows.length, defaultValue: '{{count}} selected' })}
      </DropdownMenuLabel>
      {hasActions && <DropdownMenuSeparator />}
      {items.defs.map((def) => {
        const destructive = isDestructiveBulkDef(def);
        const iconName = def.icon ? toKebabIconName(def.icon) : null;
        return (
          <DropdownMenuItem
            key={def.name}
            onClick={() => onActionDef?.(def, selectedRows)}
            data-testid={`row-context-bulk-${def.name}`}
            className={destructive ? 'text-destructive focus:text-destructive' : undefined}
          >
            {iconName ? (
              <LazyIcon name={iconName} className="mr-2 h-4 w-4" />
            ) : destructive ? (
              <Trash2 className="mr-2 h-4 w-4" />
            ) : null}
            {def.label ?? formatActionLabel(def.name)}
          </DropdownMenuItem>
        );
      })}
      {items.legacy.map(({ name, destructive }) => (
        <DropdownMenuItem
          key={name}
          onClick={() => onAction?.(name, selectedRows)}
          data-testid={`row-context-bulk-${name}`}
          className={destructive ? 'text-destructive focus:text-destructive' : undefined}
        >
          {destructive && <Trash2 className="mr-2 h-4 w-4" />}
          {formatActionLabel(name)}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onClearSelection?.()} data-testid="row-context-clear-selection">
        <X className="mr-2 h-4 w-4" />
        {t('grid.bulkClear', { defaultValue: 'Clear' })}
      </DropdownMenuItem>
    </>
  );
};
