---
"@objectstack/service-settings": minor
"@objectstack/plugin-auth": minor
---

feat(settings,auth): expose the audience posture in the `auth` settings namespace (#11768)

The audience posture shipped by #11739 (`invite_only | email_domain | open`,
default `invite_only`) was switchable only from stack config at boot; a
self-host admin had no console channel. The `auth` settings namespace now
carries an `audience` group — three new authorable keys, which is what a host
sees and why this is `minor`:

- `audience_posture` — a select over the closed vocabulary (the option table
  is enforced on `setMany` and on the `OS_AUTH_AUDIENCE_POSTURE` env-override
  door);
- `audience_allowed_email_domains` — newline- or comma-separated bare domains
  (exact, case-insensitive matching; subdomains need their own entries);
- `audience_self_registration_permission_set` — the `sys_permission_set` name
  each self-registrant receives.

`bindAuthSettings` maps the three keys — one atomic declaration — to one
`AuthManager.applyConfigPatch({ audience })`, which replaces the whole
audience object and validates the MERGED result. Every #11739 invariant holds
through the new channel: a self-registration posture with verification
explicitly off, an empty domain list under `email_domain`, and a missing or
`admin_full_access` permission set are all refused loudly (the standing
config keeps ruling — fail closed), and off-vocabulary postures are refused,
never coerced, per the `membership_policy` precedent (#5152). Only EXPLICIT
settings values apply: the manifest defaults never mask a deployment's
boot-config declaration. Switching back to `invite_only` always applies —
leftover text in the posture-hidden sibling fields cannot make closing the
wall refusable.
