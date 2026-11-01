---
'@objectstack/runtime': patch
---

fix(runtime)!: the connector connection door's begin and revoke legs refuse a delegated or agent caller by name; connecting and revoking an organization's connector is a human administrator's act

Clause-②: no (narrowing) — `POST` and `DELETE /api/v1/automation/connectors/:name/connection` refuse a delegated or agent caller by name: one admitted by an API key or an OAuth access token, or carrying an agent envelope (`principalKind: 'agent'`, `onBehalfOf`). Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no metadata an author writes changes meaning: one HTTP door narrows which callers may take two of its steps. The refusal is the door's existing 403 PERMISSION_DENIED with a sentence naming the caller's kind, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** caller narrowing at the connector connection door (`@objectstack/runtime`, ADR-0143 D5).

- **The rule.** The begin leg (connect, reconnect) and the revoke leg refuse a delegated or agent caller, whatever it holds, with `403 PERMISSION_DENIED` and a message that names its kind (an agent acting on a person's behalf, an OAuth access token, an API key) and the rule. D5 binds a connection to the session that began it, so connecting and revoking is taken by a person signed in.
- **Unchanged.** Who holds the capability (platform administrators, the organization-administrator sets, explicit grants), the system context's bypass, the read leg (`GET …/:name/connection`) and the OAuth callback.
- **Who sees it.** Any caller on these two steps that is not a person signed in.

**The remedy.** Take the step from a signed-in session (the Console, or a session token), as the administrator who holds the capability.
