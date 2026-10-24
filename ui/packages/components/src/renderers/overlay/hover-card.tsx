/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { HoverCardSchema } from '@object-ui/types';
import { 
  HoverCard, 
  HoverCardTrigger, 
  HoverCardContent 
} from '../../ui';
import { renderChildren, renderTriggerSlot } from '../../lib/utils';

ComponentRegistry.register('hover-card', 
  ({ schema, className, ...props }: { schema: HoverCardSchema; className?: string; [key: string]: any }) => (
    <HoverCard openDelay={schema.openDelay} closeDelay={schema.closeDelay} {...props}>
      {renderTriggerSlot(HoverCardTrigger, schema.trigger)}
      <HoverCardContent align={schema.align} side={schema.side} className={className}>
         {renderChildren(schema.content)}
      </HoverCardContent>
    </HoverCard>
  ),
  {
    namespace: 'ui',
    label: 'Hover Card',
    inputs: [
       { name: 'openDelay', type: 'number' },
        { name: 'closeDelay', type: 'number' },
         { name: 'side', type: 'enum', enum: ['top', 'right', 'bottom', 'left'] },
      { name: 'align', type: 'enum', enum: ['start', 'center', 'end'] },
       { 
        name: 'trigger', 
        type: 'slot'      },
      { 
        name: 'content', 
        type: 'slot'      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      trigger: [{ type: 'button', label: 'Hover me', variant: 'link' }],
      content: [{ type: 'text', content: 'Hover card content appears on hover' }],
      side: 'top'
    }
  }
);
