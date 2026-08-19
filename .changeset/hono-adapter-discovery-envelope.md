---
"@objectstack/hono": minor
---

feat(adapters): the hono adapter's two discovery bodies join the response envelope (#9436)

<!-- adr-0087: not-required (no-migration-prescription) Additive wire change:
`GET {prefix}` and `GET {prefix}/discovery` gain `success: true` beside the
existing `data` key — nothing authorable and no key is renamed, retired or
removed, so there is no conversion to register. Every measured reader
(`@objectstack/client` `connect()`'s `body.data || body`, the QA http-adapter's
`'routes' in body` discriminator, objectui's `typeof body.success === 'boolean'
&& 'data' in body` unwrap) resolves the new shape to the same document. -->

`GET {prefix}` and `GET {prefix}/discovery` answered `{ data: <discovery> }`
with no `success` flag — one key short of the declared `BaseResponseSchema`
envelope. They now answer `{ success: true, data: <discovery> }`.

Maintainer ruling on #9436 (2026-08-18, option A), deliberately not inheriting
#9389's pre-auth exemption: these bodies are read by SDKs, codegen and AI
clients — the envelope's core constituency — rather than by our own shells,
and the migration is one key. Readers that unwrapped `body.data` keep working
unchanged; envelope-aware readers that discriminate on `success` now unwrap
this mount correctly.
