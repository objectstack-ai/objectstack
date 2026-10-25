/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { AvatarSchema } from '@object-ui/types';
import {
  Avatar,
  AvatarImage,
  AvatarFallback
} from '../../ui';

ComponentRegistry.register('avatar', 
  ({ schema, className, ...props }: { schema: AvatarSchema; className?: string; [key: string]: any }) => (
    <Avatar className={className} {...props}>
      <AvatarImage src={schema.src} alt={schema.alt} />
      <AvatarFallback>{schema.fallback}</AvatarFallback>
    </Avatar>
  ),
  {
    namespace: 'ui',
    label: 'Avatar',
    inputs: [
      { name: 'src', type: 'string' },
      { name: 'alt', type: 'string' },
      { name: 'fallback', type: 'string' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      fallback: 'CN',
      alt: 'Avatar'
    }
  }
);
