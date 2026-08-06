---
'@objectstack/service-settings': patch
---

Settings: an `OS_*` env override is now checked against the specifier's declared `options` table (#5204)

A manifest's `options` table has been enforced on the write path since #5131, but
`SettingsService.get()` produced an effective value by a second route that never
consulted it: an `OS_*` override was reshaped by the default's type and returned
straight from the top of the cascade with `locked: true`. So the providers #5094 and
#5133 retired from `mail.provider` could walk back in through the one door with no
gate on it — `OS_MAIL_PROVIDER=sendgrid` reached the mail plugin unchallenged — and a
plain typo such as `OS_BRANDING_THEME_MODE=drak` was served to every consumer as a
normal value with normal-looking provenance, each consumer left to improvise.

An override whose value the table does not declare is now **ignored** rather than
repaired: the value falls through to the next layer of the cascade (a stored
global/tenant/user value, else the manifest default), and the read API reports that
layer honestly instead of claiming `source: 'env'` for a value not in force. The
rejection is logged once at `error`, naming the variable, the rejected value, the legal
value set and the consequence. The same audit runs at `registerManifest`, so a
misconfigured deployment learns at boot rather than whenever somebody first opens the
settings page.

Registration **reports but never refuses**: option tables move, a pin that was legal
the day it was written must not turn an upgrade into a crash-on-start.

Two behaviour notes for anyone relying on the old shape:

- Keys with no declared option table are untouched — text, boolean, number and
  password overrides behave exactly as before. The check applies only to
  `select`/`radio`/`multiselect` specifiers that declare a non-empty table.
- A **rejected** override no longer pins its key against writes. `setMany` used to
  refuse on the mere presence of the variable; judged by presence, an ignored value
  would have left the key configurable by nothing at all — env value discarded, UI
  refused with `SETTINGS_LOCKED`, and `get()` reporting `locked: false` to a settings
  page whose save would then fail. An override that *is* in force still locks the key,
  unchanged.
