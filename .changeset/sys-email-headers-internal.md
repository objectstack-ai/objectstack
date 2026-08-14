---
'@objectstack/platform-objects': minor
'@objectstack/plugin-email': patch
---

Stop serving custom email headers through the generic data-API read of `sys_email` (#8149).

**What this closes.** `sys_email.headers_json` — the custom headers handed to `IEmailService.send`, the ordinary place a relay credential or provider token goes — was readable by every caller the data API admits (list, get, an explicit `?select=headers_json`). The column is now declared `internal: true`, so the engine omits it from every generic read with no system carve-out (#7728); `SYSTEM_CTX` does not reopen it either. This is the same shape #8118 ruled on for `sys_http_delivery.headers_json`: this change adopts that remedy rather than deciding it a second time.

**Delivery is unaffected, and fail-closed.** `sys_email` is not delivered from the in-memory message but FROM THE ROW: the after-insert outbox drain hook, the `email.send.async` queue subscriber and the boot outbox sweep all re-read the row and hand it to `EmailService.deliverPersistedRow`. All three read through `engine.find`, which is exactly what the flag empties — so the recovery ships with the flag. `deliverPersistedRow` now recovers the column through ObjectQL's privileged accessor (`resolveInternalField`, consumed unchanged) and sends every authored header verbatim. A message whose headers cannot be recovered is NOT sent without them: a missing header is not self-announcing — a relay that does not require it accepts the mail while the delivery silently deviates from the authored configuration. That case throws and leaves the row `queued`, not `failed`, so the queue retry or the next boot's sweep delivers it intact.

**New optional seam.** `EmailPersistence.readHeadersJson(rowIds)` — the readback the plugin wires off the raw engine. It probes the OBJECT SCHEMA flag, never the absence of the key from a result row: `headers_json` is `required: false` and most real rows carry no custom headers at all, so a key-absence inference would treat every ordinary email as redacted (the regression measured on `sys_account`'s optional token columns in #7987/PR #8675). Engines that do not redact are left untouched and trigger no privileged read.

**What this deliberately does NOT close.** The row still holds the header map in cleartext at rest. Encrypting it (`Field.secret()`) was measured and rejected on #8118 — an orphan `sys_secret` row per message with no cascade or retention, a boot-window fail-open, and a per-row decrypt on every delivery — and this change adopts that ruling unchanged.
