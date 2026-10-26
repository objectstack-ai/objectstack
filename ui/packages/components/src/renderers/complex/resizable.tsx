/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ResizableSchema } from '@object-ui/types';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '../../custom/resizable';
import { renderChildren } from '../../lib/utils';

ComponentRegistry.register('resizable', 
  ({ schema, className, ...props }: { schema: ResizableSchema; className?: string; [key: string]: any }) => {
    const panels = Array.isArray(schema.panels) ? schema.panels : [];
    return (
      <ResizablePanelGroup
          /* `schema.direction` → `orientation` is a deliberate boundary
             translation, not a leftover from the react-resizable-panels v3→v4
             rename (#3025). `direction` is ObjectUI's own public authoring
             vocabulary and appears in stored view metadata, so renaming it to
             match the library's prop would break every saved `resizable`
             schema. Keep the two names distinct and translate here. */
          orientation={(schema.direction || 'horizontal') as "horizontal" | "vertical"}
          className={className} 
          {...props}
          style={{ minHeight: schema.minHeight || '200px' }}
      >
        {panels.map((panel: any, index: number) => (
          <React.Fragment key={index}>
               <ResizablePanel defaultSize={panel.defaultSize} minSize={panel.minSize} maxSize={panel.maxSize}>
                  {renderChildren(panel.content)}
               </ResizablePanel>
               {index < panels.length - 1 && <ResizableHandle withHandle={schema.withHandle} />}
          </React.Fragment>
        ))}
      </ResizablePanelGroup>
    );
  },
  {
    namespace: 'ui',
    label: 'Resizable Panel Group',
    inputs: [
      { name: 'direction', type: 'enum', enum: ['horizontal', 'vertical'] },
      { name: 'minHeight', type: 'string' },
      { name: 'withHandle', type: 'boolean' },
      { 
        name: 'panels', 
        type: 'array', 
        description: 'Array of { defaultSize, minSize, maxSize, content }'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      direction: 'horizontal',
      minHeight: '200px',
      withHandle: true,
      panels: [
        { defaultSize: 50, content: [{ type: 'div', className: 'p-4', children: [{ type: 'text', content: 'Panel 1' }] }] },
        { defaultSize: 50, content: [{ type: 'div', className: 'p-4', children: [{ type: 'text', content: 'Panel 2' }] }] }
      ],
      className: 'rounded-lg border'
    }
  }
);
