/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { SpinnerSchema } from '@object-ui/types';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * `ui:spinner`'s host is an SVG (lucide's `Loader2`), so its DOM pass-through is
 * the bare `toDomProps` — objectui#5632, the `BARE_SPREAD_ON_SVG` slice of
 * objectui#5574. `SpinnerSchema` declares exactly one key beyond the SDUI base,
 * `size`, and this renderer already CONSUMES it by name through `sizeClasses`;
 * nothing it declares needs to reach the element through a spread. That count
 * is over the keys an author can WRITE and this renderer can RECEIVE — which
 * is what "beyond the SDUI base" already says — so a `?: never`
 * refuse-by-name is not in it but the tombstone of an adjudicated-retired
 * key, its own `@deprecated` line in `packages/types/src/feedback.ts`
 * carrying the verdict under the maintainer ruling recorded with the
 * objectui#9256 family-D pin
 * (`packages/types/src/__tests__/content-channel-family-d-9256.test.ts`);
 * adding or retiring one moves nothing this sentence counts.
 *
 * ⚠️ The bare spread was not merely noisy here, and the defect it carried is one
 * the sweep gate could never report: `size` is an ENUM (`sm`/`md`/`lg`/`xl`),
 * and spreading it handed the string to lucide's numeric `size` prop, which put
 * `width="lg" height="lg"` — invalid SVG dimensions — on the element. The judge
 * counts `width`/`height` as legitimate on an SVG host, so that reading sat
 * inside the LEGITIMATE half of the measurement and moved no number the gate
 * watches, in either direction. It is measured and pinned in
 * `examples/schema-catalog/test/svg-host-dom-leak-5632.test.tsx`.
 *
 * ## The `className` this renderer was dropping
 *
 * `className` is on the SDUI pass-through list, so filtering the spread does
 * NOT stop it clobbering — it stayed inside `props` here and overrode the
 * computed class that follows it, which is why a `ui:spinner` rendered through
 * `SchemaRenderer` carried `class="lucide lucide-loader-circle"` and neither
 * `animate-spin` nor its size class: measured on this file's pre-slice tree,
 * i.e. the spinner did not spin. It is destructured and MERGED here, the way
 * the sibling `basic/icon.tsx` in this same group already did it and the way
 * the migration's worked example `layout/grid.tsx` (objectui#4787 / PR #5573)
 * does by ordering. Same bare spread, same line, the other half of its harm:
 * routing the spread without this leaves the filter forwarding a key that
 * destroys a legitimate computed value.
 */
ComponentRegistry.register('spinner', 
  ({ schema, className, ...props }: { schema: SpinnerSchema; className?: string; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...spinnerProps
    } = props;
    
    const sizeClasses = {
      sm: 'h-4 w-4',
      md: 'h-6 w-6',
      lg: 'h-8 w-8',
      xl: 'h-12 w-12'
    };
    
    return (
      <Loader2 
        className={cn('animate-spin', sizeClasses[schema.size || 'md'], schema.className, className)}
        {...toDomProps(spinnerProps)}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      />
    );
  },
  {
    namespace: 'ui',
    label: 'Spinner',
    inputs: [
      { 
        name: 'size', 
        type: 'enum', 
        enum: ['sm', 'md', 'lg', 'xl']      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      size: 'md'
    }
  }
);
