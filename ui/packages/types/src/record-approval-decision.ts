/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - `record:approval_decision` Schema
 *
 * The TypeScript twin of `zod/record-approval-decision.zod.ts` (objectui#12342).
 *
 * @module record-approval-decision
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';

/**
 * `record:approval_decision` — the decision panel of an approval request's
 * record page, the page block `@objectstack/spec` 18 declares and
 * `@object-ui/app-shell` registers (objectui#12342): the TypeScript twin of
 * `zod/record-approval-decision.zod.ts`'s `RecordApprovalDecisionBlockSchema`,
 * landed with the arm.
 *
 *  - `properties` — optional and empty: the spec's
 *    `ComponentPropsMap['record:approval_decision']` row declares no prop. The
 *    panel draws from the approval request record the page binds.
 *  - Neither content channel is read, so both are refused by name, the twin
 *    of the arm's two `retirementTombstone` members.
 *
 * The parity pair is `record-approval-decision.zod.ts#RecordApprovalDecisionBlockSchema`
 * in `__tests__/zod-mirror-parity.test.ts`.
 */
export interface RecordApprovalDecisionBlockSchema extends BaseSchema {
  type: 'record:approval_decision';
  /**
   * The props bag — the spec row declares no prop, so the only bag it
   * accepts is `{}`.
   */
  properties?: Record<string, never>;
  /**
   * REFUSED BY NAME (objectui#12342) — `record:approval_decision` reads
   * neither content channel: `ApprovalDecisionRenderer` reads only
   * `className` and the designer attributes off the node, and
   * `SchemaRenderer` strips both channels out of the props it spreads.
   *
   * @deprecated Not a channel `record:approval_decision` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#12342), for the reason `body` gives.
   *
   * @deprecated Not a channel `record:approval_decision` reads — nothing renders it.
   */
  children?: never;
}
