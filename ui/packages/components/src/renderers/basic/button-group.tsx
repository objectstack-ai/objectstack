/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ButtonGroupSchema } from '@object-ui/types';
import { Button } from '../../ui';
import { cn } from '../../lib/utils';

ComponentRegistry.register('button-group', 
  ({ schema, ...props }: { schema: ButtonGroupSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...buttonGroupProps
    } = props;
    
    return (
      <div 
        className={cn('flex flex-wrap sm:inline-flex rounded-md shadow-sm', schema.className)} 
        role="group"
        {...buttonGroupProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {schema.buttons?.map((button, idx) => (
          <Button
            key={idx}
            variant={button.variant || schema.variant}
            size={button.size || schema.size}
            disabled={button.disabled}
            className={cn(
              'rounded-none',
              idx === 0 && 'rounded-l-md',
              idx === (schema.buttons?.length || 0) - 1 && 'rounded-r-md',
              idx > 0 && '-ml-px',
              button.className
            )}
          >
            {button.label}
          </Button>
        ))}
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Button Group',
    inputs: [
      { 
        name: 'variant', 
        type: 'enum', 
        enum: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']      },
      { 
        name: 'size', 
        type: 'enum', 
        enum: ['default', 'sm', 'lg', 'icon']      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      variant: 'default',
      size: 'default',
      buttons: [
        { label: 'Left' },
        { label: 'Middle' },
        { label: 'Right' }
      ]
    }
  }
);
