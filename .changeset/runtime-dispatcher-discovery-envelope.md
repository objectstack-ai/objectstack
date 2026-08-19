---
"@objectstack/runtime": minor
---

feat(runtime): the dispatcher's two discovery bodies join the response envelope (#9813)

<!-- adr-0087: not-required (no-migration-prescription) Additive wire change:
`GET /.well-known/objectstack` (always dispatcher-owned) and the REST-less
fallback `GET {prefix}/discovery` gain `success: true` beside the existing
`data` key — nothing authorable and no key is renamed, retired or removed, so
there is no conversion to register. Every measured reader (`@objectstack/client`
`connect()`'s `body.data || body`, the QA http-adapter's `'routes' in body`
discriminator, objectui's `typeof body.success === 'boolean' && 'data' in body`
unwrap) resolves the new shape to the same document. -->

`GET /.well-known/objectstack` and the REST-less fallback `GET {prefix}/discovery`
answered `{ data: {discovery} }` with no `success` flag — one key short of the
declared `BaseResponseSchema` envelope. They now answer
`{ success: true, data: {discovery} }`.

This inherits the #9436 maintainer ruling (2026-08-18, option A) on the hono
adapter's identical discovery bodies, with its reason intact: machine-read
discovery surfaces — SDK `connect()` fallback probes, codegen, AI clients — are
the envelope's core constituency, and the migration is one additive key. It is
deliberately not #9389's pre-auth exemption, which is a closed list of SPA-read
shell-bootstrap surfaces these bodies are not on. Readers that unwrapped
`body.data` keep working unchanged; envelope-aware readers that discriminate on
`success` now unwrap these routes correctly.
