---
"@objectstack/service-settings": patch
---

fix(service-settings): a settings `select` now rejects values outside its declared `options` (#5131)

`SettingsService.validatePatch` enforced two of the constraints a settings
manifest declares — `required` and `pattern` — and skipped the third. A
specifier's `options` table never took part in save-time validation, so any
string at all could be written into a dropdown field:

```ts
await svc.setMany('mail', { provider: 'sendgrid', from_email: 'a@b.com' }); // stored
```

Going through the console this was unreachable: the dropdown only ever emits a
value from the table. But `PUT /api/settings/:ns` is an authorizable public
surface, and scripts, migration tools and AI-authored bootstrap code write it
directly — where the bad value was accepted, persisted and read back **in
silence**, leaving every consumer to improvise its own answer for an
enumeration member that does not exist. It was not `mail`-specific:
`storage.adapter`, `sms.provider`, `ai.provider`, `localization.date_format` and
every other `select` behaved the same way.

This is the API-side gate that #5094 was missing. That change retired
`sendgrid` / `ses` from the `mail` provider table because this server cannot
deliver through them — with no write-side enforcement, the values it had just
retired could be written straight back in the same afternoon.

**Now:** a `select` / `radio` / `multiselect` value that is not a member of the
declared table is rejected with a `FieldError` whose `code` is `invalid_option`
and whose `constraint` carries the allowed set (`{ allowed: 'smtp, resend,
postmark, log' }`), so a client composes its own message instead of parsing
ours. The enforced set is the spec's own: `SpecifierSchema` already *requires* a
non-empty `options` on exactly those three types, so declared and enforced name
one list rather than two that can drift.

Two deliberate limits keep this from breaking workspaces that already carry
drift:

- **The check is gated on TOUCH**, like `required` and `pattern` before it. A
  value that pre-dates the current option table only fails the patch that
  writes that key — editing `from_name` is not rejected because a stale
  `provider` sits in the store. The opposite rule would lock every workspace
  with historical drift out of its own settings page entirely, which is worse
  than the gap being closed. Resets (all-null patches) are never blocked.
- **A specifier that declares no option table is left alone.** It cannot say
  what is legal, so it stays lenient rather than rejecting every write.

Values are compared in string form, so an option declared `value: 30` still
matches after a round trip through JSON or a form post. There is no opt-out: a
manifest that needs to accept custom values would declare that explicitly in
the spec, not rely on a tolerant consumer.
