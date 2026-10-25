/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SonnerSchema } from '@object-ui/types';
import { toast } from 'sonner';
import { Button } from '../../ui';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

ComponentRegistry.register('sonner', 
  ({ schema, ...props }: { schema: SonnerSchema; [key: string]: any }) => {
    // `style` forwarded by name; the rest through the form-control
    // declaration (objectui#5632).
    const { style, ...buttonProps } = props;

    const showToast = () => {
      const toastFn = schema.variant === 'success' ? toast.success :
                      schema.variant === 'error' ? toast.error :
                      schema.variant === 'warning' ? toast.warning :
                      schema.variant === 'info' ? toast.info :
                      toast;
      
      toastFn(schema.message || schema.title || 'Notification', {
        description: schema.description,
      });
    };
    
    return (
      <Button
        onClick={showToast}
        variant={schema.buttonVariant}
        className={schema.className}
        {...toFormControlDomProps(buttonProps)}
        style={style}
      >
        {schema.buttonLabel || 'Show Toast'}
      </Button>
    );
  },
  {
    namespace: 'ui',
    label: 'Sonner Toast',
    inputs: [
      { name: 'message', type: 'string' },
      { name: 'description', type: 'string' },
      { 
        name: 'variant', 
        type: 'enum', 
        enum: ['default', 'success', 'error', 'warning', 'info']      },
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
      message: 'Notification',
      buttonLabel: 'Show Toast',
      variant: 'default'
    }
  }
);
