---
"@objectstack/lint": minor
"@objectstack/cli": patch
---

fix(lint,cli): the flow-template-path rule reaches `os lint` and `os compile`, not just `os validate` (#3583, #3810)

`validateFlowTemplatePaths` was wired by hand into `os validate` and nowhere
else. That is precisely the drift `REFERENCE_INTEGRITY_RULES` exists to end
(#3583 §5 D5): the same stack, checked by a different rule subset depending on
which command the author happened to run.

It mattered more after #3861 gave the rule a gating severity. A `{record.<path>}`
token in a CRUD node's `filter` that names an unknown field — or hops through an
un-expanded relation — makes the runtime **refuse the node** (#3810). `os
validate` failed on it; `os lint` and `os compile` did not look, so a CI job
running either one would build and ship a flow that cannot execute.

**The rule is now a suite member.** It belongs by the suite's own admission
criterion: a `{record.<field>}` token is a name written in metadata, resolved
against the bound object's declared fields. One line in
`REFERENCE_INTEGRITY_RULES` reaches all three commands, and the hand-wiring in
`validate.ts` is deleted rather than duplicated.

Before landing this, the rule was run against all three stack shapes the suite
is handed — raw `config` (`os lint`), `normalizeStackInput` output, and
schema-parsed `result.data` (`os validate` / `os compile`) — across `app-todo`,
`app-crm` and `app-showcase`. All three agree finding-for-finding, so moving the
call site does not change what is reported.

Verified end-to-end on `app-showcase`: all three commands pass unchanged on the
real stack (the four pre-existing lookup-traversal warnings still print, still
advisory), and with one filter token corrupted to `{record.idd}` **all three now
exit 1** — where previously only `validate` did.

**Also fixed, in the same file.** On a clean run, `os validate --json` never
reported the reference-integrity suite's warnings: `refWarnings` was assembled,
printed to the console, and included in the *failure* payload, but omitted from
the success-path `warnings` array. Adding the rule to the suite would have
silently dropped its warnings from `--json` for JSON consumers, so `refWarnings`
now appears there — which also surfaces the other five rules' warnings that were
being discarded. Same shape of bug as the dropped errors #3861 fixed: computed,
then thrown away.
