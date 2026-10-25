/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { PopoverSchema } from '@object-ui/types';
import { 
  Popover, 
  PopoverTrigger, 
  PopoverContent 
} from '../../ui';
import { renderChildren, renderTriggerSlot } from '../../lib/utils';

// ⛔ No `modal` read (objectui#11347). `PopoverSchema` declares no `modal`, the
// installed `@objectstack/spec` has no row for `popover`, and no catalog entry,
// example, doc page or README authors one, so `modal={schema.modal}` rode
// `BaseSchema`'s index signature alone and was retired.
ComponentRegistry.register('popover', 
  ({ schema, className, ...props }: { schema: PopoverSchema; className?: string; [key: string]: any }) => (
    <Popover defaultOpen={schema.defaultOpen} {...props}>
      {renderTriggerSlot(PopoverTrigger, schema.trigger)}
      <PopoverContent align={schema.align} side={schema.side} className={className}>
        {renderChildren(schema.content)}
      </PopoverContent>
    </Popover>
  ),
  {
    namespace: 'ui',
    label: 'Popover',
    inputs: [
      { name: 'defaultOpen', type: 'boolean' },
      { name: 'align', type: 'enum', enum: ['start', 'center', 'end'] },
      { name: 'side', type: 'enum', enum: ['top', 'right', 'bottom', 'left'] },
      { 
        name: 'trigger', 
        type: 'slot', 
      },
      { 
        name: 'content', 
        type: 'slot', 
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      trigger: [{ type: 'button', label: 'Open Popover', variant: 'outline' }],
      content: [{ type: 'text', content: 'Popover content goes here' }],
      align: 'center',
      side: 'bottom'
    }
  }
);
