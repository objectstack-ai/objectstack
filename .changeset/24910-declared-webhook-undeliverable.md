---
'@objectstack/plugin-webhooks': patch
---

fix(plugin-webhooks): a declared webhook that the deployment can never deliver is reported once at boot, at `error`, with the consequence and the fix

Clause-②: no

The webhook auto-enqueuer reads record events only from the realtime service. A stack with `requires: ['webhooks']` and no `'realtime'` therefore never delivers a declared webhook.

- **Before.**
  - The boot logged one `WARN [webhook-auto-enqueuer] disabled — ObjectQL, Realtime, or Messaging service not available`. The line named no webhook, gave no consequence and gave no fix.
  - Every record write still answered 200, the declaration still read active, and no delivery row was ever written.
- **After.** When the stack declares at least one webhook, the boot logs one `error` line instead of the warning. The line names each declared webhook and says none of them will be delivered while record writes keep succeeding. It names the missing service and the fix, for example "add 'realtime' to `requires`". A stack that declares no webhook gets the same `warn` as before.
- **Unchanged.**
  - Every deployment whose auto-enqueuer runs.
  - A host that constructs `WebhookOutboxPlugin` with `autoEnqueue: false` gets no new log line. It turned the enqueuer off itself.
  - `os validate` and `os build`: they still accept a stack that declares webhooks without these tokens.
  - The activation door (`POST /api/v1/security/_activation/webhook/NAME`): it answers exactly as before.
- **What to do.** A stack that declares webhooks needs `requires` to include both `'webhooks'` and `'realtime'`.
