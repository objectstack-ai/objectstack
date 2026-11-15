---
'@objectstack/runtime': patch
---

fix(runtime)!: the confirmation an action declares travels with the flow it starts — an AI service account does not start by name a flow that a confirmation-gated action targets

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is a refusal at two routes for one caller kind: no stored row changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an AI service account (an agent principal acting for itself, with no person it acts for) that starts a flow by name. An AI service account does not confirm an action for itself, and the action door already refuses it an action declaring `ai.requiresConfirmation: true` whatever the call sends. The same confirmation now travels with the flow such an action starts: when an action of `type: 'flow'` whose `target` is the flow declares `ai.requiresConfirmation: true`, `POST /api/v1/automation/:name/trigger` and the legacy `POST /api/v1/automation/trigger/:name` refuse the account with the action door's own refusal, `428 ACTION_CONFIRMATION_REQUIRED`, its `details` naming the action and the confirmation member, before any run exists and whatever the request carries (`confirm: true` included). Every declaration of such an action counts, whichever package holds it and whether it is embedded on an object or a standalone item; a read of the declarations that fails refuses the start rather than admitting it.

**Not moved.** A person, an OAuth-delegated agent and the system principal start the flow as before, and the action declarations are not read for them. An AI service account starts a flow no confirmation-gated action targets as before. The action door's own gate (`POST /api/v1/actions/...` and MCP `run_action`) answers as before. A declared `type: 'flow'` endpoint on its default `authRequired` admits a session only, so an API key is refused there before the flow, as before.

**Who moves:** an integration that starts such a flow through the trigger routes under an AI service account's own key. A person starts it now (through the trigger route, or through the action, confirming it), as the action door already requires; or the action's author declares `ai.requiresConfirmation: false` when the flow is safe to start unattended.
