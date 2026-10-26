---
'@object-ui/app-shell': patch
---

fix(app-shell): a failed flow run reads the refusal its write node met the way a record save reads it, instead of the engine's node-prefixed English diagnostic

Clause-②: no
Metadata-protocol: none

- **What the user sees.** A flow that fails because a write node was refused (a duplicate, a validation rule, a permission denial) used to show the run's `message` in the dialog and toast: `Node 'create_account' failed: create_record(crm_account) failed: …`, in English under every locale. The Console now shows, in order: the flow's authored `errorMessage`; the producer-marked `userMessage`; the inner refusal's own sentence (a permission denial shows the record form's localized "no permission" line instead of server prose); and only then the run's `message`.
- **Where it applies.** Both failure shapes the flow routes answer: `400 FLOW_FAILED` (`error.userMessage` at the envelope's top level, `error.details.innerRefusal`) and the `200` failed run (`AutomationResult.userMessage`, `AutomationResult.innerRefusal`), for the FlowRunner's resume and both flow-launch hosts.
- **What does not change.** The wire `message` is untouched, a run that met no refusal still shows its `message`, and nothing parses the run's `message`.

What to do: nothing.
