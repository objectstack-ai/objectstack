// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useNavActionDispatch — make `type: 'action'` navigation items actually run.
 *
 * ## The disconnect this closes (framework#4509)
 * `NavigationRenderer` renders an `action` nav item, gates it like any other
 * (permissions, capabilities, visibility), and dispatches the click to an
 * `onAction` prop it expects the HOST to supply — it never reads
 * `item.actionDef` itself. No shipped shell supplied that prop, so
 * `actionDef.actionName` reached no dispatcher: the item rendered, looked
 * enabled, and did nothing on click. The framework liveness ledger recorded it
 * as the one gap in the AppSchema navigation walk.
 *
 * ## Resolution
 * A nav item names an action (`actionDef.actionName`); it does not carry the
 * definition. `ActionEngine.executeAction` only knows names that were
 * registered with it, which a sidebar has no way to arrange — so the name is
 * resolved against `action` metadata at click time, the same source
 * `DeclaredActionsBar` reads for a record's toolbar.
 *
 * Note the scope: `ActionNavItemSchema` is `.strict()` with exactly
 * `{ actionName, params? }` — there is no `objectName`, so a nav action is
 * inherently a GLOBAL action (ADR-0110's `'*'` scope). Resolution is by name
 * alone, and an object-scoped action is not addressable from a nav item.
 *
 * Dispatch goes through `useAction()`, which under `GlobalActionRuntimeProvider`
 * (ConsoleShell) is the fully-wired console runner — api/flow/script handlers
 * plus the confirm, param-collection, result and navigate dialogs. The sidebar
 * already renders inside that provider, so no new wiring is needed.
 *
 * ## Failure is loud
 * Every failure path warns and toasts rather than returning silently. Silence
 * is precisely the bug being fixed: a nav item that names an action nobody
 * defined should say so, not reproduce the dead click through a different
 * route.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAction } from '@object-ui/react';
import type { NavigationItem } from '@object-ui/types';
import { useMetadata } from '../providers/MetadataProvider.js';

type ActionDefLike = Record<string, unknown> & { name?: string; params?: unknown };

export function useNavActionDispatch(): (item: NavigationItem) => void {
  const { execute } = useAction();
  const { getItem } = useMetadata();

  return useCallback((item: NavigationItem) => {
    void (async () => {
      const actionDef = (item as { actionDef?: { actionName?: string; params?: Record<string, unknown> } }).actionDef;
      const actionName = actionDef?.actionName;

      // The spec requires `actionDef` on this variant, but objectui's own
      // NavigationItem type keeps it optional (the two shapes are reconciled by
      // the navigation-spec-parity test, not by the compiler), so a nav item
      // can reach here naming nothing.
      if (!actionName) {
        console.warn('[nav] action item has no actionDef.actionName — nothing to dispatch', item?.id);
        toast.error('This menu item is not configured to run an action.');
        return;
      }

      let def: ActionDefLike | null;
      try {
        def = (await getItem('action', actionName)) as ActionDefLike | null;
      } catch (err) {
        console.warn(`[nav] failed to resolve action '${actionName}'`, err);
        toast.error(`Could not load action "${actionName}".`);
        return;
      }

      if (!def) {
        console.warn(`[nav] action '${actionName}' is not defined — nav item ${item?.id} cannot run`);
        toast.error(`Action "${actionName}" is not defined.`);
        return;
      }

      try {
        // Same dispatch shape as DeclaredActionsBar: forward the whole def
        // (type/target/confirmText/successMessage/…), and move a `params`
        // ARRAY out of the way into `actionParams`, which is the runner's
        // param-dialog input. `params` on the dispatch is the value bag, so the
        // nav item's own `actionDef.params` lands there — that is how an author
        // pre-fills an action from the menu entry.
        const { params: declaredParams, ...rest } = def;
        const dispatch: Record<string, unknown> = { ...rest };
        const staticParams = Array.isArray(declaredParams) ? declaredParams : [];
        if (staticParams.length > 0) dispatch.actionParams = staticParams;
        if (actionDef?.params && typeof actionDef.params === 'object') {
          dispatch.params = { ...(actionDef.params as Record<string, unknown>) };
        }
        // No `_rowRecord`: a sidebar click carries no record context. An action
        // that interpolates `{id}` is object-scoped and was never addressable
        // from a nav item anyway.
        await execute(dispatch as never);
      } catch (err) {
        console.warn(`[nav] action '${actionName}' failed`, err);
        toast.error(`Action "${actionName}" failed to run.`);
      }
    })();
  }, [execute, getItem]);
}
