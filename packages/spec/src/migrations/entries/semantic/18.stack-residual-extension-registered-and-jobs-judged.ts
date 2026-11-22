// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of composition, beside a runtime fix. A composed
// artifact that carries packages[] has a residual (top-level entries no package
// body claims, registered under manifest.id); its objectExtensions are now
// registered by the engine, where no door registered one, and the composition
// door judges what that registration makes one package. That holds under every
// manifest strategy: 'preserve' with an input that has no manifest, and
// 'first' / 'last' / an index with an input that is itself a multi-package
// artifact. No D2 conversion: which of two extensions or two jobs to keep is the
// author's call.
//
// Known gap, left to the job binder and not judged at composition: a residual
// job whose name a package body's job also carries (with other content) is read
// as that body's copy and composes, and the boot schedules neither of the two
// enabled jobs. A follow-up card carries the question.
export const entry: SemanticMigration = {
  id: 'stack-residual-extension-registered-and-jobs-judged',
  surface:
    'composeStacks(…) whose result carries packages[] beside top-level entries no package body claims (the residual): '
    + "under manifest 'preserve' the entries of inputs that carry no manifest, and under 'first', 'last' or an index "
    + 'also every top-level entry an input that is itself a multi-package artifact carries of its own. Refused there '
    + 'now: two residual jobs of one name; a residual objectExtensions entry for an object that the body carrying '
    + 'manifest.id also extends with other fields; two residual objectExtensions entries for one object, also when a '
    + 'package body extends that object too (before this release they counted as that body\'s copies and composed).',
  replacement:
    'Declare each job name once in the artifact. Put a top-level extension in the package that owns it, or merge it '
    + "into that package's own objectExtensions entry for the same object, and merge two top-level extensions of one "
    + "object into one: the residual registers under the artifact's manifest id (under manifest preserve the last "
    + 'input with a manifest, under first / last / an index the manifest that strategy keeps), and one extension of an '
    + 'object registers per package.',
  reason:
    'A residual objectExtensions entry was registered by no door, so its fields were missing on the target and '
    + 'nothing was said; it now registers under manifest.id. A residual entry is told from a body\'s flattened copy by '
    + 'value, not by target, so two residual entries for one object are one package\'s pair whatever other packages '
    + 'extend, and only the last one\'s fields register. Under manifest preserve that id is also a package body, so a '
    + 'residual entry for an object that body extends too keeps only the last fields. Composition refuses each pair '
    + '(STACK_CROSS_REFERENCE_INVALID) with the one-package wording, a body entry first. Two residual jobs of one name '
    + 'composed and the boot then scheduled neither (NOT SCHEDULED at error); composition refuses them now, and the '
    + 'jobs wording at every door says that when both are enabled neither runs. The same holds under first, last or '
    + 'an index once an input carries packages[]. An artifact built before this keeps loading: a residual extension '
    + 'pair is registered (the last one served) with an error line naming both. One case is NOT refused: a residual '
    + 'job sharing its name with a package body\'s job composes, and the binder schedules neither (a known gap).',
  acceptanceCriteria:
    'objectstack validate and objectstack build load the composed stack without a STACK_CROSS_REFERENCE_INVALID '
    + 'finding "Job \'NAME\' is declared twice in jobs" or "Object extension of \'OBJECT\' is declared twice in '
    + 'objectExtensions". The boot log carries no error saying a stack registers several extensions of one object '
    + 'under one id, and every field of the residual extension is served on its target object.',
};
