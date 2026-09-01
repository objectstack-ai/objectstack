---
"@objectstack/rest": minor
---

fix(rest): every `/data` exit and the approvals door now hand the caller the human half of a declared-code-prefixed message (#13095)

The 2026-08-29 ruling on #12975 made the by-id `/data` door strip the
ADR-0111 `CODE:` prefix from the human-readable `error` string — one
envelope semantics: `error` is human language, `code` is the machine token.
`resolveErrorResponse`'s declared-4xx `passThroughStatus` arm is a second
declared-4xx arm the ruling did not name, checked BEFORE the door it
delegates to — so the same refusal read two ways depending on which route
caught it: `PATCH /data/:object/:id` answered the bare localized sentence
while `POST /data/:object/batch` (and every bulk/clone exit reporting
through `handleRouteError`) and the record-share classified arm still
shipped `FORBIDDEN: <sentence>`. Maintainer ruling 2026-08-31 (option 1):
converge them.

On-wire changes, all subtractive on message text only, all 4xx, statuses
and `code`/`declaredCode` fields untouched:

- `resolveErrorResponse`'s declared-4xx arm now applies the same
  declared-code-anchored strip (`withoutDeclaredCodePrefix`) the by-id door
  applies: a message opening with the producer's own declared `code`
  followed by a colon loses that prefix — and only that prefix. A message
  that is nothing but the prefix degrades to `Request failed`. This
  converges the `/data` batch/createMany/updateMany/deleteMany/clone exits
  and — because the record-share classified arm re-dresses the same
  classification — `GET/POST/DELETE /data/:object/:id/shares*` with them.
- The approvals door's prefix strip is now anchored to the code the row
  answers instead of the blanket `/^[A-Z_]+:\s*/` regex (the shape #12975
  rejected): a sentence opening with a DIFFERENT `SCREAMING_SNAKE:` token
  than the answered code is no longer eaten.

Not moved, deliberately: a declared 4xx with NO `code` keeps its message
verbatim (the token is nowhere else on the wire); a prefix that does not
restate the declared code is left alone; declared-5xx prose withholding is
unchanged; the share family's bare-`Error` prefix-idiom arm already
stripped and is untouched; an empty-string message through the passthrough
still ships as itself (that TYPE-keyed degrade is a standing pin this
ruling did not move).

**Migration.** Consumers that parsed the `CODE:` prefix off the front of
`error` (flat `/data` doors) or `error.message` (nested record-share
envelope) on these routes must read the `code` field instead — it has
carried the same token all along, with unregistered spellings demoted to
the `declaredCode` sibling (#9232). A cross-repo census (objectstack,
objectui, hotcrm; re-run 2026-09-01) found zero consumers branching on the
prefix; per #13347's precedent an error-envelope shape change ships as
`minor` with this note.
