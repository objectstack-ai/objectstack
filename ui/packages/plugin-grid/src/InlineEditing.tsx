/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * InlineEditing Component
 *
 * A reusable inline cell editor for grid views. Provides save/cancel
 * controls and validation feedback. Designed to be integrated into
 * ObjectGrid or VirtualGrid rows.
 *
 * Features:
 * - Click-to-edit with automatic focus
 * - Save (Enter / ✓) and Cancel (Escape / ✗) actions
 * - Validation feedback with error messages
 * - Keyboard navigation (Enter to save, Escape to cancel)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@object-ui/components';
import { Check, X } from 'lucide-react';

export interface InlineEditingProps {
  /** Current cell value */
  value: any;
  /** Called with new value on save. Return a string to signal validation error. */
  onSave: (newValue: any) => void | string | Promise<void | string>;
  /** Called when editing is cancelled */
  onCancel?: () => void;
  /** Validate before saving. Return error message or undefined. */
  validate?: (value: any) => string | undefined;
  /** Field type hint used to determine input type */
  type?: 'text' | 'number' | 'email';
  /** Placeholder text */
  placeholder?: string;
  /** Whether the cell is in editing mode initially */
  editing?: boolean;
  /** Additional class names */
  className?: string;
  /** Whether this field is disabled */
  disabled?: boolean;
}

export function InlineEditing({
  value,
  onSave,
  onCancel,
  validate,
  type = 'text',
  placeholder,
  editing: editingProp = false,
  className,
  disabled = false,
}: InlineEditingProps) {
  const [isEditing, setIsEditing] = useState(editingProp);
  const [editValue, setEditValue] = useState<string>(String(value ?? ''));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // `justSaved` flips to true for ~700ms after a successful save so the
  // display cell can briefly show a "✓ saved" affirmation (subtle green
  // ring + check icon fade). Users sometimes re-click cells they just
  // edited because saves are silent; this closes that feedback gap
  // without resorting to a heavyweight toast for every cell change.
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending timer on unmount so we don't setState into a torn-down
  // tree (common when grid rows recycle during virtual scrolling).
  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  // Sync with prop changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(String(value ?? ''));
    }
  }, [value, isEditing]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = useCallback(() => {
    if (disabled) return;
    setIsEditing(true);
    setEditValue(String(value ?? ''));
    setError(undefined);
  }, [disabled, value]);

  const cancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(String(value ?? ''));
    setError(undefined);
    onCancel?.();
  }, [value, onCancel]);

  const save = useCallback(async () => {
    // Run validation
    if (validate) {
      const validationError = validate(editValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    // Coerce number values
    const coercedValue = type === 'number' ? Number(editValue) : editValue;

    setSaving(true);
    try {
      const result = await onSave(coercedValue);
      if (typeof result === 'string') {
        setError(result);
        setSaving(false);
        return;
      }
      setIsEditing(false);
      setError(undefined);
      // Trigger the success pulse on the display cell.
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setJustSaved(true);
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 900);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editValue, validate, type, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [save, cancel],
  );

  // Display mode
  if (!isEditing) {
    return (
      <div
        data-slot="inline-editing"
        data-just-saved={justSaved || undefined}
        className={cn(
          'group relative cursor-pointer rounded px-2 py-1 hover:bg-muted/50 transition-all min-h-[1.75rem] flex items-center',
          // Brief green ring + tint immediately after a successful save.
          // Falls back to a static ring (no pulse) under reduced-motion.
          justSaved && 'ring-2 ring-emerald-500/60 bg-emerald-500/5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200',
          disabled && 'cursor-default opacity-60',
          className,
        )}
        onClick={startEditing}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startEditing();
          }
        }}
        aria-label={`Edit value: ${String(value ?? '')}`}
      >
        <span data-slot="inline-editing-display" className="truncate text-sm">
          {value != null && String(value) !== '' ? String(value) : (
            <span className="text-muted-foreground italic">{placeholder || 'Click to edit'}</span>
          )}
        </span>
        {justSaved && (
          <Check
            className="ml-1.5 h-3.5 w-3.5 text-emerald-500 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200"
            aria-hidden
          />
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div
      data-slot="inline-editing"
      className={cn('relative flex items-center gap-1', className)}
    >
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          data-slot="inline-editing-input"
          type={type}
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            if (error) setError(undefined);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={saving}
          aria-invalid={!!error}
          aria-describedby={error ? 'inline-editing-error' : undefined}
          className={cn(
            'w-full rounded border px-2 py-1 text-sm outline-none transition-colors',
            'focus:ring-2 focus:ring-ring focus:border-input',
            error
              ? 'border-destructive focus:ring-destructive/30'
              : 'border-input',
            saving && 'opacity-50',
          )}
        />
        {error && (
          <p
            id="inline-editing-error"
            data-slot="inline-editing-error"
            className="absolute left-0 top-full mt-0.5 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <button
        data-slot="inline-editing-save"
        type="button"
        onClick={save}
        disabled={saving}
        aria-label="Save"
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-primary/10 transition-colors',
          saving && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        data-slot="inline-editing-cancel"
        type="button"
        onClick={cancel}
        disabled={saving}
        aria-label="Cancel"
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
