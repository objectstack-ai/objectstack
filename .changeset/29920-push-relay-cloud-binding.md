---
'@objectstack/service-push': patch
'@objectstack/cloud-connection': patch
'@objectstack/service-messaging': patch
'@objectstack/spec': patch
'@objectstack/core': patch
---

feat(service-push)!: push sends through the hosted push relay, authenticated by the server's cloud binding

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

- FROM `PUSH_RELAY_NOT_SERVED_MESSAGE` (`@objectstack/service-push`) TO `PUSH_RELAY_AIR_GAPPED_MESSAGE`: the relay is no longer refused for being unserved, only on a deployment that declared it has no control plane. A test that matched the old text matches the new constant, or asserts that the relay boots.
- FROM a relay payload `data` with extra keys (stripped) TO refused: send only `notificationId`, `route` and `origin` in `data`; a content key such as `title` is refused with the ID-only guidance.
- FROM a `RATE_LIMIT_EXCEEDED` relay error with any `retryable` TO `retryable: true` (the default when absent): a relay that answered `retryable: false` on a rate limit answers `true` or leaves it out.
