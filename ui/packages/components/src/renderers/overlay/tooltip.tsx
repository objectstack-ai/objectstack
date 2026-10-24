/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { TooltipSchema } from '@object-ui/types';
import { 
  TooltipProvider,
  Tooltip, 
  TooltipTrigger, 
  TooltipContent 
} from '../../ui';
import { renderChildren, renderTriggerSlot } from '../../lib/utils';

// Helper to ensure provider exists if not already present at app root
// For now assuming provider is at root or we just wrap it here.
// Wrapping here is safer for isolated usage.

ComponentRegistry.register('tooltip', 
  ({ schema, className, ...props }: { schema: TooltipSchema; className?: string; [key: string]: any }) => (
    <TooltipProvider delayDuration={schema.delayDuration}>
      <Tooltip {...props}>
        {renderTriggerSlot(TooltipTrigger, schema.trigger)}
        <TooltipContent side={schema.side} align={schema.align} className={className}>
           {(schema.content || renderChildren(schema.children)) as any}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
  {
    namespace: 'ui',
    label: 'Tooltip',
    inputs: [
      { name: 'delayDuration', type: 'number' },
      { name: 'side', type: 'enum', enum: ['top', 'right', 'bottom', 'left'] },
      { name: 'align', type: 'enum', enum: ['start', 'center', 'end'] },
      { 
        name: 'trigger', 
        type: 'slot', 
      },
      { 
        name: 'content', 
        type: 'string', 
      },
      // The rich-content slot. This registration published `body` and was
      // the one place on the whole authoring surface that ADVERTISED the
      // dialect in its `inputs`; objectui#6771 retired it, so the slot is
      // declared under the one spelling the protocol keeps. Same two-sided
      // move as the `page:card` retirement pinned by
      // `components/src/__tests__/page-container-authorable-keys.test.tsx`.
      { name: 'children', type: 'slot' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      trigger: [{ type: 'button', label: 'Hover me', variant: 'outline' }],
      content: 'Tooltip content',
      delayDuration: 700,
      side: 'top'
    }
  }
);
