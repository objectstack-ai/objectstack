/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Toast helpers — convention-encoding wrappers around `sonner` so
 * destructive flows (delete, archive, bulk-update) consistently expose
 * an Undo affordance.
 *
 * Why a helper instead of raw `toast.success(...)` at call sites:
 *   1. Most "delete OK" toasts in the codebase do not offer Undo, even
 *      when the underlying API supports a reversal. The helper makes
 *      adding Undo a one-line change.
 *   2. The label, duration, and aria semantics stay consistent across
 *      surfaces — recently-deleted records, archived comments, bulk
 *      operations — so users don't have to relearn the affordance per
 *      view.
 *
 * Usage:
 *
 *   import { toastWithUndo } from '@object-ui/app-shell';
 *
 *   toastWithUndo('Lead deleted', {
 *     onUndo: () => dataSource.restore('lead', id),
 *   });
 */

import { toast, type ExternalToast } from 'sonner';

export interface ToastWithUndoOptions extends ExternalToast {
  /**
   * Callback invoked when the user clicks the Undo action. May return a
   * promise; the toast stays visible until it resolves and a follow-up
   * success/error toast is emitted automatically.
   */
  onUndo: () => void | Promise<unknown>;
  /** Label for the Undo button. Defaults to "Undo". */
  undoLabel?: string;
  /** Toast intent. Defaults to "success" (green check). */
  intent?: 'success' | 'info' | 'warning';
  /**
   * Toast visible duration in ms. Slightly longer than default 4s so
   * users have time to click Undo on screen-edge toasts.
   */
  duration?: number;
}

export function toastWithUndo(message: string, opts: ToastWithUndoOptions) {
  const {
    onUndo,
    undoLabel = 'Undo',
    intent = 'success',
    duration = 6000,
    action: _ignoredAction,
    ...rest
  } = opts;

  const emitter =
    intent === 'warning'
      ? toast.warning
      : intent === 'info'
        ? toast.info
        : toast.success;

  return emitter(message, {
    duration,
    action: {
      label: undoLabel,
      onClick: async () => {
        try {
          const result = onUndo();
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            await result;
          }
          toast.success('Action undone');
        } catch (err) {
          toast.error('Could not undo', {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      },
    },
    ...rest,
  });
}
