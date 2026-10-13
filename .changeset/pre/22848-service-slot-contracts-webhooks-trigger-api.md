---
"@objectstack/spec": minor
---

feat(spec): `ServiceSlotContracts` types the `webhooks` and `trigger-api` slots

Clause-②: yes (widening)

`ServiceSlotContracts` (from `@objectstack/spec/contracts`) gains two entries:

- `webhooks: IWebhookService`. `@objectstack/plugin-webhooks` registers this slot with a service typed as `IWebhookService`.
- `'trigger-api': ITriggerApiService`. `@objectstack/trigger-api` registers this slot with a service typed as `ITriggerApiService`.

FROM → TO:

- `ServiceSlotContract<'webhooks'>` goes from `unknown` to `IWebhookService`, and `ServiceSlotContract<'trigger-api'>` goes from `unknown` to `ITriggerApiService`.
- A lookup keyed by `keyof ServiceSlotContracts` now accepts both names. One example is the runtime dispatcher's `resolveService` / `getRequestKernelService`, which used to answer `any` for them. It now answers the contract or `undefined`. So `resolveService(ctx, 'webhooks')` resolves to `IWebhookService | undefined`, and `?.handleRedeliver` has the declared member's type. The same holds for `'trigger-api'` and `?.handleInboundHook`.

Every member of both contracts is optional, so a reader still checks that the member it calls is present. No other slot's entry changes, and nothing changes at runtime: this is type information only.

Nobody needs to migrate. Existing casts at those lookups still compile. If you build an object typed as the whole `ServiceSlotContracts` map, it must now carry the two new keys. This repository and the pinned objectui checkout build no such object.
