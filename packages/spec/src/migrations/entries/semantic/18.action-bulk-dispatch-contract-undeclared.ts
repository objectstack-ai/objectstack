// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'action-bulk-dispatch-contract-undeclared',
  surface: '`action.execution` — the bulk dispatch contract an action’s body is written for',
  replacement:
    "Declare `execution: 'perRecord' | 'aggregate'` on every action a list view wires into the "
    + 'selection bar, DERIVED from the wiring that action already has: a view naming it in '
    + "`bulkActions: ['<name>']` (the bare-string form) dispatches it once per selected row with "
    + "that row's `recordId` ⇒ `execution: 'perRecord'`; a `bulkActionDefs` entry naming it with "
    + "`execution: 'aggregate'` dispatches it once for the whole selection with every id in "
    + "`params._selectedIds` ⇒ `execution: 'aggregate'`. The derivation is exact wherever an "
    + 'action is wired ONE way, because the wiring is what the body has been receiving all along '
    + '— declaring it changes no behaviour, it writes down the behaviour. ⛔ There is no default: '
    + 'an action no view bulk-wires, and an action whose body genuinely serves both contracts '
    + '(it reads `recordId` AND `_selectedIds` and copes with either), stays UNDECLARED rather '
    + 'than being given a value.',
  reason:
    'Not losslessly convertible, because the fact being written down does not live on the item '
    + 'being rewritten. The declaration belongs to the ACTION and the evidence for it belongs to '
    + 'the VIEWS — potentially several, in other files or other packages — so no per-item '
    + 'transform has both halves in hand, and `objectstack migrate meta` rewrites stored metadata '
    + 'by key. The residue is genuinely a judgement: an action wired BOTH ways has no correct '
    + 'value, because one call and N calls have different side effects and the platform will not '
    + 'silently unify them (the #17319 ruling refused exactly that option). Such an action is TWO '
    + 'actions — split the body along the line the two wirings already draw and declare each half '
    + '— or, if the body was deliberately written to serve both, it stays undeclared and the two '
    + 'wirings stand. The census that is this migration’s input was taken 2026-09-13 over '
    + 'objectstack@a9c64779046 (shipped app metadata, test fixtures excluded: 13 distinct '
    + 'bulk-wired actions — 11 unambiguously per-record, 1 unambiguously aggregate, 1 wired both '
    + 'ways) and hotcrm@c716a2ccb3d31574a1a238a590f3e331ddae0200 (3 distinct bulk-wired actions — '
    + '2 per-record, 1 aggregate, 0 wired both ways). So the both-ways residue is real but rare, '
    + 'which is why it is a structured TODO and not a blocking rewrite.',
  acceptanceCriteria:
    '`objectstack validate` (and `os lint` / `os build`) reports no '
    + '`action-dispatch-contract-mismatch` finding on the stack; every action a list view wires '
    + 'into the selection bar either declares the `execution` its wiring implies, or is '
    + 'deliberately left undeclared with the reason recorded beside it; no action is wired both '
    + 'ways while declaring either contract. Prove the derivation rather than assuming it: for '
    + "each action you declared `'aggregate'`, its body reads `params._selectedIds` and does NOT "
    + "depend on `ctx.recordId`; for each you declared `'perRecord'`, the reverse. Run the bulk "
    + 'button once per declared action against a multi-row selection and confirm the number of '
    + 'dispatches matches the declaration (N for per-record, one for aggregate) — a mismatch that '
    + 'used to be silent is what this key exists to surface.',
};
