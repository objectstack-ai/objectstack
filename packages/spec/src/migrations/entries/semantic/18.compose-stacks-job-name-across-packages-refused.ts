// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of composition. The boot's job binder schedules every
// job of an artifact by its bare name, whichever package declares it, and
// refuses a name two enabled jobs share: none of them is scheduled. The
// install-local door refuses such a package by the same judge. Composition now
// refuses it too, reading the artifact the way the binder does (enabled jobs
// only, by name, the residual by count beyond the package bodies' flattened
// copies), so the composition, the install door and the binder agree. No D2
// conversion: which of two jobs to keep, or to rename, is the author's call.
export const entry: SemanticMigration = {
  id: 'compose-stacks-job-name-across-packages-refused',
  surface:
    'composeStacks(…) whose result carries packages[]: one job name enabled in two package bodies, or in a package '
    + "body and the residual (a top-level job no body declares: under manifest 'preserve' an input with no manifest, "
    + "under 'first', 'last' or an index any top-level job beside an input that is itself a multi-package artifact). "
    + 'Before this release the pair composed: two bodies were never read against each other, and a residual job '
    + "sharing a body job's name was read as that body's copy.",
  replacement:
    'Give each job its own name across the composed artifact, or disable all but one of the jobs that share a name '
    + '(enabled: false). A disabled job is scheduled by nothing, so a disabled twin still composes.',
  reason:
    'The job binder keys every job of an artifact by its bare name and refuses a name two enabled jobs share, so the '
    + 'boot scheduled none of them (NOT SCHEDULED at error) and every scheduled run of that name was silently lost; '
    + 'the install-local door already refused such a package. Composition now refuses the pair '
    + '(STACK_CROSS_REFERENCE_INVALID) naming every enabled job of the name and where it sits, a residual job marked '
    + 'as the top level outside every package body. A body job\'s own flattened copy is not a second job: the '
    + 'residual is counted beyond the copies, never by content. An artifact built before this keeps loading, and the '
    + 'binder still refuses the name at boot.',
  acceptanceCriteria:
    'objectstack validate and objectstack build load the composed stack without a STACK_CROSS_REFERENCE_INVALID '
    + 'finding "Job \'NAME\' is declared enabled twice across the packages of one composed artifact", and the boot '
    + 'log carries no NOT SCHEDULED error for a job name.',
};
