/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { DialogSchema } from '@object-ui/types';
import { 
  Dialog, 
  DialogTrigger, 
  DialogContent, 
  DialogHeader, 
  DialogFooter, 
  DialogTitle, 
  DialogDescription
} from '../../ui';
import { renderChildren, renderNodeSlot, renderTriggerSlot } from '../../lib/utils';

ComponentRegistry.register('dialog', 
  ({ schema, className, ...props }: { schema: DialogSchema; className?: string; [key: string]: any }) => (
    <Dialog modal={schema.modal} defaultOpen={schema.defaultOpen} {...props}>
      {renderTriggerSlot(DialogTrigger, schema.trigger)}
      <DialogContent className={className}>
        <DialogHeader>
          {schema.title && <DialogTitle>{schema.title}</DialogTitle>}
          {schema.description && <DialogDescription>{schema.description}</DialogDescription>}
        </DialogHeader>
        {renderChildren(schema.content)}
{/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&` evaluates to the
            slot, so a legal authored `footer: 0` painted the character "0" —
            and it short-circuits, so `renderChildren`'s own falsy leg never
            ran. `renderNodeSlot` runs the wrapper only when the slot has
            content, so the chrome disappears with it. */}
        {renderNodeSlot(schema.footer, (footer) => (
          <DialogFooter>
            {renderChildren(footer)}
          </DialogFooter>
        ))}
      </DialogContent>
    </Dialog>
  ),
  {
    namespace: 'ui',
    label: 'Dialog',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'modal', type: 'boolean' },
      { name: 'defaultOpen', type: 'boolean' },
      { 
        name: 'trigger', 
        type: 'slot', 
        description: 'Element that opens the dialog' 
      },
      { 
        name: 'content', 
        type: 'slot', 
        description: 'Main content of the dialog' 
      },
      { 
        name: 'footer', 
        type: 'slot'      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      title: 'Dialog Title',
      description: 'Dialog description goes here',
      modal: true,
      trigger: [{ type: 'button', label: 'Open Dialog' }],
      content: [{ type: 'text', content: 'Dialog content goes here' }]
    }
  }
);
