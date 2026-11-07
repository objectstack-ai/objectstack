/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - `mcp:authorized-assistants` Zod Validator
 *
 * The arm for `@object-ui/app-shell`'s `mcp:authorized-assistants` SDUI widget
 * (`console/connect/ManagedPersonAssistants.tsx`): an administrator's view of
 * the AI assistants one person authorized, with a Revoke on each, for a
 * `sys_user` record page.
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
 * ## Declared from the widget's read points
 *
 * `@objectstack/spec` has no `ComponentPropsMap` row for an `mcp:` widget, so
 * the members are the keys the widget reads. It reads `className` (from
 * `BaseSchema`) and no prop: the person is the record the page is bound to,
 * never a key of the node. So the only `properties` bag it takes is `{}`, and
 * both content channels are refused by name.
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { retirementTombstone } from './tombstone.zod.js';

/** One refusal string for both content channels of `McpAuthorizedAssistantsSchema`. */
const MCP_AUTHORIZED_ASSISTANTS_NEITHER_CHANNEL =
  'REFUSED — `mcp:authorized-assistants` reads NEITHER content channel: its registration hands '
  + 'the node to `ManagedPersonAssistants`, which reads only `className`, and `SchemaRenderer` strips '
  + 'both channels out of the props bag it spreads. An authored value would render NOTHING — no '
  + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning '
  + '(objectui#9910) noticed it, because the registration declares no `children` input. What it '
  + 'renders instead: the AI assistants the person of the bound `sys_user` record authorized, each '
  + 'with a Revoke.';

/**
 * `mcp:authorized-assistants` — a person's authorized AI assistants on their
 * `sys_user` record page. Pinned by
 * `../__tests__/mcp-authorized-assistants-arm.test.ts`.
 */
export const McpAuthorizedAssistantsSchema = BaseSchema.extend({
  type: z.literal('mcp:authorized-assistants'),
  properties: z
    .strictObject({})
    .optional()
    .describe(
      'The `mcp:authorized-assistants` props bag — the widget reads no prop, so the only bag it '
      + 'accepts is `{}`. The person comes from the `sys_user` record the page is bound to.',
    ),
  body: retirementTombstone(MCP_AUTHORIZED_ASSISTANTS_NEITHER_CHANNEL),
  children: retirementTombstone(MCP_AUTHORIZED_ASSISTANTS_NEITHER_CHANNEL),
});
