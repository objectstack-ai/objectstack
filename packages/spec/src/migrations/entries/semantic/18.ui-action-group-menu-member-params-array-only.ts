// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21855 — the rows' value ratchet for one member: an `action:group` /
// `action:menu` member's `params` takes the array form (`ActionParam[]`) only,
// unless the member's `type` is `api`, whose object `params` keeps the
// inline-action payload window (#5777) until 18. The maintainer's ruling A on
// objectui#10289 keeps `params` to one shape and declares no other value-bag
// key, and #21704's fork 5 A refused the member's `properties.params`, so a
// member has no static-values spelling and the container drops a non-array
// `params` on any other type at run time. D3 only: page-component `properties`
// is not parsed on the metadata save or load path, so a stored page is never
// refused; there is no D2 conversion, because the only home for static values
// is a different node (an `action:button`), which no rewrite can build in the
// author's place; and the census found no writer to respell.
export const entry: SemanticMigration = {
  id: 'ui-action-group-menu-member-params-array-only',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span.
  surface: 'page action:group and action:menu components — a member of properties.actions whose type is not api, '
    + 'and whose params is not an array',
  replacement: 'Write `params` as the list of inputs to collect from the user, an `ActionParam[]` array. To run an '
    + 'action with static parameter values, author it as its own `action:button` node, whose `params` object carries '
    + 'them; for a `type: \'api\'` member\'s request body write `bodyExtra`. A member that needs neither drops the key.',
  reason: 'An `action:group` or `action:menu` runs each member itself and forwards an array `params` as the input '
    + 'list. It forwards any other `params` value only for a `type: \'api\'` member, as its request payload; for '
    + 'every other `type`, an absent one included, it drops the value, with a development-build warning only. The '
    + 'member declared `params` as any value, so an object `params` on such a member passed the component-props '
    + 'gate and then had no effect: no error and no static values. `params` carries one shape, the input list, and '
    + 'no second value-bag key is declared; a member\'s `properties.params` is already refused, so static parameter '
    + 'values are not part of the inline action vocabulary at all, and the action that needs them is its own '
    + '`action:button` node. The member now refuses a non-array `params` on a non-`api` type at the gate, at '
    + '`actions.N.params`, with that prescription. The `api` member\'s object `params` is unchanged. It is read '
    + 'where every page component\'s props are: the component-props gate reports the refusal as an advisory '
    + '`component-props-invalid` finding on `objectstack validate`, `objectstack build` and `objectstack lint`, and a '
    + 'stored page still saves and loads, because a page component\'s `properties` is not parsed on the metadata '
    + 'save or load path. No conversion is registered: the static values belong on a different node, and the '
    + 'census found no writer. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `action:group` and `action:menu` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` finding at `properties.actions.N.params`. Each member whose action needs static '
    + 'parameter values is now its own `action:button` node, and pressing it hands the handler those values. '
    + 'Census at the time of the change: no `action:group` / `action:menu` member authors a non-array `params` on a '
    + 'non-`api` type in this repository, in objectui (at the pinned commit and on its main branch) or in the hotcrm '
    + 'application, outside objectui\'s own tests asserting that the container drops it; the cloud repository was not '
    + 'reachable.',
};
