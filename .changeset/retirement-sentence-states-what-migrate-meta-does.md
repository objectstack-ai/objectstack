---
"@objectstack/spec": patch
"@objectstack/lint": patch
---

fix(spec): the retirement prescriptions state what `os migrate meta` actually does (#9529)

Every `retiredKey()` prescription whose surface an ADR-0087 conversion covers
closed with a maintainer-ruled sentence (2026-08-09, #6856):

> Run `os migrate meta --from N` to rewrite existing sources automatically.

The command has never rewritten an authored source file. It replays the
conversion chain over the loaded stack **in memory**, prints the attributed
mechanical change list (`Applied N mechanical change(s)`, one line per site as
`path: from → to (conversionId)`), and writes exactly one file — the `--out`
JSON snapshot, when you ask for it. Every write site in
`packages/cli/src/commands/migrate/meta.ts` is that snapshot; there is no
`--write` / `--fix` / in-place flag. So an author who followed the prescription
got the chain replayed, a printed diff and optionally a JSON document in a shape
their per-artifact `.ts` modules are not written in — and then still edited every
file by hand, with nothing in the message saying so.

Under the maintainer's ruling of 2026-08-18 the sentence is withdrawn in favour
of an honest one, class-wide:

> Run `os migrate meta --from N` to list the mechanical edits for existing
> sources; apply them by hand.

The partial-value conversions keep their two-clause shape, reworded the same way
(`… to list the mechanical edits for the \`1y\` case; the other durations are
reported for you to re-state.`). Behaviour is unchanged in both packages — this
is message text only, and no accept/reject verdict moves.

The claim is withdrawn from every shipped site, not only the canonical sentence:
the variant phrasings in tombstone and conversion-registry prose ("rewrites
author sources", "rewrites it for you", "only `os migrate meta` rewrites
sources") go with it, as do the upgrade-path statements in the hand-written docs
(`upgrading.mdx` now carries the same "does not rewrite your source files" fact
the `objectstack-upgrade` skill already told operators). The class-wide pin
`packages/spec/src/shared/retired-key-migrate-sentence.test.ts` moves in
lockstep and now holds **both** directions: the new sentence is required where a
prescription names the command, and the withdrawn claim is a hard failure
wherever it reappears — including in a prescription that spells the bare command
without `--from N`, which the sentence-shape check alone would not have seen.

The in-place AST codemod that would make the original claim true is commissioned
separately for v18 (#9591); when it lands, the sentence may be restored by
editing that one pin in the same PR.
