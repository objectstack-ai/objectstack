/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage, cn } from '@object-ui/components';
import { X } from 'lucide-react';
import {
  getPersonName,
  getPersonInitials,
  getPersonAvatarUrl,
  getPersonId,
} from './personDisplay.js';

/**
 * "Selected" transfer-box area (穿梭框式已选区): live echo of the current
 * multi-selection as removable avatar chips. Reusable kernel — the future
 * org-tree tier composes the same tray beside its right-hand list. Purely
 * presentational: it takes the resolved records + an onRemove callback, and
 * accepts already-translated `label`/`emptyText` so it stays i18n-agnostic.
 */
export interface SelectionTrayProps {
  /** Full record objects for the current selection. */
  records: any[];
  /** Remove a selected record by its id. */
  onRemove: (id: any) => void;
  displayField?: string;
  /**
   * The fields each chip's name is read from, in order; defaults to the ladder
   * of `displayField` (`getPersonNameFields`). PeoplePicker passes the fields
   * of that ladder the loaded policy lets the viewer read (objectui#10535).
   */
  nameFields?: string[];
  /**
   * Avatar image field (default `image`). `null` draws no image, only the
   * initials: what PeoplePicker passes when field-level security withholds the
   * field (objectui#10433).
   */
  avatarField?: string | null;
  idField?: string;
  /** Header label, e.g. "Selected (3)" — omit to hide the header. */
  label?: string;
  /** When provided, a "Clear all" action shows in the header while non-empty. */
  onClear?: () => void;
  /** Localized "Clear all" text (i18n-agnostic — caller passes it). */
  clearLabel?: string;
  /** Shown when the selection is empty. */
  emptyText?: string;
  className?: string;
}

export function SelectionTray({
  records,
  onRemove,
  displayField = 'name',
  nameFields,
  avatarField = 'image',
  idField = 'id',
  label,
  onClear,
  clearLabel,
  emptyText,
  className,
}: SelectionTrayProps) {
  const showHeader = !!label || (!!onClear && records.length > 0);
  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid="selection-tray">
      {showHeader && (
        <div className="flex items-center justify-between">
          {label && <div className="text-xs font-medium text-muted-foreground">{label}</div>}
          {onClear && records.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              data-testid="selection-clear"
            >
              {clearLabel ?? 'Clear all'}
            </button>
          )}
        </div>
      )}
      {records.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyText ?? ''}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {records.map(record => {
            const id = getPersonId(record, idField);
            const name = getPersonName(record, nameFields ?? displayField);
            const avatarUrl = getPersonAvatarUrl(record, avatarField);
            const initials = getPersonInitials(name);
            return (
              <span
                key={String(id)}
                data-testid="selection-chip"
                className="inline-flex items-center gap-1.5 rounded-full border bg-background py-0.5 pl-0.5 pr-1.5 text-sm"
              >
                <Avatar className="size-6 shrink-0">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
                <span className="max-w-[10rem] truncate">{name || '—'}</span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  aria-label={`Remove ${name}`}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
