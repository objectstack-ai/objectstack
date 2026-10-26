/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ProgressSchema } from '@object-ui/types';
import { Progress } from '../../ui';

ComponentRegistry.register('progress', 
  ({ schema, className, ...props }: { schema: ProgressSchema; className?: string; [key: string]: any }) => (
    <Progress value={schema.value} className={className} {...props} />
  ),
  {
    namespace: 'ui',
    label: 'Progress',
    inputs: [
      { name: 'value', type: 'number' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      value: 50,
      className: 'w-full'
    }
  }
);
