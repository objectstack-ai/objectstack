/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - `security:effective-access` Schema
 *
 * The TypeScript twin of `zod/security-effective-access.zod.ts`.
 *
 * @module security-effective-access
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';

/**
 * `security:effective-access` — one person's effective permission sets, each
 * with every origin it reaches them through (default, a position, direct,
 * derived), for a `sys_user` record page: the SDUI widget
 * `@object-ui/app-shell` registers. The TypeScript twin of
 * `zod/security-effective-access.zod.ts`'s `SecurityEffectiveAccessSchema`,
 * landed with the arm.
 *
 * The members are read from the widget's read points:
 *
 *  - `properties` — optional and empty: the widget reads no key of the bag.
 *    The person is the `sys_user` record the page is bound to, never a key of
 *    the node.
 *  - Neither content channel is read, so both are refused by name, the twin
 *    of the arm's two `retirementTombstone` members.
 *
 * The parity pair is `security-effective-access.zod.ts#SecurityEffectiveAccessSchema`
 * in `__tests__/zod-mirror-parity.test.ts`.
 */
export interface SecurityEffectiveAccessSchema extends BaseSchema {
  type: 'security:effective-access';
  /**
   * The props bag — the widget reads no prop, so the only bag it accepts is
   * `{}`. The person comes from the `sys_user` record the page is bound to.
   */
  properties?: Record<string, never>;
  /**
   * REFUSED BY NAME — `security:effective-access` reads neither content
   * channel: `UserEffectiveAccess` reads only `className`, and
   * `SchemaRenderer` strips both channels out of the props it spreads.
   *
   * @deprecated Not a channel `security:effective-access` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME, for the reason `body` gives.
   *
   * @deprecated Not a channel `security:effective-access` reads — nothing renders it.
   */
  children?: never;
}
