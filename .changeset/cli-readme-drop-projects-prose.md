---
"@objectstack/cli": patch
---

docs(cli): correct three more stale `os projects` mentions in the README prose (#10927)

Follow-up to #10881, which renamed the Architecture source-tree node. This
covers the three remaining places in `packages/cli/README.md` that described
an `os projects` command surface as if it still resolved:

- The Cloud command table (`:75`) claimed `os projects create` was a
  registered **alias** of `os environments create`. It is not: none of the
  five files in `packages/cli/src/commands/environments/` (`list.ts`,
  `show.ts`, `create.ts`, `switch.ts`, `bind.ts`) declares an `aliases` static
  field, and neither does the `oclif` block in `packages/cli/package.json`.
  Reworded to name it as the pre-rename spelling instead: "was `os projects
  create` before the v5.0 project → environment rename (ADR-0006, no
  aliases)".
- The Plugin Management prose (`:98`) called `os projects bind ...` a
  "legacy" path that "still binds" an artifact — implying a working
  fallback. Replaced with the real current invocation, `os environments
  bind ...`.
- The Typical Workflow example (`:278`) used `os projects bind ...` directly,
  with no caveat at all. Same replacement, and the trailing comment ("Bind to
  a Cloud Project") is updated to "Cloud environment" to match — "Project"
  now means only the npm/monorepo sense post-rename (ADR-0006).

Verified against the built binary (`packages/cli/bin/run.js`), matching the
falsification standard from triage: the old spellings still fail —
`Error: Command projects:create not found.` / `Error: Command projects:bind
not found.` (exit 2, both) — and the new spellings resolve — `os environments
create --help` and `os environments bind --help` both exit 0 and print their
real flag/argument help.
