---
"@objectstack/rest": patch
---

fix(rest): the bulk / metadata / UI error door consults the bespoke structured arms BEFORE its declared-status passthrough (#14541)

**Response-body change on published bulk doors.** One refusal used to produce
two different bodies depending on which route caught it. `resolveErrorResponse`
— the door behind `handleRouteError` / `sendThrownError`, used by `createMany`,
`updateMany`, `deleteMany`, `batch`, `clone`, the import/export routes and the
metadata / UI families — took its own declared-status passthrough BEFORE
delegating to `mapDataError`, which the single-record `/data` routes call
directly. An engine envelope that DECLARES `status` therefore short-circuited,
and every bespoke structured arm behind the delegation was unreachable from
those routes.

The project had already ruled on this exact shape, for one code:

> [#3770] `OBJECT_NOT_FOUND` is deliberately excluded from this
> status-passthrough: `mapDataError` owns its canonical envelope, and
> short-circuiting here would ship a second wire code for the same condition
> depending on which route caught it.

That exclusion never grew past its first case. This change generalises the
ruling instead of adding a second exclusion: the structured arms are lifted
into one `structuredCodeAnswer` classification that BOTH doors ask first, and
the bulk door answers a match by delegating to `mapDataError`, so the two
bodies are identical by construction rather than by coincidence.

**What callers on the bulk doors see change** — measured door-to-door, in
process, against the real producer shapes:

| producer (declares) | before, bulk door | after, bulk door |
| :-- | :-- | :-- |
| engine `DELETE_RESTRICTED` (409) | `{error, code}` | `+ developerMessage, dependentObject, dependentCount, object` |
| `ConcurrentUpdateError` (409) | `{error, code}` | `+ currentVersion, currentRecord, object` |
| `DuplicateRecordError` (409) | `{error: the engine's sentence, code: "DUPLICATE_RECORD"}` | `{error: the curated sentence, code: "UNIQUE_VIOLATION", developerMessage, field, object}` |
| `FEEDS_DISABLED` / `FILES_DISABLED` (403) | `{error, code}` | `+ object` |
| `ATTACHMENT_PARENT_ACCESS` / `ATTACHMENT_DELETE_DENIED` / `RECORD_NOT_ACCESSIBLE` (403) | `{error, code}` | `+ object` |
| engine `INVALID_FIELD` (400) | `{error, code}` | `+ field, object` |

In every row the STATUS is unchanged — the doors already agreed on it — and no
key is removed. The added keys are the ones the single-record `/data` door has
always shipped for the same refusal, and all of them are already declared on
`ApiErrorSchema`.

**One `code` VALUE changes, and it is a restoration.** On the bulk doors an
insert/update unique conflict answered `code: "UNIQUE_VIOLATION"` until #14095
wrapped the driver error in `DuplicateRecordError`: the raw driver error
declared no `status`, so it fell through to `mapDataError`'s
`isUniqueViolationError` arm. The envelope DOES declare one, so from #14095 the
bulk doors started answering the engine spelling `DUPLICATE_RECORD` while the
single-record door kept `UNIQUE_VIOLATION` (#14389 restored that door
explicitly). This change puts `UNIQUE_VIOLATION` back on the bulk doors — the
spelling every consumer branching on this conflict already reads, and the one
the same doors answered before #14095. `DUPLICATE_RECORD` stays the in-process
code on the thrown envelope, exactly as each dialect's code always has.

**Three boundaries this deliberately does NOT cross:**

- **The passthrough's 5xx half is untouched.** A producer-declared 5xx still
  takes that arm, with the unconditional prose-drop intact (#5437 / #5582 /
  #5907). Fenced from the other side too: an arm that answers a 5xx
  (`ERR_DATASOURCE_UNAVAILABLE`'s 503) never displaces a status a producer
  declared in the 4xx band.
- **A sandboxed producer keeps the unwrap door's answer.** The arms ship
  `error.message`, which for a QuickJS body is the DEBUG WRAPPER #11588 exists
  to keep off this wire, so the consult declines an error carrying
  `innerMessage` and the passthrough's `sandboxBusinessMessage` read answers it
  as before.
- **`classifyDataError` is behaviour-identical.** The lifted arms are the same
  arms in the same order at the same position; the two that used to sit below
  the sandbox unwrap door (`OBJECT_NOT_FOUND`, `INVALID_FIELD`) carry that
  position as an explicit `!isSandboxOrigin` clause rather than losing it to
  the move.

**Unchanged:** `OBJECT_NOT_FOUND` (its #3770 exclusion already gave it door
parity, and its body is pinned byte-identical), `VALIDATION_FAILED` and
`ERR_DATASOURCE_UNAVAILABLE` (measured: their producers declare no `status`, so
the passthrough never fired for them), `PERMISSION_DENIED` (measured: its class
declares `statusCode`, not `status`, so it too already reached its arm — and its
third limb is a message-TEXT gate, which this ordering fix deliberately does not
lift above the passthrough), the statuses on every door, and the `#5423` 4xx
truncation and `#9934` `userMessage` channel, which apply exactly as before.

Both doors are now pinned against each other per producer, plus a drift guard
that fails when an arm is added to the shared classification without a parity
case — `error-response-structured-arm-door-parity.test.ts`.
