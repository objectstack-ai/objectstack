---
"@objectstack/spec": patch
---

docs(spec,i18n): `GET /i18n/locales` stops declaring `label` a display name

`GetLocalesResponseSchema` described each locale descriptor's `label` as
"Display name of the locale", and no producer has ever written one. The sole
producer is `toLocaleDescriptors` (`system/i18n-resolver.ts`) — deliberately
shared by the runtime dispatcher's `/i18n` domain and `service-i18n`'s
autonomous route, so there is no second implementation to diverge — and it sets
`label` to the code. `GET /api/v1/i18n/locales` answers `{ code: 'th', label:
'th' }`, never `{ code: 'th', label: 'ไทย' }`. Declared not enforced (ADR-0049),
one field wide, and the describe is what carries the claim into the generated
JSON Schema, the OpenAPI surface and the SDK type — so a client that trusts it
renders locale codes at users and only finds out by looking. objectui#4039 hit
exactly that and routed around the field: the console's language menu reads
`code` alone off this body and names locales from its own built-in table plus
`Intl.DisplayNames`.

Patch, and describe-only. The measurement behind that: **no consumer anywhere
reads `label`**. In this repo every read of the body takes `code` or
`isDefault` (`http-dispatcher.test.ts`, `domain-handler-registry.test.ts`,
`i18n-success-envelope.conformance.test.ts`); the one wire fixture that spells
`label` sets it to the code and asserts only the array length. In objectui the
one real consumer, `apps/console/src/loadLocales.ts`, reads `entry?.code` and
documents in its header that the descriptor's label is not a display name. With
nothing consuming the field, the honest declaration is the whole fix: the
runtime behaviour is unchanged, and only the field's documented meaning moves.

So the declaration now states the convention it ships — `label` equals `code`;
naming a locale for a UI is the client's job, where `Intl.DisplayNames` already
lives and where the choice of *which* language to name it in belongs. The two
alternatives are deliberately not taken here: serving real display names is a
capability addition with no measured pull (CLDR data on the server for
something every client can compute), and retiring the field is a heavier
response-contract action. Both stay open on #7634.

`toLocaleDescriptors`' output and the declaration are now pinned against each
other in `i18n-resolver.test.ts`, on both sides — a producer that starts
inventing display names and a describe that starts promising them each turn it
red separately.
