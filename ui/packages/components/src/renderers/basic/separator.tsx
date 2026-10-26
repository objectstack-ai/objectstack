/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SeparatorSchema } from '@object-ui/types';
import { Separator } from '../../ui';
import { forwardRef } from 'react';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const SeparatorRenderer = forwardRef<HTMLDivElement, { schema: SeparatorSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: SeparatorSchema; className?: string; [key: string]: any }, ref) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...separatorProps 
    } = props;
    
    return (
    <Separator 
        ref={ref}
        orientation={schema.orientation} 
        className={className} 
        {...separatorProps}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    />
  );
  }
);

ComponentRegistry.register('separator', 
  SeparatorRenderer,
  {
    namespace: 'ui',
    label: 'Separator',
    inputs: [
      { 
        name: 'orientation', 
        type: 'enum', 
        enum: ['horizontal', 'vertical']      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      orientation: 'horizontal',
      className: 'my-2 sm:my-4'
    }
  }
);
