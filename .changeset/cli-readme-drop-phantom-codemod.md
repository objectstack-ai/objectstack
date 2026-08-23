---
"@objectstack/cli": patch
---

docs(cli): drop the phantom `os codemod v2-to-v3` claim and stale `projects/` tree node (#10881)

`packages/cli/README.md` is this package's published README, and it carried two
false claims about what the CLI can do.

Its "Code Transforms" section tabled `os codemod v2-to-v3` in the exact same
format as the ~60 real commands above it, and the Architecture source-tree
listing showed a matching `src/commands/codemod/v2-to-v3.ts`. Neither the
command nor the file has ever existed: `packages/cli/src/commands/` has no
`codemod/` directory, and oclif (which resolves commands by globbing
`dist/commands/**/*.js`) returns `command codemod:v2-to-v3 not found` (exit 2).
Removed rather than marked "not yet available", because a reader-facing
row/node with that exact name and shape would still misdescribe the one
concrete plan for this space: #9591 (`os migrate meta --write`, on hold,
targeting v18) is a differently-scoped, differently-named command over the
mechanical retired-key set, not a "v2 config to v3 format" transform — so there
is no accurate future command to point the row at. The "not yet available"
information already lives in `content/docs/protocol/backward-compatibility.mdx`
and `docs/DX_ROADMAP.md`; this brings the package README in line with the tool
itself, which lost the same false prescription in #10882.

The same source-tree listing also showed a `projects/` node under
`src/commands/` with `list/show/create/switch/bind` — stale since the v5.0
`project` → `environment` rename (ADR-0006, no aliases). Renamed to
`environments/`, matching the real directory; the subcommand file list was
already accurate and is unchanged.
