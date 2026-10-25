/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SliderSchema } from '@object-ui/types';
import { Slider } from '../../ui';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

ComponentRegistry.register('slider', 
  ({ schema, className, ...props }: { schema: SliderSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...sliderProps 
    } = props;

    // Ensure defaultValue is an array for backward compatibility
    const defaultValue = Array.isArray(schema.defaultValue) 
      ? schema.defaultValue 
      : schema.defaultValue !== undefined 
        ? [schema.defaultValue] 
        : undefined;

    return (
    <Slider 
      defaultValue={defaultValue} 
      max={schema.max} 
      min={schema.min}
      step={schema.step}
      className={className} 
      {...toFormControlDomProps(sliderProps)}
      // Apply designer props
      {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    />
  );
  },
  {
    namespace: 'ui',
    label: 'Slider',
    inputs: [
      { name: 'defaultValue', type: 'array' },
      { name: 'max', type: 'number' },
      { name: 'min', type: 'number' },
      { name: 'step', type: 'number' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      defaultValue: [50],
      max: 100,
      min: 0,
      step: 1,
      className: 'w-full'
    }
  }
);
