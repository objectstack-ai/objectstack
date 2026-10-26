// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AddWidgetPicker — popover with a search box and categorized list
 * of dashboard widget types. Picking a type calls `onAdd(type)`.
 * Closes on selection so authors land on the new widget's
 * inspector right away.
 *
 * Its words — the search box, the empty text, the category headings and the
 * type names — are designer catalogue rows (`engine.widgetPicker.*`) read in
 * the designer locale, the way the sibling `FlowExprIssue` reads it
 * (objectui#10804). A type's DISPLAYED name is `labelKey`; its English `label`
 * belongs to the stored default title the caller writes (see `widget-types`).
 * The search matches what the row shows — the displayed name and the stored
 * `type` id printed beside it — so a zh author finds a type by the word on
 * screen, and nothing matches by a name the row does not show.
 */

import * as React from 'react';
import { Plus, Search } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@object-ui/components';
import { t as tr, useMetadataLocale } from '../i18n.js';
import {
  WIDGETS_BY_CATEGORY,
  WIDGET_CATEGORY_LABEL_KEY,
  WIDGET_TYPE_META,
  UnknownWidgetIcon,
} from './widget-types.js';

export interface AddWidgetPickerProps {
  onAdd: (type: string) => void;
  label?: string;
}

export function AddWidgetPicker({ onAdd, label = 'Add widget' }: AddWidgetPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const locale = useMetadataLocale();

  const filtered = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return WIDGETS_BY_CATEGORY;
    return WIDGETS_BY_CATEGORY
      .map((group) => ({
        category: group.category,
        types: group.types.filter(
          (t) => t.id.toLowerCase().includes(ql) || tr(t.labelKey, locale).toLowerCase().includes(ql),
        ),
      }))
      .filter((g) => g.types.length);
  }, [q, locale]);

  // Radix Popover (portaled to <body>) — the dashboard PreviewShell root is
  // `overflow-hidden`, so an `absolute` panel used to be clipped against the
  // shell box (especially when short). Portaling escapes that clip; Radix also
  // handles outside-click + Escape, replacing the manual document listeners.
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('engine.widgetPicker.search', locale)}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {tr('engine.widgetPicker.noMatches', locale)}
            </div>
          ) : (
            filtered.map((group) => (
              <div key={group.category}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {tr(WIDGET_CATEGORY_LABEL_KEY[group.category], locale)}
                </div>
                {group.types.map((t) => {
                  const Icon = (WIDGET_TYPE_META[t.id]?.icon ?? UnknownWidgetIcon);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                      onClick={() => {
                        onAdd(t.id);
                        setOpen(false);
                      }}
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{tr(t.labelKey, locale)}</span>
                      <code className="ml-auto text-[10px] text-muted-foreground">{t.id}</code>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
