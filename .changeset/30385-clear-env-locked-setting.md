---
'@objectstack/service-settings': patch
'@objectstack/plugin-auth': patch
---

fix(service-settings): a clear of an env-pinned setting clears the stored value beneath the pin, so the allowed-IP lockout recovery holds once the variable is removed

Clause-②: yes (widening) — `SettingsService.setMany` / `set` (and `PUT /api/settings/:namespace`) accept a clear (`null` / `undefined`) of a key an `OS_*` override in force pins, where every write to such a key was refused `409 SETTINGS_LOCKED`; every other write is still refused. No export, type or error code changes.
Metadata-protocol: none

- **A clear goes through an env pin.** An `OS_*` override in force decides the value in force and still refuses every write but a clear. A clear (`null` / `undefined`, never a value such as `''` that a key would store) clears the value stored beneath the pin, so the key falls back to its default once the override is removed. It changes nothing in force: the answer still reads the env value with `source: 'env'` and `locked: true`. It meets every judgment a clear meets without a pin: a locked row at an upper scope, or a locked row at the write's own scope for a caller that is not the platform, still refuses it `SETTINGS_LOCKED` (`locked-by-<scope>`), and the key's write predicates still run.
- **Why.** The override hides the stored value from every read, and used to refuse every write to it, so an operator who pinned a key to recover from a bad stored value got the same value back the moment the pin was lifted. For `auth.allowed_ip_ranges` that meant the documented recovery (`OS_AUTH_ALLOWED_IP_RANGES` set empty) opened the gate only until the variable was removed, and the next restart locked the administrator out again.
- **Recovery when locked out by `allowed_ip_ranges` (`@objectstack/plugin-auth`).** Start the server with `OS_AUTH_ALLOWED_IP_RANGES` set to an empty value, sign in, clear the stored list with a settings request that sets `allowed_ip_ranges` to `null` (`PUT /api/settings/auth`), then remove the variable. The save refusal's message names these four steps in all four of its languages. This supersedes the recovery sentence of the earlier entry for the allowed-IP save refusal ("remove it once the list is fixed"): removing the variable without the clear brings the stored list back at the next restart. The Setup console still shows a pinned field read-only, so the clear is a settings API request for now.
