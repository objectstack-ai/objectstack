---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/service-push': minor
'@objectstack/cli': minor
'@objectstack/verify': minor
---

feat(push): `requires: ['push']` and the stack's `push` key turn mobile push on under `objectstack serve`, and a relay configuration is refused at boot

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — #29969 (skills/objectstack-platform/evals/config-plugins-ops.json: no eval asks for `requires: ['push']` or the `push` key); this diff teaches both in `skills/objectstack-platform/SKILL.md` (the top-level key enumeration and the `requires` table) and in the new `content/docs/kernel/runtime-services/push-service.mdx`

A deployment that runs `objectstack serve` from a stack file can now turn on mobile push without host code. Before this, the only way to register a push service was a host that composed `PushServicePlugin` in code, so a `notify` node naming `push` had nothing to deliver through on a served stack.

- **`@objectstack/spec`: the `push` capability token and the `push` stack key.** `push` joins `PLATFORM_CAPABILITY_TOKENS`, provided by `@objectstack/service-push` in the open edition. It is requested, never on the always-on slate. The stack definition gains a top-level `push` key beside `email` and `sms`: it is `PushServiceConfigSchema`, composed as a single value (`COMPOSE_KEY_DISPOSITIONS`). Authoring accepts a direct block, a relay block and absence; it refuses an inline secret, by key name (`key`, `privateKey`, `serviceAccount`, …) with `credentialRef` as the remedy, or pasted into a `credentialRef` (ADR-0143 D3). `PushServiceConfigSchema`'s docblock now names the stack key and `objectstack serve` as its reader; `PushRelayTransportConfigSchema` keeps its `[PLANNED — not yet served]` marker.
- **`@objectstack/core`: the `push` provider row and its argument.** `CAPABILITY_PROVIDERS.push` names `PushServicePlugin`, and `resolveCapabilityArgument('push', …)` builds its argument from the stack's `push` key through `resolvePushCapabilityArg`, read off the provider module as the `email` and `sms` readers are. Both `objectstack serve` and `@objectstack/verify`'s `bootStack` read this table, so an app's tests get the push service its server gets.
- **`@objectstack/service-push`: `resolvePushCapabilityArg`.** It parses the `push` key with `PushServiceConfigSchema` and refuses, before the kernel boots, two configurations: the relay transport (an absent key and `push: {}` read as it), whose sender has not shipped, with a message that says so and prescribes `transport: 'direct'` with an `apns` and/or `fcm` block; and anything the schema refuses, an inline secret first among them, naming each path and the schema's guidance and never the value. On a stack that declares `requires: ['push']` either refusal fails the boot as `Capability "push" (@objectstack/service-push) failed to start: …`.
- **`@objectstack/cli` and `@objectstack/verify`** depend on `@objectstack/service-push`, so the provider the token names resolves out of the box, as the open edition promises.

To turn push on, add `requires: ['push']` and a direct block naming each vendor's secret by reference:

```ts
push: {
  transport: 'direct',
  apns: { teamId: 'ABCDE12345', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production', credentialRef: 'APNS_SIGNING_KEY' },
  fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' },
},
```

In the open tier each `credentialRef` is the name of an environment variable holding the secret. A `push` key on a stack whose `requires` does not name `push` is not read, and `objectstack serve` logs one boot warning saying so. The runtime-services chapter has a new `services.push` page.
