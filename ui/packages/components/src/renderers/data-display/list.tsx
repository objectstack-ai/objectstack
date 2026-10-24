/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ListSchema } from '@object-ui/types';
import { useDataScope } from '@object-ui/react';
import { renderChildren, cn } from '../../lib/utils';

ComponentRegistry.register('list', 
  ({ schema, className, ...props }: { schema: ListSchema; className?: string; [key: string]: any }) => {
    // Support data binding
    const boundData = useDataScope(schema.bind);
    const items = Array.isArray(boundData) ? boundData : Array.isArray(schema.items) ? schema.items : [];
    
    // We use 'ol' or 'ul' based on ordered prop
    const ListTag = schema.ordered ? 'ol' : 'ul';
    
    // Default styles for ordered/unordered
    const listStyle = schema.ordered ? "list-decimal" : "list-disc";

    return (
      <div className={cn("space-y-2", schema.wrapperClass)}>
        {/* `title` is a declared `ListSchema` member (objectui#11347): the
            published `skills/objectui` expressions guide authors it, so the
            read is kept and the type now says so. */}
        {schema.title && (
          <h3 className="text-lg font-semibold tracking-tight">
             {schema.title}
          </h3>
        )}
        
        <ListTag 
          className={cn(
            "ml-6 [&>li]:mt-2",
            listStyle,
            className
          )}
          {...props}
        >
          {items.map((item: any, index: number) => (
            <li key={index} className={cn(typeof item === 'object' && item.className)}>
              {typeof item === 'string' ? item : renderChildren(item.content)}
            </li>
          ))}
        </ListTag>
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'List',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'ordered', type: 'boolean' },
      { 
        name: 'items', 
        type: 'array', 
        description: 'Array of strings or objects with content'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      ordered: false,
      items: [
        'First item',
        'Second item',
        'Third item'
      ],
      className: 'text-sm'
    }
  }
);
