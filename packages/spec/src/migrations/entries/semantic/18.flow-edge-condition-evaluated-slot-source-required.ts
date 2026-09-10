// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'flow-edge-condition-evaluated-slot-source-required',
  surface:
    'a flow edge predicate — edges[].condition on FlowEdgeSchema, the branch predicate '
    + 'AutomationEngine.evaluateCondition runs at every traversal — authored either as an '
    + 'expression envelope carrying only ast ({ dialect: \'cel\', ast: … } with no source), or '
    + 'with a source that is blank after trimming, through the envelope key ({ dialect: \'cel\', '
    + 'source: \'   \' }) or the bare-string shorthand for it (condition: \'   \'). Reachable '
    + 'wherever a flow is authored or stored: defineStack({ flows }) sources, an exported stack '
    + 'passed to objectstack validate, a POST /flows body, and a flow row already sitting in '
    + 'sys_metadata',
  replacement:
    'a non-blank `source` — `{ dialect: \'cel\', source: \'record.amount > 10\' }`, or the bare '
    + 'string `\'record.amount > 10\'` — if the edge was meant to branch; or REMOVE the '
    + '`condition` key entirely if it was meant to be unconditional. ⚠️ Those two are not '
    + 'interchangeable, and the choice is the judgment this entry delegates: a refused condition '
    + 'evaluated to a silent `false`, so the edge NEVER fired, while an absent `condition` is an '
    + 'unconditional edge that ALWAYS fires. Deleting the key to clear the refusal inverts the '
    + 'edge rather than preserving it. An `ast` BESIDE a string `source` is untouched and stays '
    + 'admitted everywhere',
  reason:
    'Card #15807 (the #15430 / #15662 lineage): `FlowEdgeSchema.condition` now composes '
    + '`EvaluatedExpressionInputSchema` instead of `ExpressionInputSchema`, so an evaluated slot '
    + 'is held to what the engine can actually run. The engine reads `source` alone '
    + '(`cel-engine.ts` `evaluate`: "AST-only evaluation not yet supported; persist `source`"), '
    + 'so both refused spellings landed in its empty-source arm and answered a SILENT `false` on '
    + 'every release that carried them — they parsed, registered, passed `objectstack validate`, '
    + 'and then produced a branch that quietly never fired (measured on #15430, comment '
    + '5550509137). The refusal is one rule with one sentence, '
    + '`EVALUATED_EXPRESSION_SOURCE_REQUIRED`. '
    + '⚠️ No D2 conversion is possible, and this is exactly why the change needs a D3 entry '
    + 'rather than none. An `ast`-only envelope carries no `source` to derive one from — '
    + 'lowering an AST to surface syntax is the compiler direction the platform does not run — '
    + 'and dropping a blank `condition` would flip the edge from never-fires to ALWAYS-fires, '
    + 'which is the platform guessing which of two different flows the author meant. '
    + '⚠️ And the consequence for a flow ALREADY STORED is wider than the edge, which is the '
    + 'part no author-time prescription reaches. `applyConversionsToStoredItem` is deliberately '
    + 'not applied to `flow` (`spec/src/conversions/stored.ts`, and the same skip in '
    + '`metadata/src/loaders/database-loader.ts` `rowToData`) because flow-node conversions need '
    + 'the automation engine\'s live executor registry; flows canonicalize at `registerFlow` '
    + 'instead, which parses through `canonicalizeStoredFlow` → `FlowSchema.parse`. Each of the '
    + 'three boot paths in `service-automation/src/plugin.ts` wraps that call in try/catch, logs '
    + 'one `warn` naming the flow, and CONTINUES — so a stored `sys_metadata` flow with such an '
    + 'edge is no longer registered at all: its trigger is never armed and the WHOLE flow stops '
    + 'running, not just the branch, announced only by that warn line. A repo-wide census at '
    + '`ae19f5edb` (examples/, packages/, content/, skills/) found zero edge conditions of either '
    + 'spelling against a lit control, so there is nothing in THIS repository to rewrite — a '
    + 'repo reading, which is why the notification is registered here rather than skipped. '
    + 'ADR-0087, ADR-0032.',
  acceptanceCriteria:
    'Grep every authored `edges[].condition` — `defineStack({ flows })` sources, exported stacks, '
    + '`POST /flows` bodies — and every flow row in `sys_metadata`, for an envelope with no '
    + '`source` key and for a `source` (or bare string) that is empty after trimming. For each '
    + 'hit decide, per the `replacement` note, whether the edge was meant to branch (author the '
    + '`source`) or to be unconditional (remove the key) — do not default to removal. Two proofs, '
    + 'and the second is the one that matters for stored rows. (1) `objectstack validate` on the '
    + 'exported stack is clean: it locates each offender at `edges.N.condition` with the '
    + '`EVALUATED_EXPRESSION_SOURCE_REQUIRED` sentence, and an `ast`-only envelope is also '
    + 'reported by the lint path as `STRUCTURAL_CONDITION_SHAPE_REFUSAL`. (2) Boot the stack and '
    + 'confirm each flow REGISTERS: no `failed to register flow` warn for it (the three boot '
    + 'paths spell it `[Automation] failed to register flow`, `[Automation] flow re-sync: failed '
    + 'to register flow` and `[Automation] cold-boot flow bind: failed to register flow`), and '
    + 'its trigger is armed. A flow that boots without that warn is unaffected; every edge '
    + 'condition carrying a non-blank `source` parses byte-identically to before.',
};
