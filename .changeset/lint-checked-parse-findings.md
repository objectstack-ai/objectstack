---
"@objectstack/lint": minor
---

Report an unparseable source instead of scoring it CLEAN (#10653).

Four validators parsed authored source with `ts.createSourceFile` and never read
`parseDiagnostics`. That call **cannot throw**, so a source with syntax errors
came back as a tree built by error recovery, got walked like any other, and
produced no findings — a source the validator could not read, reported as a
source with nothing to report. Two of the sites carried a `try/catch` around the
parse that never once ran.

Each now reports what it could not read, as a finding the author receives rather
than as an exit — a publish-time validator is handed metadata by someone else,
so ending the process on their input is not its call. Four new advisory
(`warning`) rule ids, all additive: every finding these rules produce today they
still produce, including from a partially recovered tree.

- `react-page-source-unparseable` — `kind:'react'` page source
  (`validateReactPageProps`)
- `startup-source-unparseable` — plugin source (`findStartupRegistryVerdicts`)
- `hook-body-source-unparseable` — L2 hook body (`validateHookBodyWrites`)
- `action-body-source-unparseable` — L2 action body (`validateActionBodyWrites`)

New exports: the four rule-id constants, plus `describeParseFailure`,
`PARSE_FAILURE_HINT` and the `SourceParseFailure` / `CheckedParse` /
`CheckedParseOptions` types. `ExtractedHookBodyWriteSet` gains an optional
`parseFailure`, so a consumer of the extractor can tell "wrote nothing" from
"could not be read" — the distinction that was missing.

Nothing is removed or renamed, and no source that parses gains a finding. A
stack whose authored sources all parse lints exactly as before; one carrying a
source with a syntax error gains a warning that names the file, line and column
instead of silently skipping the checks.
