---
"@objectstack/spec": patch
---

fix(spec-tooling): a hard-wrapped mention no longer reads as a migration label (#7094)

Branch 1 of the ADR-0087 completeness gate decides whether the `FROM`/`TO`
placeholder is being **used** as a label or merely **mentioned** in a sentence, by
looking at the one character to its left. Prose in this repo is hard-wrapped at ~80
columns, so a mention that happens to wrap onto a fresh line has *nothing* to its
left — its governing word is on the line above — and was read as a declaration.
That direction hard-blocks an author: all four dispositions close at once and the
only remaining move is to reword a sentence that was true.

When the placeholder opens its line, the question is now asked of the line above
instead — and it is a **narrower** question there. Within a line, adjacency is the
evidence and any attached word governs. A line break is ambiguous by construction, so
across it only a closed class of determiners, possessives and complement-taking
prepositions counts: `carry their` continues into the next line, `ends the line here`
does not. A structural line above (heading, table row, fence marker) does not wrap at
all, and a blank line above opens a paragraph — both keep their previous reading.

Measured over the whole 1792-changeset stock before and after: 176 hits / 132
declared-breaking → 174 / 132. The two that leave are `changelog-ships-in-tarball.md`
(the reported specimen) and `notification-retirement-evidence-corrected.md`, both
mentions on inspection and **neither declaring a breaking change**. The
`--audit-stock` worklist is byte-identical — residue 97, `!` candidates 52 — so no
declared-breaking changeset changed state. The gate's diff-only posture (#6129) is
untouched, and no ledger entry is added or implied.

The wider version of this fix — reusing the in-line "any letter governs" test across
the wrap — was written first and rejected by its own positive control, which is
pinned as an assertion rather than described: it turned every label wrapped under an
ordinary sentence into a mention. The self-test gains 11 assertions (142 → 153)
covering both directions.
