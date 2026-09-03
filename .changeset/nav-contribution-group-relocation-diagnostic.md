---
"@objectstack/objectql": patch
"@objectstack/cli": patch
---

fix(objectql,cli): a navigation contribution relocated past a missing group now says so, at `warn` and at build time

A package that injects navigation into another package's app names the target
container by id (`navigationContributions[].group`). When that id matches no
`type: "group"` node in the target app, `SchemaRegistry.applyNavContributions`
appends the items at the app's **top level** and continues.

That relocation is unchanged, deliberately. The merge is a read-time fold
precisely so registration order does not matter — `registerAppNavContribution`
does not require the target app to exist yet — and a package contributing into
an *optional* group has to keep working. Refusing would trade both away.

What changes is that it is no longer invisible. The only trace used to be one
log line gated at `info`/`debug`, so a deployment running at
`OS_REGISTRY_LOG=warn` watched its information architecture change in complete
silence: a typo'd group id — exactly what an AI author emits — turned a nested
menu entry into a top-level one, and because the entry was still *present*, no
smoke test noticed. That is worse than a dropped entry, which someone notices.

The trace is now a real diagnostic naming the contributing package, the target
app, the missing group id and the relocated items:

- **At runtime.** An ADR-0038 `BuildIssue`-family record (ADR-0112 D6c — a
  diagnostics code, lowercase and out of the error ledger) is carried on the
  app and reachable as `registry.getAppNavDiagnostics(appName)`, and announced
  through `console.warn`, so it survives `OS_REGISTRY_LOG=warn` and reaches
  `os doctor` / boot output. Emitted once per registry per distinct mis-aim:
  the fold runs on every read of the app, and a line printed per request is as
  unreadable as one never printed. A deployment that asks for `silent` still
  gets silence, and still keeps the record.
- **At build time.** `os build` answers the same question over a composed
  artifact, through the same predicate, and reports the same finding where an
  author sees it first — in the text output and in `--json` under
  `navigationGroupDiagnostics`. A contribution aimed at an app no package in
  the artifact ships is not reported: contributing into an app another artifact
  installs is the supported case, and is why the merge is a fold.

**Nothing is refused.** No new failure, no ordering constraint, no change to
what installs or to what `os build` accepts — a diagnostic was added and a
refusal was not.

`examples/app-multi-package` now demonstrates the mechanism it was missing: the
App package publishes a `sales_group` container and the Orders module
contributes its nav entry into it, which is what a module split converts an
app's own navigation into.
