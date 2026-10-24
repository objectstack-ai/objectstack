/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { DrawerSchema } from '@object-ui/types';
import { 
  Drawer, 
  DrawerTrigger, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle, 
  DrawerDescription
} from '../../ui';
import { renderChildren, renderTriggerSlot } from '../../lib/utils';

ComponentRegistry.register('drawer', 
  ({ schema, className, ...props }: { schema: DrawerSchema; className?: string; [key: string]: any }) => (
    // ⛔ Three reads retired here (objectui#11347): `shouldScaleBackground`,
    // `footer` and `showClose`. `DrawerSchema` declares none of them, the
    // installed `@objectstack/spec` has no row for `drawer`, and no catalog
    // entry, example, doc page or README authors any of them, so each read
    // rode `BaseSchema`'s index signature alone. The drawer therefore draws no
    // footer and no Close button from the node. `shouldScaleBackground` is the
    // primitive's own prop and still defaults inside the `Drawer` wrapper; the
    // node no longer names it, and what an authored one does through
    // `SchemaRenderer`'s prop spread is the strict face's question, not this
    // read's.
    <Drawer defaultOpen={schema.defaultOpen} {...props}>
      {renderTriggerSlot(DrawerTrigger, schema.trigger)}
      <DrawerContent className={className}>
        <DrawerHeader>
          {schema.title && <DrawerTitle>{schema.title}</DrawerTitle>}
          {schema.description && <DrawerDescription>{schema.description}</DrawerDescription>}
        </DrawerHeader>
        {renderChildren(schema.content)}
      </DrawerContent>
    </Drawer>
  ),
  {
    namespace: 'ui',
    label: 'Drawer',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
        { name: 'defaultOpen', type: 'boolean' },
      { 
        name: 'trigger', 
        type: 'slot'      },
      { 
        name: 'content', 
        type: 'slot'      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      title: 'Drawer Title',
      description: 'Drawer description',
      trigger: [{ type: 'button', label: 'Open Drawer' }],
      content: [{ type: 'text', content: 'Drawer content goes here' }]
    }
  }
);
