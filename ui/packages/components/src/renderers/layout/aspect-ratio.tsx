/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { AspectRatioSchema } from '@object-ui/types';
import { AspectRatio } from '../../ui/aspect-ratio';
import { renderChildren } from '../../lib/utils';

ComponentRegistry.register('aspect-ratio', 
  ({ schema, ...props }: { schema: AspectRatioSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...aspectRatioProps
    } = props;
    
    return (
      <AspectRatio 
        ratio={schema.ratio || 16 / 9}
        className={schema.className} 
        {...aspectRatioProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {schema.image ? (
          <img src={schema.image} alt={schema.alt || ''} loading="lazy" className="rounded-md object-cover w-full h-full" />
        ) : (
          renderChildren(schema.children)
        )}
      </AspectRatio>
    );
  },
  {
    namespace: 'ui',
    label: 'Aspect Ratio',
    // Same declaration, same reason as `semantic.tsx` (objectui#6764): the
    // renderer falls back to `renderChildren(schema.children)`
    // whenever no `image` is set, so a ratio box wrapping authored content is
    // the documented shape -- and it drew `not-a-container` for it. Not in
    // `PUBLIC_BLOCKS`, so the react-page scope builder never saw this tag and
    // the declaration removes no injected identifier.
    isContainer: true,
    inputs: [
      { name: 'ratio', type: 'number' },
      { name: 'image', type: 'string' },
      { name: 'alt', type: 'string' },
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot', description: 'Content rendered inside the ratio box when no `image` is set' }
    ],
    defaultProps: {
      ratio: 16 / 9
    }
  }
);
