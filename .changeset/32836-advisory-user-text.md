---
'@objectstack/lint': patch
---

fix(lint): the approval and flow advisories a flow save returns carry a user sentence in every platform locale

Clause-②: no
Metadata-protocol: none

Nineteen advisory rule ids that the save door returns on a flow write now carry `userTextParams` (the flow, node, object, field and input names their user sentence interpolates) and have a sentence in all eleven platform locales, each in a `*.user-text.ts` catalog beside its rule and merged into the one catalog `findingUserMessage` renders from:

- approval approvers: `approval-approver-type-unknown`, `approval-expression-invalid` (its `info` arm, `resolveAs` on a non-expression approver), `approval-approver-not-membership-tier`, `approval-approver-type-deprecated`, `approval-approver-type-unsupported`, `approval-approvers-may-resolve-empty`, `approval-expression-no-empty-policy`, `approval-escalation-reassign-no-target`;
- flow trigger readiness: `flow-trigger-unknown-object` and `flow-input-unknown-object` (as advisories, with no package closure stated), `flow-input-object-less`, `flow-input-record-read-as-list`, `flow-draft-status-ambiguous`;
- flow template paths: `flow-template-unknown-field`, `flow-template-lookup-traversal`, `flow-template-field-unprovisioned`;
- `flow-node-write-unprovisioned-anchor`, `flow-update-readonly-when-field` and `flow-credential-literal`, whose sentence names where the credential sits and never its value.

Rule ids, `message` and `hint` are unchanged, and the refusals that share an id with one of these advisories carry no params, so they render no user sentence. The `lintFlowCredentialLiterals` registry entry now keeps `userTextParams` when it re-maps its findings, so the publish gate's advisory carries them. Because the finding objects now carry `userTextParams`, `os validate --json` and `os build --json` show that key on these findings in `warnings`.
