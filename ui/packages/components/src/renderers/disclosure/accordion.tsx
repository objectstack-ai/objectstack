/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { AccordionSchema } from '@object-ui/types';
import { 
  Accordion, 
  AccordionItem, 
  AccordionTrigger, 
  AccordionContent 
} from '../../ui';
import { renderChildren } from '../../lib/utils';

ComponentRegistry.register('accordion', 
  ({ schema, className, ...props }: { schema: AccordionSchema; className?: string; [key: string]: any }) => (
    <Accordion type={schema.accordionType || 'single'} collapsible={schema.collapsible} className={className} {...props}>
      {schema.items?.map((item, index: number) => (
        <AccordionItem key={item.value || index} value={item.value || `item-${index}`} disabled={item.disabled}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            {renderChildren(item.content)}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  {
    namespace: 'ui',
    label: 'Accordion',
    inputs: [
      { name: 'accordionType', type: 'enum', enum: ['single', 'multiple'] },
      { name: 'collapsible', type: 'boolean' },
       { 
        name: 'items', 
        type: 'array', 
        description: 'Array of { trigger, content, value }'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      accordionType: 'single',
      collapsible: true,
      items: [
        { 
          label: 'Item 1', 
          value: 'item-1', 
          content: [{ type: 'text', content: 'Content for item 1' }] 
        },
        { 
          label: 'Item 2', 
          value: 'item-2', 
          content: [{ type: 'text', content: 'Content for item 2' }] 
        },
        { 
          label: 'Item 3', 
          value: 'item-3', 
          content: [{ type: 'text', content: 'Content for item 3' }] 
        }
      ],
      className: 'w-full'
    }
  }
);
