---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-messaging': patch
---

Auth, webhook and outbound-delivery refusals, warnings and field help no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings these three packages show to operators, administrators and callers pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `@objectstack/plugin-auth`: an unrecognised audience posture is refused because it must not fall through to a more permissive posture than the one intended; the `ObjectQL` adapter's case-insensitive warning says the `$ieq` operator is deliberately deferred until there is demonstrated pull for it; the `internal`-column refusal says the column is withheld from every ordinary read and recovered only through the engine's accessor; the 2FA re-enrollment errors say a re-enrolled TOTP secret may be live at sign-in without having been confirmed; the walled-owner boot warning says a declared owner is stamped verified only when an operator-provisioned path creates the account; the OTP send-budget lines name the budget without a number.
- `@objectstack/plugin-webhooks`: the parked-event record says the event is recorded rather than delivered unsigned (or without its authored headers) and rather than discarded without a trace; the redeliver refusals say a delivery that cannot be signed is refused rather than sent unsigned; the zero-trigger warning says the `api` trigger was removed because nothing could fire it; the seed and legacy-migration warnings say a credential is never stored in cleartext instead and that a failed migration leaves it cleartext in `definition_json`.
- `@objectstack/service-messaging`: the `sys_http_delivery` field help for `attempts` (in every shipped locale) says a parked row is not redeliverable because it carries no signature; the `headers_json` and `error` help and the outbox refusals drop their citations; the notification `ack()` refusal says cancelling a pending row is not part of the outbox contract until a live consumer needs it.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
