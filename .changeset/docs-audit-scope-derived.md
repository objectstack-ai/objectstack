---
---

tooling: derive the docs-accuracy audit's scope from the filesystem and fail loudly when
it drifts (#4851)

Release-nothing: touches `.claude/workflows/docs-accuracy-audit.js`,
`scripts/docs-audit/`, the root `check:docs-audit-scope` script and one `lint.yml` step —
no package code.

`.claude/workflows/docs-accuracy-audit.js` carried its default audit scope inline, as a
hand-kept `ALL_HANDWRITTEN` array behind a "keep in sync with `affected-docs.mjs --all`"
comment. Nothing checked that promise, and it had rotted in **both** directions:

- **16 listed paths no longer existed** — 10 of them the whole
  `content/docs/protocol/objectos/**` directory, renamed to `protocol/kernel/`. A doc
  path that resolves to nothing produces an audit agent that reads nothing and reports
  `fixCount: 0`, which in the run summary is indistinguishable from a doc that was
  checked and found accurate. That is how the accuracy defects in #4781
  (`runtime-capabilities.mdx` documenting a schema deleted in #3605) and #4817
  (`http-protocol.mdx` attributing the dispatcher's response shape to
  `/api/v1/discovery`) survived ~2 months of green "full" audits.
- **48 existing docs were absent from it** — including all 9 of `protocol/kernel/**` and
  the entire `content/docs/capabilities/` directory. A run logging
  `FULL audit (no args.docs given)` was auditing 130 of 178 hand-written docs.

The list stays inline because it must: a workflow script runs in a `node:vm` context
with no `require`, no `import` and no filesystem, so it can neither walk `content/docs/`
nor read a JSON artifact. So it is now **generated** rather than hand-kept —
`node scripts/docs-audit/check-audit-scope.mjs --write` derives it from
`affected-docs.mjs --all` (one definition of "hand-written doc", not a second walk to
drift), and `pnpm check:docs-audit-scope` fails in `lint.yml` when the block and
`content/docs/` disagree in either direction, naming every entry.

Two more nets, because a CI gate can only see the *default* list:

- the workflow **preflights its resolved scope** — including a caller-supplied
  `args.docs` — and refuses to start, naming every path that does not exist. Its
  arithmetic is reconciled against the scope, so a preflight that cannot account for
  every path exactly once is a failed preflight, not a pass;
- every audit agent now reports `docExists` from the path that actually opens the file,
  and the run **throws** if any comes back false. The preflight is not the real read
  path, and a self-check that runs somewhere other than the real path proves nothing
  about it (#4868).

Same discipline as #4690 / #4777 / #4804 / #4835 / #4868 / #4890: a check whose subject
has gone missing must go red, never green-by-vacancy.
