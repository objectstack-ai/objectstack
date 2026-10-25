/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - `record:approval_decision` Zod Validator
 *
 * The arm for the decision panel of an approval request's record page, the
 * page block `@objectstack/spec` 18 declares as a `PageComponentType` member
 * and `@object-ui/app-shell` registers
 * (`views/record-approval-decision-renderer.tsx`, objectui#12342).
 *
 * ## Why the arm lands with the registration
 *
 * `AnyComponentSchema` refuses a registered type it has no arm for, with one
 * `invalid_union` issue at `type`, so a page placing the panel could not pass
 * `safeValidateSchema` or `objectui validate`. The count of registered types
 * still refused there is ratcheted by
 * `packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`,
 * which never rises, so the registration and this arm ship together.
 *
 * ## Why it is not in `public-blocks.zod.ts`
 *
 * That module arms the ADR-0080 curated vocabulary (`PUBLIC_BLOCKS` in
 * `@object-ui/core`), and its pin holds the union to exactly that list. This
 * block is not curated: whether Studio offers it is a separate decision. So it
 * gets a module of its own, as the `cloud:` widgets do.
 *
 * ## The props bag: the spec row, restated because it is unnamed
 *
 * `ComponentPropsMap['record:approval_decision']` is built inline by the spec
 * (`emptyProps('record:approval_decision')`) and `@objectstack/spec/ui`
 * exports it under no name, so it cannot cross the objectui#8317 boundary by
 * reference — the same reason `element:divider`'s row is restated in
 * `public-blocks.zod.ts`. The row declares no member and is strict, so the
 * restatement is a closed object with no member: it accepts exactly `{}`. The
 * renderer draws from the record context alone, never from the node.
 * `../__tests__/record-approval-decision-arm-12342.test.ts` pins its key set
 * and its accept set to the installed row's, so a prop the spec later adds
 * turns that file red.
 *
 * `body` / `children` are refused by name: the panel renders no child list.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`.
 *
 * @module zod/record-approval-decision
 * @packageDocumentation
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { retirementTombstone } from './tombstone.zod.js';

/** One refusal string for both content channels of `RecordApprovalDecisionBlockSchema`. */
const RECORD_APPROVAL_DECISION_NEITHER_CHANNEL =
  'REFUSED (objectui#12342) — `record:approval_decision` reads NEITHER content channel: its registration '
  + '(`@object-ui/app-shell`) hands the node to `ApprovalDecisionRenderer`, which reads only `className` and '
  + 'the designer attributes off the node, and `SchemaRenderer` strips both channels out of the props bag it '
  + 'spreads. An authored value would render NOTHING — no render-time error or warning and no element; only '
  + 'the parser tier\'s `not-a-container` warning (objectui#9910) noticed it, because the registration '
  + 'declares no `children` input. What it renders instead: the request\'s decision '
  + 'progress and its declared decision actions, drawn from the approval request record the page binds.';

/**
 * `record:approval_decision` — `ComponentPropsMap['record:approval_decision']`,
 * an empty strict row. Pinned by
 * `../__tests__/record-approval-decision-arm-12342.test.ts`.
 */
export const RecordApprovalDecisionBlockSchema = BaseSchema.extend({
  type: z.literal('record:approval_decision'),
  properties: z
    .strictObject({})
    .optional()
    .describe(
      'The `record:approval_decision` props bag — `@objectstack/spec` '
      + '`ComponentPropsMap[\'record:approval_decision\']` declares no prop, so the only bag it accepts is `{}`. '
      + 'The panel draws from the approval request record the page binds.',
    ),
  body: retirementTombstone(RECORD_APPROVAL_DECISION_NEITHER_CHANNEL),
  children: retirementTombstone(RECORD_APPROVAL_DECISION_NEITHER_CHANNEL),
});
