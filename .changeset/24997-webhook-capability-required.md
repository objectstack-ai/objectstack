---
'@objectstack/spec': minor
---

feat(spec)!: `defineStack` refuses a stack that declares a webhook while `requires` lacks `'webhooks'` or `'realtime'`, with `STACK_WEBHOOK_CAPABILITY_REQUIRED`

A declared webhook is dispatched by two capabilities together: `'webhooks'` mounts `@objectstack/plugin-webhooks`, whose auto-enqueuer turns a record event into a delivery, and `'realtime'` mounts `@objectstack/service-realtime`, that auto-enqueuer's only source of record events. Neither token implies the other, and a scaffolded app's `requires` is `['automation', 'triggers']`, which carries neither. So a stack that declared a webhook without both validated, built and booted; the activation door answered `enabled: true`; every record write answered `200`; and no delivery was ever enqueued. The only trace was one boot `error`, after deploy. `defineStack` now refuses such a stack at load, the third declared-capability refusal beside `STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED` and `STACK_TRIGGER_CAPABILITY_REQUIRED`, so every door that loads it (`os validate`, `os build`, `os serve` / `os dev`, an app's own `bootStack` tests) stops with the same sentence.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which `defineStack` input is accepted: a stack that declares a webhook and lacks one of two capability tokens is refused at load. The remedy is a capability declaration the author makes in their own `requires`, never a rewrite of a key or a stored row, and no token is implied or added for them, deliberately (ruling A on #24910). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the `defineStack` accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** a stack with a non-empty top-level `webhooks:` collection and a `requires` missing `'webhooks'`, `'realtime'` or both (an absent `requires` included) was accepted, and its webhooks never delivered.
- **TO:** `defineStack` throws `STACK_WEBHOOK_CAPABILITY_REQUIRED` (`status: 422`), header `defineStack webhook capability validation failed (N issues):`, with one `issues` entry per declared webhook naming the webhook and the missing token or tokens. One code for every arm: which token is missing is in the finding, not in the code.
- **Unchanged:** a stack with no declared webhook owes neither token; `defineStack(config, { strict: false })` skips the judgement by contract; the activation door answers as before; and the boot `error` that `@objectstack/plugin-webhooks` logs for a host that wires a stack by hand, past `defineStack`, stays. Every declared webhook counts, `isActive: false` included, because the activation door can switch it on.
- **The fix for an author:** add both tokens to the stack's `requires`, beside whatever it already declares, for example `requires: ['automation', 'triggers', 'webhooks', 'realtime']`. The refusal's own line names exactly the tokens to add.
