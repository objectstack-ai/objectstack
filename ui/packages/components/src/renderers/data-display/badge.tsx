/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { BadgeSchema } from '@object-ui/types';
import { Badge } from '../../ui';
import { renderChildren } from '../../lib/utils';

ComponentRegistry.register('badge', 
  ({ schema, ...props }: { schema: BadgeSchema; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...badgeProps
    } = props;
    
    return (
    <Badge 
        variant={schema.variant} 
        className={schema.className} 
        {...badgeProps}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      {schema.label || renderChildren(schema.children)}
    </Badge>
  );
  },
  {
    namespace: 'ui',
    label: 'Badge',
    inputs: [
      { name: 'label', type: 'string' },
      {
        name: 'variant',
        type: 'enum',
        enum: ['default', 'secondary', 'destructive', 'outline']      },
      { name: 'className', type: 'string' },
      // The label slot's rich form, read when `label` is not set
      // (objectui#6771 converged it onto `children`). Declared so the tier's
      // `not-a-container` — which reads only this input (objectui#9910) — stays
      // silent on the one key this renderer renders. ⛔ Not `isContainer`: that
      // flag means layout containment and would delete `Badge` from every
      // react page's JSX scope (objectui#6804).
      { name: 'children', type: 'slot', description: 'Rich label content, rendered when `label` is not set' }
    ],
    defaultProps: {
      label: 'Badge',
      variant: 'default'
    }
  }
);
