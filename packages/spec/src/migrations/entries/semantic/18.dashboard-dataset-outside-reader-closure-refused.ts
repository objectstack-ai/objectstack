// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of the authoring doors (#32967, ruling option two on
// #32929): a package's dashboard widget resolves its `dataset` the way the
// dataset doors do since 18.4.0, through the reading package's declared
// dependency closure (ADR-0150 D3 (c)). No D2 conversion: which package a
// dashboard or a dataset belongs to is the author's call.
export const entry: SemanticMigration = {
  id: 'dashboard-dataset-outside-reader-closure-refused',
  surface:
    'A dashboard widget\'s dataset in one package of a multi-package artifact (composeStacks(stacks, { manifest: '
    + '\'preserve\' }), packages[]) that names a dataset only another package of the artifact holds, when that package '
    + 'is outside the reading package\'s declared dependency closure (manifest.dependencies, transitively, plus sys), '
    + 'or two packages inside that closure hold the name; e.g. an app package\'s dashboard on a dataset its own '
    + 'module holds, the module depending on the app',
  replacement:
    'Where the holding package does not depend on the reading package, declare it in the reading package\'s '
    + 'dependencies (ADR-0141). Where it already does (a module of the app), declaring it back is a dependency cycle '
    + 'the kernel refuses at boot: move the dashboard into the holding package, or move the dataset into the reading '
    + 'package. Where two packages of the closure hold the name, keep one dataset by that name, or depend on only '
    + 'one of them. A reading package that declares a dependency the artifact does not carry is reported '
    + '(widget-dataset-unknown, warning), not refused, since that package may hold the name once installed.',
  reason:
    'Since 18.4.0 a package\'s dashboard resolves a dataset name in its own package, then in the one holder of its '
    + 'declared dependency closure, and the dataset doors refuse any other read 409 RESOURCE_CONFLICT (ADR-0150 D3 '
    + '(c): the release artifact is the co-ownership boundary, not a resolution scope). The per-package authoring '
    + 'pass of os validate, os build and os lint resolved the name against every package of the artifact (since 18.2.0), '
    + 'so it passed a dashboard the installed runtime refuses to serve. It now asks the runtime\'s question and '
    + 'refuses with widget-dataset-unknown (error). Not convertible: which package a dashboard or a dataset belongs '
    + 'to is a fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build run without a widget-dataset-unknown error. Then boot the artifact, open each '
    + 'package\'s dashboard from the Console, and confirm every widget renders its rows rather than a 409 '
    + 'RESOURCE_CONFLICT.',
};
