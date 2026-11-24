import React from 'react';
import { Input, EmptyValue, cn } from '@object-ui/components';
import { PHONE_TOUCH_HEIGHT } from './touchTarget.js';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { InCellTextInput } from './InCellTextInput.js';

/**
 * EmailField - Email address input with mailto link in readonly mode
 * Renders as a clickable mailto link when readonly, standard email input otherwise
 */
export function EmailField({ value, onChange, field, readonly, error, inCell, onCommit: _onCommit, ...props }: FieldWidgetComponentProps<string>) {
  const config = field;
  if (readonly) {
    if (!value) return <EmptyValue />;
    return (
      <a 
        href={`mailto:${value}`}
        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
      >
        {value}
      </a>
    );
  }

  const domProps = toDomProps(props);

  // objectstack#36023 — in a list cell the cell itself is the input.
  if (inCell) {
    return (
      <InCellTextInput
        {...domProps}
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={config?.placeholder || 'email@example.com'}
        disabled={domProps.disabled}
        aria-invalid={!!error}
      />
    );
  }

  return (
    <Input
      {...domProps}
      type="email"
      className={cn(PHONE_TOUCH_HEIGHT, domProps.className)}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={config?.placeholder || 'email@example.com'}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error}
    />
  );
}
