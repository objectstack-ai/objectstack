// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The ledger `predicate` slots' half of the blank-predicate rule. A SEPARATE
// entry from `flow-edge-condition-evaluated-slot-source-required` on purpose:
// that one carries the structural slots (`edges[].condition`,
// `config.condition`), refused by the evaluated-slot rule under
// EVALUATED_EXPRESSION_SOURCE_REQUIRED, where removing a blank condition
// INVERTS the edge. These slots are declared `z.string()`, are refused under
// PREDICATE_SLOT_STRING_REFUSAL, and keep their run with `'false'` or no
// `visibleWhen` — a different prescription, which one entry cannot carry for both.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'flow-predicate-slot-blank-string-refused',
  surface:
    'the two ledger predicate slots on a flow node — config.conditions[].expression on a decision '
    + 'node (a branch predicate) and config.fields[].visibleWhen on a screen node (a field visibility '
    + 'predicate) — authored as a string that is blank after trimming (\'\', \'   \', a tab or a '
    + 'newline), at any depth including an ADR-0031 region body. Reachable wherever a flow is '
    + 'authored or stored: defineStack({ flows }) sources, defineFlow(), an exported stack passed to '
    + 'objectstack validate, and a flow row already sitting in sys_metadata',
  replacement:
    'the predicate the branch or field was meant to test, as non-blank bare CEL text '
    + '(`expression: \'record.amount > 10\'`, `visibleWhen: \'amount > 0\'`); or KEEP what the blank did. '
    + 'On a screen field, drop the `visibleWhen` key: an absent `visibleWhen` shows the field '
    + 'unconditionally, which is what a blank one already did at run time (the resume contract '
    + 'treated it as absent, and the renderer fell back to showing the field). On a decision '
    + 'branch, write `expression: \'false\'`: the evaluator answered the blank `false`, so the branch '
    + 'keeps its label and is still never taken. ⚠️ Not by dropping a decision\'s only branch: with '
    + 'no `conditions` the node routes by its out-edges alone, so the out-edge that branch labelled '
    + 'is no longer held back. On a structural condition removal differs again: dropping a blank '
    + '`condition` turns a never-firing edge into an always-firing one '
    + '(`flow-edge-condition-evaluated-slot-source-required`)',
  reason:
    'Card #17493, ruling A (5651023407). Both slots are declared bare CEL text (`z.string()`) '
    + 'and both admitted a blank string at every door: the expression ledger resolver skipped it '
    + 'as "not authored", and `AutomationEngine.evaluateCondition` answered it `false` — so a '
    + 'decision branch carrying it was never taken, with nothing said at any layer, and a screen '
    + 'field carrying it was shown with its predicate ignored. #15572 had pinned that '
    + 'admission as correct because the two sides agreed. The ruling is that self-consistency '
    + 'between parser and evaluator is not a defence when the author\'s intent is silently '
    + 'dropped — the third instance of one rule, after #17322 (the structural `config.condition`) '
    + 'and #15811 (a blank evaluated `source`). The blank is now refused at `FlowSchema.parse`, '
    + 'at `AutomationEngine.registerFlow` (which parses first) and at `objectstack validate`, all '
    + 'three through `predicateSlotRefusal`, leading with `PREDICATE_SLOT_STRING_REFUSAL`. '
    + '⚠️ No D2 conversion, and the reason is the judgment this entry delegates: the blank is '
    + 'where an author meant to write a rule, and the platform cannot tell a predicate somebody '
    + 'forgot from one they meant to delete. Keeping what ran is mechanical; writing the predicate '
    + 'is what the author intended; only the author knows which. '
    + '⚠️ Where such a blank already sits the whole flow is refused: registered from the metadata '
    + 'registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not '
    + 'armed, while the flows beside it register; a `defineStack({ flows })` source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load. '
    + 'ADR-0087, ADR-0032.',
  acceptanceCriteria:
    'Grep every flow node in `defineStack({ flows })` sources, exported stacks and every flow '
    + 'row in `sys_metadata` — including nodes inside a `loop` / '
    + '`parallel` / `try_catch` region body — for a `decision` node whose '
    + '`config.conditions[i].expression`, or a `screen` node whose `config.fields[i].visibleWhen`, '
    + 'is a string that is empty after trimming. Each refusal names the node and the branch or '
    + 'field, which is the TODO\'s locator: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.config.conditions.I.expression` (or `…config.fields.I.visibleWhen`, or the region '
    + 'path `nodes.N.config.body.nodes.M.config…`), and `objectstack validate` prints the same '
    + 'path; `validateStackExpressions` phrases it as '
    + '`node \'check\' (decision) decision branch expression at config.conditions[0].expression`. '
    + 'For each hit decide, per the `replacement` note, whether to write the predicate or to '
    + 'keep what the blank did. Two proofs. (1) For a stack authored in config files, '
    + '`objectstack validate` is clean. (2) Boot the stack and '
    + 'confirm each flow REGISTERS: no `failed to register flow` warn for it (the three boot '
    + 'paths spell it `[Automation] failed to register flow`, `[Automation] flow re-sync: failed '
    + 'to register flow` and `[Automation] cold-boot flow bind: failed to register flow`) — that '
    + 'warn line is the locator for a row that exists only in `sys_metadata`. A non-blank '
    + 'predicate parses and registers byte-identically to before, and a non-string in these '
    + 'slots keeps its own earlier refusal (at `registerFlow` and `objectstack validate`).',
};
