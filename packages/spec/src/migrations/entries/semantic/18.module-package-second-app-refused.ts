// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #32586. An accept-set narrowing of the stack aggregate: defineStack holds a
// `type: 'module'` package to at most one app, as it already held a
// `type: 'app'` package (ADR-0019 D3 as amended: a suite may surface several
// apps, one per package). No D2 conversion: which app stays in the package,
// and which module each other app moves to, is the author's call.
export const entry: SemanticMigration = {
  id: 'module-package-second-app-refused',
  surface:
    'stack.apps of a stack whose manifest.type is \'module\' — two or more entries, e.g. '
    + 'manifest: { type: \'module\', ... }, apps: [{ name: \'crm_service\', ... }, { name: \'crm_field_service\', ... }]',
  replacement:
    'Keep one app per package. Leave one app in the module package and move each other app into a '
    + '`type: \'module\'` package of its own, together with the objects it shows (an app names no object of '
    + 'another package where its own package defines objects), and compose the packages into one artifact with '
    + 'composeStacks under manifest: \'preserve\'. Or fold the apps into one app whose navigation groups hold '
    + 'each former app\'s entries. A module package with one app or none, and an app package with one app, are '
    + 'unchanged.',
  reason:
    'ADR-0019 (app-as-consumer-unit) D3 as amended lets a suite (an app package plus the module packages it '
    + 'composes) surface several apps, provided each app is defined by a different package and no package defines '
    + 'more than one. defineStack enforced that for an app package only, so a module package holding two apps '
    + 'built clean and broke the three things the rule exists for: the Console addresses an app by its package '
    + 'id and resolves the id to the first app that carries it, so every other app of that package was reachable '
    + 'only by name; read by its package id, such a package answers as absent; and disabling the module removes '
    + 'all of its apps together, where each function was meant to be switched off on its own. defineStack now '
    + 'refuses the stack with STACK_SINGLE_APP_VIOLATION (422), naming the package, every app found and the '
    + 'remedy. Not convertible: which app stays, and which package each other app and its objects move to, is a '
    + 'fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build load every package without a STACK_SINGLE_APP_VIOLATION finding. Then boot the '
    + 'artifact and confirm each app opens from the Console under its own package id, and that disabling each '
    + 'module removes that module\'s app and leaves the others.',
};
