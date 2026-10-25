/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useUndoRedo, type UndoRedoOptions, type UndoRedoState } from './useUndoRedo';

/** Options for the designer history hook */
export type DesignerHistoryOptions = UndoRedoOptions;

/** Designer history state — command-pattern wrapper around undo/redo */
export type DesignerHistoryState<T> = UndoRedoState<T>;

/**
 * Hook providing command-pattern undo/redo history for designer components.
 *
 * Wraps {@link useUndoRedo} with designer-specific naming conventions.
 * Each `push()` call records a snapshot; `undo()` / `redo()` navigate
 * the history stack. The `reset()` method clears all history.
 *
 * @example
 * ```ts
 * const history = useDesignerHistory<DesignerState>(initialState, { maxHistory: 50 });
 * history.push(newState);
 * history.undo();
 * history.redo();
 * ```
 */
export function useDesignerHistory<T>(
  initialState: T,
  options: DesignerHistoryOptions = {},
): DesignerHistoryState<T> {
  return useUndoRedo<T>(initialState, options);
}
