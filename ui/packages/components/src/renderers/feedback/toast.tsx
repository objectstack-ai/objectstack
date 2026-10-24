/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ToastSchema } from '@object-ui/types';
import { toast } from 'sonner';
import { Button } from '../../ui';

ComponentRegistry.register('toast', 
  ({ schema }: { schema: ToastSchema }) => {
    const showToast = () => {
      const toastFn = schema.variant === 'success' ? toast.success :
                      schema.variant === 'error' ? toast.error :
                      schema.variant === 'warning' ? toast.warning :
                      schema.variant === 'info' ? toast.info :
                      toast;
      
      toastFn(schema.title || 'Notification', {
        description: schema.description,
        duration: schema.duration,
      });
    };
    
    return (
      <Button onClick={showToast} variant={schema.buttonVariant} className={schema.className}>
        {schema.buttonLabel || 'Show Toast'}
      </Button>
    );
  },
  {
    namespace: 'ui',
    label: 'Toast',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { 
        name: 'variant', 
        type: 'enum', 
        enum: ['default', 'success', 'warning', 'error', 'info']      },
      { name: 'duration', type: 'number' },
      { name: 'buttonLabel', type: 'string' },
      {
        name: 'buttonVariant',
        type: 'enum',
        enum: ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'],
        description:
          'Variant for the trigger button this node renders. Exactly the six keys of the Button variant group: `cva` contributes no variant class for any other value, so an out-of-set value renders a button with no background and no text colour, while an empty string silently renders the default look.',
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      title: 'Notification',
      buttonLabel: 'Show Toast',
      variant: 'default',
      duration: 5000
    }
  }
);
