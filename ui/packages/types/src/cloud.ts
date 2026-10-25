/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Cloud Widget Schemas
 *
 * The TypeScript twin of `zod/cloud.zod.ts` (objectui#11930).
 *
 * @module cloud
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';

/**
 * `cloud:workspace-timezone-notice` — the Cloud welcome page's line naming the
 * timezone a workspace was seeded with at creation, the SDUI widget
 * `@object-ui/app-shell` registers for that page (objectui#11930): the
 * TypeScript twin of `zod/cloud.zod.ts`'s `CloudWorkspaceTimezoneNoticeSchema`,
 * landed with the arm.
 *
 * The members are read from the widget's read points, as the arm's module
 * header gives them:
 *
 *  - `properties` — optional and empty: the widget reads no key of the bag.
 *    The zone it prints comes from the organization's entitlements summary,
 *    never from the page.
 *  - Neither content channel is read, so both are refused by name, the twin
 *    of the arm's two `retirementTombstone` members.
 *
 * The parity pair is `cloud.zod.ts#CloudWorkspaceTimezoneNoticeSchema` in
 * `__tests__/zod-mirror-parity.test.ts`. The widget's own props type stays in
 * `@object-ui/app-shell`.
 */
export interface CloudWorkspaceTimezoneNoticeSchema extends BaseSchema {
  type: 'cloud:workspace-timezone-notice';
  /**
   * The props bag — the widget reads no prop, so the only bag it accepts is
   * `{}`. The zone it names comes from the organization's entitlements
   * summary.
   */
  properties?: Record<string, never>;
  /**
   * REFUSED BY NAME (objectui#11930) — `cloud:workspace-timezone-notice` reads
   * neither content channel: `CloudWorkspaceTimezoneNotice` reads only
   * `className`, and `SchemaRenderer` strips both channels out of the props it
   * spreads.
   *
   * @deprecated Not a channel `cloud:workspace-timezone-notice` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#11930), for the reason `body` gives.
   *
   * @deprecated Not a channel `cloud:workspace-timezone-notice` reads — nothing renders it.
   */
  children?: never;
}
