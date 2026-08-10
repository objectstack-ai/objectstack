// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'action-descriptor-resume-authority-default-flip',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
  surface:
    'automation.ActionDescriptor.resumeAuthority — an OMITTED value on a pausing '
    + 'node descriptor (supportsPause: true, or any executor whose execute() returns '
    + 'suspend: true)',
  replacement:
    "an explicit resumeAuthority: 'any' on the descriptor, for a pausing node whose "
    + 'pauses really are meant to be continued through the generic resume route '
    + '(POST /automation/:name/runs/:runId/resume) — a screen-style collected-input '
    + "pause, or a signal wait an external producer resumes. Declare 'service' instead "
    + 'if continuing is the tail of a decision your own service must authorize and '
    + 'record first. Either value is a one-line addition; only the silence changed '
    + 'meaning',
  reason:
    'A SECURE-DEFAULT FLIP with no metadata shape to rewrite — the same category as '
    + "protocol 12's `rest-requireauth-default-flip`, and it is registered here for the "
    + 'same reason: whether a given pause is genuinely open to the generic route is a '
    + 'trust judgment no transform can make. The #3801 resume gate keys on the SUSPENDED '
    + "NODE, and `ActionDescriptor.resumeAuthority` used to default to `'any'`, so a "
    + 'pausing node type shipped raw-resumable unless its author remembered the field. '
    + "It now resolves to `'service'` when absent: an unclaimed pause is refused on the "
    + 'generic route with `PERMISSION_DENIED` / 403 until its descriptor states who may '
    + 'continue it. #3823 is the incident that decided the direction — ADR-0044 pointed '
    + "an approval's revise edge at a generic `wait`, `wait` is legitimately `'any'`, and "
    + 'the pause standing in a service-owned position inherited a fail-open value nobody '
    + 'chose; the demonstrated cost was an unaudited resubmit plus a destroyed remote '
    + 'run. The two possible mistakes are asymmetric, which is the whole argument: '
    + "guessing `'any'` walks past a decision nothing recorded and is silent, while "
    + "guessing `'service'` returns a refusal naming the missing field. ⚠️ The surface "
    + 'is a DESCRIPTOR FIELD set in plugin CODE, never stack metadata, so there is no '
    + 'source for a D2 conversion to rewrite and deliberately no schema tombstone — the '
    + 'disposition `data-driver-find-stream-retired` (#4484), `storage-service-list-retired` '
    + '(#5540) and `actor-user-roles-to-positions` (#6011) already carry. It differs from '
    + 'those in one way a reader should not have to infer: nothing is REMOVED, so tsc '
    + 'reports nothing at all — the field was already optional after step one and an '
    + 'omission still compiles. The enforced channels are all run-time: a registration '
    + 'warning naming the node type (once per type per engine), the refusal message on '
    + 'the resume itself, and `check:resume-authority-declared` for executors living in '
    + 'this repo. For a third-party plugin the generated upgrade guide is the only '
    + 'channel that arrives BEFORE a user hits a run that will not continue. In-tree the '
    + 'flip moves nothing: all six shipped pausing types (screen, wait, subflow, map, '
    + 'approval, approval_revise) declare their authority explicitly. ADR-0044 amendment '
    + '(2026-07-28) and its 2026-08-08 landing section, ADR-0019 #3801 addendum, #5561.',
  acceptanceCriteria:
    'Every action descriptor your plugin registers for a node type that can suspend '
    + 'declares `resumeAuthority`. Booting the stack logs no `declares supportsPause but '
    + 'never declares resumeAuthority` warning naming one of your types, and a run parked '
    + 'on each of your pausing nodes can still be continued the way you intend: a resume '
    + "through the generic route succeeds for the ones you declared `'any'`, and answers "
    + "403 (`PERMISSION_DENIED`) for the ones you declared `'service'`, which continue "
    + 'through your own service API instead. ⚠️ `supportsPause` is no longer the '
    + 'declaration nothing enforced (#5703, closed by #6667): an executor whose '
    + '`execute()` returns `suspend: true` while leaving `supportsPause` false is still '
    + 'warned about by neither warning channel, but '
    + '`AutomationEngine.refuseUndeclaredSuspension` now refuses that suspension at the '
    + 'one seam every suspension passes through — a guard-class failure no `fault` edge '
    + 'routes — so it needs no hand-check. The residue that does: an executor registering '
    + 'NO descriptor declares nothing for either warning or the refusal to read, so its '
    + 'pauses are still created and refused only later, on the resume route (#5561).',
};
