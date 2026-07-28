---
"@objectstack/spec": patch
"@objectstack/service-storage": patch
"@objectstack/client": patch
---

fix(service-storage): emit the declared success envelope on all eight routes (#3689)

#3675 moved the **error** bodies of the autonomously-mounted `/api/v1/storage/*`
routes into the declared `{ success: false, error: { code, message } }`
envelope and deliberately stopped there: unlike the errors, the success bodies
were not an additive fix. They were three shapes, none of them carrying the
`success` flag `BaseResponseSchema` declares and
`ObjectStackClient.unwrapResponse` keys on —

| Route(s) | Was | Now |
|---|---|---|
| the six upload routes (`/upload/presigned`, `/upload/complete`, `/upload/chunked`, `…/chunk/:i`, `…/complete`, `…/progress`) | `{ data: {…} }` | `{ success: true, data: {…} }` |
| `GET /files/:fileId/url` | `{ url }` | `{ success: true, data: { url } }` |
| `PUT /_local/raw/:token` | `{ ok: true, key }` | `{ success: true, data: { key } }` |

— while `storage.zod.ts` declared every one of them as
`BaseResponseSchema.extend({ data })`, and `PresignedUrlResponse` and friends
are `z.infer`red from those schemas and published as the SDK's return types.
The declaration said `success: boolean`; the wire said nothing. It broke
nothing only because the storage SDK methods returned `res.json()` raw —
`any`, so TypeScript could not see the gap and nothing relied on the
declaration. That is the posture i18n was in before #3636, right up until
something did rely on it.

**The payload moved on two routes, and that is the breaking part.** A direct
HTTP caller reading `body.url` from `GET /files/:fileId/url` must now read
`body.data.url`; one reading `body.ok`/`body.key` from the local adapter's
`PUT /_local/raw/:token` loopback must read `body.success`/`body.data.key`.
`ok` is dropped rather than kept beside `success` — it was a second, private
word for the same thing. The six upload routes are additive: callers already
destructure `.data`, and a new sibling key changes nothing.

Every in-repo consumer was fixed first, so the two repos are not coupled by
merge order:

- `client.storage.getDownloadUrl()` now reads through `unwrapResponse`, the
  SDK's one standard envelope seam — which strips the envelope when present
  and returns the body untouched when not, so a client either side of this
  server change resolves the same URL. The other storage methods hand back the
  whole envelope by design and were already correct.
- The console's two attachment openers (`RecordAttachmentsPanel`,
  `ApprovalsInboxPage`) already read `body?.url ?? body?.data?.url`; objectui
  gains tests pinning that tolerance as deliberate.

Two schemas that were missing are now declared — `FileDownloadUrlResponse` and
`RawUploadResponse` — and `getDownloadUrl` joins `StorageApiContracts`, which
it had never been in. That absence is how its shape drifted outside the
envelope unnoticed. The two `_local/raw/:token` routes stay out of the
registry on purpose: they are the local adapter's own presign loopback,
ledgered `server-only` and addressed as an opaque signed URL rather than as an
API.

`success-envelope.conformance.test.ts` holds the new shape in place the way
`error-envelope.conformance.test.ts` holds the error one: every route is
driven and its body parsed against the **declared schema** it answers to — not
a restatement — the retired shapes are asserted dead, and the module source is
scanned so a new route cannot bypass the `sendOk` helper. As with #3675, the
route ledgers cannot catch this class of drift: they audit which routes exist
and whether the SDK can address them, not what comes back.
