/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ButtonSchema } from '@object-ui/types';
import { Button } from '../../ui';
import { renderChildren } from '../../lib/utils';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';
import { resolveIcon } from '../action/resolve-icon';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const ButtonRenderer = forwardRef<HTMLButtonElement, { schema: ButtonSchema }>(
  // `disabled` is the host-EVALUATED verdict, taken by name. `SchemaRenderer`
  // evaluates the node's `disabled` / `disabledOn` (either may be a predicate
  // STRING), strips the raw key from the props it spreads, and forwards the
  // verdict as a real `disabled` prop. Consuming it here rather than re-reading
  // `schema.disabled` keeps one carrier for one question (AGENTS.md #0.1,
  // objectui#7238; precedent `plugin-chatbot`, objectui#6169) — and taking it
  // OFF `props` is the load-bearing half, see `isDisabled` below.
  ({ schema, disabled: hostDisabled, ...props }: { schema: ButtonSchema; disabled?: boolean; [key: string]: any }, ref) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...buttonProps 
    } = props;

    // Resolve the icon through the SHARED resolver (objectui#5993). This file
    // used to carry its own `toPascalCase` + `iconNameMap` + `icons` index — the
    // same algorithm, but not the same function, so an alias added to
    // `resolve-icon.ts` to absorb a lucide retirement (objectui#5586, #5622)
    // reached every `action:*` site and silently missed `ui:button`.
    const Icon = resolveIcon(schema.icon);
    
    // Determine loading state
    const isLoading = schema.loading || props.loading;
    
    // Determine disabled state. This used to be
    // `schema.disabled || props.disabled || isLoading`, and the `loading` leg of
    // that OR never reached the element: `disabled` also rode `buttonProps` into
    // `toFormControlDomProps` below, which forwards it BY NAME and keeps the key
    // even when the value is `undefined` (`pickDomProps` iterates `Object.keys`).
    // Spread after `disabled={isDisabled}`, it overwrote the computed value with
    // the host's verdict — so a `loading` button with no authored predicate
    // rendered its spinner on a live, clickable control. Destructuring `disabled`
    // out of `props` above removes that second writer; this is now the only one.
    const isDisabled = hostDisabled || isLoading;

    return (
    <Button 
        ref={ref}
        type={schema.buttonType || "button"}
        variant={schema.variant} 
        size={schema.size} 
        className={schema.className} 
        disabled={isDisabled}
        {...toFormControlDomProps(buttonProps)}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {!isLoading && Icon && schema.iconPosition !== 'right' && <Icon className="mr-2 h-4 w-4" />}
      {schema.label || renderChildren(schema.children)}
      {!isLoading && Icon && schema.iconPosition === 'right' && <Icon className="ml-2 h-4 w-4" />}
    </Button>
  );
  }
);
ButtonRenderer.displayName = 'ButtonRenderer';

ComponentRegistry.register('button', ButtonRenderer,
  {
    namespace: 'ui',
    label: 'Button',
    inputs: [
      { name: 'label', type: 'string' },
      { 
        name: 'variant', 
        type: 'enum', 
        enum: ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link']      },
      {
        name: 'size',
        type: 'enum',

        enum: ['default', 'sm', 'lg', 'icon']      },
      { name: 'className', type: 'string' },
      // The label slot's rich form, read when `label` is not set. Declared so
      // the tier's `not-a-container` — which reads only this input
      // (objectui#9910) — stays silent on a key this renderer renders. ⛔ Not
      // `isContainer`: objectui#6804 ruled that flag means LAYOUT containment,
      // and declaring it here would delete `Button` from every react page's
      // JSX scope; the ruled `button` exclusion in the containment ledger is
      // paid by this line instead.
      { name: 'children', type: 'slot', description: 'Rich label content, rendered when `label` is not set' }
    ],
    defaultProps: {
      label: 'Button',
      variant: 'default',
      size: 'default'
    }
  }
);
