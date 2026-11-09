---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): an AI service account's lifecycle — suspend, resume, change owner, retire, and revoke or restore one key (ADR-0151 D6)

Clause-②: yes (widening) — six new auth doors (`POST /api/v1/auth/service-account/suspend`, `resume`, `set-owner`, `retire`, `revoke-key`, `restore-key`) and a suspension when an account's owner leaves its organization. Nothing existing is removed, retyped or refused: the suspension acts only on rows of the agent kind.
Metadata-protocol: none

Every door takes a signed-in session only (`401` without one, and for a caller carrying only an API key, so an account can never lift its own stop or touch its own keys), and answers a person's id as unknown (`404`).

- **Suspend** (the account's owner, an administrator of its organization, or a platform administrator): writes the account's ban state (`banned`, no expiry, `ban_reason` `AI service account suspended`, followed by `: ` and the caller's optional reason), so every key it holds is refused on its next call. Nothing is revoked. A ban already in force stays exactly as it is.
- **Resume** (an administrator only; the owner is refused `403`): lifts the ban, and the same keys work again. An administrator of the account's organization lifts only a suspension these doors (or the owner's leaving) wrote; any other ban, such as a platform administrator's `/admin/ban-user`, only a platform administrator lifts (`403` otherwise). Refused `409` for a retired account, and for one whose owner is no longer a member of its organization.
- **Set owner** (an administrator): names another person of the account's organization as its accountable owner (`400 VALIDATION_FAILED` at `ownerId` otherwise). It does not resume the account.
- **The owner leaves**: when the owner's membership of the account's organization ends (removed, deleted, or moved to another organization), the account is suspended until an administrator names a new owner and resumes it. A stop already in place keeps its own reason.
- **Retire** (an administrator): ends the account's membership and revokes every key it holds with `organization_membership_ended`, in one unit of work. The account's row stays, so what it wrote still names it. Terminal: no key mints or is restored after.
- **Revoke key, restore key** (the owner or an administrator): one key stops or works again; the account's other keys are untouched. A platform administrator's revoke of a key carrying no reason records `administrator_suspended`, which only a platform administrator lifts; a key revoked because its membership ended is never restored; an existing reason is never overwritten.
