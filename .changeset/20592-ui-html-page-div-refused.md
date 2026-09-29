---
'@objectstack/spec': patch
---

feat(spec): the protocol-18 migration step records the html-tier `div` refusal as the semantic entry `ui-html-page-div-refused` (#20592)

Clause-②: no

`MIGRATIONS_BY_MAJOR[18].semantic` gains one entry, `ui-html-page-div-refused`.
It records the narrowing `@objectstack/cli` takes on when its JSX page gate
reaches the SDUI component manifest that `@objectstack/console` ships: a project
with no `sdui.manifest.json` of its own has its `kind: 'html'` pages checked
against that manifest, which does not declare `div`, so `objectstack validate`,
`compile` and `lint` refuse a `div` there (`jsx-forbidden-tag`,
`jsx-unknown-component`). The entry prescribes `box` for a plain wrapper, names
the layout containers to reach for instead only when their layout is wanted, and
says how to prove the rewrite done.

What moves for a consumer of this package: `MIGRATIONS_BY_MAJOR` carries the
entry, and `objectstack migrate meta` prints it, because its default range
already runs to protocol 18, the highest major with a step. Nothing else does.
The protocol-18 step is not cut yet, so `spec-changes.json` and the protocol
upgrade guide, which project the steps up to the current protocol major, are
unchanged, and no schema accepts or refuses anything it did not before.
