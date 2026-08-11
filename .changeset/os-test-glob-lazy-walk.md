---
"@objectstack/cli": patch
---

fix(cli): `os test` walks the tree lazily and prunes, instead of listing the whole repository first (#7363)

`os test` documents `**` in `resolveGlob`'s own header, and a `**` pattern was the
one thing it could not survive. Run from a repository root:

```
$ node packages/cli/bin/run.js test '**/*.test.json'
FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory
```

Exit 134, after ~7 minutes of GC thrash, before a single suite loaded.

**Why.** `resolveGlob` split the pattern at the first wildcard to get a static base
directory, so a leading `**` left the base at `.` — and then called
`fs.readdirSync(baseDir, { recursive: true })`, which **materialises every path
under the base as one array before any filtering runs**. The filter that would have
thrown almost all of them away never got to run.

The array was worse than "one entry per file", too. `readdirSync(…, { recursive:
true })` *follows symlinked directories*, and a pnpm `node_modules` is a symlink
graph in which every package links to its dependencies' real directories — so the
set of walkable paths is combinatorial in dependency depth, not linear in file
count. That is how a tree `find` reports as ~97k real entries exhausted an 8 GB heap.

**Now.** The walk is lazy and segment-directed: it reads one directory at a time and
descends only into directories that can still satisfy the rest of the pattern, so
nothing is ever accumulated in order to be discarded. It does not follow symlinked
directories, which removes the combinatorial blow-up along with any cycle risk.

Same command, same repository, after: **completes in 3 seconds**, having found the
three `*.test.json` files that are actually in the tree.

**A wildcard no longer descends into `node_modules`, `.git`, `dist` or `build`.**
These are the same defect at a smaller scale: with no ignore list, a suite vendored
in `node_modules` — or a stale copy of your own suite left in `dist` — was a match
`os test` would load and **run against a live server**. A wildcard is a search of
your sources, and none of those four holds one. The prune applies only to
directories a *wildcard* reached: a pattern that spells the name out
(`packages/*/dist/*.test.json`) still walks it, because naming a directory is asking
for it and a list of defaults must not overrule the argument you typed.

Three smaller corrections that fell out of the rewrite:

- **No second `statSync` pass.** The old code stat'ed every surviving match to
  confirm it was a file; `Dirent` already answers that during the walk. Symlinks are
  the only entries that still cost a syscall, and they are still counted as matches
  exactly as before.
- **Only `*` and `**` are wildcards now.** The old translation escaped dots and
  nothing else, so every other regex metacharacter in a filename reached the `RegExp`
  as an operator: `a+b.test.json` did not match itself, and `a?.json` meant "optional
  `a`" and matched `.json`.
- **Absolute patterns resolve absolutely.** A leading `/` was folded through
  `path.join` as an ordinary segment, so `/tmp/x/*.test.json` was resolved against
  the current working directory and silently matched nothing.

Matching is otherwise unchanged: the default `qa/*.test.json` resolves as it always
did, `**` still matches zero segments as well as many, and a pattern with no wildcard
is still a direct file path. Results are now sorted, so suites run in the same order
on every filesystem.
