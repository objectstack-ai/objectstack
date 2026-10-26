/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * QuickFilterBar — a presentational, fully-controlled row of quick-filter
 * multi-select dropdowns rendered above the Gantt grid. Each dropdown narrows
 * the visible task bars by one dimension (project / product / status / …); the
 * owning ObjectGantt resolves the option lists (from select options, lookups,
 * or distinct data) and applies the chosen values to the task set. This
 * component owns only the open/close + checkbox interaction — it holds no
 * filtering logic of its own, so it is trivially testable in isolation.
 *
 * Styling deliberately uses inline theme-variable styles (hsl(var(--…))) rather
 * than Tailwind utility classes: many prebuilt utilities never reach consuming
 * apps, so inline CSS-var styles are the reliable cross-app path for plugin UI.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface QuickFilterOption {
  /** Stable key compared against a task's resolved field value. */
  value: string;
  /** Human-facing label shown in the checkbox list and trigger summary. */
  label: string;
}

export interface QuickFilterField {
  /** Record field/path this dimension filters on (e.g. "project", "owner.id"). */
  field: string;
  /** Display label for the dropdown trigger. */
  label: string;
  /** Full option list (already resolved by the owner). */
  options: QuickFilterOption[];
}

/**
 * Display strings for the bar. Every member is optional: `all`, `clear` and
 * `empty` fall back to English defaults and an omitted `resultSummary` simply
 * hides the summary, so a label is only ever *supplied* by the owner.
 * The owning `ObjectGantt` passes translated values resolved from the
 * `gantt.quickFilter.*` bundle namespace (objectstack#5427); the `Host:` key
 * noted on each member is where that value comes from.
 */
export interface QuickFilterLabels {
  /** Select-all toggle and empty-selection trigger text. Host: `gantt.quickFilter.all`. */
  all?: string;
  /** Clears every dimension. Host: `gantt.quickFilter.clear`. */
  clear?: string;
  /**
   * Builds the "showing N / M" summary; omit to hide the summary.
   * Host: `gantt.quickFilter.resultSummary` (single-brace `{shown}` / `{total}`
   * placeholders, resolved at the call site by a literal `.replace`).
   */
  resultSummary?: (shown: number, total: number) => string;
  /** Placeholder shown when a dimension resolved zero options. Host: `gantt.quickFilter.empty`. */
  empty?: string;
}

export interface QuickFilterBarProps {
  filters: QuickFilterField[];
  /** field → selected option values (absent/empty = no constraint). */
  value: Record<string, string[]>;
  onChange: (field: string, values: string[]) => void;
  onClear: () => void;
  /** Visible/total task counts for the summary caption (optional). */
  resultCount?: number;
  totalCount?: number;
  labels?: QuickFilterLabels;
  className?: string;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid hsl(var(--border))',
  background: 'hsl(var(--background))',
  fontSize: 13,
};

const triggerBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--background))',
  color: 'hsl(var(--foreground))',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: '28px',
};

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 50,
  minWidth: 200,
  maxHeight: 320,
  overflowY: 'auto',
  padding: 4,
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--popover, var(--background)))',
  color: 'hsl(var(--popover-foreground, var(--foreground)))',
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
};

const optionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 6,
  cursor: 'pointer',
  userSelect: 'none',
};

