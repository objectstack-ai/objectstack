/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { CheckboxSchema } from '@object-ui/types';
import { Checkbox, Label } from '../../ui';
import { cn } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';
import React from 'react';

const CheckboxRenderer = ({ schema, className, onChange, value, disabled: hostDisabled, ...props }: { schema: CheckboxSchema; className?: string; onChange?: (val: any) => void; value?: any; disabled?: boolean; [key: string]: any }) => {
  // `hostDisabled` is `SchemaRenderer`'s EVALUATED verdict on `disabled` /
  // `disabledOn`, not the raw authored key — which may be a predicate STRING,
  // truthy however it evaluates (objectui#7238, precedent objectui#6169).
  // Extract designer-related props
  const { 
      'data-obj-id': dataObjId, 
      'data-obj-type': dataObjType,
      style, 
      ...checkboxProps 
  } = props;

  const handleCheckedChange = (checked: boolean) => {
    if (onChange) {
      onChange(checked);
    }
  };

  return (
    <div 
        className={cn("flex items-center space-x-2", schema.wrapperClass)}
        data-obj-id={dataObjId}
        data-obj-type={dataObjType}
        style={style}
    >
      <Checkbox 
        id={schema.id} 
        className={className} 
        checked={value ?? schema.checked ?? false}
        defaultChecked={value === undefined ? schema.defaultChecked : undefined}
        onCheckedChange={handleCheckedChange}
        disabled={hostDisabled}
        required={schema.required}
        name={schema.name}
        {...toFormControlDomProps(checkboxProps)}
      />
      <Label htmlFor={schema.id} className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", schema.required && "text-destructive")}>
        {schema.label}
        {schema.required && (
          // A real `aria-hidden` element, not CSS generated content: this
          // label names the checkbox, and `::after` content enters the
          // accessible name ("Title*") where `aria-hidden` cannot reach it
          // (objectui#10368; the full note is on `FieldContainer`). The
          // required STATE is the `aria-required` Radix writes from the
          // `required` prop above.
          <span className="ml-0.5 text-destructive" data-required-marker="true" aria-hidden="true">
            *
          </span>
        )}
      </Label>
    </div>
  );
};

ComponentRegistry.register('checkbox', CheckboxRenderer,
  {
    namespace: 'ui',
    label: 'Checkbox',
    inputs: [
      { name: 'label', type: 'string', required: true },
      { name: 'id', type: 'string', required: true },
      { name: 'checked', type: 'boolean' },
      { name: 'required', type: 'boolean' },
      { name: 'disabled', type: 'boolean' }
    ],
    defaultProps: {
      label: 'Checkbox label',
      id: 'checkbox-field'
    }
  }
);
