// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15429 — edge-branched `decision` nodes became EXCLUSIVE (maintainer ruling
// 「跟主流对齐」, 2026-09-23): the first conditioned out-edge that holds, in the
// order the flow declares its edges, is the branch; taking every true branch
// is the declared `mode: 'inclusive'`.
//
// Both ship, and they answer different questions. The D2 conversion
// `flow-decision-mode-inclusive-explicit` writes `mode: 'inclusive'` onto every
// decision that has no `conditions` list and two or more conditioned
// out-edges, so a flow written while every true branch ran keeps that
// behaviour — mechanically, by the count, with no inference over the
// conditions. This SEMANTIC entry is the judgment that count cannot make: on
// most such decisions the branches partition and the written key changes
// nothing, and on the hotcrm#1555 shape it preserves a multi-branch run the
// author never meant. A flow STORED in `sys_metadata` is outside the
// conversion by maintainer ruling (letter C on #15429): it takes the
// first-match meaning on upgrade, BREAKING, and `os migrate meta --stored`
// lists its candidates for review without writing them.
import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'flow-decision-edge-branching-first-match',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'flow.nodes[].config.mode (decision) — an OMITTED mode on a decision that branches '
    + 'on its out-edges and carries two or more conditioned ones',
  replacement:
    'nothing, where the out-edge conditions partition (exactly one can hold for any '
    + 'record): an omitted `mode` now means exclusive, the first true edge in declaration '
    + 'order wins, and the run is what it always was. `mode: \'inclusive\'` where the flow '
    + 'RELIES on more than one branch running for one record — the value the D2 conversion '
    + '`flow-decision-mode-inclusive-explicit` writes onto every such decision so nothing '
    + 'changes silently. Where the conditions overlap by accident (a `!=` guard beside a '
    + 'later `==` branch), neither: narrow them into a partition, or mark the fallback '
    + '`isDefault: true`, and delete the written key.',
  reason:
    'A DEFAULT FLIP of a shipped node type, ruled rather than patched: the schema, the docs '
    + 'and the engine\'s own comment all called an edge-branched decision an exclusive gateway '
    + 'while the traversal took EVERY out-edge whose condition held, one after another, and '
    + 'reported nothing — a CRM application\'s lead-conversion flow rendered a refusal screen AND '
    + 'ran the conversion in one '
    + 'execution. The traversal now matches the declaration (BPMN exclusive gateway, '
    + 'Salesforce Flow Decision, n8n Switch default), and the every-true-edge behaviour is the '
    + 'BPMN inclusive gateway an author must write down. The KEY converts mechanically and '
    + 'does: `flow-decision-mode-inclusive-explicit` writes `mode: \'inclusive\'` wherever two '
    + 'or more conditioned out-edges leave a decision that declares no `conditions` list, so '
    + 'the migrated source runs exactly as before. What does NOT convert is the INTENT: the '
    + 'count cannot tell a partition (where the key is redundant) from a reliance on '
    + 'multi-branch runs (where it is load-bearing) from an accidental overlap (where the '
    + 'old behaviour was the bug), so the mechanical edit list the chain replay prints is '
    + 'where that judgment is made, node by node. And the conversion replays ONLY there: it is a '
    + 'default flip, so the authoring funnel never rewrites a source written against the '
    + 'new contract, and the automation engine\'s flow rehydration seam and the '
    + 'artifact-ingestion door both refuse it by id (a code-shipped flow, a REST body, a Studio '
    + 'save and a scaffolded artifact all arrive undated). BREAKING for stored rows, by '
    + 'maintainer ruling: the promise that a flow keeps its behaviour is kept by authored '
    + 'sources and built artifacts only. A decision stored in `sys_metadata` '
    + 'with no `conditions` list, no `mode` and two or more conditioned out-edges takes the new '
    + 'meaning on upgrade — it evaluates first-match — and nothing rewrites the row: no '
    + 'stored-row migration, no cutoff, no read-path completion, because nothing about a stored '
    + 'row says it was saved before the flip. The one-line fix, for a stored node that meant '
    + 'every branch, is `mode: \'inclusive\'`; `os migrate meta --stored` lists every such node, '
    + 'report only, so an operator can review the candidates before and after the upgrade.',
  acceptanceCriteria:
    'Review every `flow-decision-mode-inclusive-explicit` line the chain replay lists for '
    + 'each authored stack: (1) where the two (or more) '
    + 'out-edge conditions partition — a predicate and its negation, `>` beside `<=`, or a '
    + 'guard beside `isDefault: true` — delete the written `mode`; the run is unchanged either '
    + 'way and the exclusive default is the honest declaration; (2) where the flow relies on '
    + 'more than one branch running for one record, keep `mode: \'inclusive\'`; (3) where the '
    + 'conditions overlap by accident, narrow them into a partition and delete the key, then '
    + 're-run the flow on a record that satisfied both and confirm exactly one successor '
    + 'ran — the passed-over branch now leaves a `skipped` step in the run log. `os validate` '
    + 'reports `flow-decision-inclusive-overlap` on every decision that keeps the key with '
    + 'two or more conditioned out-edges, so the review list is the lint output. Then each '
    + 'deployment: `os migrate meta --stored` lists, under `decisionModeReview`, every stored '
    + 'decision with two or more conditioned out-edges and no `mode` — each one already '
    + 'evaluates first-match, and the pass writes none of them — so where one of those nodes '
    + 'meant every branch, declare `mode: \'inclusive\'` on it in the designer; a node '
    + 'that declares `mode` either way leaves the list. A decision registering with '
    + '`mode` beside a non-empty `conditions` list, or with a `mode` outside '
    + '`\'exclusive\' | \'inclusive\'`, is refused at registration and by `os validate` with the '
    + 'schema\'s own sentence; nothing else about `conditions`-list decisions changes. '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
};
