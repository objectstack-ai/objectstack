/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { KbdSchema } from '@object-ui/types';
import { cn } from '../../lib/utils';

ComponentRegistry.register('kbd', 
  ({ schema, ...props }: { schema: KbdSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...kbdProps
    } = props;
    
    const keys = Array.isArray(schema.keys) ? schema.keys : [schema.keys || schema.label || 'K'];
    
    return (
      <div className={cn('inline-flex flex-wrap gap-1', schema.className)}>
        {keys.map((key, idx) => (
          <kbd
            key={idx}
            className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100"
            {...kbdProps}
            {...(idx === 0 ? { 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style } : {})}
          >
            {key}
          </kbd>
        ))}
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Keyboard Key',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      label: 'K'
    }
  }
);
