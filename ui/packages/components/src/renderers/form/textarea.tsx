/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { TextareaSchema } from '@object-ui/types';
import { Textarea, Label } from '../../ui';
import { cn } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';
import React from 'react';

const TextareaRenderer = ({ schema, className, onChange, value, disabled: hostDisabled, ...props }: { schema: TextareaSchema; className?: string; onChange?: (val: any) => void; value?: any; disabled?: boolean; [key: string]: any }) => {
  // `hostDisabled` is `SchemaRenderer`'s EVALUATED verdict on `disabled` /
  // `disabledOn`, not the raw authored key — which may be a predicate STRING,
  // truthy however it evaluates (objectui#7238, precedent objectui#6169).
  // Handle change for both raw inputs and form-bound inputs
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (onChange) {
      onChange(e.target.value);
    }
  };

  // Extract designer-related props
  const { 
    'data-obj-id': dataObjId, 
    'data-obj-type': dataObjType,
    style, 
    ...inputProps 
  } = props;

  return (
    <div 
      className={cn("grid w-full gap-1.5", schema.wrapperClass)}
      data-obj-id={dataObjId}
      data-obj-type={dataObjType}
      style={style}
    >
      {schema.label && (
        <Label htmlFor={schema.id} className={cn(schema.required && "text-destructive")}>
          {schema.label}
          {schema.required && (
            // A real `aria-hidden` element, not CSS generated content: this
            // label names the textarea, and `::after` content enters the
            // accessible name ("Title*") where `aria-hidden` cannot reach it
            // (objectui#10368; the full note is on `FieldContainer`). The
            // required STATE is the textarea's native `required` below.
            <span className="ml-0.5 text-destructive" data-required-marker="true" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      <Textarea 
        id={schema.id} 
        name={schema.name}
        placeholder={schema.placeholder} 
        className={className} 
        disabled={hostDisabled}
        readOnly={schema.readOnly}
        required={schema.required}
        rows={schema.rows}
        value={value ?? schema.value ?? ''}
        defaultValue={value === undefined ? schema.defaultValue : undefined}
        onChange={handleChange}
        {...toFormControlDomProps(inputProps)}
      />
    </div>
  );
};

ComponentRegistry.register('textarea', TextareaRenderer,
  {
    namespace: 'ui',
    label: 'Textarea',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'placeholder', type: 'string' },
      { name: 'rows', type: 'number' },
      { name: 'required', type: 'boolean' },
      { name: 'disabled', type: 'boolean' },
      { name: 'id', type: 'string', required: true }
    ],
    defaultProps: {
      label: 'Textarea label',
      placeholder: 'Enter text here...',
      rows: 3,
      id: 'textarea-field'
    }
  }
);
