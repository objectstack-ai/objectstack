/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import { resolveKeyedI18nLabel } from '@object-ui/react';
import type { ToggleSchema } from '@object-ui/types';
import { Toggle } from '../../ui';
import { renderChildren } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

ComponentRegistry.register('toggle',
  ({ schema, ...props }: { schema: ToggleSchema; [key: string]: any }) => {
    // `style` is forwarded BY NAME rather than reopened in the shared list —
    // the objectui#4435 route, same as the layout renderers objectui#5574
    // converged. Everything else goes through the form-control declaration.
    const { style, ...toggleProps } = props;

    return (
    <Toggle
      variant={schema.variant}
      size={schema.size}
      pressed={schema.pressed}
      // `ariaLabel` is `string | KeyedI18nLabel` (objectui#4581) — the keyed
      // form has to be RESOLVED before it reaches the DOM, exactly as
      // `SchemaRenderer.tsx:111` does for every other component. Forwarding it
      // raw put an object into an `aria-label`, which renders the literal text
      // "[object Object]" to a screen reader. This renderer bypasses
      // SchemaRenderer's `resolveAriaProps`, so it has to do it itself.
      aria-label={resolveKeyedI18nLabel(schema.ariaLabel)}
      {...toFormControlDomProps(toggleProps)}
      style={style}
    >
      {schema.label || renderChildren(schema.children)}
    </Toggle>
  );
  },
  {
    namespace: 'ui',
    label: 'Toggle',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'pressed', type: 'boolean' },
      { name: 'variant', type: 'enum', enum: ['default', 'outline'] },
      { name: 'size', type: 'enum', enum: ['default', 'sm', 'lg'] },
      { name: 'ariaLabel', type: 'string' },
      { name: 'children', type: 'slot', description: 'Rich label content, rendered when `label` is not set' }
    ],
    defaultProps: {
      label: 'Toggle',
      variant: 'default',
      size: 'default'
    }
  }
);
