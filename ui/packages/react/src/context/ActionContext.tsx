/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/react - Action Context
 *
 * Provides a shared ActionRunner instance and handlers to the component tree.
 * Components can consume actions without creating their own runner instances.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  ActionRunner,
  subjectPermissionsOf,
  type ActionContext as ActionCtx,
  type ActionDef,
  type ActionResult,
  type ConfirmationHandler,
  type ToastHandler,
  type ModalHandler,
  type NavigationHandler,
  type ParamCollectionHandler,
  type ResultDialogHandler,
} from '@object-ui/core';
import { useActionRunnerTranslator } from './actionRunnerTranslator.js';
import { usePredicateScope } from '../hooks/useExpression.js';

export interface ActionProviderProps {
  children: React.ReactNode;
  /** Initial action context (record, user, data, etc.) */
  context?: ActionCtx;
  /** Custom confirmation handler (e.g., Shadcn AlertDialog) */
  onConfirm?: ConfirmationHandler;
  /** Custom toast handler (e.g., Sonner) */
  onToast?: ToastHandler;
  /** Custom modal handler — render modals in response to modal actions */
  onModal?: ModalHandler;
  /** Custom navigation handler — SPA-aware routing (e.g., React Router navigate) */
  onNavigate?: NavigationHandler;
  /** Custom param collection handler — show dialog to collect ActionParam values */
  onParamCollection?: ParamCollectionHandler;
  /** Custom result-dialog handler — show one-shot reveal of API response after success */
  onResultDialog?: ResultDialogHandler;
  /** Pre-registered custom action handlers */
  handlers?: Record<string, (action: ActionDef, ctx: ActionCtx) => Promise<ActionResult>>;
}

interface ActionContextValue {
  /** Execute an action */
  execute: (action: ActionDef) => Promise<ActionResult>;
  /** Execute multiple actions in chain */
  executeChain: (actions: ActionDef[], mode?: 'sequential' | 'parallel') => Promise<ActionResult>;
  /** Whether an action is currently being executed */
  loading: boolean;
  /** Last error message */
  error: string | null;
  /** Last action result */
  result: ActionResult | null;
  /** The underlying ActionRunner instance */
  runner: ActionRunner;
  /** Update context data */
  updateContext: (ctx: Partial<ActionCtx>) => void;
}

export const ActionCtxReact = createContext<ActionContextValue | null>(null);

/**
 * ActionProvider — Provides a shared ActionRunner to the tree.
 *
 * @example
 * ```tsx
 * <ActionProvider
 *   context={{ record: currentRecord, user }}
 *   onToast={(msg, opts) => toast[opts?.type ?? 'info'](msg)}
 *   onConfirm={async (msg) => showConfirmDialog(msg)}
 *   onNavigate={(url) => router.push(url)}
 * >
 *   <SchemaRenderer schema={pageSchema} />
 * </ActionProvider>
 * ```
 */
