---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
"@objectstack/client": patch
---

feat(spec,client): declare the publish door's response — `PublishMetaItemResponseSchema` (#7294)

`POST /api/v1/meta/:type/:name/publish` has been served since long before this
change, and had no contract behind it: the string `PublishMetaItem` appeared
nowhere under `packages/spec/src/`, and the endpoint was absent from
`plugin-rest-api.zod.ts`'s metadata table. So `version` on the publish response
sat in exactly the state `version` on the *save* response sat in before #5745 —
the ADR-0008 optimistic-concurrency token, the value a caller echoes back as
`If-Match` to get a 409 instead of a lost update, riding a public wire surface
with nothing declaring it. `PublishMetaItemResponse` could not be named at the
type level either, which is why `client.metadata.publishItem()` resolved to
`any`.

This carries the #5745 "declared = returned" discipline one door over, with the
same three artifacts the save door has:

- **`PublishMetaItemResponseSchema`** declares the FULL measured body —
  `success` / `version` / `seq` required, `message` and the three conditional
  side-effect receipts (`seedApplied` / `materializeApplied` /
  `projectionApplied`) optional. Optionality is measured, not assumed: the sole
  producer's single response literal always sets the first three, and attaches
  each receipt only when the matching side effect ran, so an absent receipt
  means "that side effect did not run", never "it failed".
- **The endpoint declaration**, so the catalog names the route it serves and
  points at the schema. No `requestSchema`: the body's only read key is
  `message`, taken only when already a string, so the route cannot 400 a
  malformed body and declaring one would advertise a gate that does not run.
- **A producer-side conformance gate**
  (`publish-meta-response-conformance.test.ts`), driving a real
  `publishMetaItem` against a real ObjectQL engine through the schema across
  the plain shape and every receipt path. A field added to the response, or
  dropped from the schema, now turns that red instead of silently vanishing at
  parse.

`client.metadata.publishItem()` is typed `Promise<PublishMetaItemResponse>` and
the type is re-exported, matching `saveItem` / `SaveMetaItemResponse`.

Also fixes a declared-≠-returned gap one layer down: `publishMetaItem`'s own
`Promise<...>` annotation omitted `projectionApplied` while the implementation
assigned it, so the method's type denied a key its callers were receiving.

No behavior change — nothing about the response body moved. This declares what
was already on the wire.
