---
"@objectstack/cli": patch
---

`os package publish` now prints the reason a publish was refused instead of the
literal `[object Object]` (#10763).

Both request helpers in `package/publish.ts` built their failure text the same
way:

```ts
const errMsg = parsed?.error ?? response.statusText ?? `HTTP ${response.status}`;
return { ok: false, status: response.status, body: parsed, error: String(errMsg) };
```

In the declared envelope `error` is an **object** — `{ code, message }` — so
`String(errMsg)` stringified the object. The `??` chain never reached
`statusText`, because an object is not nullish; there was no useful fallback to
reach. Every failed publish printed the same seven characters no matter what the
control plane had refused, at all three call sites: package registration,
version publish, and the icon upload.

Both sites now read through a new `readErrorMessage` in
`packages/cli/src/utils/response-envelope.ts`, which returns the declared
envelope's `error.message`, degrades to `error.code` when a refusal carries no
message, and falls back to a non-blank `statusText` and then the status line. A
blank `statusText` counts as absent — HTTP/2 carries no reason phrase, and the
old `??` chain kept the empty string and printed nothing after the status code.

The reader also accepts the flat `error: '<sentence>'` shape, deliberately and
temporarily. That is a **measured** property of these routes rather than an
assumption: `/api/v1/cloud/**` is served by the sibling `cloud` repo, and the
closest first-hand reader of that same `service-cloud` family — objectui's
`readApiError` — records that it answers failures in both shapes while cloud#944
converts it. A strict envelope-only read (the `readEnvelope` landed by #10675
for the in-repo `/api/v1/datasources/**` routes) would have replaced today's
live flat dialect with a different unreadable failure, so it is not reused here;
the reasoning, and the condition under which the flat branch is deleted, are
recorded on the function.

No request the CLI sends changes, and the server sends exactly what it sent
before — this is only how a failure is read and shown.
