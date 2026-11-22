/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { X, Plus, ArrowUp, ArrowDown } from "lucide-react"

import { cn } from "../lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"

export interface GroupingFieldEntry {
  field: string;
  order: 'asc' | 'desc';
  collapsed: boolean;
}

export interface GroupingConfigValue {
  fields: GroupingFieldEntry[];
}

export interface GroupingEditorProps {
  /** Current grouping configuration. `undefined` when no grouping is active. */
  value?: GroupingConfigValue;
  /** Called whenever the user mutates the grouping. Pass `undefined` when the
   *  list is cleared so the consumer can detect "no grouping". */
  onChange: (next: GroupingConfigValue | undefined) => void;
  /** Available fields to group by. */
  fieldOptions: Array<{ value: string; label: string }>;
  /**
   * objectstack#36204 — "Add group field" adds no field by itself: it opens a
   * row whose field dropdown is already open, listing the fields no level
   * uses yet, and the level is written only once a field is picked there.
   * Closing the dropdown without a pick drops the row and writes nothing.
   * Absent, the first unused field is added at once, as before.
   */
  askFieldOnAdd?: boolean;
  /**
   * The field options are still being worked out (the host has not read the
   * fields' types yet). With no option to offer, "Add group field" is drawn
   * disabled, without the `noFields` reason, until they arrive.
   */
  fieldOptionsLoading?: boolean;
  /**
   * The label of a field a level holds that `fieldOptions` does not carry (a
   * view grouped by a field the host does not offer). Absent, or answering
   * `undefined`, the level shows the field's name.
   */
  fieldLabel?: (field: string) => string | undefined;
  /** Maximum nesting depth. Airtable defaults to 3. */
  maxLevels?: number;
  className?: string;
  /** Optional i18n labels — fall back to English. */
  labels?: {
    addGroup?: string;
    collapseTitle?: string;
    removeTitle?: string;
    ascendingTitle?: string;
    descendingTitle?: string;
    /**
     * objectstack#36204 — with no field to offer, "Add group field" is drawn
     * disabled and this says why. Absent, the editor draws no add button
     * then, as before.
     */
    noFields?: string;
  };
}

const DEFAULT_LABELS = {
  addGroup: 'Add group field',
  collapseTitle: 'Collapsed by default',
  removeTitle: 'Remove',
  ascendingTitle: 'Ascending',
  descendingTitle: 'Descending',
};

/**
 * Airtable-style multi-level grouping editor.
 *
 * Each level is a row with: field selector, order toggle (↑/↓),
 * "default collapsed" checkbox, and a remove button. A "+ Add group field"
 * button appends a new level up to `maxLevels` (default 3).
 *
 * Field options are filtered per row so a field can only appear in one level
 * at a time. The current row's selected field stays in its own dropdown so the
 * user sees the active selection.
 *
 * The field selector is the shared `Select` primitive, the control the Filter
 * and Sort panels beside this one pick a field with, so the three panels look
 * and behave alike (objectui#11865). It used to be a browser-native `<select>`.
 */
