---
"@objectstack/spec": patch
---

docs(spec): `ApproverType`'s description points at `os explain approval-approvers-may-resolve-empty` for the graded `manager` routes

Clause-②: no

- **What changes:** the `.describe()` text of `ApproverType` (`@objectstack/spec/automation`), which the generated reference page renders for every approver entry (`content/docs/references/automation/approval.mdx`). It said `os lint` "carries the graded population routes and the full remedy". Since `@objectstack/lint` shortened `approval-approvers-may-resolve-empty`'s fix line to one sentence, the finding names two routes in one line, and `os explain approval-approvers-may-resolve-empty` prints the graded routes and the full remedy. The description now says so. Its "the request waits" clause now reads that the request falls to the node's `onEmptyApprovers` policy, which by default opens it on the organization's administrators.
- **Unchanged:** the `ApproverType` values, the schema's shape, and what it accepts or refuses. Only the description text moves.
