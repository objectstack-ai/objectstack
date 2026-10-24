/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { LabelSchema } from '@object-ui/types';
import { Label } from '../../ui';

ComponentRegistry.register('label', 
  ({ schema, className, ...props }: { schema: LabelSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...labelProps 
    } = props;

    return (
      <Label 
        className={className} 
        {...labelProps}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {/* `text`, then `label`. A third spelling, `content`, is retired on both
            faces of `@object-ui/types` and is no longer read (objectui#6152). */}
        {schema.text || schema.label}
      </Label>
    );
  },
  {
    namespace: 'ui',
    label: 'Label',
    inputs: [
      { name: 'text', type: 'string', required: true },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      text: 'Label Text'
    }
  }
);
