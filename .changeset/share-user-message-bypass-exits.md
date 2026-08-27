---
"@objectstack/rest": patch
---

fix(rest): the record-share family carries a producer-marked `userMessage` on its two non-classified exits (#12693)

`respondSharingError` learned to carry the producer's caller-facing sentence at
its classified re-dress (#12669 fork (a)). The family has **two other exits**
that never reach that classification and still dropped it:

- the **500 fault terminal** (`SHARES_LIST_FAILED` / `SHARE_GRANT_FAILED` /
  `SHARE_REVOKE_FAILED`) — `classifiedRefusalAnswer` deliberately hands a
  declared or resolved 5xx back to "the catching route's own terminal", so a
  marked fault never had a classification to ride;
- the **ADR-0111 message-prefix arm** — it runs precisely when the
  classification answered nothing.

Measured on `15bf9e859` before the repair, one marked producer per exit driven
through the real routes on both doors:

```text
throw { code: 'SHARE_STORE_DOWN', status: 503, userMessage: '…' }
  share door : 500 SHARES_LIST_FAILED    — no mark
  /data door : 503 SERVICE_UNAVAILABLE   — mark carried
throw Error('NOT_FOUND: no such record …') + userMessage
  share door : 404 NOT_FOUND             — no mark
  /data door : 500 INTERNAL_ERROR        — mark carried
```

Nothing invalid shipped — every body parsed as `ApiErrorSchema` — which is what
made the loss silent and one-directional: a console told by ADR-0112 to render
`userMessage` verbatim found nothing at these two exits and fell back to its
generic substitution, for the same throw the twin door rendered.

Neither exit holds a `refusal.body`, so the classified arm's expression is not
reusable at either. `error-response.ts` now exports
`boundedDeclaredUserMessage` — `declaredUserMessage`'s presence answer with
#5423's bound applied, lifted out of the private `withDeclaredUserMessage`
wrapper so a caller with no body to merge into can ask the same rule rather
than open-code it. The flat `/data` door is unchanged and goes on calling it
through that wrapper.

⛔ Only the mark is added. Every existing key keeps its value and position at
both doors (measured: 32 route/door answers before and after, 0 statuses moved,
0 existing keys moved or changed, 24 gaining exactly `userMessage`). The three
deliberate share-vs-`/data` differences visible in the same measurement stay
exactly as they are — the family still folds a declared `503` into its own
`500`, still interpolates the caught message where `/data` withholds 5xx prose
per #5437, and `/data` is still not taught this service's local prefix idiom.

No in-tree producer sets `userMessage` at this seam today
(`plugin-sharing` = 0 hits; positive control `throw ` = 25 files), so this
wires a declared channel rather than repairing a live loss.
