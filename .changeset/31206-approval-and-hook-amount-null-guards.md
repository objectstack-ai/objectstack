---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills, spec): the approval-flow example and the `HookSchema.condition` example guard their nullable `amount` comparison with `record.amount != null`

Clause-②: no
Metadata-protocol: none

The publish-time null-guard rule refuses an ordering comparison on a declared-nullable field in a hook `condition` and in a record-triggered flow's start, edge and `decision` conditions unless an explicit `!= null` test dominates it. Two published examples compared `record.amount` without one:

- `skills/objectstack-automation/references/state-machines-and-approvals.md`: the approval flow's start condition now reads `record.amount != null && record.amount > 100000`. What the start condition proves non-null is presumed at every edge and `decision` branch, so the `e1`, `e4` and `e5` edge conditions pass as written, and a null `amount` never launches the flow.
- `packages/spec/src/data/hook.zod.ts`: the `condition` `@example` and `.describe()` text now read `record.status == 'closed' && record.amount != null && record.amount > 1000`, and the generated `content/docs/references/data/hook.mdx` row follows.

The spec change is description text only: no schema shape changes, and no accept set moves.
