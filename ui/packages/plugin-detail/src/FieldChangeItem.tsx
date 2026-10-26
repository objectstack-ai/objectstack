/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { ArrowRight } from 'lucide-react';
import type { FieldChangeEntry } from '@object-ui/types';

export interface FieldChangeItemProps {
  /** The field change entry to render */
  change: FieldChangeEntry;
  className?: string;
}

/**
 * FieldChangeItem — Renders a single field change entry.
 * Shows: field label → old value → new value with human-readable display values.
 * Aligned with @objectstack/spec FieldChangeEntrySchema.
 */
export const FieldChangeItem: React.FC<FieldChangeItemProps> = ({
  change,
  className,
}) => {
  const label =
    change.fieldLabel ??
    change.field.charAt(0).toUpperCase() + change.field.slice(1).replace(/_/g, ' ');

  const oldDisplay =
    change.oldDisplayValue ?? (change.oldValue != null ? String(change.oldValue) : '(empty)');
  const newDisplay =
    change.newDisplayValue ?? (change.newValue != null ? String(change.newValue) : '(empty)');

  return (
    <div className={cn('flex items-center gap-1.5 text-sm flex-wrap', className)}>
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground line-through">{oldDisplay}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-foreground">{newDisplay}</span>
    </div>
  );
};
