---
'@objectstack/cli': minor
'@objectstack/lint': patch
---

feat(cli)!: `objectstack validate` and `objectstack build` refuse a field whose `picklist` names no picklist the stack declares, and lint R8 counts `picklist` as an options source (#20825)

Clause-②: no (narrowing — `objectstack validate` / `objectstack build` newly refuse a field `picklist` that names no picklist the stack declares; the R8 change removes a false-positive warning and widens no accept set of its own)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: `packages/spec` is untouched, and `Field.picklist` stays the snake_case name it was. What changes is that two authoring commands now refuse one authored shape, a field whose `picklist` names no picklist in the stack. `objectstack migrate meta` could not rewrite that shape even in principle, because which list the author meant is not in the metadata. Nothing here judges a stored row. -->

**BREAKING** — an accept-set narrowing on two authoring commands, shipped as
`minor` under the launch-window convention. A stack with a select field whose
`picklist` names no picklist the stack declares — `picklist: 'industy'` beside a
`picklists: [{ name: 'industry', … }]` — used to pass `objectstack validate` and
`objectstack build` (which wrote the artifact). Both now exit 1 and name the field
and the list it names (`picklist-reference-unknown`).
**One-line fix:** correct `picklist` to a list the stack declares, or declare the
list it names (`picklists: [{ name, label, options }]`, or a `*.picklist.ts` file the
stack imports).

**Which references are judged.** The ones the load path registers: the top-level
`objects` and `objectExtensions` of a one-package stack, or each `packages[]`
entry's own. A reference resolves against every picklist the stack declares,
including one a sibling package in the same artifact owns.

**A list from a package outside the stack is reported, not refused.** When the
package declaring the field lists a `manifest.dependencies` entry the stack does not
carry, the list may live there, and these commands cannot read it. That reference is
an `info` notice (`picklist-reference-unverified`) in `warnings` and on the console,
naming the field, the list and the dependencies — never a failure, not even under
`--strict`.

**Lint R8 (`field/select-missing-options`)** no longer reports a select, multiselect
or radio field that names a `picklist`: the picklist is its options source. The
warning it used to give pointed at `options`, which a field naming a `picklist`
cannot add — the field schema refuses the two together. A select with neither still
warns, and its fix now names both sources as alternatives.
