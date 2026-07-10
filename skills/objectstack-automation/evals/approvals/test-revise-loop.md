# Eval: approval send-back-for-revision loop (ADR-0044)

Validates that an AI assistant authoring an approval flow with a *send back for
revision* step emits the full ADR-0044 shape — a `revise` branch, a signal
`wait` node, and a resubmit edge typed `type: 'back'` — so the flow **registers**
and the loop actually works at run time.

Skill rule referenced: `SKILL.md` → "Send-back for revision (ADR-0044)".

## Scenario

> Build an autolaunched flow `budget_approval` on the `project` object: when
> `budget` increases past 100000, route to a manager for approval. The manager
> can **approve**, **reject**, or **send the record back to the submitter for
> revision**; after the submitter reworks and resubmits, it returns to the
> manager for another round. Cap it at two send-backs.

## Expected Output

An approval node with **three** labelled out-edges, a signal `wait` node for the
revision window, and a **declared back-edge** closing the loop:

```typescript
{
  name: 'budget_approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start',
      config: { objectName: 'project', triggerType: 'record-after-update',
                condition: 'budget > 100000 && budget != previous.budget' } },
    { id: 'manager_review', type: 'approval',
      config: { approvers: [{ type: 'position', value: 'manager' }], lockRecord: true,
                maxRevisions: 2 } },                         // send-back budget
    { id: 'wait_revision', type: 'wait', label: 'Awaiting Revision',
      config: { eventType: 'signal', signalName: 'budget_revision' } },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start',           target: 'manager_review' },
    { id: 'e2', source: 'manager_review',  target: 'approved',       label: 'approve' },
    { id: 'e3', source: 'manager_review',  target: 'rejected',       label: 'reject'  },
    { id: 'e4', source: 'manager_review',  target: 'wait_revision',  label: 'revise'  },  // send-back
    { id: 'e5', source: 'wait_revision',   target: 'manager_review', label: 'resubmit',
      type: 'back' },                                          // declared back-edge
  ],
}
```

Mirrors `examples/app-showcase` -> `showcase_budget_approval`.

## Common Mistakes

| Mistake | Why it is wrong | Caught by |
|---|---|---|
| Resubmit edge **without** `type: 'back'` | `registerFlow` validates the graph-minus-back-edges as a DAG, so it rejects the cycle as un-declared | `registerFlow`; lint `flow-approval-revise-unmarked-backedge` |
| `revise` edge to a wait node that **never loops back** | A valid DAG (registerFlow accepts it), but the submitter has nowhere to resubmit — the branch dead-ends | lint `flow-approval-revise-dead-end` |
| `maxRevisions: 0` together with a `revise` edge | Send-back is disabled, so every revise auto-rejects and the branch never runs | lint `flow-approval-revise-disabled` |
| Re-suspending the approval node in a "revise mode" (no wait node, no edge) | Hides a state machine inside one node — invisible to the canvas/run log; not the ADR-0044 model | design review |
| Reusing `reject` for send-back | `reject` terminates; send-back is a *movement* that returns the record for rework (status `returned`, not `rejected`) | semantics |

## Validation Criteria

Score the generated flow:

1. **Registers** — `registerFlow` accepts it (no un-declared-cycle error). *(required)*
2. **Revise branch** — the approval node has an out-edge labelled `revise`. *(required)*
3. **Back-edge** — exactly one edge closes the loop into the approval node, typed `type: 'back'`. *(required)*
4. **Wait window** — the `revise` edge targets a `wait` node (signal flavour). *(required)*
5. **Guard** — `maxRevisions >= 1` on the approval config (the default `3` is fine; `0` fails). *(required)*
6. **No lint findings** — `lint-flow-patterns` emits none of the three `flow-approval-revise-*` warnings. *(required)*
7. **Approve / reject intact** — the approval still has `approve` and `reject` out-edges. *(preferred)*

Pass = criteria 1–6 all hold. The canonical failure this eval guards against is a
run that builds the loop but omits the back-edge (criterion 3) — accepted by a
naive author, rejected by `registerFlow`.
