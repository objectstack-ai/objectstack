---
"@objectstack/spec": minor
---

**`envelopeViolations` — the conformance check `BaseResponseSchema` cannot express.**

Every conformance suite from the #3843 line leads with
`BaseResponseSchema.safeParse(body)`, under a comment claiming it is "the contract
itself, imported — not a restatement of it". That overclaimed, and the gap is
demonstrable:

```ts
BaseResponseSchema.safeParse({ success: true })                        // passes
BaseResponseSchema.safeParse({ success: true, data: link, link })      // passes
```

The schema declares no `data` — each response type adds its own via
`.extend({ data })` — and a plain `z.object` strips unknown keys rather than
rejecting them. So it catches the one drift it was added for (a missing or
non-boolean `success`, the flag `unwrapResponse` keys on) and nothing else. The
second body above is exactly the duplicate-payload drift `/share-links` shipped
until #4038 / #4049 removed it, and `safeParse` passed it the whole time.

`envelopeViolations(body)` returns every departure from the declared envelope as
readable reasons, empty when conformant:

- `success` must be a **boolean**
- a success body must carry `data` (`undefined` only — `null`, `[]`, `{}`, `0`
  and `''` are payloads, not absences)
- a failure body must carry `error` with a string `code` and `message` — the
  nested form, not the pre-#3675 bare string
- no top-level key outside `success` / `data` / `error` / `meta`, which is the
  general form of the duplicate-payload drift

It deliberately does **not** check the shape of `data`: that is each route's own
payload schema, and conflating the two is what let `SettingsNamespacePayload`
describe a whole body before #3843 and only `data` after it.

The ten conformance suites now assert it beside `safeParse`, and their comments
say what each of the two actually proves. Reintroducing the `/share-links`
duplicate key is caught by the new assertion and still passes the old one — which
is the demonstration that the pairing is the point.

Placed in `contract.zod.ts` beside the schema it completes, alongside the other
plain predicates `spec/api` already exports (`standardErrorCodeForHttpStatus`,
`readServiceSelfInfo`). No new package.
