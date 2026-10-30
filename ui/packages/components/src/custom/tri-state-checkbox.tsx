/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TriStateCheckbox
 *
 * The Shadcn checkbox with a distinct mixed state: `checked="indeterminate"`
 * draws a dash, `true` draws the check, `false` draws nothing. Radix's
 * Indicator renders for both checked and indeterminate, and the upstream
 * `ui/checkbox.tsx` hard-codes a check mark inside it, so a partial selection
 * would read as "all selected".
 *
 * This lives in `custom/` to avoid modifying the Shadcn-synced
 * `ui/checkbox.tsx`; its classes mirror that file, plus the indeterminate fill.
 * Internal to this package: not re-exported from `custom/index.ts`.
 */

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

const TriStateCheckbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, checked, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    checked={checked}
    className={cn(
      'grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('grid place-content-center text-current')}>
      {checked === 'indeterminate'
        ? <Minus className="h-4 w-4" data-glyph="dash" />
        : <Check className="h-4 w-4" data-glyph="check" />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
TriStateCheckbox.displayName = 'TriStateCheckbox';

export { TriStateCheckbox };
