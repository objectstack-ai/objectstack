---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth)!: deleting an SSO provider ends the sessions a sign-in through it opened and removes its projected grants

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no published skill teaches deleting an SSO provider, its sessions or its projected grants; the rule is documented in `content/docs/permissions/sso.mdx` ("Deleting an SSO provider")

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, value or export is added, removed, renamed or re-shaped. `sys_session` gains a system-managed, read-only column the platform writes itself, and what changes is which sessions and projected grants stay live once an SSO provider is gone: no stored metadata row, registry key or authored value moves, so there is nothing for a migration to rewrite. -->

**BREAKING** for a session a sign-in through an SSO provider opened: deleting that provider ends the session, and its next request is answered as signed out. Sessions opened any other way are not touched.

- **Sessions.** Each session an SSO sign-in opens records the provider it was signed in through, in the new read-only `sys_session.sso_provider_id` column. `POST /api/v1/auth/sso/delete-provider` revokes the live sessions that record the deleted provider (`revoke_reason: 'sso_provider_deleted'`). A session signed in any other way (a password, another provider) is left as it is, and a delete the vendor refuses ends nothing.
- **The answer.** A successful delete's `data` carries `revokedSessions`, the number of live sessions it ended, beside the other counts, and its `message` says so.
- **Projected grants.** A permission-set grant projected by an SSO provider's group mapping exists only while that provider does: the delete removes them, as before, and at every boot the grants whose `reason` names a provider with no `sys_sso_provider` row are removed too, as are live sessions recording such a provider. The boot does not remove the provider's group mappings (delete each with **Delete Mapping**, or `POST /api/v1/auth/admin/scim/delete-group-mapping`); it logs at `info` what it removed, and at `error`, with the remedy, when it could not. Several servers sweeping at once each remove what is left, and none reports the others' removals as a failure.
