---
'@objectstack/plugin-webhooks': patch
'@objectstack/runtime': patch
---

fix(plugin-webhooks,runtime): a declared webhook that the deployment can never deliver is reported at `error` once at boot, and the activation door refuses to switch it on

Clause-②: no

The webhook auto-enqueuer reads record events only from the realtime service. A stack with `requires: ['webhooks']` and no `'realtime'` therefore never delivers a declared webhook.

- **Before.**
  - The boot logged one `WARN [webhook-auto-enqueuer] disabled — ObjectQL, Realtime, or Messaging service not available`. The line named no webhook, gave no consequence and gave no fix.
  - `POST /api/v1/security/_activation/webhook/NAME` with `{ "enabled": true }` answered `200 { enabled: true }` and wrote the activation row.
  - Every record write still answered 200, and no delivery row was ever written.
- **After** (`@objectstack/plugin-webhooks`). When the stack declares at least one webhook, the boot logs one `error` line instead of the warning. The line names each declared webhook and says that none of them will be delivered while record writes keep succeeding. It names the missing service and the fix, for example "add 'realtime' to `requires`". A stack that declares no webhook gets the same `warn` as before.
- **After** (`@objectstack/runtime`). On such a deployment, switching a declared webhook ON through the activation door answers `503` with `error.code: 'SERVICE_UNAVAILABLE'` and writes nothing. The message gives the same reason and fix as the boot line. Switching one OFF still answers `200` and writes the row. A name nothing declares is still `404`. The authority checks still answer first.
- **Unchanged.**
  - Every deployment whose auto-enqueuer runs: switching on and off and delivery behave as before.
  - A host that constructs `WebhookOutboxPlugin` with `autoEnqueue: false` gets no new log line and no new refusal. It has turned the enqueuer off itself, and redelivery still reads the switch.
  - `os validate` and `os build` are unchanged. They still accept a stack that declares webhooks without these tokens.
- **What to do.** A stack that declares webhooks needs `requires` to include both `'webhooks'` and `'realtime'`.
