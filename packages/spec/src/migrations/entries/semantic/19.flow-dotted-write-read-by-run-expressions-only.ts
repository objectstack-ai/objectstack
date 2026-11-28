// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'flow-dotted-write-read-by-run-expressions-only',
  surface:
    'automation.Flow run by the automation engine: an assignment target (or any other key a node writes) whose head '
    + 'names a value the run holds — a declared variable\'s object or list default (cfg.mode over a declared cfg) or '
    + 'the trigger record (record.x) — read by a text hole ({{ cfg.mode }}) or through $record',
  replacement:
    'Assign the value the run computed to a variable of its own (assignments: { mode_now: { dialect: \'cel\', '
    + 'source: \'cfg.mode\' } }) and read that variable in the text hole or the later step',
  reason:
    'Each run binds its own copy of a declared variable\'s object or list default and of the trigger record '
    + '(record and $record). A dotted write whose head names such a value is read back by the run\'s expressions '
    + '(conditions and CEL values); the value itself keeps what it was, so a text hole and $record read the value, '
    + 'not the write. There is no mechanical rewrite: which reader needs the computed value is the author\'s '
    + 'choice.',
  acceptanceCriteria:
    'Every text hole and $record read that should show a value a run computed reads a variable the run assigned '
    + 'that value to, and a test run of each such flow shows the computed value there.',
};
