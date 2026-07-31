---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

Discovery stops telling Cloud/Enterprise deployments that nothing implements `ai` (#4093 follow-up).

`CORE_SERVICE_PROVIDER` recorded `null` for `ai` because no **workspace** package provides it, and `serviceUnavailableMessage('ai')` therefore produced *"No implementation ships for the 'ai' slot"*. That is false: `@objectstack/service-ai` registers the slot in `objectstack-ai/cloud`. The table conflated "not in this repository" with "does not exist" — the same class of wrong answer the table was introduced to end, one step further out.

Verified against the cloud repository rather than inferred: `packages/service-ai/src/plugin.ts` calls `ctx.registerService('ai', …)`, and the package is `private: true`, so there is genuinely nothing to install — which is why `null` stays right and an `Install X` sentence would still be wrong. `search`, `workflow` and `graphql` were checked the same way and nothing registers them in either repository, so their `null` and their "nothing ships" sentence are accurate.

`ai` now carries a `REMEDY_DETAIL` sentence — *"Provided by @objectstack/service-ai in ObjectStack Cloud/Enterprise — no implementation ships in the open framework"* — the mechanism `ui` already used. Both discovery (`services.ai.message`) and the `/ai` 501 body report it.

This **removes** code: `/ai`'s domain had a local message override, added because the shared sentence was wrong there. Correcting the table fixed the domain *and* discovery, which the override could never reach, so the override and `capabilityUnavailable`'s `message?` parameter are both gone. A slot whose sentence is wrong needs the table corrected, not a local exception.

Also corrected: three places still describing `/ai`'s absent-service answer as a 404 (`docs/api/client-sdk.mdx`, `docs/releases/v17.mdx`, and a comment in `packages/client`'s URL-conformance test) — stale since that answer became 501.

FROM → TO: `services.ai.message` and the `/ai/*` 501 body change text. Nothing branches on either — `status` and `enabled` are the contract, the message is prose for humans and agents.
