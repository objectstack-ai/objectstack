// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `filters` landing-mode editor of an `object` nav entry, shared by the two
 * nav-item inspectors: Setup's `AppNavInspector` and the Studio's
 * `StudioNavItemInspector` (objectstack#26740). Moved here unchanged out of
 * `AppNavInspector.tsx` so both mount the same rows editor.
 */

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { t } from '../i18n.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { InspectorComboField } from './InspectorComboField.js';

/** Key/value rows editor for the `filters` landing mode (ADR-0055). */
export function FiltersEditor({
  objectName,
  filters,
  onCommit,
  disabled,
  locale,
}: {
  objectName: string;
  filters: Record<string, string>;
  onCommit: (next: Record<string, string>) => void;
  disabled?: boolean;
  locale: MetadataInspectorProps['locale'];
}) {
  const { fields } = useObjectFields(objectName || undefined);
  const fieldOptions = React.useMemo(
    () => fields.map((f) => ({ value: f.name, label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name })),
    [fields],
  );
  const entries = Object.entries(filters);

  const update = (index: number, key: string, value: string) => {
    const next = entries.slice();
    next[index] = [key, value];
    onCommit(Object.fromEntries(next.filter(([k]) => k !== '')));
  };
  const remove = (index: number) => {
    const next = entries.slice();
    next.splice(index, 1);
    onCommit(Object.fromEntries(next));
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">
        {t('engine.inspector.appNav.filters', locale)}
      </div>
      {entries.map(([field, value], i) => (
        <div key={`${field}-${i}`} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <InspectorComboField
              // No visible per-row label — the `field = value` shape is read
              // from the row itself — so the trigger carries its own name
              // instead of being an anonymous combobox (objectui#3997).
              ariaLabel={t('engine.inspector.appNav.filtersField', locale)}
              value={field}
              onCommit={(v) => update(i, v, value)}
              options={fieldOptions}
              placeholder={t('engine.inspector.appNav.filtersField', locale)}
              disabled={disabled}
              mono
            />
          </div>
          <span className="text-xs text-muted-foreground">=</span>
          <input
            value={value}
            onChange={(e) => update(i, field, e.target.value)}
            placeholder={t('engine.inspector.appNav.filtersValue', locale)}
            disabled={disabled}
            className="h-7 w-0 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`nav-filter-value-${field || 'new'}`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={t('engine.inspector.appNav.filtersRemove', locale)}
            data-testid={`nav-filter-remove-${field || 'new'}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onCommit({ ...filters, '': '' })}
        disabled={disabled || Object.prototype.hasOwnProperty.call(filters, '')}
        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
        data-testid="nav-filter-add"
      >
        <Plus className="h-3 w-3" />
        {t('engine.inspector.appNav.filtersAdd', locale)}
      </button>
      <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.filtersHint', locale)}</p>
    </div>
  );
}
