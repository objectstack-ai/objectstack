/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ActionDef } from '@object-ui/core';
import type { UIActionSchema } from '@object-ui/types';

/**
 * The two places an action block's `variant` is read (objectstack#26779).
 *
 * `@objectstack/spec` spells an action's variant in one dialect: the four
 * action blocks' rows (`ActionButtonPropsSchema`, `ActionIconPropsSchema`,
 * `ActionGroupPropsSchema`, `ActionMenuPropsSchema` and the group/menu member
 * items) take the Button primitive's vocabulary with its destructive arm
 * spelled `danger`, the word `ActionSchema.variant` and the runner use, plus
 * `primary`. Until protocol 18 the blocks spelled that arm `destructive` and
 * the forward translated it (objectstack#26665). The rows now refuse
 * `destructive`, and the ADR-0087 conversion
 * `page-action-block-variant-destructive-to-danger` rewrites stored pages, so
 * ⛔ neither function here reads `destructive`: a block forwards `danger`
 * as it is.
 */

/**
 * The `variant` an action block forwards to the action runner. The runner
 * reads it for one purpose: `danger` paints the confirm button destructive
 * (`confirmOptions` in `ActionRunner.ts`). The values both vocabularies
 * share pass through; `default` / `outline`, which the action dialect has no
 * word for, forward nothing.
 */
export function toRunnerVariant(variant: UIActionSchema['variant']): ActionDef['variant'] {
  switch (variant) {
    case 'danger':
    case 'primary':
    case 'secondary':
    case 'ghost':
    case 'link':
      return variant;
    default:
      return undefined;
  }
}

/** The Button primitive's own variant vocabulary. */
export type ButtonPrimitiveVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';

/**
 * The Button primitive variant an action block draws: `danger` is the
 * primitive's `destructive`, `primary` draws as `default`, and the rest are
 * the primitive's own words. An absent variant draws `fallback`, the
 * renderer's default.
 */
export function toButtonVariant(
  variant: UIActionSchema['variant'],
  fallback: ButtonPrimitiveVariant,
): ButtonPrimitiveVariant {
  switch (variant) {
    case 'danger':
      return 'destructive';
    case 'primary':
      return 'default';
    case 'default':
    case 'outline':
    case 'secondary':
    case 'ghost':
    case 'link':
      return variant;
    default:
      return fallback;
  }
}
