/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type * as React from 'react';

/**
 * The payload of the `slider-thumb-pass-through` local patch
 * (`scripts/shadcn-local-patches.mjs`, objectui#3318).
 *
 * ## The defect this exists for
 *
 * A Radix slider's focusable control is the THUMB — `span[role="slider"]`,
 * `tabindex="0"`, the element that carries `aria-valuenow` and the one a
 * keyboard user and their screen reader actually land on. `Slider.Root` renders
 * a role-less wrapper `span` and forwards every unrecognised prop to it, so a
 * host's control-channel facts (`id`, `aria-invalid`, `aria-describedby`,
 * `aria-labelledby`, `aria-required`) landed on a wrapper assistive technology
 * never visits. Measured on `origin/main`, a real form + a required slider that
 * had just failed validation:
 *
 * ```
 * slider  ariaInvalidTrue=[]  labelFor=…-form-item -> DANGLING
 *         descConsumers=0     focusable=[span[slider],input]
 *         ids=[]              <- no element of the row carried an id at all
 * ```
 *
 * This is the same shape objectui#3306 fixed for `select`, one step harder:
 * there the focusable control is `SelectTrigger`, a component the primitive
 * EXPORTS, so the widget could address it directly. `ui/slider.tsx` renders its
 * thumb internally and exports only `Slider`, so the widget has no handle on
 * the one element that must carry the state — hence a pass-through.
 *
 * ## Why a declared prop and not an implicit bridge
 *
 * The primitive could instead have COPIED a fixed list of `aria-*` keys from
 * its own props down to the thumb. Rejected: the copy would leave the same keys
 * on Root as well, and for `id` that is not a duplicate attribute but a
 * duplicate DOM ID — `document.getElementById` answers with the wrapper, so a
 * host `<label for>` would resolve to the non-focusable span and the bug would
 * survive its own fix wearing a green test. Splitting is therefore mandatory,
 * and once the caller must say which keys go where, saying it explicitly is
 * strictly better than a list the caller cannot see (AGENTS.md #0.1: one strict
 * contract, no consumer-side guessing).
 *
 * ## Where the split is decided
 *
 * Not here — this only routes. The widget decides, and `SliderField` mirrors
 * `SelectField`'s #3306 split exactly: `name` and `disabled` stay on Root (Root
 * owns the hidden form input and is the single disabled authority), everything
 * else in the DOM pass-through whitelist goes to the thumb.
 */

/** Props the `Slider` wrapper hands to its internal `SliderPrimitive.Thumb`. */
export interface SliderThumbPassThrough {
  /**
   * Forwarded verbatim onto the focusable `span[role="slider"]`.
   *
   * Deliberately typed as the DOM attribute surface rather than
   * `ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>`: this module must
   * not import the primitive (it is consumed BY the no-touch file, and a cycle
   * through it would be a fragile thing to hang a sync patch on), and the thumb
   * is a plain `span` as far as every key a host delivers is concerned.
   */
  thumbProps?: React.HTMLAttributes<HTMLSpanElement> & {
    id?: string;
    tabIndex?: number;
    'aria-label'?: string;
  };
}

/**
 * Route a `Slider`'s props to the two elements that need them.
 *
 * `thumbProps` is REMOVED from the root half — leaving it there would put
 * `thumbprops="[object Object]"` on the wrapper span, which is exactly the leak
 * objectui#3291's sweep exists to catch.
 *
 * The pre-existing `aria-label` bridge is preserved and applied FIRST, so a
 * caller that passes both keeps the explicit `thumbProps` value; nothing about
 * the attribute's previous behaviour changes for callers that pass neither.
 */
export function splitSliderThumbProps<P extends Record<string, unknown>>(
  props: P,
): { root: Omit<P, 'thumbProps'>; thumb: Record<string, unknown> } {
  const { thumbProps, ...root } = props as P & SliderThumbPassThrough;
  return {
    root: root as Omit<P, 'thumbProps'>,
    thumb: {
      'aria-label': props['aria-label'] as string | undefined,
      ...(thumbProps ?? {}),
    },
  };
}
