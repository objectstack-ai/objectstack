---
"@objectstack/client": minor
---

feat(client): `meta.saveItem` can send the `If-Match` OCC header it already told callers to send (#11713)

`saveItem`'s own docstring has always named the ADR-0008 optimistic-concurrency
protocol: the resolved `version` is the token, echo it back as the `If-Match`
request header on the next write to the same item, and a concurrent edit is
reported as `409 METADATA_CONFLICT` instead of silently overwriting. Both REST
`PUT` doors read `if-match` and thread it as `parentVersion`, so that sentence
was true of a raw-HTTP caller. It was **false** of a first-party SDK caller:
neither `saveItem` declaration accepted a header, an `ifMatch`, or anything
that became one — so an SDK caller who did exactly what the docstring said had
nowhere to put the token and their concurrent edit overwrote anyway, answered
`200`. Declared, not enforced, with no signal at the call site.

**What is new:** `ifMatch?: string` joins the `SaveMetaItemOptions` bag that
`#11391` landed, on **both** `saveItem` declarations — the unscoped
`ObjectStackClient.meta` and the environment-scoped
`ScopedProjectClient.meta` — wired to the `If-Match` request header through a
single shared builder, the same way the three query parameters go through one
shared query builder. The twins cannot drift.

```ts
const saved = await client.meta.saveItem('object', 'customer', doc);
// …later, guarded against a concurrent edit:
await client.meta.saveItem('object', 'customer', next, { ifMatch: saved.version });
// a stale token now answers 409 METADATA_CONFLICT instead of overwriting
```

Purely additive and opt-in. Only a non-empty token reaches the wire:
`undefined` and `''` both omit the header entirely — the `init` handed to
`fetch` carries no `headers` key at all — so every existing call is
byte-identical and last-write-wins remains the default, on the wire and on the
door. Unlike the bag's `mode`, `ifMatch` reaches **both** save doors: the
compound-name twin `PUT /meta/:type/:section/:name` reads `if-match` and strips
ETag-style quotes exactly as the single-segment door does.

Aligned deliberately with the other first-party client: the same member name,
the same header, and the same truthy guard as `MetadataClient.save` in
`@object-ui/data-objectstack` — two first-party clients, one behaviour.
