---
"@objectstack/spec": patch
---

feat(spec): the example type-check gate now covers `content/docs`, not just `skills/`

`check:skill-examples` compiles the TypeScript in prose against the built spec, so
an example that stops compiling fails CI instead of quietly teaching code that no
longer works. It does its job — it caught the broken `defineTool` example when
`tool.requiresConfirmation` was removed (#3715).

But it only ever walked `skills/`:

| Tree | files with `ts` blocks | compiled |
|---|---|---|
| `skills/` | 9 | **9** |
| `content/docs/` (hand-written) | 124 | **0** |

The identical break in a docs page would have shipped. Docs examples are copied
verbatim by humans and AI exactly like skill examples, so a gate covering a
fraction of the surface it appears to cover reads as coverage — the same shape as
the stale-evidence and orphan-proof warnings fixed in #3857 / #3868.

The walker is now a `SOURCE_ROOTS` list, and this lands the first batch: **164
docs blocks across 63 pages, taking the gate from 32 to 196 checked examples**.
`content/docs/references/` is excluded — `build-docs.ts` regenerates it from the
schemas, so it cannot drift independently of its source.

**The marker is now per-format.** MDX has no HTML comments: `<!-- os:check -->` in
a `.mdx` fails the fumadocs build outright — *"Unexpected character `!`… to create
a comment in MDX, use `{/* text */}`"*. Caught by building the docs site, after
the first attempt broke 60+ pages. `skills/**/*.md` keeps `<!-- os:check -->`;
`content/docs/**/*.mdx` uses `{/* os:check */}`. Both spellings are recognised for
**orphan** detection, so a wrong-format marker fails loudly rather than silently
checking nothing — the existing guard's philosophy, extended to the new failure
mode this change introduces.

The batch was measured rather than guessed: marking all 780 docs blocks and
compiling showed which are self-contained. One subtlety worth recording — a block
that "passes" inside a 780-file program can be leaning on globals declared by
*other* blocks (a file with no import/export is a global script), so the set was
converged by recompiling and dropping newly-failing blocks until green. 164 stand
on their own.

The remaining blocks are mostly fragments (a `columns: [...]` subtree), which the
gate's opt-in design already anticipates. Whether any are genuine rot is worth a
follow-up now that the machinery reaches them.
