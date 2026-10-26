/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ImageSchema } from '@object-ui/types';

ComponentRegistry.register('image',
  ({ schema, className, ...props }: { schema: ImageSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...imgProps 
    } = props;

    return (
    <img
      src={schema.src}
      alt={schema.alt || ''}
      className={className}
      {...imgProps}
      // Apply designer props
      data-obj-id={dataObjId}
      data-obj-type={dataObjType}
      style={style}
    />
  );
  },
  {
    namespace: 'ui',
    label: 'Image',
    icon: 'image',
    category: 'basic',
    inputs: [
      { name: 'src', type: 'string' },
      { name: 'alt', type: 'string' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      className: 'max-w-full h-auto'
    }
  }
);
