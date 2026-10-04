// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The absent half of the decision-branch predicate rule. A SEPARATE entry from
// `flow-predicate-slot-blank-string-refused` on purpose: that one keeps the
// run a blank predicate made (it evaluated `false`, so `'false'` runs the same
// route), while an absent predicate made no run to keep — the executor refused
// it at the branch — so the two carry different prescriptions, and only the
// decision branch is in this one (an absent screen `visibleWhen` stays legal).
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'flow-decision-branch-expression-absent-refused',
  surface:
    'a decision node branch — an element of config.conditions[] — written without its expression '
    + 'key, or with expression: null, at any depth including an ADR-0031 region body. That includes '
    + 'a branch whose predicate sits under another key (condition is the edge spelling). Reachable '
    + 'wherever a flow is authored or stored: defineStack({ flows }) sources, defineFlow(), an '
    + 'exported stack passed to objectstack validate, a flow saved from the Studio flow designer '
    + 'with a branch row whose expression cell is empty, and a flow row already sitting in '
    + 'sys_metadata',
  replacement:
    'the predicate the branch was meant to test, as non-blank bare CEL text under `expression` '
    + '(`{ label: \'high\', expression: \'record.amount > 10000\' }`); a predicate written under '
    + '`condition` moves to `expression`. To keep the branch and its label but never take it, '
    + 'write `expression: \'false\'` — that is a CHANGE of behaviour, not a preserved one: a run '
    + 'that reached the branch used to fail there (`condition evaluation error`), and now routes on '
    + 'to the next branch or the declared fallback. ⚠️ Not by dropping a decision\'s only branch: '
    + 'with no `conditions` the node routes by its out-edges alone, so the out-edge that branch '
    + 'labelled is no longer held back',
  reason:
    '`DecisionConditionSchema` declares a branch `{ label, expression }` with '
    + '`expression` a required `z.string()`, but nothing parses a decision node\'s open config '
    + 'against it, and the expression-ledger resolver skipped an absent value as "not authored" — '
    + 'so a branch with no predicate passed `FlowSchema.parse`, `AutomationEngine.registerFlow` and '
    + '`objectstack validate`, and the decision executor then handed `evaluateCondition` an envelope '
    + 'with no `source`, which it refuses: the build accepted what the run refused. The ledger now '
    + 'marks the slot `required` (reconciled against that schema\'s own `required` list), the '
    + 'resolver emits the absent value there, and all three doors refuse it through '
    + '`predicateSlotRefusal`, leading with `PREDICATE_SLOT_STRING_REFUSAL` — the walk, function '
    + 'and sentence that already refuse the blank string. '
    + '⚠️ No D2 conversion: the platform cannot know the rule the author left out, and `\'false\'` '
    + 'would change what the flow does rather than keep it. '
    + '⚠️ Where such a branch already sits the whole flow is refused: registered from the metadata '
    + 'registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not '
    + 'armed, while the flows beside it register; a `defineStack({ flows })` source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load. '
    + 'ADR-0087, ADR-0032.',
  acceptanceCriteria:
    'Grep every flow node in `defineStack({ flows })` sources, exported stacks and every flow '
    + 'row in `sys_metadata` — including nodes inside a `loop` / `parallel` / `try_catch` region '
    + 'body — for a `decision` node whose `config.conditions[i]` has no `expression` key, or '
    + '`expression: null`. Each refusal names the node and the branch: `FlowSchema.parse` anchors '
    + 'a `custom` issue at `nodes.N.config.conditions.I.expression` (or the region path '
    + '`nodes.N.config.body.nodes.M.config…`), and `objectstack validate` prints the same path; '
    + '`validateStackExpressions` phrases it as '
    + '`node \'check\' (decision) decision branch expression at config.conditions[0].expression`. '
    + 'For each hit write the predicate the branch was meant to test, or `expression: \'false\'` '
    + 'where the branch should keep its label and never be taken. Two proofs. (1) For a stack '
    + 'authored in config files, `objectstack validate` is clean. (2) Boot the stack and confirm '
    + 'each flow REGISTERS: no `failed to register flow` warn for it (the three boot paths spell '
    + 'it `[Automation] failed to register flow`, `[Automation] flow re-sync: failed to register '
    + 'flow` and `[Automation] cold-boot flow bind: failed to register flow`) — that warn line is '
    + 'the locator for a row that exists only in `sys_metadata`. A branch carrying a non-blank '
    + 'predicate parses and registers byte-identically to before, a decision with no `conditions` '
    + 'still routes by its out-edges, and an absent screen field `visibleWhen` is still legal.',
};
