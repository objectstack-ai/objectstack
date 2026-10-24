/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ScrollAreaSchema } from '@object-ui/types';
import { ScrollArea, ScrollBar } from '../../ui';
import { renderChildren } from '../../lib/utils';

ComponentRegistry.register('scroll-area', 
  ({ schema, className, ...props }: { schema: ScrollAreaSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...scrollAreaProps 
    } = props;

    const orientation = schema.orientation || 'vertical';

    return (
    <ScrollArea 
        className={className} 
        style={{ height: schema.height, width: schema.width, ...style }} 
        {...scrollAreaProps}
        data-obj-id={dataObjId}
        data-obj-type={dataObjType}
    >
      {renderChildren(schema.children)}
      {(orientation === 'horizontal' || orientation === 'both') && <ScrollBar orientation="horizontal" />}
      {(orientation === 'vertical' || orientation === 'both') && <ScrollBar orientation="vertical" />}
    </ScrollArea>
  )},
  {
    namespace: 'ui',
    label: 'Scroll Area',
    inputs: [
      { name: 'height', type: 'string' },
      { name: 'width', type: 'string' },
      { name: 'orientation', type: 'enum', enum: ['vertical', 'horizontal', 'both'] },
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot' }
    ],
    defaultProps: {
      height: '200px',
      width: '100%',
      orientation: 'vertical',
      children: [
        { type: 'div', className: 'p-4', children: [{ type: 'text', content: 'Scrollable content goes here. Add more content to see scrolling behavior.' }] }
      ],
      className: 'rounded-md border'
    }
  }
);
