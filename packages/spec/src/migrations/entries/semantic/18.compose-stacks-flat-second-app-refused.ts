// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #32810. An accept-set narrowing of composeStacks (and of defineStack for a
// packages[] body): what a composition puts under one package id is held to
// at most one app, as each authored package already was (ADR-0019 D3 as
// amended: a suite may surface several apps, one per package). No D2
// conversion: whether the inputs compose as separate packages, and which app
// stays in which package, is the author's call.
export const entry: SemanticMigration = {
  id: 'compose-stacks-flat-second-app-refused',
  surface:
    'composeStacks(stacks) under a flat manifest option (manifest: \'last\', the default, \'first\' or an index) '
    + 'whose selected manifest is an \'app\' or \'module\' package while the inputs bring two or more apps, e.g. '
    + 'composeStacks([serviceModule, appPackage]) where each defineStack carries one app; a composition under any '
    + 'option whose result carries packages[] and an app that no package body declares (an input with no '
    + 'manifest, or a nested artifact with an app of its own) while the package of the artifact\'s manifest id '
    + 'already defines one; and a packages[] body of type \'app\' or \'module\' that defines two or more apps, '
    + 'handed to defineStack or carried into a composition',
  replacement:
    'Compose the packages of a suite with composeStacks(stacks, { manifest: \'preserve\' }): each input keeps '
    + 'its own package id and its own app. Under \'preserve\' the artifact\'s manifest is the last input\'s, so a '
    + 'composition that selected another input\'s manifest with \'first\' or an index reorders its inputs to keep '
    + 'the same artifact identity. An input that defines an app needs a manifest of its own (a \'module\' package) '
    + 'for preserve to assemble it into its own package body, and a nested artifact declares its apps inside one '
    + 'of its bodies. Code that '
    + 'composed flat only to read every collection at the top level (a test view of the whole suite, say) '
    + 'composes under \'preserve\' and reads each packages[] body for its collections instead. A package body '
    + 'that itself defines two apps keeps one and moves each other app into a \'module\' package of its own, or '
    + 'folds them into one app whose navigation groups hold each former app\'s entries. A flat composition '
    + 'whose inputs bring one app or none, a single-input composition, and every other package type are '
    + 'unchanged.',
  reason:
    'ADR-0019 (app-as-consumer-unit) D3 as amended lets a suite surface several apps, provided each app is '
    + 'defined by a different package and no package defines more than one. defineStack enforced that per '
    + 'authored package, but a flat composeStacks keeps ONE manifest and concatenates every input\'s apps under '
    + 'it, so an app package and a module package with one app each, composed without manifest: \'preserve\', '
    + 'became one package id with two apps, and a hand-assembled packages[] body with two apps was judged by '
    + 'no door. That is the shape the rule removes: the Console addresses an app by its package id and opens the '
    + 'first app that carries it, so every other app of the package was reachable only by name; read by its '
    + 'package id the package answers as absent; and the apps can no longer be disabled one module at a time. '
    + 'composeStacks now refuses such a composition with STACK_SINGLE_APP_VIOLATION (422), naming the package, '
    + 'each app with the input it came from, and the remedy, and defineStack and composeStacks judge every '
    + 'packages[] body by the same rule, and the apps no package body declares, which the load path registers '
    + 'under the artifact\'s manifest id, together with that package\'s own. Not convertible: whether the inputs are one package or several, and '
    + 'which app stays where, is a fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build, and every config or test helper that calls composeStacks, run without a '
    + 'STACK_SINGLE_APP_VIOLATION finding. Then boot the artifact and confirm each app opens from the Console '
    + 'under its own package id.',
};
