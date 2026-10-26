/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SelectSchema } from '@object-ui/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label
} from '../../ui';
import { cn } from '../../lib/utils';
import { toControlValue, matchOptionValue } from './option-value';
import React from 'react';

const SelectRenderer = ({ schema, className, onChange, value, disabled: hostDisabled, ...props }: { schema: SelectSchema; className?: string; onChange?: (val: any) => void; value?: any; disabled?: boolean; [key: string]: any }) => {
  // `hostDisabled` is `SchemaRenderer`'s EVALUATED verdict on `disabled` /
  // `disabledOn`, not the raw authored key — which may be a predicate STRING,
  // truthy however it evaluates (objectui#7238, precedent objectui#6169).
  // Extract designer-related props
  const { 
      'data-obj-id': dataObjId, 
      'data-obj-type': dataObjType,
      style, 
      ...selectProps 
  } = props;

  // Map the control's string back to the AUTHORED option value (#3090): a
  // numeric/boolean option reaches the handler typed, not as "2".
  const handleValueChange = (newValue: string) => {
    if (onChange) {
      onChange(matchOptionValue(schema.options, newValue));
    }
  };

  return (
    <div 
        className={cn("grid w-full items-center gap-1.5", schema.wrapperClass)}
        data-obj-id={dataObjId}
        data-obj-type={dataObjType}
        style={style}
    >
      {/*
        The label names the trigger through a plain `htmlFor` / `id` pair on
        `schema.id` (objectui#10435), the shape `element:record_picker` landed
        for the same defect (objectui#5771): `SelectTrigger` renders a `button`
        with `role="combobox"`, a labelable element, and that role takes no
        name from its content, so without the pair the placeholder or value
        text inside it named nothing and the combobox's accessible name was
        empty. Only the author supplies `schema.id`, so a select authored
        without one keeps an unassociated caption, as on the sibling `input` /
        `textarea` renderers, rather than a minted `useId()` fallback.
      */}
      {schema.label && (
        <Label htmlFor={schema.id} className={cn(schema.required && "text-destructive")}>
          {schema.label}
          {schema.required && (
            // A real `aria-hidden` element, not CSS generated content, the
            // same shape as the other form renderers (objectui#10368; the full
            // note is on `FieldContainer`): `::after` content enters the name
            // of whatever control a label names, and `aria-hidden` cannot
            // reach a pseudo-element. The required STATE is the
            // `aria-required` Radix writes on the trigger from `required`.
            <span className="ml-0.5 text-destructive" data-required-marker="true" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      <Select
        defaultValue={value === undefined ? toControlValue(schema.defaultValue) : undefined}
        value={toControlValue(value ?? schema.value)}
        onValueChange={handleValueChange}
        disabled={hostDisabled}
        required={schema.required}
        name={schema.name}
        {...selectProps}
      >
        <SelectTrigger id={schema.id} className={className}>
          <SelectValue placeholder={schema.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {schema.options?.map((opt) => (
             <SelectItem key={String(opt.value)} value={String(opt.value)} disabled={opt.disabled}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

ComponentRegistry.register('select', SelectRenderer,
  {
    namespace: 'ui',
    label: 'Select',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'placeholder', type: 'string' },
      { name: 'defaultValue', type: 'string' },
      { name: 'required', type: 'boolean' },
      { name: 'disabled', type: 'boolean' },
      { 
        name: 'options', 
        type: 'array', 
        description: 'Array of {label, value} objects'
      }
    ],
    defaultProps: {
      label: 'Select an option',
      placeholder: 'Choose...',
      options: [
        { label: 'Option 1', value: 'option1' },
        { label: 'Option 2', value: 'option2' },
        { label: 'Option 3', value: 'option3' }
      ]
    }
  }
);
