---
"@objectstack/spec": patch
---

Route the stored-envelope refusal to a command that exists — `os package publish`, not the retired `objectstack publish` (#12223)

An author who hand-writes one of the seven `STORED_ENVELOPE_KEYS` onto an `api`
declaration is refused, and the refusal tells them where publication state actually
comes from. It named a command that resolves to nothing:

```text
before: Remove it — publication state is managed by `objectstack publish`, not authored.
after:  Remove it — publication state is managed by `os package publish`, not authored.
```

`os publish` was the legacy direct-to-environment command, retired with the path that
wrote `sys_environment_revision`. Re-measured on this tree against the **built oclif
`Config`** rather than against docs — loading the CLI's plugin and reading the command
table oclif derives from `dist/commands/**`: **61** ids, of which the only two containing
`publish` are `package publish` and `plugin publish`. There is no bare `publish` id and no
`publish` topic, so the old spelling exits as an unknown command. The message's own
neighbouring sentence already names `publishPackage` as the writer, and
`packages/cli/src/commands/package/publish.ts` is the command that runs it.

This is the shape #12177 deliberately left alone elsewhere inverted: those sentences are
*about* the removal and are correct as history, while this one is **present tense and
prescriptive** — text an AI author obeys at the moment its write is refused.

Text only. No accept/reject behaviour changes: the same seven keys are refused on the same
declarations, with the same `unrecognized_keys` upgrade path; only the sentence an author
reads is corrected. The same stale spelling is fixed in the `publisher` doc comment of
`packages/spec/src/cloud/package.zod.ts`, which ships to consumers in the package's type
declarations.
