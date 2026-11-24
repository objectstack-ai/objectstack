/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Button } from '@object-ui/components';
import { Trash2 } from 'lucide-react';
import { LazyIcon, toKebabIconName } from '@object-ui/components';
import { useObjectTranslation, usePredicateScope, useCapabilityGate } from '@object-ui/react';
import { isActionSwitchedOff } from '@object-ui/core';
import type { BulkActionDef } from '@object-ui/types';
import { partitionBulkRows, hasVisibilityGate } from '../bulkEligibility';
import { formatActionLabel } from './RowActionMenu';

/**
 * Is this rich bulk def offered for this selection? `visible` is evaluated
 * ONCE PER SELECTED RECORD with that record in scope (objectui#3067),
 * fail-closed per record — the same contract the row kebab uses. The def is
 * offered when at least one selected record passes; the run then acts only on
 * those. A record-free predicate (`features.x`) answers identically for every
 * row, so it still behaves as a plain button-level gate. See
 * `partitionBulkRows` for why the previous record-free evaluation was not
 * merely lenient but wrong.
 *
 * Only a def that actually declares `visible` can be gated away — an ungated
 * def is always offered, even against an empty selection (the bar itself is
 * what decides there is a selection at all). `hasVisibilityGate` rather than
 * truthiness, so a declared `visible: false` still counts as a gate instead of
 * falling through to "ungated → always render".
 */
function isBulkDefOffered(
  def: BulkActionDef,
  selectedRows: any[],
  scope: Record<string, unknown>,
  objectFields: unknown,
): boolean {
  if (!hasVisibilityGate(def)) return true;
  return partitionBulkRows(def, selectedRows, { scope, fields: objectFields as never }).eligible.length > 0;
}

/**
 * objectstack#35403 — the reserved selection-bar name of the built-in bulk
 * Change Owner, dispatched to the host's `onBulkChangeOwner` (never the action
 * runner), as the built-in `delete` is dispatched to `onBulkDelete`. The
 * `sys_` prefix keeps it apart from every author-declared action name.
 */
export const CHANGE_OWNER_BULK_ACTION = 'sys_change_owner';

/** A legacy string bulk action, with the destructive styling its name implies. */
export interface LegacyBulkActionItem {
  name: string;
  /**
   * What the button and the menu item read: the built-in `delete` reads the
   * grid's translation key, any other name is formatted from itself.
   */
  label: string;
  destructive: boolean;
}

/** What a selection is offered — the selection bar's buttons, and the selection's context menu. */
export interface BulkActionItems {
  /** Rich defs that pass the capability gate, the switch-off and their per-record `visible`, in declared order. */
  defs: BulkActionDef[];
  /** Legacy string actions (no declaration to gate on), in declared order. */
  legacy: LegacyBulkActionItem[];
}

/**
 * THE bulk-action resolver (objectstack#28434): what a selection is offered,
 * read by both of its entry points — the selection bar (`./SelectionBar`) and the context
 * menu a right-click on a selected row opens (`./RowContextMenu`). Both call
 * this hook, so a bulk action shows in both or in neither.
 *
 * [ADR-0066 D4 / objectui#3492] Capability gate, applied to the whole def set
 * before anything renders — the fourth action surface joining the list
 * toolbar (`action-bar.tsx`), the record header (`containers.tsx`) and the row
 * kebab (`RowActionMenu.tsx`). Without it, an action that those three hide
 * from an unentitled user reappeared here the moment they ticked a checkbox.
 * Same rule as the engine: an empty declaration always passes, several are
 * AND-ed, and unknown capabilities fail OPEN (see `useCapabilityGate`) — the
 * server stays the authority. Legacy string `actions` carry no declaration to
 * gate on, so they are untouched.
 *
 * Legacy names are offered ALONGSIDE defs, not only in their absence: after
 * `resolveBulkActions` folds every resolvable name into `actionDefs`, what's
 * left is a disjoint set (a handler-registered name the object never
 * declared). Hiding it whenever any def existed made a view that mixes both
 * silently lose half its buttons.
 */
