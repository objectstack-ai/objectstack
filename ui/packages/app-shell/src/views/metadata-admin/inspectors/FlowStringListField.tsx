// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowStringListField — a repeatable single-column editor for string-array
 * config (e.g. a notification's `recipients` or `channels`).
 *
 * Mirrors FlowKeyValueField's local-draft pattern: rows live in LOCAL state
 * with a STABLE id and only flush to `onCommit` on blur / Enter / add / remove,
 * so editing never remounts a row mid-keystroke. Empty rows are dropped on
 * flush; an empty list commits `undefined` so no empty array key is written.
 */

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input, Label } from '@object-ui/components';
import { RequiredMarker, uniqueId } from './_shared.js';

interface Row {
  id: string;
  value: string;
}

function toRows(list: string[], existingIds: string[]): Row[] {
  const ids = [...existingIds];
  return list.map((value) => {
    const id = uniqueId('sl', ids);
    ids.push(id);
    return { id, value };
  });
}

function rowsToList(rows: Row[]): string[] {
  return rows.map((r) => r.value.trim()).filter((v) => v !== '');
}

export interface FlowStringListFieldProps {
  label: string;
  value: unknown;
  onCommit: (value: string[] | undefined) => void;
  disabled?: boolean;
  addLabel: string;
  itemLabel: string;
  removeLabel: string;
  emptyLabel: string;
  /** The spec requires this list (objectui#10948): the label carries {@link RequiredMarker}. */
  required?: boolean;
}

export function FlowStringListField({
  label,
  value,
  onCommit,
  disabled,
  addLabel,
  itemLabel,
  removeLabel,
  emptyLabel,
  required,
}: FlowStringListFieldProps) {
  const external = React.useMemo(
    () => (Array.isArray(value) ? value.map((v) => String(v)) : []),
    [value],
  );
  const [rows, setRows] = React.useState<Row[]>(() => toRows(external, []));
  const lastCommitted = React.useRef(JSON.stringify(external));

  React.useEffect(() => {
    const next = JSON.stringify(external);
    if (next !== lastCommitted.current) {
      setRows(toRows(external, []));
      lastCommitted.current = next;
    }
  }, [external]);

  const flush = (nextRows: Row[]) => {
    const list = rowsToList(nextRows);
    lastCommitted.current = JSON.stringify(list);
    onCommit(list.length ? list : undefined);
  };

  const setRowValue = (id: string, v: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, value: v } : r)));
  };

  const addRow = () => {
    setRows((rs) => [...rs, { id: uniqueId('sl', rs.map((r) => r.id)), value: '' }]);
  };

  const removeRow = (id: string) => {
    setRows((rs) => {
      const next = rs.filter((r) => r.id !== id);
      flush(next);
      return next;
    });
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <RequiredMarker />}
      </Label>
      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground">{emptyLabel}</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <Input
              value={row.value}
              onChange={(e) => setRowValue(row.id, e.target.value)}
              onBlur={() => flush(rows)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              placeholder={itemLabel}
              disabled={disabled}
              className="h-8 flex-1 text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
              onClick={() => removeRow(row.id)}
              disabled={disabled}
              aria-label={removeLabel}
              title={removeLabel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
