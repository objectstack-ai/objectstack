// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of composition, beside a runtime fix. A
// composeStacks(…, { manifest: 'preserve' }) artifact's residual (top-level
// entries no package body claims, registered under manifest.id) now has its
// objectExtensions registered by the engine, where no door registered one; the
// composition door judges what that registration makes one package. No D2
// conversion: which of two extensions or two jobs to keep is the author's call.
export const entry: SemanticMigration = {
  id: 'stack-residual-extension-registered-and-jobs-judged',
  surface:
    "composeStacks(…, { manifest: 'preserve' }) with inputs that carry no manifest: two of them declaring one job "
    + 'name, or one carrying an objectExtensions entry for an object that the last input with a manifest also '
    + 'extends with other fields.',
  replacement:
    'Declare each job name once in the artifact. Put a top-level extension in the package that owns it, or merge it '
    + "into that package's own objectExtensions entry for the same object: the residual registers under the "
    + "artifact's manifest id, which under manifest preserve is the last input with a manifest, and one extension "
    + 'of an object registers per package.',
  reason:
    'A residual objectExtensions entry was registered by no door, so its fields were missing on the target and '
    + 'nothing was said; it now registers under manifest.id. That id is also a package body under manifest preserve, '
    + 'so a residual entry for an object that body extends too keeps only the last fields, and composition refuses '
    + 'the pair (STACK_CROSS_REFERENCE_INVALID) with the one-package wording, the body entry first. Two residual jobs '
    + 'of one name composed and the boot then scheduled neither (NOT SCHEDULED at error); composition refuses them '
    + 'now, and the jobs wording at every door says that none of them runs. An artifact built before this keeps '
    + 'loading: a residual extension pair is registered (the last one served) with an error line naming both.',
  acceptanceCriteria:
    'objectstack validate and objectstack build load the composed stack without a STACK_CROSS_REFERENCE_INVALID '
    + 'finding "Job \'NAME\' is declared twice in jobs" or "Object extension of \'OBJECT\' is declared twice in '
    + 'objectExtensions". The boot log carries no error saying a stack registers several extensions of one object '
    + 'under one id, and every field of the residual extension is served on its target object.',
};
