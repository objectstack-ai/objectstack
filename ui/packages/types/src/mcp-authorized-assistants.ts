/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - `mcp:authorized-assistants` Schema
 *
 * The TypeScript twin of `zod/mcp-authorized-assistants.zod.ts`.
 *
 * @module mcp-authorized-assistants
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';

/**
 * `mcp:authorized-assistants` — an administrator's view of the AI assistants
 * one person authorized, with a Revoke on each, for a `sys_user` record page:
 * the SDUI widget `@object-ui/app-shell` registers. The TypeScript twin of
 * `zod/mcp-authorized-assistants.zod.ts`'s `McpAuthorizedAssistantsSchema`,
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
 * The parity pair is `mcp-authorized-assistants.zod.ts#McpAuthorizedAssistantsSchema`
 * in `__tests__/zod-mirror-parity.test.ts`.
 */
export interface McpAuthorizedAssistantsSchema extends BaseSchema {
  type: 'mcp:authorized-assistants';
  /**
   * The props bag — the widget reads no prop, so the only bag it accepts is
   * `{}`. The person comes from the `sys_user` record the page is bound to.
   */
  properties?: Record<string, never>;
  /**
   * REFUSED BY NAME — `mcp:authorized-assistants` reads neither content
   * channel: `ManagedPersonAssistants` reads only `className`, and
   * `SchemaRenderer` strips both channels out of the props it spreads.
   *
   * @deprecated Not a channel `mcp:authorized-assistants` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME, for the reason `body` gives.
   *
   * @deprecated Not a channel `mcp:authorized-assistants` reads — nothing renders it.
   */
  children?: never;
}
