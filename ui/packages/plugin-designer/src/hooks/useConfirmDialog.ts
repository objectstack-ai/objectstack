/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useRef } from 'react';

/**
 * What {@link useConfirmDialog} returns: the dialog's state plus the
 * functions that drive it.
 *
 * `Designer`-prefixed, as `DesignerHistoryState` is: app-shell's
 * `ConfirmDialogState` is a different thing (the data its action-confirm
 * dialog renders, with the promise's resolver), and one exported name has one
 * authority (objectui#6349, batch 6).
 */
export interface DesignerConfirmDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Title for the dialog */
  title: string;
  /** Message for the dialog */
  message: string;
  /** Open the dialog with a message, returns a promise that resolves to true/false */
  confirm: (title: string, message: string) => Promise<boolean>;
  /** Handle user accepting */
  onConfirm: () => void;
  /** Handle user cancelling */
  onCancel: () => void;
}

/**
 * Hook for confirmation dialogs before destructive actions.
 */
export function useConfirmDialog(): DesignerConfirmDialogState {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    setTitle(title);
    setMessage(message);
    setIsOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const onConfirm = useCallback(() => {
    setIsOpen(false);
    resolverRef.current?.(true);
    resolverRef.current = null;
  }, []);

  const onCancel = useCallback(() => {
    setIsOpen(false);
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  return { isOpen, title, message, confirm, onConfirm, onCancel };
}
