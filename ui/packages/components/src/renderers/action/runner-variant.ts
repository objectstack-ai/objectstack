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
 * The `variant` an action block forwards to the action runner
 * (objectstack#26665).
 *
 * `@objectstack/spec` spells `variant` in two dialects, each on its own
 * surface. The four action blocks' rows (`ActionButtonPropsSchema`,
 * `ActionIconPropsSchema`, `ActionGroupPropsSchema`, `ActionMenuPropsSchema`
 * and the group/menu member items) take the Button primitive's vocabulary,
 * plus `primary`, and refuse `danger`. `ActionSchema`, which the runner
 * dispatches, takes `primary | secondary | danger | ghost | link`. The runner
 * reads `variant` for one purpose: `danger` paints the confirm button
 * destructive (`confirmOptions` in `ActionRunner.ts`).
 *
 * So this forward is the one place a block's value becomes an action's:
 * `destructive` is `danger`, the four values both dialects spell alike pass
 * through, and `default` / `outline`, which the action dialect has no word
 * for, forward nothing. ⛔ Not a reader-side alias: the block rows keep
 * refusing `danger`, and nothing here reads it.
 */
export function toRunnerVariant(variant: UIActionSchema['variant']): ActionDef['variant'] {
  switch (variant) {
    case 'destructive':
      return 'danger';
    case 'primary':
    case 'secondary':
    case 'ghost':
    case 'link':
      return variant;
    default:
      return undefined;
  }
}
