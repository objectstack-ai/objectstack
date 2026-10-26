import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';

/**
 * VectorField - Vector/embedding data display
 * Shows vector embeddings in a read-only format
 */
export function VectorField({ value, field, ...props }: FieldWidgetComponentProps<number[]>) {
  const vectorField = field as any;
  const dimensions = vectorField?.dimensions || (Array.isArray(value) ? value.length : 0);

  if (!value || !Array.isArray(value)) {
    return <EmptyValue />;
  }

  // Show first few values and total dimensions
  const preview = value.slice(0, 3).map(v => {
    const num = Number(v);
    return isNaN(num) ? '0' : num.toFixed(4);
  }).join(', ');

  return (
    <div className={`text-sm ${props.className || ''}`}>
      <span className="font-mono text-gray-700">[{preview}...]</span>
      <span className="text-gray-500 ml-2">({dimensions}D)</span>
    </div>
  );
}
