---
'@objectstack/cli': patch
---

fix(cli): `os serve` hands the data engine its crypto provider at `kernel:ready`, so a webhook that fires during boot is delivered signed instead of refused for boot order

Clause-②: yes (widening)
Metadata-protocol: none

`os serve` chose its one crypto provider in the host plugin's `kernel:ready` hook, but handed it to the data engine only after `runtime.start()` returned. The webhook dispatcher arms in a later `kernel:ready` hook and decrypts each subscription's signing secret there, so on every boot it parked each signed webhook (an `error` saying the secret could not be decrypted), and every matching record change in between was recorded as a dead, unsigned delivery that can never be redelivered. The same hook now hands the engine the provider at the moment it is chosen.

| During boot, from the host plugin's `kernel:ready` hook until `runtime.start()` returns | FROM | TO |
|:---|:---|:---|
| The webhook dispatcher's first cache build, for a `sys_webhook` row with a signing secret | `error` "holds an encrypted signing secret that could not be decrypted — the subscription is PARKED", re-armed only once the provider is wired | the secret opens; no `error`, nothing parked |
| A record change matching that webhook (an app seed at `kernel:bootstrapped`, a request once the port is open) | a `dead` `sys_http_delivery` row with 0 attempts and no signature, never sent or redelivered | an ordinary delivery, HMAC-signed |
| A `secret` field written or resolved through the data engine | refused: "no CryptoProvider is registered" (fail-closed) | sealed or opened by the provider the boot chose |

Nothing changes outside that window. A secret is still never sent unsigned and never stored as cleartext: a boot with no usable provider still fails closed exactly as before, a production boot without a stable key still stops at `kernel:ready`, and a provider registered after plugin init, or replaced, still refuses the boot.

No action is needed.