export const ActionProvider: React.FC<ActionProviderProps> = ({
  children,
  context = {},
  onConfirm,
  onToast,
  onModal,
  onNavigate,
  onParamCollection,
  onResultDialog,
  handlers,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  // The runner's own copy (the generic success toast) in the session's language.
  const translate = useActionRunnerTranslator();

  const runner = useMemo(() => {
    // Normalize the evaluator scope so predicates can use *either* flat
    // (`record`, `user`, `objectName`) *or* the canonical `ctx.*` namespace
    // (`ctx.user`, `ctx.record`, `ctx.objectName`). The CEL/predicate
    // convention used across the platform (sys-user, sys-invitation,
    // skills/objectstack-formula, …) is `ctx.user.id` — exposing both
    // shapes from one place keeps every consumer working without forcing
    // every call site to repeat the same `{ ..., ctx: { ... } }` boilerplate.
    const normalizedContext = {
      ...context,
      ctx: (context && typeof (context as any).ctx === 'object')
        ? { ...context, ...(context as any).ctx }
        : { ...context },
    } as ActionCtx;
    const r = new ActionRunner(normalizedContext);
    r.setTranslator(translate);
    if (onConfirm) r.setConfirmHandler(onConfirm);
    if (onToast) r.setToastHandler(onToast);
    if (onModal) r.setModalHandler(onModal);
    if (onNavigate) r.setNavigationHandler(onNavigate);
    if (onParamCollection) r.setParamCollectionHandler(onParamCollection);
    if (onResultDialog) r.setResultDialogHandler(onResultDialog);
    if (handlers) {
      Object.entries(handlers).forEach(([name, handler]) => {
        r.registerHandler(name, handler);
      });
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(context)]);

  // The acting subject the surrounding predicate scope binds as `current_user`
  // (objectui#11242): the ONE object `ExpressionProvider` publishes under
  // `current_user` / `user` / `ctx.user` / `os.user`, carrying the caller's
  // effective object permissions once they have loaded. The runner evaluates
  // its own gates — `execute`'s `disabled` re-check, `params[].visible`, the
  // engine's `visible` filter — against ITS bag, which a host seeds with its
  // own `user` and never with `current_user`. Bound here, every `execute` gate
  // under this provider answers `current_user.can(…)` and every other
  // `current_user.*` predicate, whatever else the page mounts. Before, only
  // `useActionEngine` wrote it onto a shared runner, so the answer depended on
  // whether the page happened to mount `record:quick_actions`, `record:alert`
  // or a dashboard (the objectui#6493 "one bag" rule, broken per page).
  //
  // The same object, not a copy: the engine answers `can` only for a receiver
  // IDENTICAL to the bound `current_user`. Only `current_user` is added — the
  // runner's `user` / `ctx.user` / `os.user` stay the host's object, which
  // carries the `systemPermissions` the capability gate reads — so on this bag
  // `user.can(…)` still faults while `current_user.can(…)` answers. With no
  // scope above this provider (`{}`) nothing is bound, and a host's own
  // `context.current_user`, if it passed one, is left as it is.
  //
  // Bound during render, before any child renders or executes, and keyed on
  // what the binding READS, never on the subject's identity (a memoised value
  // upstream — AGENTS.md #10): its serialisable fields, and the permissions map
  // it carries, which the upstream adapter caches per payload outside React. A
  // new runner (the host `context` changed) is bound again.
  const subject = usePredicateScope().current_user as Record<string, unknown> | undefined;
  const subjectKey = subject === undefined ? '' : JSON.stringify(subject);
  const subjectPermissions = subjectPermissionsOf(subject);
  useMemo(() => {
    if (subject !== undefined) runner.updateContext({ current_user: subject } as Partial<ActionCtx>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, subjectKey, subjectPermissions]);

  const execute = useCallback(
    async (action: ActionDef): Promise<ActionResult> => {
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const actionResult = await runner.execute(action);
        setResult(actionResult);
        if (!actionResult.success) {
          setError(actionResult.error || 'Action failed');
        }
        return actionResult;
      } catch (err) {
        const errorMessage = (err as Error).message;
        setError(errorMessage);
        const failureResult: ActionResult = { success: false, error: errorMessage };
        setResult(failureResult);
        return failureResult;
      } finally {
        setLoading(false);
      }
    },
    [runner],
  );

  const executeChain = useCallback(
    async (actions: ActionDef[], mode?: 'sequential' | 'parallel'): Promise<ActionResult> => {
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const actionResult = await runner.executeChain(actions, mode);
        setResult(actionResult);
        if (!actionResult.success) {
          setError(actionResult.error || 'Chain failed');
        }
        return actionResult;
      } catch (err) {
        const errorMessage = (err as Error).message;
        setError(errorMessage);
        const failureResult: ActionResult = { success: false, error: errorMessage };
        setResult(failureResult);
        return failureResult;
      } finally {
        setLoading(false);
      }
    },
    [runner],
  );

  const updateContext = useCallback(
    (newContext: Partial<ActionCtx>) => {
      runner.updateContext(newContext);
    },
    [runner],
  );

  const value = useMemo<ActionContextValue>(
    () => ({ execute, executeChain, loading, error, result, runner, updateContext }),
    [execute, executeChain, loading, error, result, runner, updateContext],
  );

  return (
    <ActionCtxReact.Provider value={value}>{children}</ActionCtxReact.Provider>
  );
};

ActionProvider.displayName = 'ActionProvider';

/**
 * Hook to consume the ActionProvider context.
 * Returns the shared ActionRunner execute function, loading state, and more.
 *
 * Falls back to a local ActionRunner if no ActionProvider is present.
 */
export function useAction(): ActionContextValue {
  const ctx = useContext(ActionCtxReact);
  if (!ctx) {
    // Graceful fallback: create a local runner
    // This allows action components to work even without an ActionProvider
    const runner = new ActionRunner();
    return {
      execute: (action: ActionDef) => runner.execute(action),
      executeChain: (actions: ActionDef[], mode?: 'sequential' | 'parallel') =>
        runner.executeChain(actions, mode),
      loading: false,
      error: null,
      result: null,
      runner,
      updateContext: (ctx: Partial<ActionCtx>) => runner.updateContext(ctx),
    };
  }
  return ctx;
}

/**
 * Hook to check if an ActionProvider is available.
 */
export function useHasActionProvider(): boolean {
  return useContext(ActionCtxReact) !== null;
}
