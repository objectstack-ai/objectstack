/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useActionEngine — React hook wrapping ActionEngine for location-based action management.
 *
 * Provides declarative access to the ActionEngine's location filtering, bulk operations,
 * keyboard shortcut handling, and execution pipeline from React components.
 *
 * @example
 * ```tsx
 * const { getActionsForLocation, executeAction } = useActionEngine({
 *   actions: schema.actions,
 *   context: { record, user },
 * });
 *
 * const toolbarActions = getActionsForLocation('list_toolbar');
 * ```
 */

import { useCallback, useContext, useMemo } from 'react';
import {
  ActionEngine,
  subjectPermissionsOf,
  type ActionLocation,
  type ActionDef,
  type ActionContext,
  type ActionResult,
} from '@object-ui/core';
import { ActionCtxReact } from '../context/ActionContext.js';
import { usePredicateScope } from './useExpression.js';

export interface UseActionEngineOptions {
  /** Action definitions to register */
  actions?: ActionDef[];
  /** Action context (record, user, etc.) */
  context?: ActionContext;
}

export interface UseActionEngineReturn {
  /** Get actions available at a specific location, sorted by priority */
  getActionsForLocation: (location: ActionLocation) => ActionDef[];
  /** Get actions that support bulk operations */
  getBulkActions: () => ActionDef[];
  /** Execute an action by name */
  executeAction: (name: string, contextOverride?: Partial<ActionContext>) => Promise<ActionResult>;
  /** Handle a keyboard shortcut */
  handleShortcut: (keys: string) => Promise<ActionResult | null>;
  /** The underlying ActionEngine instance */
  engine: ActionEngine;
}

export function useActionEngine(options: UseActionEngineOptions = {}): UseActionEngineReturn {
  const { actions = [], context = {} } = options;
  // When wrapped in an <ActionProvider>, reuse its ActionRunner so that:
  //   • Visibility / disabled / condition CEL expressions evaluate against
  //     the same context (user, datasource, etc.) the provider was seeded
  //     with — not just the per-call `context` arg.
  //   • Action execution (executeAction / handleShortcut) inherits the
  //     provider's confirm / param-collection / modal / result-dialog /
  //     toast / navigate handlers. Without sharing, a nested engine would
  //     silently no-op on any action that declares `params: [...]` or
  //     `confirmText`, because its local runner has no handlers installed.
  // When no provider is present (unit tests, standalone playgrounds), we
  // fall back to a self-contained runner constructed from the `context` arg.
  const providerCtx = useContext(ActionCtxReact);
  const sharedRunner = providerCtx?.runner ?? null;

  // The acting subject the host's predicate scope binds as `current_user`
  // (objectui#11212): the ONE object `ExpressionProvider` publishes under
  // `current_user` / `user` / `ctx.user` / `os.user`, carrying the caller's
  // effective object permissions once they have loaded. The engine filters
  // `visible` against the RUNNER's bag, which a host seeds with its own `user`
  // and never with `current_user` — so `current_user.can(…)`, and any other
  // `current_user.*` predicate, faulted on this path in every state and the
  // action was hidden even for a grant holder, while the same predicate
  // answered on every predicate-scope surface. Binding the scope's subject
  // itself — the same object, not a copy, because the engine answers `can`
  // only for a receiver IDENTICAL to the bound `current_user` — is what makes
  // the two paths one bag (objectui#6493). With no host scope (`{}`) nothing
  // is bound and the path behaves as it always did.
  //
  // Only `current_user` is added. The runner's `user` / `ctx.user` / `os.user`
  // stay the host's own object: it carries what the runner itself reads (the
  // `systemPermissions` capability set), which the scope's subject does not.
  //
  // Since objectui#11242 `<ActionProvider>` binds the same subject on its own
  // runner, so under a provider mounted INSIDE the predicate scope this write
  // re-binds the object that is already there. It stays for the two runners
  // no provider binds: this hook's own standalone runner (no provider at
  // all), and a shared runner whose provider sits ABOVE the scope — the
  // console's global provider does (`GlobalActionRuntimeProvider` wraps the
  // routes, and `ExpressionProvider` is mounted inside them) — where the
  // provider has no scope to read.
  const subject = usePredicateScope().current_user as Record<string, unknown> | undefined;
  // Keyed on what the binding READS, never on the subject's identity (a
  // memoised value upstream — AGENTS.md #10): its serialisable fields, and the
  // permissions map it carries, which the upstream adapter caches per payload
  // outside React. A discarded-and-recomputed subject with the same content
  // keeps the engine; the permissions arriving (or leaving) rebuilds it.
  const subjectKey = subject === undefined ? '' : JSON.stringify(subject);
  const subjectPermissions = subjectPermissionsOf(subject);

  const engine = useMemo(() => {
    const bound: Partial<ActionContext> = subject !== undefined ? { current_user: subject } : {};
    // When standalone (no surrounding `<ActionProvider>`), normalize the
    // context so predicates can use both `record`/`user` and `ctx.*`.
    const normalizedStandalone = (context && Object.keys(context).length > 0)
      ? {
          ...context,
          ctx: ((context as any).ctx && typeof (context as any).ctx === 'object')
            ? { ...context, ...(context as any).ctx }
            : { ...context },
          ...bound,
        }
      : { ...context, ...bound };
    const e = sharedRunner ? new ActionEngine(sharedRunner) : new ActionEngine(normalizedStandalone as any);
    // When sharing a provider runner, MERGE per-render flat keys into the
    // existing `ctx` instead of overwriting it. The provider seeds
    // `ctx: { record, user, objectName, … }` once; if we replaced it with
    // just `ctx: { record, recordId, objectName }` here we would erase
    // `ctx.user` and every `record.id == ctx.user.id` predicate would
    // evaluate against `undefined.id` (→ throws → hidden).
    if (sharedRunner && context && Object.keys(context).length > 0) {
      const runner = e.getRunner();
      const existing = runner.getEvaluator().getContext().toObject() as Record<string, any>;
      const existingCtx = (existing && typeof existing.ctx === 'object') ? existing.ctx : {};
      const callerCtx = ((context as any).ctx && typeof (context as any).ctx === 'object')
        ? (context as any).ctx
        : context;
      const merged = {
        ...context,
        ctx: { ...existingCtx, ...callerCtx },
        ...bound,
      };
      runner.updateContext(merged as any);
    } else if (sharedRunner && subject !== undefined) {
      // A caller that passes no per-render keys: the subject is still bound,
      // onto the same shared runner the location filter reads.
      e.getRunner().updateContext(bound);
    }
    e.registerActions(actions);
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedRunner, JSON.stringify(actions), JSON.stringify(context), subjectKey, subjectPermissions]);

  const getActionsForLocation = useCallback(
    (location: ActionLocation) => engine.getActionsForLocation(location),
    [engine],
  );

  const getBulkActions = useCallback(() => engine.getBulkActions(), [engine]);

  const executeAction = useCallback(
    (name: string, contextOverride?: Partial<ActionContext>) =>
      engine.executeAction(name, contextOverride),
    [engine],
  );

  const handleShortcut = useCallback(
    (keys: string) => engine.handleShortcut(keys),
    [engine],
  );

  return { getActionsForLocation, getBulkActions, executeAction, handleShortcut, engine };
}
