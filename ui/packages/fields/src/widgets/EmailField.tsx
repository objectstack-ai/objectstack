import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * EmailField - Email address input with mailto link in readonly mode
 * Renders as a clickable mailto link when readonly, standard email input otherwise
 */
export function EmailField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
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

  return (
    <Input
      {...domProps}
      type="email"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={config?.placeholder || 'email@example.com'}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error}
    />
  );
}
