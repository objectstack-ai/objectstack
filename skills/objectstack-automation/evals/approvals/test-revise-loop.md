# Eval: approval send-back-for-revision loop (ADR-0044)

Validates that an AI assistant authoring an approval flow with a *send back for
revision* step emits the full ADR-0044 shape — a `revise` branch, an
`approval_revise` window node, and a resubmit edge typed `type: 'back'` — so the
flow **registers** and the loop actually works at run time.

Skill rule referenced: `SKILL.md` → "Send-back for revision (ADR-0044)", which
carries the canonical shape, the three authoring pieces and the lint findings.
This file states only what a grader scores, so the rule has one home.

## Scenario

> Build an autolaunched flow `budget_approval` on the `project` object: when
> `budget` increases past 100000, route to a manager for approval. The manager
> can **approve**, **reject**, or **send the record back to the submitter for
> revision**; after the submitter reworks and resubmits, it returns to the
> manager for another round. Cap it at two send-backs.

## Validation Criteria

Score the generated flow:

1. **Registers** — `registerFlow` accepts it (no un-declared-cycle error). *(required)*
2. **Revise branch** — the approval node has an out-edge labelled `revise`. *(required)*
3. **Back-edge** — exactly one edge closes the loop into the approval node, typed `type: 'back'`. *(required)*
4. **Revise window** — the `revise` edge targets an `approval_revise` node. *(required)*
5. **Guard** — `maxRevisions >= 1` on the approval config (the default `3` is fine; `0` fails). *(required)*
6. **No lint findings** — `lint-flow-patterns` emits none of the four `flow-approval-revise-*` findings. *(required)*
7. **Window is a node, not a mode** — the pause is the `approval_revise` node on
   the graph, not a "revise mode" re-suspend of the approval node itself (that
   hides a state machine inside one node, invisible to the canvas and run log). *(required)*
8. **Approve / reject intact** — the approval still has `approve` and `reject` out-edges. *(preferred)*

Pass = criteria 1–7 all hold. The canonical failure this eval guards against is a
run that builds the loop but omits the back-edge (criterion 3) — accepted by a
naive author, rejected by `registerFlow`.
