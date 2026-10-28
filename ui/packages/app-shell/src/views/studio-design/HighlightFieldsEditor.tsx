/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object's `highlightFields` (ADR-0085) as an ORDERED pick list.
 *
 * Order is the whole meaning of the key: the spec says "first entry wins where
 * only one fits", and the record page's highlight strip draws the fields in
 * this order. So the editor is a list, not a chip cloud:
 *
 *  - each row can be dragged to a new place, or moved with the up / down
 *    buttons (the keyboard path; the drag has no keyboard equivalent);
 *  - fields are added at the end, from the object's visible fields not already
 *    picked, up to {@link HIGHLIGHT_FIELDS_MAX};
 *  - a preview below draws the strip in the picked order, so the order is seen
 *    as the record page will show it.
 *
 * Removing the last field removes the key: an empty list and an absent key
 * would both read "not declared" here, and only the absent key says it.
 */

import React from 'react';
import { GripVertical, X } from 'lucide-react';
import type { FieldEntry } from '../metadata-admin/previews/object-fields-io.js';
import { InspectorReorderButtons, moveArray } from '../metadata-admin/inspectors/_shared.js';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';

/**
 * How many highlight fields the editor offers. The record-page strip shows a
 * handful of facts at a glance; six is the ruled ceiling for authoring here.
 * A stored list that is already longer is shown whole and never truncated.
 */
export const HIGHLIGHT_FIELDS_MAX = 6;

function labelOf(fields: readonly FieldEntry[], name: string): string {
  const def = fields.find((e) => e.name === name)?.def;
  return typeof def?.label === 'string' && def.label ? def.label : name;
}

export function HighlightFieldsEditor({
  value,
  fields,
  onChange,
  disabled,
  locale,
  renderAdd,
}: {
  /** The stored list, in order. */
  value: string[];
  /** The object's fields (labels for the rows and the preview). */
  fields: readonly FieldEntry[];
  /** The next list; `undefined` removes the key. */
  onChange: (next: string[] | undefined) => void;
  disabled?: boolean;
  locale?: SupportedLocale;
  /** The host's "add field" picker, offered while the list is under the cap. */
  renderAdd?: () => React.ReactNode;
}) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);
  const write = (next: string[]) => onChange(next.length > 0 ? next : undefined);
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    write(moveArray(value, from, to));
  };
  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  const atCap = value.length >= HIGHLIGHT_FIELDS_MAX;

  return (
    <div className="space-y-1.5" data-testid="highlight-fields-editor">
      {value.length > 0 && (
        <ol className="space-y-1" aria-label={t('engine.studio.settings.highlightFields', locale)}>
          {value.map((name, i) => (
            <li
              key={name}
              data-testid={`highlight-row-${name}`}
              draggable={!disabled}
              onDragStart={(e) => {
                e.dataTransfer?.setData('text/plain', name);
                setDragIndex(i);
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                endDrag();
              }}
              onDragEnd={endDrag}
              className={
                'flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-[12px]'
                + (overIndex === i && dragIndex !== null && dragIndex !== i ? ' border-primary' : '')
                + (dragIndex === i ? ' opacity-50' : '')
              }
            >
              {!disabled && (
                <GripVertical
                  className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {labelOf(fields, name)}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{name}</span>
              </span>
              {!disabled && (
                <>
                  <InspectorReorderButtons index={i} total={value.length} onMove={(to) => move(i, to)} />
                  <button
                    type="button"
                    aria-label={tFormat('engine.studio.settings.removeField', locale, { field: name })}
                    onClick={() => write(value.filter((x) => x !== name))}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {!disabled && !atCap && renderAdd?.()}
        {atCap && (
          <span className="text-[11px] text-muted-foreground" data-testid="highlight-max-note">
            {tFormat('engine.studio.settings.highlightMax', locale, { max: HIGHLIGHT_FIELDS_MAX })}
          </span>
        )}
        {value.length === 0 && (
          <span className="text-[11px] text-muted-foreground">{t('engine.studio.settings.undeclared', locale)}</span>
        )}
      </div>
      {value.length > 0 && (
        <div className="space-y-1">
          <span className="block text-[10px] text-muted-foreground">{t('engine.studio.settings.highlightPreview', locale)}</span>
          <div
            data-testid="highlight-preview"
            className="flex gap-5 overflow-x-auto rounded-md border bg-muted/20 px-3 py-2"
          >
            {value.map((name) => (
              <div key={name} className="min-w-0 shrink-0" data-testid="highlight-preview-cell">
                <div className="text-[10px] text-muted-foreground">{labelOf(fields, name)}</div>
                <div className="text-[13px] text-muted-foreground/70">—</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
