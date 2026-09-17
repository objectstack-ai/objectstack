---
'@objectstack/client': patch
---

`organizations.getActiveMember`'s own prose says what an anonymous caller gets TODAY: `401 UNAUTHENTICATED` on request ONE — not `200 null` and then a `401 UNAUTHORIZED` from `list-members`

objectstack#17881 (`374d9d3afa`) landed `plugin-auth`'s
`refuseAnonymousSession`, which converts better-auth's `200` + the literal JSON
`null` on `GET /api/v1/auth/get-session` into the declared ADR-0112 refusal
envelope — HTTP `401`, `code: UNAUTHENTICATED` — before it leaves the process.
`@objectstack/client` reaches the server over the wire, so that is what it
sees. Three present-tense statements in and around `getActiveMember` still
described the retired shape, and they were wrong on two axes at once: the CODE
(`UNAUTHORIZED` vs `UNAUTHENTICATED`) and the REQUEST the refusal arrives on
(the second one, `list-members`, vs the first, `/get-session` itself).

**FROM → TO for a caller.** `getActiveMember` makes two requests for a
signed-in caller. For an anonymous one it now makes ONE, and rejects:

| you wrote | write instead |
|:--|:--|
| `try { await c.organizations.getActiveMember(id) } catch (e) { if (e.code === 'UNAUTHORIZED') … }` | `… catch (e) { if (e.code === 'UNAUTHENTICATED') … }` |

The behaviour is objectstack#17881's and shipped then; what moves here is only
the SDK's description of it. A reader coding against the old prose caught the
wrong code, and expected the refusal on a request that is never put on the
wire.

**What changed**

- Step 1 of the two-request list no longer says `/get-session` serves "the
  literal `null` for an anonymous one". The signed-in arm keeps its
  `(measured)` tag, which is still the 2026-09-09 drive's; the anonymous
  answer is stated separately and anchored to the producer, including that
  step 2 never reaches the wire.
- The anonymous bullet of that drive's delta list no longer says an anonymous
  caller "still gets `401 UNAUTHORIZED`, thrown from the `list-members`
  request". It is RE-ANCHORED rather than restamped — the drive's own row is
  kept in the past tense and today's answer is stated from the producer, the
  same disposition objectstack#18642 used on this family's sibling statements.
- The inline comment on the `userId` read no longer says `Anonymous → null`.
  It says an anonymous caller never reaches that line, and says why the
  `| null` annotation and the `?? ''` fallback stay as the defensive branch
  they always were.

⛔ No behaviour changes. `packages/client/src/index.ts` changes COMMENTS ONLY —
verified mechanically: of every line the diff touches in that file, zero are
outside a comment.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/client`'s published `files[]` is
`["dist","README.md","CHANGELOG.md"]` and `getActiveMember` is a member of the
exported `ObjectStackClient`, so its TSDoc is emitted into the shipped
artifacts. Measured on the built `dist` at `13e09a5e3c`: the corrected sentence
is present exactly once in `dist/index.d.ts`, `dist/index.d.mts`,
`dist/index.js` and `dist/index.mjs`; the retired sentence is absent from all
four; and `getActiveMember` was carried as the lit control, found in every one
of them. ⚠️ This package emits no `.d.cts` and no `.cjs` — its CJS pair is
`index.js` + `index.d.ts` and its ESM pair is `index.mjs` + `index.d.mts`, so
a `*.d.cts` check here would have measured an absent file.

Clause-②: no — no schema key moves, no closed set gains or loses a member, no
published export changes and no registry row is touched. `UNAUTHENTICATED` is
an existing `StandardErrorCode` that objectstack#17881 already derives through
`standardErrorCodeForHttpStatus(401)`; nothing is minted here. The direction is
a pull-back: the runtime has answered `401` since objectstack#17881 and the
SDK's self-description was lagging.
