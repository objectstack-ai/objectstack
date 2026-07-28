---
"@objectstack/spec": patch
"@objectstack/cli": patch
---

fix(spec): `action.undoable` is `live`, not `experimental` — stop warning on a property that works (#3714)

The liveness ledger marked `action.undoable` `experimental` on a #1992-era note:
*"no runtime reader yet — neither service-automation nor objectui consume the
action's `undoable` flag (objectui has an UndoManager but does not key off this
field)."* That was true when written. objectui has since wired **two** readers,
both gating real behaviour:

| Reader | What the flag gates |
|---|---|
| app-shell `useConsoleActionRuntime.tsx:409` | builds the undo operation the success toast's Undo button invokes (`:147`) |
| app-shell `RecordDetailView.tsx:545` | restores the record's prior field values (`:404`) |

`components` `action/action-button.tsx:113` forwards the flag for exactly this
reason, per its own comment: *"without this the flag is dropped and the handler
never builds the undo operation."*

**Why it mattered.** The CLI liveness lint warns on `experimental` as well as
`dead`, so authoring a *working* property produced a
`liveness-experimental-property` warning — "declared but NOT enforced at
runtime". An author (or an AI) reading the ledger or that warning concludes
`undoable` is aspirational and skips it, losing a shipped feature. Authoring
`undoable: true` is now silent, and the protocol reference no longer claims
setting it "currently has no effect".

Nothing to migrate: the schema, the parsed shape, and the runtime are unchanged
— only the classification of what they already do.

This is the *understating* failure direction, the mirror of the preview-renderer
over-claims corrected in #3685/#3711/#3686. Both directions have the same root
cause, now written into `packages/spec/liveness/README.md`: **a ledger entry is a
claim with a timestamp, and code moves under it in both directions** — entries
are worth re-verifying rather than trusting indefinitely.
