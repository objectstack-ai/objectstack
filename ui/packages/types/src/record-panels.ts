/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - `record:approvals` / `record:attachments` Schemas
 *
 * The TypeScript twins of `zod/record-panels.zod.ts` (objectui#12363).
 *
 * @module record-panels
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';

/**
 * `record:approvals` — the record page's approval timeline, the page block
 * `@objectstack/spec` 18 declares and `@object-ui/app-shell` registers: the
 * TypeScript twin of `zod/record-panels.zod.ts`'s `RecordApprovalsBlockSchema`.
 *
 *  - `properties` — optional and empty: the spec's
 *    `ComponentPropsMap['record:approvals']` row declares no prop. `approvals`
 *    and `currentUserId` are the host's runtime channels, not authorable.
 *  - Neither content channel is read, so both are refused by name, the twin
 *    of the arm's two `retirementTombstone` members.
 *
 * The parity pair is `record-panels.zod.ts#RecordApprovalsBlockSchema` in
 * `__tests__/zod-mirror-parity.test.ts`.
 */
export interface RecordApprovalsBlockSchema extends BaseSchema {
  type: 'record:approvals';
  /**
   * The props bag — the spec row declares no prop, so the only bag it
   * accepts is `{}`.
   */
  properties?: Record<string, never>;
  /**
   * REFUSED BY NAME (objectui#12363) — `record:approvals` reads neither
   * content channel: `RecordApprovalsRenderer` reads `className`, the designer
   * attributes and the host's runtime payload off the node, and
   * `SchemaRenderer` strips both channels out of the props it spreads.
   *
   * @deprecated Not a channel `record:approvals` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#12363), for the reason `body` gives.
   *
   * @deprecated Not a channel `record:approvals` reads — nothing renders it.
   */
  children?: never;
}

/**
 * `record:attachments` — the record page's file list, the page block
 * `@objectstack/spec` 18 declares and `@object-ui/app-shell` registers: the
 * TypeScript twin of `zod/record-panels.zod.ts`'s `RecordAttachmentsBlockSchema`.
 *
 *  - `properties` — optional and empty: the spec's
 *    `ComponentPropsMap['record:attachments']` row declares no prop.
 *  - Neither content channel is read, so both are refused by name, the twin
 *    of the arm's two `retirementTombstone` members.
 *
 * The parity pair is `record-panels.zod.ts#RecordAttachmentsBlockSchema` in
 * `__tests__/zod-mirror-parity.test.ts`.
 */
export interface RecordAttachmentsBlockSchema extends BaseSchema {
  type: 'record:attachments';
  /**
   * The props bag — the spec row declares no prop, so the only bag it
   * accepts is `{}`.
   */
  properties?: Record<string, never>;
  /**
   * REFUSED BY NAME (objectui#12363) — `record:attachments` reads neither
   * content channel: `RecordAttachmentsRenderer` reads only `className` and
   * the designer attributes off the node, and `SchemaRenderer` strips both
   * channels out of the props it spreads.
   *
   * @deprecated Not a channel `record:attachments` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#12363), for the reason `body` gives.
   *
   * @deprecated Not a channel `record:attachments` reads — nothing renders it.
   */
  children?: never;
}
