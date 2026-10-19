---
'@objectstack/client': patch
'@objectstack/platform-objects': patch
---

Clause-②: no

fix(client,platform-objects): the `ai.models()` TSDoc and the translated permission-set `packageId` help say "this system", as the spec now does

- **What changed.** Inside the running system, published copy names the system the reader is in as "this system", and a permission set made here, not shipped by a package, is "authored in this system". `@objectstack/spec` already says both (`AiModelsResponse.models`, the permission set's `packageId` help text); this follows it in two more places.
  - The TSDoc of `client.ai.models()` now reads "Models this system offers in the chat model picker (cloud ADR-0028)". The citation is qualified as `cloud ADR-0028`: the AI service that serves this list is a cloud package, and this repository's ADR-0028 is about metadata naming.
  - The zh-CN, ja-JP and es-ES values of the permission set's `packageId` help text in the Setup forms bundle now say 本系统 / このシステム / este sistema where they said 本环境 / この環境 / este entorno, matching the English text "Leave empty for a set authored in this system."
- **Unchanged.** Every method, route, type, form field, key and behaviour. No translation key is added or removed.
