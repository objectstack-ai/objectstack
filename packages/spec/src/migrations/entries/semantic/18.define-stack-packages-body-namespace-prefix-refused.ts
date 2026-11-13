// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of strict defineStack on a stack that carries
// packages[]: its namespace prefixes are judged the way the load path
// registers its objects, each package body's objects against that body's own
// namespace (ADR-0028 prefix rule, ADR-0130 D4). No D2 conversion: which
// package an object belongs to, and so its name, is the author's call.
export const entry: SemanticMigration = {
  id: 'define-stack-packages-body-namespace-prefix-refused',
  surface:
    'defineStack(stack) (strict, the default) on a stack that carries packages[] whose package body declares '
    + 'a namespace and an object that namespace does not prefix, e.g. a hand-assembled packages[] body, or one '
    + 'built with defineStack(…, { strict: false }), whose object carries another package\'s prefix',
  replacement:
    'Rename the object to its own package\'s prefix (NAMESPACE_shortName; the finding names the package body '
    + 'and the exact rename), or move it into the package body whose namespace it carries. A top-level object a '
    + 'package body declares (an additive artifact\'s merged copy, such as the output of '
    + 'resolveArtifactCollections from @objectstack/runtime) is judged with that body only and is now accepted '
    + 'when the packages declare different namespaces. A stack without packages[] is judged as before.',
  reason:
    'The load path registers each packages[] body\'s objects under that body\'s own package and namespace, and '
    + 'a top-level object that no body declares under the stack\'s manifest id (the residual rule, '
    + 'unclaimedTopLevel in @objectstack/metadata). Strict defineStack judged every top-level object against the '
    + 'manifest\'s one namespace instead and never judged a body\'s objects, so it refused the reader round trip '
    + 'of a suite whose packages declare different namespaces, and it accepted a body object its own namespace '
    + 'does not prefix. defineStack now judges each body against its own namespace and the residual against the '
    + 'manifest\'s, and refuses the second shape with STACK_NAMESPACE_PREFIX_INVALID (422). Not convertible: an '
    + 'object\'s name is its table name and its API name, which only the author can rename.',
  acceptanceCriteria:
    'os validate and os build, and every config or test helper that calls defineStack on a packages[] stack, run '
    + 'without a STACK_NAMESPACE_PREFIX_INVALID finding. Then boot the artifact and confirm each object answers on '
    + '/api/v1/data under its own package.',
};
