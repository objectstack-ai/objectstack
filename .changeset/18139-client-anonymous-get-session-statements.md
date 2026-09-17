---
'@objectstack/client': patch
---

`auth.me()` and the `/auth/*` wire table say what `/get-session` answers an anonymous caller TODAY: `401 UNAUTHENTICATED`, not `200 null`

objectstack#17881 (`374d9d3afa`) landed `plugin-auth`'s
`refuseAnonymousSession`, which converts better-auth's `200` + the literal JSON
`null` on `GET /api/v1/auth/get-session` into the declared ADR-0112 refusal
envelope — HTTP `401`, `code: UNAUTHENTICATED` — before it leaves the process.
`@objectstack/client` reaches the server over the wire, so that is exactly what
it sees. Three present-tense statements in the SDK still described the retired
shape, none of them carrying a rev or a date, so none of them read as history.

**FROM → TO for a caller.** An anonymous `auth.me()` no longer RESOLVES with
the literal `null`; it REJECTS. The SDK's shared `fetch` wrapper throws on the
non-2xx, so:

| you wrote | write instead |
|:--|:--|
| `const s = await client.auth.me(); if (s === null) …` | `try { await client.auth.me() } catch (e) { if (e.code === 'UNAUTHENTICATED') … }` |

That is the behaviour objectstack#17881 shipped; what moves here is only the
SDK's description of it. A reader coding against the old table wrote a `null`
branch that can never be taken and omitted the rejection branch that now fires.

**What changed**

- `normalizeSessionResponse`'s `/auth/*` transcript no longer lists the
  anonymous `200 null` row among the bodies that helper is handed — it is not
  handed that body at all, because the rejection happens one frame out. The
  current answer is stated separately, anchored to the producer.
- The closing `!body`-guard paragraph no longer claims that guard carries the
  anonymous answer, and no longer says closing the gap needs the published
  return annotation to widen. objectstack#17238 ruled the opposite: the
  producer moved and `SessionResponseSchema` is untouched.
- `auth.me()`'s docblock says the anonymous call rejects rather than resolving
  outside its declared type.

⛔ No behaviour changes. `SessionResponseSchema`, every published return
annotation and the `!body` guard's own code are byte-identical; only what the
SDK says about them moves.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/client`'s published `files[]` is
`["dist","README.md","CHANGELOG.md"]`, and `auth.me()` is a member of the
exported `ObjectStackClient`, so its TSDoc is emitted into the shipped
declarations — measured on the built artifact: the corrected sentence is
present in `dist/index.d.ts`, `dist/index.d.mts`, `dist/index.js` and
`dist/index.mjs`, the retired sentence is absent from `dist` afterwards, and
`getActiveMember` was carried as the lit control, found in the same four files.

Clause-②: no — no schema key moves, no accept set widens or narrows, no export
changes, and `ERROR_CODE_LEDGER` / `StandardErrorCode` are untouched
(`UNAUTHENTICATED` is an existing standard member that objectstack#17881
already derives via `standardErrorCodeForHttpStatus`). The direction is a
pull-back: the runtime already answers 401 and the SDK's self-description was
lagging.
