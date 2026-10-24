import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * UrlField - URL input with clickable link in readonly mode
 * Validates URLs to only render http/https links for security
 */
export function UrlField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const config = field;
  if (readonly) {
    if (!value) return <EmptyValue />;
    
    // Validate URL to prevent javascript: or data: URLs
    const isValidUrl = value.startsWith('http://') || value.startsWith('https://');
    if (!isValidUrl) {
      return <span className="text-sm">{value}</span>;
    }
    
    return (
      <a 
        href={value}
        target="_blank"
        rel="noopener noreferrer"
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
      type="url"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={config?.placeholder || 'https://example.com'}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error}
    />
  );
}
