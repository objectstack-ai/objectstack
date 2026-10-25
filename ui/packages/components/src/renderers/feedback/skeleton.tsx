/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SkeletonSchema } from '@object-ui/types';
import { Skeleton } from '../../ui';

ComponentRegistry.register('skeleton', 
  ({ schema, className, ...props }: { schema: SkeletonSchema; className?: string; [key: string]: any }) => (
    <Skeleton className={className} {...props} style={{ width: schema.width, height: schema.height }} />
  ),
  {
    namespace: 'ui',
    label: 'Skeleton',
    inputs: [
      { name: 'width', type: 'string' },
      { name: 'height', type: 'string' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      width: '100%',
      height: '20px',
      className: 'rounded-md'
    }
  }
);
