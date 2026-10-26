/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isValidElement } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { CollapsibleSchema } from '@object-ui/types';
import { 
  Collapsible, 
  CollapsibleTrigger, 
  CollapsibleContent 
} from '../../ui';
import { renderChildren } from '../../lib/utils';

ComponentRegistry.register('collapsible', 
  // `hostDisabled` is `SchemaRenderer`'s EVALUATED verdict on `disabled` /
  // `disabledOn`, not the raw authored key — which may be a predicate STRING,
  // truthy however it evaluates (objectui#7238, precedent objectui#6169).
  //
  // `open: _open` is a NAMED EXCLUSION, not an unused parameter (objectui#8236,
  // maintainer ruling 2026-09-17 「9593 A,其他同意」, step 1 of two).
  //
  // Nothing in this file ever WROTE `open` — that is why a `schema.open` grep
  // read zero and this card was filed as "declared but inert", the opposite of
  // the truth. `SchemaRenderer` strips schema METADATA from the node and
  // spreads everything else as React props (the `outgoingComponentProps`
  // spread); `open` is not on that strip list, so an authored `open` arrived
  // inside `...props` here and, because the spread is written LAST, it beat the
  // `defaultOpen` written above it and made the Radix primitive CONTROLLED.
  // Its other half, `onOpenChange`, is refused by name on the zod face
  // (objectui#6124), so a JSON author could not supply the handler that would
  // move a controlled primitive: `open: true` froze the trigger open,
  // `open: false` froze it shut and beat `defaultOpen: true` — measured through
  // the real renderer and the real registry, both polarities, in
  // `packages/components/src/__tests__/collapsible-open-intercept-8236.test.tsx`.
  //
  // Destructuring it out returns this block to its own published `inputs`
  // (`defaultOpen` / `disabled` / `trigger` / `content` / `className`), which is
  // 「拉回已声明契约」 and nothing more. ⛔ Deliberately NOT done on
  // `SchemaRenderer`'s global strip list: `open` is a real live prop on
  // `dialog` / `sheet` / `popover`, where the same rest-spread channel is the
  // one they render through.
  //
  // ⛔ `onOpenChange` is NOT excluded here. It is a RUNTIME SLOT a React host
  // supplies through props (its TypeScript docblock in `@object-ui/types` says
  // so, and `zod-mirror-parity.test.ts` ledgers it), so it keeps riding this
  // spread onto the Radix root, where it fires for the UNCONTROLLED toggling
  // this exclusion restores.
  ({ schema, className, disabled: hostDisabled, open: _open, ...props }: { schema: CollapsibleSchema; className?: string; disabled?: boolean; [key: string]: any }) => {
    // `asChild` is CONDITIONAL, and the condition is Radix's own structural
    // precondition, not a preference (objectui#9701).
    //
    // `asChild` resolves the primitive to Radix's `Slot`, which merges its
    // props onto its child by way of `React.Children.only` — it takes a SINGLE
    // React element and refuses everything else with
    // 「Primitive.button failed to slot onto its children」. `trigger` is a node
    // slot, and both published faces admit a bare string on it: the TypeScript
    // union `SchemaNode` names `string` explicitly, and the zod mirror types
    // the key against that same union. So `trigger: 'Show more'` — the most
    // natural thing to write for something called a trigger — validated, then
    // threw here and landed the whole node in `SchemaRenderer`'s error
    // boundary, with no diagnostic naming the key.
    //
    // Withholding `asChild` exactly where Slot cannot serve lets the Radix
    // primitive render its OWN `<button>` around whatever came back, so a
    // string paints as the trigger's text and stays a real trigger — the
    // implementation catching up to a declaration that already said yes.
    // ⛔ Neither published face moves: `packages/types` is untouched by this
    // change, and the accept set is the same set it already shipped.
    //
    // ⛔ Not `typeof === 'string'`: the same refusal fires for a multi-node
    // trigger array and for an empty slot's `null`, which are the same
    // structural mismatch wearing different values. The predicate asks Radix's
    // question — "is this one element?" — so every arm that is not one element
    // takes the primitive's own button, and the element arm keeps the merge
    // unchanged (pinned by this file's `ASCHILD_STILL_ON` control in
    // `collapsible-bare-string-trigger-9701.test.tsx`).
    const trigger = renderChildren(schema.trigger);
    return (
      <Collapsible defaultOpen={schema.defaultOpen} disabled={hostDisabled} className={className} {...props}>
         <CollapsibleTrigger asChild={isValidElement(trigger)}>
           {trigger}
         </CollapsibleTrigger>
         <CollapsibleContent>
           {renderChildren(schema.content)}
         </CollapsibleContent>
      </Collapsible>
    );
  },
  {
    namespace: 'ui',
    label: 'Collapsible',
    inputs: [
      { name: 'defaultOpen', type: 'boolean' },
      { name: 'disabled', type: 'boolean' },
       { 
        name: 'trigger', 
        type: 'slot'      },
      { 
        name: 'content', 
        type: 'slot'      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      trigger: [{ type: 'button', label: 'Toggle', variant: 'outline' }],
      content: [{ type: 'text', content: 'Collapsible content goes here' }],
      className: 'w-full'
    }
  }
);
