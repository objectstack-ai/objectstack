/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SheetSchema } from '@object-ui/types';
import { 
  Sheet, 
  SheetTrigger, 
  SheetContent, 
  SheetHeader, 
  SheetFooter, 
  SheetTitle, 
  SheetDescription
} from '../../ui';
import { renderChildren, renderNodeSlot, renderTriggerSlot } from '../../lib/utils';

// ⛔ No `modal` read (objectui#11347). `SheetSchema` declares no `modal`, the
// installed `@objectstack/spec` has no row for `sheet`, and no catalog entry,
// example, doc page or README authors one, so `modal={schema.modal}` rode
// `BaseSchema`'s index signature alone and was retired.
ComponentRegistry.register('sheet', 
  ({ schema, className, ...props }: { schema: SheetSchema; className?: string; [key: string]: any }) => (
    <Sheet defaultOpen={schema.defaultOpen} {...props}>
      {renderTriggerSlot(SheetTrigger, schema.trigger)}
      <SheetContent side={schema.side || 'right'} className={className}>
        <SheetHeader>
          {schema.title && <SheetTitle>{schema.title}</SheetTitle>}
          {schema.description && <SheetDescription>{schema.description}</SheetDescription>}
        </SheetHeader>
        {renderChildren(schema.content)}
{/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&` evaluates to the
            slot, so a legal authored `footer: 0` painted the character "0" —
            and it short-circuits, so `renderChildren`'s own falsy leg never
            ran. `renderNodeSlot` runs the wrapper only when the slot has
            content, so the chrome disappears with it. */}
        {renderNodeSlot(schema.footer, (footer) => (
          <SheetFooter>
            {renderChildren(footer)}
          </SheetFooter>
        ))}
      </SheetContent>
    </Sheet>
  ),
  {
    namespace: 'ui',
    label: 'Sheet',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'side', type: 'enum', enum: ['top', 'right', 'bottom', 'left'] },
       { name: 'defaultOpen', type: 'boolean' },
      { 
        name: 'trigger', 
        type: 'slot', 
      },
      { 
        name: 'content', 
        type: 'slot', 
      },
       { 
        name: 'footer', 
        type: 'slot'      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      title: 'Sheet Title',
      description: 'Sheet description',
      side: 'right',
      trigger: [{ type: 'button', label: 'Open Sheet' }],
      content: [{ type: 'text', content: 'Sheet content goes here' }]
    }
  }
);