export function GroupingEditor({
  value,
  onChange,
  fieldOptions,
  askFieldOnAdd,
  fieldOptionsLoading,
  fieldLabel,
  maxLevels = 3,
  className,
  labels,
}: GroupingEditorProps) {
  const L = { ...DEFAULT_LABELS, ...(labels || {}) };
  const current = value?.fields ?? [];
  const usedFields = new Set(current.map((g) => g.field));
  // objectstack#36204 — "Add group field" was pressed with `askFieldOnAdd`:
  // a row asking for a field is open, and nothing is written until a field is
  // picked in it.
  const [askingField, setAskingField] = React.useState(false);
  const noFieldsId = React.useId();
  const remaining = fieldOptions.filter((f) => !usedFields.has(f.value));

  const writeFields = (next: GroupingFieldEntry[]) => {
    onChange(next.length ? { fields: next } : undefined);
  };

  return (
    <div data-testid="grouping-editor" className={cn("flex flex-col gap-1.5 w-full", className)}>
      {current.map((g, idx) => {
        // Radix matches `SelectValue` against the `SelectItem`s actually
        // MOUNTED, so a level grouped by a field the options do not carry (a
        // view grouped by a column it does not show) would leave the trigger
        // blank while the list stays grouped by it. The native `<select>` was
        // worse: React marks its first option selected, so it showed a field
        // the view was NOT grouped by. Mounting the value as its own item,
        // labelled with the name itself because that is what is known about
        // it, keeps the trigger showing what the level holds, the invariant
        // the Filter panel's value picker keeps for the same reason
        // (objectui#4874). `SelectItem` refuses `""`, hence the guard.
        const isOutsideOptions =
          g.field !== "" && !fieldOptions.some((f) => f.value === g.field);
        return (
          <div key={idx} className="flex items-center gap-1.5">
            <Select
              value={g.field}
              onValueChange={(field) => {
                const next = [...current];
                next[idx] = { ...g, field };
                writeFields(next);
              }}
            >
              <SelectTrigger
                data-testid={`grouping-field-${idx}`}
                className="h-7 min-w-0 flex-1 px-2 py-0 text-xs max-sm:h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isOutsideOptions && (
                  <SelectItem value={g.field} data-testid={`grouping-field-outside-options-${idx}`}>
                    {fieldLabel?.(g.field) || g.field}
                  </SelectItem>
                )}
                {fieldOptions
                  .filter((f) => f.value === g.field || !usedFields.has(f.value))
                  .map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              title={g.order === 'asc' ? L.ascendingTitle : L.descendingTitle}
              data-testid={`grouping-order-${idx}`}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-muted max-sm:h-11 max-sm:w-11"
              onClick={() => {
                const next = [...current];
                next[idx] = { ...g, order: g.order === 'asc' ? 'desc' : 'asc' };
                writeFields(next);
              }}
            >
              {g.order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </button>
            <label
              title={L.collapseTitle}
              // Below `sm` the label is the checkbox's 44 px touch target.
              className="flex items-center text-xs text-muted-foreground max-sm:h-11 max-sm:w-11 max-sm:justify-center"
            >
              <input
                type="checkbox"
                data-testid={`grouping-collapsed-${idx}`}
                className="h-3 w-3"
                checked={g.collapsed}
                onChange={(e) => {
                  const next = [...current];
                  next[idx] = { ...g, collapsed: e.target.checked };
                  writeFields(next);
                }}
              />
            </label>
            <button
              type="button"
              title={L.removeTitle}
              data-testid={`grouping-remove-${idx}`}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-muted hover:text-destructive max-sm:h-11 max-sm:w-11"
              onClick={() => {
                const next = current.filter((_, i) => i !== idx);
                writeFields(next);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      {askingField && current.length < maxLevels && remaining.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Select
            defaultOpen
            value=""
            onOpenChange={(open) => {
              if (!open) setAskingField(false);
            }}
            onValueChange={(field) => {
              setAskingField(false);
              writeFields([...current, { field, order: 'asc', collapsed: false }]);
            }}
          >
            <SelectTrigger
              data-testid="grouping-field-pending"
              className="h-7 min-w-0 flex-1 px-2 py-0 text-xs max-sm:h-11"
            >
              <SelectValue placeholder={L.addGroup} />
            </SelectTrigger>
            <SelectContent>
              {remaining.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!askingField && current.length < maxLevels && remaining.length > 0 && (
        <button
          type="button"
          data-testid="grouping-add"
          className="flex h-7 items-center gap-1 self-start rounded-md border border-dashed border-input bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-sm:h-11"
          onClick={() => {
            if (askFieldOnAdd) {
              setAskingField(true);
              return;
            }
            writeFields([...current, { field: remaining[0].value, order: 'asc', collapsed: false }]);
          }}
        >
          <Plus className="h-3 w-3" />
          {L.addGroup}
        </button>
      )}
      {/* objectstack#36204 — nothing to offer: the button stays, disabled, and
          says why (`labels.noFields`), or waits for the options to load. */}
      {current.length < maxLevels && fieldOptions.length === 0 && (fieldOptionsLoading || labels?.noFields) && (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-describedby={!fieldOptionsLoading ? noFieldsId : undefined}
            data-testid="grouping-add"
            className="flex h-7 cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-input bg-background px-2 text-xs text-muted-foreground opacity-50 max-sm:h-11"
          >
            <Plus className="h-3 w-3" />
            {L.addGroup}
          </button>
          {!fieldOptionsLoading && (
            <p id={noFieldsId} data-testid="grouping-no-fields" className="text-xs text-muted-foreground">
              {labels?.noFields}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
