/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { AlertSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import {
  Alert,
  AlertTitle,
  AlertDescription
} from '../../ui';

ComponentRegistry.register('alert', 
  ({ schema, className, ...props }: { schema: AlertSchema; className?: string; [key: string]: any }) => (
    <Alert variant={schema.variant} className={className} {...props}>
      <AlertTitle>{schema.title}</AlertTitle>
      <AlertDescription>{schema.description || renderChildren(schema.children)}</AlertDescription>
    </Alert>
  ),
  {
    namespace: 'ui',
    label: 'Alert',
    inputs: [
      { name: 'title', type: 'string', required: true },
      { name: 'description', type: 'string' },
      {
        name: 'variant',
        type: 'enum',
        enum: ['default', 'destructive']      },
      { name: 'className', type: 'string' },
      // The description slot's rich form, read when `description` is not set
      // (objectui#6771 converged it onto `children`). Declared so the tier's
      // `not-a-container` — which reads only this input (objectui#9910) — stays
      // silent on the one key this renderer renders. ⛔ Not `isContainer`: that
      // flag means layout containment and would delete `Alert` from every
      // react page's JSX scope (objectui#6804).
      { name: 'children', type: 'slot', description: 'Rich description content, rendered when `description` is not set' }
    ],
    defaultProps: {
      title: 'Alert Title',
      description: 'This is an alert message.',
      variant: 'default'
    }
  }
);
