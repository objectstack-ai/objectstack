/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

/** The item a value none of a select field's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — a `select` field's editor, drawn with the shared `Select`,
 * the control the rest of the console picks with. It used to be a
 * browser-native `<select>`. What a pick writes is unchanged: `onPick`
 * receives the picked option's own `value`, the string the native control's
 * `change` carried, and the field passes it to `onChange` as before.
 * Re-picking the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. A caller's option may
 *   carry `''`, which `SelectItem` refuses; an index cannot collide with any
 *   option's value, as a stand-in string could.
 * - The value is matched as the native control matched it: the field's value
 *   as a string, `''` when it has none.
 * - A value none of the options carries gets an item of its own, labelled
 *   with the value, so the trigger shows what the field holds. The native
 *   control showed its first option there, which is not what the field says.
 *   Picking that item writes nothing. A field with no value gets no such item:
 *   the trigger shows nothing.
 * - The panel has no read-only state, and the field's caption names no
 *   control, as it named none before.
 */
function PropertySelect({
  value,
  options,
  onPick,
}: {
  value: string;
  options: ReadonlyArray<{ label: string; value: string }>;
  onPick: (value: string) => void;
}) {
  const at = options.findIndex((o) => o.value === value);
  const outside = at === -1 && value !== '';
  return (
    <Select
      value={at !== -1 ? String(at) : outside ? OUTSIDE_OPTIONS : ''}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the field's own value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger className="h-auto px-2 py-1 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outside && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface PropertyField {
  /** Property name */
  name: string;
  /** Display label */
  label: string;
  /** Editor type */
  type: 'text' | 'number' | 'boolean' | 'select' | 'color' | 'textarea';
  /** Current value */
  value: unknown;
  /** Options for select type */
  options?: Array<{ label: string; value: string }>;
  /** Group name */
  group?: string;
  /** Description / help text */
  description?: string;
  /** Whether changes apply in real-time (live preview) */
  livePreview?: boolean;
}

export interface PropertyEditorProps {
  /** Title of the property panel */
  title?: string;
  /** Properties to edit */
  fields: PropertyField[];
  /** Called when a property value changes */
  onChange: (name: string, value: unknown) => void;
  /** CSS class */
  className?: string;
}

/**
 * Property editor panel with live preview support.
 * Groups properties by category and provides appropriate editors for each type.
 */
export function PropertyEditor({
  title = 'Properties',
  fields,
  onChange,
  className,
}: PropertyEditorProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  // Group fields by group name
  const grouped = fields.reduce<Record<string, PropertyField[]>>((acc, field) => {
    const group = field.group ?? 'General';
    if (!acc[group]) acc[group] = [];
    acc[group].push(field);
    return acc;
  }, {});

  return (
    <div className={cn('flex flex-col', className)} role="region" aria-label={title}>
      <div className="p-3 border-b font-medium text-sm">{title}</div>
      <div className="flex-1 overflow-y-auto">
        {Object.entries(grouped).map(([group, groupFields]) => (
          <div key={group} className="border-b last:border-b-0">
            <button type="button"
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50"
            >
              {collapsedGroups.has(group)
                ? <ChevronRight className="h-3 w-3" />
                : <ChevronDown className="h-3 w-3" />}
              {group}
            </button>
            {!collapsedGroups.has(group) && (
              <div className="px-3 pb-2 space-y-2">
                {groupFields.map((field) => (
                  <PropertyFieldEditor key={field.name} field={field} onChange={onChange} />
                ))}
              </div>
            )}
          </div>
        ))}
        {fields.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground text-center">
            Select an element to edit its properties
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyFieldEditor({ field, onChange }: { field: PropertyField; onChange: (name: string, value: unknown) => void }) {
  const handleChange = (value: unknown) => {
    onChange(field.name, value);
  };

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{field.label}</label>
      {field.type === 'text' && (
        <input
          type="text"
          value={String(field.value ?? '')}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded bg-background"
        />
      )}
      {field.type === 'number' && (
        <input
          type="number"
          value={Number(field.value ?? 0)}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="w-full px-2 py-1 text-xs border rounded bg-background"
        />
      )}
      {field.type === 'boolean' && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(field.value)}
            onChange={(e) => handleChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">{field.value ? 'Yes' : 'No'}</span>
        </label>
      )}
      {field.type === 'select' && (
        <PropertySelect
          value={String(field.value ?? '')}
          options={field.options ?? []}
          onPick={handleChange}
        />
      )}
      {field.type === 'color' && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={String(field.value ?? '#000000')}
            onChange={(e) => handleChange(e.target.value)}
            className="h-6 w-6 rounded border cursor-pointer"
          />
          <span className="text-xs font-mono">{String(field.value ?? '#000000')}</span>
        </div>
      )}
      {field.type === 'textarea' && (
        <textarea
          value={String(field.value ?? '')}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded bg-background resize-y"
          rows={3}
        />
      )}
      {field.description && (
        <p className="text-[0.65rem] text-muted-foreground/70">{field.description}</p>
      )}
    </div>
  );
}
