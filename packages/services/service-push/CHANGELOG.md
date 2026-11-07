# @objectstack/service-push

## 18.4.0

### Minor Changes

- 9ebca94: feat(push): `requires: ['push']` and the stack's `push` key turn mobile push on under `objectstack serve`, and a relay configuration is refused at boot
  
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

### Patch Changes

- 8aa2e91: feat(notifications): the `push` channel — a `notify` node naming `push` reaches the recipient's phones through APNs and FCM
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  - **New package `@objectstack/service-push`.** `PushServicePlugin` registers the kernel's `push` service: APNs over HTTP/2 with token-based auth (an ES256 provider token signed with the `.p8` key, reused for fifty minutes) and FCM over the HTTP v1 API (an OAuth access token from the service account). It reads `PushServiceConfigSchema` from its `config` option and refuses an inline secret at boot with the schema's guidance. It serves the direct transport (`transport: 'direct'`, the operator's own APNs key and Firebase project, for a white-label build); the hosted relay, the schema's default and so also an empty config, is refused at init until its sender ships (#29920). Each secret is named by `credentialRef` and resolved when the transport first signs; in the open tier the reference is the name of an environment variable (ADR-0143 D3).
  - **`@objectstack/service-messaging`: the `push` channel.** Mounted while a `push` service is registered, as the sms channel is while an `sms` service is. One delivery reaches every enabled device the recipient registered, on each vendor the push service has a transport for. The push carries the notification id and, when it is a same-server path (`PushRouteSchema`), the notification's `actionUrl` as `route`; any other `actionUrl` is left out and the delivery still goes. Each device's push also carries the origin stored on its row (`PushDeliveryDataSchema.origin`) when the row holds one; the registry does not store it yet, so today none does. A token the vendor reports dead (APNs `BadDeviceToken` / `Unregistered`, FCM `UNREGISTERED`) is retired through `invalidateDeviceToken`: the device row is kept, disabled, and the user's other devices still get the push. A recipient with no enabled device, or whose every device was reported dead, is graded `invalid_recipient`; no push service is refused `transport_not_configured`, as the sms and email channels refuse it.
  - **`@objectstack/spec`: description and comment text only.** The `[PLANNED]` markers come off `PushServiceConfigSchema`, `PushDirectTransportConfigSchema`, `ApnsTransportConfigSchema`, `FcmTransportConfigSchema` and `PushDeliveryDataSchema`, which now have their reader and producer; `PushRelayTransportConfigSchema` keeps `[PLANNED — not yet served]`, now saying the push service refuses it at boot (#29920). `NotificationChannelSchema`'s JSDoc lists `push` among the registered channels, the docblocks name `@objectstack/service-push` where they named `plugin-notification-push`, and the `NOT_FOUND` synonym waiver's reason names service-messaging's own provenance row. No key, schema shape or export changes.
- e8dc483: feat(messaging,spec): a push device's `origin` is stored at registration and every push to the device carries it back
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`@objectstack/service-messaging`**: `sys_user_device` gains an optional `origin` column. `POST /api/v1/notifications/devices` stores the registration's `origin` on the device row (`null` when the registration names none, and a refresh replaces it as it does `appId` and `locale`); `listDevices` answers it; and the push channel, which already copied a device's `origin` into the push data, now finds one to copy. A mobile shell with several saved servers can therefore open a tapped push on the server that sent it. Registrations without `origin` behave exactly as before.
  - **`@objectstack/spec`**: `RegisterDeviceRequestSchema.origin` and `UserDeviceSchema.origin` drop their `[PLANNED — not yet stored]` prefix, since the server now stores the value. The push server origin docblock names where its pattern is knowingly narrower than a URL origin (an underscore in a label, a trailing-dot host) and looser (a written-out default port, a leading zero or an out-of-range port, any bracketed run of hex digits, colons and dots), and that a dotted IPv4 host is accepted. Description and docblock text only; nothing a caller sends is accepted or refused differently.
  - **`@objectstack/service-push`**: the `PushMessage` docblock names `origin` among the delivery data the transports forward. Docblock only; both transports already forward `data` whole.
- 97e4249: feat(service-push)!: push sends through the hosted push relay, authenticated by the server's cloud binding
  
  Clause-②: yes (narrowing) — the relay transport (`transport: 'relay'`, and the default `{}`), refused at init until now, is served; the relay wire narrows: `PushRelayPayloadSchema.data` refuses a key `PushDeliveryDataSchema` does not declare instead of stripping it, and a `RATE_LIMIT_EXCEEDED` relay error must not answer `retryable: false`; `PUSH_RELAY_NOT_SERVED_MESSAGE` leaves `@objectstack/service-push`.
  Metadata-protocol: none
  
  <!-- adr-0087: not-required (runtime-export-retired @objectstack/service-push#PUSH_RELAY_NOT_SERVED_MESSAGE) the retired export is the text of an init refusal that no longer happens; no packages/spec schema, registered node type, ADR-0087 conversion surface or stored shape names it. The two wire narrowings are on the server-to-relay request and the relay's error answer, which no metadata author writes and nothing stores, so there is nothing for objectstack migrate meta to rewrite -->
  
  **The hosted push relay is served.** A stack that requires `push` with a relay configuration (`transport: 'relay'`, `push: {}`, or no `push` key) now boots and sends each push to the cloud's push relay at `/api/v1/cloud/push/send` under the control-plane URL (`OS_CLOUD_URL`, else `https://cloud.objectos.ai`); a relay block's `endpoint` overrides it. Each request carries one ID-only delivery (the notification id, its same-server route, the server's origin and one generic line in the recipient's language); the title and body never leave the server.
  
  - **Authentication.** `@objectstack/cloud-connection` registers a new kernel service, `cloud-binding` (`ICloudBindingService` in `@objectstack/spec/contracts`: `credential()`, `bound()`, `controlPlaneUrl()`), and its own control-plane routes read the credential through it. The push service reads it on every send and puts it in the `Authorization` header only.
  - **An unbound server boots.** It logs one warning at `kernel:ready`; until the server is bound on the Cloud connection setup page, the push service lists no vendor, so the push channel is suppressed as `transport_not_configured` and notifications reach users in the in-app inbox. The bind takes effect without a restart.
  - **A deployment with no control plane** (`OS_CLOUD_URL=off`, `none`, `local` or `disabled`) refuses a relay configuration at boot, naming the in-app inbox and the direct transport as the two ways out. The direct transport is unchanged.
  - **Answers.** `ok` is sent, `invalid` retires the device row, `retry` is retryable; a 401 fails the push without a retry, naming the lapsed binding; a 429 rate limit is retryable and a used-up quota is not.
  - **The notice line.** The push channel picks the generic line by the recipient's language (`sys_user.locale`, then the deployment default, then English) and hands it to the push service as `PushMessage.notice`.
  - `isControlPlaneDeclined` and the "no control plane" spellings move to `@objectstack/core`; `@objectstack/cloud-connection` re-exports `isControlPlaneDeclined` unchanged.
  
  **BREAKING — what narrows, and what to do:**
  
  - FROM `PUSH_RELAY_NOT_SERVED_MESSAGE` TO `PUSH_RELAY_AIR_GAPPED_MESSAGE` (both exported by `@objectstack/service-push`): the relay is no longer refused for being unserved, only on a deployment that declared it has no control plane. A test that matched the old text matches the new constant, or asserts that the relay boots.
  - The relay payload's `data` is judged strictly: a sender puts only `notificationId`, `route` and `origin` in it. A content key such as `title` was stripped before and is now refused with the ID-only guidance.
  - A relay's `RATE_LIMIT_EXCEEDED` error answers `retryable: true`, or leaves `retryable` out (it defaults to `true`). A relay that answered `retryable: false` on a rate limit is now refused by the wire schema.
- 000a4c0: fix(cloud-connection): name the `cloud-binding` service once, in its contract, and read an empty `controlPlaneUrl` one way
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  `@objectstack/spec/contracts` now exports `CLOUD_BINDING_SERVICE` (`'cloud-binding'`) beside `ICloudBindingService`, the way the sibling contracts export their service names. `@objectstack/cloud-connection` registers the binding under it and `@objectstack/service-push`'s relay sender reads it, so the registrar and the reader can no longer spell the name two ways. `@objectstack/service-push` keeps exporting `CLOUD_BINDING_SERVICE`, now a re-export of the contract's constant with the same value.
  
  `CloudConnectionPlugin`'s routes now take their control-plane URL from the `cloud-binding` service they register, so the routes and the binding read the `controlPlaneUrl` option the same way:
  
  - An explicit empty (or blank) `controlPlaneUrl` means "cloud not configured" for both: the routes answer `CLOUD_UNCONFIGURED` as before, and `controlPlaneUrl()` now answers `''` instead of the production default.
  - A declined `OS_CLOUD_URL` (`off`, `none`, `local`, `disabled`) under an absent option is "cloud not configured" for the routes too, as it already was for the binding.
  - An absent option falls through to `OS_CLOUD_URL`, then the ObjectStack-operated default, for the routes too, as it already did for the binding and for the marketplace plugins.
  
  `objectstack serve` and the showcase app are unchanged: they compose the plugin only with `resolveCloudUrl()`'s non-empty answer, which both readings return as is.
- Updated dependencies [8aa2e91]
- Updated dependencies [c17719d]
- Updated dependencies [b90a6f7]
- Updated dependencies [e8dc483]
- Updated dependencies [bcdb1db]
- Updated dependencies [9ebca94]
- Updated dependencies [140d8ce]
- Updated dependencies [699ebd8]
- Updated dependencies [4c2cd29]
- Updated dependencies [4be8a2e]
- Updated dependencies [471add3]
- Updated dependencies [b5eb61d]
- Updated dependencies [771b2db]
- Updated dependencies [97e4249]
- Updated dependencies [9037b13]
- Updated dependencies [e3b56b2]
- Updated dependencies [a52761f]
- Updated dependencies [e8afd1e]
- Updated dependencies [bd65cb6]
- Updated dependencies [f19fbb8]
- Updated dependencies [217ba78]
- Updated dependencies [cde492d]
- Updated dependencies [eee4149]
- Updated dependencies [f3a52d3]
- Updated dependencies [d59a1eb]
- Updated dependencies [af3451b]
- Updated dependencies [3a27208]
- Updated dependencies [0c666c3]
- Updated dependencies [38717d3]
- Updated dependencies [ac890f5]
- Updated dependencies [aa57c76]
- Updated dependencies [fc869c2]
- Updated dependencies [fef212b]
- Updated dependencies [dc51811]
- Updated dependencies [b77c160]
- Updated dependencies [09720e2]
- Updated dependencies [25fea77]
- Updated dependencies [3da9a4c]
- Updated dependencies [4be9734]
- Updated dependencies [bb86ff9]
- Updated dependencies [2046d21]
- Updated dependencies [fd749a4]
- Updated dependencies [d9d42d4]
- Updated dependencies [9d939c5]
- Updated dependencies [25e1c1a]
- Updated dependencies [47226e6]
- Updated dependencies [c7d1367]
- Updated dependencies [f5aaa0b]
- Updated dependencies [0005fec]
- Updated dependencies [2d6402c]
- Updated dependencies [77c203a]
- Updated dependencies [8293c74]
- Updated dependencies [29702d5]
- Updated dependencies [a839020]
- Updated dependencies [a7b8876]
- Updated dependencies [f7afab8]
- Updated dependencies [4dde0ae]
- Updated dependencies [590724f]
- Updated dependencies [38d416f]
- Updated dependencies [d2e2f6f]
- Updated dependencies [d5f3bc5]
- Updated dependencies [e3948ae]
- Updated dependencies [b55d6ab]
- Updated dependencies [1c5cee6]
- Updated dependencies [aad1603]
- Updated dependencies [7145bf3]
- Updated dependencies [55d9dd4]
- Updated dependencies [af8aab1]
- Updated dependencies [a59d00a]
- Updated dependencies [4bf9a2d]
- Updated dependencies [0c9aa82]
- Updated dependencies [49c8568]
- Updated dependencies [4564d6f]
- Updated dependencies [f2ea193]
- Updated dependencies [badf24d]
- Updated dependencies [5268f50]
- Updated dependencies [a30c4f4]
- Updated dependencies [0cba0ce]
- Updated dependencies [c893b3d]
- Updated dependencies [677d542]
- Updated dependencies [9bdeed2]
- Updated dependencies [3479c33]
- Updated dependencies [000a4c0]
- Updated dependencies [f4d9c09]
- Updated dependencies [c77dd17]
- Updated dependencies [ebe0a98]
- Updated dependencies [9038187]
- Updated dependencies [f108e6d]
- Updated dependencies [5cb7d7e]
- Updated dependencies [468e0c1]
- Updated dependencies [6106b73]
- Updated dependencies [0f920b9]
- Updated dependencies [33bc8ae]
- Updated dependencies [a1afbb9]
- Updated dependencies [150f740]
- Updated dependencies [42eb126]
- Updated dependencies [8cf1fd0]
- Updated dependencies [a5cb4f1]
- Updated dependencies [3c1eb63]
- Updated dependencies [d57be87]
- Updated dependencies [5d4f2aa]
- Updated dependencies [f4cd4ec]
- Updated dependencies [eca7cd2]
- Updated dependencies [cf4b9bf]
- Updated dependencies [e1dac19]
- Updated dependencies [21510bb]
- Updated dependencies [0fd363d]
- Updated dependencies [5210acf]
- Updated dependencies [d6b88f1]
- Updated dependencies [4123865]
- Updated dependencies [6ffe37e]
- Updated dependencies [63a470a]
  - @objectstack/spec@18.4.0
  - @objectstack/core@18.4.0