/**
 * A self-contained checkbox indicator. We deliberately avoid a native
 * `<input type="checkbox">` nested in a `<label>`: that pattern double-fires the
 * click (the label re-activates the input, whose synthetic click re-bubbles),
 * which would toggle a selection on then immediately off.
 */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 15,
        height: 15,
        flex: '0 0 auto',
        borderRadius: 3,
        border: `1px solid ${checked ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
        background: checked ? 'hsl(var(--primary))' : 'transparent',
        color: 'hsl(var(--primary-foreground, var(--background)))',
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      {checked ? '✓' : ''}
    </span>
  );
}

/** One dimension's dropdown: a trigger + a checkbox panel closed on outside click. */
function FilterDropdown({
  filter,
  selected,
  onChange,
  labels,
}: {
  filter: QuickFilterField;
  selected: string[];
  onChange: (values: string[]) => void;
  labels: Required<Pick<QuickFilterLabels, 'all' | 'empty'>>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = new Set(selected);
  const count = selected.length;
  const allSelected = filter.options.length > 0 && count === filter.options.length;

  const toggleValue = (val: string) => {
    const next = new Set(selectedSet);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    // Selecting every option is equivalent to "no constraint" → collapse to empty
    // so the trigger reads "All" and the owner skips filtering this dimension.
    if (next.size === filter.options.length) onChange([]);
    else onChange([...next]);
  };

  const toggleAll = () => {
    if (count > 0) onChange([]);
    else onChange(filter.options.map((o) => o.value));
  };

  // Trigger summary: "Label" when unfiltered, "Label · N" (or the single
  // option's label) when narrowed.
  const summary =
    count === 0
      ? filter.label
      : count === 1
      ? `${filter.label}: ${filter.options.find((o) => o.value === selected[0])?.label ?? selected[0]}`
      : `${filter.label} · ${count}`;

  return (
    <div ref={rootRef} style={{ position: 'relative' }} data-testid={`quick-filter-${filter.field}`}>
      <button
        type="button"
        style={{
          ...triggerBase,
          borderColor: count > 0 ? 'hsl(var(--primary))' : 'hsl(var(--border))',
          color: count > 0 ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`quick-filter-trigger-${filter.field}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{summary}</span>
        <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div role="listbox" style={panelStyle} data-testid={`quick-filter-panel-${filter.field}`}>
          {filter.options.length === 0 ? (
            <div style={{ ...optionRowStyle, cursor: 'default', opacity: 0.6 }}>{labels.empty}</div>
          ) : (
            <>
              <div
                role="option"
                aria-selected={allSelected}
                style={{ ...optionRowStyle, fontWeight: 600 }}
                data-testid={`quick-filter-all-${filter.field}`}
                onClick={() => toggleAll()}
              >
                <CheckBox checked={allSelected} />
                <span>{labels.all}</span>
              </div>
              <div style={{ height: 1, background: 'hsl(var(--border))', margin: '2px 0' }} />
              {filter.options.map((opt) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={checked}
                    style={{
                      ...optionRowStyle,
                      background: checked ? 'hsl(var(--accent, var(--muted)))' : 'transparent',
                    }}
                    data-testid={`quick-filter-option-${filter.field}-${opt.value}`}
                    onClick={() => toggleValue(opt.value)}
                  >
                    <CheckBox checked={checked} />
                    <span>{opt.label}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const QuickFilterBar: React.FC<QuickFilterBarProps> = ({
  filters,
  value,
  onChange,
  onClear,
  resultCount,
  totalCount,
  labels,
  className,
}) => {
  if (!filters.length) return null;
  const all = labels?.all ?? 'All';
  const empty = labels?.empty ?? 'No options';
  const clearLabel = labels?.clear ?? 'Clear';
  const anyActive = filters.some((f) => (value[f.field]?.length ?? 0) > 0);

  return (
    <div style={barStyle} className={className} data-testid="quick-filter-bar">
      {filters.map((f) => (
        <FilterDropdown
          key={f.field}
          filter={f}
          selected={value[f.field] ?? []}
          onChange={(vals) => onChange(f.field, vals)}
          labels={{ all, empty }}
        />
      ))}
      {anyActive && (
        <button
          type="button"
          style={{ ...triggerBase, height: 28, color: 'hsl(var(--muted-foreground))' }}
          data-testid="quick-filter-clear"
          onClick={onClear}
        >
          {clearLabel}
        </button>
      )}
      {labels?.resultSummary && resultCount != null && totalCount != null && (
        <span
          data-testid="quick-filter-summary"
          style={{ marginLeft: 'auto', color: 'hsl(var(--muted-foreground))' }}
        >
          {labels.resultSummary(resultCount, totalCount)}
        </span>
      )}
    </div>
  );
};
