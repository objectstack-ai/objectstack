/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@object-ui/components';
import { FunctionSquare, Check, X } from 'lucide-react';

export interface FormulaBarProps {
  /** Current cell value displayed in the bar. */
  value: string;
  /** Called when the user edits the value (controlled input). */
  onChange?: (value: string) => void;
  /** Called when the user confirms the edit (Enter or check button). */
  onConfirm?: (value: string) => void;
  /** Called when the user cancels the edit (Escape or X button). */
  onCancel?: () => void;
  /** Label describing the active cell, e.g. "A1" or "name". */
  activeCell?: string;
  /** Whether editing is disabled. */
  disabled?: boolean;
  /** Additional class names. */
  className?: string;
}

/**
 * Excel-like formula bar that displays and allows editing of the active cell's
 * value.  Press Enter (or the ✓ button) to confirm, Escape (or the ✗ button)
 * to cancel.
 */
export function FormulaBar({
  value,
  onChange,
  onConfirm,
  onCancel,
  activeCell,
  disabled = false,
  className,
}: FormulaBarProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value when not editing.
  useEffect(() => {
    if (!editing) {
      setEditValue(value);
    }
  }, [value, editing]);

  // Auto-focus on edit start.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = useCallback(() => {
    if (disabled) return;
    setEditing(true);
    setEditValue(value);
  }, [disabled, value]);

  const confirm = useCallback(() => {
    setEditing(false);
    onChange?.(editValue);
    onConfirm?.(editValue);
  }, [editValue, onChange, onConfirm]);

  const cancel = useCallback(() => {
    setEditing(false);
    setEditValue(value);
    onCancel?.();
  }, [value, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [confirm, cancel],
  );

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5',
        className,
      )}
    >
      {/* f(x) indicator */}
      <FunctionSquare className="h-4 w-4 shrink-0 text-muted-foreground" />

      {/* Active cell label */}
      {activeCell && (
        <span className="min-w-[4rem] shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {activeCell}
        </span>
      )}

      {/* Value input */}
      <input
        ref={inputRef}
        type="text"
        value={editing ? editValue : value}
        readOnly={!editing}
        disabled={disabled}
        onClick={startEditing}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          editing && 'rounded ring-1 ring-ring px-1',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      />

      {/* Confirm / Cancel buttons (visible only while editing) */}
      {editing && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={confirm}
            className="rounded p-0.5 text-green-600 hover:bg-green-100"
            aria-label="Confirm"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded p-0.5 text-red-600 hover:bg-red-100"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
