/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Cloud Widget Zod Validators
 *
 * The arm for `@object-ui/app-shell`'s armed `cloud:` SDUI widget:
 * `cloud:workspace-timezone-notice`, for the Cloud welcome page
 * (`console/home/CloudWorkspaceTimezoneNotice.tsx`, objectui#11930) — and
 * the refusal arm of the retired `cloud:plan-status` (objectui#12954), which
 * {@link RetiredCloudPlanStatusNodeSchema} explains.
 *
 * ## Why the arm lands with the registration
 *
 * `AnyComponentSchema` refuses a registered type it has no arm for, with one
 * `invalid_union` issue at `type`, so a page placing the widget could not pass
 * `safeValidateSchema` or `objectui validate`. The count of registered types
 * still refused there is ratcheted by
 * `packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`,
 * which never rises, so the registration and this arm ship together.
 *
 * ## Declared here, measured from the widget's read points
 *
 * `@objectstack/spec` has no `ComponentPropsMap` row for a `cloud:` widget, so
 * nothing is read by reference: the members below are the keys the widget
 * reads, and no other.
 *
 * `cloud:workspace-timezone-notice`:
 *
 *   - `properties` — optional and EMPTY: the widget reads no key of the bag.
 *     The zone it prints comes from the organization's entitlements summary,
 *     never from the page, so there is nothing for the node to author. The
 *     closed, empty bag is `element:divider`'s spelling for a node with no
 *     prop (`public-blocks.zod.ts`).
 *   - `body` / `children` — refused by name. The widget renders one line of
 *     its own copy and reads neither content channel.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`.
 *
 * @module zod/cloud
 * @packageDocumentation
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { retiredNodeType, retirementTombstone } from './tombstone.zod.js';

/**
 * ⛔ `cloud:plan-status` is RETIRED (objectui#12954) — this is its NAMED
 * REFUSAL, the half a deletion would not have given.
 *
 * The widget, its registration and its member-by-member arm went: the Cloud
 * pricing page stopped placing the node (objectstack-ai/cloud#3010). The
 * literal was declared on this face (an arm of `AnyComponentSchema`), so it is
 * the case `retiredNodeType()` exists for, in the shape of
 * `complex.zod.ts#RetiredKanbanNodeSchema` (objectui#8802, maintainer ruling
 * 2026-09-09): deleting the arm would already refuse, but with the union's
 * remedy-free `Invalid input`. What stays is an arm claiming the literal, so a
 * stale `{ "type": "cloud:plan-status" }` document is refused BY NAME, at
 * `type`, with the remedy the retirement's changeset states.
 *
 * Deliberately NOT exported from `index.zod.ts`: nothing outside this package
 * parses against a refusal arm. No TypeScript twin either — the TS half of the
 * retirement is the ABSENCE of a `cloud:plan-status` member in `AnySchema`.
 *
 * Pinned in `../__tests__/cloud-plan-status-retired-12954.test.ts`.
 */
export const RetiredCloudPlanStatusNodeSchema = retiredNodeType(
  'cloud:plan-status',
  'Its widget retired with it (objectui#12954). Compose the page from generic blocks, as ' +
    'objectstack-ai/cloud#3010 did: mark the current plan with a `visibleWhen` on the same ' +
    'summary the page\'s blocks read (`GET /api/v1/cloud/home`), in place of `cloud:plan-status`.',
);

/** One refusal string for both content channels of `CloudWorkspaceTimezoneNoticeSchema`. */
const CLOUD_WORKSPACE_TIMEZONE_NOTICE_NEITHER_CHANNEL =
  'REFUSED (objectui#11930) — `cloud:workspace-timezone-notice` reads NEITHER content channel: its '
  + 'registration hands the node to `CloudWorkspaceTimezoneNotice`, which reads only `className`, and '
  + '`SchemaRenderer` strips both channels out of the props bag it spreads. An authored value would '
  + 'render NOTHING — no render-time error or warning and no element; only the parser tier\'s '
  + '`not-a-container` warning (objectui#9910) noticed it, because the registration declares no '
  + '`children` input. What it renders instead: one line naming the timezone the workspace was seeded '
  + 'with, read from the organization\'s entitlements summary, and nothing when the summary carries no seed.';

/**
 * `cloud:workspace-timezone-notice` — the welcome page's line naming the
 * workspace's seeded timezone (objectui#11930). Pinned by
 * `../__tests__/cloud-workspace-timezone-notice-arm-11930.test.ts`.
 */
export const CloudWorkspaceTimezoneNoticeSchema = BaseSchema.extend({
  type: z.literal('cloud:workspace-timezone-notice'),
  properties: z
    .strictObject({})
    .optional()
    .describe(
      'The `cloud:workspace-timezone-notice` props bag — the widget reads no prop, so the only bag it '
      + 'accepts is `{}`. The zone it names comes from the organization\'s entitlements summary.',
    ),
  body: retirementTombstone(CLOUD_WORKSPACE_TIMEZONE_NOTICE_NEITHER_CHANNEL),
  children: retirementTombstone(CLOUD_WORKSPACE_TIMEZONE_NOTICE_NEITHER_CHANNEL),
});
