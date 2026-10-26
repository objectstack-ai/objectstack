/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  ActionRunner,
  type ActionContext,
  type ActionDef,
  type ActionResult,
  type ConfirmationHandler,
  type ToastHandler,
  type ModalHandler,
  type NavigationHandler,
  type ParamCollectionHandler,
  type ResultDialogHandler,
} from '@object-ui/core';
import { useActionRunnerTranslator } from '../context/actionRunnerTranslator.js';

export interface UseActionRunnerOptions {
  context?: ActionContext;
  /** Custom confirmation handler — wire to Shadcn AlertDialog or similar */
  onConfirm?: ConfirmationHandler;
  /** Custom toast handler — wire to Sonner or similar */
  onToast?: ToastHandler;
  /** Custom modal handler — render modals in response to modal actions */
  onModal?: ModalHandler;
  /** Custom navigation handler — SPA-aware routing */
  onNavigate?: NavigationHandler;
  /** Custom param-collection handler — show dialog to gather params before execution */
  onParamCollection?: ParamCollectionHandler;
  /** Custom result-dialog handler — one-shot reveal of API response on success */
  onResultDialog?: ResultDialogHandler;
}

/**
 * Hook for executing actions with loading state, typed with ActionDef.
 * 
 * @example
 * ```tsx
 * const { execute, loading, error, result } = useActionRunner({
 *   context: { data: formData },
 *   onToast: (msg, opts) => toast[opts?.type || 'info'](msg),
 * });
 * 
 * const handleClick = () => {
 *   execute({
 *     type: 'api',
 *     api: '/api/save',
 *     successMessage: 'Saved successfully!',
 *   });
 * };
 * ```
 */
export function useActionRunner(
  optionsOrContext: UseActionRunnerOptions | ActionContext = {},
) {
  // Backwards compat: if no 'context' key, treat entire object as context
  const options: UseActionRunnerOptions = 'context' in optionsOrContext
    ? optionsOrContext as UseActionRunnerOptions
    : { context: optionsOrContext as ActionContext };

  const { context = {}, onConfirm, onToast, onModal, onNavigate, onParamCollection, onResultDialog } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  // The runner's own copy (the generic success toast) in the session's language.
  const translate = useActionRunnerTranslator();

  const runner = useMemo(() => {
    const r = new ActionRunner(context);
    r.setTranslator(translate);
    if (onConfirm) r.setConfirmHandler(onConfirm);
    if (onToast) r.setToastHandler(onToast);
    if (onModal) r.setModalHandler(onModal);
    if (onNavigate) r.setNavigationHandler(onNavigate);
    if (onParamCollection) r.setParamCollectionHandler(onParamCollection);
    if (onResultDialog) r.setResultDialogHandler(onResultDialog);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(context)]);

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
        const failureResult = { success: false, error: errorMessage };
        setResult(failureResult);
        return failureResult;
      } finally {
        setLoading(false);
      }
    },
    [runner]
  );

  const updateContext = useCallback(
    (newContext: Partial<ActionContext>) => {
      runner.updateContext(newContext);
    },
    [runner]
  );

  return {
    execute,
    loading,
    error,
    result,
    updateContext,
    runner
  };
}
