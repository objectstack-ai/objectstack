/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ToggleGroupSchema } from '@object-ui/types';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group';

ComponentRegistry.register('toggle-group', 
  ({ schema, ...props }: { schema: ToggleGroupSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        type, // Extract type to prevent overriding the one we set below
        ...toggleGroupProps
    } = props;
    
    return (
      <ToggleGroup 
        type={(schema.selectionType || 'single') as any}
        variant={schema.variant}
        size={schema.size}
        value={schema.value as any}
        className={schema.className} 
        {...toggleGroupProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {schema.items?.map((item, idx) => (
          <ToggleGroupItem key={idx} value={item.value} aria-label={item.label} disabled={item.disabled}>
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  },
  {
    namespace: 'ui',
    label: 'Toggle Group',
    inputs: [
      { 
        name: 'selectionType', 
        type: 'enum', 
        enum: ['single', 'multiple']      },
      { 
        name: 'variant', 
        type: 'enum', 
        enum: ['default', 'outline']      },
      { 
        name: 'size', 
        type: 'enum', 
        enum: ['default', 'sm', 'lg']      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      selectionType: 'single',
      variant: 'default',
      size: 'default',
      items: [
        { value: 'bold', label: 'Bold' },
        { value: 'italic', label: 'Italic' },
        { value: 'underline', label: 'Underline' }
      ]
    }
  }
);
