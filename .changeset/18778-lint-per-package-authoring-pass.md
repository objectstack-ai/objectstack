---
'@objectstack/cli': minor
---

`os lint` runs the per-package author-time rule pass the other two doors already ran

`os build` has run the author-time rule table a second time, once per
`packages[]` entry with that package's body as the stack and the artifact's own
`packages[]` as resolution context, since #16611; `os validate` joined it in
#18677. `os lint` ran the union fold and stopped, so every finding that pass
produces — "exactly the set the union could not see", in the build command's own
words — was reported by the command that ships and invisible on the fastest of
the three doors. All three now call the one shared pass.

Measured on a two-package project whose union run is clean and whose per-package
run is not (one package owns an object, a sibling package owns the view that
displays its field):

| | before | after |
|---|---|---|
| `os build --json` | warnings 1 | warnings 1 |
| `os lint --json` | total 0, exit 0 | total 1, exit 0 |
| `os lint --json --strict` | exit 0 | exit 1 |

**BREAKING** — `os lint --strict` can now fail a project it passed before. A
per-package finding is a finding this door could not see, `--strict` is
documented as "treat warnings as errors", and the verdict moves with it. The
default face is unchanged in the measurement above, and the severity mapping is
`os lint`'s own: an `error` fails the run, a `warning` fails it only under
`--strict`, an `info` stays a suggestion. Nothing is refused here that `os build`
does not already refuse, so the pre-flight is narrowed to the bar the command
that ships already holds and never past it. A run that must keep its old verdict
drops `--strict`; a project that wants to keep it fixes what the pass reports,
which is the same thing `os build` has been reporting all along.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes changes: no spec key, export, config field or payload key is removed, renamed or added. What moved is which stacks one CLI command's existing rule table is run over, so `objectstack migrate meta` has nothing to rewrite and the ledger has nothing to record. -->
