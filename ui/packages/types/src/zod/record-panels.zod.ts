/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - `record:approvals` / `record:attachments` Zod Validators
 *
 * The arms for two record-page panels, the page blocks `@objectstack/spec` 18
 * declares as `PageComponentType` members and `@object-ui/app-shell` registers
 * (`views/record-approvals-renderer.tsx`, `views/record-attachments-renderer.tsx`).
 * `buildDefaultPageSchema` (`@object-ui/plugin-detail`) emits both, as the
 * Approvals and Attachments tabs of the default record page (objectui#12363).
 *
 * ## Why these arms exist
 *
 * `AnyComponentSchema` refuses a type it has no arm for, with one
 * `invalid_union` issue at `type`. Both blocks were registered without an arm,
 * so a record page carrying either one, including the page objectui builds
 * itself, failed `safeValidateSchema` and `objectui validate` while the spec
 * accepted it. The count of registered types still refused there is ratcheted
 * by `packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`,
 * which these two arms lower by two.
 *
 * ## Why they are not in `public-blocks.zod.ts`
 *
 * That module arms the ADR-0080 curated vocabulary (`PUBLIC_BLOCKS` in
 * `@object-ui/core`), and its pin holds the union to exactly that list. These
 * blocks are not curated, and Studio does not offer them. So they get a module
 * of their own, as `record:approval_decision` does.
 *
 * ## The props bags: the spec rows, restated because they are unnamed
 *
 * Both rows declare no member and are strict:
 *
 *  - `ComponentPropsMap['record:approvals']` is the spec's `RecordApprovalsProps`,
 *    which `@objectstack/spec/ui` does not export under that name. Its guidance
 *    names `approvals` and `currentUserId` as the HOST's channels, not
 *    authorable surface.
 *  - `ComponentPropsMap['record:attachments']` is built inline
 *    (`emptyProps('record:attachments')`) and exported under no name.
 *
 * Neither can cross the objectui#8317 boundary by reference, the same reason
 * `element:divider`'s row is restated in `public-blocks.zod.ts`. So each
 * restatement is a closed object with no member: it accepts exactly `{}`.
 * `../__tests__/record-panels-arms-12363.test.ts` pins each bag's key set and
 * accept set to the installed row's, so a prop the spec later adds turns that
 * file red.
 *
 * `body` / `children` are refused by name: neither panel renders a child list.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`.
 *
 * @module zod/record-panels
 * @packageDocumentation
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { retirementTombstone } from './tombstone.zod.js';

/** One refusal string for both content channels of `RecordApprovalsBlockSchema`. */
const RECORD_APPROVALS_NEITHER_CHANNEL =
  'REFUSED (objectui#12363) — `record:approvals` reads NEITHER content channel: its registration '
  + '(`@object-ui/app-shell`) hands the node to `RecordApprovalsRenderer`, which reads `className`, the '
  + 'designer attributes and the host\'s runtime payload off the node, and `SchemaRenderer` strips both '
  + 'channels out of the props bag it spreads. An authored value would render NOTHING — no render-time '
  + 'error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) '
  + 'noticed it, because the registration declares no `children` input. What it renders instead: the '
  + 'record\'s approval requests and their merged decision timeline, fetched for the record the page binds.';

/** One refusal string for both content channels of `RecordAttachmentsBlockSchema`. */
const RECORD_ATTACHMENTS_NEITHER_CHANNEL =
  'REFUSED (objectui#12363) — `record:attachments` reads NEITHER content channel: its registration '
  + '(`@object-ui/app-shell`) hands the node to `RecordAttachmentsRenderer`, which reads only `className` '
  + 'and the designer attributes off the node, and `SchemaRenderer` strips both channels out of the props '
  + 'bag it spreads. An authored value would render NOTHING — no render-time error or warning and no '
  + 'element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it, because the '
  + 'registration declares no `children` input. What it renders instead: the files attached to the record '
  + 'the page binds, with upload, download and delete controls.';

/**
 * `record:approvals` — `ComponentPropsMap['record:approvals']`, an empty
 * strict row. Pinned by `../__tests__/record-panels-arms-12363.test.ts`.
 */
export const RecordApprovalsBlockSchema = BaseSchema.extend({
  type: z.literal('record:approvals'),
  properties: z
    .strictObject({})
    .optional()
    .describe(
      'The `record:approvals` props bag — `@objectstack/spec` `ComponentPropsMap[\'record:approvals\']` '
      + 'declares no prop, so the only bag it accepts is `{}`. `approvals` and `currentUserId` are the host\'s '
      + 'runtime channels, not authorable: with no host payload the block fetches the record\'s own approval '
      + 'requests and reads the signed-in user itself.',
    ),
  body: retirementTombstone(RECORD_APPROVALS_NEITHER_CHANNEL),
  children: retirementTombstone(RECORD_APPROVALS_NEITHER_CHANNEL),
});

/**
 * `record:attachments` — `ComponentPropsMap['record:attachments']`, an empty
 * strict row. Pinned by `../__tests__/record-panels-arms-12363.test.ts`.
 */
export const RecordAttachmentsBlockSchema = BaseSchema.extend({
  type: z.literal('record:attachments'),
  properties: z
    .strictObject({})
    .optional()
    .describe(
      'The `record:attachments` props bag — `@objectstack/spec` `ComponentPropsMap[\'record:attachments\']` '
      + 'declares no prop, so the only bag it accepts is `{}`. The panel lists the files of the record the '
      + 'page binds.',
    ),
  body: retirementTombstone(RECORD_ATTACHMENTS_NEITHER_CHANNEL),
  children: retirementTombstone(RECORD_ATTACHMENTS_NEITHER_CHANNEL),
});
