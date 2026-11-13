---
'@objectstack/spec': patch
---

fix(spec): the `tool.requiresConfirmation` rejection no longer says REST `/actions` never reads the `ai.exposed` opt-in

Clause-②: no
Metadata-protocol: none

The prescription an author meets when a tool still declares `requiresConfirmation` stated that REST `/actions` is not `ai.exposed`-gated. That route now reads the opt-in for one pair: an AI service account (an agent acting for itself, with no `onBehalfOf`) starting a `type: 'flow'` action whose flow declares `runAs: 'system'` is refused `403 PERMISSION_DENIED` unless the action declares `ai.exposed: true`. The sentence now names that pair and says no confirmation is asked there, and keeps the rest of the bound: for a person's call REST `/actions` stays outside the `ai.requiresConfirmation` gate. Text only; what the schema accepts and refuses is unchanged.
