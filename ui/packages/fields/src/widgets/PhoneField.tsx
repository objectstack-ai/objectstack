import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * PhoneField - Telephone number input with tel link in readonly mode
 * Renders as a clickable tel link when readonly, standard phone input otherwise
 */
export function PhoneField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const config = field;
  if (readonly) {
    if (!value) return <EmptyValue />;
    return (
      <a 
        href={`tel:${value}`}
        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
      >
        {value}
      </a>
    );
  }

  const domProps = toDomProps(props);

  return (
    <Input
      {...domProps}
      type="tel"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={config?.placeholder || '(555) 123-4567'}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error}
    />
  );
}
