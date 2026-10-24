/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { HtmlSchema } from '@object-ui/types';
import { cn } from '../../lib/utils';

ComponentRegistry.register('html', 
  ({ schema, className, ...props }: { schema: HtmlSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...htmlProps 
    } = props;

    return (
    <div 
      className={cn("prose prose-sm max-w-none dark:prose-invert", className)} 
      dangerouslySetInnerHTML={{ __html: schema.html }}
      {...htmlProps}
      // Apply designer props
      data-obj-id={dataObjId}
      data-obj-type={dataObjType}
      style={style}
    />
    );
  },
  {
    namespace: 'ui',
    label: 'HTML Content',
    inputs: [
      { name: 'html', type: 'string', description: 'Raw HTML content' }
    ]
  }
);
