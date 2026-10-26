/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BulkActionDef } from '@object-ui/types';

/**
 * The text a bulk action's `confirmText` carries: the string itself, or the
 * `source` of a `{ dialect: 'template', source }` envelope, verbatim. Returns
 * `undefined` when the slot is absent, blank (empty or whitespace-only), or
 * carries no string `source` — the caller shows its default sentence then.
 *
 * Why two arms (objectui#13183, step 1 of the landing order for
 * objectstack#24947): the protocol is making this slot a `template`-dialect
 * slot, so a parsed bulk def serves the envelope where it served a string.
 * Rendered as a React child, the envelope is an object and the confirm step
 * breaks. This reader accepts both shapes, the way core's
 * `formatTitleTemplate` reads `titleFormat`, so the renderer can move before
 * the spec does.
 *
 * ⚠️ The `{{ }}` holes are NOT filled here: `source` is returned as written.
 * Filling `{{ count }}` and the param roots is the card's next step.
 */
export function bulkConfirmTextSource(
  confirmText: BulkActionDef['confirmText'] | null | undefined,
): string | undefined {
  const text =
    typeof confirmText === 'string'
      ? confirmText
      : confirmText !== null && typeof confirmText === 'object' && typeof confirmText.source === 'string'
        ? confirmText.source
        : undefined;
  return text !== undefined && text.trim() !== '' ? text : undefined;
}
