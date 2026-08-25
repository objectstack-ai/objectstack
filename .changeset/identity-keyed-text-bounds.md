---
'@objectstack/platform-objects': minor
---

Declare sourced `maxLength` bounds on the thirteen unbounded keyed identity
columns, so their declared indexes can exist on MySQL

`driver-sql` (since #11430) honours a keyed text-family field's declared
`maxLength`, emitting `varchar(maxLength)` instead of `TEXT` — but thirteen
identity columns declared no bound at all, so on MySQL every one of their
declared indexes was refused (`ER_BLOB_KEY_WITHOUT_LENGTH`: a TEXT/BLOB
column cannot be a key without a prefix length) and the objects landed
registered-but-broken. Measured on live MySQL 8.0.46 (`+08:00`,
`STRICT_TRANS_TABLES`): schema-sync failures drop **12/44 → 8/44** platform
objects and physically-present declared indexes rise **89/128 → 104/128**,
with the Postgres 16 control at 0 failures on both legs. `sys_session`,
`sys_api_key`, `sys_device_code` and `sys_oauth_consent` sync completely
clean — a MySQL stack can now enforce the session-token uniqueness its
sign-in path assumes.

Every bound is derived from a named source, none guessed (maintainer ruling
on #11374, 2026-08-24 — route A; the full table with sources is in the PR):
better-auth 1.7.1's own MySQL schema mapping (`session.token` /
`verification.identifier` → 255), its device-authorization plugin's hard
runtime cap of 191 on both codes, IdP norms (`account_id` 256 = SAML Core
NameID cap, above OIDC Core's 255 `sub` cap), the landed bounds of referenced
or producing siblings (`client_id` × 4 → 255 from
`sys_oauth_application.client_id`; `provider_id` 255 from
`sys_sso_provider.provider_id`; `issuer` 2048 from `sys_sso_provider.issuer`),
and the in-repo producer (`sys_api_key.key` 64 = fixed sha-256 hex).

This is an enforcement change on published objects — hence the minor grade: a
write wider than its column's new bound is now **refused** (measured: a
300-char `sys_session.token` insert fails `ER_DATA_TOO_LONG` on a strict
server, 0 rows; a 255-char one lands). Every bound admits everything its
upstream producer can write, so only values the producing contracts already
forbid are affected.

Deliberately not bounded, per the ruling's escape clause:
`sys_verification.value` (better-auth's oauth-provider stores JSON
authorization-code payloads there — no defensible bound exists), and
`sys_import_job.created_by` (outside this card's identity surface).
`sys_account.issuer`'s 2048 exceeds the 768-char utf8mb4 key ceiling on
purpose — tighter would refuse SSO sign-ins that `sys_sso_provider`'s own
contract admits — so its `(issuer, account_id)` unique stays for #11627's
hash-shadow route, alongside the `maxLength: 1024` token columns. A new pin
test enumerates every keyed text-family identity column and names any future
unbounded arrival.
