// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of strict defineStack on a stack that carries
// packages[]: its top level is judged the way the load path registers it, so
// a top-level app no body declares counts against the manifest id beside that
// id's own body's app (ADR-0019 D3 as amended). No D2 conversion: which
// package an app belongs to is the author's call.
export const entry: SemanticMigration = {
  id: 'define-stack-packages-residual-second-app-refused',
  surface:
    'defineStack(stack) (strict, the default) on a stack that carries packages[] and a manifest of type '
    + '\'app\' or \'module\', whose top level holds an app that no package body declares while the package body '
    + 'with the manifest\'s id already defines one, or two or more such apps, e.g. a composeStacks(stacks, '
    + '{ manifest: \'preserve\' }) result handed back to defineStack with an extra app added at its top level',
  replacement:
    'Declare the app inside the package body it belongs to, or give it a \'module\' package of its own and '
    + 'compose with composeStacks(stacks, { manifest: \'preserve\' }), which registers each package body under its '
    + 'own id. A top-level app that a package body declares (an additive artifact\'s merged copy, such as the '
    + 'output of resolveArtifactCollections from @objectstack/runtime) counts against that body only and is now '
    + 'accepted. A stack without packages[] is judged as before.',
  reason:
    'The load path registers each packages[] body under its own id, and a top-level app that no body declares '
    + 'under the stack\'s manifest id (the residual rule, unclaimedTopLevel in @objectstack/metadata). Strict '
    + 'defineStack counted every top-level app against the manifest instead, so it accepted a hand-built stack '
    + 'whose undeclared app the boot then registered as a second app of one app or module package, the shape '
    + 'ADR-0019 (app-as-consumer-unit) D3 as amended removes, and it refused an additive artifact whose top level '
    + 'only repeats apps its bodies declare. defineStack now reads a packages[] stack through the judge '
    + 'composeStacks uses for its result and refuses the first shape with STACK_SINGLE_APP_VIOLATION (422). Not '
    + 'convertible: which package an app belongs to is a fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build, and every config or test helper that calls defineStack on a packages[] stack, run '
    + 'without a STACK_SINGLE_APP_VIOLATION finding. Then boot the artifact and confirm each app opens from the '
    + 'Console under its own package id.',
};
