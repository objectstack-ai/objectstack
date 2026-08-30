---
"@objectstack/plugin-email": patch
---

fix(plugin-email): refuse a present-but-unreadable `smtp_port` instead of silently sending on 587 (#13190)

`smtpOptionsFromMailSettings` coerced `smtp_port` with `Number(...)` and then
OMITTED the key whenever the result was not finite. `SmtpTransport` then applied
its built-in 587, so a stored `smtp_port: 'abc'` became a working-looking
connection to a port nobody chose — and `describe()`, the diagnostic surface,
reported 587 as though it had been selected. Nothing threw, nothing warned.

The refusal already existed one layer down: `SmtpTransport`'s constructor rejects
a port outside `SMTP_PORT_MIN`–`SMTP_PORT_MAX` with the generated sentence from
`smtp-port-contract.ts`. The omission is what converted that loud refusal into a
silent default, one layer above the guard that exists to be loud. This fix stops
hiding the value from the guard; ⛔ no second, parallel refusal was added.

`absent` and `present but unreadable` are now distinct, and all of it is pinned:

| stored `smtp_port` | before | after |
|:---|:---|:---|
| absent | 587 | 587 — unchanged; a legitimate default |
| `''` | 587 | 587 — unchanged, deliberately: an empty field spells "not set" |
| `'abc'` / `'Infinity'` / `{}` | **587, in silence** | refused: `SmtpTransport: invalid port 'NaN' (expected 1-65535)` |
| `'99999'` | refused | refused — unchanged |
| `'465'` | 465 | 465 — unchanged |

Behaviour change for a deployment that currently carries an unreadable port: it
was delivering mail on 587, and will now refuse to build the SMTP transport —
reporting the reason at boot and under **Send test email** — instead of sending.
That is the point: the setting was being ignored without a word, which is the
declared-but-not-delivered shape this package has closed twice before.

Reachability is measured rather than argued. `OS_MAIL_SMTP_PORT=abc` resolves as
the string `'abc'` with `source: 'env'` and `locked: true` — a non-numeric value
is not *outside* a numeric window, so the mail manifest's declared
`min: 1, max: 65535` does not reject it — and the ordinary settings save path
stores the same value for the same reason.
