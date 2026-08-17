// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'stack-top-level-unknown-keys-refused',
  surface: 'top-level stack definition keys (`ObjectStackDefinitionSchema`) — undeclared keys',
  replacement: 'the declared top-level surface. A key the schema does not declare is refused at '
    + 'parse with a prescriptive message naming the key, suggesting the closest declared key on '
    + 'a near miss (`objectz` → `objects`, `flow` → `flows`), and carrying a curated '
    + 'prescription for the known retirements (`approvals`/`approvalProcesses` → Approval-node '
    + 'flows per ADR-0019; `workflows` → `state_machine` validation rules per ADR-0020; '
    + '`portals` removed in #3464; `storage` is deployment config, OS_STORAGE_*; `onDisable` '
    + 'was never invoked, #4212). `onEnable` is now DECLARED rather than silently stripped — '
    + 'the runtime has always executed it off the authored bundle (#4095)',
  reason:
    'The outermost authoring door was the last strip-mode surface of the #4001 campaign: an '
    + 'unknown top-level stack key parsed green and its value was silently dropped. Measured on '
    + '17.0.0 GA (#8687): three injected bogus top-level keys added ZERO warnings to '
    + '`os validate` and exited 0 — even `--strict` could not catch them, because the '
    + '`defineStack:` naming diagnostic printed at load, outside the warning tally. The failure '
    + 'population is a typo or stale key (`flow` for `flows`, `approvalProcesses` after the 7.4 '
    + 'removal) shipping an artifact with a whole metadata family absent at runtime, debugged '
    + 'from the far end — the root of hotcrm#1141. Unknown top-level keys are now refused at '
    + 'parse time, which fails `validate` (and every other path through this one parse) '
    + 'outright; the near-miss guidance that used to arrive as a load-time warning now rides '
    + 'the refusal itself.',
  acceptanceCriteria:
    'A stack authoring only declared top-level keys parses byte-identically to before, '
    + '`onEnable`/`functions` included. Any undeclared top-level key fails the parse with '
    + '`unrecognized_keys` naming the key; a one-edit near miss carries a rename suggestion; '
    + 'the curated retirements answer with their prescriptions. `os validate` exits non-zero '
    + 'on a stack carrying any undeclared top-level key, with or without `--strict`.',
};
