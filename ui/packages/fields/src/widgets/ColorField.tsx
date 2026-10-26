import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * Color field widget - provides a color picker input
 * Supports hex color values (e.g., #ff0000)
 */
export function ColorField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const colorField = field as any;

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