export function useBulkActionItems(input: {
  selectedRows: any[];
  actions: string[] | undefined;
  /** Read, never mutated: `resolveBulkActions` hands its fold over as a readonly list. */
  actionDefs?: readonly BulkActionDef[];
  objectFields?: unknown;
}): BulkActionItems {
  const { selectedRows, actions, actionDefs, objectFields } = input;
  const mayInvoke = useCapabilityGate();
  const scope = usePredicateScope();
  // `language` keys the memo on the active language itself, so the label
  // follows a switch whatever identity `t` keeps across it.
  const { t, language } = useObjectTranslation();
  return React.useMemo(() => {
    const defs = (actionDefs ?? []).filter(
      (d) =>
        mayInvoke(d?.requiredPermissions)
        && !isActionSwitchedOff(d)
        && isBulkDefOffered(d, selectedRows, scope, objectFields),
    );
    const legacy = (Array.isArray(actions) ? actions : []).map((action) => {
      const actionStr = String(action).toLowerCase();
      return {
        name: action,
        label: actionStr === 'delete'
          ? t('grid.delete', { defaultValue: 'Delete' })
          : action === CHANGE_OWNER_BULK_ACTION
            ? t('grid.changeOwner', { defaultValue: 'Change Owner' })
            : formatActionLabel(action),
        destructive: actionStr.includes('delete') || actionStr.includes('remove') || actionStr.includes('destroy'),
      };
    });
    return { defs, legacy };
  }, [actionDefs, actions, selectedRows, scope, objectFields, mayInvoke, t, language]);
}

/** A rich def reads as destructive by its variant or by the delete operation it runs. */
export function isDestructiveBulkDef(def: BulkActionDef): boolean {
  return def.variant === 'danger' || def.operation === 'delete';
}

/** One entry of a selection's actions, in the order a menu or the page bar draws them. */
export type OrderedBulkItem =
  | { kind: 'def'; key: string; destructive: boolean; def: BulkActionDef }
  | { kind: 'legacy'; key: string; destructive: boolean; legacy: LegacyBulkActionItem };

/**
 * objectstack#35554 — a selection's actions as one list: the rich defs, then
 * the legacy names, each in declared order, with every destructive entry moved
 * to the end (the order is otherwise kept). The selection's context menu and
 * the selection bar read this one order, so the actions the bar exposes are the
 * first entries of the menu, and Delete closes both.
 */
export function orderSelectionMenuItems(items: BulkActionItems): OrderedBulkItem[] {
  const all: OrderedBulkItem[] = [
    ...items.defs.map((def) => ({ kind: 'def' as const, key: `def:${def.name}`, destructive: isDestructiveBulkDef(def), def })),
    ...items.legacy.map((legacy) => ({ kind: 'legacy' as const, key: `legacy:${legacy.name}`, destructive: legacy.destructive, legacy })),
  ];
  return [...all.filter((e) => !e.destructive), ...all.filter((e) => e.destructive)];
}

/** One rich bulk-action button, offered per {@link useBulkActionItems}, at the selection bar's size. */
export const BulkActionButton: React.FC<{
  def: BulkActionDef;
  selectedRows: any[];
  onActionDef?: (def: BulkActionDef, selectedRows: any[]) => void;
}> = ({ def, selectedRows, onActionDef }) => {
  const isDestructive = isDestructiveBulkDef(def);
  const iconName = def.icon ? toKebabIconName(def.icon) : null;
  return (
    <Button
      variant={isDestructive ? 'destructive' : 'outline'}
      size="sm"
      className="h-8 shrink-0 gap-1.5"
      onClick={() => onActionDef?.(def, selectedRows)}
      data-testid={`bulk-action-${def.name}`}
    >
      {iconName ? (
        <LazyIcon name={iconName} className="h-4 w-4" />
      ) : isDestructive ? (
        <Trash2 className="h-4 w-4" />
      ) : null}
      {def.label ?? formatActionLabel(def.name)}
    </Button>
  );
};
