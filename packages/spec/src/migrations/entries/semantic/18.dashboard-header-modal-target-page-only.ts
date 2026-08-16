// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'dashboard-header-modal-target-page-only',
  surface:
    'dashboard `header.actions[]` entries with `actionType: \'modal\'` — an `actionUrl` naming '
    + 'a defined action, a bare object name, or the `<verb>_<object>` prefix form '
    + '(`create_`/`new_`/`add_`/`edit_`/`update_` + object). The keys themselves are unchanged '
    + 'and still parse; what changed is what the string RESOLVES to',
  replacement:
    'a declared page name (`stack.pages`, by `name`) — a modal target names a PAGE, only. To '
    + 'open an object\'s create/edit form from a dashboard header, use `actionType: \'form\'` '
    + 'with an `<object>.<view>` form-view target (`actionType` accepts the full action-type '
    + 'enum, so that shape reaches this surface too)',
  reason:
    'Maintainer ruling objectstack#6739-A (2026-08-09): a `type: \'modal\'` string target names '
    + 'a PAGE, only — the spec TSDoc, the published docs and `defineStack`\'s cross-reference '
    + 'walk already agreed, and the renderer\'s page-then-object leniency (self-labelled '
    + 'Back-compat) was retired rather than codified. objectui#4764 deleted the object fallback '
    + 'in the shared `useActionModal`; objectui#4782 deleted `DashboardView`\'s own second copy '
    + 'of the prefix convention (which had no page resolution at all), after enumerating both '
    + 'repos\' corpora and finding zero producers of the prefix form. The `os validate` lint '
    + 'rule (`validateDashboardActionRefs`) then still pointed the other way: it accepted the '
    + 'retired shapes — blessing buttons that dispatch to a named refusal at runtime — and '
    + 'ERRORED on a page-named target, the one shape the runtime serves. The rule now resolves '
    + 'a modal target against declared pages, only. The ruling explicitly declined the middle '
    + 'shape (keep the prefix, reject bare object names): `create_opportunity` names the page '
    + '`create_opportunity`, or it names nothing.',
  acceptanceCriteria:
    'Every dashboard `header.actions[]` entry with `actionType: \'modal\'` has an `actionUrl` '
    + 'naming a declared page (`os validate` passes the dashboard-action-refs rule); header '
    + 'buttons meant to open an object\'s form declare `actionType: \'form\'` with an '
    + '`<object>.<view>` target instead. Clicking each converted button opens the intended '
    + 'page or form rather than a refusal dialog.',
};
