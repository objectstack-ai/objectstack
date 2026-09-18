---
'@objectstack/cli': patch
---

The per-package author-time de-duplication key ignores the top-level collection index, so a package-local finding no longer survives as an echo of the union finding it duplicates

`runPerPackageAuthoringRules` runs the author-time rule table once per
`packages[]` entry and drops anything the union run already reported. Its key
was `rule` + `where` + `path` + `message`, and `path` is **positional**: a
package body re-bases every collection from 0, while the flattened union numbers
that same entry wherever `authoringRuleUnionStack` placed it.
`objects[0].fields.industry` and `objects[1].fields.industry` are ONE finding
under two spellings, so the `Set` never matched them and the echo survived the
filter that exists to remove it.

Measured on `origin/main` a43b9d0654 over the repo's own two-package fixture
`examples/app-multi-package`, at every door, before and after:

| | before | after |
|---|---|---|
| `os build --json` | warnings 4, exit 0 | warnings 3, exit 0 |
| `os validate --json` | warnings 4, exit 0 | warnings 3, exit 0 |
| `os lint --json` | total 4, failing 0, exit 0 | total 3, failing 0, exit 0 |
| `os lint --json --strict` | total 4, failing 4, exit 1 | total 3, failing 3, exit 1 |

The one warning that stops being reported is `field-no-consumers` on
`crm_account.industry` re-reported at the package-local index — the union run's
own finding, printed a second time. Its twin is still reported, which is why no
verdict moves.

**No input's verdict changes, and that is structural rather than a property of
this fixture.** Every finding the de-duplication drops has, by construction, a
finding carrying the same key already in the reported set: the seed is the union
run's findings, which every door reports, and it grows only with per-package
findings that themselves survived. So a door's refusal cannot flip — `os build`
already exits 1 on a union error before this pass runs, and `os lint --strict`
fails on `errors + warnings`, a count that could only reach zero if the twin
went unreported too.

Only the **top-level** index is neutralised. Nested positions (`.indexes[1]`,
`.columns[0]`) address the author's own document and read identically in both
views, so they stay in the key and keep discriminating. A finding's own `path`
is never modified — every door still prints the location it always printed.

What this does **not** buy: the key becomes position-insensitive, not
collision-proof. Two entries that render the same `where` still share a key,
exactly as they already did whenever their indices happened to match. Measured
over every example stack in this repo that parses today (`app-multi-package`'s
built artifact, `app-crm`, `app-showcase`, `app-todo`), 45 registry rules
produced 103 findings and 103 distinct neutralised keys — zero collisions.

Also corrected: the sentence "what survives the filter is exactly the set the
union could not see", which was false for as long as the key was positional and
had been copied from `compile.ts` into the `os validate` and `os lint` doors as
each was wired. It is now stated at the bound the pass can actually hold, in
every file that carried it.

Clause-②: no
