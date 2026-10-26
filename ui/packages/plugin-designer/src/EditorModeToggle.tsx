/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * EditorModeToggle Component
 *
 * Three-way toggle for switching between Edit, Preview, and Code modes.
 * Used across all designer components for consistent mode switching.
 */

import React from 'react';
import type { EditorMode } from '@object-ui/types';
import { Pencil, Eye, Code } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export interface EditorModeToggleProps {
  /** Current mode */
  mode: EditorMode;
  /** Callback when mode changes */
  onChange: (mode: EditorMode) => void;
  /** Disable mode switching */
  disabled?: boolean;
  /** CSS class */
  className?: string;
}

const MODES: Array<{ value: EditorMode; label: string; Icon: React.FC<{ className?: string }> }> = [
  { value: 'edit', label: 'Edit', Icon: Pencil },
  { value: 'preview', label: 'Preview', Icon: Eye },
  { value: 'code', label: 'Code', Icon: Code },
];

/**
 * Three-way toggle for Edit / Preview / Code modes.
 *
 * @example
 * ```tsx
 * <EditorModeToggle mode={mode} onChange={setMode} />
 * ```
 */
export function EditorModeToggle({
  mode,
  onChange,
  disabled = false,
  className,
}: EditorModeToggleProps) {
  return (
    <div
      data-testid="editor-mode-toggle"
      className={cn(
        'inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5',
        className
      )}
      role="radiogroup"
      aria-label="Editor mode"
    >
      {MODES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          data-testid={`editor-mode-${value}`}
          onClick={() => onChange(value)}
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            mode === value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

export default EditorModeToggle;
