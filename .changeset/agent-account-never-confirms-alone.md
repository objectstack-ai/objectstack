---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime)!: an AI service account does not confirm an action for itself

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape. The rule is enforced at request time by the action doors' confirmation gate, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** — an AI service account (an agent principal acting for itself: `principalKind: 'agent'` with no `onBehalfOf`) does not confirm an action for itself (ADR-0151 D3 rule 3). An action that declares `ai.requiresConfirmation: true` is refused for an account at every action door — MCP `run_action`, MCP `resume_run`, REST `/actions`, and a host's `dispatchAction` under either posture — whatever the request carries, with the registered `428` `ACTION_CONFIRMATION_REQUIRED` and its `details` unchanged. The refusal's message states the rule (a person runs this action) and prescribes no retry.

**Who moves.** A deployment that runs a confirmation-gated action from an AI service account's key. That call is now refused; have a person run the action with their own credentials, or, if the action is safe to run unattended, have its author declare `ai.requiresConfirmation: false` (or remove the key). Nothing else moves:

- A person's call is unchanged at every door: at MCP the confirmation member `confirm: true` still runs a gated action, and REST `/actions` still sits outside the confirmation gate for a person.
- A delegated agent (an OAuth agent acting for a person, `onBehalfOf` present) is gated exactly as before.
- An account still runs every action that declares no confirmation, or declares `false`.

`@objectstack/spec`: the `tool.requiresConfirmation` retirement prescription states the account rule beside the REST `/actions` bound. No schema accepts or refuses anything new.
