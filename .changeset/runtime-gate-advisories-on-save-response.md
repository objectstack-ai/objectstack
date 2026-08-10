---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,metadata-protocol): the runtime authoring gate's advisory findings reach the save response (#4717)

#4463 put the shared author-time rule registry on the runtime write path — the
fourth door, and for a Studio tenant or an MCP/AI author the ONLY one, because a
`sys_metadata` overlay row is not in the CLI's config file and there is no
`os lint` to run against it. It gated on `error` findings only. The rest — the
advisory half — were produced, walked into a `console.warn` deduped once per
process per `type|name|rule|path`, and then went out of scope. #4715 named that
honestly when it shipped: running a rule and discarding its conclusion is a
smaller version of the hole the gate was built to close.

That case is reachable today, not theoretical. A flow whose only defect is a
`delete_record` node declaring `multi: true` with no `filter` yields
`errors = 0 / advisories = 1`: the write **succeeds**, the row persists, the
flow registers, and the author never learns that their nightly sweep deletes
every row of the object on every run.

**What changed**

- `SaveMetaItemResponseSchema` declares an OPTIONAL `advisories` array, whose
  element is the newly-declared `RuntimeAuthoringIssueSchema` — the SAME
  `rule` / `path` / `where` / `message` / `hint` / `severity` shape the 422
  `invalid_metadata` envelope already carries (#4463 D3, "reuse the Zod
  envelope"). It is declared once: `@objectstack/metadata-protocol` re-exports
  it as its `RuntimeAuthoringIssue` instead of keeping a second hand-written
  interface for the same six keys, so the refusal and the success channel
  cannot drift into two dialects.
- `evaluateRuntimeAuthoringGate` returns a `RuntimeAuthoringVerdict`
  (`{ error, advisories }`) instead of `Error | null`. This is an ADDED return
  channel, not a threaded value: the success path previously returned `null` and
  had nowhere to put a verdict at all.
- `saveMetaItem` attaches the advisories to its success response.

**Additive and conditional.** The key is emitted ONLY when at least one advisory
was raised — never as `[]` — so a clean save's response bytes are byte-for-byte
what they were before, and a caller that ignores the field behaves exactly as
today. Absence means "nothing to report", never "the gate did not run".

**`rulesRun` is deliberately NOT on the response.** The gate appends its own
`PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING` when the type is `flow`, so not
every id it would list resolves in the lint registry; exposing the array would
need the declaration to say the ids are *gate* ids. A field can be added later,
not removed.

**⚠️ Save door only — the asymmetry is deliberate, not an oversight.** The gate
runs on BOTH write doors: `saveMetaItem` and the draft→active promotion, on
purpose, so `?mode=draft` followed by publish is not a bypass (#4463 D1).
Studio's designer uses draft-then-publish on every edit, so the publish door is
the dominant Studio flow and it does **not** carry this field yet. That door's
own response contract only just landed (#7294); carrying the advisories over is
tracked separately rather than bundled here, so this change stays one optional
field on one already-declared envelope.

Rendering the findings in Studio is the objectui half of #4717 and is queued in
that repo behind this change.
