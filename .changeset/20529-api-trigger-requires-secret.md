---
'@objectstack/trigger-api': minor
'@objectstack/service-automation': minor
---

fix(trigger-api,service-automation): an `api` flow with no per-flow secret is refused, at arm time and at registration (#20529)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level).

ADR-0041's `trigger-api` acceptance criteria name a per-flow secret and HMAC
signature verification. The trigger used to arm a flow's inbound hook without a
secret, with only a warning, and that hook skipped signature verification. An
`api` flow whose start node carries no non-blank `config.secret` is now refused
in two places:

- **At registration** (`@objectstack/service-automation`). `registerFlow` refuses
  a flow whose binding resolves to the `api` trigger (`type: 'api'`, or a start
  node with `triggerType: 'api'`) when the start node declares no non-blank
  `config.secret`, whatever the flow's `status`. The error names the flow and
  `config.secret`. The `/automation` create, update and clone doors answer it as
  `400 VALIDATION_FAILED`, like every other registration refusal. At boot the
  flow is skipped and the existing `[Automation] failed to register flow` warning
  names it.
- **At arm time** (`@objectstack/trigger-api`). `ApiTrigger.start()` throws,
  naming the flow and `config.secret`, before it stores a hook or subscribes a
  queue consumer. The engine logs `Failed to bind flow` and the flow stays
  unbound. This covers a host that binds the trigger without the engine. The
  arm-time `armed WITHOUT a secret` warning is gone, since that state no longer
  exists. Every armed hook verifies the signature on every post.

**Fix.** Give the flow's start node a non-blank `config.secret` and sign each
post with it, as the `x-objectstack-signature` header already documents. A flow
that is only ever started explicitly (`engine.execute()`, or the `/automation`
trigger route) and is not meant to receive inbound posts is an `autolaunched`
flow. Declare it `type: 'autolaunched'`, with no `triggerType: 'api'` on its
start node, and it needs no secret.

Unchanged: a flow that already carries a secret registers, arms and verifies
exactly as before.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: `packages/spec` is untouched, the start node's `config` stays the open record it was, and `hookId` and `secret` are read from it exactly as before. What changes is runtime behaviour for one authored shape, an `api`-kind flow whose start node carries no `config.secret`, which is now refused at registration and at arm time. `objectstack migrate meta` could not rewrite that shape even in principle, because the missing value is a shared secret only the author and the sending system can supply. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers this shape and none is minted here (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
