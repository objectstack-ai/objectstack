/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - `security:effective-access` Zod Validator
 *
 * The arm for `@object-ui/app-shell`'s `security:effective-access` SDUI widget
 * (`console/security/UserEffectiveAccess.tsx`): one person's effective
 * permission sets, each with every origin it reaches them through, for a
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
 * `@objectstack/spec` has no `ComponentPropsMap` row for a `security:` widget,
 * so the members are the keys the widget reads. It reads `className` (from
 * `BaseSchema`) and no prop: the person is the record the page is bound to,
 * never a key of the node. So the only `properties` bag it takes is `{}`, and
 * both content channels are refused by name.
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { retirementTombstone } from './tombstone.zod.js';

/** One refusal string for both content channels of `SecurityEffectiveAccessSchema`. */
const SECURITY_EFFECTIVE_ACCESS_NEITHER_CHANNEL =
  'REFUSED — `security:effective-access` reads NEITHER content channel: its registration hands '
  + 'the node to `UserEffectiveAccess`, which reads only `className`, and `SchemaRenderer` strips '
  + 'both channels out of the props bag it spreads. An authored value would render NOTHING — no '
  + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning '
  + '(objectui#9910) noticed it, because the registration declares no `children` input. What it '
  + 'renders instead: the effective permission sets of the person of the bound `sys_user` record, '
  + 'each with where it comes from.';

/**
 * `security:effective-access` — a person's effective permission sets and their
 * origins on their `sys_user` record page. Pinned by
 * `../__tests__/security-effective-access-arm.test.ts`.
 */
export const SecurityEffectiveAccessSchema = BaseSchema.extend({
  type: z.literal('security:effective-access'),
  properties: z
    .strictObject({})
    .optional()
    .describe(
      'The `security:effective-access` props bag — the widget reads no prop, so the only bag it '
      + 'accepts is `{}`. The person comes from the `sys_user` record the page is bound to.',
    ),
  body: retirementTombstone(SECURITY_EFFECTIVE_ACCESS_NEITHER_CHANNEL),
  children: retirementTombstone(SECURITY_EFFECTIVE_ACCESS_NEITHER_CHANNEL),
});
