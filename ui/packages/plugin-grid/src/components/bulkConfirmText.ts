/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { fillTemplateHoles, hasTemplateHoles } from '@object-ui/core';
import type { BulkActionDef } from '@object-ui/types';
import { BULK_CONFIRM_COUNT_ROOT } from '@objectstack/spec/ui';

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
 * {@link bulkConfirmText} is the reader that fills them.
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

/**
 * The confirm sentence a bulk action's `confirmText` shows, its `{{ }}` holes
 * filled over the bulk-confirm scope the protocol declares
 * (`bulkConfirmTemplateRoots`, ruling B on objectstack#24798): `{{ count }}` is
 * the number of records the run covers. Returns `undefined` exactly when
 * {@link bulkConfirmTextSource} does, so the caller keeps its default
 * sentence.
 *
 * Filled through core's `fillTemplateHoles`, the template engine the flow
 * notifications and the single-record `confirmText` render with, so the
 * engine's whitelisted formatters apply (`{{ count | number }}`) and no hole
 * holds logic. A sentence without a `{{ }}` hole is shown as written.
 *
 * ⚠️ Step 1 of objectstack#25942: only `count` is bound. A hole naming one of
 * the def's params resolves to nothing and prints empty, as an unbound path
 * does in every template, until the param roots are filled with their display
 * values.
 */
export function bulkConfirmText(
  confirmText: BulkActionDef['confirmText'] | null | undefined,
  scope: { count: number },
): string | undefined {
  const source = bulkConfirmTextSource(confirmText);
  if (source === undefined || !hasTemplateHoles(source)) return source;
  return fillTemplateHoles(source, { [BULK_CONFIRM_COUNT_ROOT]: scope.count });
}
