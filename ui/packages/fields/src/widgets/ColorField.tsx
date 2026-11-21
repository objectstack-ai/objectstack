import React from 'react';
import { Input, EmptyValue, cn } from '@object-ui/components';
import { useFieldTranslation } from './useFieldTranslation.js';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * Color field widget - provides a color picker input
 * Supports hex color values (e.g., #ff0000)
 */
/**
 * The swatches the grid's cell editor offers (objectstack#35688): the 500
 * shade of each Tailwind hue, then black, grey and white.
 */
const IN_CELL_SWATCHES = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#000000', '#6b7280', '#ffffff',
] as const;

export function ColorField({ value, onChange, field, readonly, error, inCell, onCommit, ...props }: FieldWidgetComponentProps<string>) {
  const colorField = field as any;
  const { t } = useFieldTranslation();

  if (readonly) {
    return (
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded border border-input"
          style={{ backgroundColor: value || '#000000' }}
        />
        <span className="text-sm">{value || <EmptyValue />}</span>
      </div>
    );
  }

  if (inCell && !props.disabled) {
    // The grid's cell editor: the hex box takes the caret (Enter commits, Esc
    // leaves), a swatch picks and commits, and the browser's picker is one
    // more swatch for any other colour.
    const current = (value || '').toLowerCase();
    return (
      <div className="flex w-56 flex-col gap-1.5" data-slot="color-in-cell">
        <Input
          {...toDomProps(props)}
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={colorField?.placeholder || '#000000'}
          pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
          aria-invalid={!!error}
        />
        <div role="group" aria-label={t('fields.color.swatches')} className="grid grid-cols-10 gap-1">
          {IN_CELL_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              aria-pressed={current === hex}
              data-testid={`color-swatch-${hex.slice(1)}`}
              onClick={() => {
                onChange(hex);
                onCommit?.();
              }}
              className={cn(
                'h-4 w-4 rounded-sm border border-input',
                current === hex && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
          <input
            type="color"
            aria-label={t('fields.color.custom')}
            value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="h-4! w-4 cursor-pointer rounded-sm border border-input p-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        disabled={readonly || props.disabled}
        className="w-10 h-10 rounded border border-input cursor-pointer"
        // Both focusable halves of this widget announce the same validation
        // state (objectui#3318).
        aria-invalid={!!error}
      />
      <Input
        // DOM pass-through onto the primary text control (objectui#3318): the
        // whitelist spread carries the form renderer's id / aria-describedby.
        {...toDomProps(props)}
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={colorField?.placeholder || '#000000'}
        disabled={readonly || props.disabled}
        className={props.className}
        pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
        // AFTER the spread so this widget's own computation wins (#3222).
        aria-invalid={!!error}
      />
    </div>
  );
}
